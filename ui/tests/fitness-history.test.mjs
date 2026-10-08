import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

globalThis.window = new EventTarget();
globalThis.fetch = () => {
  throw new Error("Unexpected network request in fitness history tests");
};
const {
  parseFitnessHistory,
  defaultFitnessAnchors,
  fitnessAnchorLabel,
  fitnessDuration,
  fitnessDistance,
  fitnessNumber,
  fitnessPeakValue,
  fitnessPeriodLabel,
  loadFitnessHistory,
  cachedFitnessHistory,
  clearFitnessHistory,
  fitnessPeakEffortTarget,
} = await import("../src/lib/fitness-history.ts");
const { setApiAuthenticated } = await import("../src/lib/api-client.ts");

function fixture(type = "Ride", { missing = false, empty = false } = {}) {
  const anchors = defaultFitnessAnchors(type);
  const period = {
    start: "2026-10-05",
    end: "2026-10-11",
    label: "Oct 5",
    activities: empty ? 0 : 3,
    duration_seconds: empty ? 0 : 7380,
    distance_meters: empty ? 0 : 32186.88,
    tss: missing ? null : 0,
    work_kj: missing ? null : 700,
    incomplete: { duration_seconds: false, distance_meters: false, tss: missing, work_kj: false },
    peaks: anchors.map((anchor, index) => ({
      ...anchor,
      value: index === 0 ? null : type === "Ride" ? 220 : 3.5,
      estimated: false,
    })),
  };
  return {
    configured: true,
    type,
    asOf: "2026-10-08T12:00:00Z",
    anchors,
    weeks: [period],
    months: [{ ...period, start: "2026-10-01", end: "2026-10-31", label: "Oct 2026" }],
  };
}
const respond = (value) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
beforeEach(() => {
  clearFitnessHistory();
  setApiAuthenticated(true, true);
  globalThis.fetch = () => {
    throw new Error("Unexpected network request in fitness history tests");
  };
});

test("measured native anchors and known zero survive parsing while missing totals stay missing", () => {
  for (const type of ["Ride", "Run", "Swim"]) {
    const result = parseFitnessHistory(fixture(type), type);
    assert.equal(result.weeks[0].tss, 0);
    assert.equal(result.weeks[0].peaks[0].value, null);
    assert.deepEqual(result.anchors, defaultFitnessAnchors(type));
    assert.equal(result.weeks[0].peaks[1].value, type === "Ride" ? 220 : 3.5);
  }
  const missing = parseFitnessHistory(fixture("Ride", { missing: true }), "Ride");
  assert.equal(missing.weeks[0].tss, null);
  assert.equal(missing.weeks[0].incomplete.tss, true);
});

test("unit conversion uses seconds, meters, watts, and speed rather than raw pace-curve elapsed time", () => {
  assert.equal(fitnessDuration(7380), "2:03");
  assert.equal(fitnessDuration(0), "0:00");
  assert.equal(fitnessDuration(null), "—");
  assert.equal(fitnessDistance(1609.344, "Run"), "1");
  assert.equal(fitnessDistance(914.4, "Swim"), "1,000");
  assert.equal(fitnessPeakValue(4, "Run"), "6:42");
  assert.equal(fitnessPeakValue(1, "Swim"), "1:31");
  assert.equal(fitnessPeakValue(0, "Ride"), "0");
  assert.equal(fitnessPeakValue(0, "Run"), "—");
  assert.equal(fitnessPeakValue(null, "Swim"), "—");
  assert.equal(fitnessPeakValue(Number.MIN_VALUE, "Run"), "—");
  assert.equal(fitnessPeakValue(Number.MIN_VALUE, "Swim"), "—");
  assert.equal(fitnessDistance(Number.MAX_VALUE, "Swim"), "—");
  assert.equal(fitnessNumber(0), "0");
  assert.equal(fitnessNumber(null), "—");
  assert.equal(fitnessPeriodLabel("2026-10-05"), "Oct 5");
  assert.equal(fitnessPeriodLabel("2026-10-01", true), "Oct 2026");
  assert.deepEqual(defaultFitnessAnchors("Ride").map(fitnessAnchorLabel), [
    "5s",
    "1m",
    "5m",
    "20m",
    "60m",
  ]);
  assert.deepEqual(defaultFitnessAnchors("Run").map(fitnessAnchorLabel), [
    "400m",
    "1km",
    "5km",
    "10km",
    "Half",
  ]);
});

