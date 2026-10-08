import type { Plugin } from 'vite'

/** Fetch styles at normal priority without withholding the inline first paint. */
export function instantPaint(): Plugin {
  return {
    name: 'instant-paint',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/<link\b[^>]*rel="stylesheet"[^>]*>/g, (tag) => {
          const preload = tag.replace('rel="stylesheet"', 'rel="preload" as="style"')
          const deferred = tag.replace('rel="stylesheet"', 'rel="stylesheet" media="print" data-app-style')
            .replace(/>$/, ` onload="this.media='all';this.dataset.ready='true';window.dispatchEvent(new Event('training-styles-ready'))" onerror="this.dataset.failed='true';window.dispatchEvent(new Event('training-styles-ready'))">`)
          return `${preload}\n${deferred}`
        })
      },
    },
  }
}
