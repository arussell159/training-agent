/** Desktop owns a scroll pane; mobile keeps its native document scrolling. */
export function calendarScrollSurface(
  root: HTMLElement | null
): HTMLElement | null {
  if (!root || !window.matchMedia("(min-width: 768px)").matches) return null
  return root
}

export function calendarScrollTop(root: HTMLElement | null): number {
  return calendarScrollSurface(root)?.scrollTop ?? window.scrollY
}

export function scrollCalendarTo(
  root: HTMLElement | null,
  options: ScrollToOptions
) {
  const surface = calendarScrollSurface(root)
  if (surface) surface.scrollTo(options)
  else window.scrollTo(options)
}

export function calendarScrollTarget(
  root: HTMLElement | null
): HTMLElement | Window {
  return calendarScrollSurface(root) ?? window
}
