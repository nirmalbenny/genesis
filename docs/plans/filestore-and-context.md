# Plan: file storage in Cloud Storage and smart build context

Branch `feat/filestore-context` (from `main` at `03bd8f7`). Not pushed, never deployed.

Status: **Phase 3, Step 7**.

## Contents

- [1. Verification log](#1-verification-log)
- [2. Baseline](#2-baseline)
- [3. Plan evaluation](#3-plan-evaluation)
- [4. Design](#4-design)
- [5. Step checklist](#5-step-checklist)
- [6. Change log](#6-change-log)
- [7. Deviations and open questions](#7-deviations-and-open-questions)
- [8. Measurements](#8-measurements)

## 1. Verification log

Line numbers refer to `main` at `03bd8f7` (`functions/src/files.ts` became `functions/src/files/firestoreStore.ts` in Step 1).

| # | Finding | Result | Evidence |
|---|---|---|---|
| 1 | Files live in Firestore `projects/{pid}/files/{encodeURIComponent(path)}` = `{path, content, updatedAt}` | Confirmed | `functions/src/files.ts:22` (`fileId`), `:42-45` (`writeFileDoc`) |
| 2 | Snapshots copy every file into `snapshots/{sid}/files/*` | Confirmed, plus: the snapshot doc is written **before** its files, in a separate commit, so a failure leaves a snapshot with missing files | `files.ts:58-71` |
| 3 | Writes are committed in chunks of 400; a failure can leave a project partly written | Confirmed. Also `replaceFiles` (restore, template upgrade) deletes and writes in the same chunked, non-atomic way | `files.ts:18`, `:34-40`, `:74-82` |
| 4 | The browser never reads files from Firestore; only messages, projects and users listeners | Confirmed. Listeners: messages (`useProject.ts:40`), projects (`useApps.ts:42`, also mounted by `SideNav`), users (`useCredits.ts:26`, `useHl.ts:30`). But `firestore.rules` still **allows** owners to read `projects/{pid}/{sub=**}`, files included, and `rules.e2e.ts:59` asserts it | `firestore.rules:18-27` |
| 5 | File access is centralized in `files.ts`, except `readFile` and `saveFile` | Different: more callers bypass or compose it. `api.ts:136` (`readFile`, direct read), `:150` (`saveFile`, `writeFileDoc`), `:158` (`listSnapshots` queries `snapshots` directly), `:56-73` (`duplicateProject` = `readFiles` + `applyOps` + `createSnapshot`), `:47` (`createProject` seeds with `applyOps`), `templates.ts:84-85` (`replaceFiles` + `createSnapshot`), `generate.ts:63,209,216` | grep of `functions/src` |
| 6 | `generate` sends all files alphabetically via `renderFiles` up to 60,000 chars; > 20,000 or over budget → `[omitted: too large for context]`; one stream, `max_tokens` 16,000 | Confirmed, with nuance: an omitted file does not stop the loop (`continue`), so smaller files after it still fit; the same omission text is used for both reasons | `prompt.ts:8-9,79-91`, `files.ts:30` (sort), `generate.ts:18,132` |
| 7 | `validateOps(ops, existing)` doesn't know what the model saw | Confirmed | `validate.ts:28`, `generate.ts:205-206` |
| 8 | One ledger hold `${gid}-hold`; settle charges `min(held, actual)` | Confirmed. Settle writes `${gid}-charge` (idempotent) and releases `held` from `reserved` | `credits.ts:102,116`, `generate.ts:175` |
| 9 | Generation docs don't record changed files | Confirmed. The paths go only to the SSE `done`/`cancelled` event and the assistant message text ("Files: …") | `generate.ts:236,240-245,259-261` |
| 10 | No Storage config; `admin.ts` initializes only Firestore and Auth | Confirmed. Also: `deploy.yml` runs `firebase deploy` **without `--only`**, so adding `storage` to `firebase.json` makes the next deploy from `main` deploy `storage.rules` (see risk R1) | `firebase.json`, `admin.ts:1-8`, `deploy.yml` last step |
| 11 | `rules.e2e.ts` and `accounts.e2e.ts` assume files live in Firestore | Partly. `rules.e2e.ts:59-60,75` reads and patches file docs directly. `accounts.e2e.ts` uses only the API (`:55-59`, `:99-103`), so it is storage-agnostic | |
| 12 | `templates.test.ts` calls `validateOps(ops, new Set())` | Confirmed | `templates.test.ts:11` |

Also found:

- `@google-cloud/storage` is already installed (optional dependency of `firebase-admin`), so `firebase-admin/storage` needs **no new dependency**.
- `createProject` writes `SEED_FILES` with no snapshot; `duplicateProject` writes then snapshots (`copy`).
- `generate` reads all file contents before the credit hold (`generate.ts:62-65`).

## 2. Baseline

`verify` on `main` (`03bd8f7`) before any change, emulators running locally:

| Step | Result |
|---|---|
| Functions lint / unit tests | pass, 38/38 |
| Integration tests | pass, 32/32 |
| Frontend lint / tests / build | pass, 34/34, build ok |

## 3. Plan evaluation

### Risks and gaps found

| ID | Risk or gap | Severity | Action |
|---|---|---|---|
| R1 | `deploy.yml` deploys everything in `firebase.json`. Once `storage` is added, a merge to `main` deploys `storage.rules`. That fails if Firebase Storage isn't enabled on `genesisaibuilder` or the deploy service account lacks rules/storage permissions | High (blocks deploy) | Manual step before merge (enable Storage, grant roles). No push in this work |
| R2 | **Dedup + garbage collection race.** `put` skips the upload when the blob exists. An old blob that became unreferenced (manual saves create one blob per save) can be re-referenced by a new manifest while the cleanup job is deleting it, which loses data | High (data loss) | Adopted fix: when the blob already exists, `put` bumps its `customTime` (a metadata change that increments its metageneration). Cleanup judges age by `customTime`/`timeCreated` and deletes with an `ifMetagenerationMatch` precondition, so a blob touched after listing is never deleted |
| R3 | A moving cache point on turn 1 writes all files to the cache at 1.25×. In a build that ends in one turn (every small app) that is a 25% input surcharge for nothing, so small apps would no longer match today | Medium (cost) | Adopted: the moving cache point is added only when the context has an index (files not sent in full), i.e. when a read turn is likely. Break-even is a second turn in about 26% of builds |
| R4 | `tool_choice` changes invalidate the **messages** cache (tools and system survive). The plan's forced final turn (`tool_choice: none`) re-reads the conversation uncached: about 30 credits more for a 17k-token context, only in builds that use both read turns | Low–medium (cost) | Kept as planned (simple, deterministic). Alternative in open questions Q1 |
| R5 | Changing the tool set invalidates the whole cache. Sending the tool only to large apps would split the system-prompt cache into two | Medium (cost) | Adopted: when `CONTEXT_TOOLS=on`, every build sends the same tool, even when everything fits |
| R6 | Converting every snapshot on first access (Step 4) makes the first open of an old, busy project slow (one subcollection read per snapshot) | Medium (latency) | Adopted: `ensureManifest` converts the current files only; a legacy snapshot is converted when it's restored (it still has its `files` subcollection). `listSnapshots` needs only metadata |
| R7 | **Rollback after cutover:** with `FILE_STORE=blobs`, new changes exist only in Storage. Switching back to `firestore` would show stale files | Medium (operations) | Prod default stays `firestore` in code; emulator and CI use `blobs`. Documented: switching back needs a reverse export. Dual-write offered as Q2 |
| R8 | During a deploy, old instances (`firestore`) and new ones (`blobs`) briefly run together; a save on an old instance after migration is invisible | Low | Documented; flip the flag only by a separate deploy after the code is live, at a quiet time |
| R9 | The manifest on the project doc is sent to every `projects` listener (`useApps` on Apps, Dashboard and `SideNav` in the workspace). Estimate about 300 bytes per file: 5–15 KB per app, and each manual save re-sends it | Low (bandwidth) | Accepted (confirmed decision 2); measured in Step 7 |
| R10 | Files over the 20,000-character limit are never sent in full. With the guard, the model can no longer overwrite them blindly, but it can't edit them either | Low | Adopted: a clear rejection reason ("too large for the AI to edit; split it or edit it by hand"). `read_files` uses the same limit (confirmed decision 4) |
| R11 | `apply` "checks `manifestVersion`": two quick manual saves (two debounced timers) would conflict | Medium (UX) | Adopted: `apply` is read-modify-write inside a transaction (Firestore retries on contention), so independent saves both land. An optional `expectedVersion` gives a strict check; tested both ways |
| R12 | Holds for extra turns estimated from characters could under-hold (code tokenizes at about 3 characters per token) | Low (billing) | Adopted: count tokens with `countTokens` before each extra turn; fall back to characters ÷ 2.5 (conservative) |
| R13 | First-sign-in seeding uploads about 60 template files per user (content is per user, decision 1), instead of one Firestore batch | Low (latency) | Accepted; measured in Step 7 |
| R14 | `rules.e2e.ts:59` expects an owner to read a file doc. In `blobs` mode new apps have no file docs, so that GET returns 404 | Test gap | Seed a legacy file doc with the Admin SDK in that test; keep the rule until the later removal release |
| R15 | The parser carries state across turns. If a turn ends with an open `<file>` and a tool call, turn 2's text would be appended to that file | Correctness | Planned behavior: the open file is rejected (`read while writing`) and the parser is reset to "outside a file" |
| R16 | `firebase emulators:exec` in CI and the `verify` skill list `--only auth,firestore,functions` | Test gap | Add `storage` in both |

### Adopted improvements, not in the plan

- R2 (touch + metageneration precondition), R3 (conditional moving cache point), R5 (always send the tool), R6 (lazy snapshot conversion), R11 (read-modify-write `apply`), R12 (token-counted extra holds), R10 (clear rejection).
- `ensureManifest` is idempotent through a transaction that sets the manifest only if it is still absent; concurrent first accesses can both upload (content-addressed, harmless) but only one manifest wins.
- Snapshot docs in `blobs` mode carry their manifest **in the same write**, so a snapshot can never be half-written (finding 2).

### Nothing blocking

No finding contradicts a confirmed decision. Decisions I need are listed under [Deviations and open questions](#7-deviations-and-open-questions); none blocks the build.

## 4. Design

### Storage layout

```text
Storage (default bucket; storage.rules deny all client access)
  users/{uid}/blobs/{sha256}         file content, immutable; customTime = last time it was (re)referenced

Firestore
  projects/{pid}
    manifest: { [path]: { hash, size, lines, props[], emits[], imports[], hlHelpers[] } }
    manifestVersion: number          incremented by every change
  projects/{pid}/snapshots/{sid}
    generationId, reason, summary, fileCount, createdAt
    manifest: { … }                  same shape; legacy snapshots have a files/ subcollection instead
  projects/{pid}/generations/{gid}
    files: [paths applied]           (new) used to rank context
```

Blobs are per user, so a duplicated app shares content with its source, and nothing is shared between users.

### Update ordering

1. Upload new content (only paths whose hash changed), in parallel, `ifGenerationMatch: 0`; an existing blob gets its `customTime` bumped.
2. One Firestore transaction: read the project, apply the ops to its manifest, write the manifest and `manifestVersion + 1` (and `updatedAt`).

A failure in step 1 changes nothing visible. A failure in step 2 leaves only unreferenced blobs, removed by cleanup. Readers always see a complete manifest.

### Cleanup

A scheduled function lists `users/*/blobs/*`, builds the set of hashes referenced by each user's project and snapshot manifests, and deletes blobs that are unreferenced **and** whose `customTime` (or `timeCreated`) is older than 7 days, with an `ifMetagenerationMatch` precondition (R2). It has a dry-run mode that only logs.

### Migration

- Lazy: `ensureManifest(pid)` runs before any `blobs`-mode access. If the project has no `manifest`, it reads the Firestore files, uploads them, and sets the manifest in a transaction only if it is still absent.
- Legacy snapshots are converted when restored (R6).
- Backfill: `scripts/migrate-files-to-storage.ts` runs `ensureManifest` for every project, with `--dry-run`, hash verification (re-download and compare), and resumability (projects that already have a manifest are skipped). Emulator only in this work.
- Old Firestore file data is never deleted in this work.

### Feature flags (functions params)

| Flag | Values | Code default (prod) | Emulator / CI |
|---|---|---|---|
| `FILE_STORE` | `firestore` \| `blobs` | `firestore` | `blobs` (after Step 4) |
| `CONTEXT_TOOLS` | `on` \| `off` | `off` | `on` (after Step 6) |

## 5. Step checklist

| Step | Status | Commits | Files touched | Tests added |
|---|---|---|---|---|
| 0. Tracking doc + design | done | `57a1744` | `docs/plans/filestore-and-context.md` | |
| 1. FileStore interface | done | see change log | `functions/src/files/{index,firestoreStore,describe}.ts`, `api.ts`, `generate.ts`, `templates.ts` | none (no behavior change; existing 38 unit + 32 e2e pass unchanged) |
| 2. Overwrite guard + changed files | done | see change log | `llm/validate.ts`, `llm/prompt.ts` (`renderFiles` returns `{ text, full }`), `generate.ts` | `parser.test.ts`: guard (seen / unseen / new / delete / two-argument form); `prompt.test.ts`: `renderFiles` reports full files |
| 3. Content-addressed storage | done: unit 48/48; e2e 39/39 with `blobs`, 37/37 + 2 skipped with `firestore` | see change log | `firebase.json`, `storage.rules`, `admin.ts`, `config.ts` (`FILE_STORE`), `files/{describe,blobStore,manifestStore,index,firestoreStore}.ts`, `e2e/{env,helpers,rules}.ts`, `deploy.yml`, verify skill | `files/describe.test.ts` (4), `files/manifestStore.test.ts` (4: manifest ops, dedupe, entries, cache); `e2e/filestore.e2e.ts` (5: apply/versions/dedupe, concurrent + strict version, snapshot/restore, legacy snapshot, copy); `e2e/storage.e2e.ts` (2: blobs + manifest via the API, client Storage access refused) |
| 4. Migration | done: unit 48/48; e2e 42/42 (`blobs`), 39/39 + 3 skipped (`firestore`) | see change log | `files/{migrate,manifestStore,firestoreStore,blobStore,index}.ts`, `scripts/migrate-files-to-storage.ts` (under `functions/src`), `package.json` (`migrate:files`), e2e helpers | `e2e/migrate.e2e.ts` (3: lazy conversion with concurrent first access + legacy snapshot restore; Firestore-store change drops a stale manifest; backfill dry run / real run with verification / resumable re-run) |
| 5. Index + ranking | done: functions unit 52/52, e2e 42/42 (`blobs`); frontend lint, 35/35, build | see change log | `llm/context.ts` (new), `llm/prompt.ts` (`renderFiles` removed), `generate.ts`, `frontend/src/composables/useGeneration.ts`, `frontend/src/views/Workspace.vue` | `llm/context.test.ts` (5: everything fits = identical output, ranking order, common words, budget filling + index, index lines); `useGeneration.test.ts` (hints in the request body) |
| 6. `read_files` + turns | done: functions unit 66/66, e2e 42/42 (`blobs`, `CONTEXT_TOOLS=on`); frontend lint, 36/36, build. **Not run against real Claude yet** (needs your approval, Step 7) | see change log | `llm/{tools,turns,prompt,parser}.ts`, `credits.ts`, `config.ts` (`CONTEXT_TOOLS`), `generate.ts`, `deploy.yml`, `.env.example`; frontend `useGeneration.ts`, `ChatPanel.vue`, `BuildingOverlay.vue`, `PreviewPanel.vue`, `Workspace.vue` | `tools.test.ts` (2), `turns.test.ts` (8: read then write, read cap with `tool_choice: none`, stop between turns, 402 on an extra hold, refusal on turn 2, open file dropped + unread overwrite rejected, cut-off turn usage, moving cache point), `credits.test.ts` (multi-turn hold covers the total), `prompt.test.ts` (frozen tool, byte snapshot, read rule), `parser.test.ts` (discard open file), `useGeneration.test.ts` (reading state) |
| 7. Cleanup, diff, measurement, docs | in progress: cleanup done; measurement script done (emulator numbers in §8); diff endpoint skipped (optional); docs next; real-Claude measurement waits for your approval | see change log | `files/cleanup.ts`, `scripts/measure-filestore.ts`, `index.ts`, `config.ts` (`BLOB_CLEANUP`) | `e2e/cleanup.e2e.ts` (1), `files/cleanup.test.ts` (2) |

## 6. Change log

_One entry per commit._

- `57a1744` Plan: tracking doc with verification log, baseline, evaluation and design.
- Step 1 `FileStore` interface: `functions/src/files.ts` moved to `files/firestoreStore.ts` behind a `FileStore` interface (`files/index.ts`): `manifest`, `read`, `readAll`, `apply`, `snapshot`, `restore`, `copy`, `listSnapshots`, plus a `replaceFiles(store, …)` helper for template upgrades. Every caller now goes through `fileStore()`, including `readFile`, `saveFile`, `listSnapshots` and `duplicateProject` (now `copy` + `snapshot`). `saveFile` now writes the file and then `updatedAt` (was one batch). Why: one seam for the storage change.
- Step 2 overwrite guard: `validateOps(ops, existing, seen?)` rejects rewriting an existing file not in `seen` ("file was not read; ask to include it"); new files and deletes stay allowed; two-argument calls are unchanged. `renderFiles` returns the set of files sent in full, which `generate` passes as `seen`. Generation docs now store `files: applied`. Why: an omitted file could be overwritten blindly (finding 7); `files` feeds context ranking in Step 5.
- Step 3 content-addressed storage: Storage in `firebase.json` (rules + emulator on 9199), deny-all `storage.rules`, `bucket()` in `admin.ts`, `FILE_STORE` param (default `firestore`). `files/describe.ts` (hash + regex metadata: size, lines, props, emits, imports, client helpers), `files/blobStore.ts` (create-only upload with `ifGenerationMatch: 0`, `customTime` bump on reuse, 32 MB LRU), `files/manifestStore.ts` (upload first, then one transaction switches the manifest; snapshot = manifest copy in one write; restore = transactional manifest replace + `restore` snapshot, legacy snapshots converted on restore; copy = manifest copy within one account; `listSnapshots` skips manifests via `select`). Uploads skip any content the current manifest already references. e2e: emulator hosts moved to `e2e/env.ts`, loaded first (functions code creates its clients on import); `rules.e2e` seeds a legacy file doc. CI runs the e2e suite once per store with the Storage emulator. Why: confirmed decisions 1–3.
- Step 4 migration: `files/migrate.ts` converts a project (files → blobs + manifest, set in a transaction only if still absent, version bumped) and a legacy snapshot. The manifest store calls it when it meets a project without a manifest (no extra read otherwise) and when restoring a legacy snapshot. Backfill `migrate:files`: `--bucket`, `--project`, `--dry-run`; refuses to run without emulator hosts unless `--allow-production`; resumable (skips projects and snapshots that have manifests); verifies every file by re-downloading without cache and comparing hashes with Firestore. The Firestore store drops stale manifests (D7). Local emulator `FILE_STORE=blobs`; CI runs both. Firestore file data is never deleted. Why: confirmed plan Step 4.
- Step 5 context: `llm/context.ts` ranks files (entry files → active tab → open tabs → files changed by the last 2 builds → files the prompt names → their imports and importers → the rest), fills the 60,000-character budget in that order, and lists the rest as index lines (size, lines, props, emits, client helpers). `generate` reads the manifest, the last 2 generations' `files` and the editor hints, and loads content only for the selected files. The frontend sends `activePath` and `openPaths`. Not covered by e2e: reaching context selection needs a build that would call Claude.
- Step 6 read_files + turns: `llm/tools.ts` (frozen `READ_FILES_TOOL`, ≤5 paths; `runReadFiles` checks paths, existence, size, already-seen, per-call budget, adds to `seen`); `llm/turns.ts` (`runTurns`: injectable stream, text-only to the parser, ≤2 read turns then `tool_choice: none`, output cap shared across turns, stop checked between turns, a file open at a tool call is dropped and rejected, a cut-off turn's usage estimated, moving cache point via `withCachePoint` only when an index is present); `credits.ts` (`addUsage`, `extendHold` with `{gid}-hold-{n}`); `generate.ts` keeps orchestration: holds each extra turn's input (token-counted) before it starts, ends cleanly on 402 keeping completed files, sends SSE `status {phase: "reading", paths}`, logs `readTurns`. System prompt gained one static rule. Frontend shows "Reading …" in the chat and the building overlay. Why: confirmed plan Step 6.
- Step 7 cleanup: `files/cleanup.ts` (`cleanupBlobs`, scheduled `cleanupFileBlobs` daily 03:30 UTC): references read first (project + snapshot manifests, soft-deleted projects included), then lists blobs; deletes a blob only if unreferenced and untouched for 7 days, with `ifMetagenerationMatch`; dry run by default. Tests: `e2e/cleanup.e2e.ts` (referenced kept, young kept, dry run deletes nothing, real run deletes the orphan), `files/cleanup.test.ts` (precondition).
- Step 7 measurement: `npm run measure:files` times both stores on the emulators (cached and cold blob reads), counts uploads and snapshot documents, sizes manifests and the large-app context. Results in §8.
- Step 3 sign-off: the Storage tests find the default bucket by probing `<project>.firebasestorage.app` then `<project>.appspot.com` (the emulator can't list buckets; the real project uses the first, demo projects probably the second), and check the denial against an admin control request.

## 7. Deviations and open questions

### Deviations

- D1: Step 4 converts snapshots lazily on restore instead of on first access (R6).
- D2: The moving cache point is used only when an index is present (R3).
- D3: `apply` is read-modify-write in a transaction; the strict version check is optional (R11).
- D4: Step 1 (a refactor with no behavior change) was committed before Step 2, although confirmed decision 6 puts the guard first. Step 2 doesn't depend on it and nothing shipped in between, so I kept the order instead of rewriting history.
- D6: The backfill script lives in `functions/src/scripts/migrate-files-to-storage.ts` (run with `npm run migrate:files`), not the repo-root `scripts/`: it reuses the functions' file-store code and is compiled with it. It also converts legacy snapshots, which first access leaves for restore time.
- D7 (adopted, new hazard H1): a backfill run while production still uses `firestore` would leave manifests that later edits make stale. Every Firestore-store change now also deletes the project's manifest (and bumps `manifestVersion`) in the same batch, so a stale manifest can never be served.
- D8: "templates.ts seeds manifests directly" needed no template-specific code: seeding goes through the selected store, so with `blobs` it writes manifests and never touches Firestore files.
- D9: Invalid editor hints (bad paths, more than 10) are dropped, not refused with 400: they only rank context, and a stale tab shouldn't block a build.
- D10: Component names count as "named in the prompt" only when distinctive (5+ characters with an inner capital or a hyphen, e.g. `ContactList`); file names and paths always count. Otherwise words like "list" or "stats" would pull in unrelated files.
- D11: `renderFiles` was replaced by `selectContext` + `renderContext` in `llm/context.ts` rather than moved as is: selection now works from the manifest, and content is read only for the files sent in full. When everything fits, the rendered text is byte-identical to before (tested).
- D12: `runReadFiles(input, manifest, read, seen)` takes a `read(paths)` function (the store bound to the project) instead of the blob store: it then works with either `FILE_STORE`.
- D13: Eager input streaming is off for `read_files`: its input is a few paths, so the API's own schema validation is kept; `runReadFiles` validates again.
- D14: A file already shown in full is not sent again by `read_files` ("already shown in full above"), and one call returns at most the 60,000-character budget.
- D15: The fallback token estimate (when `countTokens` fails) is now characters ÷ 2.5 instead of ÷ 3.5 for holds, so it errs high (R12). The cut-off-stream output estimate keeps ÷ 3.5 (it should not overcharge).
- D16: `CONTEXT_TOOLS` defaults to `off` in code (production unchanged until you turn it on) and is `on` in the emulator and CI.
- D17 (emulator limit): the Storage emulator ignores `ifGenerationMatch: 0`, does not store `customTime`, and ignores `ifMetagenerationMatch` on delete (probed 2026-11-17). Create-only uploads, the reuse touch and the delete precondition therefore can't be tested end to end locally; `deleteIfUnchanged` is unit-tested with a fake file and relies on Cloud Storage's documented preconditions. On the emulator, `put` simply overwrites identical content (harmless) and age falls back to `timeCreated`.
- D18: The cleanup job defaults to dry run (`BLOB_CLEANUP=dry-run`, logs only); `delete` must be set deliberately. It is scoped by user prefix (`uids`) in tests.
- D19: The optional diff endpoint was not built (time); listed as follow-up F3.
- D5: An unseen file that is over the 20,000-character limit is rejected with "too large for the AI to edit; split it or edit it by hand" instead of the generic "file was not read" (R10).

### Open questions (not blocking)

- Q1 (R4): Keep `tool_choice: none` on the final turn (simple, costs about 30 credits more when it happens), or keep `auto` with an instruction to stop reading and answer a third read with an error (cache-friendly, but the model may need one more turn)?
- Q2 (R7): Should `blobs` mode also write the Firestore files for a while (dual-write) so that switching back to `firestore` is safe, at the cost of doubled writes?
- Q4 (resolved): you allowed me to restart the local emulators; they now run with Storage and `FILE_STORE=blobs`.
- Q3 (R1): Should `deploy.yml` deploy with an explicit `--only functions,hosting,firestore,storage`, so that new targets are opted in deliberately?

### Follow-ups (later releases)

- F1: Remove the Firestore file data once every project has a manifest and `FILE_STORE=blobs` has run in production for a while: delete `projects/*/files/*` and `projects/*/snapshots/*/files/*`, remove the Firestore store and the `FILE_STORE` flag, the stale-manifest drop, the migrator's Firestore reads, and the files part of `firestore.rules` and `rules.e2e.ts`.
- F3: Diff endpoint: compare a snapshot's manifest with the previous snapshot's (changed paths, and the content of changed files from blobs). Cheap now that snapshots are manifests.
- F2: A reverse export (blobs → Firestore files) if a rollback after the cutover is ever needed (Q2).

## 8. Measurements

Script: `npm run measure:files` (`functions/src/scripts/measure-filestore.ts`), on the local emulators (2026-11-17), median of 5 runs. **Emulator timings only compare the two stores with each other; they are not production latencies.** Apps: the largest ready-made template (11 files, 22,869 characters) and a large app made of four copies of it (44 files, 91,476 characters, over the 60,000 budget).

### File store operations (ms, emulator)

| Operation | Firestore, 11 files | Blobs, 11 files (cached / cold) | Firestore, 44 files | Blobs, 44 files (cached / cold) |
|---|---:|---:|---:|---:|
| Create (write all files) | 2 | 19 / 15 | 3 | 17 / 15 |
| Save one file | 1 | 9 / 7 | 1 | 9 / 8 |
| Read all | 4 | 2 / 5 | 5 | 2 / 12 |
| Read one | 2 | 2 / 3 | 2 | 2 / 3 |
| Snapshot | 7 | 3 / 3 | 9 | 4 / 4 |
| Restore | 20 | 13 / 11 | 23 | 13 / 12 |
| Copy | 6 | 7 / 6 | 8 | 7 / 6 |

### Writes and sizes

| | Firestore store | Blobs + manifest |
|---|---|---|
| Create (N files) | N file docs + 1 project update | 1 transaction + one upload per distinct content (44 files → 11 uploads: identical copies are stored once) |
| Save one file | 1 file doc + 1 project update | 1 upload + 1 transaction |
| Snapshot | 1 doc + N file docs (11 / 44) | 1 doc holding the manifest (2.6 KB / 10.7 KB) |
| Restore | N writes and deletes + a snapshot (N + 1) | 1 transaction + 1 snapshot doc |
| Copy | N file docs | 1 transaction (no uploads) |
| Manifest on the project doc | none | 2.5 KB (11 files, about 227 bytes per file) / 10.5 KB (44 files); confirms R9's estimate |

Reading: writes are slower with blobs (an upload plus a transaction, about +7 ms on the emulator), and reads, snapshots, restores and copies are cheaper. Snapshots and restores no longer scale with the number of files.

### Context (large app, no Claude)

The 44-file app: 30 files sent in full and 14 indexed; 62,494 characters in the files section, of which the index is 1,154 characters (about 80 characters per indexed file). Before, the same app sent the alphabetically first files up to the budget and listed the rest as `[omitted: too large for context]`, with no information about them and no way to read them.

### Tokens and credits with real Claude

Not measured yet: this needs your approval (it calls Claude and spends credits). Proposed run, on the emulators with `CONTEXT_TOOLS=on` vs `off`: a small app build (expected identical input and cost) and a change to a file outside the context of a large app (expected: one read turn; the extra cost is the read turn's cached input plus the read file).
