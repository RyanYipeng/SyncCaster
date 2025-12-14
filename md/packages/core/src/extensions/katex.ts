import type { MarkedExtension } from 'marked'

export interface MarkedKatexOptions {
  nonStandard?: boolean
}

const inlineRule = /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\1(?=[\s?!.,:？！。，：]|$)/
const inlineRuleNonStandard = /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\1/ // Non-standard, even if there are no spaces before and after $ or $, try to parse

const blockRule = /^\s{0,3}(\${1,2})[ \t]*\n([\s\S]+?)\n\s{0,3}\1[ \t]*(?:\n|$)/

// LaTeX style rules for \( ... \) and \[ ... \]
const inlineLatexRule = /^\\\(([^\\]*(?:\\.[^\\]*)*?)\\\)/
const blockLatexRule = /^\\\[([^\\]*(?:\\.[^\\]*)*?)\\\]/

/**
 * Check if MathJax is available and ready
 */
function isMathJaxReady(): boolean {
  return typeof window !== 'undefined' &&
         typeof (window as any).MathJax !== 'undefined' &&
         typeof (window as any).MathJax.tex2svg === 'function' &&
         typeof (window as any).MathJax.texReset === 'function'
}

/**
 * Render math using MathJax if available, otherwise return placeholder for deferred rendering
 */
function createRenderer(display: boolean, withStyle: boolean = true) {
  return (token: any) => {
    const escapedText = token.text
      .replace(/&/g, `&amp;`)
      .replace(/</g, `&lt;`)
      .replace(/>/g, `&gt;`)

    // Check if MathJax is available
    if (!isMathJaxReady()) {
      // Return a placeholder that can be rendered later when MathJax is ready
      // Store the original LaTeX in a data attribute for deferred rendering
      const encodedTex = encodeURIComponent(token.text)
      if (!display) {
        return `<span class="math-pending math-inline" data-math-tex="${encodedTex}"><code class="katex-fallback">${escapedText}</code></span>`
      }
      return `<section class="math-pending math-block" data-math-tex="${encodedTex}"><pre class="katex-fallback"><code>${escapedText}</code></pre></section>`
    }

    // MathJax is available, render immediately
    try {
      // @ts-expect-error MathJax is a global variable
      window.MathJax.texReset()
      // @ts-expect-error MathJax is a global variable
      const mjxContainer = window.MathJax.tex2svg(token.text, { display })
      const svg = mjxContainer.firstChild

      if (!svg) {
        // Fallback if rendering fails
        if (!display) {
          return `<span class="katex-inline"><code class="katex-fallback">${escapedText}</code></span>`
        }
        return `<section class="katex-block"><pre class="katex-fallback"><code>${escapedText}</code></pre></section>`
      }

      const width = svg.style[`min-width`] || svg.getAttribute(`width`)
      svg.removeAttribute(`width`)

      if (withStyle) {
        svg.style.display = `initial`
        svg.style.setProperty(`max-width`, `300vw`, `important`)
        svg.style.flexShrink = `0`
        svg.style.width = width
      }

      if (!display) {
        return `<span class="katex-inline">${svg.outerHTML}</span>`
      }

      return `<section class="katex-block">${svg.outerHTML}</section>`
    }
    catch {
      // Fallback on error
      if (!display) {
        return `<span class="katex-inline"><code class="katex-fallback">${escapedText}</code></span>`
      }
      return `<section class="katex-block"><pre class="katex-fallback"><code>${escapedText}</code></pre></section>`
    }
  }
}

/**
 * Render all pending math elements in the container
 * Call this after MathJax is initialized
 */