test("unconfigured and empty histories are valid without inventing efforts", () => {
  const unconfigured = parseFitnessHistory({ type: "Swim", configured: false }, "Swim");
  assert.deepEqual(unconfigured.weeks, []);
  assert.deepEqual(unconfigured.months, []);
  assert.equal(unconfigured.anchors.length, 5);
  const source = fixture("Ride", { empty: true });
  source.weeks[0].peaks = [];
  assert.ok(
    parseFitnessHistory(source, "Ride").weeks[0].peaks.every((peak) => peak.value === null)
  );
});

test("actual backend history responses align with the UI for each selected sport", async () => {
  const { createPerformanceHistory } = await import("../../app-backend/lib/performance-curves.mjs");
  for (const type of ["Ride", "Run", "Swim"]) {
    let calls = 0;
    const source = createPerformanceHistory({
      now: () => Date.parse("2026-10-08T12:00:00Z"),
      request: () => async (path) => {
        calls++;
        const url = new URL(path, "http://mock");
        if (url.pathname.endsWith("/activities")) return [];
        const anchors = defaultFitnessAnchors(type);
        return {
          list: url.searchParams
            .get("curves")
            .split(",")
            .map((id) => ({
              id,
              ...(type === "Ride"
                ? {
                    secs: anchors.map((anchor) => anchor.duration_seconds),
                    values: anchors.map(() => 250),
                  }
                : {
                    distance: anchors.map((anchor) => anchor.distance_meters + 0.005),
                    values: anchors.map((anchor) => (anchor.distance_meters + 0.005) / 4),
                  }),
            })),
        };
      },
    });
    const result = parseFitnessHistory(
      await source.history({ INTERVALS_API_KEY: "fake" }, type),
      type
    );
    assert.equal(result.weeks.length, 4);
    assert.equal(result.months.length, 12);
    assert.equal(result.weeks[0].peaks[0].value, type === "Ride" ? 250 : 4);
    assert.equal(result.weeks[0].duration_seconds, 0);
    assert.equal(calls, 2, "Only mocked selected-sport curves and compact totals are read");
  }
});

test("corrupt rows, wrong sport/units, duplicate anchors, and estimated records never enter the cache", () => {
  const changes = [
    (value) => {
      value.type = "Run";
    },
    (value) => {
      value.weeks[0].start = "2026-02-31";
    },
    (value) => {
      value.weeks[0].duration_seconds = -1;
    },
    (value) => {
      value.weeks[0].tss = "0";
    },
    (value) => {
      value.weeks[0].activities = 1.2;
    },
    (value) => {
      value.weeks[0].peaks[0] = null;
    },
    (value) => {
      value.weeks[0].peaks[1].value = Infinity;
    },
    (value) => {
      value.weeks[0].peaks[1].estimated = true;
    },
    (value) => {
      value.anchors[1] = value.anchors[0];
    },
    (value) => {
      value.weeks.push(value.weeks[0]);
    },
    (value) => {
      value.anchors[0].unit = "m/s";
    },
  ];
  for (const change of changes) {
    const source = fixture();
    change(source);
    assert.throws(() => parseFitnessHistory(source, "Ride"));
  }
});

