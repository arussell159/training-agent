import { useLayoutEffect, useState } from "react"

const revealed = new Set<string>()

/** Once per page per app session; never delay rendering or replay on refresh. */
export function useFirstReveal(page: string, ready: boolean) {
  const [animate, setAnimate] = useState(false)
  useLayoutEffect(() => {
    if (!ready || revealed.has(page)) return
    revealed.add(page)
    setAnimate(true)
  }, [page, ready])
  return animate ? "dashboard-first-reveal" : ""
}
