import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";

/**
 * The build history (the Builds page): one record per build at users/{uid}/builds/{generationId}, readable by its
 * owner and written only here. A record follows its build after it ends: a variant build waits for the customer
 * ("ready"), then becomes "saved" (with the app's name) or "expired". Declined requests are never recorded: their
 * prompt is never stored.
 */

export type BuildOutcome = "updated" | "partial" | "failed" | "stopped" | "ready" | "saved" | "expired";
export type BuildRecord = {
  projectId: string;
  mode: "single" | "variants";
  appName: string;
  /** The customer's request, one line. */
  request: string;
  outcome: BuildOutcome;
  /** Where the row leads: the app, or the versions to choose. */
  href: string;
  credits?: number;
  /** A variant build's versions to choose from. */
  versions?: string[];
};

const record = (uid: string, gid: string) => db.doc(`users/${uid}/builds/${gid}`);
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 200);

/** Records how a build ended (the first write sets its time). Never throws: history must not fail a build. */
export async function recordBuild(uid: string, gid: string, r: BuildRecord): Promise<void> {
  await record(uid, gid).set({ ...r, request: oneLine(r.request), endedAt: FieldValue.serverTimestamp() }, { merge: true })
    .catch((err) => console.error("recordBuild failed", err));
}

/** Changes part of an existing record (credits settled, a version saved, a draft expired). Missing records are skipped. */
export async function updateBuild(uid: string, gid: string, patch: Partial<BuildRecord>): Promise<void> {
  await record(uid, gid).update(patch).catch((err) => {
    if ((err as { code?: number }).code !== 5) console.error("updateBuild failed", err); // 5: NOT_FOUND
  });
}
