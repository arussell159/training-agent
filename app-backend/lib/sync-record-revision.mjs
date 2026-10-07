export function syncRevision(value) {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) throw Error("The saved calendar revision is invalid.");
  const fraction = (String(value).match(/\.(\d+)/)?.[1] || "").padEnd(6, "0").slice(0, 6);
  return BigInt(milliseconds) * 1000n + BigInt(fraction.slice(3));
}

export function nextSyncRevision(previous, now = Date.now()) {
  const clock = BigInt(now) * 1000n;
  const prior = previous ? syncRevision(previous) : 0n;
  const next = clock > prior ? clock : prior + 1n;
  return new Date(Number(next / 1000n))
    .toISOString()
    .replace(/\.\d{3}Z$/, `.${String(next % 1000000n).padStart(6, "0")}Z`);
}
