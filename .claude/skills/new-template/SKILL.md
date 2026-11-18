---
name: new-template
description: Add a ready-made app (a locked template every user gets) to functions/templates — scaffold it following the existing conventions, register it in templates.json, and verify it validates and runs on real HighLevel data. Use when adding or reworking a ready-made app.
---

# Add a ready-made app

Ready-made apps are seeded into every account by `POST /bootstrap`. Each template's version is a hash of its content, so a new or changed template reaches existing users automatically on their next visit.

## 1. Files

Create `functions/templates/<slug>/src/` (`<slug>` in kebab-case, unique). Follow an existing template such as `customer-360`:

- **Required:** `src/main.js` and `src/App.vue`.
- **Allowed:** `.vue`, `.js`, `.ts`, `.css`, `.json` under `src/`, each under 100 KB.
- **Never include** `package.json`, `src/hl.config.js` or anything under `src/genesis/`: they're system-owned and injected by the preview.
- **Data access:** new templates import from `./genesis/hl.js`, the injected client: `usePager(<list>)`, `call(<endpoint>)` and the helpers (`contactName`, `toDate`…). The "Client" section of `functions/src/llm/hlReference.md` describes it, and each resource's lists and endpoints are in its guide, `hl-resources/<id>.md`. The current templates still have their own `api.js` built on `./hl.config.js`, which keeps working. Call HighLevel only through the proxy, and **never hard-code a location ID or sample data**.
- **UI:** Element Plus, as for generated apps. `src/main.js` is `mountApp(App)` from `./genesis/setup.js` (the test requires it); build with its components, icons from `@element-plus/icons-vue`, charts with `vue-chartjs`, following `functions/src/llm/ui/element-plus.md` (no `el-pagination` for HighLevel lists: Load more). No CSS that restyles Element Plus; scoped CSS only for layout. The quickest start is a real build: describe the app in Genesis on the emulators, then copy and refine its files.
- **Pagination:** `usePager`, first page only (`limit` 20 by default), a **Load more** button while `hasMore`, "Showing N of total" (the rules Claude follows, under "Paginated lists" in `functions/src/llm/prompt.ts`).
- **Errors:** show the client's `error.message` as is. The client already retries a 429 once: don't add your own retries.
- **States:** loading, empty and error states for every panel.

## 2. Register it

Add an entry to `functions/templates/templates.json`:

```json
{ "slug": "<slug>", "name": "…", "description": "…", "category": "insights", "icon": "users" }
```

- `category`: one of `sales`, `service`, `scheduling`, `insights`, `other`.
- `icon`: one of `users`, `sun`, `clipboard`, `radar`, `kanban`, `history`. For a new one, add it to `ICONS` in `frontend/src/lib/catalog.ts` (a `@lucide/vue` icon).

## 3. Verify

1. `cd functions && npm test`: the template test checks validation, entry files, category, name, description and icon.
2. On the emulators, open the dashboard: the app appears with the others after setup. Launch it and check it shows **real sandbox data**, pages correctly and handles an empty result.
3. Screenshots at desktop and phone width: `node scripts/shoot.mjs --email <local account> --app "<name>" --run --full`.

## 4. Update the counts in the docs

The number of ready-made apps ("six") appears in `README.md` (features, a screenshot's alt text, the repo tree), `docs/ARCHITECTURE.md` (§1, §9) and `CLAUDE.md`, and the README's features line names each app. Grep for the old number, update each, then run the `docs-check` skill.
