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
  aliases?: string[]
  definition: string
  bands?: MetricBand[]
  phase?: string
  notes?: string[]
}

// Presentation-only dictionary transcribed from docs/section-11-reference.md
// (Section 11 v11.69). This file does not calculate or override readiness.
export const METRIC_DEFINITIONS: MetricDefinition[] = [
  {
    id: "ri",
    name: "Recovery Index",
    abbreviation: "RI",
    definition: "Recovery relative to your normal HRV and resting heart rate.",
    bands: [
      {
        status: "Green",
        range: "≥0.70; also a single day at 0.60–<0.70",
        meaning: "No RI-only restriction; overall readiness still applies.",
        tone: "green",
      },
      {
        status: "Amber",
        range: "0.60–<0.70 for ≥2 consecutive days",
        meaning:
          "Review recovery; contributes to combined readiness. At ≥3 days, review the block's load.",
        tone: "amber",
      },
      {
        status: "Red",
        range: "<0.60",
        meaning: "Skip: explicit P0 stop.",
        tone: "red",
      },
    ],
    phase:
      "RI ≥0.80 is a common progression requirement; some stricter pathways require ≥0.85. Green does not automatically authorize progression.",
    category: "Readiness and recovery",
    aliases: ["RI — Recovery Index"],
  },
  {
    id: "hrv",
    name: "Heart Rate Variability",
    abbreviation: "HRV",
    definition:
      "Resting beat-to-beat variation compared with your own 7-day baseline.",
    bands: [
      {
        status: "Green",
        range: "Within ±10% of baseline",
        meaning: "Normal baseline variation.",
        tone: "green",
      },
      {
        status: "Amber",
        range: "About 10–20% below baseline",
        meaning: "Recovery warning; contributes to combined readiness.",
        tone: "amber",
      },
      {
        status: "Red",
        range: ">20% below baseline",
        meaning:
          "Stronger recovery warning; combined rules determine Modify or Skip.",
        tone: "red",
      },
    ],
    phase:
      "Taper/Race week responds to fewer warning signals. A rise >10% above baseline has no defined adverse band; keep it contextual.",
    notes: [
      "Readiness uses resting rMSSD, not interchangeable device HRV measures. Use the exported signal at the shared 10% boundary.",
    ],
    category: "Readiness and recovery",
    aliases: ["HRV — Heart Rate Variability"],
  },
  {
    id: "rmssd-rmssd",
    name: "Root Mean Square of Successive Differences",
    abbreviation: "rMSSD / RMSSD",
    category: "Readiness and recovery",
    aliases: ["rMSSD / RMSSD"],
    definition:
      "Root mean square of successive differences between normal heartbeat intervals; an HRV measure, in ms.",
    phase:
      "No phase-specific numeric scale. Must use compatible resting measurements.",
    notes: [
      "This is the HRV type the protocol expects. No separate universal good/bad range; use the athlete's own baseline.",
    ],
  },
  {
    id: "sdnn",
    name: "Standard Deviation of Normal-to-Normal Intervals",
    abbreviation: "SDNN",
    category: "Readiness and recovery",
    aliases: ["SDNN"],
    definition:
      "Standard deviation of normal-to-normal heartbeat intervals; another HRV measure, in ms.",
    phase: "No phase-specific range.",
    notes: [
      "Not interchangeable with rMSSD. If only SDNN is available, Section 11's rMSSD readiness signal remains unavailable. Do not rescale SDNN into rMSSD.",
    ],
  },
  {
    id: "rhr",
    name: "Resting Heart Rate",
    abbreviation: "RHR",
    definition: "Resting heart rate compared with your 7-day baseline, in bpm.",
    bands: [
      {
        status: "Green",
        range: "At or below baseline",
        meaning: "No elevated-RHR warning.",
        tone: "green",
      },
      {
        status: "Amber",
        range: "3–4 bpm above baseline",
        meaning: "Recovery warning; contributes to combined readiness.",
        tone: "amber",
      },
      {
        status: "Red",
        range: "≥5 bpm above baseline",
        meaning:
          "Stronger recovery warning; combined rules determine the action.",
        tone: "red",
      },
    ],
    phase: "The combined response is stricter in Taper/Race week.",
    notes: [
      "Small increases below the amber range have no explicit color rule. Use the existing exported status rather than inventing one.",
    ],
    category: "Readiness and recovery",
    aliases: ["RHR — Resting Heart Rate"],
  },
  {
    id: "sleep-duration",
    name: "Sleep Duration",
    definition: "Hours slept before the training day.",
    bands: [
      {
        status: "Green",
        range: "≥7 hours",
        meaning: "Meets the protocol's sleep target.",
        tone: "green",
      },
      {
        status: "Amber",
        range: "5–<7 hours",
        meaning:
          "Recovery warning; consider less duration if readiness says Modify.",
        tone: "amber",
      },
      {
        status: "Red",
        range: "<5 hours",
        meaning:
          "Strong warning; combined readiness determines Modify or Skip.",
        tone: "red",
      },
    ],
    phase:
      "More sensitive during Taper/Race week. Race-day sleep alone does not determine whether to start.",
    category: "Readiness and recovery",
    aliases: ["Sleep duration"],
  },
  {
    id: "sleep-quality",
    name: "Sleep quality",
    category: "Readiness and recovery",
    aliases: ["Sleep quality"],
    definition: "Intervals.icu positional sleep-quality rating.",
    phase:
      "Context in every phase; do not score it again on top of sleep duration.",
    notes: [],
    bands: [
      {
        status: "Great",
        range: "1",
        meaning:
          "Subjective or device-derived rating; no extra readiness weight.",
      },
      {
        status: "Good",
        range: "2",
        meaning:
          "Subjective or device-derived rating; no extra readiness weight.",
      },
      {
        status: "Average",
        range: "3",
        meaning:
          "Subjective or device-derived rating; no extra readiness weight.",
      },
      {
        status: "Poor",
        range: "4",
        meaning:
          "Subjective or device-derived rating; no extra readiness weight.",
      },
    ],
  },
  {
    id: "sleep-score",
    name: "Sleep score",
    category: "Readiness and recovery",
    aliases: ["Sleep score"],
    definition: "Device-specific sleep summary, usually 0–100.",
    phase:
      "No phase-specific bands. Device score is context, not a substitute for sleep duration or current athlete state.",
    notes: [
      "Higher generally represents a better device score, but Section 11 defines no cross-device cutoffs. Excluded from readiness scoring.",
    ],
  },
  {
    id: "feel-current-state",
    name: "current state",
    abbreviation: "Feel",
    category: "Readiness and recovery",
    aliases: ["Feel — current state"],
    definition:
      "Athlete's current subjective condition: 1 = Strong, 2 = Good, 3 = Normal, 4 = Poor, 5 = Weak.",
    phase:
      "Context and phase matter, but the same-day absolute at 5 remains. Must be asked when relevant: the sync payload does not supply current Feel. A completed workout's Feel rating is not current Feel.",
    notes: [
      "Lower is better. For a later same-day session: 5 means Skip; 4 defaults to Skip, with a genuinely restorative/technique exception only after clarifying the reason.",
    ],
  },
  {
    id: "rpe",
    name: "Perceived Exertion",
    abbreviation: "RPE",
    definition: "How hard the session felt, on a 1–10 scale.",
    notes: [
      "There is no universal red value. High RPE is appropriate for hard work; unexpectedly high RPE for easy work is a review signal.",
    ],
    category: "Readiness and recovery",
    aliases: ["RPE — Rating of Perceived Exertion"],
  },
  {
    id: "effort-response",
    name: "Effort response",
    category: "Readiness and recovery",
    aliases: ["Effort response"],
    definition:
      "Exported comparison of whole-session RPE with expected RPE for achieved session IF.",
    phase:
      "Positive after deload or in race week is expected. Repeated negative responses during a build deserve context. This field does not directly change readiness.",
    notes: [
      "Positive = below expected band; neutral = within; negative = above. Null = missing/unusable IF or RPE, or IF <0.65, which is intentionally outside coverage.",
    ],
  },
  {
    id: "readiness",
    name: "Training Readiness",
    definition:
      "The combined assessment of whether to complete, adjust, or skip today's planned training.",
    bands: [
      {
        status: "Green",
        range: "Go",
        meaning: "Complete the planned session within its existing targets.",
        tone: "green",
      },
      {
        status: "Amber",
        range: "Modify",
        meaning:
          "Adjust the session according to the reason for reduced readiness.",
        tone: "amber",
      },
      {
        status: "Red",
        range: "Skip",
        meaning:
          "Skip the planned session; follow the existing readiness recommendation.",
        tone: "red",
      },
    ],
    phase:
      "Phase amber-signal thresholds for P2 Modify are Base 2/TSB −15; Build 3/−20; Peak 2/−15; Taper 1/−15 with one red causing Modify; Race week 1/−15 with one red causing Modify; Recovery/Deload 2/−15; Overreached/Unknown 2/−15.",
    notes: [
      "First matching rule wins: P0 RI <0.60 or eligible Tier-1 alarm = Skip; P1 morning ACWR ≥1.50 plus primary recovery warning, TSB <−30 plus HRV down >10%, or RI <0.70 plus a Tier-1 warning/alarm ≥2 days = Skip; P1 TSB <−25 plus HRV down >10% = Modify; P2 two red signals = Skip; otherwise P3 = Go.",
      "A red performance metric, load-report alarm, or missing value does not add a red readiness signal. Race-day participation uses a separate checklist.",
      "Modify direction: sleep only or TSB only usually reduces duration; HRV/RHR/RI reduces intensity; ACWR-driven reduces duration and intensity and caps at Z2; combined triggers reduce both.",
    ],
    category: "Readiness and recovery",
    aliases: ["Readiness decision: P0–P3"],
  },
  {
    id: "tss",
    name: "Training Stress Score",
    abbreviation: "TSS",
    definition: "Recorded training load for a session or period.",
    notes: [
      "Compare with the planned session and your baseline. A smaller taper total can be correct.",
    ],
    category: "Training load, fitness, and fatigue",
    aliases: ["TSS — Training Stress Score"],
  },
  {
    id: "ctl",
    name: "Fitness / Chronic Training Load",
    abbreviation: "CTL",
    definition: "Longer-term accumulated training load.",
    notes: [
      "There is no universal good value. Rising load often fits Build; a decline during taper or recovery can be appropriate.",
    ],
    category: "Training load, fitness, and fatigue",
    aliases: ["CTL — Chronic Training Load"],
  },
  {
    id: "atl",
    name: "Fatigue / Acute Training Load",
    abbreviation: "ATL",
    definition: "Shorter-term training load.",
    notes: [
      "There is no universal good value. Interpret ATL alongside CTL and recovery; it is not a direct measurement of how tired you feel.",
    ],
    category: "Training load, fitness, and fatigue",
    aliases: ["ATL — Acute Training Load"],
  },
  {
    id: "tsb",
    name: "Form / Training Stress Balance",
    abbreviation: "TSB",
    definition:
      "The balance between longer-term fitness load and recent fatigue load.",
    bands: [
      {
        status: "Green",
        range: "Above −15; above −20 during Build",
        meaning: "Within the phase's readiness band.",
        tone: "green",
      },
      {
        status: "Amber",
        range: "−30 through −15; −30 through −20 during Build",
        meaning:
          "Accumulated load; evaluate recovery and the combined readiness result.",
        tone: "amber",
      },
      {
        status: "Red",
        range: "Below −30",
        meaning:
          "High load-related fatigue signal. With HRV down >10%, Skip; otherwise use combined rules.",
        tone: "red",
      },
    ],
    phase:
      "Negative Form can be normal during a build. Positive Form can be intended during taper. Neither direction is inherently good or bad.",
    notes: [
      "A-race targets: +5 to +15 for <90 min; +10 to +20 for 90 min–3 h; +10 to +25 for >3 h. B-race ranges are 5 points lower.",
      "Below-target Form alone is not a DNS instruction.",
    ],
    category: "Training load, fitness, and fatigue",
    aliases: ["TSB — Training Stress Balance / Form"],
  },
  {
    id: "acwr",
    name: "Acute:Chronic Workload Ratio — Live",
    abbreviation: "ACWR",
    definition: "Recent training load compared with your longer-term load.",
    bands: [
      {
        status: "Neutral",
        range: "<0.80",
        meaning:
          "Reduced recent load; may be expected during taper or recovery.",
        tone: "neutral",
      },
      {
        status: "Green",
        range: "0.80–<1.30",
        meaning: "Within the manual's load reference band.",
        tone: "green",
      },
      {
        status: "Amber",
        range: "1.30–<1.35",
        meaning: "Review recent load progression.",
        tone: "amber",
      },
      {
        status: "Red",
        range: "≥1.35",
        meaning:
          "Load-report alarm; review recovery, but this does not by itself mean Skip.",
        tone: "red",
      },
    ],
    phase:
      "Morning-readiness bands are <1.30 green, 1.30–<1.50 amber, and ≥1.50 red. A P1 Skip also needs a primary recovery warning. Low ACWR during taper is not underperformance.",
    notes: [
      "Live values include today's activities; morning values exclude them.",
      "Never let a completed session's live increase automatically cancel another session.",
    ],
    category: "Training load, fitness, and fatigue",
    aliases: ["ACWR — Acute:Chronic Workload Ratio, live"],
  },
  {
    id: "acwr-start-of-day",
    name: "Acute:Chronic Workload Ratio — Start of Day",
    abbreviation: "ACWR",
    category: "Training load, fitness, and fatigue",
    aliases: ["ACWR, start of day"],
    definition:
      "Readiness version of the 7-day/28-day ratio, excluding activities dated today.",
    phase:
      "Phase changes P2 sensitivity. Completing a workout must not make its live ACWR increase automatically veto a second session.",
    notes: [
      "<1.30 green; 1.30–<1.50 amber; ≥1.50 red. An ACWR-driven P1 Skip additionally requires a corroborating primary readiness signal. Otherwise it participates in P2 counting.",
    ],
  },
  {
    id: "acwr-weekly-phase-detector",
    name: "Acute:Chronic Workload Ratio — Weekly Phase Detector",
    abbreviation: "ACWR",
    category: "Training load, fitness, and fatigue",
    aliases: ["ACWR, weekly phase detector"],
    definition:
      "Separate historical ratio from finalized weekly rows: 7-day acute / 21-day chronic.",
    phase:
      "Used to classify phase, not an independent command to skip training.",
    notes: [
      "Overreached classification requires monotony >2.50 and either ACWR ≥1.50, or ACWR ≥1.30 with a rising trend. Do not apply this rule to the live 7/28 metric.",
    ],
  },
  {
    id: "monotony",
    name: "Training Monotony",
    definition:
      "How similar your daily training loads are across the recent week.",
    bands: [
      {
        status: "Green",
        range: "<2.30",
        meaning: "Below the warning level.",
        tone: "green",
      },
      {
        status: "Amber",
        range: "2.30–<2.50",
        meaning: "Review the balance of harder, easier, and rest days.",
        tone: "amber",
      },
      {
        status: "Red",
        range: "≥2.50",
        meaning:
          "Stronger load-pattern warning; review recovery before changing training.",
        tone: "red",
      },
    ],
    phase:
      "Uniformly easy days during and just after a deload can elevate Monotony. If weekly load is already substantially reduced, do not add or remove training because of this metric alone.",
    category: "Training load, fitness, and fatigue",
    aliases: ["Monotony — Training Monotony Index"],
  },
  {
    id: "strain",
    name: "Training Strain",
    definition:
      "A cumulative training-stress indicator interpreted alongside load and Monotony.",
    bands: [
      {
        status: "Green",
        range: "<3500",
        meaning: "Below the manual's warning threshold.",
        tone: "green",
      },
      {
        status: "Red",
        range: ">3500",
        meaning: "Review load and recovery; not an automatic Skip.",
        tone: "red",
      },
    ],
    notes: [
      "Use the existing calculated metric. The manual does not fully specify its scale or classify exactly 3500.",
    ],
    category: "Training load, fitness, and fatigue",
    aliases: ["Strain"],
  },
  {
    id: "load-ratio",
    name: "Load Ratio",
    category: "Training load, fitness, and fatigue",
    aliases: ["Load Ratio"],
    definition: "The manual defines this as Monotony × Mean Load.",
    phase:
      "Context-dependent; no separate phase bands. Definition/scaling needs implementation verification before app coloring.",
    notes: [
      "It is not ACWR and not Load-Recovery Ratio.",
      "<3500 listed as its reference range. Mean Load's units/window are not sufficiently specified to implement a new calculation reliably.",
    ],
  },
  {
    id: "stress-tolerance",
    name: "Stress Tolerance",
    definition:
      "A derived load-capacity indicator based on Strain and Monotony.",
    notes: [
      "Manual reference: <3 limited buffer; 3–6 reference; >6 higher capacity. Calculation depends on the implementation's strain scale; this is not readiness clearance.",
    ],
    category: "Training load, fitness, and fatigue",
    aliases: ["Stress Tolerance"],
  },
  {
    id: "load-recovery-ratio",
    name: "Load-Recovery Ratio",
    definition: "Recent load relative to Recovery Index.",
    notes: [
      "The manual lists an alert at ≥2.50 but does not specify the necessary load scaling. Keep neutral unless the existing implementation verifies that scale.",
    ],
    category: "Training load, fitness, and fatigue",
    aliases: ["Load-Recovery Ratio"],
  },
  {
    id: "fatigue-trend",
    name: "Fatigue Trend",
    definition: "Difference between the change in ATL and change in CTL.",
    notes: [
      "The manual reference is −0.20 to +0.20, but its time interval and scaling are underspecified. Keep neutral until implementation confirms them.",
    ],
    category: "Training load, fitness, and fatigue",
    aliases: ["Fatigue Trend"],
  },
  {
    id: "ramp-rate",
    name: "Ramp Rate",
    definition: "How quickly training load is changing.",
    notes: [
      "There is no universal safe band in this manual. Display the actual field's unit; weekly percentage load change and CTL points/week are different.",
    ],
    category: "Training load, fitness, and fatigue",
    aliases: ["Ramp rate / ΔTSS%"],
  },
  {
    id: "ctl-slope",
    name: "Chronic Training Load Slope",
    abbreviation: "CTL slope",
    category: "Training load, fitness, and fatigue",
    aliases: ["CTL slope"],
    definition: "Direction and rate of CTL change used by phase detection.",
    phase: "Explicitly phase-dependent.",
    notes: [
      "Build evidence includes slope >1.0; Base evidence includes −1.0 to +1.0. These are classifier features, not universal good/bad thresholds; the slope calculation is not fully specified here.",
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
    category: "Thresholds, power, and workout intensity",
    aliases: ["FTP — Functional Threshold Power"],
  },
  {
    id: "eftp-estimated-ftp",
    name: "estimated FTP",
    abbreviation: "eFTP",
    category: "Thresholds, power, and workout intensity",
    aliases: ["eFTP — estimated FTP"],
    definition: "Modeled estimate of threshold power.",
    phase: "Training content and recent maximal efforts affect interpretation.",
    notes: [
      "Separate from the configured FTP.",
      "No absolute good/bad band. Differences from configured FTP are observations to investigate, not automatic setting changes.",
    ],
  },
  {
    id: "indoor-ftp",
    name: "Indoor Functional Threshold Power",
    abbreviation: "Indoor FTP",
    category: "Thresholds, power, and workout intensity",
    aliases: ["Indoor FTP"],
    definition: "Threshold power recorded specifically for indoor training.",
    phase: "Environment-specific, not phase-specific.",
    notes: [
      "No universal difference from outdoor FTP. Use the environment-matched setting where available.",
    ],
  },
  {
    id: "lthr-lactate-threshold-heart-rate",
    name: "Lactate Threshold Heart Rate",
    abbreviation: "LTHR",
    category: "Thresholds, power, and workout intensity",
    aliases: ["LTHR — Lactate Threshold Heart Rate"],
    definition: "Configured threshold HR for a sport, in bpm.",
    phase:
      "Phase may affect measured performance, but thresholds require supported updates, not relabeling.",
    notes: [
      "No universal good/bad number. Running and cycling settings must remain separate.",
    ],
  },
  {
    id: "hrmax-max-hr",
    name: "Maximum Heart Rate",
    abbreviation: "HRmax / Max HR",
    category: "Thresholds, power, and workout intensity",
    aliases: ["HRmax / Max HR"],
    definition: "Maximum heart-rate setting for the relevant sport, in bpm.",
    phase: "No phase-specific target.",
    notes: [
      "No universal performance grade; a larger maximum is not automatically better.",
    ],
  },
  {
    id: "lt1-aet",
    name: "First Lactate Threshold / Aerobic Threshold",
    abbreviation: "LT1 / AeT",
    category: "Thresholds, power, and workout intensity",
    aliases: ["LT1 / AeT"],
    definition:
      "First lactate threshold / aerobic threshold: conceptual boundary between the easy and heavier domains.",
    phase:
      "The training time spent below/above it changes by phase. Do not derive LT1 from FTP or LTHR.",
    notes: [
      "Individual threshold, not a universal wattage, HR, or lactate value. Current sport-threshold JSON carries no configured LT1 field.",
    ],
  },
  {
    id: "lt2-ant",
    name: "Second Lactate Threshold / Anaerobic Threshold",
    abbreviation: "LT2 / AnT",
    category: "Thresholds, power, and workout intensity",
    aliases: ["LT2 / AnT"],
    definition:
      "Second lactate threshold / anaerobic threshold: upper threshold boundary used by the protocol.",
    phase:
      "Workload distribution changes by phase; there is no phase-specific universal threshold value.",
    notes: [
      "Individual threshold. Section 11 uses current sport-specific threshold settings for comparison; DFA calibration is restricted to cycling.",
    ],
  },
  {
    id: "vt1-vt2-hrvt1-hrvt2",
    name: "Ventilatory and Heart Rate Variability Thresholds",
    abbreviation: "VT1 / VT2 / HRVT1 / HRVT2",
    category: "Thresholds, power, and workout intensity",
    aliases: ["VT1 / VT2; HRVT1 / HRVT2"],
    definition:
      "First/second ventilatory thresholds; first/second HRV-derived threshold estimates.",
    phase:
      "No good/bad absolute ranges; sport, method, quality, and calibration matter.",
    notes: [
      "They describe different measurement methods.",
      "Section 11 associates them with the LT1/LT2 domains. Do not assume the methods produce identical measurements in an individual.",
    ],
  },
  {
    id: "mlss-maximal-lactate-steady-state",
    name: "Maximal Lactate Steady State",
    abbreviation: "MLSS",
    category: "Thresholds, power, and workout intensity",
    aliases: ["MLSS — Maximal Lactate Steady State"],
    definition:
      "Exercise-intensity concept used in the manual's FTP-governance discussion.",
    phase: "Not a phase score; do not invent a value from FTP alone.",
    notes: ["No separate MLSS range or field calculation is defined here."],
  },
  {
    id: "cp-critical-power",
    name: "Critical Power",
    abbreviation: "CP",
    category: "Thresholds, power, and workout intensity",
    aliases: ["CP — Critical Power"],
    definition: "Parameter in the power-duration model, in watts.",
    phase: "Goal/duration context matters; not a readiness score.",
    notes: [
      "No universal good/bad value. The sustainability calculation explicitly uses configured FTP as a CP proxy; that does not make FTP and CP interchangeable measurements.",
    ],
  },
  {
    id: "w-w-prime",
    name: "W prime",
    abbreviation: "W′",
    category: "Thresholds, power, and workout intensity",
    aliases: ["W′ — W prime"],
    definition: "Modeled work capacity above CP, in joules or kilojoules.",
    phase:
      "More relevant to hard intervals/surges than easy endurance. Not a primary readiness input.",
    notes: [
      "No universal target. Requires credible power-curve/model inputs. Do not confuse watts (power) with joules (work).",
    ],
  },
  {
    id: "pmax-p-max",
    name: "Maximum Power",
    abbreviation: "Pmax / P_max",
    category: "Thresholds, power, and workout intensity",
    aliases: ["Pmax / P_max"],
    definition: "Maximum/peak power capability estimate, in watts.",
    phase:
      "Event-specific; sprint capacity is not the same as endurance readiness.",
    notes: ["No good/bad bands or complete computation specified."],
  },
  {
    id: "mmp-mean-maximal-power",
    name: "Mean Maximal Power",
    abbreviation: "MMP",
    category: "Thresholds, power, and workout intensity",
    aliases: ["MMP — Mean Maximal Power"],
    definition:
      "Highest observed average power for a specified duration, in watts.",
    phase: "Compare the duration relevant to the phase and event.",
    notes: [
      "Always attach the duration and observation window. No universal good value; a lower observed best can reflect fewer maximal efforts.",
    ],
  },
  {
    id: "map-maximal-aerobic-power",
    name: "Maximal Aerobic Power",
    abbreviation: "MAP",
    category: "Thresholds, power, and workout intensity",
    aliases: ["MAP — Maximal Aerobic Power"],
    definition: "Aerobic-power capability label.",
    phase:
      "Useful in the appropriate training context, not a standalone readiness verdict.",
    notes: [
      "The power-curve section uses the 5-minute anchor as an MAP-related signal.",
      "No universal band. An observed 5-minute MMP is not itself a direct laboratory MAP measurement.",
    ],
  },
  {
    id: "vo2max",
    name: "Maximal Oxygen Uptake",
    abbreviation: "VO₂max / VO2max",
    category: "Thresholds, power, and workout intensity",
    aliases: ["VO₂max"],
    definition:
      "Maximal oxygen uptake; relative values commonly use ml/kg/min.",
    phase: "Capability context only; no phase-specific universal score.",
    notes: [
      "No age/sex-specific good/bad table is supplied. Preserve the actual measurement/estimate source.",
    ],
  },
  {
    id: "ap-avg-power",
    name: "Average Power",
    abbreviation: "AP / Avg Power",
    category: "Thresholds, power, and workout intensity",
    aliases: ["AP / Avg Power"],
    definition:
      "Arithmetic average power over the relevant session or work segment, in watts.",
    phase: "Target depends on workout and phase.",
    notes: [
      "Compare the correct segment against its prescription. A session average includes easier warm-up/recovery time and cannot grade the work intervals.",
    ],
  },
  {
    id: "np-normalized-power",
    name: "Normalized Power",
    abbreviation: "NP",
    category: "Thresholds, power, and workout intensity",
    aliases: ["NP — Normalized Power"],
    definition:
      "Weighted power metric used to describe variable effort, in watts.",
    phase:
      "Workout/terrain context matters. Do not use NP × time to calculate mechanical work; use average power.",
    notes: [
      "No absolute good/bad range. Used in EF and session-load context; not proof that prescribed intervals were completed.",
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
    category: "Thresholds, power, and workout intensity",
    aliases: ["IF — Intensity Factor"],
  },
  {
    id: "vi",
    name: "Variability Index",
    abbreviation: "VI",
    definition:
      "How variable power output was, conventionally NP divided by average power.",
    notes: [
      "VI >0 and ≤1.05 qualifies as steady power for certain analyses. Higher values may be expected in intervals or hilly terrain.",
    ],
    category: "Thresholds, power, and workout intensity",
    aliases: ["VI — Variability Index"],
  },
  {
    id: "cadence",
    name: "Cadence",
    category: "Thresholds, power, and workout intensity",
    aliases: ["Cadence"],
    definition:
      "Cycling pedal revolutions per minute (rpm), where that is the activity's cadence basis.",
    phase: "Workout-specific, not a generic phase target.",
    notes: [
      "No universal good/bad cadence band in the manual. Respect prescribed cadence/technique requirements when present.",
    ],
  },
  {
    id: "full-set-completion",
    name: "Full-set completion",
    category: "Workout execution, durability, and adaptation",
    aliases: ["Full-set completion"],
    definition:
      "Whether all prescribed main-work steps were completed on the prescription's time/distance/repetition basis.",
    phase:
      "The prescribed session changes with phase; the meaning of completion does not. Requires verified pairing with the original prescription.",
    notes: [
      "True, false, or unavailable. No invented completion tolerance. Partial completion is not a target-adherence percentage.",
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
    category: "Workout execution, durability, and adaptation",
    aliases: ["Target adherence / compliance"],
  },
  {
    id: "workout-consistency",
    name: "Workout Consistency",
    definition:
      "The proportion of planned training dates on which an activity was completed.",
    bands: [
      {
        status: "Green",
        range: "≥90%",
        meaning: "High date match; maintain a workable schedule.",
        tone: "green",
      },
      {
        status: "Amber",
        range: "70–<90%",
        meaning: "Review unmatched dates and adjust scheduling if needed.",
        tone: "amber",
      },
      {
        status: "Red",
        range: "<70%",
        meaning:
          "Review whether the schedule fits your availability and recovery; not a training stop.",
        tone: "red",
      },
    ],
    notes: [
      "This is not workout-quality compliance. Any activity can match a date, and a correctly skipped session can reduce the score.",
    ],
    category: "Workout execution, durability, and adaptation",
    aliases: ["Consistency Index"],
  },
  {
    id: "ef",
    name: "Efficiency Factor",
    abbreviation: "EF",
    definition:
      "Power relative to heart rate, calculated as NP divided by average HR.",
    notes: [
      "Compare similar cycling sessions; there is no absolute good/bad range.",
      "Eligibility requires at least 20 minutes and steady power.",
    ],
    category: "Workout execution, durability, and adaptation",
    aliases: ["EF — Efficiency Factor"],
  },
  {
    id: "di",
    name: "Durability Index",
    abbreviation: "DI",
    definition: "Final-hour average power divided by first-hour average power.",
    notes: [
      "Interpret with pacing, terrain and session intent. These benchmarks serve different purposes.",
    ],
    category: "Workout execution, durability, and adaptation",
    aliases: ["DI — Durability Index"],
    bands: [
      {
        status: "Audit",
        range: "≥0.90",
        meaning: "Broad audit reference.",
      },
      {
        status: "Quality",
        range: "≥0.95",
        meaning: "Optional quality target.",
      },
      {
        status: "Progression",
        range: "≥0.97",
        meaning:
          "Requires at least 3 long rides; recovery and other progression gates still apply.",
      },
    ],
  },
  {
    id: "hr-power-decoupling-cardiac-drift",
    name: "HR–power decoupling / cardiac drift",
    category: "Workout execution, durability, and adaptation",
    aliases: ["HR–power decoupling / cardiac drift"],
    definition:
      "Change in the HR-to-power relationship between the first and second halves, expressed as %.",
    phase:
      "Heat, hydration, terrain, cooling, duration, and session structure affect it. Not a direct dehydration diagnosis. Negative values can occur and are not inherently invalid.",
    notes: [
      "Formula: [(HR₂ ÷ P₂) ÷ (HR₁ ÷ P₁) − 1] × 100. General target <5%; stricter progression guidance uses <3%. Individual-session interpretation requires ≥90 min and 0 < VI ≤1.05.",
    ],
  },
  {
    id: "aerobic-durability",
    name: "Aggregate Aerobic Durability",
    definition:
      "Mean heart-rate-to-power decoupling across qualifying steady sessions over 7 or 28 days.",
    bands: [
      {
        status: "Green",
        range: "<3%",
        meaning: "Stable heart-rate-to-power relationship.",
        tone: "green",
      },
      {
        status: "Amber",
        range: "3–5%",
        meaning: "Review conditions, pacing, and fueling.",
        tone: "amber",
      },
      {
        status: "Red",
        range: ">5%",
        meaning:
          "Investigate comparable sessions and recovery; not an automatic Skip.",
        tone: "red",
      },
    ],
    phase:
      "The 7d/28d metric averages qualifying sessions. A 28d mean >5% needs at least 5 qualifying sessions; a 7d mean >2 percentage points above 28d needs at least 3 sessions in 7d and 5 in 28d.",
    notes: [
      "Requires steady power, VI >0 and ≤1.05, and at least 90 minutes.",
      "Heat can raise drift without a fitness decline; negative drift is not automatically invalid.",
    ],
    category: "Workout execution, durability, and adaptation",
    aliases: ["Aggregate durability, 7d / 28d"],
  },
  {
    id: "endurance-decay",
    name: "Endurance Decay",
    category: "Workout execution, durability, and adaptation",
    aliases: ["Endurance Decay"],
    definition: "(First-hour power − final-hour power) ÷ first-hour power.",
    phase:
      "Interpret with intended pacing and terrain; it does not diagnose muscular fatigue by itself.",
    notes: [
      "Target <0.05, meaning <5% decline. When measured on the same data, it is mathematically 1 − DI.",
    ],
  },
  {
    id: "z2-stability",
    name: "Z2 Stability",
    category: "Workout execution, durability, and adaptation",
    aliases: ["Z2 Stability"],
    definition:
      "Standard deviation of Z2 power ÷ mean Z2 power across the specified sessions.",
    phase:
      "Comparability and session intent matter; do not penalize planned variation as poor fitness.",
    notes: [
      "Target <0.04, equivalent to <4% relative variability. Exact aggregation implementation is not fully defined here.",
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
    category: "Workout execution, durability, and adaptation",
    aliases: ["FIR — Fatigue Index Ratio"],
  },
  {
    id: "hrrc",
    name: "Heart Rate Recovery",
    abbreviation: "HRRc",
    definition:
      "Largest qualifying heart-rate drop over 60 seconds after hard work.",
    notes: [
      "Versus the 28d average: 7d >10% higher means improving; within ±10% is stable; >10% lower means declining.",
      "Requires at least 1 session in 7d and 3 in 28d. Review trends, not Skip.",
    ],
    category: "Workout execution, durability, and adaptation",
    aliases: ["HRRc — Heart Rate Recovery"],
  },
  {
    id: "power-curve-delta",
    name: "Power Curve Delta",
    category: "Workout execution, durability, and adaptation",
    aliases: ["Power Curve Delta"],
    definition:
      "Percentage change in duration-specific MMP between current and previous 28-day windows.",
    phase:
      "Yes. Which anchors improve should match the phase/event. Observation coverage matters.",
    notes: [
      "Anchors: 5 s, 60 s, 5 min, 20 min, 60 min. Changes smaller than about ±1.5% are treated as normal variation. No universal required gain.",
    ],
  },
  {
    id: "power-rotation-index",
    name: "Power Rotation Index",
    category: "Workout execution, durability, and adaptation",
    aliases: ["Power Rotation Index"],
    definition:
      "Mean short-duration percentage changes (5 s, 60 s) minus mean long-duration changes (20 min, 60 min).",
    phase:
      "Endurance-biased movement can fit Base; sprint-biased movement may fit other objectives. Positive is not automatically better.",
    notes: [
      ">+1.0 = sprint-biased shift; −1.0 to +1.0 = balanced/minimal; <−1.0 = endurance-biased shift. Unit is the difference between percentage changes.",
    ],
  },
  {
    id: "hr-curve-delta-hr-rotation-index",
    name: "HR Curve Delta / HR Rotation Index",
    category: "Workout execution, durability, and adaptation",
    aliases: ["HR Curve Delta / HR Rotation Index"],
    definition:
      "Change in maximum sustained HR at selected durations; rotation compares short versus long changes.",
    phase:
      "The exported curve mixes sports, so changing sport mix is a confounder. Cross-check output, RPE, resting data, and conditions.",
    notes: [
      "Rotation uses the same ±1.0 descriptive bands. Rising HR can have multiple explanations. No universal favorable direction.",
    ],
  },
  {
    id: "fatox-fat-oxidation-trend",
    name: "Fat Oxidation Trend",
    abbreviation: "FatOx",
    category: "Workout execution, durability, and adaptation",
    aliases: ["FatOx — Fat Oxidation Trend"],
    definition: "Optional substrate-use / metabolic-efficiency concept.",
    phase:
      "Do not infer actual fat oxidation from HR/power alone or invent a numeric score.",
    notes: [
      "Manual says “stable or positive” but does not provide an executable formula or sufficient data contract.",
    ],
  },
  {
    id: "tiz-time-in-zone",
    name: "Time in Zone",
    abbreviation: "TIZ",
    category: "Zones and training-intensity distribution",
    aliases: ["TIZ — Time in Zone"],
    definition:
      "Seconds, minutes, or percentage spent in a named intensity band.",
    phase:
      "Strongly tied to session and phase. DFA TIZ uses different bands from power/HR zones.",
    notes: [
      "No good/bad value without the band definition, source, denominator, and intended workout.",
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
    category: "Zones and training-intensity distribution",
    aliases: ["Easy Time Ratio"],
  },
  {
    id: "grey-zone",
    name: "Grey Zone %",
    definition:
      "Proportion of total zone time in conventional Z3, usually moderate or tempo work.",
    phase:
      "For plans under 10 hours/week, target/warning is Base <5%/>8%; Build <8%/>12%; Peak <10%/>15%; Recovery <3%/>5%. Deload and Taper/Race week use no separate fixed band.",
    notes: [
      "Show an amber review warning only after at least 2 consecutive weeks above the phase warning level. No numeric red band is defined.",
    ],
    category: "Zones and training-intensity distribution",
    aliases: ["Grey Zone %"],
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
    category: "Zones and training-intensity distribution",
    aliases: ["Quality Intensity %"],
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
    category: "Zones and training-intensity distribution",
    aliases: ["Hard Days per Week"],
  },
  {
    id: "tid-pi",
    name: "Training Intensity Distribution",
    abbreviation: "TID",
    definition: "The pattern of easy, moderate, and hard training.",
    notes: [
      "Categories: Base, Polarized, Pyramidal, Threshold, High Intensity. This is a description, not a five-level quality score.",
    ],
    category: "Zones and training-intensity distribution",
    aliases: ["TID — Training Intensity Distribution"],
  },
  {
    id: "pi-treff-polarization-index",
    name: "Treff Polarization Index",
    abbreviation: "PI",
    category: "Zones and training-intensity distribution",
    aliases: ["PI — Treff Polarization Index"],
    definition:
      "Logarithmic index: log10[(Seiler Z1 ÷ Seiler Z2) × Seiler Z3 ×100], using fractional time.",
    phase:
      "Phase influences the desired distribution, not the formula. Null is not a bad score.",
    notes: [
      "Compute only for Z1 > Z3 > Z2 and Z3 ≥0.01. For an otherwise qualifying structure with Z2 = 0, the manual substitutes 0.01. PI >2.0 supports the Polarized class. Other structures produce null or another class; PI is not a 0–1 fraction.",
    ],
  },
  {
    id: "tid-drift-pi-delta",
    name: "TID Drift / PI delta",
    category: "Zones and training-intensity distribution",
    aliases: ["TID Drift / PI delta"],
    definition: "Comparison of 7d and 28d TID; PI delta is PI7d − PI28d.",
    phase:
      "Deload, taper, or a planned training emphasis can explain a shift. Diagnostic only, not a session veto.",
    notes: [
      "Same category = consistent; different = shifting. Manual's acute-depolarization test: PI7d <2.0 and PI28d ≥2.0. Requires actual non-null indices.",
    ],
  },
  {
    id: "other-polarization-ratios",
    name: "Other “Polarization” ratios",
    category: "Zones and training-intensity distribution",
    aliases: ["Other “Polarization” ratios"],
    definition:
      "The manual also lists (Z1+Z3)/(2×Z2), normalized share, fused ratio, and combined share.",
    phase:
      "Do not expose one generic “Polarization” tile without identifying formula and zone system. Some definitions are ambiguous; see conflicts.",
    notes: [
      "Their scales and zone labels are not interchangeable. The old theoretical ratio lists >1.0 polarized, roughly 0.7–0.9 pyramidal, <0.6 threshold-heavy; it is explicitly not the TID classifier.",
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
    category: "Progression, specificity, and race capability",
    aliases: ["Benchmark Index"],
  },
  {
    id: "specificity-volume-ratio",
    name: "Specificity Volume Ratio",
    definition:
      "Fraction of training hours matching the target event's demands.",
    notes: [
      "Phase references: Base 20–40%; Build 40–60%; Peak 70–90%.",
      "Below 50% within 3 weeks of the event prompts a specificity review; it does not justify cramming extra load.",
    ],
    category: "Progression, specificity, and race capability",
    aliases: ["Specificity Volume Ratio"],
  },
  {
    id: "specificity-score",
    name: "Specificity Score",
    category: "Progression, specificity, and race capability",
    aliases: ["Specificity Score"],
    definition: "Weighted match between training and target-event demands.",
    phase:
      "Yes. Do not fabricate a score or use the volume ratio as its substitute.",
    notes: [
      "Different from the volume ratio.",
      "Build ≥0.70 and Peak ≥0.85 in the specificity table; optional-quality table lists ≥0.85. Full weighting algorithm and score bounds are not supplied.",
    ],
  },
  {
    id: "sustainability-profile",
    name: "Sustainability Profile",
    category: "Progression, specificity, and race capability",
    aliases: ["Sustainability Profile"],
    definition:
      "Duration-specific observed and modeled power/HR capability over 42 days.",
    phase:
      "Use the event duration and current phase; estimates are context, not guaranteed race pacing. The documented exported sport blocks do not provide a complete triathlon model.",
    notes: [
      "No single good/bad score. Observed power, configured-FTP duration factors, and CP/W′ model estimates are separate quantities.",
    ],
  },
  {
    id: "model-divergence",
    name: "Model divergence %",
    category: "Progression, specificity, and race capability",
    aliases: ["Model divergence %"],
    definition: "(Observed watts − CP-model watts) ÷ model watts ×100.",
    phase: "Context-dependent; not direct proof of a fitness gain/loss.",
    notes: [
      "Positive = observed exceeds model; negative = below. No universal alarm threshold. Training coverage and model assumptions can explain either.",
    ],
  },
  {
    id: "coverage-ratio",
    name: "Coverage ratio",
    category: "Progression, specificity, and race capability",
    aliases: ["Coverage ratio"],
    definition: "Fraction of sustainability anchors with observed data.",
    phase:
      "Training phase can change which durations have recent observations.",
    notes: [
      "Ratio 0–1.",
      "Below 0.50 means the profile is heavily model-dependent. Higher means better coverage, not necessarily better fitness.",
    ],
  },
  {
    id: "ftp-staleness-days",
    name: "FTP staleness days",
    category: "Progression, specificity, and race capability",
    aliases: ["FTP staleness days"],
    definition: "Days since the recorded FTP setting changed.",
    phase:
      "Testing is not automatically appropriate in Peak/Taper or poor readiness.",
    notes: [
      ">60 days is a staleness flag in the profile. It is not the number of days since a verified FTP test and does not prove FTP is wrong.",
    ],
  },
  {
    id: "w-depletion-recovery",
    name: "W′ depletion / recovery",
    category: "Progression, specificity, and race capability",
    aliases: ["W′ depletion / recovery"],
    definition:
      "Reserve expended, and the time to recover 50% of modeled W′ between intervals.",
    phase:
      "Relevant to hard sessions; requires credible model inputs. Not intended as an easy-endurance grade.",
    notes: [
      "More depletion = more modeled anaerobic demand. Slower modeled recovery may be informative. No universal good/bad percentage or recovery time is defined.",
    ],
  },
  {
    id: "anaerobic-contribution",
    name: "Anaerobic contribution",
    category: "Progression, specificity, and race capability",
    aliases: ["Anaerobic contribution"],
    definition:
      "Optional percentage of session TSS attributed to W′ expenditure.",
    phase: "Workout-purpose context, not a readiness input.",
    notes: [
      "Definition is named but a reproducible attribution method is not provided here. Do not invent a percentage.",
    ],
  },
  {
    id: "dfa-a1-1",
    name: "Detrended Fluctuation Analysis — Short-Term Scaling Exponent",
    abbreviation: "DFA a1 / α1",
    category: "DFA a1 and threshold-estimate shorthand",
    aliases: ["DFA a1 / α1", "DFA alpha 1", "DFA alpha1", "DFA a1"],
    definition:
      "Detrended Fluctuation Analysis, short-term scaling exponent of heartbeat-interval dynamics.",
    phase:
      "Interpret against prescription, fatigue, heat, and fueling context. The thresholds are described as cycling-validated; other sports are descriptive only.",
    notes: [
      "Lower values indicate greater internal intensity in this model, not poorer fitness.",
    ],
    bands: [
      {
        status: "Easy",
        range: ">1.00",
        meaning: "Easy-state domain.",
      },
      {
        status: "Endurance",
        range: "0.75–1.00",
        meaning: "Endurance domain.",
      },
      {
        status: "Tempo",
        range: "0.50–<0.75",
        meaning: "Tempo / heavy domain.",
      },
      {
        status: "Supra-threshold",
        range: "<0.50",
        meaning: "Higher internal intensity; not a readiness verdict.",
      },
    ],
  },
  {
    id: "easy-guard",
    name: "DFA Easy-State Marker",
    abbreviation: "easy_guard",
    category: "DFA a1 and threshold-estimate shorthand",
    aliases: ["easy_guard"],
    definition: "Protocol's conservative easy-state marker at α1 ≈1.00.",
    phase: "Depends on prescribed recovery versus endurance intent.",
    notes: [
      "Not LT1. Used for easy-state interpretation, not threshold calibration. An endurance ride can legitimately include α1 between 0.75 and 1.00.",
    ],
  },
  {
    id: "dfa-lt1-estimate",
    name: "DFA LT1 estimate",
    category: "DFA a1 and threshold-estimate shorthand",
    aliases: ["DFA LT1 estimate"],
    definition: "Empirical estimate associated with α1 ≈0.75.",
    phase:
      "Easy/deload riding may supply no LT1 crossings; that can be expected.",
    notes: [
      "Needs ≥3 estimate-eligible sessions for a trailing marker estimate. No configured LT1 comparator exists, so no calibration delta can be calculated.",
    ],
  },
  {
    id: "dfa-lt2-calibration-delta",
    name: "DFA LT2 calibration delta",
    category: "DFA a1 and threshold-estimate shorthand",
    aliases: ["DFA LT2 calibration delta"],
    definition:
      "Difference between α1 ≈0.50-derived LT2 and the matching configured cycling threshold.",
    phase:
      "Not a workout-intensity or readiness override. Formal testing may be inappropriate in Peak/Taper.",
    notes: [
      ">5% difference is an observation to surface, with ≥4 LT2-eligible sessions; watts require ≥4 in the relevant indoor/outdoor environment. No automatic threshold update.",
    ],
  },
  {
    id: "dfa-drift-delta",
    name: "DFA drift delta",
    category: "DFA a1 and threshold-estimate shorthand",
    aliases: ["DFA drift delta"],
    definition: "Last-third versus first-third change in α1.",
    phase:
      "Session structure and conditions can explain changes. Not a fatigue diagnosis.",
    notes: [
      "Below −0.20 is a drift flag only if drift.interpretable is true. More than 15% of the session above LT2 makes this drift interpretation ineligible.",
    ],
  },
  {
    id: "dfa-valid-quality",
    name: "DFA valid % / quality",
    category: "DFA a1 and threshold-estimate shorthand",
    aliases: ["DFA valid % / quality"],
    definition:
      "Share of recorded values passing the exporter’s quality handling.",
    phase:
      "No phase-adjusted quality cutoff. Crossing estimates additionally need their own eligibility flags.",
    notes: [
      "If quality.sufficient is false, do not interpret. When sufficient: <80% valid reduces confidence; ≥80% allows standard interpretation. The stated minimum duration is 20 min; do not infer eligibility from valid % alone.",
    ],
  },
  {
    id: "dfa-marker-confidence",
    name: "DFA marker confidence",
    category: "DFA a1 and threshold-estimate shorthand",
    aliases: ["DFA marker confidence"],
    definition: "Coarse confidence based on eligible LT1/LT2 session depth.",
    phase:
      "Not a per-threshold guarantee. A high overall confidence must not substitute for LT2's own sample count.",
    notes: [
      "3 sessions = low; 4–5 = moderate; ≥6 = high, using the maximum threshold-marker depth.",
    ],
  },
  {
    id: "w-kg",
    name: "Power-to-Weight Ratio",
    abbreviation: "W/kg",
    category: "Body weight, fueling, environment, and units",
    aliases: ["W/kg"],
    definition: "Power divided by body mass.",
    phase:
      "Goal-specific. Never assume a lower weight or higher W/kg is automatically favorable for training.",
    notes: [
      "Identify whether power means FTP or a duration-specific effort.",
      "No universal good/bad cutoff. Current FTP-based W/kg needs a recent weight (≤14 days old) and a valid power source.",
    ],
  },
  {
    id: "w-kg-block-delta",
    name: "W/kg block delta",
    category: "Body weight, fueling, environment, and units",
    aliases: ["W/kg block delta"],
    definition:
      "Exported difference between the beginning/end of the trailing 28-day weight window.",
    phase:
      "Retrospective context only; do not present it as total block fitness gain.",
    notes: [
      "Both endpoints use the current FTP, so this field reflects weight change, not combined FTP and weight improvement. No target range.",
    ],
  },
  {
    id: "weight-7d-mean-28d-slope",
    name: "Weight 7d mean / 28d slope",
    category: "Body weight, fueling, environment, and units",
    aliases: ["Weight 7d mean / 28d slope"],
    definition:
      "Average weight over 7 days; rate of weight change over 28 days, shown per week.",
    phase:
      "Interpret against athlete goals and training demands. No automatic daily-weight readiness judgment.",
    notes: [
      "Mean needs ≥4 weigh-ins/7d; slope needs ≥14/28d. No universal good/bad slope.",
    ],
  },
  {
    id: "cho",
    name: "Carbohydrate",
    abbreviation: "CHO",
    category: "Body weight, fueling, environment, and units",
    aliases: ["CHO"],
    definition:
      "Carbohydrate, generally grams (g), grams/hour (g/h), or grams/kg/day.",
    phase:
      "Training/race demand matters more than a generic phase label. Race-week loading is a separate time-limited plan.",
    notes: [
      "Intake is not absorption or oxidation. The manual includes dose guides, but they require duration, intensity, practiced tolerance, and actual plan context; they are not red/green metric bands.",
    ],
  },
  {
    id: "kj-kcal",
    name: "Mechanical Work and Energy",
    abbreviation: "kJ / kcal",
    category: "Body weight, fueling, environment, and units",
    aliases: ["kJ / kcal"],
    definition: "Kilojoules of mechanical work / kilocalories of energy.",
    phase:
      "Demand context, not a score. Do not infer bonking from the difference between energy expenditure and carbohydrate intake.",
    notes: [
      "Average watts × seconds ÷1000 gives mechanical kJ. The manual uses kJ ≈ kcal as a cycling expenditure approximation, not a unit identity or glycogen test.",
    ],
  },
  {
    id: "fluid-sodium-intake",
    name: "Fluid / sodium intake",
    category: "Body weight, fueling, environment, and units",
    aliases: ["Fluid / sodium intake"],
    definition: "Fluid volume and sodium amount consumed, often ml/h and mg/h.",
    phase:
      "Event/session-specific. Keep carbohydrate and fluid accounting separate.",
    notes: [
      "No universal good/bad rate. Needs individual sweat information, conditions, practiced tolerance, and availability. Reminder frequency is not a dose.",
    ],
  },
  {
    id: "wbgt",
    name: "Wet Bulb Globe Temperature",
    abbreviation: "WBGT",
    category: "Body weight, fueling, environment, and units",
    aliases: ["WBGT"],
    definition:
      "Wet Bulb Globe Temperature, an environmental heat-stress measure.",
    phase:
      "Acclimation, conditions, and session demand matter. Do not assume WBGT, heat index, and air temperature are interchangeable readings.",
    notes: [
      "The manual ranks it as an environmental input; it supplies no stand-alone athlete-specific good/bad WBGT scale.",
    ],
  },
  {
    id: "heat-tier-1-2-3",
    name: "Heat tier 1 / 2 / 3",
    category: "Body weight, fueling, environment, and units",
    aliases: ["Heat tier 1 / 2 / 3"],
    definition:
      "Protocol-specific heat-exposure categories relative to a 14-day outdoor baseline.",
    phase:
      "Not the training phase. Recent heat exposure and data availability drive the category; see source for full guardrails.",
    notes: [
      "Stated deltas: +5–8°C moderate, +8–12°C high, +12°C+ extreme. Boundaries are heuristics and overlap at endpoints; this is not a validated medical score.",
    ],
  },
  {
    id: "elevation-density",
    name: "Elevation density",
    category: "Body weight, fueling, environment, and units",
    aliases: ["Elevation density"],
    definition: "Elevation gain per distance, canonical m/km.",
    phase: "Route-specific and relevant to interpretation of power/HR.",
    notes: [
      "Route labels: flat <5; rolling ≥5; hilly ≥20 or major categorized climb; mountain ≥30. Higher means hillier, not better/worse. Use the emitted route class because labels overlap by design.",
    ],
  },
  {
    id: "n-n-sessions",
    name: "Qualifying Observation Count",
    abbreviation: "N / n_sessions",
    category: "Body weight, fueling, environment, and units",
    aliases: ["N / n_sessions"],
    definition: "Number of qualifying observations or sessions.",
    phase: "Phase can affect which types of sessions qualify.",
    notes: [
      "More data may improve confidence, but the minimum depends on the metric. N=0 is no evidence, not zero performance.",
    ],
  },
  {
    id: "7d-14d-28d-42d-90d-180d",
    name: "Observation Windows",
    abbreviation: "7d / 14d / 28d / 42d / 90d / 180d",
    category: "Body weight, fueling, environment, and units",
    aliases: ["7d / 14d / 28d / 42d / 90d / 180d"],
    definition: "Observation-window length in days.",
    phase: "The chosen window affects how fast planned load reductions appear.",
    notes: [
      "These windows answer different questions. Do not compare values as if their windows were identical.",
    ],
  },
  {
    id: "sd-pp",
    name: "Change, Variability and Percentage Units",
    abbreviation: "Δ / SD / % / pp",
    category: "Body weight, fueling, environment, and units",
    aliases: ["Δ / SD / % / pp"],
    definition:
      "Change / standard deviation / percent / percentage points. “pp” is used in this glossary to clarify absolute differences between percentages.",
    phase: "No phase-specific meanings.",
    notes: ["Units/operators, not metrics with good/bad ranges."],
  },
  {
    id: "bpm-ms-w-j-rpm",
    name: "Heart Rate, Time, Power, Energy and Cadence Units",
    abbreviation: "bpm / ms / W / J / rpm",
    category: "Body weight, fueling, environment, and units",
    aliases: ["bpm / ms / W / J / rpm"],
    definition:
      "Beats per minute / milliseconds / watts / joules / revolutions per minute.",
    phase: "No phase-specific meanings.",
    notes: ["Units. W measures power; J measures work/energy."],
  },
]

export const SORTED_METRIC_DEFINITIONS = [...METRIC_DEFINITIONS].sort((a, b) =>
  a.name.localeCompare(b.name)
)

/** Keep the reference UI's headings and copy consistently formatted. */
export function formatTermsCopy(text: string) {
  return text
    .replace(/\s*:\s*/g, " : ")
    .replace(/\s*[—–]\s*/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
}

export function formatTermsHeading(text: string) {
  return formatTermsCopy(text).replace(/\b[A-Za-z][A-Za-z0-9']*\b/g, (word) => {
    // Preserve acronyms and mixed-case metric tokens such as rMSSD, eFTP,
    // and kJ while capitalizing sentence-case headings.
    if (word[0] === word[0].toUpperCase() || /[A-Z]/.test(word.slice(1))) {
      return word
    }
    return word[0].toUpperCase() + word.slice(1)
  })
}

export function formatTermsAbbreviation(text: string) {
  // Unit strings such as "bpm / ms / W / J / rpm" are intentionally kept in
  // their source casing; descriptive abbreviation labels still get heading
  // capitalization (for example, "CTL slope" becomes "CTL Slope").
  return text.includes("/") ? formatTermsCopy(text) : formatTermsHeading(text)
}

function searchText(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

export function searchMetricDefinitions(query: string, category = "all") {
  const words = searchText(query).split(/\s+/).filter(Boolean)
  return SORTED_METRIC_DEFINITIONS.filter((metric) => {
    if (category !== "all" && metric.category !== category) return false
    const text = searchText(
      [metric.name, metric.abbreviation, ...(metric.aliases || [])]
        .filter(Boolean)
        .join(" ")
    )
    return words.every((word) => text.includes(word))
  })
}