test("source provenance survives parsing and false historical attribution is rejected", () => {
  const data = fixture();
  data.source = "intervals";
  data.peakCoverage = "partial";
  data.peaksError = "Some recordings are unavailable.";
  data.weeks[0].peaks[1] = {
    ...data.weeks[0].peaks[1],
    source: "calculated-activity-curves",
    date: "2026-10-07",
    activity_id: "real-activity",
  };
  const parsed = parseFitnessHistory(data, "Ride");
  assert.equal(parsed.source, "intervals");
  assert.equal(parsed.peakCoverage, "partial");
  assert.equal(parsed.peaksError, data.peaksError);
  assert.equal(parsed.weeks[0].peaks[1].source, "calculated-activity-curves");
  assert.equal(parsed.weeks[0].peaks[1].activity_id, "real-activity");
  assert.equal(
    parseFitnessHistory({ ...data, source: "synthetic-local-preview" }, "Ride").source,
    "synthetic-local-preview"
  );
  assert.throws(() => parseFitnessHistory({ ...data, source: "estimated" }, "Ride"));
  assert.throws(() => parseFitnessHistory({ ...data, source: ["intervals"] }, "Ride"));
  assert.throws(() => parseFitnessHistory({ ...data, peakCoverage: ["complete"] }, "Ride"));
  data.weeks[0].peaks[1].estimated = "false";
  assert.throws(() => parseFitnessHistory(data, "Ride"));
  data.weeks[0].peaks[1].estimated = false;
  data.weeks[0].peaks[1].date = "2025-10-07";
  assert.throws(() => parseFitnessHistory(data, "Ride"));
});

test("metric run anchors cannot be silently replaced by a different distance", () => {
  const data = fixture("Run");
  data.weeks[0].peaks[0].distance_meters = 399.6;
  data.weeks[0].peaks[0].value = 4;
  assert.throws(() => parseFitnessHistory(data, "Run"));
  const swim = fixture("Swim");
  swim.weeks[0].peaks[0].distance_meters = 91;
  assert.equal(parseFitnessHistory(swim, "Swim").weeks[0].peaks[0].measured_distance_meters, 91);
});

test("recorded source indices stay indices and open targets retain exact native anchors", () => {
  const data = fixture();
  Object.assign(data.weeks[0].peaks[1], {
    activity_id: "i123", name: "Measured sprint", start_index: 0, end_index: 59,
  });
  const parsed = parseFitnessHistory(data, "Ride").weeks[0].peaks[1];
  assert.equal(parsed.start_index, 0);
  assert.equal(parsed.end_index, 59);
  assert.equal(parsed.name, "Measured sprint");
  assert.deepEqual(fitnessPeakEffortTarget(parsed, "Ride"), {
    activityId:"i123",sport:"Ride",kind:"power",durationSeconds:60,distanceMeters:null,value:220,
  }, "sample indices must not silently become chart seconds");
  for (const change of [
    peak=>{peak.start_index=-1}, peak=>{peak.end_index=0.2},
    peak=>{peak.start_index=80;peak.end_index=59},
    peak=>{peak.start_seconds=20;peak.end_seconds=10},
  ]) {
    const invalid = structuredClone(data);
    change(invalid.weeks[0].peaks[1]);
    assert.throws(()=>parseFitnessHistory(invalid,"Ride"));
  }
  const swim = {duration_seconds:null,distance_meters:91.44,measured_distance_meters:91,unit:"m/s",value:1.2,activity_id:"i456"};
  assert.equal(fitnessPeakEffortTarget(swim,"Swim").distanceMeters,91);
  assert.equal(fitnessPeakEffortTarget({...parsed,value:0},"Ride").value,0);
  for (const activity_id of [null,"activity:i123","preview-anything","i0"]) {
    assert.equal(fitnessPeakEffortTarget({...parsed,activity_id},"Ride"),null);
  }
  assert.equal(fitnessPeakEffortTarget({...swim,value:0},"Swim"),null);
  assert.equal(fitnessPeakEffortTarget({...parsed,value:null},"Ride"),null);
});

