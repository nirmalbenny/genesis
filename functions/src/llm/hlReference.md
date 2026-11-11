# HighLevel API reference (via proxy)

Base: `HL_PROXY` from `./hl.config.js`. Every request sends header `Authorization: Bearer ${PREVIEW_TOKEN}`. Reads are GET; writes are POST/PUT with a JSON body (see Writes). DELETE is never available.
`locationId` is added automatically by the proxy, but pass `locationId=${LOCATION_ID}` anyway where listed.
Responses are JSON. On failure the proxy returns `{ "error": { "code", "message" } }` with a non-2xx status — always show that message in the UI.
Rate limits: a 429 (`rate_limited` or `hl_rate_limited`) carries `error.retryAfter` (seconds). The fetch helper waits that long and retries the request ONCE, then shows the message. Never retry in a loop, and never fire requests on a timer faster than every 30 s.

## Contacts
- `GET /contacts/?locationId=…&limit=20&query=<search text>&startAfterId=<id>&startAfter=<ts>`
    Search text shorter than 3 characters returns nothing: only send `query` when it has 3+ characters (otherwise list without it).
  → `{ contacts: [{ id, firstName, lastName, contactName, email, phone, tags, dateAdded }], meta: { total, startAfterId, startAfter, nextPageUrl } }`
    Newest first: add `sortBy=date_added&order=desc` (only `date_added` / `date_updated` are valid sort keys).
    Paginated (cursor) — see Pagination. `limit` max 100.
- `GET /contacts/{contactId}` → `{ contact: {...} }`
- `GET /contacts/{contactId}/appointments` → `{ events: [{ id, title, calendarId, startTime, endTime, appointmentStatus }] }`
    All appointments for one contact (past and future); filter by `startTime` yourself. Not paginated.

## Conversations
- `GET /conversations/search?locationId=…&limit=20&contactId=<id>&status=<all|read|unread|starred>&sortBy=last_message_date&sort=desc&startAfterDate=<sort value>`
  → `{ conversations: [{ id, contactId, fullName, contactName, lastMessageBody, lastMessageDate, lastMessageType, unreadCount, sort }], total }`
    Paginated (`startAfterDate`) — see Pagination.
- `GET /conversations/{conversationId}/messages?limit=20&lastMessageId=<id>`
  → `{ messages: { messages: [{ id, body, direction ("inbound"|"outbound"), dateAdded, messageType, status }], lastMessageId, nextPage } }`
    Newest messages first. Paginated (`lastMessageId`) — see Pagination.

## Calendars
- `GET /calendars/?locationId=…` → `{ calendars: [{ id, name, description, isActive }] }` (not paginated)
- `GET /calendars/events?locationId=…&calendarId=<id>&startTime=<ms epoch>&endTime=<ms epoch>`
  → `{ events: [{ id, title, calendarId, contactId, startTime, endTime, appointmentStatus, address, notes }] }`
  `startTime`/`endTime` are required, in milliseconds. `calendarId` is required: first list calendars, then fetch events per calendar and merge.
  `startTime` / `endTime` in results are ISO-like date strings.
  NOT paginated: every event in the window comes back at once. Keep windows bounded (a day, a week, a month) and let the user move the window (Previous / Next week, Today) instead of requesting years.
- `GET /calendars/{calendarId}/free-slots?startDate=<ms epoch>&endDate=<ms epoch>&timezone=<IANA tz>` — open booking slots (availability)
  → `{ "2026-11-06": { slots: ["2026-11-06T12:00:00+05:30", …] }, "2026-11-07": { … }, traceId }`
    Keys are dates (YYYY-MM-DD); ignore any key that is not a date (e.g. `traceId`). Each slot is an ISO start time.
    Range must be 31 days or less (longer → 400). Do NOT send `locationId` here. Pass the viewer's timezone
    (`Intl.DateTimeFormat().resolvedOptions().timeZone`). Only query active calendars (`isActive !== false`); an
    inactive calendar returns 400 "Calendar is inactive". A calendar with no availability configured returns no date keys:
    show "No open slots in this period" rather than an error. Not paginated.

