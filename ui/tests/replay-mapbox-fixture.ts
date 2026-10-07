type FixtureEvent = { originalEvent?: Event; sourceId?: string; error?: Error }
type EventHandler = (event: FixtureEvent) => void
type MapOptions = {
  container: HTMLElement
  pitch?: number
  zoom?: number
  center?: number[]
}
type ViewOptions = {
  pitch?: number
  zoom?: number
  padding?: Record<string, number>
  duration?: number
}
type Source = {
  type: string
  data?: { geometry?: { coordinates?: number[][] } }
}

const stats = {
  mapsCreated: 0,
  createdAt: 0,
  styleReadyAt: 0,
  mapsRemoved: 0,
  sourcesAdded: [] as { id: string; coordinates: number }[],
  sourceUpdates: 0,
  layersAdded: 0,
  cameraUpdates: 0,
  cameraSettingsUpdates: 0,
  paintUpdates: 0,
  tileChecks: 0,
  flyToCalls: 0,
  markersCreated: 0,
  markersRemoved: 0,
  markerUpdates: 0,
  lastMarkerPosition: [] as number[],
  resizes: 0,
  terrainChanges: 0,
}

Object.assign(window, { __replayMapFixture: stats })

class Map {
  container: HTMLElement
  private handlers = new globalThis.Map<string, Set<EventHandler>>()
  private sources = new globalThis.Map<
    string,
    Source & { setData: (data: Source["data"]) => void }
  >()
  private pitch: number
  private padding: Record<string, number> = {
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  }
  private removed = false
  private fixtureIndex: number
  private timers = new Set<ReturnType<typeof setTimeout>>()
  constructor(options: MapOptions) {
    stats.mapsCreated++
    this.fixtureIndex = stats.mapsCreated
    stats.createdAt = performance.now()
    this.container = options.container
    this.pitch = options.pitch ?? 0
    this.container.dataset.replayFixtureMap = "true"
    // The style is available immediately; imagery is deliberately unavailable.
    // Leave `load` pending when the regression requests the strongest case.
    this.later(() => {
      stats.styleReadyAt = performance.now()
      this.emit("style.load")
      if (!new URLSearchParams(location.search).has("no-load"))
        this.emit("load")
      const fault = new URLSearchParams(location.search).get("fault")
      if (
        this.fixtureIndex === 1 &&
        (fault === "worker" || fault === "imagery")
      ) {
        this.later(
          () =>
            this.emit("error", {
              sourceId: fault === "worker" ? "replay-route" : "composite",
              error: new Error("Fixture source worker failed"),
            }),
          120
        )
      }
    }, 0)
  }
  private later(fn: () => void, delay: number) {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      if (!this.removed) fn()
    }, delay)
    this.timers.add(timer)
  }
  private emit(name: string, event: FixtureEvent = {}) {
    for (const handler of [...(this.handlers.get(name) ?? [])]) handler(event)
  }
  on(name: string, handler: EventHandler) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set())
    this.handlers.get(name)!.add(handler)
    return this
  }
  once(name: string, handler: EventHandler) {
    const once: EventHandler = (event) => {
      this.off(name, once)
      handler(event)
    }
    return this.on(name, once)
  }
  off(name: string, handler: EventHandler) {
    this.handlers.get(name)?.delete(handler)
    return this
  }
  addControl() {
    if (
      this.fixtureIndex === 1 &&
      new URLSearchParams(location.search).get("fault") === "control"
    )
      throw new Error("Fixture attribution control failed")
    return this
  }
  getContainer() {
    return this.container
  }
  getPadding() {
    return this.padding
  }
  getPitch() {
    return this.pitch
  }
  getStyle() {
    return { layers: [] }
  }
  isStyleLoaded() {
    return true
  }
  getSource(id: string) {
    return this.sources.get(id)
  }
  addSource(id: string, source: Source) {
    if (
      this.fixtureIndex === 1 &&
      id === "replay-route" &&
      new URLSearchParams(location.search).get("fault") === "source"
    )
      throw new Error("Fixture route source failed")
    stats.sourcesAdded.push({
      id,
      coordinates: source.data?.geometry?.coordinates?.length ?? 0,
    })
    this.sources.set(id, {
      ...source,
      setData: (data) => {
        stats.sourceUpdates++
        if (
          this.fixtureIndex === 1 &&
          new URLSearchParams(location.search).get("fault") === "route-update"
        )
          throw new Error("Fixture route update failed")
        source.data = data
      },
    })
    if (
      this.fixtureIndex === 1 &&
      id === "replay-route" &&
      new URLSearchParams(location.search).get("fault") === "source-sync-error"
    )
      this.emit("error", {
        sourceId: "replay-route",
        error: new Error("Fixture synchronous source error"),
      })
    return this
  }
  addLayer() {
    if (
      this.fixtureIndex === 1 &&
      new URLSearchParams(location.search).get("fault") === "layer"
    )
      throw new Error("Fixture route layer failed")
    stats.layersAdded++
    return this
  }
  setPaintProperty() {
    stats.paintUpdates++
    if (
      this.fixtureIndex === 1 &&
      stats.paintUpdates > 4 &&
      new URLSearchParams(location.search).get("fault") === "paint"
    )
      throw new Error("Fixture route paint failed")
    return this
  }
  setLayerZoomRange() {
    return this
  }
  setFilter() {
    return this
  }
  getFilter() {
    return undefined
  }
  setLayoutProperty() {
    return this
  }
  setTerrain() {
    stats.terrainChanges++
    return this
  }
  setFog() {
    return this
  }
  private view(options: ViewOptions) {
    stats.cameraUpdates++
    if (
      options.pitch !== undefined ||
      options.zoom !== undefined ||
      options.padding !== undefined
    )
      stats.cameraSettingsUpdates++
    this.pitch = options.pitch ?? this.pitch
    this.padding = options.padding ?? this.padding
    this.emit("move")
    return this
  }
  jumpTo(options: ViewOptions) {
    return this.view(options)
  }
  fitBounds(_bounds: unknown, options: ViewOptions) {
    return this.view(options)
  }
  flyTo(options: ViewOptions) {
    stats.flyToCalls++
    this.view(options)
    this.later(() => this.emit("moveend"), options.duration ?? 0)
    return this
  }
  stop() {
    return this
  }
  areTilesLoaded() {
    stats.tileChecks++
    return false
  }
  resize() {
    stats.resizes++
    return this
  }
  remove() {
    if (this.removed) return
    stats.mapsRemoved++
    this.removed = true
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.handlers.clear()
  }
}

class Marker {
  private element: HTMLElement
  constructor(options: { element?: HTMLElement } = {}) {
    stats.markersCreated++
    this.element = options.element ?? document.createElement("div")
  }
  setLngLat(position: number[]) {
    stats.markerUpdates++
    stats.lastMarkerPosition = position
    return this
  }
  addTo(map: Map) {
    map.container.append(this.element)
    return this
  }
  getElement() {
    return this.element
  }
  remove() {
    stats.markersRemoved++
    this.element.remove()
    return this
  }
}
class LngLatBounds {
  extend() {
    return this
  }
}
class AttributionControl {}
class NavigationControl {}

export default {
  Map,
  Marker,
  LngLatBounds,
  AttributionControl,
  NavigationControl,
  prewarm() {},
}
