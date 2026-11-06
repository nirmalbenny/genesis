import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { createSnapshot, projectRef, replaceFiles, type ProjectFile } from "./files";
import { getUserHl, type Category } from "./projects";

/** `version` is a content hash, so any change to a template's files or text reaches users without a manual bump. */
export type Template = {
  slug: string; name: string; description: string; category: Category; icon: string; version: string; files: ProjectFile[];
};
type Manifest = { apps: Pick<Template, "slug" | "name" | "description" | "category" | "icon">[] };

// Template sources ship with the functions bundle: functions/templates/<slug>/src/**.
const ROOT = path.join(__dirname, "..", "templates");
let cache: { version: string; apps: Template[] } | null = null;

const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

function readDir(dir: string, base: string): ProjectFile[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return readDir(full, base);
    return [{ path: path.relative(base, full).split(path.sep).join("/"), content: fs.readFileSync(full, "utf8") }];
  });
}

export function loadTemplates(): { version: string; apps: Template[] } {
  if (cache) return cache;
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "templates.json"), "utf8")) as Manifest;
  const apps = manifest.apps.map((a) => {
    const files = readDir(path.join(ROOT, a.slug, "src"), path.join(ROOT, a.slug)).sort((x, y) => x.path.localeCompare(y.path));
    return { ...a, files, version: hash(JSON.stringify([a, files])) };
  });
  cache = { version: hash(apps.map((a) => a.version).join()), apps };
  return cache;
}

/** Deterministic id: one copy per user per template, so concurrent seeding can't duplicate. */
export const prebuiltId = (uid: string, slug: string) => `${uid}_${slug}`;

/**
 * Gives the user a locked copy of every template. Idempotent: skipped once the user has the current
 * template set. Copies the user deleted stay deleted; locked copies on an older version are upgraded
 * in place (safe because they can't have been edited).
 */
export async function seedTemplates(uid: string): Promise<{ seeded: number }> {
  const { version, apps } = loadTemplates();
  const userRef = db.doc(`users/${uid}`);
  if ((await userRef.get()).get("templatesVersion") === version) return { seeded: 0 };

  const hl = await getUserHl(uid);
  let seeded = 0;
  for (const t of apps) {
    const pid = prebuiltId(uid, t.slug);
    const ref = projectRef(pid);
    const snap = await ref.get();
    if (snap.exists && (snap.get("deletedAt") || snap.get("templateVersion") === t.version)) continue;

    if (!snap.exists) {
      try {
        await ref.create({
          ownerId: uid,
          name: t.name,
          description: t.description,
          category: t.category,
          icon: t.icon,
          locationId: hl?.locationId ?? null,
          kind: "prebuilt",
          templateSlug: t.slug,
          templateVersion: t.version,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          deletedAt: null,
        });
      } catch (err) {
        if ((err as { code?: number }).code === 6) continue; // ALREADY_EXISTS: a parallel request won
        throw err;
      }
    } else {
      await ref.update({ name: t.name, description: t.description, category: t.category, icon: t.icon, templateVersion: t.version, updatedAt: FieldValue.serverTimestamp() });
    }
    await replaceFiles(pid, t.files);
    await createSnapshot(pid, null, "template", snap.exists ? `Updated ${t.name} to the latest version` : `Ready-made ${t.name}`);
    seeded++;
  }
  await userRef.set({ templatesVersion: version }, { merge: true });
  return { seeded };
}