## Writes (verified; POST/PUT with `Content-Type: application/json`)
The proxy adds the location to the body where HighLevel needs it. After a successful write, re-fetch what it changed (the proxy clears its cache).
- `POST /contacts/` `{ firstName, lastName, email, phone, tags?, source? }` → 201 `{ contact: { id, firstName, lastName, email, tags, … } }`
    If the location enforces unique email/phone, a duplicate → 400: show the message.
- `PUT /contacts/{contactId}` with only the fields to change → `{ succeeded, contact }`. Sending `tags` here REPLACES all tags; to add tags use:
- `POST /contacts/{contactId}/tags` `{ tags: ["vip"] }` → 201 `{ tags (all tags now), tagsAdded }` — adds, never removes.
- `POST /contacts/{contactId}/notes` `{ body }` → 201 `{ note: { id, body, dateAdded } }`
- `POST /calendars/events/appointments` `{ calendarId, contactId, startTime, title?, toNotify? }` → 201 `{ id, appointmentStatus, … }`
    `startTime` must be a slot returned by free-slots for an ACTIVE calendar (send it exactly as returned, with its offset).
- `PUT /calendars/events/appointments/{eventId}` `{ startTime }` reschedules, `{ appointmentStatus: "cancelled" }` cancels → 200.
    The response may omit `startTime`: re-fetch (`GET /contacts/{contactId}/appointments`) to show the new time.
- `PUT /conversations/{conversationId}` `{ unreadCount: 0 }` marks read, `{ starred: true|false }` stars → `{ success, conversation }`
- `POST /conversations/messages` → 201 `{ conversationId, messageId, msg }`
    Email: `{ type: "Email", contactId, subject, html }` (goes to the contact's email). SMS: `{ type: "SMS", contactId, message }`.
    Only `Email` and `SMS` are allowed. This reaches a real person.
Write errors: 403 `hl_scope_missing` → show the message (the user must reconnect HighLevel). Writes and sends have tighter rate limits; on 429 apply the retry rule above.

## Pagination (verified behaviour — follow exactly)
Each list endpoint returns one page. Page with these cursors; never guess offsets or page numbers.
`hlGet(path, params)` below stands for the app's own small fetch helper (adds the Authorization header, builds the query string, throws the proxy's error.message). Writes use a sibling helper, e.g. `hlSend(method, path, body)`.

Contacts — cursor from `meta`:
```js
const params = { locationId: LOCATION_ID, limit: 20 }            // add query / sortBy+order as needed
if (cursor) { params.startAfterId = cursor.startAfterId; params.startAfter = cursor.startAfter }
const { contacts = [], meta = {} } = await hlGet('/contacts/', params)
// append, skipping ids already shown
cursor = { startAfterId: meta.startAfterId, startAfter: meta.startAfter }
hasMore = contacts.length === params.limit && !!meta.startAfterId   // NOTE: meta.nextPageUrl stays set on the last page — do not rely on it
total = meta.total
```

Conversations — `startAfterDate` = the `sort` value of the LAST conversation received (an array: send its first element):
```js
const params = { locationId: LOCATION_ID, limit: 20, sortBy: 'last_message_date', sort: 'desc' }
if (lastSort != null) params.startAfterDate = lastSort
const { conversations = [], total } = await hlGet('/conversations/search', params)
const last = conversations[conversations.length - 1]
lastSort = last ? (Array.isArray(last.sort) ? last.sort[0] : last.lastMessageDate) : lastSort
hasMore = conversations.length === params.limit && shownCount < total
```

Messages — `lastMessageId` from the previous page, while `nextPage` is true (pages go back in time):
```js
const params = { limit: 20 }
if (lastMessageId) params.lastMessageId = lastMessageId
const { messages: page = {} } = await hlGet(`/conversations/${id}/messages`, params)
// page.messages is newest-first: prepend older pages ABOVE the thread when displaying oldest-at-top
lastMessageId = page.lastMessageId
hasMore = page.nextPage === true && (page.messages || []).length > 0
```
