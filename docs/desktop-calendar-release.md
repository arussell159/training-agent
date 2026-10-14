# Desktop calendar release audit — October 14, 2026

The desktop calendar and workout views follow the signed-in TrainingPeaks reference. The application retains Intervals.icu as its workout provider, its original Inter font, existing mobile workout views, and authentication protections. Notes and workout types keep the requested custom choices. No database migrations or permission changes are required.

## Navigation and layout

- Arrows use rendered week positions. At an aligned boundary they advance seven days; between boundaries they choose the nearest week start in the requested direction.
- An in-range date jump preserves the existing range and cached rows. Out-of-range navigation still loads the required range.
- The month trigger reserves 248px. Every month from January through December 2026 was tested: Today and both arrow x-coordinates remained identical, and no label clipped.
- The date picker remounts with the displayed month rather than retaining an earlier hidden month. Today remains aligned with the bottom of the sticky weekday row after delayed context and annual-plan hydration.
- Calendar cards retain 4px side spacing and gray profiles flush with the card edges. Desktop workout headers, totals, combined graphs, signal statistics, laps, and elevation remain compact; Analyze fits at both 1440×900 and 1024×720.
- Source signal statistics remain unchanged by display smoothing. Cursor movement reuses smoothed samples and elevation preprocessing. Missing recordings remain explicit errors with retry; missing GPS does not fabricate a map.

## Verification

Dependency audit: compatible security patches are applied in the root and UI lockfiles. The unused shadcn component-generation CLI is removed from the UI dependency tree; its Tailwind variants/utilities are preserved verbatim in `component-variants.css` with its MIT license. Component behavior and styles remain in the app. Both dependency trees are audited again before promotion.

- 456 backend tests cover authentication, provider writes/readbacks, stale revisions, uncertain retries, completion pairing, notes, comments, and planned values.
- 266 UI tests cover week boundaries, cached hydration, chart scales, distance coordinates, signal extrema and averages, planned field conversions, routes, and startup/cache behavior.
- Five Python worker tests pass. Production build, full UI lint, formatting check, and Git whitespace check pass.
- Browser checks used disposable local provider records for planned number saves/reopen, invalid draft retention, description editing, delete confirmation placement, graph toggles, time/distance mode, lap selection, desktop sizing, and mobile Home. No live athlete workouts were edited or deleted for QA.
- Local measurements: calendar content visible at 565ms; cached calendar visible at 454ms with a simulated 1500ms provider delay; mobile Home visible at 492ms. These are local fixture measurements, not guarantees for all devices or live networks.
- Mobile Home has no horizontal overflow or browser errors in the checked phone viewport. The hero loaded first and the off-screen race image remained deferred.

Screenshots, timing logs, and measured geometry are stored under the ignored `artifacts/mobile-home-redesign/` directory. `.vercelignore` explicitly excludes credentials, local athlete data, logs, QA artifacts, dependency directories, and other checkouts from upload. The existing production deployment is retained as a rollback target until the new deployment is verified.
