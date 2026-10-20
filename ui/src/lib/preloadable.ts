import {
  createElement,
  lazy,
  useEffect,
  useState,
  type ComponentType,
  type ComponentProps,
  type ReactNode,
} from "react"

/** Preloading must warm the rendered component, not just its downloaded module. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function preloadable<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
  loading?: (props: ComponentProps<T>) => ReactNode
) {
  let resolved: T | undefined
  let pending: Promise<{ default: T }> | undefined
  const preload = () => {
    if (!pending)
      pending = load()
        .then((module) => {
          resolved = module.default
          return module
        })
        .catch((error) => {
          pending = undefined
          throw error
        })
    return pending
  }
  const Deferred = lazy(preload)
  function Component(props: ComponentProps<T>) {
    const ready = resolved
    const [, update] = useState(0)
    const [error, setError] = useState<unknown>(null)
    useEffect(() => {
      if (!loading || ready) return
      let active = true
      void preload().then(() => { if (active) update(value => value + 1) }, reason => { if (active) setError(reason) })
      return () => { active = false }
    }, [ready])
    if (error) throw error
    // Local skeletons commit while the import resolves. This avoids React's
    // Suspense reveal throttle on first navigation as well as warm navigation.
    if (!ready && loading) return loading(props)
    return createElement(ready || Deferred, props)
  }
  return { Component, preload }
}
