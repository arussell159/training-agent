// Recorded AlphaHRV signals only. These are descriptive statistics, not threshold estimates.
export function dfaSignal(points) {
  const valid = (point) =>
    Number.isFinite(point.dfaA1) &&
    point.dfaA1 >= 0.01 &&
    (point.dfaArtifacts == null || point.dfaArtifacts <= 5);
  const observed = points.filter((point) => Number.isFinite(point.dfaA1));
  if (!observed.length) return null;
  const readings = observed.filter(valid);
  let total = 0,
    validSeconds = 0,
    sum = 0,
    artifactSeconds = 0,
    artifactSum = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const point = points[i],
      dt = points[i + 1].time - point.time;
    if (!(dt > 0)) continue;
    total += dt;
    // Do not extend one sample across a recording gap.
    if (dt > 30) continue;
    if (valid(point)) {
      validSeconds += dt;
      sum += point.dfaA1 * dt;
    }
    if (point.dfaArtifacts != null) {
      artifactSeconds += dt;
      artifactSum += point.dfaArtifacts * dt;
    }
  }
  return {
    average: validSeconds ? sum / validSeconds : null,
    minimum: readings.length
      ? readings.reduce((min, point) => Math.min(min, point.dfaA1), Infinity)
      : null,
    maximum: readings.length
      ? readings.reduce((max, point) => Math.max(max, point.dfaA1), -Infinity)
      : null,
    averageArtifacts: artifactSeconds ? artifactSum / artifactSeconds : null,
    artifactCoveragePercent: total ? (artifactSeconds / total) * 100 : null,
    validPercent: total ? (validSeconds / total) * 100 : null,
    validSeconds,
  };
}
