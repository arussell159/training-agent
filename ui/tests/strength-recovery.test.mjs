import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import {
  rememberPendingWorkoutCreation,
  readPendingWorkoutCreation,
  clearPendingWorkoutCreation,
  inspectPendingWorkoutCreation,
} from "../src/lib/pending-workout-creation.ts"
import {
  newStrengthBlock,
  newStrengthExercise,
} from "../../app-backend/lib/workout-strength-model.mjs"

const source = ts.createSourceFile(
  "workout-editor.tsx",
  readFileSync(
    new URL("../src/components/workout-editor.tsx", import.meta.url),
    "utf8"
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
)
const declarations = new Map()
function find(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "EditorWorkspace") {
    const walk = (child) => {
      if (ts.isVariableDeclaration(child))
        declarations.set(child.name.getText(source), child.initializer)
      ts.forEachChild(child, walk)
    }
    walk(node)
  } else ts.forEachChild(node, find)
}
find(source)
assert.ok(declarations.get("save"), "Execute the actual editor save callback")
const executable = (node) =>
  ts.transpileModule(`const callback=${node.getText(source)};callback`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
const saveSource = executable(declarations.get("save"))
const nativeDescriptionSource = executable(
  declarations.get("nativeDescription")
)
const mirrorsCall = declarations.get("[strengthDescriptionMirrors]")
assert.ok(mirrorsCall && ts.isCallExpression(mirrorsCall))
const mirrorsSource = executable(mirrorsCall.arguments[0])
const recoveryCall = declarations.get("[recovered, setRecovered]")
assert.ok(
  recoveryCall && ts.isCallExpression(recoveryCall),
  "Execute the actual recovery initializer"
)
const recoverySource = executable(recoveryCall.arguments[0])
const id = "417fc0d9-45b6-43ec-a090-39a63ae26542"
const otherId = "142f46c0-3885-41ca-965f-01e47a6675f5"
const scope = "synthetic-strength-scope"
const pendingKey = `workout-creation-pending:${scope}`
const model = () => ({
  version: 1,
  name: "Exact Strength draft",
  sport: "WeightTraining",
  date: "2026-10-23",
  notes: "Stable instructions",
  poolLength: "",
  steps: [],
  strength: {
    version: 1,
    blocks: [newStrengthBlock("single", newStrengthExercise("Squat"))],
  },
})
function fixture({
  attempted = false,
  ownPending = false,
  unrelatedPending = false,
  storageFailure = false,
  providerFailure,
} = {}) {
  const records = new Map(),
    value = model(),
    input = {
      model: value,
      creationId: id,
      values: {},
      time: "07:00",
      comment: "Original comment",
      description: value.notes,
      descriptionMode: "manual",
      reconcileOnly: true,
    }
  const observed = {
    attempts: [],
    requests: [],
    errors: [],
    closed: 0,
    saved: 0,
    fail: 0,
    finish: 0,
  }
  let rejectStorage = false
  const storage = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, text) => {
      if (rejectStorage && key === pendingKey)
        throw Error("Synthetic quota failure")
      records.set(key, String(text))
    },
    removeItem: (key) => records.delete(key),
  }
  if (ownPending || unrelatedPending)
    rememberPendingWorkoutCreation(storage, scope, {
      ...input,
      creationId: unrelatedPending ? otherId : id,
    })
  rejectStorage = storageFailure
  const noop = () => {}
  const environment = {
    Error,
    canSave: true,
    inputValidity: { isValid: () => true },
    saveInFlight: { current: false },
    deleteInFlight: { current: false },
    editorAccount: { isCurrent: () => true, ownsAccount: () => true },
    assertEditorOwner: () => {},
    bypassWorkoutNavigationGuard: (action) => action(),
    mobile: false,
    isNew: true,
    savedId: "",
    onApplyDraft: undefined,
    creationAttempted: attempted,
    creationSnapshot:{current:attempted?{input:{...input,revision:"new"},personal:{},recurrence:null}:null},
    model: value,
    creationId: id,
    revision: "new",
    personalScope: scope,
    personalId: `draft:${id}`,
    presentationSport: "WeightTraining",
    recurrence: null,
    desktopTime: input.time,
    desktopDraft: {},
    desktopPlanned: {},
    desktopSavedValues: {},
    desktopComment: input.comment,
    desktopCommentId: "separate-comment-edit-id",
    desktopDescription: value.notes,
    nativeDescription: value.notes,
    autoCalculate: false,
    manualValues: true,
    personal: {
      value: {},
      id: `draft:${id}`,
      save: async () => {},
      setValue: noop,
    },
    localStorage: storage,
    draftKey: "synthetic-per-date-draft",
    storeDraft: noop,
    yieldForWorkoutFeedback: () => Promise.resolve(),
    clone: structuredClone,
    changedPlannedValues: () => ({}),
    plannedValueDraft: () => ({}),
    cachedTrainingContext: () => ({ history: [], planned: [] }),
    workoutTotals: () => ({ seconds: 0, load: null }),
    beginOptimisticWorkoutWrite: () => ({
      commit: (workout) => ({ workout, applied: false }),
      fail: () => {
        observed.fail++
      },
      finish: () => {
        observed.finish++
      },
      confirm: noop,
    }),
    rememberPendingWorkoutCreation,
    clearPendingWorkoutCreation,
    writeWorkoutEditor: async (_existingId, request) => {
      observed.requests.push(structuredClone(request))
      if (providerFailure) throw providerFailure
      return { workout: { id: "event:333" }, revision: "confirmed" }
    },
    setStatus: noop,
    setError: (error) => observed.errors.push(error),
    setNotice: noop,
    setCreationAttempted: (value) => observed.attempts.push(value),
    setSavedId: noop,
    setRevision: noop,
    setBaseline: noop,
    setRecovered: noop,
    setDesktopSavedValues: noop,
    setDesktopDescriptionBaseline: noop,
    setDesktopComments: noop,
    setDesktopComment: noop,
    setDesktopCommentId: noop,
    setDesktopBaseline: noop,
    setRecurrence: noop,
    uid: () => "new-comment-id",
    window: { dispatchEvent: noop },
    CustomEvent: class {},
    onSaveClose: undefined,
    onSaved: () => {
      observed.saved++
    },
    onClose: () => {
      observed.closed++
    },
  }
  return {
    save: runInNewContext(saveSource, environment),
    observed,
    environment,
    records,
    storage,
    input,
    setStorageFailure: (value) => {
      rejectStorage = value
    },
  }
}

