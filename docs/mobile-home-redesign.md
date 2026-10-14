# Mobile homepage layouts

The new mobile Home layout follows the hierarchy of the supplied Aman Birdi PureGym redesign: a personalized photo header with a translucent stats panel and horizontally scrolling session cards. The hero uses neutral white and gray surfaces to blend with the mobile safe area, with AR Performance's blue accents. The site header shares ATP's fading navbar blur, with content scrolling beneath it. It retains the existing workout, recovery, nutrition, race, and history data sources.

Five supplied Waco and Texas race photos are optimized as WebP assets. The header uses the Texas finish scene, session cards vary between cycling and running photos, and the race card uses the Waco cycling photo. Each photo includes subject bounds; `HomePhoto` fits those bounds into the card on resize, keeping the athlete's head, body, and bike in view. A blurred full-bleed layer of the same photo fills the remaining card area, and the source photo's outer margins blend into it without blank edges. The source JPGs remain untouched. The large decorative hero arrow has been removed.

The redesign applies below 768px. Desktop continues to use the original dashboard. Missing measurements remain unavailable, and the weekly session ring uses the athlete's time zone and actual scheduled/completed sessions.

The **Daily snapshot** section uses a two-column grid: HRV and RHR on the first row, Sleep and a compact Nutrition card on the second row. Sleep includes a duration trend over the same displayed recovery period, with a seven-day average and shaded range. Missing nights remain unavailable. Nutrition still opens the food diary and supports quick food entry.

The hero photo loads eagerly with high priority and asynchronous decoding. Session and race photo layers start loading within 200px of the viewport, so lower cards do not compete with the first screen. The same file supplies both layers and remains cached once loaded. Photo fitting and card dimensions remain unchanged.

Every photo wrapper aligns with its card bounds and inherits its corner radius. An explicit rounded clip contains the blurred background and fitted subject, including when mobile browsers composite those layers separately. Blur stays on the inner layers; the clipping wrapper has no filter or negative inset that could paint outside the card.

## Switch or revert

On mobile Home, open the top-right **Options** menu and choose **Use original home layout**. Choose **Use new home layout** to return. The preference persists on that browser/device and uses a session fallback when browser storage is blocked.

The original `SectionCards`, `MobileDailySessions`, charts, and `mobile-dashboard.css` remain in use for the original layout. A local source snapshot of the pre-change homepage and app shell is saved in `artifacts/mobile-home-redesign/original/`. The baseline Git revision is `1fdb72b`.

## Preview

Run `npm --prefix ui run build`, then `node tools/desktop-preview.mjs`, and open `http://127.0.0.1:5194/` at phone width. This preview uses synthetic data and does not connect to the backend, credentials, or training providers. Add `?theme=dark` for the dark appearance.
