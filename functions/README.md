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
| `npm test` | Builds, then runs the unit tests (stream parser, output validator, ready-made templates) |

## Layout
```
src/
  index.ts            exports the five functions
  api.ts              REST router (projects, files, snapshots, bootstrap, pin, preview token, disconnect)
  generate.ts         SSE generation pipeline
  hlProxy.ts          HighLevel proxy (GET allowlist, project check, forced location, error mapping)
  hl/oauth.ts         OAuth start + callback      hl/token.ts   token refresh (single-flight, rotation-safe)
  llm/                prompt.ts · hlReference.md (API + pagination reference given to the model)
                      parser.ts (incremental output parser) · validate.ts · summary.ts (Haiku summaries)
  files.ts            file docs, snapshots, restore          projects.ts   ownership, lock, location
  templates.ts        ready-made app seeding                 previewToken.ts · config.ts · http.ts
templates/            six ready-made apps (templates.json + <slug>/src/**)
```

## Config
Non-secret params in `.env` (shared), `.env.local` (emulator only) and `.env.<project-id>` (production);
secrets in `.secret.local` (emulator) or Secret Manager (production). Every variable is listed in [`.env.example`](.env.example).
