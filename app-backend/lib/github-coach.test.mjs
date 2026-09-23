import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { readCoachInstructions } from "./coach-instructions.mjs";
import {
  CoachError,
  createGithubCoachSource,
  dataSelection,
  jsonPointer,
} from "./github-coach-source.mjs";
import { coachConfig, createCoach, validateMessages } from "./github-coach.mjs";
import { protocolSections } from "./github-coach-source.mjs";
import { coachOpenAIRequest } from "./coach-openai-request.mjs";
import { createAppAuth } from "./app-auth.mjs";
import { memoryAuthStore } from "./auth-test-helpers.mjs";
import { createCoachHttp } from "./coach-http.mjs";
import { resolveApiRoute, toFunctionUrl } from "./api-routing.mjs";

const now = Date.parse("2026-09-17T15:00:00Z");
const sha = "a".repeat(40),
  officialSha = "02f5572ae196b4aa63f813413f43398a4cf1e3e4";
const env = {
  OPENAI_API_KEY: "dummy-openai",
  TRAINING_DATA_GITHUB_TOKEN: "dummy-github",
  TRAINING_DATA_GITHUB_REPO: "test/athlete",
  TRAINING_DATA_GITHUB_BRANCH: "main",
  COACH_ACCESS_PASSWORD: "dummy-test-password-0123456789",
};
const config = coachConfig(env);
const latest = {
  metadata: { last_updated: "2026-09-17T14:50:00" },
  current_status: { readiness: "unknown" },
  activities: [],
};
const question = [{ role: "user", content: "How was today's workout?" }];
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const coreProtocol =
  "\n## Behavioral & Analytical Rules for AI Coaches\nExact behavior rules.\n## AI Self-Validation Checklist\nExact validation rules.\n## Input Trust Boundary\nExact trust boundary.\n## Data Integrity Hierarchy (Trust Order)\nExact source hierarchy.\n";

function fakeGithub(overrides = {}) {
  const calls = [];
  let privateRevision = sha;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(new URL(url).hostname, "api.github.com");
    assert.equal(options.redirect, "error");
    const official = url.includes("CrankAddict/section-11");
    assert.equal(options.headers.Authorization, official ? undefined : "Bearer dummy-github");
    if (url.includes("/commits/")) return json({ sha: official ? officialSha : privateRevision });
    assert.equal(new URL(url).searchParams.get("ref"), official ? officialSha : privateRevision);
    const file = decodeURIComponent(url.split("/contents/")[1].split("?")[0]);
    if (Object.hasOwn(overrides, file)) return overrides[file]();
    if (file === "PROJECT_INSTRUCTIONS_WEB.md")
      return new Response("```\n# AI Coach Instructions\nOfficial contract.\n```");
    if (file === "SECTION_11.md")
      return new Response("# Section 11\nFull unmodified protocol." + coreProtocol);
    if (file === "DOSSIER.md")
      return new Response("# Athlete dossier\nRevision: 1\n[Unfilled placeholder]");
    if (file.startsWith("examples/reports/")) return new Response("Official report template");
    if (file === "latest.json") return json(latest);
    if (file === "history.json") return json({ weeks: [{ load: 12 }] });
    return json({ error: "Not found" }, 404);
  };
  return {
    calls,
    fetchImpl,
    changeRevision: () => {
      privateRevision = "c".repeat(40);
    },
  };
}

