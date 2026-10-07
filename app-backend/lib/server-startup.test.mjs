import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("loading the HTTP server does not perform a cold-start database request", async () => {
  const serverUrl = new URL("../server.mjs", import.meta.url).href;
  const script = `
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw Error("unexpected startup request"); };
    await import(${JSON.stringify(serverUrl)});
    if (requests) throw Error("Server loading contacted a remote service");
  `;
  const result = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "--eval", script],
    { timeout: 10000 }
  );
  assert.equal(result.stderr, "");
});