test("actual Strength recheck callback keeps an earlier ambiguous intent when browser storage fails, with zero HTTP writes", async () => {
  const fixtureValue = fixture({
    attempted: true,
    ownPending: true,
    storageFailure: true,
  })
  const before = fixtureValue.records.get(pendingKey)
  await fixtureValue.save(false)
  assert.equal(fixtureValue.observed.requests.length, 0)
  assert.equal(fixtureValue.records.get(pendingKey), before)
  assert.equal(fixtureValue.observed.attempts.at(-1), true)
  assert.equal(
    readPendingWorkoutCreation(fixtureValue.storage, scope).reconcileOnly,
    true
  )
  assert.match(
    fixtureValue.observed.errors.at(-1),
    /could not retain the pending save/
  )
})

test("initial Strength retention failure stays unattempted and can retry after storage works", async () => {
  const failed = fixture({ storageFailure: true })
  await failed.save(false)
  assert.equal(failed.observed.requests.length, 0)
  assert.equal(failed.observed.attempts.at(-1), false)
  assert.equal(readPendingWorkoutCreation(failed.storage, scope), null)
  failed.setStorageFailure(false)
  await failed.save(false)
  assert.equal(failed.observed.requests.length, 1)
  assert.equal(failed.observed.requests[0].reconcileOnly, false)
  assert.equal(failed.observed.requests[0].creationId, id)
  assert.equal(failed.observed.saved, 1)
  assert.equal(readPendingWorkoutCreation(failed.storage, scope), null)
})

test("another pending creation blocks the actual Strength callback without replacing or clearing its identity", async () => {
  const value = fixture({ unrelatedPending: true }),
    before = value.records.get(pendingKey)
  await value.save(false)
  assert.equal(value.observed.requests.length, 0)
  assert.equal(value.records.get(pendingKey), before)
  assert.equal(value.observed.attempts.at(-1), false)
  assert.equal(
    readPendingWorkoutCreation(value.storage, scope).creationId,
    otherId
  )
})

test("actual Strength recheck sends the immutable identity and read-only reconcile flag; success clears only its own pending intent", async () => {
  const value = fixture({ attempted: true, ownPending: true })
  await value.save(true)
  assert.equal(value.observed.requests.length, 1)
  assert.equal(value.observed.requests[0].creationId, id)
  assert.equal(value.observed.requests[0].reconcileOnly, true)
  assert.deepEqual(value.observed.requests[0].model, value.input.model)
  assert.equal(value.observed.requests[0].comment, value.input.comment)
  assert.equal(value.observed.saved, 1)
  assert.equal(value.observed.closed, 1)
  assert.equal(readPendingWorkoutCreation(value.storage, scope), null)
})

