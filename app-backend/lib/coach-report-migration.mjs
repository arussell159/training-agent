// Copy both legacy app records and historical Intervals.icu notes once. Catalog
// responses always come from the app-owned table, including during migration.
export function createCoachReportCatalog({ store, legacySaved, legacyNotes, marker }) {
  let pending;
  const sourceKey = (report) =>
    report.sourceKey ||
    (report.kind === "weekly"
      ? `weekly:${report.startDate}`
      : report.kind === "block"
        ? `block:${report.startDate}:${report.endDate}`
        : `${report.kind}:${report.startDate}:${report.endDate}`);
  async function migrate() {
    if ((await marker.read()).complete) return;
    const existing = new Set((await store.list()).reports.map((report) => report.sourceKey));
    // Notes are copied first, so a completed app-generated record wins for the
    // same period. Unique source keys make retries safe after a partial failure.
    const notes = await legacyNotes();
    await store.upsertMany(
      (notes.reports || []).filter((report) => !existing.has(sourceKey(report)))
    );
    await store.upsertMany(
      (await legacySaved()).filter((report) => !existing.has(sourceKey(report)))
    );
    await marker.update((state) => {
      state.complete = true;
      state.completedAt = new Date().toISOString();
    });
  }
  return {
    async list() {
      if (!pending)
        pending = migrate().finally(() => {
          pending = null;
        });
      try {
        await pending;
      } catch {
        // Existing app records are still copied below when the old notes source
        // is unavailable. Keep the marker pending so import can retry later.
        const existing = new Set((await store.list()).reports.map((report) => report.sourceKey));
        await store.upsertMany(
          (await legacySaved().catch(() => [])).filter((report) => !existing.has(sourceKey(report)))
        );
      }
      return store.list();
    },
  };
}
