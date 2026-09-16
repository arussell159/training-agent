export function activityRoute(streams) {
  const stream = streams.find((s) => s.type === "latlng");
  const coordinates = (stream?.data || []).map((p, i) =>
    Array.isArray(p) ? p : [p, stream.data2?.[i]]
  );
  const valid = coordinates.filter(
    (p) =>
      p.length === 2 &&
      p.every((v) => typeof v === "number" && Number.isFinite(v)) &&
      Math.abs(p[0]) <= 85 &&
      Math.abs(p[1]) <= 180
  );
  const stride = Math.max(1, Math.ceil(valid.length / 1500));
  const points = valid.filter((_, i) => i % stride === 0);
  if (valid.length && points.at(-1) !== valid.at(-1)) points.push(valid.at(-1));
  return points;
}
