/**
 * Shared setup for the integration tests (`npm run test:e2e`). They run against the Firebase emulators
 * (auth, firestore, functions) and never call Claude or HighLevel: state that would need them (a running
 * build, a HighLevel connection) is seeded directly with the Admin SDK.
 */
import fs from "node:fs";
import path from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { localWrapper, seal } from "../hl/tokenVault";

const rc = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", ".firebaserc"), "utf8"));
export const PROJECT = process.env.GCLOUD_PROJECT ?? (rc.projects.default as string);
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
export const FN = `http://${process.env.FUNCTIONS_EMULATOR_HOST ?? "127.0.0.1:5001"}/${PROJECT}/us-central1`;

/** The emulator's token key (functions/.env.local), so seeded tokens are sealed exactly as the functions seal them. */
const LOCAL_TOKEN_KEK = process.env.LOCAL_TOKEN_KEK
  ?? fs.readFileSync(path.join(__dirname, "..", "..", ".env.local"), "utf8").match(/^LOCAL_TOKEN_KEK=(.+)$/m)?.[1]?.trim()
  ?? "";
export const tokenWrapper = localWrapper(LOCAL_TOKEN_KEK);

const app = getApps().find((a) => a.name === "e2e") ?? initializeApp({ projectId: PROJECT }, "e2e");
export const db = getFirestore(app);
const auth = getAuth(app);

export type TestUser = { uid: string; email: string; token: string };

/** Creates a user and signs in. Verified users get a fresh ID token carrying email_verified. */
export async function newUser(opts: { verified?: boolean } = {}): Promise<TestUser> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = "e2e-password-1";
  const { uid } = await auth.createUser({ email, password, emailVerified: opts.verified ?? true });
  const res = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=e2e`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const { idToken } = (await res.json()) as { idToken: string };
  return { uid, email, token: idToken };
}

/** Marks the user as connected to a HighLevel location (what the OAuth callback stores). */
export async function connectHl(u: TestUser, locationId = "loc-e2e", tokenLocationId = locationId, scope = ""): Promise<void> {
  await db.doc(`users/${u.uid}`).set({ hl: { locationId, locationName: "E2E location" } }, { merge: true });
  // A token far from expiry, so no refresh call to HighLevel is ever attempted. Sealed, as the callback stores it.
  await db.doc(`hlTokens/${u.uid}`).set({
    sealed: await seal(u.uid, { accessToken: "e2e-access", refreshToken: "e2e-refresh" }, tokenWrapper),
    expiresAt: Date.now() + 3_600_000,
    locationId: tokenLocationId,
    scope,
  });
}

export type Reply = { status: number; headers: Headers; body: { error?: { code: string; message: string; retryAfter?: number } } & Record<string, unknown> };

/** Calls a Cloud Function (`api/...`, `generate`, `hlProxy/...`) as the user. */
export async function call(u: TestUser | null, method: string, route: string, body?: unknown): Promise<Reply> {
  const res = await fetch(`${FN}/${route}`, {
    method,
    headers: { ...(u ? { Authorization: `Bearer ${u.token}` } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: (await res.json().catch(() => ({}))) as Reply["body"] };
}

/** Creates an app for a connected user and returns its id. */
export async function createApp(u: TestUser, name = "E2E app"): Promise<string> {
  const r = await call(u, "POST", "api/projects", { name, description: "Created by an integration test" });
  if (r.status !== 200) throw new Error(`createApp failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
}
