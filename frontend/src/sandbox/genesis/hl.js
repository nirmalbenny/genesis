// Genesis HighLevel client. Injected into every preview as src/genesis/hl.js (never saved, never written by
// the model), so generated apps import it instead of writing their own fetch and pagination code.
// It is live for every app at once: only ever ADD to this API, never change or remove what exists.
// The exports are documented for the model in functions/src/llm/hlReference.md ("Client"); a test keeps them in sync.
import { getCurrentScope, onScopeDispose, ref, unref, watch } from 'vue'
import { HL_PROXY, LOCATION_ID, LOCATION_NAME, PREVIEW_TOKEN } from '../hl.config.js'

export { LOCATION_ID, LOCATION_NAME }

const MAX_RETRY_WAIT_S = 10 // a 429 asking for a longer wait is shown, not waited out
const MAX_SLOT_RANGE_MS = 31 * 24 * 3600 * 1000 // HighLevel refuses free-slot ranges over 31 days
const WEEK_MS = 7 * 24 * 3600 * 1000
const FILTER_DEBOUNCE_MS = 300

// Errors print as their message, so `{{ error }}` and `{{ error.message }}` both show the proxy's text in a template.
function hlError(code, message, status, retryAfter) {
  return Object.assign(new Error(message), { code, status, retryAfter, toString: () => message })
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const enc = encodeURIComponent

async function request(method, path, params, body) {
  const url = new URL(String(HL_PROXY).replace(/\/+$/, '') + path)
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  const init = { method, headers: { Authorization: `Bearer ${PREVIEW_TOKEN}` } }
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }
  for (let attempt = 0; ; attempt++) {
    let res
    try {
      res = await fetch(url, init)
    } catch {
      throw hlError('network_error', 'Could not reach HighLevel. Check your connection and try again.')
    }
    const data = await res.json().catch(() => null)
    if (res.ok) return data || {}
    const err = (data && data.error) || {}
    const wait = Number(err.retryAfter) || 2
    // A 429 is retried exactly once, after the wait the proxy asked for.
    if (res.status === 429 && attempt === 0 && wait <= MAX_RETRY_WAIT_S) {
      await sleep(wait * 1000)
      continue
    }
    throw hlError(err.code || `http_${res.status}`, err.message || `Request failed (${res.status})`, res.status, err.retryAfter)
  }
}

/** GET through the proxy. Resolves to the JSON body; throws an Error with { code, message, status, retryAfter }. */
export const hlGet = (path, params) => request('GET', path, params)

/** POST or PUT a JSON body through the proxy. Same errors as hlGet. */
export const hlSend = (method, path, body) => request(method, path, undefined, body || {})

// ---- Pagination ----

const pageSize = (limit) => Math.min(100, Math.max(1, Number(limit) || 20))

// One entry per paginated list: how to fetch a page and how to tell whether another exists (verified on the sandbox).
const PAGERS = {
  contacts: {
    async fetch(o, cursor) {
      const limit = pageSize(o.limit)
      const params = { locationId: LOCATION_ID, limit, sortBy: o.sortBy, order: o.order }
      const query = String(o.query || '').trim()
      if (query.length >= 3) params.query = query // shorter search text matches nothing: list everything instead
      if (cursor) Object.assign(params, cursor)
      const { contacts = [], meta = {} } = await hlGet('/contacts/', params)
      return {
        items: contacts,
        total: meta.total,
        cursor: { startAfterId: meta.startAfterId, startAfter: meta.startAfter },
        // meta.nextPageUrl stays set on the last page: a short page is the only reliable end.
        more: () => contacts.length === limit && !!meta.startAfterId,
      }
    },
  },
  conversations: {
    async fetch(o, cursor) {
      const limit = pageSize(o.limit)
      const params = {
        locationId: LOCATION_ID, limit, sortBy: 'last_message_date', sort: 'desc',
        status: o.status, contactId: o.contactId, startAfterDate: cursor,
      }
      // Matches the start of any word of the contact's name, any case (verified); one letter matches loosely, so 2+.
      const query = String(o.query || '').trim()
      if (query.length >= 2) params.query = query
      const { conversations = [], total } = await hlGet('/conversations/search', params)
      const last = conversations[conversations.length - 1]
      return {
        items: conversations,
        total,
        cursor: last ? (Array.isArray(last.sort) ? last.sort[0] : last.lastMessageDate) : cursor,
        more: (shown) => conversations.length === limit && (total == null || shown < total),
      }
    },
  },
  messages: {
    ready: (o) => !!o.conversationId,
    async fetch(o, cursor) {
      const { messages: page = {} } = await hlGet(`/conversations/${enc(o.conversationId)}/messages`, {
        limit: pageSize(o.limit), lastMessageId: cursor,
      })
      const items = page.messages || []
      return { items, cursor: page.lastMessageId, more: () => page.nextPage === true && items.length > 0 }
    },
  },
}

