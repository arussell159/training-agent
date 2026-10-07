import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs/promises";
const source = await fs.readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const response = (body, status = 200, type = "text/html") => {
  const value = new Response(body, { status, headers: { "Content-Type": type } });
  Object.defineProperty(value, "url", { value: "https://app.test/" });
  return value;
};
function fixture(fetch, cache, openError = false) {
  const handlers = {},
    background = [];
  vm.runInNewContext(source, {
    URL,
    AbortSignal,
    fetch,
    caches: {
      open: async () => {
        if (openError) throw Error("Storage disabled");
        return cache;
      },
    },
    self: {
      location: { origin: "https://app.test" },
      addEventListener: (name, handler) => {
        handlers[name] = handler;
      },
    },
  });
  return {
    async request(path, mode = "navigate") {
      let reply;
      handlers.fetch({
        request: { url: `https://app.test${path}`, method: "GET", mode },
        respondWith: (value) => {
          reply = value;
        },
        waitUntil: (value) => {
          background.push(value);
        },
      });
      const result = await reply;
      await Promise.all(background);
      return result;
    },
  };
}
test("a storage quota failure never replaces fresh HTML or assets with a failed response", async () => {
  const cache = {
    match: async () => null,
    put: async () => {
      throw Error("Quota exceeded");
    },
    keys: async () => [],
  };
  const app = fixture(async () => response("fresh"), cache);
  assert.equal(await (await app.request("/")).text(), "fresh");
  assert.equal(await (await app.request("/assets/view.js", "cors")).text(), "fresh");
});
test("disabled browser caching still serves good online responses", async () => {
  const app = fixture(async () => response("online"), null, true);
  assert.equal(await (await app.request("/calendar")).text(), "online");
});
test("offline and server outages retain the saved app shell", async () => {
  const cache = { match: async () => response("saved") };
  const offline = fixture(async () => {
    throw Error("Offline");
  }, cache);
  assert.equal(await (await offline.request("/calendar")).text(), "saved");
  const outage = fixture(async () => response("unavailable", 503), cache);
  assert.equal(await (await outage.request("/calendar")).text(), "saved");
});
test("private APIs are never intercepted or cached by the service worker", async () => {
  let calls = 0;
  const app = fixture(async () => {
    calls++;
    return response("private");
  }, null);
  assert.equal(await app.request("/api/config"), undefined);
  assert.equal(await app.request("/api"), undefined);
  assert.equal(calls, 0);
});
