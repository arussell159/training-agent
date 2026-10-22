import { initializeFramework7 } from "./framework7-runtime"
import { f7ready } from "framework7-react"
import { confirmOnDesktop } from "@/components/desktop-confirm"

export function confirmWithFramework7(title: string, message: string) {
  if (window.matchMedia("(min-width: 768px)").matches)
    return confirmOnDesktop(title, message)
  initializeFramework7()
  return new Promise<boolean>((resolve) => {
    f7ready((app) => {
      app.dialog.confirm(
        message,
        title,
        () => resolve(true),
        () => resolve(false)
      )
    })
  })
}
