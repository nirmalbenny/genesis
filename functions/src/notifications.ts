import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";

/**
 * Notifications when a build ends: users/{uid}/notifications/{id}, readable by their owner, written only here. The
 * browser shows a new one as a toast and lists them all in the notifications panel; a build that ends while no page
 * is open is still there later.
 */

export type NotificationKind = "build_done" | "build_partial" | "build_failed" | "versions_ready";
export type Notification = { kind: NotificationKind; title: string; body: string; href: string; projectId: string; generationId: string };

const MAX_READ_BATCH = 200;
const notifications = (uid: string) => db.collection(`users/${uid}/notifications`);

/** Records a notification. Never throws: a lost notification must not fail the build that sent it. */
export async function notify(uid: string, n: Notification): Promise<void> {
  await notifications(uid).add({ ...n, read: false, createdAt: FieldValue.serverTimestamp() })
    .catch((err) => console.error("notify failed", err));
}

/** Marks the given notifications read, or every unread one (at most MAX_READ_BATCH) when no ids are given. */
export async function markRead(uid: string, ids: unknown): Promise<{ marked: number }> {
  const refs = Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string" && /^[\w-]{1,64}$/.test(id)).slice(0, MAX_READ_BATCH).map((id) => notifications(uid).doc(id))
    : (await notifications(uid).where("read", "==", false).limit(MAX_READ_BATCH).get()).docs.map((d) => d.ref);
  if (!refs.length) return { marked: 0 };
  const batch = db.batch();
  // update() would fail the whole batch on an id that doesn't exist; set-merge on one that doesn't would create it.
  const existing = (await db.getAll(...refs)).filter((s) => s.exists);
  existing.forEach((s) => batch.update(s.ref, { read: true }));
  await batch.commit();
  return { marked: existing.length };
}
