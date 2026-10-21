import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"

const source = ts.createSourceFile(
  "workout-file-actions.tsx",
  readFileSync(
    new URL("../src/components/workout-file-actions.tsx", import.meta.url),
    "utf8"
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
let submit
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === "submit")
    submit = node.initializer
  ts.forEachChild(node, visit)
}
visit(source)
assert.ok(submit, "Execute the actual upload/export callback")
const code = ts.transpileModule(`(${submit.getText(source)})`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText
function uploader(extra = {}) {
  const calls = [],
    busy = [],
    errors = [],
    notices = []
  let answer
  const state = {
    requestActive: { current: false },
    busy: false,
    mode: "upload",
    emptyBuilder: true,
    textOnly: false,
    rpeTargets: false,
    format: "fit",
    model: null,
    file: { name: "recording.fit", size: 24 },
    linkedWorkoutId: "event:9012",
    workout: undefined,
    setBusy: (value) => busy.push(value),
    setError: (value) => errors.push(value),
    setDone: (value) => notices.push(value),
    base64File: async () => "c3ludGhldGlj",
    AbortSignal,
    revalidateTrainingContext: async () => {},
    apiFetch: async (url, options) => {
      calls.push({
        url,
        body: JSON.parse(options.body),
        signal: options.signal,
      })
      return new Promise((resolve) => {
        answer = resolve
      })
    },
    Error,
    ...extra,
  }
  return {
    submit: runInNewContext(code, state),
    state,
    calls,
    busy,
    errors,
    notices,
    answer: (value) => answer(value),
  }
}
const flush = () => new Promise((resolve) => setImmediate(resolve))
const success = {
  ok: true,
  json: async () => ({
    verified: true,
    activityIds: ["i100"],
    pairedWorkoutId: "event:9012",
  }),
}

test("saved editor recording upload retains exact identity without a cached calendar object and blocks stale double submission", async () => {
  const upload = uploader()
  const first = upload.submit()
  await flush()
  await upload.submit()
  assert.equal(upload.calls.length, 1)
  assert.deepEqual(upload.calls[0].body, {
    name: "recording.fit",
    data: "c3ludGhldGlj",
    workoutId: "event:9012",
  })
  assert.equal(upload.calls[0].url, "/api/workout-files/upload")
  assert.equal(upload.state.requestActive.current, true)
  upload.answer(success)
  await first
  assert.equal(upload.state.requestActive.current, false)
  assert.deepEqual(upload.busy, [true, false])
  assert.match(
    upload.notices.at(-1),
    /uploaded and verified.*linked to this workout/
  )
})

test("a rejected upload retains its file and releases only its own busy guard for retry", async () => {
  const upload = uploader(),
    original = upload.state.file
  const failed = upload.submit()
  await flush()
  upload.answer({
    ok: false,
    json: async () => ({ error: "Retry this recording" }),
  })
  await failed
  assert.equal(upload.errors.at(-1), "Retry this recording")
  assert.equal(upload.state.file, original)
  assert.equal(upload.state.requestActive.current, false)
  const retry = upload.submit()
  await flush()
  assert.equal(upload.calls.length, 2)
  assert.deepEqual(upload.calls[0].body, upload.calls[1].body)
  upload.answer(success)
  await retry
})

test("empty, oversized and unsupported recordings fail before reading bytes or sending a request", async () => {
  for (const file of [
    null,
    { name: "empty.fit", size: 0 },
    { name: "huge.fit", size: 2 * 1024 * 1024 + 1 },
    { name: "unrecognized.csv", size: 20 },
  ]) {
    const upload = uploader({
      file,
      base64File: () => {
        throw Error("Invalid files must not be read")
      },
    })
    await upload.submit()
    assert.equal(upload.calls.length, 0)
    assert.match(upload.errors.at(-1), /FIT, TCX or GPX/)
    assert.equal(upload.state.requestActive.current, false)
  }
})

test("a successful HTTP status cannot confirm an empty, malformed or wrongly paired recording receipt", async () => {
  for (const body of [
    { verified: false, activityIds: ["i100"], pairedWorkoutId: "event:9012" },
    { verified: true, activityIds: [], pairedWorkoutId: "event:9012" },
    { verified: true, activityIds: ["i100"], pairedWorkoutId: "event:9013" },
    { verified: true, activityIds: ["i100"], pairedWorkoutId: null },
    {
      verified: true,
      activityIds: ["i100", "i100"],
      pairedWorkoutId: "event:9012",
    },
    { verified: true, activityIds: [100], pairedWorkoutId: "event:9012" },
    {
      verified: true,
      activityIds: ["activity:i100"],
      pairedWorkoutId: "event:9012",
    },
  ]) {
    const upload = uploader(),
      pending = upload.submit()
    await flush()
    upload.answer({ ok: true, json: async () => body })
    await pending
    assert.match(upload.errors.at(-1), /could not be verified/)
    assert.equal(upload.notices.at(-1), "")
    assert.equal(upload.state.requestActive.current, false)
  }
})
