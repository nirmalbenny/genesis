# Genesis — AI-powered HighLevel app builder

Describe an app in plain English. Genesis streams the code from Claude into a live editor and runs the result on your **real HighLevel data**: contacts, conversations and calendars.

**[Live app](https://genesisaibuilder.web.app)** · **[Loom walkthrough](#live-urls)** · **[Architecture & flows](docs/ARCHITECTURE.md)**

![Genesis home: a prompt-first workspace with ready-made apps](docs/screenshots/home.png)

| Build with a prompt, preview on live data | Ready-made apps, catalog and launch |
|---|---|
| ![Workspace: chat, live preview and file tree](docs/screenshots/workspace.png) | ![Apps catalog with filters](docs/screenshots/apps.png) |
| ![Building overlay while code streams](docs/screenshots/building.png) | ![Activity Timeline ready-made app on live data](docs/screenshots/ready-made-app.png) |

## Contents
[Features](#features) · [Live URLs](#live-urls) · [Tech stack](#tech-stack) · [Repository layout](#repository-layout) · [Local setup](#local-setup-firebase-emulators) · [Configuration](#configuration-reference) · [Scripts & tests](#scripts--tests) · [HighLevel setup](#highlevel-setup) · [Architecture decisions](#architecture-decisions) · [Rate limits](#rate-limits) · [What I would improve](#what-i-would-improve) · [Deployment notes](#deployment-notes) · [Troubleshooting](#troubleshooting)

## Features
- **Sign in, then connect a HighLevel sub-account** with OAuth 2.0 (read-only scopes). Tokens stay on the server and refresh automatically.
- **Prompt-first workspace.** You describe an app and name it, then Claude's output streams into Monaco, read-only while it streams. The preview shows a "Building your app" overlay meanwhile.
- **Live preview** in a Sandpack iframe. Apps call HighLevel through a secure proxy and never see your token.
- **Generated apps paginate:** contacts, conversations and messages load 20 at a time behind Load more. Calendar apps can show events and open booking slots.
- **Stop a build** mid-stream with Stop or Esc. Finished files are kept, the half-written one is discarded, and only the tokens used are charged.
- **Edit code by hand** or refine with follow-up prompts. Every build is a **snapshot** with an AI-written summary, and you can restore any of them from the History sheet.
- **Six ready-made apps** for every user: Customer 360, Daily Briefing, Appointment Prep Sheet, No-Contact Radar, Lead Follow-up Board and Activity Timeline. They're locked, but you can launch them, copy them and pin them to the sidebar.
- **App catalog:** search, type and category filters, ordering, pinning, and full-screen launch at `/run/:id`.
- **AI credits:** every user gets **2,500 credits** once they verify their email (1 credit = $0.001 of Claude list price). Each build holds its worst-case cost up front, then is charged what it actually used. The balance is shown live in the top bar, and every grant, hold and charge is recorded in a ledger.
- **Rate limiting:** builds are limited exactly (1 at a time per app, 2 per user, 10 starts per 10 minutes) before any credits are held or Claude is called. The proxy and API are throttled per user, and the proxy caches repeated reads and backs off when HighLevel returns 429. See [Rate limits](#rate-limits).
- **Graceful failure:** handles malformed model output, interrupted streams, failed HighLevel calls, declined off-topic or harmful prompts, and a missing connection, each with a clear message.

## Live URLs
- **App (Firebase Hosting):** https://genesisaibuilder.web.app
- **Cloud Functions base:** `https://us-central1-genesisaibuilder.cloudfunctions.net` (functions: `api`, `generate`, `hlProxy`, `hlAuthStart`, `hlAuthCallback`)
- **Loom walkthrough:** _TBD_

## Tech stack
| Layer | Choice |
|---|---|
| Backend | Firebase Auth (email/password), Firestore, Cloud Functions 2nd gen on **Node 24**, TypeScript |
| AI | Claude via `@anthropic-ai/sdk`: streaming generation, plus Haiku for snapshot summaries |
| Frontend | Vue 3 + TypeScript + Vite, **shadcn-vue** (Tailwind v4), `@lucide/vue`, `vue-router` |
| Editor / preview | `@guolao/vue-monaco-editor`, `@codesandbox/sandpack-client` |
| HighLevel | OAuth 2.0 (Location), Contacts, Conversations and Calendars APIs (read-only) |
| Hosting | Firebase Hosting (SPA) and Firebase Functions (us-central1) |

## Repository layout
```
.
├── functions/                 Cloud Functions (TypeScript) — see functions/README.md
│   ├── src/                   api · generate (SSE) · hlProxy · hl/ (OAuth, token refresh) · llm/ (prompt, parser, validator)
│   └── templates/             six ready-made apps (templates.json + <slug>/src/**)
├── frontend/                  Vue 3 SPA — see frontend/README.md
│   ├── src/                   views · components (ui/ = shadcn-vue) · composables · lib
│   └── scripts/dev.mjs        `npm run dev`: Cloudflare tunnel + Vite
├── .github/workflows/        deploy.yml: CI on every push/PR, deploy to Firebase on main
├── scripts/                   one-time setup: setup-github-deploy.sh (CI), setup-bot-protection.sh (reCAPTCHA)
├── docs/
│   ├── ARCHITECTURE.md        goals, system diagram, data model, API, flows, security
│   └── screenshots/
├── firebase.json · .firebaserc · firestore.rules · firestore.indexes.json
└── .env.example               every environment variable, grouped by the file it belongs in
```

## Local setup (Firebase emulators)
**Prerequisites:**
- **Node 24**, the Cloud Functions runtime
- **Java 11+** for the Firestore emulator
- **Firebase CLI:** `npm i -g firebase-tools`
- **[`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)**, for example `brew install cloudflared`
- **Accounts:** a HighLevel Marketplace app ([setup below](#highlevel-setup)) and an Anthropic API key

1. **Install**
   ```bash
   git clone https://github.com/nirmalbenny/genesis.git && cd genesis
   (cd functions && npm install) && (cd frontend && npm install)
   firebase use <project-id>          # or edit .firebaserc
   ```
2. **Configure.** Each variable is described in [`.env.example`](.env.example).
   ```bash
   cp functions/.env.example functions/.env          # ANTHROPIC_MODEL, ANTHROPIC_SUMMARY_MODEL
   # functions/.env.local      HL_REDIRECT_URI=http://127.0.0.1:5001/<project-id>/us-central1/hlAuthCallback
   #                           APP_URL=http://localhost:5173
   # functions/.secret.local   ANTHROPIC_API_KEY=…  HL_CLIENT_ID=…  HL_CLIENT_SECRET=…  PREVIEW_TOKEN_SECRET=<openssl rand -hex 32>
   cp frontend/.env.example frontend/.env.local      # Firebase web config; VITE_USE_EMULATORS=true
   ```
3. **Run** in two terminals:
   ```bash
   firebase emulators:start           # auth :9099 · firestore :8080 · functions :5001 · UI :4000
   cd frontend && npm run dev         # tunnel to :5001, then Vite on http://localhost:5173
   ```
4. **Use it:** open http://localhost:5173 and sign up. Click the verification link from the Auth emulator (Emulator UI, port 4000, or the emulator log), then choose **Connect HighLevel** (pick your sandbox sub-account), then describe an app.

**Why `npm run dev` opens a tunnel:** Chrome's Local Network Access protection blocks the Sandpack preview, which runs on a public origin, from calling `127.0.0.1`. [`frontend/scripts/dev.mjs`](frontend/scripts/dev.mjs) handles it:
- it opens a Cloudflare quick tunnel to the functions emulator;
- it waits until the tunnel is reachable and prints the URL;
- it starts Vite with `VITE_FUNCTIONS_BASE_URL` set to the tunnel.

Ctrl+C stops both. `npm run dev:local` runs plain Vite without a tunnel. Deployed builds don't need any of this.

## Configuration reference
| Variable | File | Purpose |
|---|---|---|
| `ANTHROPIC_MODEL` | `functions/.env` | Claude model for generation |
| `ANTHROPIC_SUMMARY_MODEL` | `functions/.env` | Small model for one-line snapshot summaries (default `claude-haiku-5-5`) |
| `HL_REDIRECT_URI` | `functions/.env.local` · `.env.<project-id>` | OAuth callback URL, which must be registered in the HighLevel app |
| `APP_URL` | `functions/.env.local` · `.env.<project-id>` | Where the OAuth callback sends the browser back |
| `ANTHROPIC_API_KEY` | secret | Claude API key |
| `HL_CLIENT_ID`, `HL_CLIENT_SECRET` | secret | HighLevel Marketplace app credentials |
| `PREVIEW_TOKEN_SECRET` | secret | HMAC key for the 15-minute preview tokens that generated apps use |
| `VITE_FIREBASE_*` | `frontend/.env.local` · `.env.production` | Firebase web app config (public by design) |
| `VITE_FUNCTIONS_BASE_URL` | `frontend/.env.*` | Functions base URL. In dev it's set automatically by `npm run dev`. |
| `VITE_USE_EMULATORS` | `frontend/.env.*` | `true` locally, `false` in production |

Secrets go in `functions/.secret.local` for the emulator and in **Secret Manager** for production. They never go in a `.env` file. Every real config file is git-ignored; only the `*.example` templates are tracked.

## Scripts & tests
| Where | Command | What it does |
|---|---|---|
| `frontend/` | `npm run dev` | Tunnel plus Vite dev server |
| `frontend/` | `npm run build` | Type-check (`vue-tsc`) and production build into `dist/` |
| `functions/` | `npm run build` | Compile to `lib/` (runs automatically before deploy) |
| `functions/` | `npm test` | Unit tests: the incremental stream parser (any chunking, unclosed files, refusals, stray trailers), the output validator, and every ready-made template |

## HighLevel setup
1. **Create a Marketplace app** at [marketplace.gohighlevel.com](https://marketplace.gohighlevel.com) at **Sub-account** (Location) level. Enable these scopes:
   `contacts.readonly conversations.readonly conversations/message.readonly calendars.readonly calendars/events.readonly locations.readonly`
   (`locations.readonly` is only used to show the connected sub-account's name.)
2. **Copy the Client ID and Client Secret** into the secrets. The authorize URL includes `version_id`, derived from the client ID. HighLevel returns "No integration found" without it.
3. **Add both redirect URIs** under Advanced Settings → Auth:
   - production: `https://us-central1-<project-id>.cloudfunctions.net/hlAuthCallback`
   - local: `http://127.0.0.1:5001/<project-id>/us-central1/hlAuthCallback`
4. **Create a sandbox sub-account** from the developer dashboard and add contacts, conversations, appointments and calendar availability, so the preview has real data to show.

## Architecture decisions
1. **Generated apps never see the HighLevel token.** They call `hlProxy` with a 15-minute HMAC preview token tied to the user, project and location. The proxy allows only specific GET paths, rejects tokens whose app was deleted or isn't the user's, forces the `locationId`, and attaches the real token server-side.
2. **Firestore is read directly by the client, but written only by Cloud Functions.** Security rules allow owner-only reads and reject every client write, so all validation stays on the server.
3. **One Firestore document per file,** for both project files and snapshot files. This stays clear of the 1 MB document limit and makes snapshots cheap to copy.
4. **A strict `<plan>/<file>/<delete>/<refuse>` output format, parsed incrementally.** Tokens and file boundaries stream to the editor live, while each file is validated whole before it's saved.
5. **Partial results are always kept.** Invalid operations are rejected one at a time, an interrupted stream keeps every completed file, and each generation creates a snapshot with a one-line Haiku summary. Restoring is non-destructive.
6. **SSE over `fetch` with a `ReadableStream`** rather than `EventSource`, because the request needs POST and an Authorization header. A defined event protocol, a 15-second heartbeat, and a hand-written parser, with no extra library.
7. **HighLevel refresh tokens are single-use.** Concurrent refreshes are funnelled into one request per instance, the refresh call happens outside the Firestore transaction, and losing requests read back the winner's token.
8. **The model's context is bounded, and the API reference is hand-written.** Files within a character budget, the last 6 messages, and a compact reference whose endpoints, pagination and free-slot rules were verified against a live sandbox. The prompt makes **pagination** mandatory and forbids hard-coding a location ID.
9. **Ready-made apps are content-hashed templates seeded on first visit.** Seeding is safe to repeat, the apps are locked on the server and edited through copies, and template changes upgrade users' locked copies automatically.
10. **Off-topic or harmful prompts are declined, and never stored.** They're detected through a `<refuse>` reply or the API's refusal stop reason, so a declined prompt can't influence later prompts.

## Rate limits
Limits are set by what abuse would cost. Builds spend real money on Claude, so they're limited **exactly**: Firestore transactions, in the same place as the credit hold. Everything else uses fast **in-memory token buckets** on each function instance. Full design: [ARCHITECTURE §6b](docs/ARCHITECTURE.md#6b-rate-limiting).

| Where | Limit | Counted per | How |
|---|---|---|---|
| Builds (`generate`) | 1 running per app, 2 per user | user | Build slots with a 10-minute expiry, released when the build settles |
| Builds (`generate`) | 10 starts per 10 minutes | user | Sliding-window log, exact wait time |
| Generated apps → HighLevel (`hlProxy`) | 20 requests/s, bursts of 40 | user | Token bucket |
| `hlProxy` | Repeated reads served from cache for 10 s; paused while HighLevel says to back off | sub-account | Cache + pause on HighLevel's 429 |
| `api`, connect HighLevel | 60 changes/min, 300 reads/min | user | Token bucket |

**How a request is evaluated:** checks run cheapest first: token, then validation, then the limit, then the expensive work. A refused build never counts tokens, holds credits or calls Claude. A refused request gets `429` with a `Retry-After` header and `{ "error": { "code": "rate_limited", "message", "retryAfter" } }`. HighLevel's own limit is reported as `hl_rate_limited`. The workspace shows the message, autosave retries once after the wait, and generated apps are told to wait, retry once, then show the message.

**Exact and approximate:** the build limits are exact across all instances. The token buckets are per instance, so they're approximate (looser, never stricter) when traffic spreads over several instances; HighLevel's own 429, which the proxy honours, is the backstop. No Redis: nothing besides builds needs a shared counter at this scale. There's no in-app limit per IP: tokens are signed and can't be guessed, and an IP read from `X-Forwarded-For` can be faked, so flood protection by IP belongs at the edge (see "What I would improve"). Limits are tuned in one place, `LIMITS` in [`rateLimits.ts`](functions/src/rateLimits.ts).

## What I would improve
1. **Diff view:** show what each generation changed compared with the previous snapshot.
2. **HighLevel webhooks:** add a receiver with Ed25519 signature checks, so apps such as a speed-to-lead monitor or a live inbox update in real time. Also use the `AppUninstall` event to delete stored tokens as soon as Genesis is uninstalled.
3. **Shared rate limiting at scale:** move the in-memory token buckets to a shared store (Memorystore or Upstash Redis) for exact limits across instances, and add Cloud Armor or an API gateway for IP limits at the edge, plus Firebase App Check.
4. **Static checks on generated code** before saving, rejecting `v-html`, `eval`, `document.cookie`, script tags, and network calls that bypass the proxy.
5. **Opt-in write scopes,** for example sending messages or booking appointments, behind explicit per-app consent.

## Deployment notes
**Firebase project setup** (one time):
- **Blaze plan,** required for 2nd-gen functions and Secret Manager. Set a budget alert.
- **Authentication:** enable Email/Password, then turn on bot protection with `./scripts/setup-bot-protection.sh <project-id>`. It upgrades Auth to Identity Platform (free up to 50k monthly users; the upgrade can't be undone) and has Firebase score every email/password sign-up and sign-in with reCAPTCHA Enterprise, blocking scores ≤ 0.3. Run it with `AUDIT` as the second argument to score without blocking, or `OFF` to turn it off.
- **Firestore:** Standard edition, Native mode.
- **Hosting:** serves `frontend/dist`. `firebase.json` rewrites every path to `index.html`.

```bash
firebase use <project-id>
# Secrets → Secret Manager (prompts for each value)
firebase functions:secrets:set ANTHROPIC_API_KEY      # also HL_CLIENT_ID, HL_CLIENT_SECRET, PREVIEW_TOKEN_SECRET
# Production params (git-ignored):
#   functions/.env.<project-id>   HL_REDIRECT_URI=https://us-central1-<project-id>.cloudfunctions.net/hlAuthCallback
#                                 APP_URL=https://<project-id>.web.app
#   frontend/.env.production      Firebase web config, VITE_FUNCTIONS_BASE_URL=https://us-central1-<project-id>.cloudfunctions.net,
#                                 VITE_USE_EMULATORS=false
(cd frontend && npm run build)
firebase deploy                                      # Firestore rules and indexes, functions, hosting
```

**Manual steps after the first deploy:**
1. Register the deployed `hlAuthCallback` URL in the HighLevel Marketplace app.
2. Smoke test the full flow: sign up → connect → prompt → watch it stream → live data in the preview → edit a file → restore a snapshot.

**What to expect on a first deploy:**
- **Bucket race on `generate`:** the first deploy can fail one function with a 409 ("Could not create bucket gcf-v2-sources-…") while all the functions race to create the source bucket. The CLI retries it; otherwise run `firebase deploy --only functions:generate`.
- **Cleanup-policy error:** if the CLI says it "could not set up cleanup policy", run `firebase functions:artifacts:setpolicy --location us-central1 --days 1`. Then run `firebase deploy --only hosting` if Hosting wasn't released.

### Continuous deployment (GitHub Actions)
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs on every push and pull request:

- **Check:** functions tests, then the frontend type-check and production build. Pull requests stop here.
- **Deploy** (pushes to `main` only, after the check passes): `firebase deploy` of rules, functions and hosting. Pushes that change only Markdown, `docs/` or `.env.example` don't trigger a run.

It authenticates with **Workload Identity Federation**, so there are no keys. Config comes from GitHub **repository variables**: `FIREBASE_PROJECT_ID`, `VITE_FIREBASE_*`, `ANTHROPIC_MODEL`, `ANTHROPIC_SUMMARY_MODEL`, `WIF_PROVIDER` and `DEPLOY_SERVICE_ACCOUNT`. The secrets stay in Secret Manager.

One-time setup, which needs `gcloud` signed in as a project owner and `gh`:
```bash
./scripts/setup-github-deploy.sh genesisaibuilder nirmalbenny/genesis
```
The script creates a `github-deployer` service account with deploy-only roles. It sets up a workload identity provider that trusts only this repo's `main` branch, and stores `WIF_PROVIDER` and `DEPLOY_SERVICE_ACCOUNT` as repo variables. Until it has run, the deploy job is skipped. To require a manual approval before each deploy, add reviewers to the `production` environment in GitHub settings.

## Troubleshooting
| Symptom | Fix |
|---|---|
| The preview shows "Failed to fetch" locally | Use `npm run dev`, not `dev:local`. Chrome blocks the preview from calling `127.0.0.1` directly. |
| The app hangs locally after working earlier | The quick tunnel expired. Restart `npm run dev` to get a fresh URL. |
| HighLevel says "No integration found with the id" | The authorize URL needs `version_id`, which Genesis adds. Check that `HL_CLIENT_ID` is correct. |
| HighLevel rejects the redirect | The redirect URI must match `HL_REDIRECT_URI` exactly, with `https` and no trailing slash. |
| Deploy fails with "Node.js 20 was decommissioned" | `functions/package.json` must use `"engines": { "node": "24" }`. |
| A ready-made app shows "Connect a sub-account first" | Connect HighLevel from the top bar. Apps always run on the connected sub-account. |
