import { test } from "node:test";
import assert from "node:assert/strict";
import type { File } from "@google-cloud/storage";
import { deleteIfUnchanged } from "./cleanup";

/** A file whose metageneration moves when it is touched, and whose delete honors ifMetagenerationMatch. */
function fakeFile(metageneration: number) {
  const state = { metageneration, deleted: false };
  const file = {
    async delete(opts: { ifMetagenerationMatch: number }) {
      if (opts.ifMetagenerationMatch !== state.metageneration) throw Object.assign(new Error("Precondition Failed"), { code: 412 });
      state.deleted = true;
    },
  } as unknown as File;
  return { file, state };
}

test("a blob is deleted only if it is unchanged since it was listed", async () => {
  const unchanged = fakeFile(1);
  assert.equal(await deleteIfUnchanged(unchanged.file, "1"), true);
  assert.equal(unchanged.state.deleted, true);

  const reused = fakeFile(1);
  reused.state.metageneration = 2; // put() bumped customTime after the listing
  assert.equal(await deleteIfUnchanged(reused.file, "1"), false);
  assert.equal(reused.state.deleted, false);
});

test("other delete errors are not swallowed", async () => {
  const file = { delete: async () => { throw Object.assign(new Error("forbidden"), { code: 403 }); } } as unknown as File;
  await assert.rejects(deleteIfUnchanged(file, 1), /forbidden/);
});
