type ToolbarWithInitializer = {
  init: (element: HTMLElement | string) => void
}

/** React owns these tabs' selection, highlight and native click. Framework7's
 * iOS drag highlight cancels touchstart and synthesizes a second button click,
 * which its document touch guard then rejects when contact began on an icon.
 * Keep that gesture implementation exclusively on Framework7-owned toolbars. */
export function preserveNativeReactTabs(toolbar: ToolbarWithInitializer) {
  const initialize = toolbar.init.bind(toolbar)
  toolbar.init = (element) => {
    const node =
      typeof element === "string" ? document.querySelector(element) : element
    if (node?.matches("[data-native-react-tabs]")) return
    initialize(element)
  }
}
