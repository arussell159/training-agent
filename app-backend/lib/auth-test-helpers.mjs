import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";

export function memoryAuthStore() {
  let value = {
    userID: randomBytes(32).toString("base64url"),
    credentials: [],
    sessions: [],
    challenges: [],
    limits: {},
  };
  return {
    read: async () => structuredClone(value),
    update: async (change) => {
      const next = structuredClone(value);
      const result = change(next);
      value = next;
      return structuredClone(result);
    },
  };
}

// A software test authenticator: real P-256 key pair, CBOR attestation, and signed
// WebAuthn assertions. Exercises the actual verifier, not a mocked success result.
export function testAuthenticator(origin, rpID) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = publicKey.export({ format: "jwk" });
  const id = randomBytes(32);
  const hash = (value) => createHash("sha256").update(value).digest();
  const encode = (value) => Buffer.from(value).toString("base64url");
  const cbor = (value) => Buffer.from(isoCBOR.encode(value));
  const base = () => ({
    id: encode(id),
    rawId: encode(id),
    type: "public-key",
    clientExtensionResults: {},
  });
  function authData(flags, counter) {
    const data = Buffer.alloc(37);
    hash(rpID).copy(data);
    data[32] = flags;
    data.writeUInt32BE(counter, 33);
    return data;
  }
  return {
    registration(options, { userVerified = true, site = origin } = {}) {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(id.length);
      const key = cbor(
        new Map([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(jwk.x, "base64url")],
          [-3, Buffer.from(jwk.y, "base64url")],
        ])
      );
      const data = Buffer.concat([
        authData(userVerified ? 0x45 : 0x41, 0),
        Buffer.alloc(16),
        length,
        id,
        key,
      ]);
      const attestation = cbor(
        new Map([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", data],
        ])
      );
      return {
        ...base(),
        response: {
          attestationObject: encode(attestation),
          clientDataJSON: encode(
            JSON.stringify({
              type: "webauthn.create",
              challenge: options.challenge,
              origin: site,
              crossOrigin: false,
            })
          ),
          transports: ["internal"],
        },
      };
    },
    authentication(options, { userVerified = true, site = origin, counter = 1, userHandle } = {}) {
      const data = authData(userVerified ? 5 : 1, counter);
      const client = Buffer.from(
        JSON.stringify({
          type: "webauthn.get",
          challenge: options.challenge,
          origin: site,
          crossOrigin: false,
        })
      );
      const signature = sign("sha256", Buffer.concat([data, hash(client)]), privateKey);
      return {
        ...base(),
        response: {
          authenticatorData: encode(data),
          clientDataJSON: encode(client),
          signature: encode(signature),
          ...(userHandle ? { userHandle } : {}),
        },
      };
    },
  };
}
