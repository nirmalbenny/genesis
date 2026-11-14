# Genesis — AI-Powered HighLevel App Builder

Take-home assignment (HighLevel, Senior Engineer). Source of truth: `GENESIS_ASSIGNMENT_V2.pdf`.
**Detailed design, data model and flows: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Reviewer-facing setup: [`README.md`](README.md).**

## Working rules (read first)

- **Requirements first.** Mandatory checklist items before anything else. Extra features only when the user asks for them; note them under "Built beyond the checklist".
- **No bloat.** No extra libraries, abstractions, state managers or speculative pages. Prefer the platform (fetch, Firebase SDK, Vue reactivity). Ask before adding any dependency not listed in "Stack". Delete code that becomes unused.
- **Small, readable code.** Plain functions over classes. One responsibility per file. Match the surrounding code's style and comment density.
- **TypeScript strict** in `/functions` and `/frontend`. Shared types are duplicated deliberately (tiny), e.g. categories in `functions/src/projects.ts` and `frontend/src/lib/catalog.ts`.
- **No secrets in source.** `defineSecret` / `.secret.local` / Secret Manager; keep `.env.example` current.
- **Verify before claiming done:** `npm run lint` + `npx vue-tsc -b` + `npm test` (frontend), `npm run lint` + `npm test` + `npm run test:e2e` against running emulators (functions), and exercise the touched path — headless-browser screenshots for UI, real HighLevel sandbox + real Claude for data/generation. Docs: markdownlint, link/anchor check, Mermaid diagrams rendered. Report what was and wasn't verified.
- **Tests live with the code:** unit tests `functions/src/**/*.test.ts` (node:test), `frontend/src/**/*.test.ts` (Vitest); integration tests `functions/src/e2e/*.e2e.ts` never call Claude or HighLevel (seed state with the Admin SDK). Add tests with every behavior change.
- **HighLevel facts are verified, not assumed:** check marketplace.gohighlevel.com/docs, then confirm against the sandbox through `hlProxy` before relying on an endpoint or parameter.
- **Never hard-code a HighLevel location id or name** anywhere (code, templates, generated apps). Apps follow the currently connected sub-account; the system prompt carries neither, apps read `LOCATION_ID` / `LOCATION_NAME` at run time.

## Project skills (`.claude/skills/`)

- `/verify`: the full definition of done (lint, unit, emulator e2e, frontend tests, build, manual check, report).
- `/hl-endpoint`: add a HighLevel endpoint to `hlProxy`, verified against the docs and the sandbox, with reference, tests and docs.
- `/new-template`: add a ready-made app to `functions/templates/` following the conventions.
- `/docs-check`: `node scripts/check-docs.mjs` (markdownlint, links and anchors, Mermaid rendering).
- `/prod-check`: verify a production deploy (CI, live site, 401s, CORS, stored data) without printing secrets.

## Stack (fixed)

- **Backend:** Firebase Auth (email/password) on **Identity Platform** with reCAPTCHA Enterprise, Firestore, Cloud Functions **2nd gen**, Node 24 runtime (Node 20 was decommissioned 2026-10-30), TypeScript, **Cloud KMS** via `@google-cloud/kms` (token encryption).
- **LLM:** Claude via `@anthropic-ai/sdk`, **streaming mandatory**. `ANTHROPIC_MODEL` for generation; `ANTHROPIC_SUMMARY_MODEL` (default `claude-haiku-5-5`) for one-line snapshot summaries.
- **Frontend:** Vue 3 + TypeScript + Vite, **shadcn-vue** (Tailwind v4, reka-ui) for ALL UI primitives, `@lucide/vue`, `vue-router`, `@guolao/vue-monaco-editor`, `@codesandbox/sandpack-client`.
- **Hosting:** Firebase Hosting (frontend), Firebase Functions (backend).
- **Quality:** node:test (functions unit + e2e), Vitest (frontend), ESLint (`typescript-eslint`, `eslint-plugin-vue`), GitHub Actions CI/CD (Workload Identity Federation). Prettier deliberately not used.

