import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { createProviderCredentialSettings } from "./provider-credential-settings.mjs";
import {
  privateBindingHash as hash,
  privateBindingDigest as digest,
  privateBindingUuid as uuid,
  privateBindingKey,
  privateBindingError as fail,
  privateBindingContext,
  providerCredentialFingerprint,
} from "./private-provider-binding-model.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, allowed) =>
  object(value) &&
  Object.keys(value).length <= allowed.length &&
  Object.keys(value).every((key) => allowed.includes(key));
const athleteId = (value) => {
  const id = value?.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(id) || id === "0")
    fail(
      "The provider athlete identity could not be verified.",
      502,
      "PRIVATE_BINDING_ATHLETE_INVALID"
    );
  return id;
};
const instant = (value) =>
  typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
const fresh = () => ({
  version: 1,
  ownerHash: null,
  environmentHash: null,
  binding: null,
  operation: null,
  receipts: [],
});
const terminalLimit = 256;

// No live provider/settings source is chosen implicitly. verifyAthlete is a
// GET-only injected transport; legacyAuthority and writerGate are trusted server
// authorities, never request-body booleans. Missing authorities fail closed.
export function createPrivateProviderBinding({
  config,
  actor,
  record,
  settings,
  verifyAthlete,
  legacyAuthority = null,
  writerGate = null,
  now = () => new Date(),
}) {
  const context = privateBindingContext(config, actor),
    store = record(fresh);
  const revision = (binding) =>
    hash({ owner: context.ownerHash, environment: context.environmentHash, ...binding });
  const inputHash = (input) =>
    hash({
      operationId: input.operationId,
      expectedBindingRevision: input.expectedBindingRevision,
      candidateFingerprint: providerCredentialFingerprint(config, input.candidateKey),
    });
  const publicBinding = (binding) => ({
    bindingRevision: revision(binding),
    status: "ready",
    provider: "intervals",
    generation: binding.generation,
  });
  function validate(state) {
    if (
      !keys(state, [
        "version",
        "ownerHash",
        "environmentHash",
        "binding",
        "operation",
        "receipts",
      ]) ||
      state.version !== 1 ||
      !Array.isArray(state.receipts) ||
      state.receipts.length > terminalLimit ||
      (state.ownerHash !== null && !digest(state.ownerHash)) ||
      (state.environmentHash !== null && !digest(state.environmentHash))
    )
      fail("The private provider binding could not be verified.", 503, "PRIVATE_BINDING_CORRUPT");
    if (state.ownerHash !== null && state.ownerHash !== context.ownerHash)
      fail(
        "This private storage belongs to another signed-in owner.",
        403,
        "PRIVATE_BINDING_OWNER_CHANGED"
      );
    if (state.environmentHash !== null && state.environmentHash !== context.environmentHash)
      fail(
        "The private storage environment changed. Use its separate recovery procedure.",
        409,
        "PRIVATE_BINDING_ENVIRONMENT_CHANGED"
      );
    if (state.binding !== null) {
      const b = state.binding;
      if (
        !keys(b, [
          "athleteId",
          "dataConnection",
          "cacheScope",
          "credentialFingerprint",
          "generation",
          "verifiedAt",
          "legacyEvidence",
        ]) ||
        !digest(b.dataConnection) ||
        !digest(b.cacheScope) ||
        !digest(b.credentialFingerprint) ||
        typeof b.athleteId !== "string" ||
        !/^[A-Za-z0-9_-]{1,80}$/.test(b.athleteId) ||
        b.athleteId === "0" ||
        !digest(b.legacyEvidence) ||
        !Number.isSafeInteger(b.generation) ||
        b.generation < 1 ||
        b.generation > terminalLimit + 1 ||
        !instant(b.verifiedAt) ||
        !digest(state.ownerHash) ||
        !digest(state.environmentHash)
      )
        fail("The private provider binding could not be verified.", 503, "PRIVATE_BINDING_CORRUPT");
    } else if (
      state.ownerHash !== null ||
      state.environmentHash !== null ||
      state.operation !== null ||
      state.receipts.length
    )
      fail(
        "The private provider binding has inconsistent ownership.",
        503,
        "PRIVATE_BINDING_CORRUPT"
      );
    if (state.operation !== null) {
      const op = state.operation;
      if (
        !keys(op, [
          "operationId",
          "intentHash",
          "fromRevision",
          "fromFingerprint",
          "settingsRevision",
          "candidateFingerprint",
          "candidateKey",
          "athleteId",
          "gateRevision",
          "verifiedAt",
          "state",
        ]) ||
        !uuid(op.operationId) ||
        !digest(op.intentHash) ||
        !digest(op.fromRevision) ||
        !digest(op.fromFingerprint) ||
        !digest(op.settingsRevision) ||
        !digest(op.candidateFingerprint) ||
        !privateBindingKey(op.candidateKey) ||
        providerCredentialFingerprint(config, op.candidateKey) !== op.candidateFingerprint ||
        !digest(op.gateRevision) ||
        !instant(op.verifiedAt) ||
        !["prepared", "attempted"].includes(op.state) ||
        !state.binding ||
        op.athleteId !== state.binding.athleteId ||
        op.fromRevision !== revision(state.binding) ||
        op.fromFingerprint !== state.binding.credentialFingerprint ||
        op.intentHash !==
          inputHash({
            operationId: op.operationId,
            expectedBindingRevision: op.fromRevision,
            candidateKey: op.candidateKey,
          })
      )
        fail(
          "The pending credential refresh could not be verified.",
          503,
          "PRIVATE_BINDING_CORRUPT"
        );
    }
    const ids = new Set();
    for (const receipt of state.receipts) {
      if (
        !keys(receipt, [
          "operationId",
          "intentHash",
          "fingerprint",
          "bindingRevision",
          "status",
          "completedAt",
        ]) ||
        !uuid(receipt.operationId) ||
        ids.has(receipt.operationId) ||
        !digest(receipt.intentHash) ||
        !digest(receipt.fingerprint) ||
        !digest(receipt.bindingRevision) ||
        !["committed", "rejected"].includes(receipt.status) ||
        !instant(receipt.completedAt)
      )
        fail("Credential refresh receipts could not be verified.", 503, "PRIVATE_BINDING_CORRUPT");
      ids.add(receipt.operationId);
    }
    return state;
  }
  async function read() {
    try {
      return validate(await store.read());
    } catch (error) {
      if (error.code?.startsWith("PRIVATE_BINDING_")) throw error;
      fail(
        "Private binding storage is unavailable. Retain the original refresh.",
        503,
        "PRIVATE_BINDING_STORAGE"
      );
    }
  }
  async function update(change) {
    try {
      return await store.update((state) => {
        validate(state);
        return change(state);
      });
    } catch (error) {
      if (error.code?.startsWith("PRIVATE_BINDING_")) throw error;
      fail("The private binding update could not be confirmed. Retain the original refresh.");
    }
  }
  async function readSettings() {
    let value;
    try {
      value = await settings.read();
    } catch (error) {
      if (error.code?.startsWith("PRIVATE_BINDING_")) throw error;
      fail("The saved credential could not be read. Recheck before refreshing.");
    }
    if (
      !object(value) ||
      !privateBindingKey(value.key) ||
      value.fingerprint !== providerCredentialFingerprint(config, value.key) ||
      !digest(value.revision)
    )
      fail("The saved credential could not be verified.", 503, "PRIVATE_BINDING_SETTINGS_INVALID");
    return value;
  }
  const writable = () => {
    if (actor.readOnly)
      fail("This account cannot refresh provider credentials.", 403, "PRIVATE_BINDING_READ_ONLY");
  };
  async function gate() {
    let value;
    try {
      value = typeof writerGate === "function" ? await writerGate() : null;
    } catch {
      fail(
        "The private writer deployment gate could not be verified.",
        503,
        "PRIVATE_BINDING_WRITERS_UNVERIFIED"
      );
    }
    if (
      !object(value) ||
      value.legacyWritersBlocked !== true ||
      value.allPrivateFactoriesBound !== true ||
      !digest(value.revision)
    )
      fail(
        "Credential refresh is disabled until every private writer uses the verified binding.",
        503,
        "PRIVATE_BINDING_WRITERS_UNVERIFIED"
      );
    return value;
  }
  async function nativeIdentity(key) {
    try {
      return athleteId(await verifyAthlete(key));
    } catch (error) {
      if (error.code?.startsWith("PRIVATE_BINDING_")) throw error;
      fail(
        "The provider credential could not be verified.",
        error.status === 401 || error.status === 403 ? error.status : 502,
        "PRIVATE_BINDING_PROVIDER_UNAVAILABLE"
      );
    }
  }
  const requireBound = (state) => {
    if (!state.binding)
      fail(
        "Existing private storage needs verified owner enrollment before credential refresh.",
        409,
        "PRIVATE_BINDING_ENROLLMENT_REQUIRED"
      );
    return state.binding;
  };
  async function enrollLegacy(input) {
    writable();
    if (
      !object(input) ||
      Object.keys(input).some((key) => key !== "expectedCredentialFingerprint") ||
      !digest(input.expectedCredentialFingerprint)
    )
      fail("Choose a valid private storage enrollment.", 400, "PRIVATE_BINDING_INVALID");
    const current = await readSettings();
    if (current.fingerprint !== input.expectedCredentialFingerprint)
      fail("The configured provider setting changed.", 409, "PRIVATE_BINDING_SETTINGS_CHANGED");
    const state = await read();
    if (state.binding) {
      if (state.binding.credentialFingerprint !== current.fingerprint)
        fail(
          "The provider setting differs from its private binding.",
          409,
          "PRIVATE_BINDING_SETTINGS_CHANGED"
        );
      return publicBinding(state.binding);
    }
    if (typeof legacyAuthority !== "function")
      fail(
        "Legacy owner evidence is required. No private namespace was adopted.",
        409,
        "PRIVATE_BINDING_ENROLLMENT_REQUIRED"
      );
    const id = await nativeIdentity(current.key);
    let proof;
    try {
      proof = await legacyAuthority({
        ownerHash: context.ownerHash,
        environmentHash: context.environmentHash,
        credentialFingerprint: current.fingerprint,
        athleteId: id,
      });
    } catch {
      fail(
        "Legacy ownership authority is unavailable. No private storage was adopted.",
        503,
        "PRIVATE_BINDING_AUTHORITY_UNAVAILABLE"
      );
    }
    if (
      !object(proof) ||
      proof.ownerHash !== context.ownerHash ||
      proof.environmentHash !== context.environmentHash ||
      proof.credentialFingerprint !== current.fingerprint ||
      proof.athleteId !== id ||
      !digest(proof.evidenceId)
    )
      fail(
        "Legacy private ownership could not be established.",
        409,
        "PRIVATE_BINDING_ENROLLMENT_REQUIRED"
      );
    const again = await readSettings();
    if (again.revision !== current.revision)
      fail(
        "The configured provider setting changed during enrollment.",
        409,
        "PRIVATE_BINDING_SETTINGS_CHANGED"
      );
    await update((next) => {
      if (next.binding) {
        if (
          next.binding.credentialFingerprint !== current.fingerprint ||
          next.binding.athleteId !== id
        )
          fail("Private provider enrollment changed.", 409, "PRIVATE_BINDING_CONFLICT");
        return;
      }
      next.ownerHash = context.ownerHash;
      next.environmentHash = context.environmentHash;
      next.binding = {
        athleteId: id,
        dataConnection: current.fingerprint,
        cacheScope: current.fingerprint,
        credentialFingerprint: current.fingerprint,
        generation: 1,
        verifiedAt: now().toISOString(),
        legacyEvidence: proof.evidenceId,
      };
    });
    return publicBinding(requireBound(await read()));
  }
  async function resolve() {
    const state = await read(),
      binding = requireBound(state),
      actual = await readSettings(),
      op = state.operation;
    const allowed =
      actual.fingerprint === binding.credentialFingerprint ||
      (op && actual.fingerprint === op.candidateFingerprint);
    if (!allowed)
      fail(
        "The saved credential differs from the verified private account. Recheck the credential operation.",
        409,
        "PRIVATE_BINDING_SETTINGS_CHANGED"
      );
    // INTERNAL server result. Never serialize it as a public credential DTO.
    return {
      provider: "intervals",
      ownerHash: context.ownerHash,
      environmentHash: context.environmentHash,
      athleteId: binding.athleteId,
      privateDataConnection: binding.dataConnection,
      cacheScope: binding.cacheScope,
      credentialFingerprint: actual.fingerprint,
      bindingRevision: revision(binding),
      writesAllowed: !op && !actor.readOnly,
      status: op ? "refreshing" : "ready",
    };
  }
  async function inspect(operationId) {
    if (!uuid(operationId))
      fail("Choose a valid refresh identity.", 400, "PRIVATE_BINDING_INVALID");
    const state = await read(),
      binding = requireBound(state),
      actual = await readSettings(),
      receipt = state.receipts.find((row) => row.operationId === operationId);
    if (receipt)
      return {
        operationId,
        status: receipt.status,
        current:
          receipt.status === "committed" &&
          receipt.fingerprint === actual.fingerprint &&
          receipt.bindingRevision === revision(binding),
        bindingRevision: revision(binding),
      };
    const op = state.operation;
    if (!op || op.operationId !== operationId)
      fail(
        "The retained credential refresh was not found.",
        404,
        "PRIVATE_BINDING_OPERATION_NOT_FOUND"
      );
    return {
      operationId,
      status:
        actual.fingerprint === op.candidateFingerprint
          ? "settings-confirmed"
          : actual.fingerprint === op.fromFingerprint
            ? "unconfirmed"
            : "conflict",
      current: false,
      bindingRevision: revision(binding),
    };
  }
  async function refresh(input) {
    writable();
    if (
      !object(input) ||
      Object.keys(input).some(
        (key) =>
          !["operationId", "expectedBindingRevision", "candidateKey", "reconcileOnly"].includes(key)
      ) ||
      !uuid(input.operationId) ||
      !digest(input.expectedBindingRevision) ||
      !privateBindingKey(input.candidateKey) ||
      (input.reconcileOnly !== undefined && typeof input.reconcileOnly !== "boolean")
    )
      fail("Choose a valid credential refresh.", 400, "PRIVATE_BINDING_INVALID");
    const expectedHash = inputHash(input);
    let state = await read(),
      binding = requireBound(state),
      actual = await readSettings();
    const receipt = state.receipts.find((row) => row.operationId === input.operationId);
    if (receipt) {
      if (receipt.intentHash !== expectedHash)
        fail(
          "This refresh identity belongs to a different request.",
          409,
          "PRIVATE_BINDING_INTENT_CHANGED"
        );
      if (receipt.status === "rejected")
        fail(
          "Credential storage rejected the original refresh. Start a new explicit request after correcting it.",
          422,
          "PRIVATE_BINDING_SETTINGS_REJECTED"
        );
      if (
        receipt.fingerprint !== actual.fingerprint ||
        receipt.bindingRevision !== revision(binding)
      )
        fail(
          "This refresh completed before a later credential change. Reload the current binding.",
          409,
          "PRIVATE_BINDING_REPLAY_CHANGED"
        );
      return { operationId: input.operationId, verified: true, ...publicBinding(binding) };
    }
    let op = state.operation;
    if (op && (op.operationId !== input.operationId || op.intentHash !== expectedHash))
      fail(
        "Another immutable credential refresh is pending. Recheck that request first.",
        409,
        "PRIVATE_BINDING_REFRESH_PENDING"
      );
    if (!op) {
      if (input.reconcileOnly)
        fail("No attempted refresh was found. Rechecking does not replace credentials.");
      if (
        revision(binding) !== input.expectedBindingRevision ||
        actual.fingerprint !== binding.credentialFingerprint
      )
        fail(
          "The provider setting or binding changed. Reload before refreshing.",
          409,
          "PRIVATE_BINDING_SETTINGS_CHANGED"
        );
      if (input.candidateKey === actual.key)
        fail(
          "The supplied key is already configured. No credential refresh is needed.",
          400,
          "PRIVATE_BINDING_NO_CHANGE"
        );
      if (state.receipts.length >= terminalLimit)
        fail(
          "The credential refresh receipt limit was reached. Retained operations were not removed.",
          503,
          "PRIVATE_BINDING_RECEIPT_LIMIT"
        );
      const deployment = await gate(),
        id = await nativeIdentity(input.candidateKey);
      if (id !== binding.athleteId)
        fail(
          "This key authorizes a different athlete. Create a separate connection; old private data stays isolated.",
          409,
          "PRIVATE_BINDING_ATHLETE_CHANGED"
        );
      const next = {
        operationId: input.operationId,
        intentHash: expectedHash,
        fromRevision: revision(binding),
        fromFingerprint: binding.credentialFingerprint,
        settingsRevision: actual.revision,
        candidateFingerprint: providerCredentialFingerprint(config, input.candidateKey),
        candidateKey: input.candidateKey,
        athleteId: id,
        gateRevision: deployment.revision,
        verifiedAt: now().toISOString(),
        state: "prepared",
      };
      await update((value) => {
        if (value.operation) {
          if (
            value.operation.operationId !== input.operationId ||
            value.operation.intentHash !== expectedHash
          )
            fail("Another credential refresh is pending.", 409, "PRIVATE_BINDING_REFRESH_PENDING");
          return;
        }
        if (revision(requireBound(value)) !== input.expectedBindingRevision)
          fail("The private provider binding changed.", 409, "PRIVATE_BINDING_CONFLICT");
        value.operation = next;
      });
      state = await read();
      op = state.operation;
      binding = requireBound(state);
    }
    if (!op || op.intentHash !== expectedHash)
      fail("The retained credential refresh could not be verified.");
    const reconcile = async () => {
      const saved = await readSettings();
      if (saved.fingerprint !== op.candidateFingerprint) {
        if (saved.fingerprint !== op.fromFingerprint || saved.revision !== op.settingsRevision)
          fail(
            "A different credential setting is now saved. The original refresh did not overwrite it.",
            409,
            "PRIVATE_BINDING_SETTINGS_CHANGED"
          );
        return false;
      }
      await update((value) => {
        const pending = value.operation;
        if (!pending) {
          const done = value.receipts.find((row) => row.operationId === input.operationId);
          if (done?.intentHash === expectedHash && done.fingerprint === saved.fingerprint) return;
          fail("The credential refresh journal changed.", 409, "PRIVATE_BINDING_CONFLICT");
        }
        if (
          pending.operationId !== input.operationId ||
          pending.intentHash !== expectedHash ||
          pending.state !== "attempted"
        )
          fail(
            "The credential setting cannot be committed without its write claim.",
            409,
            "PRIVATE_BINDING_CONFLICT"
          );
        const before = requireBound(value);
        if (revision(before) !== op.fromRevision)
          fail("The private account changed while refreshing.", 409, "PRIVATE_BINDING_CONFLICT");
        value.binding = {
          ...before,
          credentialFingerprint: op.candidateFingerprint,
          generation: before.generation + 1,
          verifiedAt: op.verifiedAt,
        };
        value.receipts.push({
          operationId: input.operationId,
          intentHash: expectedHash,
          fingerprint: op.candidateFingerprint,
          bindingRevision: revision(value.binding),
          status: "committed",
          completedAt: now().toISOString(),
        });
        value.operation = null;
      });
      const confirmed = await read(),
        current = await readSettings();
      if (
        current.fingerprint !== confirmed.binding.credentialFingerprint ||
        !confirmed.receipts.some(
          (row) => row.operationId === input.operationId && row.intentHash === expectedHash
        )
      )
        fail(
          "The refreshed credential changed before confirmation.",
          409,
          "PRIVATE_BINDING_SETTINGS_CHANGED"
        );
      return {
        operationId: input.operationId,
        verified: true,
        ...publicBinding(confirmed.binding),
      };
    };
    const already = await reconcile();
    if (already) return already;
    if (input.reconcileOnly || op.state === "attempted")
      fail(
        "The credential refresh is not confirmed. Recheck this same identity; no replacement was repeated."
      );
    const deployment = await gate();
    const claimed = await update((value) => {
      const pending = value.operation;
      if (
        !pending ||
        pending.operationId !== input.operationId ||
        pending.intentHash !== expectedHash ||
        pending.state !== "prepared"
      )
        return false;
      pending.state = "attempted";
      pending.gateRevision = deployment.revision;
      return true;
    });
    if (!claimed) {
      const resolved = await reconcile();
      if (resolved) return resolved;
      fail("This refresh is already being attempted. Recheck its original identity.");
    }
    try {
      await settings.compareAndSet({
        expectedRevision: op.settingsRevision,
        candidateKey: op.candidateKey,
      });
    } catch (error) {
      if (
        error.code === "PRIVATE_BINDING_SETTINGS_REJECTED" &&
        [400, 401, 403, 422].includes(error.status)
      ) {
        try {
          await update((value) => {
            if (value.operation?.operationId === input.operationId) {
              value.receipts.push({
                operationId: input.operationId,
                intentHash: expectedHash,
                fingerprint: op.candidateFingerprint,
                bindingRevision: revision(value.binding),
                status: "rejected",
                completedAt: now().toISOString(),
              });
              value.operation = null;
            }
          });
        } catch {
          /* Original definite rejection stays authoritative. */
        }
        fail(
          "Credential storage rejected the refresh.",
          error.status,
          "PRIVATE_BINDING_SETTINGS_REJECTED"
        );
      }
      const result = await reconcile();
      if (result) return result;
      if (error.code === "PRIVATE_BINDING_SETTINGS_CHANGED") throw error;
      fail(
        "The credential refresh could not be confirmed. Retain and recheck its original identity."
      );
    }
    const result = await reconcile();
    if (result) return result;
    fail(
      "The credential replacement could not be independently confirmed. Recheck its original identity."
    );
  }
  async function recheck(operationId) {
    writable();
    if (!uuid(operationId))
      fail("Choose a valid refresh identity.", 400, "PRIVATE_BINDING_INVALID");
    const state = await read(),
      binding = requireBound(state),
      receipt = state.receipts.find((row) => row.operationId === operationId);
    if (receipt) {
      if (receipt.status === "rejected")
        fail(
          "Credential storage rejected this refresh. Review its result before starting another.",
          422,
          "PRIVATE_BINDING_SETTINGS_REJECTED"
        );
      const actual = await readSettings();
      if (
        receipt.fingerprint !== actual.fingerprint ||
        receipt.bindingRevision !== revision(binding)
      )
        fail(
          "This refresh completed before a later credential change. Reload the current binding.",
          409,
          "PRIVATE_BINDING_REPLAY_CHANGED"
        );
      return { operationId, verified: true, ...publicBinding(binding) };
    }
    const op = state.operation;
    if (!op || op.operationId !== operationId)
      fail(
        "The retained credential refresh was not found.",
        404,
        "PRIVATE_BINDING_OPERATION_NOT_FOUND"
      );
    // Only the UUID crosses the browser on recheck. The candidate stays inside
    // the encrypted server journal, and reconcileOnly cannot first-write it.
    return refresh({
      operationId,
      expectedBindingRevision: op.fromRevision,
      candidateKey: op.candidateKey,
      reconcileOnly: true,
    });
  }
  return { enrollLegacy, resolve, refresh, inspect, recheck };
}

export function privateProviderBinding(
  config,
  actor,
  { verifyAthlete, legacyAuthority, writerGate, fetchImpl = fetch, now } = {}
) {
  const context = privateBindingContext(config, actor);
  return createPrivateProviderBinding({
    config,
    actor,
    verifyAthlete,
    legacyAuthority,
    writerGate,
    now,
    settings: createProviderCredentialSettings(config, fetchImpl),
    record: (initial) =>
      createEncryptedRecordStore(
        config,
        `${context.origin}:intervals:private-provider-binding`,
        {
          namespace: "private-provider-binding",
          name: "PRIVATE_PROVIDER_BINDING",
          fresh: initial,
          timestampCas: true,
        },
        fetchImpl
      ),
  });
}
