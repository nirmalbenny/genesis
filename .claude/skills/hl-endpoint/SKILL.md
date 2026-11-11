---
name: hl-endpoint
description: Add or change a HighLevel API endpoint that generated apps can call through hlProxy — verify it against HighLevel's docs and the live sandbox, then update the proxy allowlist, the model's API reference, tests and docs together. Use whenever a generated app needs HighLevel data the proxy doesn't allow yet.
---

# Add a HighLevel endpoint

HighLevel facts are **verified, not assumed**: the docs are incomplete and sometimes wrong (for example `nextPageUrl` stays set on the last page of contacts, and free-slots rejects a `locationId` parameter with 422).

## 1. Check it's allowed at all

- **GET only.** The proxy is read-only by design; writes to HighLevel were deliberately not built.
- **Scopes:** if it needs a scope not in `HL_SCOPES` (`functions/src/config.ts`), every connected user must reconnect to grant it. Confirm that with the user before going further.

## 2. Read the docs

Fetch the endpoint's page under <https://marketplace.gohighlevel.com/docs>: path, query parameters, `Version` header, response shape, pagination.

## 3. Confirm against the sandbox

1. On the emulators, connect HighLevel (the "AutoCar Inc" sandbox holds demo data tagged `genesis-demo`).
2. Temporarily add the path's regex to `ALLOWED` in `functions/src/hlProxy.ts`.
3. Get a preview token as the user (`POST /api/projects/:id/preview-token`) and call `GET {functions}/hlProxy/<path>` with `Authorization: Bearer <preview token>`.
4. Record what actually comes back: field names, empty results, error codes, how the next page is requested, and whether `locationId` is accepted.

Never print or log access or refresh tokens.

## 4. Make the change

| File | Change |
|---|---|
| `functions/src/hlProxy.ts` | Add a regex to `ALLOWED`. Add it to `NO_LOCATION_PARAM` if HighLevel rejects `locationId`. Calendar paths use `Version: 2021-04-15`, others `2021-07-28`. |
| `functions/src/llm/hlReference.md` | Endpoint, parameters, verified response shape and pagination rule. Keep it compact: it's sent with every build. |
| `functions/src/e2e/proxy.e2e.ts` | A test that the new path passes the allowlist (it reaches `connection_changed`) and that a neighbouring path is still refused. |
| `CLAUDE.md` | The proxy allowlist line under "Key decisions" (and the pagination contract if relevant). |
| `docs/ARCHITECTURE.md` | §10 proxy allowlist (and pagination). |

## 5. Verify

Run the `verify` skill, then build a small app on the emulators whose prompt uses the new data, and check the preview shows real sandbox records.
