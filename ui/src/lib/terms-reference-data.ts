export type MetricTone = "green" | "amber" | "red" | "neutral"

export type MetricBand = {
  status: string
  range: string
  meaning: string
  tone?: MetricTone
}

export type MetricDefinition = {
  id: string
  name: string
  abbreviation?: string
  category?: string
  definition: string
  bands?: MetricBand[]
  phase?: string
  notes?: string[]
}

const band = (
  status: string,
  range: string,
  meaning: string,
  tone: MetricTone = "neutral"
): MetricBand => ({ status, range, meaning, tone })

/**
 * Section 11 v11.69 metric reference. Keep this dictionary presentation-only:
 * readiness and coaching calculations are owned by their existing modules.
 */
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: "acwr",
    name: "Acute:Chronic Workload Ratio",
    abbreviation: "ACWR",
    definition: "Recent training load compared with your longer-term load.",
    bands: [
      band("Neutral", "<0.80", "Reduced recent load; may be expected during taper or recovery."),
      band("Green", "0.80–<1.30", "Within the manual's load reference band.", "green"),
      band("Amber", "1.30–<1.35", "Review recent load progression.", "amber"),
      band("Red", "≥1.35", "Load-report alarm; review recovery, but this does not by itself mean Skip.", "red"),
    ],
    phase:
      "Morning-readiness bands are <1.30 green, 1.30–<1.50 amber, and ≥1.50 red. A P1 Skip also needs a primary recovery warning. Low ACWR during taper is not underperformance.",
    notes: [
      "Live values include today's activities; morning values exclude them.",
      "Never let a completed session's live increase automatically cancel another session.",
    ],
  },
  {
    id: "atl",
    name: "Fatigue / Acute Training Load",
    abbreviation: "ATL",
    definition: "Shorter-term training load.",
    notes: [
      "There is no universal good value. Interpret ATL alongside CTL and recovery; it is not a direct measurement of how tired you feel.",
    ],
  },
  {
    id: "aerobic-durability",
    name: "Aerobic Durability / Cardiac Drift",
    definition:
      "How much heart rate rises relative to power during prolonged steady exercise.",
    bands: [
      band("Green", "<3%", "Stable heart-rate-to-power relationship.", "green"),
      band("Amber", "3–5%", "Review conditions, pacing, and fueling.", "amber"),
      band("Red", ">5%", "Investigate comparable sessions and recovery; not an automatic Skip.", "red"),
    ],
    phase:
      "The 7d/28d metric averages qualifying sessions. A 28d mean >5% needs at least 5 qualifying sessions; a 7d mean >2 percentage points above 28d needs at least 3 sessions in 7d and 5 in 28d.",
    notes: [
      "Requires steady power, VI >0 and ≤1.05, and at least 90 minutes.",
      "Heat can raise drift without a fitness decline; negative drift is not automatically invalid.",
    ],
  },
  {
    id: "benchmark-index",
    name: "Benchmark Index",
    definition: "FTP change relative to 8–12 weeks earlier.",
    notes: [
      "Expected patterns: Late Base/Build +2–5%; Early Base −2–+1%; Peak +1–3%; Transition −3–0%; Off-season −5–−2%.",
      "Outside-pattern trends prompt review, not a session stop.",
    ],
  },
  {
    id: "ctl",
    name: "Fitness / Chronic Training Load",
    abbreviation: "CTL",
    definition: "Longer-term accumulated training load.",
    notes: [
      "There is no universal good value. Rising load often fits Build; a decline during taper or recovery can be appropriate.",
    ],
  },
  {
    id: "di",
    name: "Durability Index",
    abbreviation: "DI",
    definition: "Final-hour average power divided by first-hour average power.",
    notes: [
      "≥0.95 is the quality target; ≥0.97 across at least 3 long rides is a stricter progression criterion.",
      "The audit table separately lists ≥0.90. There is no full amber/red scale.",
    ],
  },
  {
    id: "ef",
    name: "Efficiency Factor",
    abbreviation: "EF",
    definition: "Power relative to heart rate, calculated as NP divided by average HR.",
    notes: [
      "Compare similar cycling sessions; there is no absolute good/bad range.",
      "Eligibility requires at least 20 minutes and steady power.",
    ],
  },
  {
    id: "easy-time-ratio",
    name: "Easy Time Ratio",
    definition: "Proportion of total zone time in conventional Z1–Z2.",
    phase:
      "For plans under 10 hours/week: Base ≥85%; Build ≥80%; Peak ≥75%; Recovery ≥95%. Deload has no separate fixed ratio; Taper/Race week follows the event-specific taper.",
    notes: [
      "A supported target can be shown green. Easy, grey, and quality percentages together must total 100%.",
    ],
  },
  {
    id: "fatigue-index-ratio",
    name: "Fatigue Index Ratio",
    abbreviation: "FIR",
    definition: "Best 20-minute power divided by best 60-minute power.",
    notes: [
      "Reference range is 1.10–1.15. Outside the band can reflect uneven effort coverage; review comparable power data, not automatically recovery.",
    ],
  },
  {
    id: "fatigue-trend",
    name: "Fatigue Trend",
    definition: "Difference between the change in ATL and change in CTL.",
    notes: [
      "The manual reference is −0.20 to +0.20, but its time interval and scaling are underspecified. Keep neutral until implementation confirms them.",
    ],
  },
  {
    id: "ftp",
    name: "Functional Threshold Power",
    abbreviation: "FTP",
    definition: "Your configured threshold power in watts for that sport.",
    notes: [
      "There is no universal good value. Use current sport-specific settings; indoor and outdoor values may differ.",
    ],
  },
  {
    id: "grey-zone",
    name: "Grey Zone %",
    definition: "Proportion of total zone time in conventional Z3, usually moderate or tempo work.",
    phase:
      "For plans under 10 hours/week, target/warning is Base <5%/>8%; Build <8%/>12%; Peak <10%/>15%; Recovery <3%/>5%. Deload and Taper/Race week use no separate fixed band.",
    notes: [
      "Show an amber review warning only after at least 2 consecutive weeks above the phase warning level. No numeric red band is defined.",
    ],
  },
  {
    id: "hard-days",
    name: "Hard Days per Week",
    definition: "Number of days containing qualifying hard work.",
    phase:
      "For plans at least 10 hours/week: Base 1; Build 2; Peak 2–3; Recovery 0; Deload 0 and no hard sessions in the phase detector. Taper/Race week has no universal count.",
    notes: [
      "More than 3 hard days/week for at least 2 weeks warrants review. No numeric red band is defined.",
    ],
  },
  {
    id: "hrv",
    name: "Heart Rate Variability",
    abbreviation: "HRV",
    definition: "Resting beat-to-beat variation compared with your own 7-day baseline.",
    bands: [
      band("Green", "Within ±10% of baseline", "Normal baseline variation.", "green"),
      band("Amber", "About 10–20% below baseline", "Recovery warning; contributes to combined readiness.", "amber"),
      band("Red", ">20% below baseline", "Stronger recovery warning; combined rules determine Modify or Skip.", "red"),
    ],
    phase:
      "Taper/Race week responds to fewer warning signals. A rise >10% above baseline has no defined adverse band; keep it contextual.",
    notes: [
      "Readiness uses resting rMSSD, not interchangeable device HRV measures. Use the exported signal at the shared 10% boundary.",
    ],
  },
  {
    id: "hrrc",
    name: "Heart Rate Recovery",
    abbreviation: "HRRc",
    definition: "Largest qualifying heart-rate drop over 60 seconds after hard work.",
    notes: [
      "Versus the 28d average: 7d >10% higher means improving; within ±10% is stable; >10% lower means declining.",
      "Requires at least 1 session in 7d and 3 in 28d. Review trends, not Skip.",
    ],
  },
  {
    id: "if",
    name: "Intensity Factor",
    abbreviation: "IF",
    definition: "Session intensity relative to the relevant threshold.",
    notes: [
      "1.00 represents threshold-relative intensity. Higher means harder, not better; judge against the planned workout.",
    ],
  },
  {
    id: "quality-intensity",
    name: "Quality Intensity %",
    definition: "Proportion of total zone time in conventional Z4 and above.",
    phase:
      "For plans under 10 hours/week: Base 10–15%; Build 15–20%; Peak 20–25%; Recovery <5%. Deload has no hard sessions; Taper/Race week follows the event-specific taper.",
    notes: [
      "The source's Peak target conflicts with a separate ≤20% planning cap. Keep that conflict contextual until the authoritative rule is resolved. No numeric red band is defined.",
    ],
  },
  {
    id: "load-recovery-ratio",
    name: "Load-Recovery Ratio",
    definition: "Recent load relative to Recovery Index.",
    notes: [
      "The manual lists an alert at ≥2.50 but does not specify the necessary load scaling. Keep neutral unless the existing implementation verifies that scale.",
    ],
  },
  {
    id: "monotony",
    name: "Training Monotony",
    definition: "How similar your daily training loads are across the recent week.",
    bands: [
      band("Green", "<2.30", "Below the warning level.", "green"),
      band("Amber", "2.30–<2.50", "Review the balance of harder, easier, and rest days.", "amber"),
      band("Red", "≥2.50", "Stronger load-pattern warning; review recovery before changing training.", "red"),
    ],
    phase:
      "Uniformly easy days during and just after a deload can elevate Monotony. If weekly load is already substantially reduced, do not add or remove training because of this metric alone.",
  },
  {
    id: "ramp-rate",
    name: "Ramp Rate",
    definition: "How quickly training load is changing.",
    notes: [
      "There is no universal safe band in this manual. Display the actual field's unit; weekly percentage load change and CTL points/week are different.",
    ],
  },
  {
    id: "readiness",
    name: "Training Readiness",
    definition: "The combined assessment of whether to complete, adjust, or skip today's planned training.",
    bands: [
      band("Green", "Go", "Complete the planned session within its existing targets.", "green"),
      band("Amber", "Modify", "Adjust the session according to the reason for reduced readiness.", "amber"),
      band("Red", "Skip", "Skip the planned session; follow the existing readiness recommendation.", "red"),
    ],
    phase:
      "Phase amber-signal thresholds for P2 Modify are Base 2/TSB −15; Build 3/−20; Peak 2/−15; Taper 1/−15 with one red causing Modify; Race week 1/−15 with one red causing Modify; Recovery/Deload 2/−15; Overreached/Unknown 2/−15.",
    notes: [
      "First matching rule wins: P0 RI <0.60 or eligible Tier-1 alarm = Skip; P1 morning ACWR ≥1.50 plus primary recovery warning, TSB <−30 plus HRV down >10%, or RI <0.70 plus a Tier-1 warning/alarm ≥2 days = Skip; P1 TSB <−25 plus HRV down >10% = Modify; P2 two red signals = Skip; otherwise P3 = Go.",
      "A red performance metric, load-report alarm, or missing value does not add a red readiness signal. Race-day participation uses a separate checklist.",
      "Modify direction: sleep only or TSB only usually reduces duration; HRV/RHR/RI reduces intensity; ACWR-driven reduces duration and intensity and caps at Z2; combined triggers reduce both.",
    ],
  },
  {
    id: "rhr",
    name: "Resting Heart Rate",
    abbreviation: "RHR",
    definition: "Resting heart rate compared with your 7-day baseline, in bpm.",
    bands: [
      band("Green", "At or below baseline", "No elevated-RHR warning.", "green"),
      band("Amber", "3–4 bpm above baseline", "Recovery warning; contributes to combined readiness.", "amber"),
      band("Red", "≥5 bpm above baseline", "Stronger recovery warning; combined rules determine the action.", "red"),
    ],
    phase: "The combined response is stricter in Taper/Race week.",
    notes: [
      "Small increases below the amber range have no explicit color rule. Use the existing exported status rather than inventing one.",
    ],
  },
  {
    id: "ri",
    name: "Recovery Index",
    abbreviation: "RI",
    definition: "Recovery relative to your normal HRV and resting heart rate.",
    bands: [
      band("Green", "≥0.70; also a single day at 0.60–<0.70", "No RI-only restriction; overall readiness still applies.", "green"),
      band("Amber", "0.60–<0.70 for ≥2 consecutive days", "Review recovery; contributes to combined readiness. At ≥3 days, review the block's load.", "amber"),
      band("Red", "<0.60", "Skip: explicit P0 stop.", "red"),
    ],
    phase: "RI ≥0.80 is a common progression requirement; some stricter pathways require ≥0.85. Green does not automatically authorize progression.",
  },
  {
    id: "rpe",
    name: "Perceived Exertion",
    abbreviation: "RPE",
    definition: "How hard the session felt, on a 1–10 scale.",
    notes: [
      "There is no universal red value. High RPE is appropriate for hard work; unexpectedly high RPE for easy work is a review signal.",
    ],
  },
  {
    id: "sleep-duration",
    name: "Sleep Duration",
    definition: "Hours slept before the training day.",
    bands: [
      band("Green", "≥7 hours", "Meets the protocol's sleep target.", "green"),
      band("Amber", "5–<7 hours", "Recovery warning; consider less duration if readiness says Modify.", "amber"),
      band("Red", "<5 hours", "Strong warning; combined readiness determines Modify or Skip.", "red"),
    ],
    phase: "More sensitive during Taper/Race week. Race-day sleep alone does not determine whether to start.",
  },
  {
    id: "specificity-volume-ratio",
    name: "Specificity Volume Ratio",
    definition: "Fraction of training hours matching the target event's demands.",
    notes: [
      "Phase references: Base 20–40%; Build 40–60%; Peak 70–90%.",
      "Below 50% within 3 weeks of the event prompts a specificity review; it does not justify cramming extra load.",
    ],
  },
  {
    id: "strain",
    name: "Training Strain",
    definition: "A cumulative training-stress indicator interpreted alongside load and Monotony.",
    bands: [
      band("Green", "<3500", "Below the manual's warning threshold.", "green"),
      band("Amber", "Not defined", "Do not invent an intermediate band."),
      band("Red", ">3500", "Review load and recovery; not an automatic Skip.", "red"),
    ],
    notes: [
      "Use the existing calculated metric. The manual does not fully specify its scale or classify exactly 3500.",
    ],
  },
  {
    id: "stress-tolerance",
    name: "Stress Tolerance",
    definition: "A derived load-capacity indicator based on Strain and Monotony.",
    notes: [
      "Manual reference: <3 limited buffer; 3–6 reference; >6 higher capacity. Calculation depends on the implementation's strain scale; this is not readiness clearance.",
    ],
  },
  {
    id: "tid-pi",
    name: "TID / Polarization Index",
    abbreviation: "TID / PI",
    definition: "The pattern of easy, moderate, and hard training.",
    notes: [
      "PI >2 supports the Polarized classification only when its other structure conditions hold. Other patterns or null values are not automatically bad; desired distribution depends on phase.",
    ],
  },
  {
    id: "tsb",
    name: "Form / Training Stress Balance",
    abbreviation: "TSB",
    definition: "The balance between longer-term fitness load and recent fatigue load.",
    bands: [
      band("Green", "Above −15; above −20 during Build", "Within the phase's readiness band.", "green"),
      band("Amber", "−30 through −15; −30 through −20 during Build", "Accumulated load; evaluate recovery and the combined readiness result.", "amber"),
      band("Red", "Below −30", "High load-related fatigue signal. With HRV down >10%, Skip; otherwise use combined rules.", "red"),
    ],
    phase: "Negative Form can be normal during a build. Positive Form can be intended during taper. Neither direction is inherently good or bad.",
    notes: [
      "A-race targets: +5 to +15 for <90 min; +10 to +20 for 90 min–3 h; +10 to +25 for >3 h. B-race ranges are 5 points lower.",
      "Below-target Form alone is not a DNS instruction.",
    ],
  },
  {
    id: "tss",
    name: "Training Stress Score",
    abbreviation: "TSS",
    definition: "Recorded training load for a session or period.",
    notes: [
      "Compare with the planned session and your baseline. A smaller taper total can be correct.",
    ],
  },
  {
    id: "vi",
    name: "Variability Index",
    abbreviation: "VI",
    definition: "How variable power output was, conventionally NP divided by average power.",
    notes: [
      "VI >0 and ≤1.05 qualifies as steady power for certain analyses. Higher values may be expected in intervals or hilly terrain.",
    ],
  },
  {
    id: "workout-compliance",
    name: "Workout Compliance",
    definition: "How the completed work matched its original prescription.",
    notes: [
      "Requires verified workout pairing. Power tolerance is the greater of ±3 W or ±1%.",
      "Complete work plus ≥95% supported adherence is one progression gate; recovery and phase still apply.",
    ],
  },
  {
    id: "workout-consistency",
    name: "Workout Consistency",
    definition: "The proportion of planned training dates on which an activity was completed.",
    bands: [
      band("Green", "≥90%", "High date match; maintain a workable schedule.", "green"),
      band("Amber", "70–<90%", "Review unmatched dates and adjust scheduling if needed.", "amber"),
      band("Red", "<70%", "Review whether the schedule fits your availability and recovery; not a training stop.", "red"),
    ],
    notes: [
      "This is not workout-quality compliance. Any activity can match a date, and a correctly skipped session can reduce the score.",
    ],
  },
]

