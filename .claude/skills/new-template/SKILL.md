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
- **Never include** `package.json` or `src/hl.config.js`: they're system-owned and injected by the preview.
- **Data access:** import `HL_PROXY`, `PREVIEW_TOKEN` and `LOCATION_ID` from `./hl.config.js`, call HighLevel only through the proxy, and **never hard-code a location ID or sample data**.
- **Pagination:** follow `functions/src/llm/hlReference.md` exactly: 20 at a time behind **Load more**, "Showing N of total".
- **Errors:** show the proxy's `error.message`; on 429, wait `error.retryAfter` and retry once.
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
3. Screenshots at desktop and phone width.

## 4. Update the counts in the docs

The number of ready-made apps appears in `README.md` (features), `docs/ARCHITECTURE.md` (§1, §9) and `CLAUDE.md`. Update each, then run the `docs-check` skill.
