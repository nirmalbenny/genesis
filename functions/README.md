# Genesis — Cloud Functions

Firebase Cloud Functions (2nd gen, **Node 24**, TypeScript). See the [root README](../README.md) for setup and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for the full design.

## Functions

| Function | Auth | Purpose |
|---|---|---|
| `hlAuthStart` | Firebase ID token | Creates an OAuth `state`, returns the HighLevel authorize URL |
| `hlAuthCallback` | public (verified `state`) | Exchanges the code, stores tokens, redirects to the app |
| `api` | Firebase ID token | Projects, files, snapshots, ready-made apps, pinning, preview tokens, disconnect |
| `generate` | Firebase ID token | Streams Claude's tool calls over SSE, checks each change (it must compile), saves the files + a snapshot |
| `hlProxy` | preview token | Forwards allowlisted reads and writes (no deletes) to HighLevel with the real token |
| `cleanupFileBlobs` | scheduled (daily) | Deletes file content no manifest references, after a 7-day grace period (dry run unless `BLOB_CLEANUP=delete`) |

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Compiles to `lib/` (also copies the HighLevel API reference). Runs automatically before deploy. |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Builds, then runs the unit tests (tool loop, stream assembly, tool-input streaming, workspace rules and code checks, context, credits, rate limits, token encryption, templates, traces) |
| `npm run test:e2e` | Integration tests against the running emulators (API, limits, proxy, security rules); never calls Claude or HighLevel |
| `npm run hl:probe -- <resource> --email <account>` | Checks a resource of the HighLevel registry against the sandbox (emulators only) and records its fixtures |
| `npm run lint` | ESLint (TypeScript recommended rules) |

## Layout

```text
src/
  index.ts            exports the six functions
  api.ts              REST router (projects, files, snapshots, bootstrap, pin, cancel, preview token, disconnect)
  generate.ts         SSE generation pipeline (credit hold, build limits, Stop)
  hlProxy.ts          HighLevel proxy (read/write allowlist, project and scope checks, rate limits, cache, forced location)
  hl/oauth.ts         OAuth start + callback      hl/token.ts   token refresh (single-flight, rotation-safe)
  hl/tokenVault.ts    HighLevel tokens encrypted at rest (Cloud KMS envelope encryption, decryption cache)
  llm/                prompt.ts · hlReference.md (API + pagination reference given to the model)
                      tools.ts (the build tools) · turns.ts (tool loop) · assemble.ts (strict stream assembly)
                      toolInput.ts (live file streaming) · workspace.ts + validate.ts (the build's working copy)
                      checkCode.ts (compile and import checks, @vue/compiler-sfc)
                      context.ts (ranking + index) · summary.ts (Haiku summaries)
  credits.ts          rate card, hold and settle, ledger, build slots
  rateLimits.ts       every limit (LIMITS), token bucket, build-start rules
  files/              FileStore: blobs + manifest (manifestStore, blobStore, describe), Firestore fallback,
                      migration, daily cleanup             projects.ts   ownership, lock, location
  scripts/            migrate-files-to-storage.ts (backfill) · measure-filestore.ts (emulator measurements)
  templates.ts        ready-made app seeding                 previewToken.ts · config.ts · http.ts
  *.test.ts           unit tests (npm test)
  e2e/                integration tests against the emulators, including the security rules (npm run test:e2e)
templates/            six ready-made apps (templates.json + <slug>/src/**)
```

## Config

Non-secret params live in `.env` (shared), `.env.local` (emulator only) and `.env.<project-id>` (production). Secrets live in `.secret.local` (emulator) or Secret Manager (production). Every variable is listed in [`.env.example`](.env.example).
