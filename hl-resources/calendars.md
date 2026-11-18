## Calendars
- `listCalendars({ activeOnly })` → `[{ id, name, description, isActive, slotDuration (minutes), calendarType }]`.
- `listEvents({ from, to, calendarId })` → events across all calendars (or one), sorted by start, each with `calendarName` and `start`/`end` Dates. `from`/`to`: Date, ms or ISO string; default the next 7 days. Not paginated: keep the window bounded and let the user move it.
- `freeSlots(calendarId, { from, to, timezone })` → `[{ date: 'YYYY-MM-DD', slots: [ISO start time, …] }]`. Range defaults to 7 days, capped at 31; timezone defaults to the viewer's. Only for ACTIVE calendars (`isActive !== false`), otherwise 400 "Calendar is inactive". An empty array means no open slots: say "No open slots in this period", not an error.
- `bookAppointment({ calendarId, contactId, startTime, title?, toNotify? })` → `{ id, appointmentStatus, … }`. `startTime` must be a slot from `freeSlots`, sent exactly as returned.
- `reschedule(eventId, startTime)` and `cancelAppointment(eventId)`. The response may omit `startTime`: re-fetch (`hlGet('/contacts/' + contactId + '/appointments')`) to show the new time.

Endpoints (verified response shapes):
- `GET /calendars/` (listCalendars). Several calendars can be inactive.
- `GET /calendars/events` (listEvents) → events `{ id, title, calendarId, contactId, startTime, endTime, appointmentStatus, address }`; times are ISO with offset ("2026-11-06T14:30:00+05:30"). `appointmentStatus`: `new`, `confirmed`, `showed`, `noshow`, `cancelled`, `invalid`.
- `GET /calendars/{calendarId}/free-slots` (freeSlots)
