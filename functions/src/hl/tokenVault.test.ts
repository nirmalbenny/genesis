import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { kmsKeyName, localWrapper, open, seal, type KeyWrapper, type SealedTokens } from "./tokenVault";

const secrets = { accessToken: "access-123", refreshToken: "refresh-456" };

/** The local wrapper, counting calls the way a KMS bill would. */
function countingWrapper() {
  const inner = localWrapper(randomBytes(32).toString("base64"));
  const calls = { wrap: 0, unwrap: 0 };
  const wrapper: KeyWrapper = {
    wrap: (dek, aad) => { calls.wrap++; return inner.wrap(dek, aad); },
    unwrap: (w, aad) => { calls.unwrap++; return inner.unwrap(w, aad); },
  };
  return { wrapper, calls };
}

const flip = (b64: string) => {
  const b = Buffer.from(b64, "base64");
  b[0] = b[0]! ^ 1;
  return b.toString("base64");
};

test("seal then open returns the tokens, and the stored record holds no plain text", async () => {
  const { wrapper } = countingWrapper();
  const sealed = await seal("u1", secrets, wrapper);
  assert.equal(sealed.v, 1);
  assert.ok(!JSON.stringify(sealed).includes("access-123"));
  assert.ok(!JSON.stringify(sealed).includes("refresh-456"));
  assert.deepEqual(await open("u1", sealed, wrapper), secrets);
});

test("every seal uses a fresh data key and IV", async () => {
  const { wrapper } = countingWrapper();
  const [a, b] = await Promise.all([seal("u1", secrets, wrapper), seal("u1", secrets, wrapper)]);
  assert.notEqual(a.wrappedDek, b.wrappedDek);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test("a tampered record is refused with a clean 503", async () => {
  const { wrapper } = countingWrapper();
  const sealed = await seal("u2", secrets, wrapper);
  for (const field of ["ciphertext", "tag", "iv", "wrappedDek"] as const) {
    const bad: SealedTokens = { ...sealed, [field]: flip(sealed[field]) };
    await assert.rejects(open("u2", bad, wrapper), (e: { status?: number; code?: string; message: string }) => {
      assert.equal(e.status, 503);
      assert.equal(e.code, "hl_tokens_unavailable");
      assert.ok(!e.message.includes("access-123"), "no secrets in the error");
      return true;
    }, field);
  }
});

test("a record copied to another user's document can't be decrypted", async () => {
  const { wrapper } = countingWrapper();
  const sealed = await seal("owner", secrets, wrapper);
  await assert.rejects(open("someone-else", sealed, wrapper), { code: "hl_tokens_unavailable" });
});

test("repeated reads are served from memory; a new record misses the cache", async () => {
  const { wrapper, calls } = countingWrapper();
  const first = await seal("u3", secrets, wrapper);
  await open("u3", first, wrapper);
  await open("u3", first, wrapper);
  await open("u3", first, wrapper);
  assert.equal(calls.unwrap, 1, "one unwrap for three reads");
  const refreshed = await seal("u3", { accessToken: "access-new", refreshToken: "refresh-new" }, wrapper);
  assert.equal((await open("u3", refreshed, wrapper)).accessToken, "access-new");
  assert.equal(calls.unwrap, 2);
});

test("the local key must be 32 bytes", () => {
  assert.throws(() => localWrapper(Buffer.from("short").toString("base64")), /32 bytes/);
});

test("the KMS key path follows the project", () => {
  assert.equal(kmsKeyName("my-proj"), "projects/my-proj/locations/us-central1/keyRings/genesis/cryptoKeys/hl-tokens");
});
