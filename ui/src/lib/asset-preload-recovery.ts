// Vite remembers attempted CSS preloads, including failed ones. Retrying the
// module alone can therefore render it without its stylesheet. Track only
// same-origin build CSS and restore it before the one explicit local retry.
const failedStyles = new Set<string>()

export function failedPreloadStylesheet(
  error: unknown,
  origin: string
): string | null {
  const message = error instanceof Error ? error.message : String(error || "")
  const match = message.match(/^Unable to preload CSS for (\S+)$/)
  if (!match) return null
  try {
    const url = new URL(match[1], origin)
    return url.origin === new URL(origin).origin &&
      /^\/assets\/[A-Za-z0-9_.-]+\.css$/.test(url.pathname) &&
      !url.search &&
      !url.hash
      ? url.href
      : null
  } catch {
    return null
  }
}

export function installAssetPreloadRecovery(
  target: Window = window
): () => void {
  const failed = (event: Event) => {
    const url = failedPreloadStylesheet(
      (event as Event & { payload?: unknown }).payload,
      target.location.origin
    )
    if (url) failedStyles.add(url)
    // Keep the original exception: its nearest boundary owns the recovery UI.
  }
  target.addEventListener("vite:preloadError", failed)
  return () => target.removeEventListener("vite:preloadError", failed)
}

export async function retryFailedPreloadStyles(
  page: Pick<
    Document,
    "createElement" | "head" | "querySelectorAll"
  > = document,
  accepts: (url: string) => boolean = () => true
): Promise<void> {
  await Promise.all(
    [...failedStyles].filter(accepts).map(
      (url) =>
        new Promise<void>((resolve, reject) => {
          const link = page.createElement("link")
          link.rel = "stylesheet"
          link.href = url
          const finish = (error?: Error) => {
            clearTimeout(deadline)
            link.onload = null
            link.onerror = null
            if (error) {
              link.remove()
              reject(error)
              return
            }
            failedStyles.delete(url)
            for (const old of page.querySelectorAll<HTMLLinkElement>(
              'link[rel="stylesheet"]'
            ))
              if (old !== link && old.href === url) old.remove()
            resolve()
          }
          const deadline = setTimeout(
            () =>
              finish(
                Error(
                  "The editor styles are still unavailable. Return to your workout or reload the latest app."
                )
              ),
            8000
          )
          link.onload = () => finish()
          link.onerror = () =>
            finish(
              Error(
                "The editor styles are still unavailable. Return to your workout or reload the latest app."
              )
            )
          page.head.append(link)
        })
    )
  )
}
