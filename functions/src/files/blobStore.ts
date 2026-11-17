import { bucket } from "../admin";
import { contentHash } from "./describe";

/**
 * File content in Cloud Storage, addressed by its SHA-256: users/{uid}/blobs/{hash}. Content is immutable, so
 * identical files (unchanged files across snapshots, duplicated apps) are stored once per user.
 */
export interface BlobStore {
  /** Stores the content if absent and returns its hash. */
  put(uid: string, content: string): Promise<string>;
  get(uid: string, hash: string): Promise<string>;
}

export const blobPath = (uid: string, hash: string) => `users/${uid}/blobs/${hash}`;

/** A bounded least-recently-used cache by total size. Safe for blobs: a hash always maps to the same content. */
export function createLru(maxBytes: number) {
  const items = new Map<string, string>();
  let bytes = 0;
  return {
    get(key: string): string | undefined {
      const v = items.get(key);
      if (v !== undefined) { items.delete(key); items.set(key, v); } // most recently used last
      return v;
    },
    set(key: string, value: string) {
      if (items.has(key)) return;
      const size = Buffer.byteLength(value);
      if (size > maxBytes) return;
      items.set(key, value);
      bytes += size;
      for (const [k, v] of items) {
        if (bytes <= maxBytes) break;
        items.delete(k);
        bytes -= Buffer.byteLength(v);
      }
    },
    get size() { return items.size; },
  };
}

const CACHE_BYTES = 32 * 1024 * 1024; // per instance; generate has 512 MiB

/**
 * The Cloud Storage blob store.
 *
 * `put` uploads with `ifGenerationMatch: 0` (create only). When the blob already exists it bumps the blob's
 * `customTime` instead: the cleanup job deletes only blobs that are unreferenced AND untouched for 7 days, with a
 * metageneration precondition, so a blob re-referenced while cleanup runs is never deleted (docs/plans, R2).
 */
export function createStorageBlobStore(): BlobStore {
  const cache = createLru(CACHE_BYTES);
  return {
    async put(uid, content) {
      const hash = contentHash(content);
      const file = bucket().file(blobPath(uid, hash));
      const now = new Date().toISOString();
      try {
        await file.save(content, {
          resumable: false,
          contentType: "text/plain; charset=utf-8",
          metadata: { customTime: now },
          preconditionOpts: { ifGenerationMatch: 0 },
        });
      } catch (err) {
        if ((err as { code?: number }).code !== 412) throw err;
        // Already stored: mark it as referenced again. GCS refuses to move customTime back (a peer instance's
        // clock may be ahead); then it is recent anyway.
        await file.setMetadata({ customTime: now }).catch((e: { code?: number }) => { if (e.code !== 400) throw e; });
      }
      cache.set(`${uid}/${hash}`, content);
      return hash;
    },

    async get(uid, hash) {
      const key = `${uid}/${hash}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const [buf] = await bucket().file(blobPath(uid, hash)).download();
      const content = buf.toString("utf8");
      cache.set(key, content);
      return content;
    },
  };
}
