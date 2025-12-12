/**
 * Math rendering initialization for Chrome extension environment
 * 
 * In Chrome extensions, external CDN scripts are blocked by CSP.
 * MathJax's browser version uses eval() which is also blocked by CSP.
 * This module uses mathjax-full (Node.js compatible) for math rendering in extension environment.
 */

import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'

let mathInitialized = false
let mathjaxDocument: any = null

/**
 * Check if we're in a Chrome extension environment
 */
export function isExtensionEnvironment(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'chrome-extension:'
}

/**
 * Check if MathJax is already available (loaded from CDN in non-extension env)
 */
export function isMathJaxAvailable(): boolean {
  return typeof window !== 'undefined' && 
         typeof (window as any).MathJax !== 'undefined' && 
         typeof (window as any).MathJax.tex2svg === 'function'
}

/**
 * Check if local MathJax (mathjax-full) is initialized
 */
export function isLocalMathJaxReady(): boolean {
  return mathjaxDocument !== null
}

/**
 * Initialize mathjax-full for extension environment
 */
function initLocalMathJax(): void {
  if (mathjaxDocument) return

  const adaptor = liteAdaptor()
  RegisterHTMLHandler(adaptor)

  const tex = new TeX({
    packages: AllPackages,
    tags: 'ams',
  })

  const svg = new SVG({
    fontCache: 'none',
  })

  mathjaxDocument = mathjax.document('', {
    InputJax: tex,
    OutputJax: svg,
  })

  console.log('[MathJax] Local mathjax-full initialized')
}

/**
 * Initialize math rendering
 * In extension environment, we use mathjax-full which doesn't use eval()
 */
export async function initMathJax(): Promise<void> {
  if (mathInitialized) {
    return
  }

  // If MathJax is already available (non-extension env), use it
  if (isMathJaxAvailable()) {
    mathInitialized = true
    return
  }

  // In extension environment, initialize local mathjax-full
  if (isExtensionEnvironment()) {
    initLocalMathJax()
    mathInitialized = true
    return
  }

  mathInitialized = true
}

/**
 * Ensure math rendering is initialized
 * Returns true if math rendering is available
 */
export async function ensureMathJax(): Promise<boolean> {
  await initMathJax()
  
  // In extension environment, use local mathjax-full
  if (isExtensionEnvironment()) {
    return isLocalMathJaxReady()
  }
  
  // In non-extension environment, use MathJax from CDN
  return isMathJaxAvailable()
}

/**
 * Render a single math expression using local mathjax-full
 */
export function renderMathWithLocalMathJax(tex: string, displayMode: boolean): string {
  if (!mathjaxDocument) {
    initLocalMathJax()
  }

  try {
    const node = mathjaxDocument.convert(tex, { display: displayMode })
    const adaptor = mathjaxDocument.adaptor
    let svg = adaptor.outerHTML(node)
    
    // Add inline styles for proper display
    if (!displayMode) {
      // Inline math: adjust vertical alignment
      svg = svg.replace(/<svg/, '<svg style="vertical-align: middle; display: inline-block;"')
    } else {
      // Display math: center and add margin
      svg = svg.replace(/<svg/, '<svg style="display: block; margin: 1em auto;"')
    }
    
    return svg
  } catch (error) {
    console.warn('[MathJax] Rendering error:', error)
    const escapedText = tex
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return `<code class="math-error">${escapedText}</code>`
  }
}

/**
 * Render all pending math elements in the container using local mathjax-full
 * This is called after the initial render when MathJax was not available
 */
export function renderPendingMathWithKaTeX(container: Document | Element = document): void {
  if (!isLocalMathJaxReady()) {
    initLocalMathJax()
  }

  const pendingElements = container.querySelectorAll('.math-pending')

  pendingElements.forEach((element) => {
    const encodedTex = element.getAttribute('data-math-tex')
    if (!encodedTex) return

    const tex = decodeURIComponent(encodedTex)
    const isBlock = element.classList.contains('math-block')

    try {
      const rendered = renderMathWithLocalMathJax(tex, isBlock)
      element.innerHTML = rendered
      element.classList.remove('math-pending')
      element.removeAttribute('data-math-tex')
    } catch (error) {
      console.warn('[MathJax] Failed to render:', tex, error)
    }
  })
}
