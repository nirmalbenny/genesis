# Plan: build observability and an internal admin view

Branch `feat/observability` (from `main` at `3f08450`). Status: **in progress**.

## Contents

- [1. Goal and decisions](#1-goal-and-decisions)
- [2. Design](#2-design)
- [3. Steps](#3-steps)
- [4. Change log](#4-change-log)
- [5. Open questions and follow-ups](#5-open-questions-and-follow-ups)

## 1. Goal and decisions

See every build in detail, for the team only: by user ID, by app (the chain of follow-ups), each round with Claude, each `read_files` call and the files it read, the files written, deleted and rejected, tokens, credits and timings.

Decided with you (2026-11-18):

- **Layer 1 and Layer 2.** Layer 1: a trace record per build, structured logs, Cloud Monitoring charts and alerts. Layer 2: OpenTelemetry spans to Cloud Trace.
- **Internal admin page inside Genesis** (`/admin`), for admin accounts only. Customers never see it.
- **Content:** internal views show the user's prompt and Claude's plan text, file names, sizes and token counts. **No file contents and no generated code.** Declined prompts stay unstored (an existing rule): their traces keep no prompt.

## 2. Design

### Where the data lives

| Data | Where | Who can read it |
|---|---|---|
| Build trace (one per build) | Firestore `buildTraces/{generationId}`, top level | Cloud Functions only. Security rules deny all clients, owners included. The admin page reads it through `api` routes that require the `admin` claim |
| Event logs | Cloud Logging, structured (`jsonPayload`), one line per event, tagged with `generationId`, `uid`, `projectId` | Project members with Logging access. **No prompt or plan text in logs**: metadata only |
| Spans | Cloud Trace: one `build` span with children (context, credit hold, each Claude request from the SDK's own spans, each tool call, saving, summary) | Project members with Trace access. The SDK records metadata only (`contentMode: metadata_only`), so prompts carrying file contents never leave; our `build` span carries the prompt and plan text, truncated |
| Charts and alerts | Cloud Monitoring, from log-based metrics | Project members |

### Build trace record

```text
buildTraces/{gid}
  uid, projectId, projectName, createdAt, endedAt, expireAt (TTL, 90 days)
  status, error { code, message, step }?
  prompt (≤ 4,000 chars; null when declined), plan (≤ 4,000 chars)
  followUp { previousGenerationId | null, historyMessages }
  model, summaryModel, fileStore, contextTools, traceId (links to Cloud Trace)
  context { full[], indexed[], chars, activePath, openPaths[], recentPaths[] }
  rounds[] { n, ms, firstTokenMs, inputTokens, cacheWriteTokens, cacheReadTokens, outputTokens, stopReason,
             toolCalls[] { name, paths[], read[], isError } }
  actions { written[] { path, bytes }, deleted[], rejected[] { path, reason }, snapshotId, summary }
  credits { held, extraHolds, charged }
  timings { checksMs, contextMs, holdMs, firstTokenMs, streamMs, saveMs, totalMs }
```

Written once when the build ends (one write; never blocks the stream). A build refused before streaming (rate limit, 402, validation) has no trace; those already show in logs.

### Admin access

- An `admin: true` custom claim on the Firebase user, set by `npm run set-admin -- <email>` (owner credentials, Admin SDK). The claim is checked server-side on every admin route.
- `api` routes, all `GET`, all requiring the claim (403 otherwise), all read-rate-limited:
  - `/admin/users?q=` finds a user by uid or email;
  - `/admin/users/:uid`: email, sign-up date, credits, connected sub-account name, apps;
  - `/admin/builds?uid=&projectId=&status=&before=` lists traces, newest first, 50 per page;
  - `/admin/builds/:gid` returns one trace.
- Firestore composite indexes for `buildTraces` (uid + createdAt, projectId + createdAt, status + createdAt).

### Admin page (frontend)

- `/admin`: build list with filters (user ID or email, app ID, status), newest first.
- `/admin/builds/:gid`: one build: prompt, plan, context sent, each round (tokens, timing, tool calls and files read), files written, deleted and rejected with reasons, credits, timings, link to Cloud Trace.
- `/admin/apps/:pid`: the app's builds oldest first, so follow-ups read as a conversation.
- `/admin/users/:uid`: the user, their apps and builds.
- The route is guarded in the router by the token's `admin` claim; the API enforces it again.

### Layer 2: OpenTelemetry

- New dependencies (approved): `@opentelemetry/api`, `@opentelemetry/sdk-trace-node`, `@google-cloud/opentelemetry-cloud-trace-exporter`. The Anthropic SDK 1.5.0 already emits spans when a tracer provider is registered.
- `generate` opens a `build` span and child spans; the SDK's request spans nest under them. Spans are flushed before the response ends (Cloud Functions throttle CPU afterwards).
- Flag `TRACING=cloud|off`: code default `off` (emulator, tests); CI's production deploy writes `cloud` from the repository variable (default `cloud`).

### Charts and alerts

`scripts/setup-observability.sh <project> <alert-email>` (project owner) creates log-based metrics from the structured logs, one dashboard (builds, credits per build, failures by code, cache hit rate, read rounds, time to first token) and two alerts (failure rate, daily credit spend).

## 3. Steps

| Step | Status | Commits | Tests |
|---|---|---|---|
| 0. Plan | done | | |
| 1. Build trace + structured logs | todo | | |
| 2. Admin claim, API routes, rules, indexes | todo | | |
| 3. Admin page | todo | | |
| 4. OpenTelemetry → Cloud Trace | todo | | |
| 5. Charts and alerts script, docs, verify | todo | | |

## 4. Change log

_One entry per commit._

## 5. Open questions and follow-ups

- Trace retention is 90 days via a Firestore TTL policy on `expireAt`; the policy itself is a one-time manual setup (in the setup script).
