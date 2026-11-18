# Plan: HighLevel resource registry

Status: proposed, not started (2026-11-18). Branch per phase, merged one at a time.

## 1. Goal

Supporting a new HighLevel resource (for example Opportunities) should take **two files and one command**, not edits
across ten files:

1. declare the resource (`<resource>.json`) and what Claude should know about it (`<resource>.md`);
2. run the probe, which checks the declaration against the real sandbox and records test fixtures;
3. everything else (scopes, proxy, client, code checks, UI, Claude's reference, tests) is derived automatically.

A skill, `/hl-resource`, then walks through those steps (section 10). Target: a standard resource in **2–4 hours**,
from about 2 days today.

## 2. Today

HighLevel access is declared by hand in five layers, and a new resource touches all of them:

| Layer | Where | What is hand-written |
|---|---|---|
| OAuth scopes | `functions/src/config.ts` `HL_SCOPES` | 10 scopes |
| Proxy allowlist | `functions/src/hlProxy.ts` `ROUTES`, `NO_LOCATION_PARAM` | 17 routes (9 reads, 8 writes) as regexes; the `Version` header chosen by path (`/calendars` → `2021-04-15`, else `2021-07-28`) |
| Injected client | `frontend/src/sandbox/genesis/hl.js` | a `PAGERS` entry per list (cursor code), a named function per read or write, quirk helpers |
| Claude's reference | `functions/src/llm/hlReference.md`, `prompt.ts` | every resource's shapes and quirks, sent with every build; resource names repeated in two prompt rules and in "Not available to apps" |
| Product and docs | `Dashboard.vue`, `ChatPanel.vue`, README, ARCHITECTURE §10, CLAUDE.md, `proxy.e2e.ts` | the data chips (two copies), scope list, allowlist tables, a test that uses `/opportunities/search` as a refused path |

Problems this plan removes:

- **Cost of change:** about 10 files and 2 days for a new resource; easy to miss one (the existing `/hl-endpoint` skill
  misses the prompt rules, the UI and the rollout order).
- **Prompt growth:** the reference is already 8 KB, **45% of the system prompt** (18 KB), for three resources. At ten
  resources it would outweigh the rules and slow every build.
- **Assumptions baked into the proxy:** one `Version` rule by path (HighLevel's Opportunities search page lists only
  `v3`, unverified), a forced `locationId` query parameter, and scope checks on writes only.
- **No reconnect path:** granted scopes are stored only in `hlTokens`, which the browser can't read, so users who
  connected before a new scope existed are never told to reconnect.

## 3. Decisions

1. **Definitions live in the repo, not Firestore.** The registry replaces the proxy's allowlist, a security boundary:
   changes go through review, CI tests and git history, and the emulators, CI and production stay identical. A
   database wouldn't remove the slow steps (the Marketplace scope, verification, reconnects). The files are plain JSON,
   so runtime switches (a kill switch per resource) could later move to Firestore by changing the loader only.
2. **One shared folder,** `hl-resources/` at the repo root, read by functions and frontend. This is an exception to
   the CLAUDE.md rule of duplicating small shared types: the registry isn't small, and two copies would drift. Needs
   confirmation (section 11).
3. **Add-only stays.** Today's client exports (`getContact`, `listEvents`, `createContact`, …) and `usePager` kinds keep
   working unchanged; the registry adds to the client, it never renames.
4. **No deletes,** as today: the registry has no way to declare a `DELETE`.

## 4. The registry

`hl-resources/<id>.json`, data only (no code, no regexes):

```json
{
  "id": "opportunities",
  "label": "Opportunities",
  "summary": "deals in pipelines, with stage, value and contact",
  "aliases": ["opportunity", "deal", "pipeline", "stage"],
  "scopes": ["opportunities.readonly", "opportunities.write"],
  "version": "2021-07-28",
  "endpoints": [
    {
      "name": "opportunities", "method": "GET", "path": "/opportunities/search", "scope": "opportunities.readonly",
      "location": { "in": "query", "name": "locationId" },
      "pager": { "strategy": "startAfterId", "items": "opportunities", "total": "meta.total", "query": { "param": "q", "min": 2 } }
    },
    { "name": "getOpportunity", "method": "GET", "path": "/opportunities/{opportunityId}", "scope": "opportunities.readonly", "location": "none", "unwrap": "opportunity" },
    { "name": "updateOpportunity", "method": "PUT", "path": "/opportunities/{opportunityId}", "scope": "opportunities.write", "location": "none" }
  ]
}
```

The values above illustrate the format; real ones come from verification.

| Field | Meaning |
|---|---|
| `scopes` | every scope to request for the resource (conversations and calendars have several) |
| `internal` | not shown to users or Claude (the `locations` resource: the scope read once when connecting) |
| endpoint `scope` | the scope this endpoint needs; one of the resource's `scopes` |
| `version` | the `Version` header; an endpoint may override it |
| `path` | literal segments and `{name}` placeholders (`[\w-]+`); a trailing `/` is optional; a literal path wins over a placeholder |
| `location` | `"query"` / `"body"` (the parameter `locationId`, forced to the connected sub-account), `{ in, name }` for another name, or `"none"` (the token already scopes it, as free slots) |
| `send` | a message to a real person (tighter limits, SMS or Email only); any `POST`/`PUT` is a write (write scope, write limits) |
| `pager` | a list for `usePager`: a named strategy plus where the items, total and search parameter are |
| `unwrap` | for `call()`: return this key of the response (`{ contact: … }` → the contact) |

`hl-resources/<id>.md` is Claude's section for the resource: verified response shapes, quirks and rules, about 15
lines. A loader (`functions/src/hl/registry.ts`) validates every file: no `DELETE`, strict paths, known scopes, unique names, no two endpoints on the same method and path. An invalid registry fails the tests and every function's start.

**Pager strategies,** implemented once in the client and chosen by name; today's three lists map onto the first three:

| Strategy | Next page | End of list |
|---|---|---|
| `startAfterId` | `meta.startAfterId` + `meta.startAfter` | a short page (`nextPageUrl` can't be trusted) |
| `lastSortValue` | the last item's `sort[0]` | a short page, or `total` reached |
| `lastMessageId` | `lastMessageId` | `nextPage` false |
| `page` | `page + 1` | a short page |

A resource that fits none needs a new strategy (code, with its own tests). That is the one case still needing code.

## 5. What is derived

| Today, by hand | Derived from the registry |
|---|---|
| `HL_SCOPES` | every resource's scopes |
| `ROUTES`, `NO_LOCATION_PARAM`, the version rule | routes with scope, location mode, version, `write`, `send` |
| Proxy tests per route | generated per endpoint: allowed, scope required, neighbouring paths refused, `DELETE` refused; e2e: every write passes the checks up to `connection_changed` |
| A `PAGERS` entry and a named function per endpoint | `usePager(<pager name>)` and `call(<endpoint name>, params, body)`; quirk helpers stay hand-written |
| The code check's list of client names | registry names, plus a new check: a `usePager('…')` or `call('…')` with a name that doesn't exist is refused before saving |
| Data chips in `Dashboard.vue` and `ChatPanel.vue` | registry `label`s |
| ARCHITECTURE §10 allowlist table | a test fails when a route is missing from it |

The registry reaches each side as follows: functions copy `hl-resources/` into `lib/` at build (as they do with the
Markdown files today); the frontend imports it at build time; the preview receives it as an injected
`src/genesis/hl.registry.js` next to the client, never saved.

## 6. Claude's reference: a catalog, plus sections on demand

| Where | What | Size |
|---|---|---|
| System prompt (cached, the same for everyone) | the client basics (errors, `usePager`, `call`, helpers) and a **catalog**: one line per resource from `label`, `summary` and its names | grows by one line per resource |
| User message, per build | the full `.md` sections for the resources this build needs | only what the build uses |

Sections are chosen on the server, so no extra turn:

1. resources the app already uses (the file manifest already records which client helpers each file imports; it will
   also record `usePager` and `call` names);
2. resources whose `aliases` appear in the prompt;
3. contacts, always (nearly every app shows people).

The catalog tells Claude every resource that exists, so it can ask for a missing one in its plan. A `read_reference`
tool (the `read_files` pattern) is the fallback, added only if the eval shows missed sections.

## 7. Scopes and reconnecting

- The OAuth callback stores the granted scopes on `users/{uid}.hl.scopes` (scopes aren't secret).
- The frontend compares them with the registry and shows "Reconnect to enable Opportunities" in the top bar's
  sub-account control and in the workspace.
- The proxy checks the read scope as well as the write scope, and `hl_scope_missing` names the resource.
- Rollout order for a new scope: enable it on the Marketplace app, then deploy, then users reconnect when prompted.

## 8. The probe

`npm run hl:probe -- <id>` (functions), on the emulators with the local account connected to the sandbox:

1. creates a throwaway app and preview token for that account;
2. calls every read endpoint through the proxy, pages each list to the end and checks the strategy's end rule;
3. checks the declared location mode and `version` are accepted (and reports what HighLevel says when they aren't);
4. calls writes only when given `--writes`, and only on records tagged `genesis-test`; never sends messages;
5. saves anonymized sample responses (names, emails, phones and ids replaced) as fixtures under
   `hl-resources/fixtures/<id>/`, used by the client's tests;
6. compares the fields the `.md` mentions with what came back, and prints the differences.

Rerunning it later catches HighLevel changing its API. It never prints tokens.

## 9. Phases

| Phase | Work | Done when | Effort |
|---|---|---|---|
| 0. Baseline | Run the build eval; snapshot today's routes and prompt size | numbers recorded here | 1 h + ~$1 |
| 1. Registry and proxy | Folder, schema and loader; move contacts, conversations and calendars into it; derive `HL_SCOPES` and `ROUTES`; generated route tests | the derived routes equal today's (a test); all tests pass; no behaviour change | 1–1.5 days |
| 2. Reference on demand | Split `hlReference.md` into the core plus one section per resource; catalog; per-build selection | the system prompt shrinks; eval passes with no rise in failures, tokens or credits | 1 day |
| 3. Scopes | Scopes on the user's document, reconnect prompt, read-scope check | an e2e test for a connection missing a read scope; UI shows the prompt (screenshot) | 0.5 day |
| 4. Client from the registry | Pager strategies, `call()`, injected registry; code check validates names; UI chips from labels | existing exports unchanged; client tests on fixtures; eval passes | 1–1.5 days |
| 5. Probe | `hl:probe` with fixtures and the comparison report | probe passes on the three existing resources | 1 day |
| 6. Skill and proof | `/hl-resource` skill; add **Opportunities** with it end to end | Opportunities needed only the two files, the probe, seed data and an eval case | 0.5 day + the resource |

About 5–6 days in total. Each phase ships alone; 1 to 3 give most of the value.

### Progress

- **Phase 0 (2026-11-18):** eval baseline `registry-baseline`: 13 of 13 cases pass (contacts 39 credits, dashboard 42,
  inbox 45, calendar 38, follow-ups 13–16, large app 90 and 74). System prompt 18,123 characters, of which the
  HighLevel reference is 8,143 (45%).
- **Phase 1 (2026-11-18):** `hl-resources/` (contacts, conversations, calendars, locations) and
  `functions/src/hl/registry.ts`; `HL_SCOPES` and the proxy's routes are derived, the location parameter and `Version`
  come from each route. Tests: the 17 hand-written routes reproduced exactly, the 10 scopes unchanged, every endpoint
  reachable with neighbours and deletes refused, strict validation (17 cases), and ARCHITECTURE §10 listing every
  route; the e2e write test now covers every registry write. Unit 109/109, e2e 43/43. Live check: all 9 reads through
  the proxy on the sandbox return 200 with their version and location handling (free slots without a location).

## 10. The skill: `/hl-resource` (after phase 6)

Replaces `/hl-endpoint`:

1. **Classify:** a new endpoint on an existing resource, or a new resource. No deletes. Writes only when asked;
   message sends are `send`.
2. **New scope?** Confirm with the user that connected users must reconnect, then have the owner enable the scope on
   the Marketplace app and reconnect the local account.
3. **Read the docs page:** path, location parameter, `Version`, pagination, response shape, scope.
4. **Write** `hl-resources/<id>.json` and `<id>.md` (or add an endpoint to an existing file).
5. **Probe** until clean; commit the fixtures. A list that fits no strategy needs a new strategy with tests.
6. **Seed** sandbox demo data tagged `genesis-demo`; add an eval case to `scripts/eval-builds.mjs`.
7. **Verify:** `/verify`, a real build on the emulators that uses the resource, and the eval against the last baseline.
8. **Roll out:** enable the scope on the production Marketplace app, deploy, check the logs for `hl_scope_missing`.

Everything else (scopes, proxy, client, code checks, UI, reference, tests, ARCHITECTURE table check) follows from the
two files.

## 11. Open decisions

1. The shared `hl-resources/` folder (section 3, decision 2).
2. Whether to build the `read_reference` fallback tool now or only if the eval shows misses (recommended: only if needed).
3. Which resource proves the system in phase 6 (recommended: Opportunities and Pipelines, the most requested
   HighLevel data that apps can't reach today).

## 12. Risks

| Risk | Mitigation |
|---|---|
| A generated route is broader than intended | paths are templates, not regexes; generated tests check neighbours are refused; phase 1 proves today's routes are reproduced exactly |
| Claude misses a section it needed | the catalog lists every resource; aliases plus the app's own usage; eval cases per resource; the fallback tool |
| HighLevel behaves unlike its docs | the probe is mandatory before a resource ships, and can be rerun to catch drift |
| An existing generated app breaks | add-only client; existing exports untouched; the eval and the ready-made apps' compile tests run on every change |
| Users never reconnect | the reconnect prompt, and the proxy's error names what's missing |
