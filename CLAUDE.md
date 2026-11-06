# Genesis — AI-Powered HighLevel App Builder

Take-home assignment (HighLevel, Senior Engineer). Source of truth: `GENESIS_ASSIGNMENT_V2.pdf`.
**Detailed design, data model and flows: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Reviewer-facing setup: [`README.md`](README.md).**

## Working rules (read first)
- **Requirements first.** Mandatory checklist items before anything else. Extra features only when the user asks for them; note them under "Built beyond the checklist".
- **No bloat.** No extra libraries, abstractions, state managers or speculative pages. Prefer the platform (fetch, Firebase SDK, Vue reactivity). Ask before adding any dependency not listed in "Stack". Delete code that becomes unused.
- **Small, readable code.** Plain functions over classes. One responsibility per file. Match the surrounding code's style and comment density.
- **TypeScript strict** in `/functions` and `/frontend`. Shared types are duplicated deliberately (tiny), e.g. categories in `functions/src/projects.ts` and `frontend/src/lib/catalog.ts`.
- **No secrets in source.** `defineSecret` / `.secret.local` / Secret Manager; keep `.env.example` current.
- **Verify before claiming done:** `npx vue-tsc -b` (frontend), `npm test` (functions), and exercise the touched path against the emulators — headless-browser screenshots for UI, real HighLevel sandbox + real Claude for data/generation. Report what was and wasn't verified.
- **HighLevel facts are verified, not assumed:** check marketplace.gohighlevel.com/docs, then confirm against the sandbox through `hlProxy` before relying on an endpoint or parameter.
- **Never hard-code a HighLevel location id** anywhere (code, templates, generated apps). Apps follow the currently connected sub-account.

## Stack (fixed)
- **Backend:** Firebase Auth (email/password), Firestore, Cloud Functions **2nd gen**, Node 24 runtime (Node 20 was decommissioned 2026-10-30), TypeScript.
- **LLM:** Claude via `@anthropic-ai/sdk`, **streaming mandatory**. `ANTHROPIC_MODEL` for generation; `ANTHROPIC_SUMMARY_MODEL` (default `claude-haiku-5-5`) for one-line snapshot summaries.
- **Frontend:** Vue 3 + TypeScript + Vite, **shadcn-vue** (Tailwind v4, reka-ui) for ALL UI primitives, `@lucide/vue`, `vue-router`, `@guolao/vue-monaco-editor`, `@codesandbox/sandpack-client`.
- **Hosting:** Firebase Hosting (frontend), Firebase Functions (backend).

## Requirement checklist (from the PDF)

### 1. Authentication
- [x] Email + password sign up / sign in (Firebase Auth); session persists across refresh.
- [x] HighLevel OAuth 2.0: authorize URL → callback Cloud Function → tokens in Firestore → refresh on expiry (single-flight, rotation-safe).
- [x] Tokens scoped to the Firebase user. **One HL location per user** (reconnect replaces it; disconnect deletes tokens).

### 2. Backend
- [x] Project CRUD with **soft-delete**; name, description, locationId, files; owner-only **security rules**.
- [x] Generation: prompt → **bounded** context → **streams** Claude → **validated file operations** → persists files + metadata.
- [x] SSE endpoint with defined protocol (start, token, file_start, file_end, done, error) + heartbeat.
- [x] File management: list tree, read file, save manual edits.
- [x] Version control: snapshot per generation; list; restore (non-destructive).

### 3. Frontend
- [x] shadcn-vue for inputs, buttons, dialogs, tabs, badges, sheet, dropdowns.
- [x] Sign up / sign in; dashboard with Connect HighLevel + status (sub-account name / "Not connected").
- [x] Chat panel with history + input.
- [x] Monaco editor, clickable file tree, tabs, live tokens, **read-only while streaming**.
- [x] Sandpack preview with **real HL data**; refreshes after generation.
- [x] SSE client: all events, tokens into editor, disconnects handled.
- [x] Snapshot history in a shadcn Sheet with timestamps + Restore.

