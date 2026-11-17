/**
 * Emulator settings for the test process. Imported first by helpers.ts: functions code imported by tests
 * (via http.ts → admin.ts) creates its Firestore and Storage clients on import and must see these.
 */
import fs from "node:fs";
import path from "node:path";

const rc = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "..", ".firebaserc"), "utf8"));
export const PROJECT = (process.env.GCLOUD_PROJECT ??= rc.projects.default as string);
export const AUTH_HOST = (process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099");
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
export const STORAGE_HOST = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199");
