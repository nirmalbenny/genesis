# HighLevel API reference (read-only, via proxy)

Base: `HL_PROXY` from `./hl.config.js`. Every request is a GET with header `Authorization: Bearer ${PREVIEW_TOKEN}`.
`locationId` is added automatically by the proxy, but pass `locationId=${LOCATION_ID}` anyway where listed.
Responses are JSON. On failure the proxy returns `{ "error": { "code", "message" } }` with a non-2xx status — always show that message in the UI.

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

## Pagination (verified behaviour — follow exactly)
Each list endpoint returns one page. Page with these cursors; never guess offsets or page numbers.
`hlGet(path, params)` below stands for the app's own small fetch helper (adds the Authorization header, builds the query string, throws the proxy's error.message).

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
