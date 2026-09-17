# Section 11 — Metric and Abbreviation Glossary

**Source:** SECTION_11.md, protocol v11.69, updated September 15, 2026.  
**Prepared:** September 17, 2026.  
**Purpose:** A readable reference for app metric descriptions: what each shorthand means, what its values mean, and when training phase changes the interpretation.

The ranges below are **Section 11's stated coaching rules**, not independently validated universal reference ranges. Where the manual does not define a range, this glossary says so. Where it conflicts with itself, the conflict remains visible instead of being silently converted into a new rule.

## How to read this glossary

- **Target:** A desirable value for the particular purpose named. A progression target can be stricter than a routine monitoring target.
- **Flag:** Something to interpret with other evidence; not automatically a failed workout or a reason to stop.
- **Phase-dependent:** The expected value or its meaning changes during Base, Build, Peak, Taper, Deload, or Recovery.
- **Context-dependent:** Interpretation depends on the athlete, sport, workout, environment, data quality, or observation window.
- **Not defined:** The manual provides no reliable universal cutoff. Do not invent a traffic-light range.
- Ratios and percentages are different: 0.80 = 80%, but a logarithmic index such as Treff PI is neither.
- A percentage-point change is an absolute difference between percentages: 3% to 5% is +2 percentage points, not +2%.
- Missing, unavailable, or ineligible data is not zero and is not a poor result.
- Source codes such as S3 point to the source section and exact line window listed at the end.

## 1. Readiness and recovery

| Metric / shorthand | Definition and unit | Range and interpretation in Section 11 | Does phase change the interpretation? |
|---|---|---|---|
| **RI — Recovery Index** | Composite ratio: (today's HRV ÷ baseline HRV) ÷ (today's RHR ÷ baseline RHR). It has no stated upper cap and is not a 0–100 score. | General interpretation: ≥0.80 good; 0.60–<0.80 moderate; <0.60 immediate deload / P0 Skip. Below 0.70 for ≥2 days is a warning; ≥3 days warrants block-level review. **Readiness signal differs:** ≥0.70 is green; a single day at 0.60–<0.70 is also green; persistent <0.70 is amber. | Baseline RI bands do not change by phase, but the response to amber/red signals does. Progression pathways often require RI ≥0.80; some stricter gates require ≥0.85. Do not treat “green” as automatic permission to progress. S4, S5, S7. |
| **HRV — Heart Rate Variability** | Variation in time between heartbeats. The readiness input specifically uses resting rMSSD, in milliseconds. | Compare with the athlete's 7-day baseline. Signal table: within ±10% green; a 10–20% decrease amber; >20% decrease red. No universal “good HRV in ms.” An increase above +10% is not explicitly classified by that table. | The percentage bands stay the same, but taper/race-week P2 rules are more sensitive. Race-day guidance treats HRV as context rather than a standalone DNS reason. Shared endpoints in the source need the exported status; see conflicts. S5, S16. |
| **rMSSD / RMSSD** | Root mean square of successive differences between normal heartbeat intervals; an HRV measure, in ms. | This is the HRV type the protocol expects. No separate universal good/bad range; use the athlete's own baseline. | No phase-specific numeric scale. Must use compatible resting measurements. S5. |
| **SDNN** | Standard deviation of normal-to-normal heartbeat intervals; another HRV measure, in ms. | Not interchangeable with rMSSD. If only SDNN is available, Section 11's rMSSD readiness signal remains unavailable. Do not rescale SDNN into rMSSD. | No phase-specific range. S5. |
| **RHR — Resting Heart Rate** | Heart rate at rest, in beats per minute (bpm). | Relative to the 7-day baseline: at/below baseline green; +3–4 bpm amber; ≥+5 bpm red. The source table leaves increases between 0 and 3 bpm incompletely specified. | Numeric bands do not change; phase changes the combined readiness response. A high RHR is a signal to investigate, not proof of illness. S4, S5. |
| **Sleep duration** | Hours slept. | ≥7 h green; 5–<7 h amber; <5 h red. The source writes “5–7” for amber while also making ≥7 green; this glossary gives the explicit ≥7 green rule precedence at exactly 7 h. | Sleep contributes to training readiness; the race-day section treats sleep as context rather than a standalone DNS reason. S5, S16. |
| **Sleep quality** | Intervals.icu positional sleep-quality rating. May be entered by the athlete or derived from device data. | 1 = Great, 2 = Good, 3 = Average, 4 = Poor. Lower is better on this scale. It receives no additional numerical readiness weight. | Context in every phase; do not score it again on top of sleep duration. S1, S8. |
| **Sleep score** | Device-specific sleep summary, usually 0–100. | Higher generally represents a better device score, but Section 11 defines no cross-device cutoffs. Excluded from readiness scoring. | No phase-specific bands. Device score is context, not a substitute for sleep duration or current athlete state. S8. |
| **Feel — current state** | Athlete's current subjective condition: 1 = Strong, 2 = Good, 3 = Normal, 4 = Poor, 5 = Weak. | Lower is better. For a later same-day session: 5 means Skip; 4 defaults to Skip, with a genuinely restorative/technique exception only after clarifying the reason. | Context and phase matter, but the same-day absolute at 5 remains. Must be asked when relevant: the sync payload does not supply current Feel. A completed workout's Feel rating is not current Feel. S5, S8. |
| **RPE — Rating of Perceived Exertion** | How hard the completed effort felt; the protocol's expectation table uses a 1–10 scale. | Higher means harder, not automatically worse. Compare with achieved IF, session duration, conditions, and workout purpose. See the IF/RPE table below. | Hard work can appropriately have high RPE in Build or Peak. Unexpectedly high RPE on easy work is more informative than a high number alone. RPE by itself is not an absolute stop. S5, S12. |
| **Effort response** | Exported comparison of whole-session RPE with expected RPE for achieved session IF. | Positive = below expected band; neutral = within; negative = above. Null = missing/unusable IF or RPE, or IF <0.65, which is intentionally outside coverage. | Positive after deload or in race week is expected. Repeated negative responses during a build deserve context. This field does not directly change readiness. S12. |
| **Readiness decision: P0–P3** | Priority class of the exported Go / Modify / Skip assessment; not a fitness score. | P0 = safety stop; P1 = acute overload; P2 = accumulated-fatigue assessment; P3 = Go. P0/P1 are not overridden by a good workout or feeling better. | Yes. P2 counting rules change by phase. Use the actual exported recommendation and reason; do not recreate it from one metric. S5. |

