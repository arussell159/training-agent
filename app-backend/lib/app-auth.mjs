import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { createAuthStore } from "./app-auth-store.mjs";

const DAY = 86400000;
const SESSION_COOKIE = "training_app_session";
const CHALLENGE_COOKIE = "training_app_challenge";
const hash = (text) => createHash("sha256").update(text).digest("base64url");
const equal = (a, b) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const token = () => randomBytes(32).toString("base64url");
class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
function cookies(req, name) {
  const value = req.headers.cookie
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`))
    ?.slice(name.length + 1);
  return /^[\w-]{43}$/.test(value || "") ? value : null;
}
function cookie(name, value, config, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict${maxAge === undefined ? "" : `; Max-Age=${maxAge}`}${config.secure ? "; Secure" : ""}`;
}
export function authConfig(env, req) {
  const password = env.APP_PASSWORD || env.COACH_ACCESS_PASSWORD || "";
  const host = req.headers.host || "";
  const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
    req.socket?.remoteAddress || ""
  );
  const bypass =
    env.LOCAL_AUTH_BYPASS === "true" &&
    !env.VERCEL &&
    loopback &&
    /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  let origin = env.APP_ORIGIN;
  if (!origin && env.VERCEL) {
    const domain = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
    if (domain) origin = `https://${domain}`;
  }
  if (
    !origin &&
    !env.VERCEL &&
    /^localhost(:\d+)?$|^127\.0\.0\.1(:\d+)?$/.test(req.headers.host || "")
  )
    origin = `http://${req.headers.host}`;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new AuthError(
      "Set APP_ORIGIN to the application's address in the server environment.",
      503
    );
  }
  const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (
    parsed.origin !== origin ||
    (!local && parsed.protocol !== "https:") ||
    parsed.host !== req.headers.host
  )
    throw new AuthError("Open the app at its configured address to sign in.", 403);
  return {
    password,
    epoch: hash(`app-password-v1:${password}`),
    origin,
    rpID: parsed.hostname,
    secure: parsed.protocol === "https:",
    configured: password.length >= 20,
    passkeysSupported: parsed.hostname !== "127.0.0.1",
    bypass,
  };
}
function checkOrigin(req, config) {
  if (req.headers.origin !== config.origin || req.headers["sec-fetch-site"] === "cross-site")
    throw new AuthError("This request must come from your application.", 403);
}
async function readBody(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json")
    throw new AuthError("Expected a JSON request.", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 32000) throw new AuthError("Request is too large.", 413);
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    throw new AuthError("Invalid request.");
  }
}
function clean(state, now) {
  state.sessions = state.sessions.filter((s) => s.expires > now);
  state.challenges = state.challenges.filter((c) => c.expires > now);
  for (const [key, limit] of Object.entries(state.limits))
    if (limit.until <= now) delete state.limits[key];
}
function sessionFor(state, req, config, now) {
  const value = cookies(req, SESSION_COOKIE);
  return (
    value &&
    state.sessions.find((s) => s.id === hash(value) && s.epoch === config.epoch && s.expires > now)
  );
}
function recent(session, now) {
  if (!session || now - session.created > 10 * 60000)
    throw new AuthError("Confirm your password again before changing passkeys.", 403);
}

