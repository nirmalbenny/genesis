/**
 * Backfill: gives every project (and every snapshot) a manifest, with its content in Storage, so nothing has to
 * be converted on first access after FILE_STORE=blobs. Firestore file documents are never deleted.
 *
 *   GCLOUD_PROJECT=<project> npm run migrate:files -- --bucket <bucket> [--project <id>]… [--dry-run] [--allow-production]
 *
 * - Resumable: projects and snapshots that already have a manifest are skipped, so it can be re-run after a stop.
 * - Verified: every uploaded file is downloaded again (no cache) and its hash compared with the Firestore content.
 * - Emulator by default: it refuses to run unless FIRESTORE_EMULATOR_HOST and FIREBASE_STORAGE_EMULATOR_HOST are
 *   set, or --allow-production is given. Run it in production only with FILE_STORE still `firestore` or already
 *   `blobs`, never during the deploy that flips it (docs/plans/filestore-and-context.md).
 */
import { db } from "../admin";
import { createStorageBlobStore, type BlobStore } from "../files/blobStore";
import { contentHash } from "../files/describe";
import type { Manifest, ProjectFile } from "../files/index";
import { createMigrator } from "../files/migrate";

export type MigrationReport = {
  projects: number; migrated: number; skipped: number; snapshots: number; files: number; bytes: number;
  failures: { project: string; error: string }[];
};

const filesOf = async (ref: FirebaseFirestore.DocumentReference): Promise<ProjectFile[]> =>
  (await ref.collection("files").get()).docs.map((d) => ({ path: d.get("path") as string, content: d.get("content") as string }));

/** Downloads every file of `manifest` again and checks it is byte-identical to the Firestore source. */
async function verify(verifier: BlobStore, uid: string, manifest: Manifest, files: ProjectFile[]): Promise<void> {
  if (Object.keys(manifest).length !== files.length) throw new Error(`manifest has ${Object.keys(manifest).length} files, Firestore ${files.length}`);
  await Promise.all(files.map(async (f) => {
    const entry = manifest[f.path];
    if (!entry || entry.hash !== contentHash(f.content)) throw new Error(`${f.path}: manifest hash differs from Firestore`);
    if (contentHash(await verifier.get(uid, entry.hash)) !== entry.hash) throw new Error(`${f.path}: stored content differs`);
  }));
}

export async function migrateAll(opts: {
  bucket?: string; dryRun: boolean; projectIds?: string[]; log?: (line: string) => void;
}): Promise<MigrationReport> {
  const log = opts.log ?? console.log;
  const blobs = createStorageBlobStore({ bucket: opts.bucket });
  const verifier = createStorageBlobStore({ bucket: opts.bucket, cache: false });
  const migrator = createMigrator(blobs);
  const report: MigrationReport = { projects: 0, migrated: 0, skipped: 0, snapshots: 0, files: 0, bytes: 0, failures: [] };

  const docs = opts.projectIds
    ? (await db.getAll(...opts.projectIds.map((id) => db.doc(`projects/${id}`)))).filter((d) => d.exists)
    : (await db.collection("projects").get()).docs;
  for (const doc of docs) {
    report.projects++;
    const uid = doc.get("ownerId") as string;
    try {
      const legacySnapshots = (await doc.ref.collection("snapshots").get()).docs.filter((s) => s.get("manifest") === undefined);
      if (doc.get("manifest") !== undefined && !legacySnapshots.length) { report.skipped++; continue; }
      const files = await filesOf(doc.ref);
      report.files += files.length;
      report.bytes += files.reduce((n, f) => n + Buffer.byteLength(f.content), 0);
      if (opts.dryRun) {
        log(`would migrate ${doc.id}: ${files.length} files, ${legacySnapshots.length} snapshots`);
        report.migrated++;
        report.snapshots += legacySnapshots.length;
        continue;
      }
      if (doc.get("manifest") === undefined) {
        await migrator.project(doc.id, uid);
        const manifest = (await doc.ref.get()).get("manifest") as Manifest;
        // A change committed while this ran (blobs mode) wins over the Firestore copy: verify only an unchanged one.
        if ((await doc.ref.get()).get("manifestVersion") === ((doc.get("manifestVersion") as number | undefined) ?? 0) + 1) {
          await verify(verifier, uid, manifest, files);
        }
      }
      for (const s of legacySnapshots) {
        const manifest = await migrator.snapshot(uid, s.ref);
        await verify(verifier, uid, manifest, await filesOf(s.ref));
        report.snapshots++;
      }
      report.migrated++;
      log(`migrated ${doc.id}: ${files.length} files, ${legacySnapshots.length} snapshots`);
    } catch (err) {
      report.failures.push({ project: doc.id, error: err instanceof Error ? err.message : String(err) });
      log(`FAILED ${doc.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return report;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.includes(name);
  const bucket = args[args.indexOf("--bucket") + 1];
  const onEmulators = !!process.env.FIRESTORE_EMULATOR_HOST && !!process.env.FIREBASE_STORAGE_EMULATOR_HOST;
  if (!args.includes("--bucket") || !bucket) {
    console.error("Usage: npm run migrate:files -- --bucket <bucket> [--dry-run] [--allow-production]");
    process.exit(2);
  }
  if (!onEmulators && !flag("--allow-production")) {
    console.error("Refusing to run against production: set the emulator hosts, or pass --allow-production deliberately.");
    process.exit(2);
  }
  const projectIds = args.flatMap((a, i) => (a === "--project" && args[i + 1] ? [args[i + 1]!] : []));
  migrateAll({ bucket, dryRun: flag("--dry-run"), projectIds: projectIds.length ? projectIds : undefined }).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.failures.length ? 1 : 0);
  }, (err) => {
    console.error(err);
    process.exit(1);
  });
}