## Requirement checklist (from the PDF)

### 1. Authentication

- [x] Email + password sign up / sign in (Firebase Auth); session persists across refresh.
- [x] HighLevel OAuth 2.0: authorize URL → callback Cloud Function → tokens in Firestore → refresh on expiry (single-flight, rotation-safe).
- [x] Tokens scoped to the Firebase user. **One HL location per user** (reconnect replaces it; disconnect deletes tokens).

### 2. Backend

- [x] Project CRUD with **soft-delete**; name, description, locationId, files; owner-only **security rules**.
- [x] Generation: prompt → **bounded** context → **streams** Claude → **validated file operations** → persists files + metadata.
- [x] SSE endpoint with defined protocol (start, token, file_start, file_end, done, cancelled, error) + heartbeat.
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

- [x] Frontend on Firebase Hosting (<https://genesisaibuilder.web.app>); all 5 functions deployed (Node 24, us-central1).
- [x] Deployed OAuth callback URL registered as redirect URI in the HL marketplace app.
- [x] Secrets in Secret Manager; `.env.example` files list every variable; prod params in `functions/.env.genesisaibuilder`, `frontend/.env.production` (both git-ignored).
- [x] README live URLs. - [ ] Loom link (README "Live URLs" says _TBD_).
- [x] Public GitHub repo: <https://github.com/nirmalbenny/genesis> (secrets, `.env*` except `*.example`, debug logs and this file are git-ignored).
- [x] CI/CD: `.github/workflows/deploy.yml` — lint, unit, emulator e2e (demo- project), build on every push/PR; deploy on `main` (docs-only pushes skip CI).

### Constraints

- [x] Generated apps make **real** HL API calls (Contacts, Conversations, Calendars) and show real data.
- [x] Graceful handling of malformed output, interrupted streams, failed HL calls; partial results preserved.

### Bonus

- [x] Iterative refinement (follow-up prompts edit existing files).
- [x] HL pagination in generated apps (verified cursors; mandatory in the system prompt).
- [x] Cancellation: Stop button / Esc → `POST /projects/:id/generations/:gid/cancel` sets `cancelRequested`; `generate` watches the doc, aborts Claude, keeps finished files, status `cancelled`, SSE `cancelled` event.
- [ ] Per-generation diff view.
- [x] Rate limiting: exact build limits in Firestore (1 running per app, 2 per user, 10 starts/10 min) next to the credit hold; in-memory token buckets for proxy (20/s, burst 40) and api (60 writes/min, 300 reads/min); proxy 10 s cache + pause on HL 429. All in `LIMITS` (`functions/src/rateLimits.ts`). No per-IP limit (X-Forwarded-For is spoofable on Cloud Functions; verified and removed).
- [ ] Webhooks (researched: see README "What I would improve").

## Built beyond the checklist (user-requested)

- **System HighLevel client:** `frontend/src/sandbox/genesis/hl.js`, injected by `PreviewPanel` as `src/genesis/hl.js` (`?raw`, never saved; `src/genesis/` is system-owned). Generated apps import `usePager`, `listEvents`, `freeSlots`, `hlGet`/`hlSend` and named writes instead of writing fetch/pagination code. Live for every app: **add-only API**. A Vitest test keeps the "Client" section of `hlReference.md` in sync with its exports. Templates keep their own `api.js` for now.
- **Shared UI kit + small files:** `frontend/src/sandbox/genesis/ui.css`, injected as `src/genesis/ui.css` and imported by new apps in `main.js` (documented for the model in `functions/src/llm/uiKit.md`, copied to `lib/` by the build; a Vitest test keeps classes and variables in sync). Apps use its look by default and restyle **only when the user explicitly asks** (override its CSS variables). Apps are split into components of ~150 lines so follow-ups rewrite only what they touch. Add-only, like the client. Measured: dashboard build 6,135 → 4,455 output tokens; a small follow-up 1,053.
- **Ready-made apps:** six locked templates in `functions/templates/` seeded per user via `POST /bootstrap` (content-hashed, idempotent, auto-upgrade). Edited only via "Edit a copy" (`POST /projects/:id/duplicate`).
- **App catalog:** every app has name + description (required) + category + icon. Apps page (`/apps`) with search, type/category filters, ordering. Card click **launches** (`/run/:id`, new tab); editing only from the ⋯ menu.
- **Pinning:** `POST /projects/:id/pin` (`pinnedAt`); pinned apps listed in the hamburger drawer (`SideNav`) with launch, Edit, Unpin.
- **Declined requests:** off-topic/harmful prompts answered with `<refuse>`; shown transiently, never stored.
- **Connection UX:** top-bar "Connected sub-account" control; connect-first dialog on launch without a connection; `/run/:id` without a connection redirects home after a notice.
- **Building overlay** over the preview while streaming; editor tabs open quietly so the overlay stays visible.
- **AI credits:** 1 credit = $0.001 of Claude list price; 2,500 granted once the email is verified; worst-case hold before Claude, settle actual usage; append-only `creditLedger`; 402 when short. ARCHITECTURE §7.
- **Email verification gate:** unverified users only see `/verify`; every endpoint returns `403 email_not_verified`. Password confirmation on sign-up.
- **Bot protection:** Identity Platform + reCAPTCHA Enterprise in ENFORCE (score ≤ 0.3 blocked), set up by `scripts/setup-bot-protection.sh`.
- **HL tokens encrypted at rest:** KMS envelope encryption in `functions/src/hl/tokenVault.ts` (AES-256-GCM DEK per record, wrapped by `genesis/hl-tokens`, AAD = `hlTokens/{uid}`, 5-min decrypt cache, fail closed 503). Manual rotation; KMS data-access logs off. Emulators use `LOCAL_TOKEN_KEK`. Legacy plain-text records are sealed on first read (remove that path once none remain). ARCHITECTURE §11.1.
- **Preview token bound to its app:** proxy checks the project exists, isn't deleted and is the user's (60 s per-instance cache). One shared HMAC secret is the chosen design (per-user/per-session keys considered and rejected).
- **CORS:** `api`, `generate`, `hlAuthStart` only accept the app's origins (from `GCLOUD_PROJECT`); `hlProxy` open for Sandpack.
- **First-sign-in setup:** bootstrap seeds templates in parallel; dashboard shows a "Setting up your account" placeholder instead of a partial list.
- **Design:** HubSpot-inspired palette (coral `#ff5c35` primary, navy `#213343` top bar), Inter, prompt-first homepage ("What would you like to build?"), premium split-screen auth pages.

## Key decisions (do not undo without asking)

- Apps are **not tied to a sub-account**: preview/generate use the current connection and update `project.locationId`.
- HL token never reaches the browser; generated apps use a 15-min preview token via `hlProxy` (method + path allowlist, no DELETE, forced `locationId`, project ownership and write-scope checks). HL tokens are stored only sealed (KMS).
- All Firestore writes via Functions; clients read only their own data.
- Proxy allowlist (`ROUTES` in `functions/src/hlProxy.ts`; writes are in the bullet below) — reads: `/contacts/`, `/contacts/{id}`, `/contacts/{id}/appointments`, `/conversations/search`, `/conversations/{id}`, `/conversations/{id}/messages`, `/calendars/`, `/calendars/events`, `/calendars/{id}/free-slots` (this one must NOT get a `locationId` param — HL returns 422; the proxy skips it there).
- Pagination contract (verified on the sandbox, implemented once in the injected client `frontend/src/sandbox/genesis/hl.js`): contacts cursor `startAfterId`+`startAfter` (stop on short page — `nextPageUrl` lies), conversations `startAfterDate = sort[0]` (`query` = server-side name search, word-prefix, case-insensitive, sent from 2 chars; `total` counts matches), messages `lastMessageId` while `nextPage`; calendar events and free slots not paginated (free slots: ≤31-day range, active calendars only).
- Response quirks (verified 2026-11-14, handled by client helpers `contactName`, `toDate`, `getContact`, `contactAppointments`): the contacts list lowercases `firstName`/`lastName`/`contactName`/tags (real case in `firstNameRaw`/`lastNameRaw`); a single contact has no `contactName`; `GET /conversations/{id}` has no name; contact appointments use `"YYYY-MM-DD HH:MM:SS"` with no offset (calendar events use ISO with offset); message threads contain `TYPE_ACTIVITY_*` entries; email subject is `meta.email.subject`.
- Parser strips a stray `</parameter>` trailer the model sometimes appends to files.
- Multiple sub-accounts per user were considered and **rejected** (assignment requires one location per user).
- Rate limits: no Redis/Upstash (Firestore where atomic with credits, memory elsewhere); documented as the scale-up path.
- **Writes to HighLevel are supported** (user decision, 2026-11-11): contacts (create, update, tags, notes), appointments (create, reschedule, cancel), conversations (read/unread, starred), messages (SMS or email only). **No deletes.** No extra confirmation step; generated apps must write only on an explicit user action. All endpoints verified on the sandbox except SMS (no test number). Write limits: 30/min per user; sends 10/min per user, ~200/day per sub-account.

## Environment

- `functions/.env`: `ANTHROPIC_MODEL`, `ANTHROPIC_SUMMARY_MODEL`. `functions/.env.local` (emulator): `HL_REDIRECT_URI`, `APP_URL`, `LOCAL_TOKEN_KEK`. `functions/.env.genesisaibuilder` (prod): `HL_REDIRECT_URI`, `APP_URL`.
- `functions/.secret.local` / Secret Manager: `ANTHROPIC_API_KEY`, `HL_CLIENT_ID`, `HL_CLIENT_SECRET`, `PREVIEW_TOKEN_SECRET`.
- `frontend/.env.local`: `VITE_FIREBASE_*`, `VITE_FUNCTIONS_BASE_URL`, `VITE_USE_EMULATORS`.
- One-time GCP setup scripts (run by a project owner; the coding agent can't grant IAM roles itself): `scripts/setup-github-deploy.sh`, `scripts/setup-bot-protection.sh`, `scripts/setup-token-encryption.sh` (all three have been run on `genesisaibuilder`).
- Firestore emulator needs **Java 21+** (macOS: `brew install openjdk@21`, then put it on `PATH`).

## Local dev

```bash
firebase emulators:start          # auth 9099, firestore 8080, functions 5001
cd frontend && npm run dev        # Cloudflare tunnel → functions emulator, then Vite on :5173 (strict port)
```

- `npm run dev` (`frontend/scripts/dev.mjs`) exists because Chrome's Local Network Access blocks the Sandpack iframe (public origin) from calling `127.0.0.1`. It opens a quick tunnel, waits for DNS, and passes the URL to Vite as `VITE_FUNCTIONS_BASE_URL` (process env overrides `.env.local`). Quick-tunnel URLs change on every start and can die; restart `npm run dev` to get a fresh one. `npm run dev:local` = plain Vite. The OAuth redirect URI stays on `127.0.0.1`.
- Sandbox data: the "AutoCar Inc" sub-account (Kochi, dealership + workshop) holds seeded demo data tagged `genesis-demo` (seed scripts live outside the repo).

## Next steps

1. Open an app on the live site so the one legacy plain-text `hlTokens` record is sealed; confirm it holds only `sealed` (no plain tokens) and the preview loads via KMS. Then remove the legacy read path in `functions/src/hl/token.ts`.
2. Run the definition-of-done flow on <https://genesisaibuilder.web.app> (signed-in browser test); record the Loom and put the link in README "Live URLs".
3. Proposed, not started: README restructure (group into Overview / Run it / Design / Operate, drop the standalone Rate limits section, ~30% shorter).
4. Optional: per-generation diff view; HL password policy + password reset link; seamless preview-secret rotation (key id).

## Definition of done (Loom flow must work on the deployed app)

sign up → connect HL via OAuth → create project → prompt ("build a contact dashboard with search and a list of upcoming appointments") → stream visible in editor → real HL data in preview → edit a file → restore a snapshot.
