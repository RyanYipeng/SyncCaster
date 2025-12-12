export async function initializeMermaid() {
  try {
    // 优先使用全局 CDN 的 mermaid
    if (typeof window !== `undefined` && (window as any).mermaid) {
      const mermaid = (window as any).mermaid
      mermaid.initialize({ startOnLoad: false })
    }
    else {
      // 回退到动态导入（本地 bundle）
      const mermaid = await import(`mermaid`)
      mermaid.default.initialize({ startOnLoad: false })
    }
  } catch (error) {
    // Mermaid initialization failed (may happen in Chrome extension due to CSP)
    console.warn('[md-editor] Mermaid initialization failed:', error)
  }
}
