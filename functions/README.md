# Genesis — Cloud Functions

Firebase Cloud Functions (2nd gen, **Node 24**, TypeScript). See the [root README](../README.md) for setup and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for the full design.

## Functions

| Function | Auth | Purpose |
|---|---|---|
| `hlAuthStart` | Firebase ID token | Creates an OAuth `state`, returns the HighLevel authorize URL |
| `hlAuthCallback` | public (verified `state`) | Exchanges the code, stores tokens, redirects to the app |
| `api` | Firebase ID token | Projects, files, snapshots, ready-made apps, pinning, preview tokens, disconnect |
| `generate` | Firebase ID token | Streams Claude over SSE and saves validated files + a snapshot |
| `hlProxy` | preview token | Forwards allowlisted read-only GET calls to HighLevel with the real token |

## Scripts

| Command | What it does |
|---|---|
| `npm run build` | Compiles to `lib/` (also copies the HighLevel API reference). Runs automatically before deploy. |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Builds, then runs the unit tests (stream parser, output validator, credits, rate limits, ready-made templates) |
| `npm run test:e2e` | Integration tests against the running emulators (API, limits, proxy, security rules); never calls Claude or HighLevel |
| `npm run lint` | ESLint (TypeScript recommended rules) |

## Layout

```text
src/
  index.ts            exports the five functions
  api.ts              REST router (projects, files, snapshots, bootstrap, pin, cancel, preview token, disconnect)
  generate.ts         SSE generation pipeline (credit hold, build limits, Stop)
  hlProxy.ts          HighLevel proxy (GET allowlist, project check, rate limits, cache, forced location)
  hl/oauth.ts         OAuth start + callback      hl/token.ts   token refresh (single-flight, rotation-safe)
  hl/tokenVault.ts    HighLevel tokens encrypted at rest (Cloud KMS envelope encryption, decryption cache)
  llm/                prompt.ts · hlReference.md (API + pagination reference given to the model)
                      parser.ts (incremental output parser) · validate.ts · summary.ts (Haiku summaries)
  credits.ts          rate card, hold and settle, ledger, build slots
  rateLimits.ts       every limit (LIMITS), token bucket, build-start rules
  files.ts            file docs, snapshots, restore          projects.ts   ownership, lock, location
  templates.ts        ready-made app seeding                 previewToken.ts · config.ts · http.ts
  *.test.ts           unit tests (npm test)
  e2e/                integration tests against the emulators, including the security rules (npm run test:e2e)
templates/            six ready-made apps (templates.json + <slug>/src/**)
```

## Config

Non-secret params live in `.env` (shared), `.env.local` (emulator only) and `.env.<project-id>` (production). Secrets live in `.secret.local` (emulator) or Secret Manager (production). Every variable is listed in [`.env.example`](.env.example).
