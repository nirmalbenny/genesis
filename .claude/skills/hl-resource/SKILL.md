---
name: hl-resource
description: Add a HighLevel resource (e.g. Opportunities) or an endpoint of one, so generated apps can use it — declare it in hl-resources/, verify it against the real sandbox with the probe, and everything else (scopes, proxy, client, code checks, Claude's reference, UI, tests) follows. Use whenever a generated app needs HighLevel data or actions Genesis doesn't support yet.
---

# Add a HighLevel resource

Every HighLevel resource generated apps can reach is declared once, as data, in `hl-resources/` at the repo root
(docs/plans/hl-resource-registry.md). Two files per resource; the rest is derived:

| Derived automatically | From |
|---|---|
| OAuth scopes requested at connect, the Reconnect notice | `scopes` |
| Proxy routes (method, path, scope, location, `Version`), their tests | `endpoints` |
| `usePager(<list>)` and `call(<endpoint>)` in the injected client | `pager`, `unwrap` |
| The code check (unknown lists and calls are refused) | endpoint names |
| Claude's catalog line (every build) and guide (builds that need it) | `label`, `summary`, `aliases`, `<id>.md` |
| The "Using live data" chips | `label` |

HighLevel facts are **verified, not assumed**: the docs have been wrong (the contacts list keeps `nextPageUrl` on
its last page; free slots reject a `locationId` with 422). The probe checks them against the sandbox.

## 1. Classify and agree

- **A new endpoint on an existing resource:** add it to that resource's files (steps 3–7).
- **A new resource:** a new pair of files. If it needs a scope no resource lists yet, **every connected user must
  reconnect** to use it: confirm with the user before going further.
- **No deletes,** ever (the registry can't declare one). Writes only for features the user asked for; a message to a
  real person is `"send": true` (tighter limits, SMS or Email only).

## 2. The scope (new scopes only; the user does this)

1. The owner enables the scopes on the HighLevel Marketplace app (Advanced Settings → Auth → Scopes). The consent
   screen lists every scope enabled on the app, so if one app serves local and production, production users see it
   too; prefer a separate dev app if HighLevel offers one.
2. Locally (`firebase emulators:start`, then `cd frontend && npm run dev`), the account connected to the sandbox
   should now see **"Reconnect HighLevel to enable" followed by the resource's label**. Reconnect it.

## 3. Read the docs

On <https://marketplace.gohighlevel.com/docs>, for each endpoint: method and path, where the location goes (query or
body, and the parameter's exact name), the `Version` header, the pagination parameters and how the last page is
signalled, the response shape, and the scope. Note what the docs claim; the probe decides.

## 4. Write the two files

`hl-resources/<id>.json` (validated by `functions/src/hl/registry.ts`; an invalid file fails the build):

```json
{
  "id": "opportunities",
  "label": "Opportunities",
  "summary": "deals in sales pipelines (stage, value, status, contact) and the pipelines with their stages",
  "aliases": ["opportunity", "opportunities", "deal", "deals", "pipeline", "pipelines", "stage", "stages", "funnel", "forecast"],
  "scopes": ["opportunities.readonly", "opportunities.write"],
  "version": "v3",
  "endpoints": [
    { "name": "opportunities", "method": "GET", "path": "/opportunities/search", "scope": "opportunities.readonly", "location": "query",
      "pager": { "strategy": "cursorFields", "items": "opportunities", "total": "meta.total", "cursor": { "startAfterId": "meta.startAfterId", "startAfter": "meta.startAfter" }, "search": { "param": "query", "min": 2 }, "options": ["pipelineId", "pipelineStageId", "status", "contactId", "assignedTo", "order"] } },
    { "name": "getPipelines", "method": "GET", "path": "/opportunities/pipelines", "scope": "opportunities.readonly", "location": "query", "unwrap": "pipelines" },
    { "name": "getOpportunity", "method": "GET", "path": "/opportunities/{opportunityId}", "scope": "opportunities.readonly", "location": "none", "unwrap": "opportunity" },
    { "name": "updateOpportunity", "method": "PUT", "path": "/opportunities/{opportunityId}", "scope": "opportunities.write", "location": "none", "unwrap": "opportunity" }
  ]
}
```

(The real `hl-resources/opportunities.json`, verified on the sandbox; `contacts.json`, `conversations.json` and
`calendars.json` show the other strategies and location modes. Each new resource's values come from its docs and
the probe.)

| Field | Meaning |
|---|---|
| `aliases` | words people use for it ("deal", "pipeline"): a request containing one gets this resource's guide |
| `scopes` | every scope to request; each endpoint's `scope` must be one of them |
| `version` | the `Version` header; an endpoint may override it with its own `version` |
| `path` | literal segments and `{placeholders}`; a trailing `/` is optional; a literal path wins over a placeholder |
| `location` | `"query"` / `"body"` (parameter `locationId`, forced to the connected sub-account), `{ "in", "name" }` for another name, or `"none"` |
| `pager` | for a list: `strategy` (`cursorFields`, `lastItem`, `token`, `page`), dot paths to `items`, `total` and the cursor, `search`, pass-through `options`, `fixed` parameters. A list that fits no strategy needs a new one in `frontend/src/sandbox/genesis/hl.js` (and `functions/src/hl/registry.ts`, `functions/src/scripts/hl-probe.ts`), with tests |
| `unwrap` | `call()` returns this field of the response |
| `probe` | query values the probe needs to read the endpoint: `"now"`, `"now+7d"`, `"{calendarId}"` (an id from an earlier list) |

`hl-resources/<id>.md` is Claude's guide, sent only to builds that need the resource. Keep it compact and in this form
(the code check and the client's sync test read the `` `name(` `` and `usePager('…')` / `call('…')` forms):

```markdown
## Opportunities
- `usePager('opportunities', { pipelineId, status: 'open'|'won'|'lost'|'abandoned', query, limit })` (…what to know…).
- `call('getOpportunity', { opportunityId })` → the opportunity (fields below).
- `call('updateOpportunity', { opportunityId }, { pipelineStageId })` → write: only from a button; then `pager.reset()`.

Endpoints (verified response shapes):
- `GET /opportunities/search` (usePager 'opportunities') → items `{ id, name, monetaryValue, status, pipelineId, pipelineStageId, contact }`.

Not available: …
```

## 5. Probe until clean

```bash
cd functions && npm run hl:probe -- <id> --email <local account connected to the sandbox>
```

It calls every read through the local proxy, pages each list to its end with the declared strategy, records an
anonymized fixture per read in `hl-resources/fixtures/<id>/`, and compares the guide's fields with the real ones.

| The probe says | Usually |
|---|---|
| `422` mentioning `locationId` | `"location": "none"`, or `{ "in": "query", "name": "location_id" }` |
| `401` / `403` | the scope isn't granted (reconnect) or is wrong; or the `version` |
| `400` / `422` about a parameter | add it to `probe` (or `fixed`), or fix its name |
| `NO STOP` / `DUPLICATES` | the wrong strategy, or the wrong cursor or end path |
| `guide documents, not returned here` | correct the guide (or it's an optional field: then say so in the guide) |
| `no records returned` | seed demo data first (step 6), then probe again |

Commit the fixtures: `frontend/src/lib/fixtures.test.ts` checks every list's paths against them.

**Writes aren't probed** (they change data): verify each by hand on a record tagged `genesis-test`, through
`call()` in a small local app or the proxy with a preview token. Never send a message without asking the user, and
only to an address they control.

## 6. Demo data

Seed realistic records in the sandbox, tagged `genesis-demo` (the "AutoCar Inc" dealership: e.g. deals in a
"Test drive → Negotiation → Sold" pipeline), so previews and the eval have something to show.

## 7. Verify

1. `/verify` (the generated tests cover every endpoint: routes, neighbours refused, the registry, the fixtures).
2. Add a case to `scripts/eval-builds.mjs` that uses the resource, run `node scripts/eval-builds.mjs <label>` and
   compare with the last baseline: `node scripts/eval-compare.mjs <label>`.
3. Build an app with it in the browser on the emulators: real records in the preview, Load more works, a write works
   on a `genesis-test` record.
4. Docs: ARCHITECTURE §10 lists every route (a test fails otherwise); README "HighLevel setup" scope list and
   "Real data" feature line; CLAUDE.md's allowlist and writes lines.

Lessons from the Opportunities trial: the dev server picks up `hl-resources/` changes by itself (restart it if the
Reconnect notice doesn't appear); tests must never list the resources by hand (use `includes` / `arrayContaining`);
fixtures keep only 3 items per array; say in the guide what the API doesn't return (the sandbox's currency is INR,
not `$`).

## 8. Roll out (new scopes)

1. Production must enforce read scopes: check the logs for `hl.read_scope_missing`, then set the GitHub variable
   `READ_SCOPES=enforce`.
2. Enable the scopes on the production Marketplace app (if separate), merge and deploy.
3. Users see the Reconnect notice. Watch the logs for `hl_scope_missing` and `hl.read_scope_missing`.
