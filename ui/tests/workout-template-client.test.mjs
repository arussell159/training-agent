import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import { createRequire } from "node:module"
import React from "../node_modules/react/index.js"
import { renderToStaticMarkup } from "../node_modules/react-dom/server.node.js"
import ts from "../node_modules/typescript/lib/typescript.js"

globalThis.window = new EventTarget()
const {
  createWorkoutTemplateClient,
  workoutTemplateAttempt,
  parseWorkoutTemplateFolders,
  parseWorkoutTemplateResult,
  readWorkoutTemplatePending,
  parseWorkoutTemplateInspection,
} = await import("../src/lib/workout-template-client.ts")
const folders = () => ({
  accountScope: "a".repeat(64),
  readOnly: false,
  folders: [
    {
      id: "folder:1",
      name: "My Workouts",
      revision: "b".repeat(64),
      editable: true,
    },
    {
      id: "folder:2",
      name: "Shared read-only",
      revision: "d".repeat(64),
      editable: false,
    },
  ],
})
const source = { id: "event:12", revision: "c".repeat(64) },
  operationId = "746c7ad1-9259-4dd5-b1d8-bb1db0e666d4"
const attempt = () =>
  workoutTemplateAttempt(
    folders(),
    source,
    "folder:1",
    " Saved Template ",
    operationId
  )
const workout = (title = "Saved Template") => ({
  id: "library:42",
  title,
  sport: "WeightTraining",
  duration: "",
  goal: "Committed instructions",
  date: "Saved workout",
  day: "",
  status: "upcoming",
})
const result = (input = attempt()) => ({
  accountScope: input.body.accountScope,
  operationId: input.body.operationId,
  verified: true,
  workoutId: "library:42",
  workout: workout(input.body.title.trim()),
  intent: {
    sourceWorkoutId: input.sourceWorkoutId,
    sourceRevision: input.body.sourceRevision,
    folderId: input.body.folderId,
    folderRevision: input.body.folderRevision,
    title: input.body.title.trim(),
  },
})
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status })
function memory() {
  const values = new Map()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}