test("GitHub reads are credential-scoped, commit-pinned, fresh each turn and never use example files", async () => {
  const fake = fakeGithub();
  const source = createGithubCoachSource({ fetchImpl: fake.fetchImpl, now: () => now });
  const session = await source.open(config);
  assert.equal(session.metadata().lastSynced, "2026-09-17T14:50:00.000Z");
  assert.equal(session.metadata().freshness, "recent");
  assert.equal((await session.readTraining("history.json", "/weeks/0/load")).data, 12);
  await session.readReference("POST_WORKOUT_REPORT_TEMPLATE.md");
  for (const file of [
    "../../secret",
    "latest.example.json",
    "DOSSIER.md",
    "https://evil.test/data",
  ]) {
    await assert.rejects(session.readTraining(file, ""), /not available/);
  }
  await assert.rejects(session.readReference("POST_WORKOUT_REPORT_EXAMPLES.md"), /not available/);
  fake.changeRevision();
  const refreshed = await session.readTraining("latest.json", "", true);
  assert.equal(refreshed.source.dataRevision, "c".repeat(40));
  assert.match(refreshed.refreshedDossier, /Revision/);
  await source.open(config);
  assert.equal(fake.calls.filter((call) => call.url.includes("contents/latest.json")).length, 3);
  assert.equal(fake.calls.filter((call) => call.url.includes("contents/SECTION_11.md")).length, 1);
});

test("missing, malformed or incompatible sources fail closed", async () => {
  for (const overrides of [
    { "latest.json": () => json({}, 404) },
    { "latest.json": () => new Response("not json") },
    { "latest.json": () => json({ metadata: {} }) },
    { "DOSSIER.md": () => new Response("") },
    { "SECTION_11.md": () => new Response("Unexpected format") },
    { "SECTION_11.md": () => new Response("# Section 11\nMissing core rules.") },
  ]) {
    const fake = fakeGithub(overrides);
    await assert.rejects(
      createGithubCoachSource({ fetchImpl: fake.fetchImpl }).open(config),
      CoachError
    );
    assert.ok(fake.calls.every((call) => !call.url.includes(".example.json")));
  }
});

test("large values return explicit navigable indexes and pointers cannot traverse prototypes", () => {
  const value = { "a/b": { "~key": "x".repeat(190000), small: 12 } };
  assert.equal(dataSelection(value).complete, false);
  assert.equal(dataSelection(value).children[0].pointer, "/a~1b");
  assert.equal(jsonPointer(value, "/a~1b/small"), 12);
  assert.equal(jsonPointer(value, "/a~1b/~0key").length, 190000);
  assert.throws(() => jsonPointer(value, "/__proto__"), /does not exist/);
  assert.throws(() => jsonPointer(value, "../../etc"), /JSON pointer/);
});

test("unknown or old sync timestamps are not labelled recent", async () => {
  for (const [timestamp, freshness] of [
    ["bad", "unknown"],
    ["2026-09-16T14:00:00", "delayed"],
    ["2026-09-18T14:00:00Z", "unknown"],
  ]) {
    const fake = fakeGithub({
      "latest.json": () => json({ ...latest, metadata: { last_updated: timestamp } }),
    });
    const session = await createGithubCoachSource({
      fetchImpl: fake.fetchImpl,
      now: () => now,
    }).open(config);
    assert.equal(session.metadata().freshness, freshness);
  }
});