### How phase changes the combined readiness decision

These are **P2 combination rules**, not new standalone HRV/RHR cutoffs. Earlier P0/P1 branches are checked first.

| Phase | Amber signals needed to reach the P2 modification threshold | TSB amber boundary stated in phase table | Extra sensitivity to red signals |
|---|---:|---:|---|
| Base | 2 | −15 | Standard |
| Build | 3 | −20 | Standard |
| Peak | 2 | −15 | Standard |
| Taper | 1 | −15 | One red can trigger modification |
| Race week, before race day | 1 | −15 | One red can trigger modification |
| Recovery / Deload | 2 | −15 | Standard |
| Overreached | 2 | −15 | Standard |
| Phase unknown | 2 | −15 | Standard |

The P2 section also assigns Skip when two or more signals are red. Race-week session targets remain a ceiling: readiness can reduce them, not increase them. Race day has a separate event-specific checklist. Source: S5.

## 2. Training load, fitness, and fatigue

| Metric / shorthand | Definition and unit | Range and interpretation in Section 11 | Does phase change the interpretation? |
|---|---|---|---|
| **TSS — Training Stress Score** | Training-load score; the mirror's total_tss sums recorded activity training load. Describes workload, not workout quality. | No universal good daily or weekly total. Compare actual versus planned load, recent baseline, available time, and response. The manual does not establish that every imported sport's load uses an identical calculation. | Yes. Build generally accumulates load; Deload/Taper reduce it. Do not classify a lower taper total as failed training. S2, S16, S17. |
| **CTL — Chronic Training Load** | Longer-term training-load estimate, often shown as Fitness. It is not a direct measurement of race fitness. | No universal good/bad absolute value or complete smoothing formula is specified here. The phase detector uses trend and position relative to the recent cycle. | Yes. Build expects a rising trend; Peak is near the cycle high; a decline during taper/recovery can be intended. S2. |
| **ATL — Acute Training Load** | Shorter-term training-load estimate, often shown as Fatigue. It represents recent workload, not a diagnosis of fatigue. | No universal good/bad absolute value or complete smoothing formula is supplied. Interpret alongside CTL, readiness, and the plan. | Yes. Higher recent load may be intentional during Build; lower load is intended during Deload/Taper. S2, S6. |
| **TSB — Training Stress Balance / Form** | Balance between longer-term and recent load, conventionally CTL minus ATL. Use the supplied value because timing conventions matter. | −30 to −10 is described as commonly normal in training. Below −30 calls for closer review. Above +10 indicates a recovery surplus that may be intended. The readiness signal has phase-specific bands; this descriptive range is not a green-light rule. | **Strongly.** Negative Form is often expected during Build; positive Form can be useful for a race. See event targets below. Negative TSB alone is not a reason to prescribe recovery. S5, S6, S16. |
| **ACWR — Acute:Chronic Workload Ratio, live** | Recent load relative to longer-term load; current-state version uses 7-day/28-day windows and includes today. | Reporting bands: <0.80 reduced recent load; 0.80–<1.30 reference band; ≥1.30 flag; ≥1.35 reporting alarm. These live alerts are marked ineligible for readiness decisions. | Low ACWR may be expected in taper or after a deload. High ACWR after a reduced chronic baseline needs explanation. It is not a standalone injury-risk or training-clearance score. S4, S5. |
| **ACWR, start of day** | Readiness version of the 7-day/28-day ratio, excluding activities dated today. | <1.30 green; 1.30–<1.50 amber; ≥1.50 red. An ACWR-driven P1 Skip additionally requires a corroborating primary readiness signal. Otherwise it participates in P2 counting. | Phase changes P2 sensitivity. Completing a workout must not make its live ACWR increase automatically veto a second session. S5. |
| **ACWR, weekly phase detector** | Separate historical ratio from finalized weekly rows: 7-day acute / 21-day chronic. | Overreached classification requires monotony >2.50 and either ACWR ≥1.50, or ACWR ≥1.30 with a rising trend. Do not apply this rule to the live 7/28 metric. | Used to classify phase, not an independent command to skip training. S2. |
| **Monotony — Training Monotony Index** | Mean daily training load ÷ standard deviation of daily load. Measures uniformity of the load pattern. | <2.50 reference range; warning begins at 2.30; alarm at 2.50. Higher means more uniform load, not necessarily worse recovery. | **Yes.** During and 2–3 days after deload, uniformly easy days can inflate it. If trailing 7-day TSS is ≥20% below the 28-day weekly average, do not change training from monotony alone. S3, S4. |
| **Strain** | Cumulative training-stress indicator interpreted with monotony and load. | <3500 reference; >3500 alarm in the manual. Exactly 3500 is not assigned. Its calculation and scaling are not fully defined in this MD. | Load context matters. A higher value does not independently establish poor readiness. Do not silently treat it as identical to Load Ratio. S4, S13. |
| **Load Ratio** | The manual defines this as Monotony × Mean Load. It is not ACWR and not Load-Recovery Ratio. | <3500 listed as its reference range. Mean Load's units/window are not sufficiently specified to implement a new calculation reliably. | Context-dependent; no separate phase bands. Definition/scaling needs implementation verification before app coloring. S4. |
| **Stress Tolerance** | Manual formula: (Strain ÷ Monotony) ÷ 100. | <3 low buffer; 3–6 listed as sustainable; >6 described as high capacity. These depend on the underlying strain calculation and scale. | Contextual, not proof the athlete can absorb more training. Primary readiness still governs; no separate phase bands. S13. |
| **Load-Recovery Ratio** | Manual formula: 7-day Load ÷ RI. A secondary load-versus-recovery indicator. | <2.50 normal; ≥2.50 alert **as written**. The load normalization needed to reconcile that range with raw weekly TSS is unspecified. Do not calculate raw weekly TSS ÷ RI and apply this range. | Context only until scale is verified. Even a valid elevated value does not automatically trigger deload when RI is good. S4, S13. |
| **Fatigue Trend** | Manual formula: change in ATL minus change in CTL. | −0.20 to +0.20 is called stable. The time interval and normalization are not defined well enough to reproduce this numeric band. | Interpretation follows training intent; no reliable standalone good/bad classifier can be built from this MD alone. S4. |
| **Ramp rate / ΔTSS%** | In the Rolling Phase section, week-to-week percentage change in training load. | No universal safe numeric band is specified. Do not confuse percentage load change with CTL points per week; identify the actual field and unit. | Yes. Positive during buildup and negative during deload/taper can both be appropriate. S2. |
| **CTL slope** | Direction and rate of CTL change used by phase detection. | Build evidence includes slope >1.0; Base evidence includes −1.0 to +1.0. These are classifier features, not universal good/bad thresholds; the slope calculation is not fully specified here. | Explicitly phase-dependent. S2. |

