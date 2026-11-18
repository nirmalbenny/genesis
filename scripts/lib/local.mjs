// Shared by the local scripts (eval, inspector, screenshots): the emulators' settings, the functions build
// (functions/lib, so run `cd functions && npm run build` first) and finding an app. Emulators only: importing this
// points every Firebase client at them, never at production.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const fnRequire = createRequire(`${ROOT}functions/package.json`);
export const feRequire = createRequire(`${ROOT}frontend/package.json`);

// The same emulator settings and file store as the functions emulator.
for (const line of readFileSync(`${ROOT}functions/.env.local`, "utf8").split("\n")) {
  const m = /^(FILE_STORE)=(.*)$/.exec(line.trim());
  if (m) process.env[m[1]] ??= m[2];
}
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";
process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";
process.env.GCLOUD_PROJECT ??= "genesisaibuilder";
// What the functions runtime provides (the default bucket for the blob store).
process.env.FIREBASE_CONFIG ??= JSON.stringify({ projectId: "genesisaibuilder", storageBucket: "genesisaibuilder.firebasestorage.app" });

export const FN = "http://127.0.0.1:5001/genesisaibuilder/us-central1";

/** The uid of a local account, by email. */
export async function uidOf(email) {
  fnRequire("./lib/admin"); // initializes the Admin SDK
  const { getAuth } = fnRequire("firebase-admin/auth");
  return (await getAuth().getUserByEmail(email)).uid;
}

/**
 * A user's app (or anyone's, without an email) by id, by name (the most recently updated one with that name, any
 * case) or "latest" (the most recently updated one they built, ready-made apps excluded). Deleted apps are skipped
 * unless given by id.
 */
export async function findApp(arg, email) {
  const { db } = fnRequire("./lib/admin");
  const byId = await db.doc(`projects/${arg}`).get();
  if (byId.exists) return { id: byId.id, ...byId.data() };
  const owner = email ? await uidOf(email) : null;
  const snap = owner ? await db.collection("projects").where("ownerId", "==", owner).get() : await db.collection("projects").get();
  const time = (d) => d.data().updatedAt?.toMillis?.() ?? 0;
  const apps = snap.docs
    .filter((d) => !d.data().deletedAt && (arg === "latest" ? d.data().kind !== "template" : d.data().name?.toLowerCase() === arg.toLowerCase()))
    .sort((a, b) => time(b) - time(a));
  if (!apps.length) throw new Error(`No app ${arg === "latest" ? "built yet" : `"${arg}"`}${email ? ` for ${email}` : ""}.`);
  return { id: apps[0].id, ...apps[0].data() };
}
