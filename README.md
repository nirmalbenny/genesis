# Genesis — AI-powered HighLevel app builder

Describe an app in plain English. Genesis streams the code from Claude into a live editor and runs the result on your **real HighLevel data**: contacts, conversations and calendars.

- **Sign in, then connect a HighLevel sub-account** with OAuth 2.0 (read-only scopes).
- **Prompt, then watch it build.** Claude's output streams into Monaco, while the preview shows a building animation.
- **Live preview** in Sandpack, calling HighLevel through a secure proxy, with pagination on every list.
- **Edit the code by hand,** refine it with follow-up prompts, and restore any **snapshot** (each one has an AI-written summary).
- **Six ready-made apps** for every user (Customer 360, Daily Briefing, Appointment Prep Sheet, No-Contact Radar, Lead Follow-up Board, Activity Timeline). They're locked, but you can launch them, copy them and pin them to the sidebar.

Full design, data model and flows: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Live URLs
- **App (Firebase Hosting):** https://genesisaibuilder.web.app
- **Cloud Functions base:** `https://us-central1-genesisaibuilder.cloudfunctions.net` (functions: `api`, `generate`, `hlProxy`, `hlAuthStart`, `hlAuthCallback`)
- **Loom walkthrough:** _TBD_

## HighLevel setup
1. **Create a Marketplace app** at [marketplace.gohighlevel.com](https://marketplace.gohighlevel.com) at **Sub-account** (Location) level. Enable these scopes in the app's Auth settings:
   `contacts.readonly conversations.readonly conversations/message.readonly calendars.readonly calendars/events.readonly locations.readonly`
   (`locations.readonly` is only used to show the connected sub-account's name.)
2. **Copy the Client ID and Client Secret** into the functions secrets (see below). The authorize URL includes `version_id`, derived from the client ID. HighLevel returns "No integration found" without it.
3. **Add the redirect URI** `HL_REDIRECT_URI` = `<functions base>/hlAuthCallback`.
   Locally, use `http://127.0.0.1:5001/<project-id>/us-central1/hlAuthCallback`, or an HTTPS tunnel if HighLevel rejects localhost.
4. **Create a sandbox sub-account** from the developer dashboard and add some contacts, conversations and appointments, so the preview has real data to show.

## Local setup (Firebase emulators)
Prerequisites: Node 24 (the Cloud Functions runtime; Node 20 was decommissioned on 30 Oct 2026), Java 11+ (for the Firestore emulator), and `npm i -g firebase-tools`.

```bash
# Functions config: non-secret values in functions/.env, secrets in functions/.secret.local
cp functions/.env.example functions/.env        # ANTHROPIC_MODEL, ANTHROPIC_SUMMARY_MODEL
#   functions/.env.local: HL_REDIRECT_URI (127.0.0.1 callback), APP_URL=http://localhost:5173  — emulator only
#   functions/.secret.local: ANTHROPIC_API_KEY, HL_CLIENT_ID, HL_CLIENT_SECRET, PREVIEW_TOKEN_SECRET (any long random string)
cp frontend/.env.example frontend/.env.local    # VITE_FIREBASE_* (public web config), VITE_FUNCTIONS_BASE_URL, VITE_USE_EMULATORS=true

(cd functions && npm i && npm run build) && (cd frontend && npm i)
firebase emulators:start                        # auth 9099 · firestore 8080 · functions 5001
cd frontend && npm run dev                      # opens a Cloudflare tunnel, then Vite on http://localhost:5173
```
- **Tests:** `cd functions && npm test` (the stream parser, the output validator, and checks on every ready-made template).
- **Why `npm run dev` opens a tunnel:** Chrome's Local Network Access protection stops the Sandpack preview iframe, which runs on a public origin, from fetching `127.0.0.1`. `npm run dev` ([`frontend/scripts/dev.mjs`](frontend/scripts/dev.mjs)) starts a Cloudflare quick tunnel to the functions emulator, waits until it's online, prints the URL, and starts Vite with `VITE_FUNCTIONS_BASE_URL` pointed at it. Ctrl+C stops both. It needs `cloudflared` (`brew install cloudflared`). Use `npm run dev:local` for plain Vite without a tunnel. A deployed app doesn't need any of this.

## Architecture decisions
1. **Generated apps never see the HighLevel token.** They call `hlProxy` with a 15-minute HMAC preview token tied to the user, project and location. The proxy allows only specific GET paths, forces the `locationId`, and attaches the real token server-side.
2. **Firestore is read directly by the client, but written only by Cloud Functions.** Security rules allow owner-only reads and reject every client write, so all validation stays on the server.
3. **One Firestore document per file,** for both project files and snapshot files. This stays clear of the 1 MB document limit and makes snapshots cheap to copy.
4. **A strict `<plan>/<file>/<delete>/<refuse>` output format, parsed incrementally.** Tokens and file boundaries stream to the editor live, while each file is validated whole before it's saved.
5. **Partial results are always kept.** Invalid operations are rejected one at a time, an interrupted stream keeps every completed file, and each generation creates a snapshot with a one-line Haiku summary. Restoring is non-destructive.
6. **SSE over `fetch` with a `ReadableStream`** rather than `EventSource`, because the request needs POST and an Authorization header. A defined event protocol, a 15-second heartbeat, and a hand-written parser, with no extra library.
7. **HighLevel refresh tokens are single-use.** Concurrent refreshes are funnelled into one request per instance, the refresh call happens outside the Firestore transaction, and losing requests read back the winner's token.
8. **The model's context is bounded, and the API reference is hand-written.** Files within a character budget, the last 6 messages, and a compact reference whose endpoints and pagination patterns were verified against a live sandbox. The prompt makes **pagination** (Load more, "Showing N of total") mandatory and forbids hard-coding a location ID.
9. **Ready-made apps are content-hashed templates seeded on first visit.** Seeding is safe to repeat, the apps are locked on the server and edited through copies, and template changes upgrade users' locked copies automatically.
10. **Off-topic or harmful prompts are declined, and never stored.** They're detected through a `<refuse>` reply or the API's refusal stop reason, so a declined prompt can't influence later prompts.

## What I would improve
1. **Cancel button and diff view:** let users stop a build mid-stream, and show what each generation changed compared with the previous snapshot.
2. **HighLevel webhooks:** add a receiver with Ed25519 signature checks, so apps such as a speed-to-lead monitor or a live inbox update in real time. Also use the `AppUninstall` event to delete stored tokens as soon as Genesis is uninstalled.
3. **Rate limiting** per user on `generate` and `hlProxy`, plus caching in the proxy to stay within HighLevel's limit of about 100 requests per 10 seconds.
4. **Static checks on generated code** before saving, rejecting `v-html`, `eval`, `document.cookie`, script tags, and network calls that bypass the proxy.
5. **Opt-in write scopes,** for example sending messages or booking appointments, behind explicit per-app consent.

## Deployment notes
**Firebase project:**
- **Blaze plan,** required for 2nd-gen functions and Secret Manager.
- **Authentication:** Email/Password enabled.
- **Firestore** in Native mode.
- **Hosting** for the `frontend/dist` build.

```bash
firebase use <project-id>
firebase functions:secrets:set ANTHROPIC_API_KEY      # and HL_CLIENT_ID, HL_CLIENT_SECRET, PREVIEW_TOKEN_SECRET
# functions/.env.<project-id>: HL_REDIRECT_URI=https://us-central1-<project-id>.cloudfunctions.net/hlAuthCallback,
#   APP_URL=https://<project-id>.web.app   (overrides functions/.env on deploy; .env.local stays emulator-only)
# frontend/.env.production: VITE_FUNCTIONS_BASE_URL=https://us-central1-<project-id>.cloudfunctions.net, VITE_USE_EMULATORS=false
(cd frontend && npm run build)
firebase deploy                                         # hosting, functions, firestore rules and indexes
```
**Manual steps after the first deploy:**
1. Register the deployed `hlAuthCallback` URL as a redirect URI in the HighLevel Marketplace app.
2. Confirm the scopes above are enabled.
3. Smoke test the full flow: sign up → connect → prompt → preview → edit → restore.

There's no CI/CD; deploys are manual with the Firebase CLI.
