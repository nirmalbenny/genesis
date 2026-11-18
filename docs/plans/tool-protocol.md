# Plan: file changes through tool calls

Status: built and measured on branch `feat/tool-protocol` (2026-11-18); not merged. Results in section 14. Two changes from the first draft: builds end after one request when every change is accepted (section 4), and there is no `OUTPUT_PROTOCOL` flag (section 10).

## 1. Why

Today Claude writes files as tagged text (`<file path>…</file>`), and our parser cuts them out of the stream. Large
apps also get a `read_files` tool, so one request mixes two output formats. Claude sometimes ends a file the way it
ends a tool call, leaving `</parameter>` and `</invoke>` in the file:

- 22 of 101 files in local builds with the tool, 0 of 28 without it (Langfuse, 2026-11-17/18).
- The first production build after PR #8 had no tool attached and still leaked into 5 of 6 files. The prompt still
  describes the tool; the parser removed the lines.

A parser can only repair slips we have already seen. With tools, the API separates every file from the text: the
content arrives as a JSON string field, and we validate a typed input instead of guessing where a file ends. This is
how coding agents (Claude Code, Cursor-style builders) work, and what the models are trained hardest on.

## 2. What stays the same

- **SSE protocol and frontend.** The server keeps sending `start`, `token {text, path}`, `file_start`, `file_end`,
  `status`, `done`, `cancelled`, `error`. Tool-input deltas are translated into these events
  (`frontend/src/composables/useGeneration.ts` is unchanged).
- **Validation and storage:** `validateOps`, `checkPath`, `FileStore`, one snapshot per build, files persisted at the
  end of the build, cancelled builds keep finished files.
