# Captured-image verification

The comparison tool measures existing PNG pairs. It does not navigate TrainingPeaks, capture a browser, establish matching data, or infer functional parity. A passing synthetic test demonstrates the measurement harness only. No TrainingPeaks parity has been established merely by adding this tool.

## Scope and capture requirements

Preserve AR Performance branding, the application sidebar and site header. Capture the **entire agreed calendar/editor/analysis content surface** below/beside those excluded areas in both products, with identical dimensions. Keep a separate full-viewport screenshot and record the exact scope rectangle for auditability. Scope boundaries must be fixed before comparison, not tightened around discrepancies afterward.

For every screenshot pair record inspection date, route/state, account role/available features, browser/version, headed versus headless mode, OS, viewport, browser zoom, device scale factor, theme, loaded fonts, locale, timezone, units, selected dates and scroll position. Use equivalent anonymized workout/activity data and athlete thresholds. Stop animations, wait for fonts/data/rendering to settle, and capture the identical hover/focus/selection/expanded state. The tool records the supplied capture conditions and matching-input description; the operator must independently establish that they are true.

Compare the whole agreed surface **and** separately named key components: cards, buttons, fields, menus, tooltips, builder blocks and charts as applicable. Use the same component rectangle in both images so position/size errors remain visible. A large blank background must not hide a broken small control. An incomplete component list is an incomplete visual audit, even when all supplied regions pass.

No masks, image resizing, automatic alignment correction, antialias exclusions or reference-baseline replacement are performed. Missing files, different image dimensions, invalid crop bounds and missing component crops are failures. The tool never writes to an input path.

## Run

```powershell
node tools/trainingpeaks-visual-compare.mjs artifacts/trainingpeaks-reference/manifest.json artifacts/trainingpeaks-comparison
node --test tools/trainingpeaks-visual-compare.test.mjs
```

For explicit component extraction from an original full-viewport PNG:

```powershell
node tools/trainingpeaks-image-crop.mjs original.png component.png 295 25 700 662
```

Arguments are source, destination, x, y, width, height in original screenshot pixels. This writes the exact pixels without rescaling plus `component.png.capture.json`, retaining the original dimensions, coordinates, source/output hashes and `placementVerified:false`. Preserve and cite these sidecars. Independently cropped reference/local components can be compared for typography and internal styling, but their source positions must also be compared separately. For example, reference x295 and local x290 is a 5-pixel placement discrepancy even if normalized component pixels match. Do not count a normalized crop pass as proof of placement; the full agreed surface comparison remains required. This helper refuses out-of-bounds crops and output-over-source writes.

The crop helper also explicitly accepts `.jpg` sources using the existing `sharp` decoder. A decoded JPEG produces a PNG for diagnostic comparison only: its sidecar records `sourceEncoding:"JPEG"`, `jpegDerived:true` and `acceptanceEligible:false`. Further PNG crops preserve that lossy provenance. Decoding or renaming a JPEG cannot recover lossless source pixels. The comparator itself continues to reject non-PNG inputs, including JPEG bytes given a `.png` extension.

The comparator reads adjacent `.capture.json` sidecars and verifies their output hashes against input images. It preserves each source rectangle and reports coordinate/size deltas when both are present. A JPEG-derived sidecar, or manifest `conditions.acceptanceEligible:false`, forces overall `passed:false` and an explicit **DIAGNOSTIC ONLY — NOT ELIGIBLE FOR ACCEPTANCE** report, even when `pixelsPassed:true`. Keep sidecars with derived evidence. Missing true lossless reference captures remain a certification limitation; diagnostic scores cannot satisfy the 1% requirement.

The decoder resolves a locally installed `pngjs` first, then the existing bundled Codex runtime dependency. No package manifest or lockfile changes are needed on the current workstation. On a machine without either dependency the tool fails with an explicit setup error; install `pngjs` as a development dependency there.

Example manifest (illustrative dimensions/paths only; this is **not** captured evidence):

```json
{
  "version": 1,
  "maxDiffPixelRatio": 0.01,
  "channelTolerance": 0,
  "conditions": {
    "inspectionDate": "2026-10-20",
    "scope": "Calendar content; branding, sidebar and site header excluded",
    "browser": "Record actual browser and exact version",
    "os": "Record actual OS/version",
    "viewport": { "width": 1440, "height": 900 },
    "scopeRectangle": { "x": 250, "y": 100, "width": 1190, "height": 800 },
    "zoom": 1,
    "devicePixelRatio": 1,
    "theme": "light",
    "locale": "en-US",
    "timezone": "America/Chicago",
    "units": "Record actual settings",
    "fonts": "Record loaded family/file/version and weights"
  },
  "pairs": [
    {
      "id": "calendar-default",
      "reference": "calendar-default-reference.png",
      "actual": "calendar-default-actual.png",
      "provenance": "Live TrainingPeaks capture; record route, date, capture evidence and session role without personal data",
      "matchingInputs": "Record fixture identity, selected week, thresholds and control states; include evidence establishing equivalent data",
      "regions": [
        { "id": "day-card", "x": 0, "y": 60, "width": 140, "height": 180 },
        { "id": "date-controls", "x": 0, "y": 0, "width": 400, "height": 50 }
      ]
    }
  ]
}
```

Image paths resolve relative to the manifest. The output argument (or optional manifest `output`) resolves relative to the shell working directory; default output is `artifacts/trainingpeaks-visual`. Pair/region IDs must be unique filesystem-safe names; `full` is a reserved region ID.

## Metric and acceptance

For each pixel, compute the largest absolute difference between corresponding red, green, blue and alpha byte values. The pixel differs when that value exceeds `channelTolerance`. The default is **zero**, which counts every changed channel. `changedPixelRatio = differing pixels / total pixels`.

Every full surface and every component must have `changedPixelRatio <= 0.01` (1%). Stricter limits are allowed; limits above 1% are rejected. Nonzero channel tolerances require an explicit `noiseJustification`; values above 8/255 are rejected. A justification must identify measured rendering noise, not serve as a workaround for styling errors. Reports also retain the maximum channel error and mean absolute channel error even when a documented tolerance is applied.

This is an exact definition of a changed-pixel fraction, **not** a universal perceptual similarity or commercial-readiness score. Separately verify font identity, geometry/style measurements, interactions, persistence and numerical results. One passing state says nothing about unexamined views, inaccessible features or different datasets.

Exit status is `0` when every supplied pair and region passes and the evidence is acceptance-eligible; `1` when at least one pair fails (including absent/mismatched input) or the report is diagnostic-only; `2` for malformed manifest, unavailable decoder or report-writing failure. Failure does not update any baseline.

## Evidence

The output contains `results.json`, an HTML report, and reference/actual/difference/50%-blend overlay PNGs for each full surface and component. Pink pixels identify changes; unchanged pixels are dim grayscale. Open PNGs at native resolution to inspect individual pixels. Source and manifest SHA-256 values, capture-condition declarations, input paths, rectangle bounds and exact counts remain in the JSON report. Treat images and report paths as private when they contain account data; `artifacts/` is already excluded from Git.

The thirteen harness regressions verify pixel counting including alpha, exact 1% boundaries, small-control failure despite a global pass, crop bounds, dimensions, absent files, provenance requirements, rejection of inflated tolerances, accidental self-comparison, input-overwrite protection, exact cropped pixels with preserved source coordinates, diagnostic eligibility enforcement and JPEG provenance across decoding/recropping. Synthetic tests contain no TrainingPeaks account data.
