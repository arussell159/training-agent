import Framework7 from "framework7/lite"
import type { Framework7Plugin } from "framework7/types"

// The pinned runtime exposes the same loader on the class and its instances.
// Its type declarations currently describe only the instance method.
const runtime = Framework7 as typeof Framework7 & {
  loadModule: Framework7["loadModule"]
}

export function registerFramework7Modules(...modules: Framework7Plugin[]) {
  // Module objects install synchronously; no network request is involved. This
  // works both before app creation and when importing a route after app startup.
  for (const module of modules) void runtime.loadModule(module)
}