### Race-preparation Form targets

These are the manual's event-duration targets for an A race, not ordinary daily “good TSB” bands.

| Event duration class | TSB target |
|---|---:|
| Short: under 90 minutes | +5 to +15 |
| Medium: 90 minutes to 3 hours | +10 to +20 |
| Long endurance: over 3 hours | +10 to +25 |

For a B race, the manual shifts the target range down by 5 points. A TSB below target is context, not a standalone DNS reason. Race priority, actual event demands, illness/injury, and the dedicated race-day rules matter. Source: S16.

## 3. Thresholds, power, and workout intensity

The expansions below explain established shorthand. Where the MD supplies no algorithm or absolute target, none is added.

| Metric / shorthand | Definition and unit | Range and interpretation in Section 11 | Does phase change the interpretation? |
|---|---|---|---|
| **FTP — Functional Threshold Power** | Configured threshold power, in watts. For cycling, the familiar FTP setting; the same field can represent another sport's threshold power. | No universal good FTP. Use the current sport-specific setting; do not infer it from one workout or substitute another sport's value. | Compare trends against phase and prior values. The meaning of the configured threshold does not change by phase. S1, S7. |
| **eFTP — estimated FTP** | Modeled estimate of threshold power. Separate from the configured FTP. | No absolute good/bad band. Differences from configured FTP are observations to investigate, not automatic setting changes. | Training content and recent maximal efforts affect interpretation. S1, S14. |
| **Indoor FTP** | Threshold power recorded specifically for indoor training. | No universal difference from outdoor FTP. Use the environment-matched setting where available. | Environment-specific, not phase-specific. S1, S12. |
| **LTHR — Lactate Threshold Heart Rate** | Configured threshold HR for a sport, in bpm. | No universal good/bad number. Running and cycling settings must remain separate. | Phase may affect measured performance, but thresholds require supported updates, not relabeling. S1. |
| **HRmax / Max HR** | Maximum heart-rate setting for the relevant sport, in bpm. | No universal performance grade; a larger maximum is not automatically better. | No phase-specific target. S1. |
| **LT1 / AeT** | First lactate threshold / aerobic threshold: conceptual boundary between the easy and heavier domains. | Individual threshold, not a universal wattage, HR, or lactate value. Current sport-threshold JSON carries no configured LT1 field. | The training time spent below/above it changes by phase. Do not derive LT1 from FTP or LTHR. S1, S3, S11. |
| **LT2 / AnT** | Second lactate threshold / anaerobic threshold: upper threshold boundary used by the protocol. | Individual threshold. Section 11 uses current sport-specific threshold settings for comparison; DFA calibration is restricted to cycling. | Workload distribution changes by phase; there is no phase-specific universal threshold value. S1, S11. |
| **VT1 / VT2; HRVT1 / HRVT2** | First/second ventilatory thresholds; first/second HRV-derived threshold estimates. They describe different measurement methods. | Section 11 associates them with the LT1/LT2 domains. Do not assume the methods produce identical measurements in an individual. | No good/bad absolute ranges; sport, method, quality, and calibration matter. S3, S11. |
| **MLSS — Maximal Lactate Steady State** | Exercise-intensity concept used in the manual's FTP-governance discussion. | No separate MLSS range or field calculation is defined here. | Not a phase score; do not invent a value from FTP alone. S7. |
| **CP — Critical Power** | Parameter in the power-duration model, in watts. | No universal good/bad value. The sustainability calculation explicitly uses configured FTP as a CP proxy; that does not make FTP and CP interchangeable measurements. | Goal/duration context matters; not a readiness score. S15, S18. |
| **W′ — W prime** | Modeled work capacity above CP, in joules or kilojoules. | No universal target. Requires credible power-curve/model inputs. Do not confuse watts (power) with joules (work). | More relevant to hard intervals/surges than easy endurance. Not a primary readiness input. S18. |
| **Pmax / P_max** | Maximum/peak power capability estimate, in watts. | No good/bad bands or complete computation specified. | Event-specific; sprint capacity is not the same as endurance readiness. S1. |
| **MMP — Mean Maximal Power** | Highest observed average power for a specified duration, in watts. | Always attach the duration and observation window. No universal good value; a lower observed best can reflect fewer maximal efforts. | Compare the duration relevant to the phase and event. S14, S15. |
| **MAP — Maximal Aerobic Power** | Aerobic-power capability label. The power-curve section uses the 5-minute anchor as an MAP-related signal. | No universal band. An observed 5-minute MMP is not itself a direct laboratory MAP measurement. | Useful in the appropriate training context, not a standalone readiness verdict. S14. |
| **VO₂max** | Maximal oxygen uptake; relative values commonly use ml/kg/min. | No age/sex-specific good/bad table is supplied. Preserve the actual measurement/estimate source. | Capability context only; no phase-specific universal score. S1. |
| **AP / Avg Power** | Arithmetic average power over the relevant session or work segment, in watts. | Compare the correct segment against its prescription. A session average includes easier warm-up/recovery time and cannot grade the work intervals. | Target depends on workout and phase. S7. |
| **NP — Normalized Power** | Weighted power metric used to describe variable effort, in watts. | No absolute good/bad range. Used in EF and session-load context; not proof that prescribed intervals were completed. | Workout/terrain context matters. Do not use NP × time to calculate mechanical work; use average power. S7, S10. |
| **IF — Intensity Factor** | Relative intensity, conventionally NP ÷ relevant FTP for cycling. | 1.00 corresponds to 100% of that reference. IF can exceed 1.00; higher means harder, not better. See the manual's IF/RPE bands below. | Intended intensity changes by session and phase. Verify units: the source sometimes represents 0.65 as 65 in raw activity data. S5, S12. |
| **VI — Variability Index** | Power variability, conventionally NP ÷ average power. | The manual uses 0 < VI ≤1.05 as its steady-power eligibility filter. It does not supply universal race-type “good VI” bands. | Higher VI can be expected in intervals, surges, and hilly terrain. Not inherently poor execution. S5, S14. |
| **Cadence** | Cycling pedal revolutions per minute (rpm), where that is the activity's cadence basis. | No universal good/bad cadence band in the manual. Respect prescribed cadence/technique requirements when present. | Workout-specific, not a generic phase target. S7. |

