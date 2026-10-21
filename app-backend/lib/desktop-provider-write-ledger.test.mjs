import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { recordPreviewProviderWrite } from "../../tools/desktop-provider-write-ledger.mjs";
import { toFunctionUrl } from "./api-routing.mjs";

test("preview native mutation ledger includes bodyless DELETE/PATCH, excludes reads and safely distinguishes malformed bodies without changing dispatch", () => {
  const ledger = [];
  for (const method of ["POST", "PUT", "PATCH", "DELETE"])
    recordPreviewProviderWrite(ledger, "/synthetic/resource", { method });
  recordPreviewProviderWrite(ledger, "/synthetic/resource", { method: "GET", body: "{}" });
  recordPreviewProviderWrite(ledger, "/synthetic/resource", { method: "HEAD" });
  assert.deepEqual(
    ledger.map((row) => [row.method, row.body]),
    [
      ["POST", null],
      ["PUT", null],
      ["PATCH", null],
      ["DELETE", null],
    ]
  );
  recordPreviewProviderWrite(ledger, "/synthetic/resource", {
    method: "patch",
    body: '{"name":"Updated"}',
  });
  assert.deepEqual(ledger.at(-1), {
    path: "/synthetic/resource",
    method: "PATCH",
    body: { name: "Updated" },
  });
  assert.doesNotThrow(() =>
    recordPreviewProviderWrite(ledger, "/synthetic/resource", { method: "PUT", body: "not JSON" })
  );
  assert.deepEqual(ledger.at(-1), {
    path: "/synthetic/resource",
    method: "PUT",
    body: null,
    invalidBody: true,
  });
});

test(
  "actual HTTP preview records one bodyless native Event DELETE and verifies absence; reads never log and rejected attempts do not imply commits",
  { timeout: 20000 },
  async (t) => {
    const reservation = createServer();
    await new Promise((resolve, reject) => {
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", resolve);
    });
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const child = spawn(
      process.execPath,
      ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    t.after(async () => {
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    });
    await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Synthetic preview startup timed out.")), 10000);
      const finish = (error) => {
        clearTimeout(timer);
        error ? reject(error) : resolve();
      };
      child.once("error", finish);
      child.once("exit", () => finish(Error("Synthetic preview exited before serving.")));
      child.stdout.on("data", (chunk) => {
        output += chunk;
        if (output.includes(`http://127.0.0.1:${port}/calendar`)) finish();
      });
    });
    const request = (route, method = "GET", body) =>
      fetch(`http://127.0.0.1:${port}` + toFunctionUrl(route), {
        method,
        ...(body === undefined
          ? {}
          : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      });
    const json = async (route, method = "GET", body) => {
      const response = await request(route, method, body);
      assert.equal(response.status, 200);
      return response.json();
    };
    const before = await json("/api/preview/provider-records"),
      oracle = await json("/api/preview/pace-sources"),
      entry = {
        name: "Synthetic ledger Event",
        date: oracle.today,
        priority: "",
        eventType: "RunningRoad",
        description: "Readable synthetic event.",
        creationId: "preview-bodyless-delete-created",
      };
    await json("/api/preview/provider-failure", "POST", { method: "POST", status: 403 });
    const rejected = await request("/api/race-events", "POST", {
      ...entry,
      name: "Synthetic rejected ledger Event",
      creationId: "preview-bodyless-delete-rejected",
    });
    assert.equal(rejected.status, 403);
    const denied = await json("/api/preview/provider-records");
    assert.equal(
      denied.writes.length,
      before.writes.length + 1,
      "native precommit denial is still an attempted POST"
    );
    assert.equal(
      denied.events.some((row) => row.name === "Synthetic rejected ledger Event"),
      false,
      "attempt ledger cannot certify a rejected write as committed"
    );
    const created = await json("/api/race-events", "POST", entry),
      id = created.event.id,
      nativeId = Number(id.slice(6));
    const afterCreate = await json("/api/preview/provider-records");
    assert.ok(afterCreate.events.some((row) => row.id === nativeId));
    await json(`/api/race-events/${encodeURIComponent(id)}`);
    await json("/api/training-context");
    await json("/api/preview/provider-records");
    assert.deepEqual(
      (await json("/api/preview/provider-records")).writes,
      afterCreate.writes,
      "provider reads are absent from the mutation ledger"
    );
    await json("/api/preview/provider-permissions", "POST", { id, readOnly: true });
    assert.equal((await request(`/api/workouts/${encodeURIComponent(id)}`, "DELETE")).status, 403);
    assert.deepEqual(
      (await json("/api/preview/provider-records")).writes,
      afterCreate.writes,
      "app permission rejection makes zero native mutation attempts"
    );
    await json("/api/preview/provider-permissions", "POST", { id, readOnly: false });
    const deleted = await json(`/api/workouts/${encodeURIComponent(id)}`, "DELETE");
    assert.equal(deleted.verified, true);
    const afterDelete = await json("/api/preview/provider-records"),
      nativeDeletes = afterDelete.writes.filter(
        (row) => row.method === "DELETE" && row.path === `/athlete/0/events/${nativeId}`
      );
    assert.deepEqual(nativeDeletes, [
      { path: `/athlete/0/events/${nativeId}`, method: "DELETE", body: null },
    ]);
    assert.equal(
      afterDelete.events.some((row) => row.id === nativeId),
      false
    );
    assert.equal((await request(`/api/race-events/${encodeURIComponent(id)}`)).status, 404);
    assert.deepEqual((await json("/api/preview/provider-records")).writes, afterDelete.writes);
  }
);
