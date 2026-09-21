import { f7ready } from "framework7-react"

export function confirmWithFramework7(title: string, message: string) {
  return new Promise<boolean>((resolve) => {
    f7ready((app) => {
      app.dialog.confirm(message, title, () => resolve(true), () => resolve(false))
    })
  })
}