### Expected RPE for achieved IF

These are the manual's interpretive bands, not a replacement for prescribed workout targets.

| IF, ratio format | Expected RPE | Manual's description |
|---|---:|---|
| Below 0.65 | Not defined | Effort-response signal intentionally null |
| 0.65–0.75 | 2–4 | Endurance |
| 0.75–0.85 | 4–6 | Tempo / sweet spot |
| 0.85–0.95 | 6–8 | Threshold |
| 0.95–1.05 | 8–9 | Race-pace / FTP-validation effort |
| Above 1.05 | 9–10 | Supra-threshold |

The source overlaps endpoints at 0.75, 0.85, and 0.95. Use the exported effort_response rather than inventing endpoint precedence. Longer duration, indoor conditions, heat, and other stressors alter the expected experience. Whole-session RPE should not be compared indiscriminately with a main-set IF. Source: S12.

## 4. Workout execution, durability, and adaptation

| Metric / shorthand | Definition and unit | Range and interpretation in Section 11 | Does phase change the interpretation? |
|---|---|---|---|
| **Full-set completion** | Whether all prescribed main-work steps were completed on the prescription's time/distance/repetition basis. | True, false, or unavailable. No invented completion tolerance. Partial completion is not a target-adherence percentage. | The prescribed session changes with phase; the meaning of completion does not. Requires verified pairing with the original prescription. S7. |
| **Target adherence / compliance** | How the completed main-work steps matched their verified targets. | Power tolerance: greater of ±3 W or ±1% of target. Aggregate adherence requires completed, uniquely mapped, comparable steps and valid evaluators. ≥95% adherence plus full completion is a progression gate, not a universal pass mark for every workout. | Progression also depends on phase and subsequent/current recovery. This MD defines no equivalent pace/HR/RPE adherence validator. Unavailable is not failed. S7. |
| **Consistency Index** | Matched planned dates ÷ planned dates, using unique dates. | Ratio 0–1: ≥0.90 high date match; 0.70–<0.90 partial; <0.70 low. Null if no planned dates. Any activity can match a date. | A deliberately skipped workout may lower it appropriately. It does not prove sport, duration, or interval compliance. S7. |
| **EF — Efficiency Factor** | NP ÷ average HR, typically W/bpm. | No universal cutoff. Rising EF across comparable sessions can indicate improved efficiency. Qualifying cycling sessions require ≥20 min and 0 < VI ≤1.05. | Training phase, intensity, heat, terrain, and indoor/outdoor setting affect comparison. Never grade unrelated sessions by EF alone. S5, S13, S14. |
| **DI — Durability Index** | Final-hour average power ÷ first-hour average power. Ratio 1.00 means equal averages. | Three distinct manual benchmarks: ≥0.90 broad audit range; ≥0.95 optional-quality target; ≥0.97 across ≥3 long rides is a stricter progression criterion. Higher usually means less power fade, but pacing/terrain matter. | Longer and more race-specific sessions make it more relevant. A stronger end may reflect intentional pacing rather than superior fitness. Do not merge these thresholds. S4, S7, S13. |
| **HR–power decoupling / cardiac drift** | Change in the HR-to-power relationship between the first and second halves, expressed as %. | Formula: [(HR₂ ÷ P₂) ÷ (HR₁ ÷ P₁) − 1] × 100. General target <5%; stricter progression guidance uses <3%. Individual-session interpretation requires ≥90 min and 0 < VI ≤1.05. | Heat, hydration, terrain, cooling, duration, and session structure affect it. Not a direct dehydration diagnosis. Negative values can occur and are not inherently invalid. S5, S9, S13, S14. |
| **Aggregate durability, 7d / 28d** | Mean decoupling across qualifying steady sessions. Despite the name, it is a percentage, not DI. | Descriptive bands: <3% good; 3–5% moderate; >5% elevated drift. Trend improves if 7d is >1 percentage point below 28d; declines if >1 point above; otherwise stable. | Phase may alter available sessions. A shortage of long steady rides means limited evidence, not low durability. Meaningful alarms require the sample gates below. S14. |
| **Endurance Decay** | (First-hour power − final-hour power) ÷ first-hour power. | Target <0.05, meaning <5% decline. When measured on the same data, it is mathematically 1 − DI. | Interpret with intended pacing and terrain; it does not diagnose muscular fatigue by itself. S14. |
| **Z2 Stability** | Standard deviation of Z2 power ÷ mean Z2 power across the specified sessions. | Target <0.04, equivalent to <4% relative variability. Exact aggregation implementation is not fully defined here. | Comparability and session intent matter; do not penalize planned variation as poor fitness. S14. |
| **FIR — Fatigue Index Ratio** | Best 20-minute power ÷ best 60-minute power. | Manual target 1.10–1.15. A larger ratio shows a larger short-/long-duration gap; it can also reflect missing maximal long efforts. Neither extreme is automatically a readiness verdict. | Event specificity and training content matter. No separate phase-specific numeric bands. S13. |
| **HRRc — Heart Rate Recovery** | Largest recorded 60-second HR drop after threshold HR has been exceeded for at least about one minute, in bpm. Different from Heart Rate Reserve. | No universal good absolute bpm drop. 7d mean >10% above 28d = improving; within ±10% = stable; >10% below = declining. Needs ≥1 qualifying session in 7d and ≥3 in 28d. | Compare similar effort/recovery conditions. Display/coaching context only, not a readiness input. S14. |
| **Power Curve Delta** | Percentage change in duration-specific MMP between current and previous 28-day windows. | Anchors: 5 s, 60 s, 5 min, 20 min, 60 min. Changes smaller than about ±1.5% are treated as normal variation. No universal required gain. | **Yes.** Which anchors improve should match the phase/event. Observation coverage matters. S14. |
| **Power Rotation Index** | Mean short-duration percentage changes (5 s, 60 s) minus mean long-duration changes (20 min, 60 min). | >+1.0 = sprint-biased shift; −1.0 to +1.0 = balanced/minimal; <−1.0 = endurance-biased shift. Unit is the difference between percentage changes. | Endurance-biased movement can fit Base; sprint-biased movement may fit other objectives. Positive is not automatically better. S14. |
| **HR Curve Delta / HR Rotation Index** | Change in maximum sustained HR at selected durations; rotation compares short versus long changes. | Rotation uses the same ±1.0 descriptive bands. Rising HR can have multiple explanations. No universal favorable direction. | The exported curve mixes sports, so changing sport mix is a confounder. Cross-check output, RPE, resting data, and conditions. S14. |
| **FatOx — Fat Oxidation Trend** | Optional substrate-use / metabolic-efficiency concept. | Manual says “stable or positive” but does not provide an executable formula or sufficient data contract. | Do not infer actual fat oxidation from HR/power alone or invent a numeric score. S13. |

