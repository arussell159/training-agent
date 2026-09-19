import { createContext } from "react"

export const MobileHeaderNavigation = createContext<() => Promise<void>>(
  async () => {}
)

export const MobileDefinitionsOpen = createContext(false)