test("model receives official documents and fresh data, tools preserve stateless reasoning, no credential enters model input", async () => {
  const prompt = await readCoachInstructions();
  const fake = fakeGithub();
  const payloads = [];
  const run = createCoach({
    source: createGithubCoachSource({ fetchImpl: fake.fetchImpl, now: () => now }),
    now: () => now,
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      assert.equal(options.headers.Authorization, "Bearer dummy-openai");
      const body = JSON.parse(options.body);
      payloads.push(body);
      assert.equal(body.store, false);
      assert.equal(body.model, "gpt-5.4-mini");
      assert.match(body.instructions, /OFFICIAL SECTION 11 INDEX/);
      assert.ok(
        body.instructions.includes(prompt.text),
        "exact supplied prompt is present on every model request"
      );
      assert.match(body.instructions, /Exact behavior rules/);
      assert.match(body.instructions, /Exact validation rules/);
      assert.match(body.instructions, /Exact trust boundary/);
      assert.match(body.instructions, /Exact source hierarchy/);
      assert.ok(!body.instructions.includes("Full unmodified protocol"));
      assert.ok(
        !options.body.includes("dummy-github") &&
          !options.body.includes("dummy-openai") &&
          !options.body.includes(env.COACH_ACCESS_PASSWORD)
      );
      if (payloads.length === 1)
        return json({
          status: "completed",
          output: [
            { type: "reasoning", id: "rs1", encrypted_content: "encrypted-test", summary: [] },
            {
              type: "function_call",
              name: "read_protocol_sections",
              call_id: "call1",
              arguments: JSON.stringify({ sectionIds: ["section-0"] }),
            },
          ],
        });
      assert.ok(body.input.some((item) => item.encrypted_content === "encrypted-test"));
      assert.ok(
        body.input.some(
          (item) =>
            item.type === "function_call_output" && item.output.includes("Full unmodified protocol")
        )
      );
      if (payloads.length === 2)
        return json({
          status: "completed",
          output: [
            {
              type: "function_call",
              name: "read_report_reference",
              call_id: "call2",
              arguments: JSON.stringify({ file: "POST_WORKOUT_REPORT_TEMPLATE.md" }),
            },
          ],
        });
      assert.ok(
        body.input.some(
          (item) =>
            item.type === "function_call_output" &&
            item.output.includes("# Post-Workout Report Template")
        )
      );
      return json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              { type: "output_text", text: "No completed session is present in this fixture." },
            ],
          },
        ],
      });
    },
  });
  const result = await run({ config, messages: question });
  assert.match(result.text, /fixture/);
  assert.equal(result.source.dataRevision, sha);
  assert.equal(payloads.length, 3);
  assert.deepEqual(payloads[0].tool_choice, { type: "function", name: "read_protocol_sections" });
  assert.ok(JSON.stringify(payloads[0].input).includes("current_status"));
});

test("protocol reads preserve upstream text including code fences and reject invalid section IDs", async () => {
  const text =
    "# Section 11\nIntro.\n## A\nRules.\n```md\n## This is inside code\n```\n### B\nMore rules.\n";
  const sections = protocolSections(text);
  assert.equal(sections.length, 3);
  assert.equal(sections.map((section) => section.text).join(""), text);
  assert.match(sections[1].text, /This is inside code/);
  const fake = fakeGithub({ "SECTION_11.md": () => new Response(text + coreProtocol) });
  const session = await createGithubCoachSource({ fetchImpl: fake.fetchImpl }).open(config);
  assert.deepEqual(session.readProtocol(["section-1"]).sections, [sections[1]]);
  assert.throws(() => session.readProtocol(["unknown"]), /Unknown protocol section/);
  assert.throws(() => session.readProtocol([]), /one and six/);
});

test("new messages always resend the persistent prompt and reread the complete dossier", async () => {
  let revision = 0;
  const fake = fakeGithub({
    "DOSSIER.md": () =>
      new Response(`# Athlete dossier\nRevision: ${++revision}\nComplete private context.`),
  });
  const prompt = await readCoachInstructions();
  const seen = [];
  const run = createCoach({
    source: createGithubCoachSource({ fetchImpl: fake.fetchImpl }),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.ok(body.instructions.includes(prompt.text));
      assert.equal(body.store, false);
      const data = JSON.parse(
        body.input
          .find((item) => item.content?.startsWith("Current source data"))
          .content.split("\n")
          .slice(1)
          .join("\n")
      );
      seen.push(data.dossier);
      return json({
        status: "completed",
        output: [{ type: "message", content: [{ type: "output_text", text: "Fixture reply." }] }],
      });
    },
  });
  await run({ config, messages: question });
  await run({
    config,
    messages: [
      ...question,
      { role: "assistant", content: "Old reply." },
      { role: "user", content: "Next question." },
    ],
  });
  assert.deepEqual(seen, [
    "# Athlete dossier\nRevision: 1\nComplete private context.",
    "# Athlete dossier\nRevision: 2\nComplete private context.",
  ]);
  assert.ok(!fake.calls.some((call) => call.url.includes("PROJECT_INSTRUCTIONS_WEB")));
});

