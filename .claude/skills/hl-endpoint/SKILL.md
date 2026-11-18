---
name: hl-endpoint
description: Add or change a HighLevel API endpoint that generated apps can call through hlProxy — verify it against HighLevel's docs and the live sandbox, then update the proxy allowlist, the model's API reference, tests and docs together. Use whenever a generated app needs HighLevel data the proxy doesn't allow yet.
---

# Add a HighLevel endpoint

HighLevel facts are **verified, not assumed**: the docs are incomplete and sometimes wrong (for example `nextPageUrl` stays set on the last page of contacts, and free-slots rejects a `locationId` parameter with 422).

## 1. Check it's allowed at all

- **No deletes.** Reads and the listed writes are allowed; `DELETE` is refused everywhere by design. A new write needs a `scope` on its route, and `bodyLocation: true` if HighLevel takes the location in the body. Message sends get `send: true` (tighter limits).
- **Scopes:** if it needs a scope no resource in `hl-resources/` lists yet, every connected user must reconnect to grant it. Confirm that with the user before going further.

## 2. Read the docs

Fetch the endpoint's page under <https://marketplace.gohighlevel.com/docs>: path, query parameters, `Version` header, response shape, pagination.

## 3. Confirm against the sandbox

1. On the emulators, connect HighLevel (the "AutoCar Inc" sandbox holds demo data tagged `genesis-demo`).
2. Temporarily add the endpoint to its resource in `hl-resources/<id>.json` (then `npm run build` in `functions/`).
3. Get a preview token as the user (`POST /api/projects/:id/preview-token`) and call `{functions}/hlProxy/<path>` with `Authorization: Bearer <preview token>`. Test writes only on a dedicated test contact tagged `genesis-test`, and send messages only to an address or number the user controls, after asking.
4. Record what actually comes back: field names, empty results, error codes, how the next page is requested, and whether `locationId` is accepted.

Never print or log access or refresh tokens.

## 4. Make the change

| File | Change |
|---|---|
| `hl-resources/<id>.json` | Add the endpoint: `name`, `method`, `path` template (`{placeholders}`), `scope`, `location` (`query` / `body` / `none`, or `{ in, name }`), `send` for messages, `version` if it differs from the resource's. The OAuth scopes and the proxy's routes are derived from it (`functions/src/hl/registry.ts`); a new resource is a new file. |
| `functions/src/llm/hlReference.md` | Endpoint and verified response shape; if it gets a client function, document it under "Client". Keep it compact: it's sent with every build. |
| `frontend/src/sandbox/genesis/hl.js` (+ `hl.test.ts`) | A named function (a write) or a `usePager` kind (a paginated list) with its verified cursor. Only add, never change existing exports. |
| Tests | Generated for every registry endpoint (`hl/registry.test.ts`: allowed, neighbours and deletes refused; `e2e/proxy.e2e.ts`: every write passes the checks). Add a test only for behaviour the registry can't express. |
| `CLAUDE.md` | The proxy allowlist line under "Key decisions" (and the pagination contract if relevant). |
| `docs/ARCHITECTURE.md` | §10 proxy allowlist (a test fails if a route is missing) and pagination. |

## 5. Verify

Run the `verify` skill, then build a small app on the emulators whose prompt uses the new data, and check the preview shows real sandbox records.
