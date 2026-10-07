// Explicit, local-only diagnostics: no personal data and no telemetry service.
export function performanceProbe(phase: string, details: Record<string, number | boolean | string> = {}) {
  if (typeof window === 'undefined' || new URLSearchParams(window.location.search).get('performance') !== '1') return
  console.info('[training-performance]', JSON.stringify({ phase, ms: Math.round(performance.now()), ...details }))
}