test("an ambiguous Strength callback preserves pending intent and cannot become a new editable creation after transport failure", async () => {
  const value = fixture({
    attempted: true,
    ownPending: true,
    providerFailure: Error("Synthetic lost response"),
  })
  await value.save(true)
  assert.equal(value.observed.requests.length, 1)
  assert.equal(value.observed.requests[0].reconcileOnly, true)
  assert.equal(value.observed.attempts.at(-1), true)
  assert.equal(readPendingWorkoutCreation(value.storage, scope).creationId, id)
  assert.equal(value.observed.closed, 0)
  assert.equal(value.observed.saved, 0)
})

test("actual recovery initializer gives global attempted Strength intent priority over stale or unrelated valid per-date drafts", () => {
  for (const staleId of [id, otherId]) {
    const value = model(),
      pending = {
        model: value,
        creationId: id,
        creationAttempted: true,
        revision: "new",
        desktop: {
          time: "07:00",
          comment: "Original comment",
          commentId: id,
          draft: {},
          autoCalculate: false,
        },
      }
    const stale = {
      model: { ...value, name: "Stale local title", date: "2026-10-24" },
      creationId: staleId,
      creationAttempted: false,
      revision: "new",
    }
    let reads = 0
    const recovered = runInNewContext(recoverySource, {
      pendingStrengthRecovery: pending,
      localStorage: {
        getItem: () => {
          reads++
          return JSON.stringify(stale)
        },
      },
      draftKey: "draft",
      initialPersonalId: undefined,
      validateWorkout: () => [],
    })()
    assert.equal(recovered.creationId, id)
    assert.equal(recovered.creationAttempted, true)
    assert.equal(recovered.model.name, "Exact Strength draft")
    assert.equal(recovered.model.date, "2026-10-23")
    assert.equal(recovered.desktop.commentId, id)
    assert.equal(
      reads,
      0,
      "Authoritative global intent must not consult a stale local wire draft"
    )
  }
})

test("corrupt prior pending bytes block the actual Strength callback without overwriting or writing HTTP", async () => {
  for (const corrupt of [
    "not JSON",
    "null",
    "{}",
    JSON.stringify({
      version: 1,
      input: { creationId: id, model: { bad: true } },
    }),
  ]) {
    const value = fixture({ attempted: true, ownPending: true })
    value.records.set(pendingKey, corrupt)
    assert.equal(
      inspectPendingWorkoutCreation(value.storage, scope).status,
      "blocked"
    )
    await value.save(false)
    assert.equal(value.observed.requests.length, 0)
    assert.equal(value.records.get(pendingKey), corrupt)
    assert.equal(value.observed.attempts.at(-1), true)
    assert.match(
      value.observed.errors.at(-1),
      /earlier workout save could not be read safely/
    )
  }
})

test("getItem failure with working setItem cannot erase an earlier pending Strength intent or issue HTTP", async () => {
  const value = fixture({ attempted: true, ownPending: true }),
    before = value.records.get(pendingKey),
    get = value.storage.getItem
  value.storage.getItem = (key) => {
    if (key === pendingKey) throw Error("Synthetic denied read")
    return get(key)
  }
  assert.equal(
    inspectPendingWorkoutCreation(value.storage, scope).status,
    "blocked"
  )
  await value.save(false)
  assert.equal(value.observed.requests.length, 0)
  assert.equal(value.records.get(pendingKey), before)
  assert.equal(value.observed.attempts.at(-1), true)
  assert.match(value.observed.errors.at(-1), /Browser storage is unavailable/)
})

test("invalid optional pending wire fields block recovery instead of entering controls or replacing the old intent", async () => {
  for (const change of [
    { description: {} },
    { description: "x".repeat(30001) },
    { descriptionMode: "generated" },
    { reconcileOnly: "false" },
  ]) {
    const value = fixture({ attempted: true, ownPending: true }),
      raw = JSON.stringify({ version: 1, input: { ...value.input, ...change } })
    value.records.set(pendingKey, raw)
    assert.equal(
      inspectPendingWorkoutCreation(value.storage, scope).status,
      "blocked"
    )
    await value.save(false)
    assert.equal(value.observed.requests.length, 0)
    assert.equal(value.records.get(pendingKey), raw)
    assert.equal(value.observed.attempts.at(-1), true)
  }
})

