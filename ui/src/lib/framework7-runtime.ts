import Framework7 from "framework7/lite"
import Dialog from "framework7/components/dialog"
import Sortable from "framework7/components/sortable"
import Framework7React from "framework7-react"
// The pinned adapter exports this initializer, but omits its declaration.
// @ts-expect-error Framework7 React shared initializer has no TypeScript declaration.
import { f7, f7init } from "framework7-react/shared/f7.js"

// Install the adapter before any feature component calls f7ready. The root is
// the existing shell: lazy initialization never remounts pages or save workers.
// eslint-disable-next-line react-hooks/rules-of-hooks
Framework7.use([Framework7React, Dialog, Sortable])
let scheduled = false

export function initializeFramework7() {
  if (f7?.initialized || scheduled || typeof document === "undefined") return
  scheduled = true
  const start = () => {
    const root = document.getElementById("framework7-root")
    if (!root) {
      requestAnimationFrame(start)
      return
    }
    scheduled = false
    if (f7?.initialized) return
    f7init(
      root,
      {
        name: "Training Agent",
        theme: "ios",
        sortable: { moveElements: false },
        clicks: { externalLinks: "a" },
        touch: {
          activeState: false,
          touchRipple: false,
          touchHighlight: false,
        },
      },
      true
    )
  }
  requestAnimationFrame(start)
}
