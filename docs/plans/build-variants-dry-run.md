# Dry run: one variant build through the code

A walk through what the implementation on `feature/build-variants` does for one request, step by step: which code
runs, what it writes, and what the customer sees. The design and its reasons are in
[build-variants.md](build-variants.md). Credit numbers are illustrative (a new app, prompt cache warm); real runs
will differ.

**The example:** a verified customer with HighLevel connected, `VARIANTS=on` (functions) and `VITE_VARIANTS=on`
(frontend), types _"a contact dashboard with search and upcoming appointments"_, turns on **Show me 2 options** and
presses **Build**.

## Contents

- [Status at a glance](#status-at-a-glance)
- [1. Build is pressed](#1-build-is-pressed)
- [2. The API starts the job](#2-the-api-starts-the-job)
- [3. The trigger picks it up](#3-the-trigger-picks-it-up)
- [4. One credit hold](#4-one-credit-hold)
- [5. The planner](#5-the-planner)
- [6. Four builds](#6-four-builds)
- [7. Checking: findings and the grader](#7-checking-findings-and-the-grader)
- [8. Two finalists](#8-two-finalists)
- [9. Settling](#9-settling)
- [10. The customer chooses](#10-the-customer-chooses)
- [11. Saving](#11-saving)
- [Other endings](#other-endings)
- [What the customer never sees](#what-the-customer-never-sees)

## Status at a glance

`projects/{pid}/generations/{gid}.status`, which the browser follows:

```text
queued → planning → building → checking → ready ──(save)──→ done
                                        ↘ partial   (no version passed: opens in the editor)
   any step ↘ declined | cancelled | error          (the draft is discarded)
```

## 1. Build is pressed

[`Dashboard.vue`](../../frontend/src/views/Dashboard.vue) `startBuild()`: with **Show me 2 options** on, there is no
details dialog. It calls `startVersions(prompt)` ([`useVersions.ts`](../../frontend/src/composables/useVersions.ts)),
which sends `POST /variants {prompt}`, and then goes to `/choose/{pid}`.

## 2. The API starts the job

[`variants.ts` `startVariants`](../../functions/src/variants.ts#L54), on the `api` function (email verified, rate
limits as for every route):

1. `VARIANTS` is `on`, the prompt is 1–4,000 characters, and HighLevel is connected (otherwise 404 `variants_off`,
   400 or 409).
2. **Build slots:** `reserveBuildSlot(uid, pid, gid, { exclusive: true, starts: 4 })`
   ([`rateLimits.ts`](../../functions/src/rateLimits.ts)). It is refused (429) if any build is running. Otherwise it
   holds every slot (an `exclusive` entry in `users/{uid}.activeBuilds`) and adds 4 starts to the 10-minute log.
3. Writes, in order:

   | Document | Content |
   |---|---|
   | `projects/{pid}` | name from the prompt ("a contact dashboard with search and upcoming appointments"), `draft: { generationId, expiresAt: now + 7 days }`, `deletedAt: null` |
   | its files | the 2 starter files (`src/main.js`, `src/App.vue`) |
   | `projects/{pid}/generations/{gid}` | `{ mode: "variants", status: "queued" }` |
   | `variantJobs/{gid}` | `{ uid, projectId, prompt }` (server-only) |

4. Replies `{ projectId, generationId }`. If any write fails, the slot is released and the error returned.

**The customer sees** `/choose/{pid}` ([`ChooseView.vue`](../../frontend/src/views/ChooseView.vue)): "Building your
app" with the animated mark and **Understanding your request** in progress. The page follows the project and the
generation document in Firestore. The draft doesn't appear in Apps or the sidebar (`useApps` keeps drafts apart);
the homepage lists it under the composer with **Open**.

## 3. The trigger picks it up

The new `variantJobs/{gid}` document fires [`buildVariants`](../../functions/src/variants.ts) (a Firestore trigger,
540 s, 1 GiB, not retried). From here nothing depends on the browser: closing the tab changes nothing.

`runJob` starts watching the generation document for `cancelRequested` (the **Stop** button calls the existing
cancel route, which now accepts the variant statuses), then builds the shared context once, exactly as a single build
would:

- `selectContext` and `renderContext` on the 2 starter files;
- `selectGuides`: the prompt names contacts and appointments, so the contacts and calendars guides;
- `systemBlocks(...)` and `buildTools(...)`: byte-identical to a single build's, so the prompt cache is shared.

## 4. One credit hold

[Line 222](../../functions/src/variants.ts#L222). Both inputs are counted with `countInput` (now shared in
[`llm/count.ts`](../../functions/src/llm/count.ts)), and one hold covers the whole job at its worst case:

| Part | Worst case | Illustrative |
|---|---|---|
| Planner | its input at the cache-write rate + 6,000 output tokens (Sonnet) | ~66 |
| 4 builds | 4 × (input with a 3,000-character version prompt + the 16,000-token cap) | ~760 |

> **Changed since:** the hold is now one build at the variant cap of 30,000 output tokens (`VARIANT_MAX_OUTPUT_TOKENS`), since the customer pays only for the version they keep.
| 4 grades | 4 × (22,000 input + 6,000 output on Haiku) | ~23 |
| **Hold** | written as `creditLedger/{gid}-hold` | **~850** |

Not enough available: status `error` with "Building several versions needs up to … AI credits …", and the draft is
discarded. A Stop that arrived while queued ends the job here, before any Claude call.

## 5. The planner

Status `planning`. [`llm/plan.ts`](../../functions/src/llm/plan.ts): one streamed Sonnet request with structured
output. Its system prompt describes the builder and the catalog, and says nothing about scoring. The answer might be:

| # | title | summary | prompt (abridged) |
|---|---|---|---|
| 1 | Contact finder | Search first, details beside the list. | A searchable contact table; picking one shows their upcoming appointments… |
| 2 | Today's agenda | Upcoming appointments first, the contact with each. | Upcoming appointments by day, with the contact's details beside each… |
| 3 | Dashboard | Key numbers on top, contacts and appointments below. | Counts of contacts and appointments this week, then a searchable list… |
| 4 | Board | Appointments as columns by day. | Columns for the next days, each appointment a card with its contact… |

`parsePlan` drops any prompt that is empty or mentions evaluation (`mentionsEvaluation`: _score_, _rubric_,
_criteria_, _grade_, _best version_, a criterion's name…). With fewer than 4 left, the planner is asked once more,
and `fill` then completes the list with the customer's own request. A `declined` answer or an API refusal ends the
job as `declined`, with input-only usage charged.

## 6. Four builds

Status `building`. [`buildVersion`](../../functions/src/variants.ts) runs the existing build loop (`runTurns`,
`createWorkspace`, `runBuildTool`, the code checks) without streaming to a browser. Each build's user turn is:

```text
Current project files: <the starter files>

Request: a contact dashboard with search and upcoming appointments

Build this version of it: Upcoming appointments by day, with the contact's details beside each…
```

- **Build 1 starts alone.** Builds 2–4 start when its first stream event arrives, so they read the system prompt
  from the cache it has just written (at most 20 s later, if build 1 fails early).
- **Extra turns** (a refused change or a file read) hold more first: `extendHold(uid, gid, build × 10 + turn, …)`.
- **Each build ends with a status:** `done` (every change accepted, no problem left), `problems`, `truncated`,
  `error`, `cancelled` or `declined`. Each build also returns its file operations, its plan text, its usage and the
  whole app as path → content.

Suppose builds 1, 2 and 3 end `done`, and build 4 ends `problems` (an import that doesn't resolve).

## 7. Checking: findings and the grader

> **Changed:** this step now runs two AI reviews per version: the security reviewer (Gate 2) and the quality judge
> (8 criteria on levels), with no pattern-based findings. See [build-variants-evaluation.md](build-variants-evaluation.md).
> The charging in §4 and §9 also changed: the customer pays only for the version they keep.

Status `checking`. Only `done` builds are scored (`isEligible`), so build 4 is out.

1. **Automated findings** ([`llm/variants.ts` `findings`](../../functions/src/llm/variants.ts)) on each build's
   files. Say build 3 has `<div @click="open(c)">` on its contact rows: criterion 8 (Accessible) is capped at 5.
2. **The grader** ([`llm/grade.ts`](../../functions/src/llm/grade.ts)): one streamed Haiku request per build, in
   parallel. The system prompt is the rubric ([`rubric.md`](../../functions/src/llm/rubric.md)), cached. The user
   turn holds the request, the version prompt, the known findings and the files. Its structured output is a score
   and one sentence of evidence for each of the 10 criteria. A failed grade is retried once. A criterion that still
   has no grade scores 0.
3. **Caps:** `capScores` clamps each score to its criterion's points and to the lowest cap of its findings.

| Build | Eligible | Findings | Total (capped) |
|---|---|---|---|
| 1 Contact finder | yes | none | 84 |
| 2 Today's agenda | yes | none | 88 |
| 3 Dashboard | yes | clickable div → criterion 8 ≤ 5 | 79 |
| 4 Board | no (`problems`) | — | — |

## 8. Two finalists

`keepTwo`: by total, then by criteria 1 + 2 + 5 (safety and errors), then by build order. So build 2 is first and
build 1 second; builds 3 and 4 are eliminated.

1. `variantScores/{gid}` gets every build's prompt, status, problems, files, usage, findings, scores and total, plus
   the finalists. No client can read it. One `build.variants` log line carries the statuses, totals and finalists.
2. **A snapshot per finalist:** `store.stageSnapshot(pid, ops, gid, title)` (new in both
   [file stores](../../functions/src/files/index.ts)) stores the content and records a snapshot with reason `variant`.
   It doesn't change the app.
3. **The best is applied:** `store.apply(pid, build 2's ops)`, so the draft already runs "Today's agenda".
4. The generation becomes `ready` with `finalists: [{ snapshotId, title, summary, plan, files }]` for builds 2 and 1,
   in that order, `snapshotId` (the applied one) and the prompt. No scores.

## 9. Settling

In `finally`, whatever happened: the actual usage of every call (planner, 4 builds, 2 or 3 grades) is priced and
rounded up once. With a warm cache, illustratively: planner ~20, builds ~60 each (build 4's included), grades ~1
each, **~265 charged**. `settleCredits(uid, gid, held, charged, …)` releases the ~850 hold, charges ~265, writes
`creditLedger/{gid}-charge` and frees the build slot. The `variantJobs/{gid}` document is deleted.

## 10. The customer chooses

The generation document turns `ready`, and `/choose/{pid}` shows **Choose your app** with two cards: "Today's agenda"
and "Contact finder", each with its summary. Nothing says which ranked first.

- **Preview** opens `/run/{pid}?version={snapshotId}` in a new tab ([`RunView.vue`](../../frontend/src/views/RunView.vue)).
  It loads that version's files from `GET /projects/{pid}/snapshots/{sid}/files` (owner only) and runs them in
  Sandpack on live HighLevel data, through the usual preview token and proxy (a draft is a project). The top bar
  shows **Preview** and **Save as app** instead of Edit.
- Both versions can be previewed side by side in two tabs.

## 11. Saving

**Save as app** (on a card or in a preview tab) opens the details dialog, prefilled with the name, the request and a
guessed category. `POST /projects/{pid}/save { snapshotId, name, description, category }`
([`api.ts` `saveVersion`](../../functions/src/api.ts)):

1. The project must still be a draft, its generation `ready`, and the snapshot one of its finalists (otherwise 409
   `version_unavailable`).
2. If it isn't the applied version, `store.restore(pid, snapshotId)` makes it the app's files and records a
   `restore` snapshot (non-destructive, as everywhere).
3. Adds the chat history: the request, then the chosen version's plan and files.
4. The generation becomes `done` with that `snapshotId` and `files`, which rank the next builds' context.
5. The project gets its name, description and category, and `draft` is removed. It is now a normal app: in Apps,
   launchable, editable, with follow-up prompts.

The browser opens the app in the editor (`/p/{pid}`). An open `/choose` tab notices the draft is gone and does the
same. The other finalist stays in History.

## Other endings

| Where | What happens | Status | The draft | Credits |
|---|---|---|---|---|
| §2 | Another build running, or too many starts | 429 before anything is written | none | none |
| §4 | Not enough credits | `error` (`insufficient_credits`) | discarded | none |
| §5 | The planner declines, or the API refuses | `declined` | discarded | planner usage |
| §6–7 | **Stop** at any point | `cancelled` | discarded | usage so far |
| §7 | Exactly one build eligible | `ready` with one card, "Here's your app" | kept | all usage |
| §7 | None eligible, some files written | `partial`: the most complete build is applied, the draft becomes a normal app, and the customer is sent to the editor (Fix with AI) | becomes the app | all usage |
| §7 | None eligible, nothing written | `error` | discarded | all usage |
| any | An unexpected error | `error` ("Something went wrong…") | discarded | usage so far |
| later | Not saved within 7 days | — | soft-deleted by the daily `cleanupFileBlobs` run (`expireDrafts`) | already settled |

## What the customer never sees

- The number of builds (the loading screen has steps, no counts).
- The four prompts, the code being written, the scores, the findings and the eliminated builds. Only the finalists'
  title and summary reach the browser; everything else is in `variantScores/{gid}` and the logs.
- The rubric. Only the grader reads it. The planner's and the builds' prompts never mention scoring, and a unit test
  ([`llm/variants.test.ts`](../../functions/src/llm/variants.test.ts)) checks that.