/**
 * A paginated list as Vue refs: { items, total, hasMore, loading, error, loadMore(), reset() }; error is null or an
 * Error with { code, message }.
 * `options` is a plain object, a ref/reactive object, or a getter; when a getter or reactive value changes,
 * the list resets and page 1 loads again. Responses to superseded requests are dropped; ids already shown are skipped.
 */
export function usePager(kind, options = {}) {
  const spec = PAGERS[kind]
  if (!spec) throw new Error(`usePager: unknown list "${kind}" (use ${Object.keys(PAGERS).join(', ')})`)
  const items = ref([])
  const total = ref(null)
  const hasMore = ref(false)
  const loading = ref(false)
  const error = ref(null)
  const current = () => ({ ...(typeof options === 'function' ? options() : unref(options)) })
  let run = 0
  let cursor = null
  let seen = new Set()

  async function load(first) {
    const mine = run
    const opts = current()
    if (spec.ready && !spec.ready(opts)) return
    loading.value = true
    error.value = null
    try {
      const page = await spec.fetch(opts, first ? null : cursor)
      if (mine !== run) return
      const fresh = page.items.filter((it) => it && (it.id == null || !seen.has(it.id)))
      fresh.forEach((it) => it.id != null && seen.add(it.id))
      items.value = [...items.value, ...fresh]
      cursor = page.cursor
      if (page.total != null) total.value = page.total
      hasMore.value = page.more(items.value.length)
    } catch (e) {
      if (mine === run) error.value = e && e.code ? e : hlError('client_error', (e && e.message) || String(e))
    } finally {
      if (mine === run) loading.value = false
    }
  }

  /** Clears the list and loads page 1 (also the way to retry after a first-page error). */
  function reset() {
    run++
    cursor = null
    seen = new Set()
    items.value = []
    total.value = null
    hasMore.value = false
    loading.value = false
    error.value = null
    return load(true)
  }

  /** Appends the next page; does nothing while loading or when there are no more pages. */
  function loadMore() {
    return loading.value || !hasMore.value ? Promise.resolve() : load(false)
  }

  let timer
  watch(current, () => {
    run++ // anything still in flight is for the old filters
    clearTimeout(timer)
    timer = setTimeout(reset, FILTER_DEBOUNCE_MS)
  })
  if (getCurrentScope()) onScopeDispose(() => { run++; clearTimeout(timer) })
  reset()
  return { items, total, hasMore, loading, error, loadMore, reset }
}

// ---- Shapes HighLevel returns inconsistently (verified on the sandbox) ----

/**
 * A display name for a contact (list item or single record), a conversation or an event: the contacts list
 * lowercases firstName/lastName/contactName and keeps the real case only in firstNameRaw/lastNameRaw.
 */
export function contactName(x) {
  if (!x) return ''
  const first = x.firstNameRaw || x.firstName
  const last = x.lastNameRaw || x.lastName
  const full = [first, last].filter(Boolean).join(' ')
  return x.fullName || full || x.contactName || x.companyName || x.email || x.phone || 'Unnamed contact'
}

/**
 * A Date from any HighLevel time: ms, ISO with offset (calendar events, free slots), or "YYYY-MM-DD HH:MM:SS"
 * without an offset (a contact's appointments: the sub-account's local time, read here as the viewer's local time).
 * Returns null when the value isn't a time.
 */
export function toDate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return isNaN(value) ? null : value
  const d = typeof value === 'number' ? new Date(value) : new Date(String(value).trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2'))
  return isNaN(d) ? null : d
}

/** One contact record, or throws (404 → error). */
export const getContact = async (contactId) => (await hlGet(`/contacts/${enc(contactId)}`)).contact

/**
 * A contact's appointments (past and future) sorted by start, each with `start` and `end` as Dates (see toDate).
 * { upcoming: true } keeps only those that haven't started. Not paginated.
 */
export async function contactAppointments(contactId, { upcoming = false } = {}) {
  const { events = [] } = await hlGet(`/contacts/${enc(contactId)}/appointments`)
  const now = Date.now()
  return events
    .map((e) => ({ ...e, start: toDate(e.startTime), end: toDate(e.endTime) }))
    .filter((e) => e.start && (!upcoming || e.start.getTime() >= now))
    .sort((a, b) => a.start - b.start)
}

// ---- Calendars ----

const toMs = (v, fallback) => (v == null ? fallback : v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(v))