test("missing persistent instructions prevent coaching", async () => {
  const fake = fakeGithub();
  const source = createGithubCoachSource({
    fetchImpl: fake.fetchImpl,
    readInstructions: async () => {
      throw new Error("Prompt file missing");
    },
  });
  await assert.rejects(source.open(config), /Prompt file missing/);
});

test("saved reports send exact templates with a strict completion envelope and reject incomplete reports", async () => {
  const fake = fakeGithub();
  const source = createGithubCoachSource({ fetchImpl: fake.fetchImpl, now: () => now });
  const session = await source.open(config);
  const reportContext = {
    target: { kind: "post", activityId: "fixture" },
    template: { text: "EXACT REPORT TEMPLATE" },
    hierarchy: { text: "EXACT REPORT HIERARCHY" },
    evidence: { activities: [{ id: "fixture" }] },
  };
  let complete = true;
  const run = createCoach({
    source,
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.text.format.type, "json_schema");
      assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.schema.additionalProperties, false);
      assert.ok(body.instructions.includes(reportContext.template.text));
      assert.ok(body.instructions.includes(reportContext.hierarchy.text));
      assert.ok(body.instructions.includes(session.docs.contract));
      const data = body.input.find((item) => item.content?.startsWith("Current source data"));
      assert.equal(
        JSON.parse(data.content.slice(data.content.indexOf("\n") + 1)).dossier,
        session.dossier
      );
      assert.ok(!body.tools.some((tool) => tool.name === "propose_calendar_workouts"));
      return json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  complete,
                  report_markdown: complete
                    ? "Data (last_updated UTC: 2026-09-17T14:55:00)\nA steady ride completed as planned.\n\nCompleted workout: Ride\nDuration: 1h00m\n\nWeekly totals (rolling 7d):\nHours: 4h00m\n\nInterpretation:\nExecution matched the planned intensity. Recovery remains within baseline."
                    : "",
                  summary: null,
                  missing_reason: complete ? null : "Missing required activity evidence.",
                }),
              },
            ],
          },
        ],
      });
    },
  });
  const result = await run({ config, messages: question, sourceSession: session, reportContext });
  assert.ok(result.text.startsWith("Data (last_updated UTC:"));
  complete = false;
  await assert.rejects(
    run({ config, messages: question, sourceSession: session, reportContext }),
    /Missing required activity evidence/
  );
});

test("temporary rate limits retry with Retry-After; quota failures and exhausted retries stop", async () => {
  const waits = [];
  let attempts = 0;
  const response = await coachOpenAIRequest({
    config,
    body: {},
    wait: async (ms) => waits.push(ms),
    fetchImpl: async () =>
      ++attempts === 1
        ? new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), {
            status: 429,
            headers: { "retry-after": "2" },
          })
        : json({ status: "completed" }),
  });
  assert.equal(response.status, 200);
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [2250]);
  for (const [code, expectedAttempts] of [
    ["insufficient_quota", 1],
    ["rate_limit_exceeded", 3],
  ]) {
    attempts = 0;
    await assert.rejects(
      coachOpenAIRequest({
        config,
        body: {},
        wait: async () => {},
        fetchImpl: async () => {
          attempts++;
          return json({ error: { code } }, 429);
        },
      }),
      /HTTP 429/
    );
    assert.equal(attempts, expectedAttempts);
  }
});

test("aborting a rate-limit wait prevents another paid request", async () => {
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(
    coachOpenAIRequest({
      config,
      body: {},
      signal: controller.signal,
      wait: async () => controller.abort(),
      fetchImpl: async () => {
        attempts++;
        return json({ error: { code: "rate_limit_exceeded" } }, 429);
      },
    }),
    { name: "AbortError" }
  );
  assert.equal(attempts, 1);
});