### Aggregate durability: minimum evidence for interpretation

| Use | Required data |
|---|---|
| 7d or 28d mean | At least 2 qualifying sessions in that window |
| Declining-trend warning | 7d mean more than 2 percentage points above 28d; ≥3 sessions in 7d and ≥5 in 28d |
| Persistent elevated-drift alarm | 28d mean >5%; ≥5 sessions in 28d |
| Repeated high-drift count | At least 3 qualifying sessions with >5% drift in 7d |
| Historical weekly rollup | Can show a mean from 1 qualifying session; that does not satisfy the alert-layer sample requirements |

Each qualifying decoupling session needs ≥90 minutes of moving time and 0 < VI ≤1.05. The exact session-duration field and eligibility matter; a rounded 1.50 hours can hide a session shorter than 90 minutes. Source: S2, S5, S14.

## 5. Zones and training-intensity distribution

**Always name the zone system.** “Z2” in a five/seven-zone workout is not Seiler Zone 2.

| Conventional recorded zones | Seiler three-zone grouping | Meaning used by the protocol |
|---|---|---|
| Z1 + Z2 | Seiler Z1 | Easy |
| Z3 | Seiler Z2 | Moderate / tempo / “grey zone” |
| Z4 + Z5 + Z6 + Z7, where available | Seiler Z3 | Hard / quality |

The exporter maps recorded zone times into these groups. It does not calculate them from measured LT1/LT2. Use the recorded power/HR zone basis; mixed aggregates can contain both. Source: S3.

| Metric / shorthand | Definition and unit | Range and interpretation in Section 11 | Does phase change the interpretation? |
|---|---|---|---|
| **TIZ — Time in Zone** | Seconds, minutes, or percentage spent in a named intensity band. | No good/bad value without the band definition, source, denominator, and intended workout. | Strongly tied to session and phase. DFA TIZ uses different bands from power/HR zones. S3, S11. |
| **Easy Time Ratio** | Conventional Z1+Z2 time ÷ total zone time. Ratio 0–1. | Generic target ≥0.80; phase-specific targets below take the purpose further. Do not mistake this for Treff PI. | **Yes.** Lower during harder phases; higher during Recovery. S3, S13. |
| **Grey Zone %** | Conventional Z3 time ÷ total time ×100. | Phase-specific targets and alert levels below. This means moderate-intensity share, not a universal label of wasted training. | **Yes.** The manual tolerates more during Build/Peak than Base/Recovery. S13. |
| **Quality Intensity %** | Conventional Z4–Z7 time ÷ total time ×100. | Targets below. A smaller percentage can still accompany an appropriate number of hard days in a high-volume week. | **Yes.** Recovery requires little quality work; Build/Peak may include more. S13. |
| **Hard Days per Week** | Days containing qualifying hard work, rather than number of hard intervals or sessions. | For ≥10 h/week: Base 1; Build 2; Peak 2–3; Recovery 0 in the detailed table. >3 for ≥2 weeks is a review flag. | Explicitly phase-dependent. The source's general summary conflicts on Recovery; use the conflict note. S13. |
| **TID — Training Intensity Distribution** | The pattern of easy, moderate, and hard training time. | Categories: Base, Polarized, Pyramidal, Threshold, High Intensity. This is a description, not a five-level quality score. | The appropriate pattern depends on phase and purpose. A TID label of Base is not itself the detected training phase. S3. |
| **PI — Treff Polarization Index** | Logarithmic index: log10[(Seiler Z1 ÷ Seiler Z2) × Seiler Z3 ×100], using fractional time. | Compute only for Z1 > Z3 > Z2 and Z3 ≥0.01. For an otherwise qualifying structure with Z2 = 0, the manual substitutes 0.01. PI >2.0 supports the Polarized class. Other structures produce null or another class; PI is not a 0–1 fraction. | Phase influences the desired distribution, not the formula. Null is not a bad score. S3. |
| **TID Drift / PI delta** | Comparison of 7d and 28d TID; PI delta is PI7d − PI28d. | Same category = consistent; different = shifting. Manual's acute-depolarization test: PI7d <2.0 and PI28d ≥2.0. Requires actual non-null indices. | Deload, taper, or a planned training emphasis can explain a shift. Diagnostic only, not a session veto. S3. |
| **Other “Polarization” ratios** | The manual also lists (Z1+Z3)/(2×Z2), normalized share, fused ratio, and combined share. | Their scales and zone labels are not interchangeable. The old theoretical ratio lists >1.0 polarized, roughly 0.7–0.9 pyramidal, <0.6 threshold-heavy; it is explicitly not the TID classifier. | Do not expose one generic “Polarization” tile without identifying formula and zone system. Some definitions are ambiguous; see conflicts. S3. |

### Phase-specific distribution targets

These are copied from the manual's detailed phase tables. They are constraints, not independent additive targets; the final easy + grey + quality allocation must total 100%.

| Phase | Easy Time Ratio, <10 h/week | Grey Zone % target | Grey Zone % alert, sustained ≥2 weeks | Quality Intensity %, <10 h/week | Hard days/week, ≥10 h/week |
|---|---:|---:|---:|---:|---:|
| Base | ≥0.85 | <5% | >8% | 10–15% | 1 |
| Build | ≥0.80 | <8% | >12% | 15–20% | 2 |
| Peak | ≥0.75 | <10% | >15% | 20–25% | 2–3 |
| Recovery | ≥0.95 | <3% | >5% | <5% | 0 |
| Deload | No complete separate table | Not defined separately | Not defined separately | Phase detector expects no hard sessions | 0 |
| Taper / race week | No complete percentage table | Not defined separately | Not defined separately | Use event-specific taper plan | No universal count supplied |

