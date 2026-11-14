# HighLevel API reference

## Client (`./genesis/hl.js`, provided at run time; never write it)
Every function throws an Error with `{ code, message, status, retryAfter }`; show `error.message`. A 429 is retried once inside the client, so never add your own retries. Never fire requests on a timer faster than every 30 s. DELETE is never available.
- `LOCATION_ID` — the connected sub-account's id (the client already sends it; use it only if you call `hlGet` on a listed endpoint).
- `LOCATION_NAME` — the connected sub-account's name (may be empty), for headings such as "Contacts · {{ LOCATION_NAME }}".
- `usePager(kind, options)` — a paginated list as Vue refs: `{ items, total, hasMore, loading, error, loadMore(), reset() }`. Kinds and options (all optional except `conversationId`):
    `'contacts'` `{ query, sortBy: 'date_added'|'date_updated', order: 'asc'|'desc', limit }` (query under 3 characters lists everything);
    `'conversations'` `{ query, status: 'all'|'read'|'unread'|'starred', contactId, limit }` (newest message first; `query` searches contact names on the server, from 2 characters, and `total` counts the matches: use it for search, never filter loaded items);
    `'messages'` `{ conversationId, limit }` (newest first; loadMore fetches OLDER ones; for a thread shown oldest-at-top render `[...items].reverse()`; stays empty while `conversationId` is empty).
    `limit` defaults to 20 (max 100). `options` may be a getter or a reactive object: when it changes, the list resets and page 1 loads (debounced). `total` is null when unknown (messages). `error` is null or an Error: show it with `{{ error.message }}`. `pager.reset()` reloads page 1 (use it to retry or after a write).
- `contactName(x)` — the display name of a contact (list item or record), a conversation or anything with name fields. ALWAYS use it to show a person's name: the contacts list lowercases `firstName`/`lastName`/`contactName`.
- `toDate(value)` — a Date (or null) from any HighLevel time: ms, ISO with offset, or "YYYY-MM-DD HH:MM:SS". Never call `new Date(startTime)` yourself (that last format fails in Safari).
- `getContact(contactId)` → the contact record (fields under Endpoints).
- `contactAppointments(contactId, { upcoming })` → that contact's appointments sorted by start, each with `start`/`end` Dates; `upcoming: true` keeps those not started yet. Filter by `appointmentStatus` yourself (e.g. hide `cancelled`).
- `listCalendars({ activeOnly })` → `[{ id, name, description, isActive, slotDuration (minutes), calendarType }]`.
- `listEvents({ from, to, calendarId })` → events across all calendars (or one), sorted by start, each with `calendarName` and `start`/`end` Dates. `from`/`to`: Date, ms or ISO string; default the next 7 days. Keep the window bounded and let the user move it.
- `freeSlots(calendarId, { from, to, timezone })` → `[{ date: 'YYYY-MM-DD', slots: [ISO start time, …] }]`. Range defaults to 7 days, capped at 31; timezone defaults to the viewer's. Only for ACTIVE calendars (`isActive !== false`), otherwise 400 "Calendar is inactive". An empty array means no open slots: say "No open slots in this period", not an error.
- `hlGet(path, params)` — any other read listed under Endpoints, e.g. `hlGet('/contacts/' + id)`. Resolves to the JSON body.
- `hlSend(method, path, body)` — raw POST/PUT; prefer the named writes below.
- `createContact({ firstName, lastName, email, phone, tags?, source? })` → the contact `{ id, … }`. If the location enforces unique email/phone, a duplicate → 400: show the message.
- `updateContact(contactId, fields)` → the contact. Send only the fields to change. `tags` here REPLACES all tags; to add tags use `addTags`.
- `addTags(contactId, tags)` → `{ tags (all tags now), tagsAdded }`. Adds, never removes.
- `addNote(contactId, body)` → `{ id, body, dateAdded }`.
- `bookAppointment({ calendarId, contactId, startTime, title?, toNotify? })` → `{ id, appointmentStatus, … }`. `startTime` must be a slot from `freeSlots`, sent exactly as returned.
- `reschedule(eventId, startTime)` and `cancelAppointment(eventId)`. The response may omit `startTime`: re-fetch (`hlGet('/contacts/' + contactId + '/appointments')`) to show the new time.
- `markRead(conversationId)`, `star(conversationId, on)`.
- `sendEmail({ contactId, subject, html })` (goes to the contact's email; verified) and `sendSms({ contactId, message })` (not yet verified on the sandbox: show the returned error clearly). These reach a real person.
Write errors: 403 `hl_scope_missing` → show the message (the user must reconnect HighLevel). Writes and sends have tighter rate limits than reads.

## Endpoints (verified response shapes; the client calls these for you)
Fields can be null or missing: guard every one. Times: use `toDate`. Names: use `contactName`.
Contacts
- `GET /contacts/` (usePager 'contacts') → items `{ id, firstName, lastName, firstNameRaw, lastNameRaw, contactName, companyName, email, phone, tags, source, type ('lead'|'customer'), city, country, dnd, dateAdded, dateUpdated }`, `meta: { total }`.
    `firstName`, `lastName`, `contactName` and `tags` come back LOWERCASED here (real case only in `firstNameRaw`/`lastNameRaw`); tags are lowercase everywhere.
- `GET /contacts/{contactId}` (getContact) → `{ contact: { id, firstName, lastName, email, phone, companyName, tags, source, type, country, dateAdded, dateUpdated, additionalEmails, additionalPhones } }`. Names in real case; there is NO `contactName` here.
- `GET /contacts/{contactId}/appointments` (contactAppointments) → `{ events: [{ id, title, calendarId, startTime, endTime, appointmentStatus, address }] }`. `startTime`/`endTime` are "YYYY-MM-DD HH:MM:SS" in the sub-account's local time, with no offset.
    `appointmentStatus` (here and in calendar events): `new`, `confirmed`, `showed`, `noshow`, `cancelled`, `invalid`.

Conversations
- `GET /conversations/search` (usePager 'conversations') → items `{ id, contactId, fullName, contactName, email, companyName, tags, lastMessageBody, lastMessageDate (ms), lastMessageType, lastMessageDirection, unreadCount, type }`. `fullName` is in real case.
- `GET /conversations/{conversationId}` → `{ id, contactId, unreadCount, lastMessageBody, lastMessageDate, lastMessageType, type }` (flat, not wrapped). It has NO contact name: keep the list item, or call getContact(contactId).
- `GET /conversations/{conversationId}/messages` (usePager 'messages') → items `{ id, body, direction ('inbound'|'outbound'), dateAdded, messageType, status, meta }`.
    `messageType` seen: `TYPE_SMS`, `TYPE_EMAIL`, and `TYPE_ACTIVITY_*` (e.g. `TYPE_ACTIVITY_APPOINTMENT`): activity entries, not messages; show them as small centered notes, not chat bubbles. Treat any other type as a plain message.
    Email: `body` is plain text and the subject is `meta.email.subject`. `status` is often missing; when it is `failed`, show that clearly.

Calendars
- `GET /calendars/` (listCalendars). Several calendars can be inactive.
- `GET /calendars/events` (listEvents) → events `{ id, title, calendarId, contactId, startTime, endTime, appointmentStatus, address }`; times are ISO with offset ("2026-11-06T14:30:00+05:30").
- `GET /calendars/{calendarId}/free-slots` (freeSlots)

Not available to apps (no endpoint): filtering contacts by tag, custom field or date; opportunities/pipelines; tasks; users; custom field definitions; marking a conversation unread.
