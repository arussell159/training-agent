/** Static decorative surface. Its CSS owns fill/blur without geometry reads or
 * SVG refraction work during startup, resizing, or keyboard transitions. */
export function LiquidGlassLayer() {
  return <span className="liquid-glass-filter-layer" aria-hidden="true" />
}
