# Genesis — frontend

Vue 3 + TypeScript + Vite single-page app. UI is built with **shadcn-vue** (Tailwind v4) and `@lucide/vue` icons; Monaco for the editor and Sandpack for the live preview. See the [root README](../README.md) for setup and [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) for how it fits together.

## Scripts
| Command | What it does |
|---|---|
| `npm run dev` | Opens a Cloudflare tunnel to the functions emulator, then starts Vite on `http://localhost:5173` pointed at it ([`scripts/dev.mjs`](scripts/dev.mjs)). Needs `cloudflared`. |
| `npm run dev:local` | Plain Vite, no tunnel (the live preview can't reach local functions in Chrome). |
| `npm run build` | Type-checks (`vue-tsc`) and builds to `dist/` using `.env.production`. |
| `npm run preview` | Serves the production build locally. |
| `npm test` | Unit tests (Vitest): the SSE reader and the build state machine. |
| `npm run lint` | ESLint (Vue + TypeScript). |

## Layout
```
src/
  main.ts · router.ts · firebase.ts (emulators when VITE_USE_EMULATORS=true) · style.css (design tokens)
  lib/          api.ts (authed fetch) · sse.ts (SSE reader) · catalog.ts (categories, icons, suggestions)
  composables/  useAuth · useHl (connection) · useApps (live app list) · useCreateApp · useProject
                useGeneration (SSE client) · useLaunchApp · useConnectPrompt
  views/        Dashboard (/) · AppsView (/apps) · Workspace (/p/:id) · RunView (/run/:id) · SignIn/SignUp/AuthForm
  components/   TopBar · SideNav · AppCard · ChatPanel · EditorPanel · FileTree · PreviewPanel · BuildingOverlay
                SnapshotSheet · dialogs (AppDetails, CopyApp, ConnectRequired) · ui/ (generated shadcn-vue)
```

## Conventions
- All UI primitives come from `src/components/ui` (shadcn-vue). Add new ones with `npx shadcn-vue@latest add <name>`.
- State lives in composables (`ref`/`reactive`); no Pinia.
- The browser reads Firestore directly (owner-only rules) and writes only through the `api` / `generate` functions.