The manual also gives a blanket >8% grey-zone flag and a planning cap of ≤20% hard time, which conflict with parts of this table. Preserve that distinction rather than silently claiming every rule agrees. Source: S13, S17.

## 6. Progression, specificity, and race capability

| Metric / shorthand | Definition and unit | Range and interpretation in Section 11 | Does phase change the interpretation? |
|---|---|---|---|
| **Benchmark Index** | (Current cycling FTP ÷ FTP from 8–12 weeks earlier) −1. Display as %. | Generic: +2–5% progressive; 0–+2% maintenance; −2–0% plateau; below −2% regression. Shared endpoints are not fully resolved. Evaluate no more often than every 4 weeks. | **Strongly.** Use seasonal/phase expectations below; a decline in the off-season is not automatically a problem. S7. |
| **Specificity Volume Ratio** | Race-specific training hours ÷ total training hours, generally over 14–21 days. | Base 0.20–0.40; Build 0.40–0.60; Peak 0.70–0.90. <0.50 within 3 weeks of the goal event is a flag; >0.90 for >2 weeks prompts variety/monotony review. | Explicitly phase-dependent. “Race-specific” must be defined for the actual event; the listed defaults are primarily cycling events. S7, S13. |
| **Specificity Score** | Weighted match between training and target-event demands. Different from the volume ratio. | Build ≥0.70 and Peak ≥0.85 in the specificity table; optional-quality table lists ≥0.85. Full weighting algorithm and score bounds are not supplied. | Yes. Do not fabricate a score or use the volume ratio as its substitute. S7, S13. |
| **Sustainability Profile** | Duration-specific observed and modeled power/HR capability over 42 days. | No single good/bad score. Observed power, configured-FTP duration factors, and CP/W′ model estimates are separate quantities. | Use the event duration and current phase; estimates are context, not guaranteed race pacing. The documented exported sport blocks do not provide a complete triathlon model. S15. |
| **Model divergence %** | (Observed watts − CP-model watts) ÷ model watts ×100. | Positive = observed exceeds model; negative = below. No universal alarm threshold. Training coverage and model assumptions can explain either. | Context-dependent; not direct proof of a fitness gain/loss. S15. |
| **Coverage ratio** | Fraction of sustainability anchors with observed data. Ratio 0–1. | Below 0.50 means the profile is heavily model-dependent. Higher means better coverage, not necessarily better fitness. | Training phase can change which durations have recent observations. S15. |
| **FTP staleness days** | Days since the recorded FTP setting changed. | >60 days is a staleness flag in the profile. It is not the number of days since a verified FTP test and does not prove FTP is wrong. | Testing is not automatically appropriate in Peak/Taper or poor readiness. S12, S15. |
| **W′ depletion / recovery** | Reserve expended, and the time to recover 50% of modeled W′ between intervals. | More depletion = more modeled anaerobic demand. Slower modeled recovery may be informative. No universal good/bad percentage or recovery time is defined. | Relevant to hard sessions; requires credible model inputs. Not intended as an easy-endurance grade. S18. |
| **Anaerobic contribution** | Optional percentage of session TSS attributed to W′ expenditure. | Definition is named but a reproducible attribution method is not provided here. Do not invent a percentage. | Workout-purpose context, not a readiness input. S18. |

### Benchmark Index: phase-specific expectations

| Phase / season in the manual | Expected change |
|---|---:|
| Off-season / after goal event | −5% to −2% |
| Early Base | −2% to +1% |
| Late Base / Build | +2% to +5% |
| Peak / race season | +1% to +3% |
| Transition | −3% to 0% |

Use the actual phase and athlete context, not the calendar month alone. A negative trend lasting >8 weeks outside the expected phase pattern warrants review. Source: S7.

## 7. DFA a1 and threshold-estimate shorthand

These are optional exercise-HRV diagnostics. The manual's quality gates and sport restrictions are essential.

| Metric / shorthand | Definition and unit | Range and interpretation in Section 11 | Does phase change the interpretation? |
|---|---|---|---|
| **DFA a1 / α1** | Detrended Fluctuation Analysis, short-term scaling exponent of heartbeat-interval dynamics. Dimensionless. | >1.00 easy; 0.75–1.00 endurance; 0.50–<0.75 tempo/heavy domain; <0.50 supra-threshold. Lower means greater internal intensity in this model, not poorer fitness. | Interpret against prescription, fatigue, heat, and fueling context. The thresholds are described as cycling-validated; other sports are descriptive only. S11. |
| **easy_guard** | Protocol's conservative easy-state marker at α1 ≈1.00. | Not LT1. Used for easy-state interpretation, not threshold calibration. An endurance ride can legitimately include α1 between 0.75 and 1.00. | Depends on prescribed recovery versus endurance intent. S11. |
| **DFA LT1 estimate** | Empirical estimate associated with α1 ≈0.75. | Needs ≥3 estimate-eligible sessions for a trailing marker estimate. No configured LT1 comparator exists, so no calibration delta can be calculated. | Easy/deload riding may supply no LT1 crossings; that can be expected. S11. |
| **DFA LT2 calibration delta** | Difference between α1 ≈0.50-derived LT2 and the matching configured cycling threshold. | >5% difference is an observation to surface, with ≥4 LT2-eligible sessions; watts require ≥4 in the relevant indoor/outdoor environment. No automatic threshold update. | Not a workout-intensity or readiness override. Formal testing may be inappropriate in Peak/Taper. S11, S12. |
| **DFA drift delta** | Last-third versus first-third change in α1. | Below −0.20 is a drift flag only if drift.interpretable is true. More than 15% of the session above LT2 makes this drift interpretation ineligible. | Session structure and conditions can explain changes. Not a fatigue diagnosis. S11. |
| **DFA valid % / quality** | Share of recorded values passing the exporter’s quality handling. | If quality.sufficient is false, do not interpret. When sufficient: <80% valid reduces confidence; ≥80% allows standard interpretation. The stated minimum duration is 20 min; do not infer eligibility from valid % alone. | No phase-adjusted quality cutoff. Crossing estimates additionally need their own eligibility flags. S11. |
| **DFA marker confidence** | Coarse confidence based on eligible LT1/LT2 session depth. | 3 sessions = low; 4–5 = moderate; ≥6 = high, using the maximum threshold-marker depth. | Not a per-threshold guarantee. A high overall confidence must not substitute for LT2's own sample count. S11. |

