# Plan: file storage in Cloud Storage and smart build context

Branch `feat/filestore-context` (from `main` at `03bd8f7`). Not pushed, never deployed.

Status: **Phase 3, Step 0**.

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
| 0. Tracking doc + design | in progress | | `docs/plans/filestore-and-context.md` | |
| 1. FileStore interface | todo | | | |
| 2. Overwrite guard + changed files | todo | | | |
| 3. Content-addressed storage | todo | | | |
| 4. Migration | todo | | | |
| 5. Index + ranking | todo | | | |
| 6. `read_files` + turns | todo | | | |
| 7. Cleanup, diff, measurement, docs | todo | | | |

## 6. Change log

_One entry per commit._

## 7. Deviations and open questions

### Deviations

- D1: Step 4 converts snapshots lazily on restore instead of on first access (R6).
- D2: The moving cache point is used only when an index is present (R3).
- D3: `apply` is read-modify-write in a transaction; the strict version check is optional (R11).

### Open questions (not blocking)

- Q1 (R4): Keep `tool_choice: none` on the final turn (simple, costs about 30 credits more when it happens), or keep `auto` with an instruction to stop reading and answer a third read with an error (cache-friendly, but the model may need one more turn)?
- Q2 (R7): Should `blobs` mode also write the Firestore files for a while (dual-write) so that switching back to `firestore` is safe, at the cost of doubled writes?
- Q3 (R1): Should `deploy.yml` deploy with an explicit `--only functions,hosting,firestore,storage`, so that new targets are opted in deliberately?

## 8. Measurements

_Collected in Step 7._