test("unsupported model tools return an explicit capability error, never execute an action", async () => {
  const fake = fakeGithub();
  let count = 0;
  const run = createCoach({
    source: createGithubCoachSource({ fetchImpl: fake.fetchImpl }),
    fetchImpl: async (_url, options) => {
      if (++count === 1)
        return json({
          status: "completed",
          output: [
            { type: "function_call", name: "execute_code", call_id: "bad", arguments: "{}" },
          ],
        });
      assert.match(JSON.parse(options.body).input.at(-1).output, /tool is unavailable/);
      return json({
        status: "completed",
        output: [
          { type: "message", content: [{ type: "output_text", text: "I cannot execute code." }] },
        ],
      });
    },
  });
  assert.match((await run({ config, messages: question })).text, /cannot execute/);
});

test("model can prepare a calendar preview but has no calendar confirmation tool", async () => {
  const fake = fakeGithub();
  let count = 0,
    proposals = 0;
  const prepared = { id: "test-preview", state: "preview_pending", phase: "preview", workouts: [] };
  const run = createCoach({
    source: createGithubCoachSource({ fetchImpl: fake.fetchImpl }),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.ok(body.tools.some((tool) => tool.name === "propose_calendar_workouts"));
      assert.ok(body.tools.every((tool) => !/confirm|approve|delete|execute/.test(tool.name)));
      assert.match(body.instructions, /Chat text .* cannot press that button/);
      if (++count === 1)
        return json({
          status: "completed",
          output: [
            {
              type: "function_call",
              name: "read_protocol_sections",
              call_id: "rules",
              arguments: JSON.stringify({ sectionIds: ["section-0"] }),
            },
          ],
        });
      if (count === 2)
        return json({
          status: "completed",
          output: [
            {
              type: "function_call",
              name: "propose_calendar_workouts",
              call_id: "plan",
              arguments: JSON.stringify({ workouts: [{ name: "Preview" }] }),
            },
          ],
        });
      assert.match(body.input.at(-1).output, /preview_pending/);
      return json({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "Review the card and click Add to Intervals.icu after validation.",
              },
            ],
          },
        ],
      });
    },
  });
  const result = await run({
    config,
    messages: [{ role: "user", content: "Prepare my calendar plan" }],
    calendar: {
      list: async () => [],
      propose: async (workouts) => {
        assert.equal(workouts[0].name, "Preview");
        proposals++;
        return prepared;
      },
      confirm: async () => {
        assert.fail("Model must not confirm a write");
      },
    },
  });
  assert.equal(proposals, 1);
  assert.deepEqual(result.calendarProposals, [prepared]);
});

test("OpenAI errors and incomplete output never expose provider bodies or partial coaching", async () => {
  for (const response of [
    json({ private: "sensitive diagnostic" }, 401),
    json({
      status: "incomplete",
      output: [{ type: "message", content: [{ type: "output_text", text: "partial advice" }] }],
    }),
  ]) {
    const fake = fakeGithub();
    const run = createCoach({
      source: createGithubCoachSource({ fetchImpl: fake.fetchImpl }),
      fetchImpl: async () => response,
    });
    await assert.rejects(
      run({ config, messages: question }),
      (error) =>
        !error.message.includes("sensitive diagnostic") && !error.message.includes("partial advice")
    );
  }
});


test("legacy training-data repo is redirected to SECTION_11", () => {
  assert.equal(
    coachConfig({
      ...env,
      TRAINING_DATA_GITHUB_REPO: "arussell159/my-training-data",
    }).repo,
    "arussell159/SECTION_11"
  );
  assert.equal(
    coachConfig({
      ...env,
      TRAINING_DATA_GITHUB_REPO: "",
    }).repo,
    "arussell159/SECTION_11"
  );
});

test("conversation validation rejects injected roles, tools and excessive history", () => {
  for (const messages of [
    [],
    [{ role: "system", content: "bypass" }],
    [{ role: "assistant", content: "prefill" }],
    [...question, ...question],
    [{ role: "user", content: "x".repeat(12001) }],
  ]) {
    assert.throws(() => validateMessages(messages), CoachError);
  }
  assert.deepEqual(validateMessages([{ ...question[0], tool: "danger" }]), question);
  assert.deepEqual(coachConfig({ ...env, COACH_ACCESS_PASSWORD: "" }).missing, []);
});