const tick = () => new Promise((done) => setTimeout(done, 0))
test("folder reads independently validate actual account/revision/identity/read-only bindings and preserve empty folders", () => {
  assert.equal(
    parseWorkoutTemplateFolders(folders()).folders[1].editable,
    false
  )
  assert.deepEqual(
    parseWorkoutTemplateFolders({ ...folders(), folders: [] }).folders,
    []
  )
  for (const change of [
    { accountScope: "wrong" },
    { readOnly: undefined },
    { folders: [folders().folders[0], folders().folders[0]] },
    { folders: [{ ...folders().folders[0], id: "1" }] },
    { folders: [{ ...folders().folders[0], revision: "old" }] },
    { folders: [{ ...folders().folders[0], name: "" }] },
  ])
    assert.throws(() =>
      parseWorkoutTemplateFolders({ ...folders(), ...change })
    )
})
test("template intent binds a saved source and selected editable folder, accepts no dirty draft body, and rejects incomplete or oversized titles", () => {
  const input = attempt()
  assert.equal(input.sourceWorkoutId, "event:12")
  assert.equal(input.body.sourceRevision, source.revision)
  assert.equal(input.body.title, " Saved Template ")
  assert.equal("model" in input.body, false)
  for (const [catalog, sourceRow, folder, title] of [
    [{ ...folders(), readOnly: true }, source, "folder:1", "x"],
    [
      folders(),
      { id: "pending:x", revision: source.revision },
      "folder:1",
      "x",
    ],
    [folders(), { ...source, revision: "stale" }, "folder:1", "x"],
    [folders(), source, "folder:2", "x"],
    [folders(), source, "folder:99", "x"],
    [folders(), source, "folder:1", " "],
    [folders(), source, "folder:1", "x".repeat(129)],
  ])
    assert.throws(() =>
      workoutTemplateAttempt(catalog, sourceRow, folder, title)
    )
})
test("verified responses must bind the exact account/operation/source/folder/title and a real library workout before accepting success", () => {
  assert.equal(
    parseWorkoutTemplateResult(result(), attempt()).workout.workout_date,
    undefined
  )
  for (const change of [
    (v) => (v.accountScope = "f".repeat(64)),
    (v) => (v.operationId = "f".repeat(36)),
    (v) => (v.verified = false),
    (v) => (v.workoutId = "event:42"),
    (v) => (v.intent.folderId = "folder:2"),
    (v) => (v.intent.folderRevision = "f".repeat(64)),
    (v) => (v.intent.sourceWorkoutId = "event:99"),
    (v) => (v.intent.sourceRevision = "f".repeat(64)),
    (v) => (v.intent.title = "Wrong title"),
    (v) => (v.workout.id = "library:99"),
    (v) => (v.workout.title = "Wrong title"),
    (v) => delete v.workout.duration,
  ]) {
    const body = result()
    change(body)
    assert.throws(() => parseWorkoutTemplateResult(body, attempt()))
  }
})
test("immutable recovery identity is retained and read back before the sole POST; successful Add does not write the source calendar workout", async () => {
  const store = memory(),
    calls = [],
    input = attempt(),
    expected = structuredClone(input)
  const client = createWorkoutTemplateClient(
    async (path, options) => {
      calls.push({ path, options })
      assert.deepEqual(
        readWorkoutTemplatePending(store, folders().accountScope),
        expected
      )
      assert.deepEqual(JSON.parse(options.body), expected.body)
      return response(result(expected))
    },
    () => store
  )
  const saved = client.save(input)
  input.body.title = "Mutated later"
  assert.equal((await saved).workout.id, "library:42")
  assert.equal(calls.length, 1)
  assert.equal(
    decodeURIComponent(calls[0].path),
    "/api/workouts/event:12/save-template"
  )
  assert.equal(calls[0].options.method, "POST")
  assert.equal(client.pending(folders().accountScope), null)
})
test("failed or unavailable recovery storage sends no request and corrupt pending records never silently become a new Add", async () => {
  let writes = 0
  const broken = {
    getItem() {
      return null
    },
    setItem() {
      throw Error("disk blocked")
    },
    removeItem() {},
  }
  const client = createWorkoutTemplateClient(
    async () => {
      writes++
      return response(result())
    },
    () => broken
  )
  await assert.rejects(client.save(attempt()), /No new request was sent/)
  assert.equal(writes, 0)
  const store = memory()
  store.setItem(
    `workout-template-pending:${folders().accountScope}`,
    JSON.stringify({
      version: 1,
      attempt: {
        ...attempt(),
        body: { ...attempt().body, model: { steps: [] } },
      },
    })
  )
  const corrupt = createWorkoutTemplateClient(
    async () => {
      writes++
      return response(result())
    },
    () => store
  )
  assert.throws(() => corrupt.pending(folders().accountScope), /invalid/)
  await assert.rejects(corrupt.save(attempt()), /invalid/)
  assert.equal(writes, 0)
})
test("held duplicate Adds and new identities cannot replace one outstanding account save", async () => {
  const store = memory()
  let complete,
    calls = 0
  const client = createWorkoutTemplateClient(
    async () => {
      calls++
      await new Promise((done) => (complete = done))
      return response(result())
    },
    () => store
  )
  const first = client.save(attempt())
  await tick()
  await assert.rejects(client.save(attempt()), /already being confirmed/)
  assert.equal(calls, 1)
  complete()
  await first
})
test("lost replies survive a fresh client and only recheck the same immutable payload without another initial Add", async () => {
  const store = memory(),
    calls = []
  const client = createWorkoutTemplateClient(
    async (path, options) => {
      calls.push(JSON.parse(options.body))
      return response(
        { error: "Reply was lost", code: "TEMPLATE_UNCONFIRMED" },
        502
      )
    },
    () => store
  )
  await assert.rejects(client.save(attempt()), /Reply was lost/)
  const retained = client.pending(folders().accountScope)
  assert.deepEqual(retained, attempt())
  const recovered = createWorkoutTemplateClient(
    async (path, options) => {
      calls.push(JSON.parse(options.body))
      return response(result())
    },
    () => store
  )
  await assert.rejects(recovered.save(retained), /must be rechecked/)
  await recovered.save(retained, true)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1], { ...calls[0], reconcileOnly: true })
  assert.equal(recovered.pending(folders().accountScope), null)
})
test("initial certified precommit rejection remains editable but any later recheck rejection retains the original uncertain identity", async () => {
  const store = memory()
  let fail = 400,
    code = "TEMPLATE_INVALID"
  const client = createWorkoutTemplateClient(
    async () => response({ error: "Rejected", code }, fail),
    () => store
  )
  await assert.rejects(
    client.save(attempt()),
    (error) => error.uncertain === false
  )
  assert.equal(client.pending(folders().accountScope), null)
  fail = 502
  code = "TEMPLATE_UNCONFIRMED"
  await assert.rejects(client.save(attempt()))
  fail = 400
  code = "TEMPLATE_INVALID"
  await assert.rejects(
    client.save(attempt(), true),
    (error) => error.uncertain === true
  )
  assert.deepEqual(client.pending(folders().accountScope), attempt())
})
test("malformed successful replies and whole-body deadlines retain original payloads for safe reconciliation", async () => {
  for (const request of [
    async () =>
      response({
        ...result(),
        intent: { ...result().intent, folderId: "folder:2" },
      }),
    async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }),
  ]) {
    const store = memory(),
      client = createWorkoutTemplateClient(request, () => store, {
        timeoutMs: 10,
      })
    await assert.rejects(client.save(attempt()))
    assert.deepEqual(client.pending(folders().accountScope), attempt())
  }
})
test("a signed-in account change during the held response cannot confirm or clear the prior account's save", async () => {
  const store = memory()
  let complete
  const client = createWorkoutTemplateClient(
    async () => {
      await new Promise((done) => (complete = done))
      return response(result())
    },
    () => store
  )
  const saving = client.save(attempt())
  await tick()
  window.dispatchEvent(new Event("app-auth-required"))
  complete()
  await assert.rejects(saving, /signed-in library changed/)
  assert.deepEqual(client.pending(folders().accountScope), attempt())
})
const inspection = (status = "changed") => ({
  ...result(),
  status,
  workout:
    status === "deleted" || status === "unconfirmed" || status === "rejected"
      ? null
      : workout(
          status === "changed" ? "Later edited template" : "Saved Template"
        ),
  workoutId: ["rejected", "unconfirmed"].includes(status) ? null : "library:42",
})
test("inspection validates saved/changed/deleted proof and never treats a missing or uncertain operation as a completed save", () => {
  for (const status of [
    "saved",
    "changed",
    "deleted",
    "rejected",
    "unconfirmed",
  ])
    assert.equal(
      parseWorkoutTemplateInspection(inspection(status), attempt()).status,
      status
    )
  for (const change of [
    (value) => (value.accountScope = "f".repeat(64)),
    (value) => (value.intent.folderId = "folder:2"),
    (value) => (value.operationId = "wrong"),
    (value) => (value.workout.id = "library:99"),
    (value) => (value.status = "success"),
  ]) {
    const body = inspection()
    change(body)
    assert.throws(() => parseWorkoutTemplateInspection(body, attempt()))
  }
  assert.throws(() =>
    parseWorkoutTemplateInspection(
      { ...inspection("deleted"), workoutId: null },
      attempt()
    )
  )
})
test("only explicit acknowledgment of an inspected bound outcome resolves pending identity; mutated/forged/unconfirmed outcomes cannot clear it", async () => {
  const store = memory()
  let status = "unconfirmed",
    reads = 0
  const client = createWorkoutTemplateClient(
    async (path, options) => {
      if (options?.method === "POST")
        return response(
          {
            error: "Original response uncertain",
            code: "TEMPLATE_UNCONFIRMED",
          },
          502
        )
      reads++
      assert.match(path, /workout-template-operations/)
      assert.equal(
        new URL(path, "http://localhost").searchParams.get("accountScope"),
        folders().accountScope
      )
      return response(inspection(status))
    },
    () => store
  )
  await assert.rejects(client.save(attempt()))
  const uncertain = await client.inspect(attempt())
  assert.throws(() => client.acknowledge(uncertain), /before resolving/)
  assert.ok(client.pending(folders().accountScope))
  status = "changed"
  const changed = await client.inspect(attempt())
  assert.throws(
    () => client.acknowledge(structuredClone(changed)),
    /before resolving/
  )
  changed.outcome.workout.title = "Mutated proof"
  assert.throws(() => client.acknowledge(changed), /before resolving/)
  const fresh = await client.inspect(attempt()),
    current = client.acknowledge(fresh)
  assert.equal(current.workout.title, "Later edited template")
  assert.equal(client.pending(folders().accountScope), null)
  assert.equal(reads, 3)
})