/** The location's calendars, [{ id, name, description, isActive }]; { activeOnly: true } drops inactive ones. */
export async function listCalendars({ activeOnly = false } = {}) {
  const { calendars = [] } = await hlGet('/calendars/', { locationId: LOCATION_ID })
  return activeOnly ? calendars.filter((c) => c.isActive !== false) : calendars
}

/**
 * Events between `from` and `to` (Date, ms or ISO string; default the next 7 days) across every calendar, or one
 * `calendarId`, sorted by start time. Each event also gets `calendarName` and `start`/`end` Dates. Not paginated:
 * keep the window bounded.
 */
export async function listEvents({ from, to, calendarId } = {}) {
  const startTime = toMs(from, Date.now())
  const endTime = toMs(to, startTime + WEEK_MS)
  if (!(endTime > startTime)) throw hlError('invalid_range', '"to" must be after "from".')
  const calendars = calendarId ? [{ id: calendarId, isActive: true }] : await listCalendars()
  const results = await Promise.allSettled(calendars.map((c) =>
    hlGet('/calendars/events', { locationId: LOCATION_ID, calendarId: c.id, startTime, endTime })))
  const events = []
  results.forEach((r, i) => {
    const cal = calendars[i]
    // An inactive calendar may refuse queries; any other failure is a real error and is shown.
    if (r.status === 'rejected') {
      if (cal.isActive === false) return
      throw r.reason
    }
    for (const e of r.value.events || []) {
      events.push({ ...e, calendarName: cal.name, start: toDate(e.startTime), end: toDate(e.endTime) })
    }
  })
  return events.sort((a, b) => (a.start || 0) - (b.start || 0))
}

/**
 * Open booking slots for an ACTIVE calendar: [{ date: 'YYYY-MM-DD', slots: [ISO start, …] }], sorted by date.
 * The range defaults to the next 7 days and is capped at 31; `timezone` defaults to the viewer's.
 */
export async function freeSlots(calendarId, { from, to, timezone } = {}) {
  const startDate = toMs(from, Date.now())
  const endDate = Math.min(toMs(to, startDate + WEEK_MS), startDate + MAX_SLOT_RANGE_MS)
  if (!(endDate > startDate)) throw hlError('invalid_range', '"to" must be after "from".')
  const data = await hlGet(`/calendars/${enc(calendarId)}/free-slots`, {
    startDate, endDate, timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  return Object.keys(data)
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort()
    .map((date) => ({ date, slots: (data[date] && data[date].slots) || [] }))
}

// ---- Writes: call only from an explicit user action (a click or a form submit) ----

/** Creates a contact: { firstName, lastName, email, phone, tags?, source? } → the contact. */
export const createContact = async (data) => (await hlSend('POST', '/contacts/', data)).contact

/** Updates only the given fields → the contact. Sending `tags` REPLACES all tags; use addTags to add. */
export const updateContact = async (contactId, fields) => (await hlSend('PUT', `/contacts/${enc(contactId)}`, fields)).contact

/** Adds tags (never removes) → { tags, tagsAdded }. */
export const addTags = (contactId, tags) => hlSend('POST', `/contacts/${enc(contactId)}/tags`, { tags })

/** Adds a note → the note { id, body, dateAdded }. */
export const addNote = async (contactId, body) => (await hlSend('POST', `/contacts/${enc(contactId)}/notes`, { body })).note

/** Books an appointment; `startTime` must be a slot from freeSlots, sent exactly as returned. */
export const bookAppointment = ({ calendarId, contactId, startTime, title, toNotify }) =>
  hlSend('POST', '/calendars/events/appointments', { calendarId, contactId, startTime, title, toNotify })

/** Moves an appointment to a new start time (a slot from freeSlots). */
export const reschedule = (eventId, startTime) => hlSend('PUT', `/calendars/events/appointments/${enc(eventId)}`, { startTime })

/** Cancels an appointment (it is kept, with status "cancelled"). */
export const cancelAppointment = (eventId) =>
  hlSend('PUT', `/calendars/events/appointments/${enc(eventId)}`, { appointmentStatus: 'cancelled' })

/** Marks a conversation read. */
export const markRead = (conversationId) => hlSend('PUT', `/conversations/${enc(conversationId)}`, { unreadCount: 0 })

/** Stars or unstars a conversation. */
export const star = (conversationId, on = true) => hlSend('PUT', `/conversations/${enc(conversationId)}`, { starred: !!on })

/** Emails a contact (to the contact's email address). This reaches a real person. */
export const sendEmail = ({ contactId, subject, html }) => hlSend('POST', '/conversations/messages', { type: 'Email', contactId, subject, html })

/** Texts a contact. This reaches a real person. Not yet verified on the sandbox: show any returned error clearly. */
export const sendSms = ({ contactId, message }) => hlSend('POST', '/conversations/messages', { type: 'SMS', contactId, message })