- **Context selection** (`selectContext`, the index of left-out files) and the `seen` rule (no rewriting a file the
  model hasn't been shown).
- **Credits:** worst-case hold before the first request, `extendHold` before each extra turn, settle actual usage.
- **Observability:** one Langfuse trace per build; rounds already record tool calls.

## 3. Tools

Frozen definitions in `functions/src/llm/tools.ts`, identical for every build and always sent (tools come first in
the cached prefix, so one cache entry for everyone instead of today's two).

| Tool | Input | Ends the build? | Notes |
|---|---|---|---|
| `write_file` | `path`, `content` | no | Whole file. `eager_input_streaming: true` so content streams to the editor. |
| `delete_file` | `path` | no | |
| `read_files` | `paths` (1–5) | no | Only files listed in the index; as today. |
| `decline` | `reason` | yes | Replaces `<refuse>`. Nothing stored, input-only charge. |
| `edit_file` (phase 3) | `path`, `old_text`, `new_text` | no | Exact, unique match, like Claude Code's Edit. Eager streaming. |

- `strict: true` on every tool (supported on Sonnet 5.5 and Haiku 5.5) with `additionalProperties: false`, if the
  spike shows it works with eager streaming. Either way our code validates every input (no new dependency: the
  schemas are two or three string fields).
- Schemas list `path` before `content`; the streamer still handles any order (section 5).
- `tool_choice` stays `auto`: Sonnet 5.5 rejects forced tool use (`any`/`tool` return 400). `none` on the last turn,
  as today.

## 4. The loop

A standard tool loop in `functions/src/llm/turns.ts`, generalized from today's read loop:

1. **Turn 1:** Claude writes a short plan as text, then calls tools. Several calls in one response are allowed and
   expected (the prompt asks for all writes in one response).
2. **After each response:**
   - Every completed `tool_use` block is validated, then applied to an in-memory **working copy** of the build:
     writes and deletes are not persisted yet.
   - Each call gets a `tool_result`: `Saved src/App.vue (1,812 bytes)`, or an error the model can act on
     (`rejected: path is system-owned`, `rejected: file was not read`, `invalid input: missing content`).
3. **End** when every call was accepted and none was a read: one request for most builds. A closing turn was
   measured first and dropped: it re-sent the files just written (about 4,300 tokens of cache writes plus a closing
   sentence), adding about 80% to a new app's cost while never changing anything (22 of 22 builds).
4. **Continue** when a call was refused or files were read: the next turn sends every result, and Claude fixes
   errors or makes its changes. **Stop** at `end_turn`, `decline`, a refusal, the output cap, cancel or disconnect.
   - Caps: `MAX_TURNS = 6` in total, at most 2 of them read turns (as today), 16,000 output tokens across the build.
   - The turn after the cap gets `tool_choice: none`.
5. **Persist** the working copy once at the end (one snapshot), exactly as today.

Why results and continuations: validation errors go back to the model, which can correct them within the same
build (before, they were only reported to the user).

## 5. Streaming into the editor

`functions/src/llm/toolStream.ts` (new, replaces `parser.ts`): an incremental JSON reader for one tool input.

- Fed `input_json_delta.partial_json` chunks; tracks the top-level key being read.
- Decodes the `content` string value incrementally: `\n`, `\t`, `\"`, `\\`, `\/`, `\uXXXX` and surrogate pairs, with
  escapes split across chunks held back.
- Emits `file_start {path}` as soon as `path` is complete, then `token {path, text}` per decoded chunk. If `content`
  arrives before `path`, content is buffered until the path is known.
- At `content_block_stop` the accumulated JSON is parsed **strictly** (`JSON.parse`) and validated; that result, not
  the streamed text, is what gets applied. `file_end` follows with the authoritative byte count.
- An input that fails to parse or validate is not applied: an error `tool_result`, `file_end` not sent, a `rejected`
  entry and a `build.tool_error` log.

Text deltas outside tools stream as `token {path: null}` (the plan), as today.

We read raw stream events (`content_block_*`) ourselves rather than relying on the SDK's lazy tolerant parsing of
tool input: it can silently return a truncated object, and invalid JSON rejects `finalMessage()` (losing the turn's
other blocks). The spike confirms how SDK 1.5.0 behaves, including thinking signatures in the rebuilt assistant
message.

## 6. Failure modes

Every case has one defined outcome; each gets a unit test with a fake stream.

| Case | Outcome |
|---|---|
| Invalid JSON or schema mismatch in a tool input | Not applied; error `tool_result` so the model can retry; `rejected` if never fixed. |
| Output cap reached mid-input (`max_tokens` with an open `tool_use`) | That input is dropped (never run); earlier ones kept; status `partial`, code `truncated`. |
| `stop_reason: refusal` | No tool of that response runs; treated as declined. |
| `decline` called | Declined (as `<refuse>` today); other calls in the same response are ignored. |
| Cancel or disconnect mid-input | Abort; completed inputs kept; the open one reported as unfinished. |
| API error mid-turn | Completed inputs of earlier turns and of this turn kept; status `partial` or `error`. |
| Write to a system path, bad extension, too large, empty | Error result with the reason; the model may correct it. |
| Rewriting a file the model wasn't shown | Error result: read it first (if indexed) or leave it. |
| Same path written twice in a build | Later write wins; logged. |
| Delete then write, or write then delete | Applied in order on the working copy. |
| `edit_file` text not found, or found more than once | Error result with the reason (phase 3). |
| Unknown tool name | Error result. |
| Code written as text instead of a tool call | Not saved; logged as `build.code_in_text`; build fails as `malformed_output` if nothing was written. |
| `end_turn` with no writes and no decline | `malformed_output` (as today). |
| Turn cap reached with errors unresolved | Valid changes kept; the rest listed as rejected; status `partial`. |
| Credit hold for an extra turn refused (402) | Stop; keep what's applied; `insufficient_credits`. |

## 7. Prompt and context

- The format section is rewritten around the tools: plan as text first, then `write_file`/`delete_file`; never
  write code in text; `decline` for off-topic or harmful requests.
- Context files move from `<file path>` blocks to Anthropic's documented long-context layout:
  `<documents><document><source>src/App.vue</source><document_content>…</document_content></document></documents>`.
  This keeps the input from looking like an output format the model could imitate. `read_files` returns the same layout.
- `format.ts` and every reference to the tags go when the tag protocol is removed (phase 4).

## 8. Caching

The cached prefix is tools → system. Both are frozen, so every build shares one cache entry (today: two). The
conversation gets a moving cache point on each turn, as read turns do today, so a continuation turn reads the prior
turns at 0.1x.

## 9. Cost and latency (to be measured)

- JSON escaping makes file content longer in tokens (quotes, newlines, backslashes).
- The closing turn adds a request: input mostly cached, output a few tokens, plus one time-to-first-token.
- Acceptance limits, against today's numbers from the eval: output tokens per build +15% at most; median build time
  +10% at most; credits per build +20% at most.

## 10. Rollout

- No flag. The baseline on the tag protocol was recorded before the change (section 14), which is what the flag was
  for; keeping both protocols would mean two prompts, two parsers and two cache entries. Rollback is reverting the
  merge commit. The tag parser and `format.ts` are deleted.

## 11. Testing

1. **Unit** (node:test):
   - `toolStream`: every escape split at every position, 7 chunk sizes plus 500 random chunkings, keys in either
     order, unicode, a 20,000-character file.
   - Loop: fake streams for every row of section 6.
   - Validation of each tool input; tool definitions frozen and identical (cache test, as `prompt.test.ts`).
2. **Integration** (emulators, no Claude): unchanged API surface; generation e2e tests keep passing.
3. **Eval** (real Claude on the emulators, `functions/src/scripts/eval-builds.ts`, run on demand):
   - About 20 fixed prompts: new small apps, dashboards, follow-ups, a large app needing `read_files`, a request
     with an invalid path, a refusal, a cancel.
   - Run on both protocols.
   - Measured: files that compile (`@vue/compiler-sfc`, eval-only), invalid inputs, turns, tokens, credits,
     first-token and total time.
4. **Manual:** a build in the browser on the emulators (tokens stream into the editor, preview renders), then
   production with the test account.

## 12. Phases

| Phase | Work | Done when |
|---|---|---|
| 0. Spike | Script against the real API, about $3: parallel writes per response, `strict` with eager streaming, field order, escaping overhead, thinking blocks in the loop, SDK behaviour on bad JSON. | Each question answered with numbers; plan updated. |
| 1. Eval harness | `eval-builds.ts` and a baseline on the tag protocol. | Baseline numbers recorded in this file. |
| 2. Tools protocol | `toolStream.ts`, tools, loop, prompt, context layout, observability, flag; unit tests. | All tests pass; eval on `tools` meets section 9 with 0 invalid saved files. |
| 3. `edit_file` | Edits on the working copy, results, prompt. | Follow-up builds use fewer output tokens with no rise in failures. |
| 4. Cleanup and ship | Remove the tag parser, `format.ts`, the flag; docs (ARCHITECTURE §6, CLAUDE.md); PR; production check. | Merged on your go-ahead; production build verified. |

The compile check before saving comes after this, as a separate plan.

## 13. Decisions (2026-11-18)

1. Continue the loop after refused changes, so the model can fix them: yes.
2. `edit_file` in this branch: yes.
3. Budget: about $3 for the spike and about $5 per eval run: approved.

## 14. Results

**Spike** (phase 0, real API, 12 requests): `strict` with `eager_input_streaming` is accepted; every response wrote
all its files in one response, `path` before `content`; off-topic requests called `decline`; thinking blocks sent back
are accepted; JSON escaping costs about 7% more output tokens per character of code.

**Eval** (`scripts/eval-builds.mjs`, 11 cases: new apps, follow-ups, a large app, a forbidden `package.json`, an
off-topic request). Tags: 3 runs, 32 builds (one hit the build-start limit). Tools: 2 runs, 22 builds, after the
closing turn was dropped. Medians per case; credits include the summary.

| Case | Output tokens (tags → tools) | Credits | Seconds |
|---|---|---|---|
| contacts | 2,492 → 2,008 | 26 → 31 | 16.5 → 14.5 |
| dashboard | 6,382 → 4,903 | 65 → 51 | 38.2 → 30.9 |
| inbox | 4,475 → 4,819 | 46 → 50 | 26.7 → 30.1 |
| calendar | 4,118 → 3,620 | 43 → 38 | 24.7 → 21.8 |
| newContact | 4,462 → 4,117 | 46 → 43 | 26.7 → 24.6 |
| clearSearch (follow-up) | 1,574 → 317 | 27 → 15 | 10.8 → 5.1 |
| phone (follow-up) | 1,408 → 393 | 25 → 16 | 10.4 → 5.7 |
| packageJson | 2,344 → 2,262 | 25 → 24 | 16.4 → 16.7 |
| refuse | 0 → 0 | 1 → 2 | 2.0 → 2.9 |
| large | 1,567 → 340 | 107 → 48 | 11.4 → 7.5 |
| largeFollow | 1,606 → 278 | 84 → 73 | 10.2 → 5.7 |

| Totals | Tags (32 builds) | Tools (22 builds) |
|---|---|---|
| Passed | 31 | 22 |
| Saved files that don't compile | 1 of 100 | 0 of 61 |
| Tool markup in saved files, code in chat | 0, 0 | 0, 0 |
| Per build: output tokens, credits, seconds | 2,746 · 40.7 · 17.6 | 2,096 · 35.2 · 15.0 |

Against section 9: output tokens −24% (limit +15%), credits −14% (limit +20%), time −15% (limit +10%). The first
build after a deploy pays the cache write for the new prefix (contacts in one run: 46 credits instead of 16).

**Final run** on the finished branch (12 cases, a Stop case added): 12 of 12 passed, 0 files that don't compile.
Stop after the first finished file: that file kept, the one being written named as unfinished and not saved, 3–5
credits charged.

**Browser check** (emulators, headless Chrome): the plan streams into the chat, files tick off one by one, the
editor fills while `write_file` streams (App.vue 14 → 29 → 36 lines over three seconds) and stays read-only until
the build ends.

## 15. Follow-up: checks before saving and preview fixes (2026-11-18)

- **Code checks** (`llm/checkCode.ts`, `@vue/compiler-sfc` 3.5.45 pinned to the frontend's version): every write and
  edit must compile, and avoid what the preview's compiler lacks; imports are checked across the app after each
  response, and problems go back to the model. Eval (12 cases): all passed, no check fired (no false alarms). A
  build asking for `defineModel`: refused, rewritten in a 361-token second round, every file compiling.
- **Fix with AI** on the preview's error banner: a runtime error (`Cannot read properties of undefined`) was fixed in
  one 8-credit build, from a prompt with the file and line.
- **No gap after a build:** the overlay stays ("Starting your app") until Sandpack reports the new version ran. For
  a new dashboard the gap was 5.2 s (stream ended at 27.2 s, new app shown at 32.4 s); the overlay lifted 0.5 s after.