export function createAppAuth({
  env = () => process.env,
  readBootstrap = async () => process.env,
  getStore = (bootstrap, origin) => createAuthStore(bootstrap, origin),
  now = Date.now,
} = {}) {
  return async function handleAuth(req, res, pathname) {
    if (!pathname.startsWith("/api/")) return false;
    const json = (status, body, headers = {}) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...headers,
      });
      res.end(JSON.stringify(body));
    };
    try {
      const config = authConfig(env(), req);
      const isAuth = pathname.startsWith("/api/auth/");
      if (config.bypass) {
        if (pathname === "/api/auth/session" && req.method === "GET") {
          json(200, {
            configured: true,
            authenticated: true,
            hasPasskey: false,
            passkeysSupported: false,
            localBypass: true,
          });
          return true;
        }
        if (!isAuth) {
          req.appSession = { localBypass: true };
          return false;
        }
      }
      if (!config.configured) {
        if (pathname === "/api/auth/session" && req.method === "GET") {
          json(200, {
            configured: false,
            authenticated: false,
            hasPasskey: false,
            passkeysSupported: config.passkeysSupported,
          });
          return true;
        }
        throw new AuthError(
          "Set APP_PASSWORD to at least 20 characters in the server environment.",
          503
        );
      }
      if (!["GET", "HEAD"].includes(req.method)) checkOrigin(req, config);
      const store = getStore(await readBootstrap(), config.origin);
      const state = await store.read();
      const session = sessionFor(state, req, config, now());
      if (!isAuth) {
        if (!session) throw new AuthError("Sign in to your app to continue.", 401);
        req.appSession = session;
        return false;
      }
      const status = (current, active) => ({
        configured: true,
        authenticated: Boolean(active),
        hasPasskey: current.credentials.length > 0,
        passkeysSupported: config.passkeysSupported,
        ...(active
          ? {
              expiresAt: active.expires,
              verifiedAt: active.created,
              remember: active.remember,
              recentlyVerified: now() - active.created < 600000,
              passkeys: current.credentials.map((c) => ({
                id: c.id,
                name: c.name,
                created: c.created,
              })),
            }
          : {}),
      });
      if (pathname === "/api/auth/session" && req.method === "GET") {
        json(200, status(state, session));
        return true;
      }
      if (req.method !== "POST") throw new AuthError("Method not allowed.", 405);
      const body = await readBody(req);
      const createSession = async (remember) => {
        const value = token();
        const next = {
          id: hash(value),
          epoch: config.epoch,
          created: now(),
          expires: now() + (remember ? 90 * DAY : DAY),
          remember,
        };
        const current = await store.update((s) => {
          clean(s, now());
          s.sessions = s.sessions.filter((v) => v.id !== session?.id).slice(-29);
          s.sessions.push(next);
          return s;
        });
        json(200, status(current, next), {
          "Set-Cookie": [
            cookie(SESSION_COOKIE, value, config, remember ? (90 * DAY) / 1000 : undefined),
            cookie(CHALLENGE_COOKIE, "", config, 0),
            "training_coach_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
          ],
        });
      };
      const throttle = async (name, max) => {
        const allowed = await store.update((s) => {
          clean(s, now());
          const limit = (s.limits[name] ||= { count: 0, until: now() + 900000 });
          if (limit.count >= max) return false;
          limit.count++;
          return true;
        });
        if (!allowed) throw new AuthError("Too many attempts. Try again in 15 minutes.", 429);
      };
      if (pathname === "/api/auth/password") {
        await throttle("password", 10);
        if (typeof body?.password !== "string" || !equal(body.password, config.password))
          throw new AuthError("That password is incorrect.", 401);
        await store.update((s) => {
          delete s.limits.password;
        });
        await createSession(body.remember !== false);
        return true;
      }
      if (pathname === "/api/auth/logout") {
        await store.update((s) => {
          clean(s, now());
          s.sessions = s.sessions.filter((v) => v.id !== session?.id);
        });
        json(
          200,
          { ok: true },
          {
            "Set-Cookie": [
              cookie(SESSION_COOKIE, "", config, 0),
              cookie(CHALLENGE_COOKIE, "", config, 0),
            ],
          }
        );
        return true;
      }
      if (pathname === "/api/auth/passkeys/remove") {
        recent(session, now());
        await store.update((s) => {
          recent(sessionFor(s, req, config, now()), now());
          s.credentials = s.credentials.filter((c) => c.id !== body.id);
        });
        json(200, { ok: true });
        return true;
      }
      const register = pathname.startsWith("/api/auth/passkeys/register/");
      const authenticate = pathname.startsWith("/api/auth/passkeys/authenticate/");
      if (!register && !authenticate) throw new AuthError("Not found", 404);
      if (!config.passkeysSupported)
        throw new AuthError("Open http://localhost:4173 to set up a local passkey.");
      if (register) recent(session, now());
      if (pathname.endsWith("/options")) {
        await throttle("passkey", 60);
        if (register && state.credentials.length >= 10)
          throw new AuthError("Remove an old passkey before adding another.");
        if (authenticate && !state.credentials.length)
          throw new AuthError("Sign in with your password to add your first passkey.");
        const current = await store.read();
        const options = register
          ? await generateRegistrationOptions({
              rpName: "AR Performance",
              rpID: config.rpID,
              userName: "athlete",
              userDisplayName: "Your training account",
              userID: Buffer.from(current.userID, "base64url"),
              attestationType: "none",
              authenticatorSelection: { residentKey: "required", userVerification: "required" },
              excludeCredentials: current.credentials.map((c) => ({
                id: c.id,
                transports: c.transports,
              })),
            })
          : await generateAuthenticationOptions({
              rpID: config.rpID,
              userVerification: "required",
              allowCredentials: current.credentials.map((c) => ({
                id: c.id,
                transports: c.transports,
              })),
            });
        const value = token();
        await store.update((s) => {
          clean(s, now());
          s.challenges = s.challenges
            .filter((c) => c.id !== hash(cookies(req, CHALLENGE_COOKIE) || ""))
            .slice(-59);
          s.challenges.push({
            id: hash(value),
            challenge: options.challenge,
            kind: register ? "register" : "authenticate",
            session: register ? session.id : null,
            userID: current.userID,
            expires: now() + 300000,
            remember: body.remember !== false,
          });
        });
        json(200, options, { "Set-Cookie": cookie(CHALLENGE_COOKIE, value, config, 300) });
        return true;
      }
      if (!pathname.endsWith("/verify")) throw new AuthError("Not found", 404);
      const challengeID = hash(cookies(req, CHALLENGE_COOKIE) || "");
      const challenge = await store.update((s) => {
        clean(s, now());
        const c = s.challenges.find((v) => v.id === challengeID);
        s.challenges = s.challenges.filter((v) => v.id !== challengeID);
        return c;
      });
      if (
        !challenge ||
        challenge.kind !== (register ? "register" : "authenticate") ||
        (register && challenge.session !== session.id)
      )
        throw new AuthError("This passkey request expired or was already used. Please try again.");
      try {
        if (register) {
          const result = await verifyRegistrationResponse({
            response: body.response,
            expectedChallenge: challenge.challenge,
            expectedOrigin: config.origin,
            expectedRPID: config.rpID,
            requireUserVerification: true,
          });
          if (!result.verified || !result.registrationInfo) throw new Error();
          const credential = result.registrationInfo.credential;
          await store.update((s) => {
            recent(sessionFor(s, req, config, now()), now());
            if (s.credentials.some((c) => c.id === credential.id) || s.credentials.length >= 10)
              throw new Error();
            s.credentials.push({
              ...credential,
              publicKey: Buffer.from(credential.publicKey).toString("base64url"),
              name:
                typeof body.name === "string"
                  ? body.name.trim().slice(0, 60) || "My passkey"
                  : "My passkey",
              created: now(),
            });
          });
          json(200, { ok: true }, { "Set-Cookie": cookie(CHALLENGE_COOKIE, "", config, 0) });
          return true;
        }
        const saved = (await store.read()).credentials.find((c) => c.id === body.response?.id);
        if (
          !saved ||
          (body.response.response?.userHandle &&
            body.response.response.userHandle !== challenge.userID)
        )
          throw new Error();
        const result = await verifyAuthenticationResponse({
          response: body.response,
          expectedChallenge: challenge.challenge,
          expectedOrigin: config.origin,
          expectedRPID: config.rpID,
          requireUserVerification: true,
          credential: { ...saved, publicKey: Buffer.from(saved.publicKey, "base64url") },
        });
        if (!result.verified) throw new Error();
        await store.update((s) => {
          const c = s.credentials.find((c) => c.id === saved.id);
          if (!c || c.counter !== saved.counter) throw new Error();
          c.counter = result.authenticationInfo.newCounter;
        });
      } catch (error) {
        if (error instanceof AuthError) throw error;
        throw new AuthError(
          "The passkey could not be verified. Please try again or use your password."
        );
      }
      await createSession(challenge.remember);
      return true;
    } catch (error) {
      json(error instanceof AuthError ? error.status : 503, {
        error:
          error instanceof AuthError
            ? error.message
            : "Sign-in storage is unavailable. Please try again.",
      });
      return true;
    }
  };
}
