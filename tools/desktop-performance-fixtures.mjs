// Pure local demonstration data. No provider, database, environment or network imports.
export function createDesktopPerformanceFixtures({ today, now, context, dateShift }) {
  const records = context(dateShift(today, -730), today).history.map((row) => ({
    id: `i9${row.date.replaceAll("-", "")}${row.activity_id.split("-").at(-1)}`,
    date: row.date,
    sport: row.sport,
    name: row.title,
    distance_meters: row.workout_summary.completed.distance_meters,
    duration_seconds: row.workout_summary.completed.duration_seconds,
    elevation_meters: row.workout_summary.completed.elevation_gain,
    achievements: [],
  }));
  const runDistances = [
    400, 800, 804.672, 1000, 1500, 1609.344, 3000, 3218.688, 5000, 10000, 15000, 16093.44, 20000,
    21097.5, 30000, 42195,
  ];
  const swimDistances = [
    100, 200, 400, 1000, 1500, 91.44, 182.88, 365.76, 548.64, 731.52, 914.4, 1931.2128, 3862.4256,
  ];
  const powers = new Map([
    [5, 420],
    [10, 390],
    [30, 310],
    [60, 222],
    [300, 199],
    [600, 184],
    [1200, 170],
    [3600, 144],
  ]);
  const sportName = (type) => (type === "Ride" ? "Bike" : type);
  const anchors = (type) =>
    type === "Ride"
      ? [5, 60, 300, 1200, 3600].map((duration_seconds) => ({
          duration_seconds,
          distance_meters: null,
          unit: "watts",
        }))
      : (type === "Run"
          ? [400, 1000, 5000, 10000, 21097.5]
          : [100, 200, 400, 1000, 1500].map((yards) => yards * 0.9144)
        ).map((distance_meters) => ({ duration_seconds: null, distance_meters, unit: "m/s" }));
  const peak = (type, anchor, activity, index = 0) => {
    if (!activity || (type !== "Ride" && (activity.distance_meters ?? 0) < anchor.distance_meters))
      return { ...anchor, value: null, estimated: false };
    const power = type === "Ride";
    const distance = anchor.distance_meters;
    const value = power
      ? powers.get(anchor.duration_seconds) - (index % 5) * 3
      : type === "Run"
        ? (distance <= 1000 ? 4.08 : distance <= 5000 ? 3.04 : 2.92) - (index % 4) * 0.025
        : (distance <= 200 ? 1.17 : 1.09) - (index % 4) * 0.005;
    return {
      ...anchor,
      value,
      estimated: false,
      activity_id: activity.id,
      date: activity.date,
      name: activity.name,
      ...(power ? { watts_per_kg: value / 72.66 } : { elapsed_seconds: distance / value }),
    };
  };
  function personalStatistics(oldest = null, newest = today) {
    const bestEfforts = [];
    for (const type of ["Ride", "Run", "Swim"]) {
      const candidates = records.filter(
        (row) =>
          row.sport === sportName(type) && (!oldest || row.date >= oldest) && row.date <= newest
      );
      const targets =
        type === "Ride"
          ? [...powers.keys()].map((duration_seconds) => ({
              duration_seconds,
              distance_meters: null,
              unit: "watts",
            }))
          : (type === "Run" ? runDistances : swimDistances).map((distance_meters) => ({
              duration_seconds: null,
              distance_meters,
              unit: "m/s",
            }));
      for (const target of targets) {
        const activity = candidates.findLast((row) =>
          type === "Ride"
            ? row.duration_seconds >= target.duration_seconds
            : row.distance_meters >= target.distance_meters
        );
        const effort = peak(type, target, activity);
        if (effort.value == null) continue;
        bestEfforts.push({
          ...effort,
          sport: sportName(type),
          kind: type === "Ride" ? "power" : "pace",
          ...(type !== "Ride"
            ? {
                duration_seconds: effort.elapsed_seconds,
                requested_distance_meters: target.distance_meters,
              }
            : {}),
        });
      }
    }
    return {
      records,
      today,
      source: "synthetic-local-preview",
      synced_at: now.toISOString(),
      bestEfforts,
      bestEffortsWindow: { oldest, newest },
    };
  }
  function performanceHistory(type = "Ride") {
    if (!["Ride", "Run", "Swim"].includes(type)) return { error: "Choose Ride, Run or Swim." };
    const monday = new Date(`${today}T12:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const weekStart = monday.toISOString().slice(0, 10);
    const [year, month] = today.split("-").map(Number);
    const period = (start, end, index) => {
      const rows = records.filter(
        (row) => row.sport === sportName(type) && row.date >= start && row.date <= end
      );
      const raw = context(start, end).history.filter((row) => row.sport === sportName(type));
      const total = (key) => {
        const known = raw
          .map((row) => row.workout_summary.completed[key])
          .filter((value) => typeof value === "number");
        return {
          value: known.length ? known.reduce((a, b) => a + b, 0) : raw.length ? null : 0,
          incomplete: known.length < raw.length,
        };
      };
      const duration = total("duration_seconds"),
        distance = total("distance_meters"),
        tss = total("tss");
      return {
        start,
        end,
        label: start,
        activities: rows.length,
        duration_seconds: duration.value,
        distance_meters: distance.value,
        tss: tss.value,
        work_kj: type === "Ride" ? Math.round(((duration.value || 0) * 187) / 1000) : null,
        incomplete: {
          duration_seconds: duration.incomplete,
          distance_meters: distance.incomplete,
          tss: tss.incomplete,
          work_kj: false,
        },
        peaks: anchors(type).map((anchor) =>
          peak(
            type,
            anchor,
            rows.findLast((row) =>
              type === "Ride"
                ? row.duration_seconds >= anchor.duration_seconds
                : row.distance_meters >= anchor.distance_meters
            ),
            index
          )
        ),
      };
    };
    const weeks = Array.from({ length: 4 }, (_, index) => {
      const start = dateShift(weekStart, -7 * index);
      return period(start, index ? dateShift(start, 6) : today, index);
    });
    const months = Array.from({ length: 12 }, (_, index) => {
      const start = new Date(Date.UTC(year, month - 1 - index, 1, 12)).toISOString().slice(0, 10);
      const end = index
        ? new Date(Date.UTC(year, month - index, 0, 12)).toISOString().slice(0, 10)
        : today;
      return period(start, end, index);
    });
    return {
      configured: true,
      asOf: today,
      type,
      anchors: anchors(type),
      weeks,
      months,
      source: "synthetic-local-preview",
      synced_at: now.toISOString(),
    };
  }
  return { personalStatistics, performanceHistory };
}