### 4. Deployment
- [x] Frontend on Firebase Hosting (https://genesisaibuilder.web.app); all 5 functions deployed (Node 24, us-central1).
- [x] Deployed OAuth callback URL registered as redirect URI in the HL marketplace app.
- [x] Secrets in Secret Manager; `.env.example` files list every variable; prod params in `functions/.env.genesisaibuilder`, `frontend/.env.production` (both git-ignored).
- [x] README live URLs. - [ ] Loom link.
- [x] Public GitHub repo: https://github.com/nirmalbenny/genesis (secrets, `.env*` except `*.example`, and debug logs are git-ignored).

### Constraints
- [x] Generated apps make **real** HL API calls (Contacts, Conversations, Calendars) and show real data.
- [x] Graceful handling of malformed output, interrupted streams, failed HL calls; partial results preserved.

### Bonus
- [x] Iterative refinement (follow-up prompts edit existing files).
- [x] HL pagination in generated apps (verified cursors; mandatory in the system prompt).
- [ ] Cancellation (server aborts on client disconnect, but there is no Cancel button).
- [ ] Per-generation diff view.
- [ ] Rate limiting.
- [ ] Webhooks (researched: see README "What I would improve").

## Built beyond the checklist (user-requested)
- **Ready-made apps:** six locked templates in `functions/templates/` seeded per user via `POST /bootstrap` (content-hashed, idempotent, auto-upgrade). Edited only via "Edit a copy" (`POST /projects/:id/duplicate`).
- **App catalog:** every app has name + description (required) + category + icon. Apps page (`/apps`) with search, type/category filters, ordering. Card click **launches** (`/run/:id`, new tab); editing only from the ⋯ menu.
- **Pinning:** `POST /projects/:id/pin` (`pinnedAt`); pinned apps listed in the hamburger drawer (`SideNav`) with launch, Edit, Unpin.
- **Declined requests:** off-topic/harmful prompts answered with `<refuse>`; shown transiently, never stored.
- **Connection UX:** top-bar "Connected sub-account" control; connect-first dialog on launch without a connection; `/run/:id` without a connection redirects home after a notice.
- **Building overlay** over the preview while streaming; editor tabs open quietly so the overlay stays visible.
- **Design:** HubSpot-inspired palette (coral `#ff5c35` primary, navy `#213343` top bar), Inter, prompt-first homepage ("What would you like to build?"), premium split-screen auth pages.

## Key decisions (do not undo without asking)
- Apps are **not tied to a sub-account**: preview/generate use the current connection and update `project.locationId`.
- HL token never reaches the browser; generated apps use a 15-min preview token via `hlProxy` (GET allowlist, forced `locationId`).
- All Firestore writes via Functions; clients read only their own data.
- Proxy allowlist: `/contacts/`, `/contacts/{id}`, `/contacts/{id}/appointments`, `/conversations/search`, `/conversations/{id}`, `/conversations/{id}/messages`, `/calendars/`, `/calendars/events`, `/calendars/{id}/free-slots` (this one must NOT get a `locationId` param — HL returns 422; the proxy skips it there).
- Pagination contract (verified on the sandbox, documented in `functions/src/llm/hlReference.md`): contacts cursor `startAfterId`+`startAfter` (stop on short page — `nextPageUrl` lies), conversations `startAfterDate = sort[0]`, messages `lastMessageId` while `nextPage`; calendar events and free slots not paginated (free slots: ≤31-day range, active calendars only).
- Parser strips a stray `</parameter>` trailer the model sometimes appends to files.
- Multiple sub-accounts per user were considered and **rejected** (assignment requires one location per user).

## Environment
- `functions/.env`: `ANTHROPIC_MODEL`, `ANTHROPIC_SUMMARY_MODEL`, `HL_REDIRECT_URI`, `APP_URL`.
- `functions/.secret.local` / Secret Manager: `ANTHROPIC_API_KEY`, `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `PREVIEW_TOKEN_SECRET`.
- `frontend/.env.local`: `VITE_FIREBASE_*`, `VITE_FUNCTIONS_BASE_URL`, `VITE_USE_EMULATORS`.

## Local dev
```
firebase emulators:start          # auth 9099, firestore 8080, functions 5001
cd frontend && npm run dev        # Cloudflare tunnel → functions emulator, then Vite on :5173 (strict port)
```
- `npm run dev` (`frontend/scripts/dev.mjs`) exists because Chrome's Local Network Access blocks the Sandpack iframe (public origin) from calling `127.0.0.1`. It opens a quick tunnel, waits for DNS, and passes the URL to Vite as `VITE_FUNCTIONS_BASE_URL` (process env overrides `.env.local`). Quick-tunnel URLs change on every start and can die; restart `npm run dev` to get a fresh one. `npm run dev:local` = plain Vite. The OAuth redirect URI stays on `127.0.0.1`.
- Sandbox data: the "AutoCar Inc" sub-account (Kochi, dealership + workshop) holds seeded demo data tagged `genesis-demo` (seed scripts live outside the repo).

## Next steps
1. Run the definition-of-done flow on https://genesisaibuilder.web.app (signed-in browser test).
2. Fill README live URLs; record the Loom.
3. Optional: regenerate the five single-page ready-made apps to follow the pagination rule; Cancel button; diff view.

## Definition of done (Loom flow must work on the deployed app)
sign up → connect HL via OAuth → create project → prompt ("build a contact dashboard with search and a list of upcoming appointments") → stream visible in editor → real HL data in preview → edit a file → restore a snapshot.
