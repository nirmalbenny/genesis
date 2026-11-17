# Plan: build observability with Langfuse

Branch `feat/observability` (from `main` at `3f08450`). Status: **in progress**, Step 3 (audit a real trace) next.

## Contents

- [1. Goal and decisions](#1-goal-and-decisions)
- [2. Design](#2-design)
- [3. Steps](#3-steps)
- [4. Change log](#4-change-log)
- [5. Manual steps and open questions](#5-manual-steps-and-open-questions)

## 1. Goal and decisions

See every build in detail, for the team only: by user ID, by app (the chain of follow-ups), each request to Claude, each `read_files` call and the files it read, the files written, deleted and rejected, tokens, cost and timings.

Decided with you (2026-11-18):

- **Langfuse (free cloud plan) instead of a self-built admin page.** Langfuse provides the trace browser, user and session views, and token and cost dashboards. The self-built admin page, admin API and Firestore trace records were dropped.
- **Content:** traces carry the user's prompt and Claude's plan text, file names, sizes and token counts. **No file contents and no generated code.** A declined prompt is never kept. The prompt and plan therefore leave Google Cloud and are stored by Langfuse (EU region by default); this needs to be reflected in the privacy policy.
- **Structured logs and Cloud Monitoring alerts stay in Google Cloud**, so the core numbers and alerts don't depend on Langfuse.
- Instrumented with the [Langfuse agent skill](../../.claude/skills/langfuse/SKILL.md) (`langfuse/skills`, installed in `.claude/skills/langfuse`), following its instrumentation workflow and the [best-practices page](https://langfuse.com/docs/observability/best-practices).

## 2. Design

### Trace shape (one trace per build)

```text
build-app                (agent)       input: the prompt · output: the plan and files changed · level ERROR/WARNING on failure
├── prepare-context      (span)        input: editor tabs, recent files · output: files sent in full, files listed only, characters
├── generate-changes     (generation)  one per request to Claude: model, tokens (input, output, cache read, cache write), cost, time to first token
├── read-files           (tool)        one per read_files call: paths asked, read, not read (no contents)
├── generate-changes     (generation)  the next request, after the files were returned
└── save-changes         (span)        written (path, bytes), deleted, rejected (path, reason), snapshot
    └── summarize-change (generation)  the one-line summary model call
```

- **Session = the app** (`projectId`): an app's builds, in order, are its conversation of follow-ups. **User = the Firebase uid.** Both, plus the trace name and tags (`done|partial|error|cancelled|declined`, `first-build|follow-up`, `large-app`, `read-files`), are on every observation (`propagateAttributes`), as Langfuse requires for filtering.
- **Cost** is sent from Genesis's own rate card (`costUsd` in `credits.ts`), so Langfuse shows what the build actually cost, whatever its own price list says.
- **Built after the build ends** from timings `generate` records (explicit start and end times), so tracing never touches the stream. It is sent before the response ends (Cloud Functions throttle CPU afterwards), with the flush capped at 3 seconds.
- **No code can leak:** inputs and outputs are built from the prompt, the plan, paths and counts only, and the span processor's `mask` replaces any `<file path="…">…</file>` content as a second line of defence.
- **Isolated tracer provider** (`setLangfuseTracerProvider`, never global) and `openTelemetry: false` on the Anthropic client, so the SDK emits no spans of its own (they would duplicate the generations and carry the full messages, including code).

### Structured logs (Cloud Logging)

One line per event with `generationId`, `uid`, `projectId`, metadata only (no prompt or plan): `build.round` (tokens, timing, tool calls), `build.rejected` (path, reason) and `build.end` (status, error code and step, totals, credits, files, timings, `traceId` linking to Langfuse). The source for log-based metrics and alerts.

### Settings

| Setting | Where | Default |
|---|---|---|
| `TRACING` | GitHub variable (CI writes it) · `functions/.env.local` | `off`; `langfuse` turns tracing on |
| `LANGFUSE_BASE_URL` | GitHub variable · `functions/.env.local` | `https://cloud.langfuse.com` (EU) |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Secret Manager · `functions/.secret.local` | none: they **must exist before deploying**, even while tracing is off |

### Dependencies (approved; exact versions)

`@langfuse/tracing` 6.1.1, `@langfuse/otel` 6.1.1, and the OpenTelemetry packages they need: `@opentelemetry/api` 1.9.1, `sdk-trace-node`, `sdk-trace-base`, `core`, `context-async-hooks` 2.12.0, `exporter-trace-otlp-http`, `otlp-exporter-base` 0.223.0. All released at least two weeks ago.

## 3. Steps

| Step | Status | Tests |
|---|---|---|
| 0. Plan | done | |
| 1. Per-round reporting in the turn loop; structured logs | done | `turns.test.ts` (rounds, no double count) |
| 2. Langfuse trace (shape, attributes, cost, masking) wired into `generate` | done | `observability/langfuse.test.ts` (7, through the real Langfuse processor with an in-memory exporter) |
| 3. Run a real build and audit its trace in Langfuse (skill step 3) | **waiting for Langfuse keys** | |
| 4. Cloud Monitoring metrics, dashboard and alerts script | todo | |
| 5. Docs, verify, pull request | todo | |

## 4. Change log

- `d6f4f83` Plan (first version, admin page); the Storage switch recorded in the file-storage plan.
- Langfuse tracing: per-round reporting (also fixes a double count when a tool call fails after a round finished), structured logs, the Langfuse trace, settings, CI placeholders.

## 5. Manual steps and open questions

1. Create a Langfuse account and project (free plan), pick the region, and create a project API key pair.
2. Locally: put the keys in `functions/.secret.local` (`LANGFUSE_PUBLIC_KEY=…`, `LANGFUSE_SECRET_KEY=…`), set `TRACING=langfuse` (and the region URL if not EU) in `functions/.env.local`. Never paste keys into chat.
3. Before merging: `firebase functions:secrets:set LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`; set the GitHub variables `TRACING=langfuse` and, for the US region, `LANGFUSE_BASE_URL`.
4. Privacy policy: prompts and plan text are processed by Langfuse.
