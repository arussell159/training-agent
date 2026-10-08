const style = String(import.meta.env.VITE_MAPBOX_STYLE || "").trim()
const accessToken = String(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || "").trim()
// The isolated preview blocks all provider traffic, including map tiles/workers.
const isolatedPreview = typeof window !== "undefined" &&
  (window as Window & { __localPreview?: { synthetic?: boolean } }).__localPreview?.synthetic === true

export const mapboxConfig =
  !isolatedPreview && /^mapbox:\/\/styles\/[^/]+\/[^/?#]+$/.test(style) && accessToken
    ? { style, accessToken }
    : null
