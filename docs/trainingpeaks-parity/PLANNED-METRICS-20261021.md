# Planned endurance metrics — 2026-10-21

The earlier generic mean-square estimate did not reproduce fresh TrainingPeaks structured workout totals. The model now calculates power and pace stress separately. These are planned workout estimates; they do not claim to reproduce post-activity terrain adjustments, sensor processing, or all undocumented native rounding rules.

## Observed formula facts

For Run, let `q` be the duration-weighted mean of each step's midpoint speed divided by threshold speed, and `m` the total duration in minutes. Planned stress is `100 × q² × m^1.025 / 60`, rounded to one decimal. Displayed IF is `q` rounded to two decimals. This reproduces the fresh signed-in Target-mode probes with threshold 8:50 min/mile:

| Duration | Target | Native whole TSS | Model whole TSS | IF |
| --- | --- | --- | --- | --- |
| 10 min | 100% | 18 | 18 | 1.00 |
| 20 min | 100% | 36 | 36 | 1.00 |
| 60 min | 100% | 111 | 111 | 1.00 |
| 10 min | 110% | 21 | 21 | 1.10 |

For Swim, planned stress is the sum of `100 × step hours × step factor³`, rounded to one decimal. The builder's displayed IF is the square root of stress divided by `100 × workout hours`, rounded to two decimals. Thus a 105–115% range has midpoint factor 1.10 but displayed swim IF 1.15. The fresh 200 yd / 2:48 example produces 6 whole TSS and 1.15 IF. Reciprocal physical pace ranges use the same mean endpoint speed so changing display units preserves duration, stress and IF.

The desktop builder explicitly requests the native planned-distance timing policy: convert yard length to metres using the observed rounded reciprocal `1.0936133`, truncate converted metres to an integer, divide by midpoint physical speed, then round estimated seconds. This reproduces200yd at110% as168seconds,200yd at100% as185seconds, and10000yd at100% as9299seconds for the observed93sec/100yd threshold. The last case is explained by `10000/1.0936133 =9143.999986…`, truncated to9143. This policy changes only estimated time and dependent stress. Canonical distance conversion remains exactly0.9144metres per yard, and the entered model's distance and duration are never mutated. Calling `workoutTotals` without the explicit policy retains physical estimates.

For power, range targets use their midpoint. A complete 30-second rolling average is sampled once per second, raised to the fourth power, averaged, then fourth-rooted. IF is normalized power divided by FTP; stress is `100 × workout hours × IF²`. Work is the time integral of watts in kJ. The fresh FTP197 example, four repetitions of 360s at 85–95% and 180s at 50–60%, produces IF0.8247863, stress40.81635 and work333.324kJ, displayed as0.82 /41 /333. The implementation integrates piecewise linear power and sums long linear regions analytically, avoiding arrays proportional to workout duration.

## Sources and provenance

Official primary documentation supports [30-second/fourth-power normalized power](https://www.trainingpeaks.com/coach-blog/normalized-power-how-coaches-use/), the [power stress equation](https://www.trainingpeaks.com/learn/articles/estimating-training-stress-score-tss/), and the builder's [midpoint range stress and %FTP energy rules](https://help.trainingpeaks.com/hc/en-us/articles/115003760832-Structured-Workout-Builder-FAQ). The [Run explanation](https://www.trainingpeaks.com/learn/articles/running-training-stress-score-rtss-explained/) confirms a duration adjustment but omits its equation. The [manual Swim explanation](https://www.trainingpeaks.com/learn/articles/calculating-swimming-tss-score/) supports cubic intensity but describes a different aggregate manual procedure, so it was not used to invent builder behavior.

The signed-in browser's observed public script inventory supplied exact URLs under `https://app.trainingpeaks.com/release-20261021-80a71f3/`. Files were downloaded as inert text only; no bundle was executed or copied into application code. Formula observations came from builder calculator module11779 in `modules-ab03cfb1.js`, corroborated for the duration conversion by module30452 in `modules-ec3328c5.js`:

| Public artifact | SHA256 |
| --- | --- |
| modules-ab03cfb1.js | d90cbb786d791f33f6058e58d428565db4b906ef14255aef82da56ca18bdf740 |
| modules-ec3328c5.js | 3dc4b18bdb759b8816744fbe0f38a8374c17dd9b3779dca61df6f524bb0ce319 |
| modules-1a25c13e.js (observed units table) | a110cec7ff4e0d254f220e302b2ca89481fe0f78491c12d5c52a8658087ecffa |

REA parent evidence is `ev_2c35052fa41e8f472936c8a9ae23b51c599a87084b3256f0634539fafaa005e6`; summary evidence is `ev_7f6d757306a3d0d1175f88aedffa15c70969adfabaffeb18db9efcd79cd0759b`. Two selected files parsed successfully, 396,772 bytes, 159 modules. The application/semantic graph is partial: 61 inventoried files were deliberately outside analysis scope and semantic retention was bounded. Static observations do not prove runtime reachability; the fresh native probes independently corroborate the formulas above. Downloaded bundles remain ignored local artifacts, not committed sources.

## Verification and limits

`workout-planned-power.test.mjs` compares the bounded calculation against an independent literal second-by-second rolling-window oracle, including ramps, short changes and watt targets. A1,998-hour valid draft verifies bounded work. `workout-planned-pace.test.mjs` checks all four Run probes, the Swim example, interval weighting, native planned-distance quantization without prescription mutation, unknown/open prescriptions and reciprocal physical-unit equivalence. The combined model/editor/builder suites passed54/54. The units table was inspected as inert text in the third artifact; it was not part of the two-file REA graph selection.

Open and unknown-duration prescriptions retain unknown stress. Under30seconds the model exposes no normalized power because no complete window exists; it retains a separate simple load estimate. Native builder short-window behavior and integer target/length quantization can differ. Arbitrary ramp profiles and every target basis have not been compared state by state against native output. The model's continuous ramp integral is explicit; it is not evidence of exact native discretization parity.
