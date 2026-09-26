import { useEffect, useRef } from "react"

import { getDisplacementFilter } from "@/lib/vendor/liquid-glass-filter"

export function LiquidGlassLayer() {
  const layer = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const element = layer.current
    if (!element) return
    const probe = document.createElement("div")
    probe.style.backdropFilter = "url(#liquid-glass-test)"
    if (!probe.style.backdropFilter.includes("url(")) return
    // The SVG map follows the control's actual size, including the wide tab bar.
    const update = () => {
      const { width: rawWidth, height: rawHeight } = element.getBoundingClientRect()
      const width = Math.round(rawWidth)
      const height = Math.round(rawHeight)
      if (!width || !height) return
      const radius = Math.min(width, height) / 2
      const displacement = getDisplacementFilter({
        width,
        height,
        radius,
        depth: Math.min(8, radius / 3),
        strength: Math.min(28, radius),
        chromaticAberration: 1,
      })
      element.style.backdropFilter = `url('${displacement}') blur(1px) brightness(1.15) saturate(1.2)`
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return <span className="liquid-glass-filter-layer" aria-hidden="true" ref={layer} />
}
