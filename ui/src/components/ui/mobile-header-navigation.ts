import { createContext } from "react"

export const MobileHeaderNavigation = createContext<() => Promise<void>>(
  async () => {}
)
