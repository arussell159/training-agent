import test from "node:test";
import assert from "node:assert/strict";
import { createApiHandler } from "../../api/handler.mjs";
import { toFunctionUrl } from "./api-routing.mjs";

test("hosted session checks use normal authentication without importing the training server", async () => {
  let imports = 0;
  const handler = createApiHandler({
    hosted: () => true,
    authenticate: (_req, _res, path) => {
      assert.equal(path, "/api/auth/session");
      return "verified";
    },
    loadServer: async () => {
      imports++;
      throw Error("Unexpected server import");
    },
  });
  assert.equal(
    await handler({ url: "/api/handler?__api_route=auth%2Fsession", method: "GET" }, {}),
    "verified"
  );
  assert.equal(imports, 0);
});

test("mutations and local bootstrap files retain the full authenticated server path", async () => {
  for (const [hosted, method, url] of [
    [false, "GET", "/api/auth/session"],
    [true, "POST", "/api/auth/password"],
    [true, "GET", "/api/training-context"],
  ]) {
    let imports = 0;
    const handler = createApiHandler({
      hosted: () => hosted,
      authenticate: () => {
        throw Error("Unexpected fast path");
      },
      loadServer: async () => {
        imports++;
        return { handleRequest: () => "normal" };
      },
    });
    assert.equal(await handler({ url, method }, {}), "normal");
    assert.equal(imports, 1);
  }
});

test("hosted exercise-library transport removes only the internal route before server filter validation", async () => {
  const seen = [];
  const handler = createApiHandler({
    hosted: () => true,
    loadServer: async () => ({
      handleRequest(req) {
        const url = new URL(req.url, "http://localhost");
        seen.push(url);
        assert.equal(url.pathname, "/api/strength-exercises");
        assert.equal(url.searchParams.has("__api_route"), false);
        return [...url.searchParams.keys()].every((key) =>
          ["query", "muscleGroup", "owner"].includes(key)
        )
          ? 200
          : 400;
      },
    }),
  });
  assert.equal(
    await handler(
      {
        url: toFunctionUrl("/api/strength-exercises?query=Air+Squat&muscleGroup=Quads&owner=me"),
        method: "GET",
      },
      {}
    ),
    200
  );
  assert.equal(seen[0].searchParams.get("query"), "Air Squat");
  assert.equal(
    await handler(
      { url: toFunctionUrl("/api/strength-exercises?unexpected=value"), method: "GET" },
      {}
    ),
    400
  );
});