test("actual Strength Description expression follows instruction undo A to B to A while retaining a distinct manual introduction", async () => {
  const value = fixture(),
    original = value.environment.model.notes
  const mirrored = runInNewContext(mirrorsSource, {
    loaded: { manualDescription: original, model: { notes: original } },
  })
  assert.equal(mirrored, true)
  const selected = []
  for (const notes of [original, "Temporary changed instructions", original]) {
    value.environment.model.notes = notes
    value.environment.desktopDescription = "Stale instruction text before undo"
    value.environment.nativeDescription = runInNewContext(
      nativeDescriptionSource,
      {
        model: value.environment.model,
        strengthDescriptionMirrors: mirrored,
        desktopDescription: value.environment.desktopDescription,
      }
    )
    selected.push(value.environment.nativeDescription)
  }
  assert.deepEqual(selected, [
    original,
    "Temporary changed instructions",
    original,
  ])
  await value.save(false)
  assert.equal(value.observed.requests.length, 1)
  assert.equal(value.observed.requests[0].description, original)
  assert.equal(value.observed.requests[0].model.notes, original)

  const distinct = fixture(),
    intro = "A distinct manual introduction."
  const keepManual = runInNewContext(mirrorsSource, {
    loaded: { manualDescription: intro, model: { notes: original } },
  })
  assert.equal(keepManual, false)
  distinct.environment.model.notes = "Updated workout instructions"
  distinct.environment.desktopDescription = intro
  distinct.environment.nativeDescription = runInNewContext(
    nativeDescriptionSource,
    {
      model: distinct.environment.model,
      strengthDescriptionMirrors: keepManual,
      desktopDescription: intro,
    }
  )
  await distinct.save(false)
  assert.equal(distinct.observed.requests[0].description, intro)
  assert.equal(
    distinct.observed.requests[0].model.notes,
    "Updated workout instructions"
  )
})

test("denied Strength rechecks retain the earlier uncertain creation and every retry remains bound to read-only reconciliation", async () => {
  for (const status of [401, 403, 409]) {
    const failure = Object.assign(Error("Synthetic provider recheck denied"), {
      status,
      code: status === 409 ? "CONFLICT" : "PERMISSION_DENIED",
    })
    const value = fixture({
      attempted: true,
      ownPending: true,
      providerFailure: failure,
    })
    await value.save(false)
    assert.equal(value.observed.attempts.at(-1), true)
    assert.equal(
      readPendingWorkoutCreation(value.storage, scope).creationId,
      id
    )
    assert.equal(
      readPendingWorkoutCreation(value.storage, scope).reconcileOnly,
      true
    )
    await value.save(false)
    assert.equal(value.observed.requests.length, 2)
    assert.ok(
      value.observed.requests.every(
        (request) => request.creationId === id && request.reconcileOnly === true
      )
    )
    assert.equal(
      value.observed.requests.filter(
        (request) => request.reconcileOnly !== true
      ).length,
      0,
      "No retry may authorize a new native create"
    )
    assert.equal(value.observed.attempts.at(-1), true)
    assert.equal(
      readPendingWorkoutCreation(value.storage, scope).creationId,
      id
    )
    assert.equal(value.observed.saved, 0)
  }
})

test("a definite403 on the initial Strength create clears only that rejected attempt and permits a later explicit retry", async () => {
  const failure = Object.assign(Error("Synthetic initial create denied"), {
    status: 403,
    code: "PERMISSION_DENIED",
  })
  const value = fixture({ attempted: false, providerFailure: failure })
  await value.save(false)
  assert.equal(value.observed.requests.length, 1)
  assert.equal(value.observed.requests[0].reconcileOnly, false)
  assert.equal(value.observed.attempts.at(-1), false)
  assert.equal(readPendingWorkoutCreation(value.storage, scope), null)
  assert.equal(value.observed.saved, 0)
  value.environment.writeWorkoutEditor = async (_existingId, request) => {
    value.observed.requests.push(structuredClone(request))
    return { workout: { id: "event:334" }, revision: "confirmed-after-denial" }
  }
  await value.save(false)
  assert.equal(value.observed.requests.length, 2)
  assert.equal(value.observed.requests[1].creationId, id)
  assert.equal(value.observed.requests[1].reconcileOnly, false)
  assert.equal(value.observed.saved, 1)
  assert.equal(readPendingWorkoutCreation(value.storage, scope), null)
})