## 8. Body weight, fueling, environment, and units

| Metric / shorthand | Definition and unit | Range and interpretation in Section 11 | Does phase change the interpretation? |
|---|---|---|---|
| **W/kg** | Power divided by body mass. Identify whether power means FTP or a duration-specific effort. | No universal good/bad cutoff. Current FTP-based W/kg needs a recent weight (≤14 days old) and a valid power source. | Goal-specific. Never assume a lower weight or higher W/kg is automatically favorable for training. S8, S15. |
| **W/kg block delta** | Exported difference between the beginning/end of the trailing 28-day weight window. | Both endpoints use the **current** FTP, so this field reflects weight change, not combined FTP and weight improvement. No target range. | Retrospective context only; do not present it as total block fitness gain. S8. |
| **Weight 7d mean / 28d slope** | Average weight over 7 days; rate of weight change over 28 days, shown per week. | Mean needs ≥4 weigh-ins/7d; slope needs ≥14/28d. No universal good/bad slope. | Interpret against athlete goals and training demands. No automatic daily-weight readiness judgment. S8. |
| **CHO** | Carbohydrate, generally grams (g), grams/hour (g/h), or grams/kg/day. | Intake is not absorption or oxidation. The manual includes dose guides, but they require duration, intensity, practiced tolerance, and actual plan context; they are not red/green metric bands. | Training/race demand matters more than a generic phase label. Race-week loading is a separate time-limited plan. S10, S16. |
| **kJ / kcal** | Kilojoules of mechanical work / kilocalories of energy. | Average watts × seconds ÷1000 gives mechanical kJ. The manual uses kJ ≈ kcal as a cycling expenditure approximation, not a unit identity or glycogen test. | Demand context, not a score. Do not infer bonking from the difference between energy expenditure and carbohydrate intake. S10. |
| **Fluid / sodium intake** | Fluid volume and sodium amount consumed, often ml/h and mg/h. | No universal good/bad rate. Needs individual sweat information, conditions, practiced tolerance, and availability. Reminder frequency is not a dose. | Event/session-specific. Keep carbohydrate and fluid accounting separate. S10. |
| **WBGT** | Wet Bulb Globe Temperature, an environmental heat-stress measure. | The manual ranks it as an environmental input; it supplies no stand-alone athlete-specific good/bad WBGT scale. | Acclimation, conditions, and session demand matter. Do not assume WBGT, heat index, and air temperature are interchangeable readings. S9. |
| **Heat tier 1 / 2 / 3** | Protocol-specific heat-exposure categories relative to a 14-day outdoor baseline. | Stated deltas: +5–8°C moderate, +8–12°C high, +12°C+ extreme. Boundaries are heuristics and overlap at endpoints; this is not a validated medical score. | Not the training phase. Recent heat exposure and data availability drive the category; see source for full guardrails. S9. |
| **Elevation density** | Elevation gain per distance, canonical m/km. | Route labels: flat <5; rolling ≥5; hilly ≥20 or major categorized climb; mountain ≥30. Higher means hillier, not better/worse. Use the emitted route class because labels overlap by design. | Route-specific and relevant to interpretation of power/HR. S9. |
| **N / n_sessions** | Number of qualifying observations or sessions. | More data may improve confidence, but the minimum depends on the metric. N=0 is no evidence, not zero performance. | Phase can affect which types of sessions qualify. S2, S11, S14. |
| **7d / 14d / 28d / 42d / 90d / 180d** | Observation-window length in days. | These windows answer different questions. Do not compare values as if their windows were identical. | The chosen window affects how fast planned load reductions appear. S2, S14, S15. |
| **Δ / SD / % / pp** | Change / standard deviation / percent / percentage points. “pp” is used in this glossary to clarify absolute differences between percentages. | Units/operators, not metrics with good/bad ranges. | No phase-specific meanings. |
| **bpm / ms / W / J / rpm** | Beats per minute / milliseconds / watts / joules / revolutions per minute. | Units. W measures power; J measures work/energy. | No phase-specific meanings. |

### Heat-category qualifications in the source

The manual adds an apparent-temperature floor: no heat flag below 15°C; above 38°C it assigns Tier 3 regardless of baseline. A reliable relative baseline needs at least 3 qualifying outdoor activities over 14 days. Below that sample count, its fallback bands are 25–30°C for at least Tier 1, 30–35°C for Tier 2, and >35°C for Tier 3. Shared endpoints and differing temperature measures still require implementation clarification. These are source-specific classification conventions, not interchangeable medical thresholds for WBGT, heat index, and air temperature. Source: S9.

## 9. Other shorthand used in the manual

These terms have no numeric good/bad range.

| Shorthand | Meaning / interpretation |
|---|---|
| **SS** | Sweet spot; a workout/adaptation label. This MD does not supply one universal percentage-of-FTP definition for all templates. |
| **WU / CD** | Warm-up / cool-down. |
| **TT** | Time trial. |
| **RACE_A / RACE_B / RACE_C** | Primary goal event / secondary event / training event. Determines taper/race-week handling. |
| **D−7 / D−1 / D0** | Seven days before the event / day before / race day. |
| **DNS** | Did not start; a race participation outcome, not a metric. |
| **GI** | Gastrointestinal; usually symptoms or fueling tolerance. |
| **RR intervals** | Time between successive ECG R peaks / heartbeat intervals used in HRV processing. |
| **HRR** | Ambiguous abbreviation: often heart-rate recovery or heart-rate reserve. Section 11 uses HRRc for the recovery metric; spell it out. |
| **GAP** | Grade-adjusted pace. A pace basis, not a power-zone basis. |
| **NM** | Neuromuscular. |
| **CV / ICC / TEM** | Coefficient of variation / intraclass correlation coefficient / typical error of measurement. Research-quality terms; no athlete readiness bands are supplied. |
| **SpO₂ / BP / Baevsky SI** | Peripheral oxygen saturation / blood pressure / Baevsky Stress Index. Mentioned as optional wellness context. Section 11 supplies no clinical reference ranges and does not include them in its automated readiness calculation. |
| **p25 / p50 / p75** | 25th, 50th (median), and 75th percentiles. Distribution summaries, not good/bad thresholds. |
| **KPI** | Key performance indicator. A goal-relevant measure, not one fixed metric. |
| **AAS** | Adaptive Action Score; an earlier inspiration replaced by the deterministic readiness decision. Do not invent an active AAS score. |
| **RPS** | Randonneur Performance System, a referenced coaching framework. |
| **URF v5.1** | The manual's named rolling-phase framework/version. The full acronym is not expanded in this file. |
| **TRIMP** | Training impulse, a heart-rate-based training-load concept referenced in the evidence framework. No calculation or app thresholds are supplied here. |
| **HC / Cat** | Hors catégorie / climb category. Section 11 uses its own elevation-based route-labeling convention; not a readiness grade. |
| **API / JSON / LLM** | Application programming interface / JavaScript Object Notation / large language model. Technical terms, not athlete metrics. |
| **GPX / TCX / GPS / UTC** | GPS Exchange Format / Training Center XML / Global Positioning System / Coordinated Universal Time. Route, file, or time terminology. |

