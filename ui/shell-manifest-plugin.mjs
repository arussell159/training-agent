import { createHash } from "node:crypto"

const routeModules = {
  "/": "training-dashboard",
  "/calendar": "training-calendar",
  "/week": "training-calendar",
  "/nutrition": "nutrition-page",
  "/settings": "settings-workspace",
  "/coach": "coach-page",
  "/library": "training-library",
  "/annual-plan": "annual-plan-creator",
  "/atp": "annual-plan-creator",
  "/workout-reports": "workout-reports-page",
}

export function createShellManifest(
  bundle,
  routes = routeModules,
  details = {
    workout: "workout-detail-page",
    report: "report-reader-page",
  }
) {
  const chunks = Object.values(bundle).filter((item) => item.type === "chunk")
  const dependencies = (file, found = new Set()) => {
    if (found.has(file)) return found
    const chunk = bundle[file]
    if (!chunk) throw Error(`Shell asset missing from build: ${file}`)
    found.add(file)
    if (chunk.type === "chunk") {
      for (const dependency of chunk.imports || [])
        dependencies(dependency, found)
      for (const css of chunk.viteMetadata?.importedCss || []) {
        if (!bundle[css]) throw Error(`Shell CSS missing from build: ${css}`)
        found.add(css)
      }
    }
    return found
  }
  const urls = (files) => [...files].sort().map((file) => `/${file}`)
  const base = new Set()
  for (const chunk of chunks.filter((item) => item.isEntry))
    for (const file of dependencies(chunk.fileName)) base.add(file)
  if (!base.size) throw Error("The shell build has no entry assets.")
  const isModule = (chunk, name) =>
    String(chunk.facadeModuleId || "")
      .replaceAll("\\", "/")
      .endsWith(`/components/${name}.tsx`)
  // Calendar opens these forms/builders in place. Protect their lazy CSS along
  // with the route, without recursively downloading maps, reports or Nutrition.
  const calendarModules = [
    "workout-editor",
    "desktop-workout-builder",
    "desktop-strength-date-time",
    "desktop-strength-completed",
    "daily-metrics",
    "desktop-event-dialog",
  ]
  const calendarAssets = () =>
    chunks
      .filter((chunk) => calendarModules.some((name) => isModule(chunk, name)))
      .flatMap((chunk) => [...dependencies(chunk.fileName)])
  const moduleFiles = (name, calendar = false) => {
    const chunk = chunks.find((item) => isModule(item, name))
    if (!chunk) throw Error(`The shell route entry is missing: ${name}`)
    return urls(
      [
        ...new Set([
          ...dependencies(chunk.fileName),
          ...(calendar ? calendarAssets() : []),
        ]),
      ].filter((file) => !base.has(file))
    )
  }
  return {
    format: 1,
    base: urls(base),
    routes: Object.fromEntries(
      Object.entries(routes).map(([route, name]) => [
        route,
        moduleFiles(name, ["/calendar", "/week"].includes(route)),
      ])
    ),
    details: Object.fromEntries(
      Object.entries(details).map(([query, name]) => [query, moduleFiles(name)])
    ),
  }
}

export function shellManifestPlugin() {
  return {
    name: "training-shell-manifest",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = bundle["index.html"]
      if (!html || html.type !== "asset")
        throw Error("The app shell HTML is missing.")
      const source = JSON.stringify(createShellManifest(bundle))
      const hash = createHash("sha256")
        .update(source)
        .digest("hex")
        .slice(0, 16)
      const fileName = `assets/shell-manifest-${hash}.json`
      this.emitFile({ type: "asset", fileName, source })
      html.source = String(html.source).replace(
        "</head>",
        `<meta name="training-shell-manifest" content="/${fileName}">\n</head>`
      )
    },
  }
}