function compile(path, name, scope, callback = false) {
  const text = fs.readFileSync(new URL(path, import.meta.url), "utf8"),
    file = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
  let code
  function visit(node) {
    if (
      callback &&
      ts.isVariableDeclaration(node) &&
      node.name.getText(file) === name
    )
      code = `const ${name}=${node.initializer.getText(file)}`
    else if (
      !callback &&
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name
    )
      code = node.getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(code)
  const js = ts.transpileModule(code, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    values = { exports: {}, ...scope }
  return new Function(
    "require",
    ...Object.keys(values),
    js + `;return ${name};`
  )(
    createRequire(new URL("../package.json", import.meta.url)),
    ...Object.values(values)
  )
}
test("actual new dialog presents the observed title, required128-character name and required folder with Add disabled until a real selection", () => {
  const passthrough = ({ children }) =>
      React.createElement("div", null, children),
    scope = {
      ...React,
      Dialog: passthrough,
      DialogContent: passthrough,
      DialogTitle: ({ children }) => React.createElement("h2", null, children),
      DialogDescription: ({ children }) =>
        React.createElement("p", null, children),
    }
  const Component = compile(
    "../src/components/save-workout-template-dialog.tsx",
    "SaveWorkoutTemplateDialog",
    scope
  )
  const html = renderToStaticMarkup(
    React.createElement(Component, {
      open: true,
      sourceWorkoutId: source.id,
      sourceRevision: source.revision,
      workoutTitle: "Current name",
      onOpenChange() {},
    })
  )
  assert.match(html, /Add exercise to Workout Library/)
  assert.match(html, /value="Current name"/)
  assert.match(html, /maxLength="128"/)
  assert.match(
    html,
    /<select[^>]+aria-label="Workout Library Folder"[^>]+required=""/
  )
  assert.match(
    html,
    /<button[^>]+type="submit"[^>]+disabled=""[^>]*>Add<\/button>/
  )
  assert.match(html, /Copies the last saved workout/)
})
test("actual Cancel callback makes no mutation, blocks held or uncertain dismissal, and allows ordinary pre-save closing", () => {
  const states = { errors: [], closes: [] },
    make = (locked, pending) =>
      compile(
        "../src/components/save-workout-template-dialog.tsx",
        "close",
        {
          locked: { current: locked },
          pending,
          setError: (error) => states.errors.push(error),
          onOpenChange: (value) => states.closes.push(value),
        },
        true
      )
  make(true, null)()
  make(false, attempt())()
  assert.equal(states.closes.length, 0)
  assert.match(states.errors[0], /still needs confirmation/)
  make(false, null)()
  assert.deepEqual(states.closes, [false])
})
test("actual dialog Save waits for verification, guards rapid duplicate actions and retains a confirmed template when only the view refresh fails", async () => {
  const store = memory(),
    state = { busy: false, error: "", pending: null, saved: null, closes: [] },
    locked = { current: false },
    mounted = { current: true },
    identity = { current: "source" }
  let release,
    calls = 0,
    refreshFails = true
  const client = createWorkoutTemplateClient(
    async (path, options) => {
      calls++
      await new Promise((done) => (release = done))
      const input = {
        sourceWorkoutId: source.id,
        body: JSON.parse(options.body),
      }
      return response(result(input))
    },
    () => store
  )
  const onOpenChange = (value) => state.closes.push(value),
    finish = compile(
      "../src/components/save-workout-template-dialog.tsx",
      "finish",
      {
        setSaved: (value) => (state.saved = value),
        onSaved: async () => {
          if (refreshFails) throw Error("Library view refresh failed")
        },
        mounted,
        onOpenChange,
      },
      true
    )
  const common = {
    locked,
    loading: false,
    resolved: null,
    pending: null,
    accountChanged: false,
    folders: folders(),
    source: { current: source },
    identity,
    mounted,
    folderId: "folder:1",
    title: " Saved Template ",
    setBusy: (value) => (state.busy = value),
    setError: (value) => (state.error = value),
    setPending: (value) => (state.pending = value),
    workoutTemplateAttempt,
    workoutTemplateClient: client,
    finish,
    message: (reason) => reason.message,
  }
  const save = compile(
      "../src/components/save-workout-template-dialog.tsx",
      "save",
      { ...common, saved: null },
      true
    ),
    first = save()
  await tick()
  await save()
  assert.equal(calls, 1)
  assert.equal(state.closes.length, 0)
  assert.equal(state.busy, true)
  release()
  await first
  assert.equal(state.saved.workoutId, "library:42")
  assert.equal(state.error, "Library view refresh failed")
  assert.equal(state.pending, null)
  assert.equal(client.pending(folders().accountScope), null)
  assert.equal(state.closes.length, 0)
  await compile(
    "../src/components/save-workout-template-dialog.tsx",
    "save",
    { ...common, saved: state.saved },
    true
  )()
  assert.equal(calls, 1)
  refreshFails = false
  const retry = compile(
    "../src/components/save-workout-template-dialog.tsx",
    "refreshSaved",
    {
      saved: state.saved,
      resolved: null,
      locked,
      setBusy: common.setBusy,
      setError: common.setError,
      finish,
      mounted,
      onOpenChange,
      message: (reason) => reason.message,
    },
    true
  )
  await retry()
  assert.equal(calls, 1)
  assert.deepEqual(state.closes, [false])
})
test("actual review-retained-draft resolution acknowledges only inspected outcomes without modifying source fields or creating another template", async () => {
  const store = memory(),
    calls = [],
    client = createWorkoutTemplateClient(
      async (path, options) => {
        calls.push({ path, method: options?.method })
        return options?.method === "POST"
          ? response({ error: "Reply lost", code: "TEMPLATE_UNCONFIRMED" }, 502)
          : response(inspection("changed"))
      },
      () => store
    )
  await assert.rejects(client.save(attempt()))
  const proof = await client.inspect(attempt()),
    state = {
      pending: attempt(),
      inspection: proof,
      error: "",
      busy: false,
      closed: 0,
    },
    before = calls.length
  const resolve = compile(
    "../src/components/save-workout-template-dialog.tsx",
    "resolve",
    {
      inspection: proof,
      locked: { current: false },
      setBusy: (value) => (state.busy = value),
      setError: (value) => (state.error = value),
      workoutTemplateClient: client,
      setPending: (value) => (state.pending = value),
      setInspection: (value) => (state.inspection = value),
      setResolved() {
        throw Error("Review draft must not close")
      },
      onResolved() {
        throw Error("Review draft must not close")
      },
      mounted: { current: true },
      onOpenChange() {
        state.closed++
      },
      message: (reason) => reason.message,
    },
    true
  )
  await resolve(false)
  assert.equal(calls.length, before)
  assert.equal(state.pending, null)
  assert.equal(state.inspection, null)
  assert.equal(state.closed, 0)
  assert.equal(client.pending(folders().accountScope), null)
})
test("the actual Strength template callbacks refresh only the library and preserve the unsaved editor", () => {
  const text = fs.readFileSync(
    new URL("../src/components/workout-editor.tsx", import.meta.url),
    "utf8"
  )
  const file = ts.createSourceFile(
    "workout-editor.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  )
  const callbacks = new Map()
  function visit(node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(file) === "SaveWorkoutTemplateDialog"
    )
      for (const item of node.attributes.properties)
        if (
          ts.isJsxAttribute(item) &&
          ["onSaved", "onResolved"].includes(item.name.getText(file))
        )
          callbacks.set(
            item.name.getText(file),
            item.initializer.expression.getText(file)
          )
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.equal(callbacks.size, 2)
  for (const [name, body] of callbacks) {
    const notices = []
    let refreshes = 0
    const js = ts.transpileModule(`const callback=${body}`, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    }).outputText
    const callback = new Function(
      "notifyWorkoutLibraryChanged",
      "setNotice",
      js + ";return callback;"
    )(
      () => refreshes++,
      (value) => notices.push(value)
    )
    callback()
    assert.equal(refreshes, 1)
    assert.deepEqual(
      notices,
      name === "onSaved" ? ["Workout added to your library."] : []
    )
  }
})

test("the actual nested-dialog keyboard binding stops parent calendar shortcuts while retaining native form Enter and modal Escape", () => {
  const text = fs.readFileSync(
      new URL(
        "../src/components/save-workout-template-dialog.tsx",
        import.meta.url
      ),
      "utf8"
    ),
    file = ts.createSourceFile(
      "dialog.tsx",
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
  let handler
  function visit(node) {
    if (
      ts.isJsxOpeningElement(node) &&
      node.tagName.getText(file) === "DialogContent"
    ) {
      const attr = node.attributes.properties.find(
        (item) =>
          ts.isJsxAttribute(item) && item.name.getText(file) === "onKeyDown"
      )
      handler = attr?.initializer?.expression?.getText(file)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(handler, "Actual DialogContent must own the keyboard boundary")
  const js = ts.transpileModule(`const boundary=${handler}`, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.None,
      },
    }).outputText,
    boundary = new Function(js + ";return boundary;")()
  for (const [key, ctrlKey, metaKey] of [
    ["s", true, false],
    ["S", false, true],
    ["Enter", false, false],
    ["Escape", false, false],
  ]) {
    let stopped = false,
      prevented = false,
      calendarSaves = 0
    const event = {
      key,
      ctrlKey,
      metaKey,
      stopPropagation() {
        stopped = true
      },
      preventDefault() {
        prevented = true
      },
    }
    boundary(event)
    if (!stopped && (ctrlKey || metaKey) && key.toLowerCase() === "s")
      calendarSaves++
    assert.equal(calendarSaves, 0)
    assert.equal(stopped, true)
    assert.equal(
      prevented,
      ctrlKey || metaKey,
      "Only browser Save shortcuts are prevented; Enter/Escape keep their dialog behavior"
    )
  }
})