export function renderPendingMath(container: Document | Element = document): void {
  if (!isMathJaxReady()) {
    return
  }

  const pendingElements = container.querySelectorAll(`.math-pending`)

  pendingElements.forEach((element) => {
    const encodedTex = element.getAttribute(`data-math-tex`)
    if (!encodedTex)
      return

    const tex = decodeURIComponent(encodedTex)
    const isBlock = element.classList.contains(`math-block`)

    try {
      // @ts-expect-error MathJax is a global variable
      window.MathJax.texReset()
      // @ts-expect-error MathJax is a global variable
      const mjxContainer = window.MathJax.tex2svg(tex, { display: isBlock })
      const svg = mjxContainer.firstChild

      if (svg) {
        const width = svg.style[`min-width`] || svg.getAttribute(`width`)
        svg.removeAttribute(`width`)
        svg.style.display = `initial`
        svg.style.setProperty(`max-width`, `300vw`, `important`)
        svg.style.flexShrink = `0`
        svg.style.width = width

        // Replace the placeholder content with the rendered SVG
        element.innerHTML = svg.outerHTML
        element.classList.remove(`math-pending`)
        element.removeAttribute(`data-math-tex`)
      }
    }
    catch {
      // Silently ignore rendering errors
    }
  })
}

function inlineKatex(options: MarkedKatexOptions | undefined, renderer: any) {
  const nonStandard = options && options.nonStandard
  const ruleReg = nonStandard ? inlineRuleNonStandard : inlineRule
  return {
    name: `inlineKatex`,
    level: `inline`,
    start(src: string) {
      let index
      let indexSrc = src

      while (indexSrc) {
        index = indexSrc.indexOf(`$`)
        if (index === -1) {
          return
        }
        const f = nonStandard ? index > -1 : index === 0 || indexSrc.charAt(index - 1) === ` `
        if (f) {
          const possibleKatex = indexSrc.substring(index)

          if (possibleKatex.match(ruleReg)) {
            return index
          }
        }

        indexSrc = indexSrc.substring(index + 1).replace(/^\$+/, ``)
      }
    },
    tokenizer(src: string) {
      const match = src.match(ruleReg)
      if (match) {
        return {
          type: `inlineKatex`,
          raw: match[0],
          text: match[2].trim(),
          displayMode: match[1].length === 2,
        }
      }
    },
    renderer,
  }
}

function blockKatex(_options: MarkedKatexOptions | undefined, renderer: any) {
  return {
    name: `blockKatex`,
    level: `block`,
    tokenizer(src: string) {
      const match = src.match(blockRule)
      if (match) {
        return {
          type: `blockKatex`,
          raw: match[0],
          text: match[2].trim(),
          displayMode: match[1].length === 2,
        }
      }
    },
    renderer,
  }
}

function inlineLatexKatex(_options: MarkedKatexOptions | undefined, renderer: any) {
  return {
    name: `inlineLatexKatex`,
    level: `inline`,
    start(src: string) {
      const index = src.indexOf(`\\(`)
      return index !== -1 ? index : undefined
    },
    tokenizer(src: string) {
      const match = src.match(inlineLatexRule)
      if (match) {
        return {
          type: `inlineLatexKatex`,
          raw: match[0],
          text: match[1].trim(),
          displayMode: false,
        }
      }
    },
    renderer,
  }
}

function blockLatexKatex(_options: MarkedKatexOptions | undefined, renderer: any) {
  return {
    name: `blockLatexKatex`,
    level: `block`,
    start(src: string) {
      const index = src.indexOf(`\\[`)
      return index !== -1 ? index : undefined
    },
    tokenizer(src: string) {
      const match = src.match(blockLatexRule)
      if (match) {
        return {
          type: `blockLatexKatex`,
          raw: match[0],
          text: match[1].trim(),
          displayMode: true,
        }
      }
    },
    renderer,
  }
}

export function MDKatex(options: MarkedKatexOptions | undefined, withStyle: boolean = true): MarkedExtension {
  return {
    extensions: [
      inlineKatex(options, createRenderer(false, withStyle)),
      blockKatex(options, createRenderer(true, withStyle)),
      inlineLatexKatex(options, createRenderer(false, withStyle)),
      blockLatexKatex(options, createRenderer(true, withStyle)),
    ],
  }
}