test("selected sport requests share one read and repeated navigation reuses the bounded session cache", async () => {
  let calls = 0;
  globalThis.fetch = async (path, options) => {
    calls++;
    const url = new URL(path, "http://local");
    assert.equal(url.searchParams.get("__api_route"), "performance-history");
    assert.equal(url.searchParams.get("type"), "Ride");
    assert.ok(!options.method || options.method === "GET");
    return respond(fixture());
  };
  const [first, second] = await Promise.all([
    loadFitnessHistory("Ride"),
    loadFitnessHistory("Ride"),
  ]);
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(await loadFitnessHistory("Ride"), first);
  assert.equal(calls, 1);
  assert.equal(cachedFitnessHistory("Run"), null);
});

test("one consumer leaving does not cancel another consumer's selected-sport read", async () => {
  let release;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      release = () => resolve(respond(fixture()));
    });
  const controller = new AbortController();
  const cancelled = loadFitnessHistory("Ride", controller.signal);
  const other = loadFitnessHistory("Ride");
  await Promise.resolve();
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  release();
  assert.equal((await other).type, "Ride");
});

test("auth/reset clears cached data and rejects late work without repopulating it", async () => {
  let release;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      release = () => resolve(respond(fixture()));
    });
  const pending = loadFitnessHistory("Ride");
  await Promise.resolve();
  const rejected = assert.rejects(pending, { name: "AbortError" });
  window.dispatchEvent(new Event("training-cache-reset"));
  release();
  await rejected;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cachedFitnessHistory("Ride"), null);
  globalThis.fetch = async () => respond(fixture());
  await loadFitnessHistory("Ride");
  window.dispatchEvent(new Event("app-auth-required"));
  assert.equal(cachedFitnessHistory("Ride"), null);
});

test("malformed successful responses and failed requests remain retryable", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return respond({ configured: true, type: "Ride", weeks: null });
  };
  await assert.rejects(loadFitnessHistory("Ride"));
  assert.equal(cachedFitnessHistory("Ride"), null);
  globalThis.fetch = async () => {
    calls++;
    return respond(fixture());
  };
  assert.equal((await loadFitnessHistory("Ride")).type, "Ride");
  assert.equal(calls, 2);
});

test("expired session values are reloaded once rather than reused indefinitely", async () => {
  const clock = Date.now;
  let instant = clock(),
    calls = 0;
  Date.now = () => instant;
  try {
    globalThis.fetch = async () => {
      calls++;
      return respond(fixture());
    };
    await loadFitnessHistory("Ride");
    instant += 5 * 60_000 + 1;
    assert.equal(cachedFitnessHistory("Ride"), null);
    await Promise.all([loadFitnessHistory("Ride"), loadFitnessHistory("Ride")]);
    assert.equal(calls, 2);
  } finally {
    Date.now = clock;
  }
});

test("cross-tab account changes reset mounted consumers while ordinary same-account snapshots keep cached data", async () => {
  globalThis.fetch = async () => respond(fixture());
  await loadFitnessHistory("Ride");
  let resets = 0;
  const reset = () => {
    resets++;
  };
  window.addEventListener("fitness-history-reset", reset);
  const storage = (oldScope, newScope) => {
    const event = new Event("storage");
    Object.assign(event, {
      key: "training-agent-startup-v2",
      oldValue: JSON.stringify({ cache_scope: oldScope }),
      newValue: JSON.stringify({ cache_scope: newScope }),
    });
    window.dispatchEvent(event);
  };
  try {
    storage("account-one", "account-one");
    assert.ok(cachedFitnessHistory("Ride"));
    assert.equal(resets, 0);
    storage("account-one", "account-two");
    assert.equal(cachedFitnessHistory("Ride"), null);
    assert.equal(resets, 1);
  } finally {
    window.removeEventListener("fitness-history-reset", reset);
  }
});
