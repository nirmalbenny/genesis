---
name: hl-endpoint
description: Add or change a HighLevel API endpoint that generated apps can call through hlProxy — verify it against HighLevel's docs and the live sandbox, then update the proxy allowlist, the model's API reference, tests and docs together. Use whenever a generated app needs HighLevel data the proxy doesn't allow yet.
---

# Add a HighLevel endpoint

HighLevel facts are **verified, not assumed**: the docs are incomplete and sometimes wrong (for example `nextPageUrl` stays set on the last page of contacts, and free-slots rejects a `locationId` parameter with 422).

## 1. Check it's allowed at all

- **No deletes.** Reads and the listed writes are allowed; `DELETE` is refused everywhere by design. A new write needs a `scope` on its route, and `bodyLocation: true` if HighLevel takes the location in the body. Message sends get `send: true` (tighter limits).
- **Scopes:** if it needs a scope not in `HL_SCOPES` (`functions/src/config.ts`), every connected user must reconnect to grant it. Confirm that with the user before going further.

## 2. Read the docs

Fetch the endpoint's page under <https://marketplace.gohighlevel.com/docs>: path, query parameters, `Version` header, response shape, pagination.

## 3. Confirm against the sandbox

1. On the emulators, connect HighLevel (the "AutoCar Inc" sandbox holds demo data tagged `genesis-demo`).
2. Temporarily add the route to `ROUTES` in `functions/src/hlProxy.ts`.
3. Get a preview token as the user (`POST /api/projects/:id/preview-token`) and call `{functions}/hlProxy/<path>` with `Authorization: Bearer <preview token>`. Test writes only on a dedicated test contact tagged `genesis-test`, and send messages only to an address or number the user controls, after asking.
4. Record what actually comes back: field names, empty results, error codes, how the next page is requested, and whether `locationId` is accepted.

Never print or log access or refresh tokens.

## 4. Make the change

| File | Change |
|---|---|
| `functions/src/hlProxy.ts` | Add a route to `ROUTES` (method, path regex, and for writes `scope` / `bodyLocation` / `send`). Add reads to `NO_LOCATION_PARAM` if HighLevel rejects `locationId`. Calendar paths use `Version: 2021-04-15`, others `2021-07-28` (both verified for writes too). |
| `functions/src/llm/hlReference.md` | Endpoint, parameters, verified response shape and pagination rule. Keep it compact: it's sent with every build. |
| `functions/src/hlProxy.test.ts`, `functions/src/e2e/proxy.e2e.ts` | Unit test for the route (and its scope); an e2e test that it passes the checks (it reaches `connection_changed`) and that a neighbouring path is still refused. |
| `CLAUDE.md` | The proxy allowlist line under "Key decisions" (and the pagination contract if relevant). |
| `docs/ARCHITECTURE.md` | §10 proxy allowlist (and pagination). |

## 5. Verify

Run the `verify` skill, then build a small app on the emulators whose prompt uses the new data, and check the preview shows real sandbox records.