const metricCategories: Record<string, string> = {
  readiness: "Readiness",
  ri: "Recovery",
  hrv: "Recovery",
  rhr: "Recovery",
  "sleep-duration": "Recovery",
  "load-recovery-ratio": "Recovery",
  atl: "Load & distribution",
  acwr: "Load & distribution",
  ctl: "Load & distribution",
  monotony: "Load & distribution",
  strain: "Load & distribution",
  tsb: "Load & distribution",
  tss: "Load & distribution",
  "easy-time-ratio": "Intensity distribution",
  "grey-zone": "Intensity distribution",
  "quality-intensity": "Intensity distribution",
  "hard-days": "Intensity distribution",
  "aerobic-durability": "Performance & capacity",
  "benchmark-index": "Performance & capacity",
  di: "Performance & capacity",
  ef: "Performance & capacity",
  "fatigue-index-ratio": "Performance & capacity",
  "fatigue-trend": "Performance & capacity",
  ftp: "Performance & capacity",
  hrrc: "Performance & capacity",
  if: "Performance & capacity",
  "ramp-rate": "Performance & capacity",
  rpe: "Performance & capacity",
  "specificity-volume-ratio": "Performance & capacity",
  "stress-tolerance": "Performance & capacity",
  "tid-pi": "Performance & capacity",
  vi: "Performance & capacity",
  "workout-compliance": "Performance & capacity",
  "workout-consistency": "Performance & capacity",
}

export const SORTED_METRIC_DEFINITIONS = [...METRIC_DEFINITIONS]
  .map((metric) => ({
    ...metric,
    category: metricCategories[metric.id] || "Other training metrics",
  }))
  .sort((a, b) => a.name.localeCompare(b.name))
