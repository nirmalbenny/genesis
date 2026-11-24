import type { File } from "@google-cloud/storage";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { bucket as defaultBucket, db } from "../admin";
import { BLOB_CLEANUP } from "../config";
import { expireDrafts } from "../projects";
import type { Manifest } from "./index";

/**
 * Deletes file content nobody references any more: blobs under users/{uid}/blobs/ that no project manifest or
 * snapshot manifest of that user points at, and that have not been (re)referenced for GRACE_DAYS. Manual saves
 * leave one superseded blob each; generations and restores never do (their snapshots keep every version).
 *
 * Race safety: `put` bumps a reused blob's customTime, which also bumps its metageneration. The delete carries
 * `ifMetagenerationMatch` from the listing, so a blob reused after it was listed is never deleted.
 */
export const GRACE_DAYS = 7;
const DAY_MS = 86_400_000;
const BLOB = /^users\/([^/]+)\/blobs\/([0-9a-f]{64})$/;

export type CleanupReport = { scanned: number; referenced: number; young: number; deleted: number; skippedChanged: number; dryRun: boolean };

/** uid → hashes referenced by that user's projects and snapshots (soft-deleted projects included: they can come back). */
async function referencedHashes(uids?: Set<string>): Promise<Map<string, Set<string>>> {
  const owners = new Map<string, string>(); // pid → uid
  const refs = new Map<string, Set<string>>();
  const add = (uid: string, manifest: Manifest | undefined) => {
    if (!manifest) return;
    const set = refs.get(uid) ?? new Set<string>();
    for (const e of Object.values(manifest)) set.add(e.hash);
    refs.set(uid, set);
  };
  for (const p of (await db.collection("projects").select("ownerId", "manifest").get()).docs) {
    const uid = p.get("ownerId") as string;
    owners.set(p.id, uid);
    if (!uids || uids.has(uid)) add(uid, p.get("manifest"));
  }
  for (const s of (await db.collectionGroup("snapshots").select("manifest").get()).docs) {
    const uid = owners.get(s.ref.parent.parent!.id);
    if (uid && (!uids || uids.has(uid))) add(uid, s.get("manifest"));
  }
  return refs;
}

/** Deletes `file` only if its metadata hasn't changed since it was listed. False when it changed (kept). */
export async function deleteIfUnchanged(file: File, metageneration: string | number): Promise<boolean> {
  try {
    await file.delete({ ifMetagenerationMatch: Number(metageneration) });
    return true;
  } catch (err) {
    if ((err as { code?: number }).code === 412) return false;
    throw err;
  }
}

export async function cleanupBlobs(opts: {
  dryRun: boolean; now?: number; bucket?: string; uids?: string[]; log?: (line: string) => void;
}): Promise<CleanupReport> {
  const log = opts.log ?? ((line: string) => console.info(line));
  const now = opts.now ?? Date.now();
  const bucket = opts.bucket ? getStorage().bucket(opts.bucket) : defaultBucket();
  const uids = opts.uids ? new Set(opts.uids) : undefined;
  // References are read BEFORE listing: a blob uploaded after this point is younger than the grace period.
  const refs = await referencedHashes(uids);
  const report: CleanupReport = { scanned: 0, referenced: 0, young: 0, deleted: 0, skippedChanged: 0, dryRun: opts.dryRun };
  const prefixes = uids ? [...uids].map((u) => `users/${u}/blobs/`) : ["users/"];
  for (const prefix of prefixes) {
    const [files] = await bucket.getFiles({ prefix });
    for (const file of files) {
      const m = BLOB.exec(file.name);
      if (!m) continue;
      report.scanned++;
      const [, uid, hash] = m;
      if (refs.get(uid!)?.has(hash!)) { report.referenced++; continue; }
      const touched = Date.parse(String(file.metadata.customTime ?? file.metadata.timeCreated ?? ""));
      if (!Number.isFinite(touched) || now - touched < GRACE_DAYS * DAY_MS) { report.young++; continue; }
      if (opts.dryRun) { report.deleted++; log(`would delete ${file.name}`); continue; }
      if (await deleteIfUnchanged(file, file.metadata.metageneration ?? 0)) report.deleted++;
      else report.skippedChanged++;
    }
  }
  log(`blob cleanup${opts.dryRun ? " (dry run)" : ""}: ${JSON.stringify(report)}`);
  return report;
}

/** Daily. BLOB_CLEANUP=dry-run (default) only logs what it would delete; `delete` deletes. */
export const cleanupFileBlobs = onSchedule({ schedule: "every day 03:30", timeZone: "Etc/UTC", timeoutSeconds: 540 }, async () => {
  console.info(`draft cleanup: ${await expireDrafts()} expired`);
  await cleanupBlobs({ dryRun: BLOB_CLEANUP.value() !== "delete" });
});
