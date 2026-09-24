const style = String(import.meta.env.VITE_MAPBOX_STYLE || "").trim()
const accessToken = String(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || "").trim()

export const mapboxConfig =
  /^mapbox:\/\/styles\/[^/]+\/[^/?#]+$/.test(style) && accessToken
    ? { style, accessToken }
    : null