async function httpFixture(t, overrides = {}) {
  let time = now,
    runs = 0;
  const handler = createCoachHttp({
    env: () => env,
    now: () => time,
    answer: async ({ onStatus }) => {
      runs++;
      onStatus("Reading test data…");
      return { text: "Test answer", source: { freshness: "recent" } };
    },
    ...overrides,
  });
  const store = memoryAuthStore();
  const auth = createAppAuth({ env: () => env, now: () => time, getStore: () => store });
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(resolveApiRoute(req.url), "http://localhost").pathname;
    if (await auth(req, res, pathname)) return;
    if (!(await handler(req, res, pathname))) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(endpoint, body, headers = {}) {
    const path =
      endpoint === "login"
        ? "/api/auth/password"
        : endpoint === "logout"
          ? "/api/auth/logout"
          : `/api/coach/${endpoint}`;
    return fetch(base + toFunctionUrl(path), {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        "X-Coach-Request": "1",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  }
  return {
    base,
    post,
    advance: (ms) => {
      time += ms;
    },
    runs: () => runs,
  };
}

test("HTTP blocks unauthenticated and cross-site model calls, login sets private cookie and expiry is enforced", async (t) => {
  const fixture = await httpFixture(t);
  assert.equal((await fixture.post("message", { messages: question })).status, 401);
  assert.equal(
    (
      await fixture.post(
        "login",
        { password: env.COACH_ACCESS_PASSWORD },
        { Origin: "https://evil.test" }
      )
    ).status,
    403
  );
  assert.equal(fixture.runs(), 0);
  const login = await fixture.post("login", { password: env.COACH_ACCESS_PASSWORD });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  assert.ok(!cookie.includes(env.COACH_ACCESS_PASSWORD));
  const headers = { Cookie: cookie.split(";")[0] };
  const reply = await fixture.post("message", { messages: question }, headers);
  assert.match(reply.headers.get("content-type"), /event-stream/);
  assert.match(await reply.text(), /event: status[\s\S]*event: answer/);
  assert.equal(fixture.runs(), 1);
  fixture.advance(91 * 86400000);
  assert.equal((await fixture.post("message", { messages: question }, headers)).status, 401);
});

test("wrong-password throttle, logout and session setup status do not expose credentials", async (t) => {
  const fixture = await httpFixture(t);
  const status = await fetch(fixture.base + toFunctionUrl("/api/auth/session"));
  assert.deepEqual(await status.json(), {
    configured: true,
    authenticated: false,
    hasPasskey: false,
    passkeysSupported: false,
  });
  for (let i = 0; i < 10; i++)
    assert.equal((await fixture.post("login", { password: "wrong" })).status, 401);
  assert.equal((await fixture.post("login", { password: "wrong" })).status, 429);
  fixture.advance(16 * 60000);
  assert.equal((await fixture.post("login", { password: env.COACH_ACCESS_PASSWORD })).status, 200);
  assert.match((await fixture.post("logout", {})).headers.get("set-cookie"), /Max-Age=0/);
});

test("aborted generation returns an actionable streamed timeout without leaking internal errors", async (t) => {
  const fixture = await httpFixture(t, {
    timeoutMs: 10,
    answer: async ({ signal }) => {
      await new Promise((_, reject) =>
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("secret diagnostics", "AbortError")),
          { once: true }
        )
      );
    },
  });
  const login = await fixture.post("login", { password: env.COACH_ACCESS_PASSWORD });
  const reply = await fixture.post(
    "message",
    { messages: question },
    { Cookie: login.headers.get("set-cookie").split(";")[0] }
  );
  const text = await reply.text();
  assert.match(text, /event: error[\s\S]*timed out/);
  assert.ok(!text.includes("secret diagnostics"));
});
