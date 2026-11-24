import { db } from "./admin";
import { httpError } from "./http";
import { projectRef } from "./files";
import { updateBuild } from "./buildHistory";

/** App catalog categories (duplicated in frontend/src/lib/catalog.ts). */
export const CATEGORIES = ["sales", "service", "scheduling", "insights", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const toCategory = (v: unknown): Category => (CATEGORIES.includes(v as Category) ? (v as Category) : "other");

export type Project = {
  ownerId: string;
  name: string;
  description: string;
  locationId: string | null;
  category?: Category;
  /** Icon key shown on the catalog card; the UI falls back to the category's icon. */
  icon?: string | null;
  /** Prebuilt copies are seeded from templates and locked; everything else is a user app. */
  kind?: "prebuilt" | "user";
  templateSlug?: string;
  templateVersion?: string;
  /** A variant build's app before the customer saves one version (docs/plans/build-variants.md): hidden from lists. */
  draft?: { generationId: string; expiresAt: FirebaseFirestore.Timestamp } | null;
};

/** Loads a project and checks it belongs to `uid` and is not soft-deleted. */
export async function getOwnedProject(uid: string, pid: string): Promise<Project> {
  const snap = await projectRef(pid).get();
  const d = snap.data();
  if (!snap.exists || !d || d.ownerId !== uid || d.deletedAt) throw httpError(404, "not_found", "Project not found");
  return d as Project;
}

/** Prebuilt copies can only be launched or copied; any change goes into a copy. */
export function assertEditable(project: Project): void {
  if (project.kind === "prebuilt") throw httpError(409, "app_locked", "Ready-made apps can't be changed. Make a copy to edit it.");
}

/**
 * Apps are not tied to a sub-account: they always run on whichever location is connected now.
 * `locationId` records the location the app last ran on.
 */
export async function useConnectedLocation(pid: string, project: Project, locationId: string): Promise<void> {
  if (project.locationId === locationId) return;
  await projectRef(pid).update({ locationId });
  project.locationId = locationId;
}

export async function getUserHl(uid: string): Promise<{ locationId: string; locationName: string } | null> {
  const snap = await db.doc(`users/${uid}`).get();
  return (snap.get("hl") as { locationId: string; locationName: string } | null) ?? null;
}

/** Days a variant build's versions wait for the customer to save one. */
export const DRAFT_DAYS = 7;

/** Deletes (soft) the drafts nobody saved within DRAFT_DAYS; their content then goes with the daily blob cleanup. */
export async function expireDrafts(now = Date.now()): Promise<number> {
  const stale = await db.collection("projects").where("draft.expiresAt", "<", new Date(now)).get();
  await Promise.all(stale.docs.filter((d) => !d.get("deletedAt")).map(async (d) => {
    await d.ref.update({ deletedAt: new Date(now) });
    await updateBuild(d.get("ownerId"), d.get("draft.generationId"), { outcome: "expired", href: "/" });
  }));
  return stale.size;
}