## 10. Source problems the app should not silently inherit

1. **Several “polarization” measures share similar names.** Easy Time Ratio is a 0–1 share; Treff PI is logarithmic; other ratios use different formulas and sometimes ambiguous zone labels. Store and display them as separate metrics with their zone system.

2. **“Good RI” and a green RI readiness signal are different.** General good readiness begins at 0.80, while the signal table allows green from 0.70 and for a single-day 0.60–<0.70 reading. Progression is a separate, often stricter gate.

3. **DI has several purpose-specific cutoffs.** 0.90, 0.95, and 0.97 must be labeled audit range, quality target, and progression criterion. They are not interchangeable versions of one threshold.

4. **Some metric formulas lack scale or timing.** Load-Recovery Ratio's stated raw-looking formula does not explain its 2.50 cutoff; Load Ratio, Strain, Stress Tolerance, Fatigue Trend, and ramp rate need the actual exported definition/unit before app automation.

5. **Grey-zone and quality rules conflict.** The blanket >8% grey-zone warning differs from phase-specific alerts of >8%, >12%, >15%, and >5%. Peak's 20–25% quality target also conflicts with the plan protocol's ≤20% cap. This glossary exposes the conflict; it does not silently authorize an exception.

6. **Hard-day guidance conflicts.** A summary lists one hard day in “base/recovery”; the detailed high-volume table gives Recovery zero. The separate plan protocol generically prescribes two structured sessions. Do not apply the generic plan structure unchanged across all phases.

7. **Boundary values are not always assigned consistently.** Examples: HRV −10%, RHR small rises, strain exactly 3500, shared IF endpoints, and heat-tier endpoints. The TID classifier uses PI >2, while a drift comparison uses prior PI ≥2. Do not manufacture a missing branch without verifying the implementation.

8. **The manual's hierarchy and readiness counts require care.** It says secondary load metrics should not overrule primary readiness, yet start-of-day ACWR can contribute to P2 signal counting. Live ACWR alerts are explicitly ineligible. Prefer the exported decision/reason and flag implementation contradictions.

9. **Sport coverage is uneven.** Power adherence rules do not supply pace/HR adherence validators. Cycling DFA calibration does not validate running or swimming thresholds. A global mixed-sport HR curve is not the same as a sport-specific HR profile.

10. **Capability is not readiness.** HRRc, power-curve shifts, TID drift, sustainability estimates, and DFA observations cannot be converted directly into Go/Modify/Skip rules. High output does not erase a P0/P1 condition.

11. **Some apparent metrics are only concepts.** FatOx Trend, Specificity Score, and anaerobic TSS contribution lack complete executable definitions in this file. Their names and intended roles can be explained; numeric scores cannot be fabricated.

12. **Weight-driven W/kg change is easy to mislabel.** The exported block endpoints use the same current FTP. Their delta therefore does not measure combined training improvement and weight change.

## 11. Suggested app presentation

For each metric, display:

- Full name and shorthand.
- Value and unit.
- Observation window and sport/basis, where relevant.
- Plain-language meaning.
- Applicable range, explicitly labeled as baseline, target, warning, or progression gate.
- Phase adjustment and the reason it applies.
- Data state: available, insufficient evidence, not applicable, or conflicting definition.

Use **Within range**, **Review**, **Context only**, or **Unavailable** when appropriate. Avoid a blanket “higher is better” rule. In particular, do not color negative TSB red during every Build week, low taper ACWR as failure, high interval RPE as failure, or missing PI as poor training.

Example: **TSB / Form −18 — Build context.** Recent load exceeds longer-term load; interpret with current recovery and the exported readiness decision. This single number does not establish readiness.

## Source references

All references below point to the supplied SECTION_11.md v11.69. Line numbers refer to that exact version. This is a source-based glossary, not a separate scientific validation of every rule.

| Code | Source sections | Lines |
|---|---|---|
| S1 | Changelog sleep-scale correction; Per-Sport Threshold Schema; FTP Governance | 28–30; 300–374; 780–798 |
| S2 | History Data Mirror; Rolling Phase Logic; Phase Detection Criteria | 442–487; 600–668 |
| S3 | Zone Distribution & Polarisation Metrics; Seiler TID; Zone Preference | 669–779 |
| S4 | Data Audit and Validation; Readiness & Recovery Thresholds | 1061–1154 |
| S5 | Readiness Decision; same-day continuation; phase modifiers | 1155–1281 |
| S6 | TSB Interpretation | 1319–1340 |
| S7 | Benchmark Index; adherence; interval evaluation; progression and specificity | 799–841; 874–974; 1341–1502 |
| S8 | Recovery Metrics Integration; Body Weight Handling | 1503–1587 |
| S9 | Environmental Conditions; Route Analysis | 1588–1809 |
| S10 | Nutrition Timing Relative to Terrain; fueling and fluid accounting | 1892–1988 |
| S11 | DFA a1 Protocol | 2138–2283 |
| S12 | Testing Protocol; RPE Expectation Bands; Effort Response | 2284–2406 |
| S13 | Optional Performance Quality; Load Management; Zone Distribution; Periodisation | 2416–2579 |
| S14 | Durability; HRRc; Power Curve Delta; HR Curve Delta | 2580–2785 |
| S15 | Sustainability Profile | 2786–2860 |
| S16 | Race-Week Protocol | 3053–3166 |
| S17 | AI Training Plan Protocol | 3167–3299 |
| S18 | W′ Balance; Metric Evaluation Hierarchy | 2861–2955 |
