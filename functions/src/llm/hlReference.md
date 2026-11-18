# HighLevel API reference

## Client (`./genesis/hl.js`, provided at run time; never write it)
Every function throws an Error with `{ code, message, status, retryAfter, details }`; `message` is already readable, so show it as is (never JSON.stringify an error). A 429 is retried once inside the client, so never add your own retries. Never fire requests on a timer faster than every 30 s. DELETE is never available.
Error codes worth handling: `hl_duplicate_contact` (the location forbids duplicates; `details.contactId` is the existing contact and `details.matchingField` is `email` or `phone`: offer to open or update it instead), `hl_request_failed` (HighLevel rejected the input, e.g. "Email must be an email", "Calendar is inactive": show it next to the item), `rate_limited` / `hl_rate_limited` (too many requests even after the retry; `retryAfter` is in seconds: stop and say when to try again), `hl_scope_missing` (reconnect HighLevel), `hl_unavailable`, `network_error`, `connection_changed` (reload the preview).
- `LOCATION_ID` — the connected sub-account's id (the client already sends it; use it only if you call `hlGet` on a listed endpoint).
- `LOCATION_NAME` — the connected sub-account's name (may be empty), for headings such as "Contacts · {{ LOCATION_NAME }}".
- `usePager(kind, options)` — a paginated list as Vue refs: `{ items, total, hasMore, loading, error, loadMore(), reset() }`. Each guide lists its kinds and their options. `limit` defaults to 20 (max 100). `options` may be a getter or a reactive object: when it changes, the list resets and page 1 loads (debounced). `total` is null when unknown. `error` is null or an Error: show it with `{{ error.message }}`. `pager.reset()` reloads page 1 (use it to retry or after a write).
- `contactName(x)` — the display name of a contact (list item or record), a conversation or anything with name fields. ALWAYS use it to show a person's name: the contacts list lowercases `firstName`/`lastName`/`contactName`.
- `toDate(value)` — a Date (or null) from any HighLevel time: ms, ISO with offset, or "YYYY-MM-DD HH:MM:SS". Never call `new Date(startTime)` yourself (that last format fails in Safari).
- `call(name, params, body)` — any endpoint a guide lists by name: `{placeholders}` in its path come from `params`, other params become the query of a read; a write sends `body`. Resolves to the JSON (or the field the guide names), e.g. `call('getContact', { contactId })`. Prefer a named function when the guide has one.
- `hlGet(path, params)` — any other read listed under a guide's Endpoints, e.g. `hlGet('/contacts/' + id)`. Resolves to the JSON body.
- `hlSend(method, path, body)` — raw POST/PUT; prefer the named writes in the guides.
Write errors: 403 `hl_scope_missing` → show the message (the user must reconnect HighLevel). Writes and sends have tighter rate limits than reads.
Fields can be null or missing: guard every one. Times: use `toDate`. Names: use `contactName`.

## HighLevel data
Every resource apps can use, one line each. The guides for the resources this request needs follow at the end, under "HighLevel guides": use only the functions and endpoints a guide documents. Anything not listed here has no endpoint (for example tasks, users, invoices): say so in the plan instead of inventing a call.
