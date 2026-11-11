/**
 * HighLevel tokens are stored encrypted (envelope encryption). Each record gets its own random data key (DEK);
 * the tokens are encrypted locally with AES-256-GCM, and the DEK is wrapped by a Cloud KMS key that never
 * leaves KMS. Reading a record needs Firestore access *and* KMS decrypt permission (granted only to the
 * functions' service account). Both layers are bound to `hlTokens/{uid}`, so a record moved to another user's
 * document can't be decrypted. Setup: scripts/setup-token-encryption.sh. Design: docs/ARCHITECTURE.md §11.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import { httpError } from "../http";

export type HlSecrets = { accessToken: string; refreshToken: string };
export type SealedTokens = { v: 1; kek: string; wrappedDek: string; iv: string; tag: string; ciphertext: string };

/** Wraps and unwraps data keys. Cloud KMS in production; a local key on the emulators. */
export type KeyWrapper = {
  wrap(dek: Buffer, aad: Buffer): Promise<{ wrapped: Buffer; keyVersion: string }>;
  unwrap(wrapped: Buffer, aad: Buffer): Promise<Buffer>;
};

const aadFor = (uid: string) => Buffer.from(`hlTokens/${uid}`);

// ---- Cloud KMS (production) ----

/** The project's token key, created by scripts/setup-token-encryption.sh. */
export const kmsKeyName = (project = process.env.GCLOUD_PROJECT ?? "") =>
  `projects/${project}/locations/us-central1/keyRings/genesis/cryptoKeys/hl-tokens`;

let kms: KeyManagementServiceClient | null = null; // created on first use, so functions that never need it don't pay for it

const kmsWrapper: KeyWrapper = {
  async wrap(dek, aad) {
    kms ??= new KeyManagementServiceClient();
    const [res] = await kms.encrypt({ name: kmsKeyName(), plaintext: dek, additionalAuthenticatedData: aad });
    return { wrapped: Buffer.from(res.ciphertext as Uint8Array), keyVersion: res.name ?? "" };
  },
  async unwrap(wrapped, aad) {
    kms ??= new KeyManagementServiceClient();
    // KMS finds the key version from the ciphertext itself; the key name is enough after a rotation.
    const [res] = await kms.decrypt({ name: kmsKeyName(), ciphertext: wrapped, additionalAuthenticatedData: aad });
    return Buffer.from(res.plaintext as Uint8Array);
  },
};

// ---- Local key (emulators and CI only) ----

/** AES-256-GCM key wrapping with a key from LOCAL_TOKEN_KEK (base64, 32 bytes), for the emulators and tests. */
export function localWrapper(keyBase64: string): KeyWrapper {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("LOCAL_TOKEN_KEK must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  return {
    async wrap(dek, aad) {
      return { wrapped: aesSeal(key, dek, aad), keyVersion: "local" };
    },
    async unwrap(wrapped, aad) {
      return aesOpen(key, wrapped, aad);
    },
  };
}

/** KMS in production. The local key is used only on the emulators, never in a deployed function. */
function defaultWrapper(): KeyWrapper {
  if (process.env.FUNCTIONS_EMULATOR !== "true") return kmsWrapper;
  const local = process.env.LOCAL_TOKEN_KEK;
  if (!local) throw new Error("LOCAL_TOKEN_KEK is not set in functions/.env.local (see .env.example)");
  return localWrapper(local);
}

// ---- AES-256-GCM (iv | tag | ciphertext) ----

function aesSeal(key: Buffer, plain: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv).setAAD(aad);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

function aesOpen(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  const d = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12)).setAAD(aad);
  d.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
}

// ---- Seal / open ----

/** Encrypts a user's tokens with a fresh data key, wrapped by KMS. */
export async function seal(uid: string, secrets: HlSecrets, wrapper: KeyWrapper = defaultWrapper()): Promise<SealedTokens> {
  const aad = aadFor(uid);
  const dek = randomBytes(32);
  const { wrapped, keyVersion } = await wrapper.wrap(dek, aad);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dek, iv).setAAD(aad);
  const ciphertext = Buffer.concat([c.update(JSON.stringify(secrets), "utf8"), c.final()]);
  dek.fill(0);
  return {
    v: 1,
    kek: keyVersion,
    wrappedDek: wrapped.toString("base64"),
    iv: iv.toString("base64"),
    tag: c.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

// Decrypted tokens are kept in memory briefly, so the proxy doesn't call KMS on every request. The key is the
// stored ciphertext itself: a refresh, reconnect or another user means a different record and a cache miss,
// and a disconnect deletes the record, which the caller's Firestore read sees before ever reaching the cache.
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 1000;
const cache = new Map<string, { secrets: HlSecrets; until: number }>();
const cacheKey = (uid: string, s: SealedTokens) =>
  createHash("sha256").update(`${uid}\n${s.wrappedDek}\n${s.ciphertext}`).digest("base64");

/** Decrypts a sealed record. Fails closed (503) if KMS is unavailable or the record was tampered with. */
export async function open(uid: string, sealed: SealedTokens, wrapper: KeyWrapper = defaultWrapper()): Promise<HlSecrets> {
  const key = cacheKey(uid, sealed);
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.secrets;
  cache.delete(key);

  let secrets: HlSecrets;
  try {
    const aad = aadFor(uid);
    const dek = await wrapper.unwrap(Buffer.from(sealed.wrappedDek, "base64"), aad);
    const d = createDecipheriv("aes-256-gcm", dek, Buffer.from(sealed.iv, "base64")).setAAD(aad);
    d.setAuthTag(Buffer.from(sealed.tag, "base64"));
    const plain = Buffer.concat([d.update(Buffer.from(sealed.ciphertext, "base64")), d.final()]);
    dek.fill(0);
    secrets = JSON.parse(plain.toString("utf8")) as HlSecrets;
  } catch (err) {
    // Never include the record or the error's details: they could carry key material.
    console.error("tokenVault: could not decrypt HighLevel tokens", { uid, error: (err as Error).name, code: (err as { code?: unknown }).code });
    throw httpError(503, "hl_tokens_unavailable", "HighLevel credentials can't be read right now. Try again, or reconnect HighLevel.");
  }

  cache.set(key, { secrets, until: Date.now() + CACHE_TTL_MS });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!); // drop the oldest
  return secrets;
}
