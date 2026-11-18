## Contacts
- `usePager('contacts', { query, sortBy: 'date_added'|'date_updated', order: 'asc'|'desc', limit })` (query under 3 characters lists everything).
- `getContact(contactId)` → the contact record (fields below).
- `contactAppointments(contactId, { upcoming })` → that contact's appointments sorted by start, each with `start`/`end` Dates; `upcoming: true` keeps those not started yet. Filter by `appointmentStatus` yourself (e.g. hide `cancelled`).
- `createContact({ firstName, lastName, email, phone, tags?, source? })` → the contact `{ id, … }`. If the location enforces unique email/phone, a duplicate → 400: show the message.
- `updateContact(contactId, fields)` → the contact. Send only the fields to change. `tags` here REPLACES all tags; to add tags use `addTags`.
- `addTags(contactId, tags)` → `{ tags (all tags now), tagsAdded }`. Adds, never removes.
- `addNote(contactId, body)` → `{ id, body, dateAdded }`.

Endpoints (verified response shapes):
- `GET /contacts/` (usePager 'contacts') → items `{ id, firstName, lastName, firstNameRaw, lastNameRaw, contactName, companyName, email, phone, tags, source, type ('lead'|'customer'), city, country, dnd, dateAdded, dateUpdated }`, `meta: { total }`.
    `firstName`, `lastName`, `contactName` and `tags` come back LOWERCASED here (real case only in `firstNameRaw`/`lastNameRaw`); tags are lowercase everywhere.
- `GET /contacts/{contactId}` (getContact) → `{ contact: { id, firstName, lastName, email, phone, companyName, tags, source, type, country, dateAdded, dateUpdated, additionalEmails, additionalPhones } }`. Names in real case; there is NO `contactName` here.
- `GET /contacts/{contactId}/appointments` (contactAppointments) → `{ events: [{ id, title, calendarId, startTime, endTime, appointmentStatus, address }] }`. `startTime`/`endTime` are "YYYY-MM-DD HH:MM:SS" in the sub-account's local time, with no offset.
    `appointmentStatus` (here and in calendar events): `new`, `confirmed`, `showed`, `noshow`, `cancelled`, `invalid`.

Not available: filtering contacts by tag, custom field or date (no server-side filter: see the rule on loaded items); custom field definitions.
