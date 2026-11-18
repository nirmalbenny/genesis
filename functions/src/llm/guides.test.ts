import { test } from "node:test";
import assert from "node:assert/strict";
import { RESOURCES } from "../hl/registry";
import { catalog, CLIENT_FUNCTIONS, coreReference, GUIDES, guidesBlock, selectGuides } from "./guides";
import { buildSystemPrompt, systemBlocks } from "./prompt";

const ALL = ["calendars", "contacts", "conversations"];
// Compared as sets; the order (always the registry's) is checked in the cache test.
const pick = (prompt: string, helpers: string[] = [], sources: string[] = []) => selectGuides({ prompt, helpers, sources }).sort();

test("every resource apps can use has a guide, and the catalog lists each with its calls", () => {
  assert.deepEqual(GUIDES.map((g) => g.id).sort(), RESOURCES.filter((r) => !r.internal).map((r) => r.id).sort());
  const lines = catalog().split("\n");
  assert.equal(lines.length, GUIDES.length);
  assert.match(catalog(), /- Contacts: .*usePager\('contacts'\).*getContact.*createContact/);
  assert.match(catalog(), /- Conversations: .*usePager\('conversations'\), usePager\('messages'\).*sendEmail/);
  assert.match(catalog(), /- Calendars: .*listEvents.*freeSlots.*bookAppointment/);
  assert.match(coreReference(), /## HighLevel data[\s\S]*- Calendars:/);
});

test("the reference documents every client function once, between the core and the guides", () => {
  for (const f of ["usePager", "contactName", "toDate", "hlGet", "hlSend", "getContact", "contactAppointments", "createContact",
    "updateContact", "addTags", "addNote", "markRead", "star", "sendEmail", "sendSms", "listCalendars", "listEvents", "freeSlots",
    "bookAppointment", "reschedule", "cancelAppointment"]) {
    assert.ok(CLIENT_FUNCTIONS.has(f), f);
  }
});

test("a request about one resource gets its guide plus contacts", () => {
  assert.deepEqual(pick("Build an inbox of unread conversations"), ["contacts", "conversations"]);
  assert.deepEqual(pick("Show this week's appointments for each calendar"), ["calendars", "contacts"]);
  assert.deepEqual(pick("A list of my leads with a search box"), ["contacts"]);
  assert.deepEqual(pick("Text a contact when their booking is tomorrow"), ALL, "text → conversations, booking → calendars");
});

test("a follow-up keeps the guides the app already uses, even when the request names nothing", () => {
  assert.deepEqual(pick("Make the header blue", ["usePager", "listEvents"]), ["calendars", "contacts"]);
  assert.deepEqual(pick("Add a refresh button", ["usePager"], ['const t = usePager("messages", () => ({ conversationId: id.value }))']), ["contacts", "conversations"]);
  assert.deepEqual(pick("Tidy up the layout", ["contactName", "toDate"]), ALL, "only shared helpers: nothing to go on, so every guide");
  assert.deepEqual(pick("Tidy up the layout", ["call"], ["const c = await call('getConversation', { conversationId })"]), ["contacts", "conversations"], "call() names map to their resource");
});

test("a vague request for a new app gets every guide, as before the split", () => {
  assert.deepEqual(pick("Build me a dashboard"), ALL);
  assert.deepEqual(pick(""), ALL);
});

test("words match whole words only, in any case", () => {
  assert.deepEqual(pick("Show EVENTS"), ["calendars", "contacts"]);
  assert.deepEqual(pick("Build an eventful dashboard"), ALL, "'eventful' is not 'event'");
});

test("the system prompt is two cached blocks: the shared core first, then the guides for this build", () => {
  const a = systemBlocks(["contacts"]);
  const b = systemBlocks(["calendars", "contacts"]);
  assert.equal(a.length, 2);
  for (const block of [...a, ...b]) assert.deepEqual(block.cache_control, { type: "ephemeral" });
  assert.equal(a[0]!.text, b[0]!.text, "the first block is the same whatever the guides");
  assert.equal(a[0]!.text, buildSystemPrompt());
  assert.equal(systemBlocks(["calendars", "contacts"])[1]!.text, b[1]!.text, "the same set gives the same bytes (one cache entry)");
  assert.equal(guidesBlock(["contacts", "calendars"]), guidesBlock(["calendars", "contacts"]), "order is fixed, whatever the request");
  assert.match(b[1]!.text, /## Calendars[\s\S]*## Contacts/, "registry order");
  assert.deepEqual(selectGuides({ prompt: "contacts and their appointments", helpers: [], sources: [] }), ["calendars", "contacts"]);
  assert.doesNotMatch(a[1]!.text, /## Calendars|## Conversations/, "guides not chosen stay out");
  assert.doesNotMatch(a[0]!.text, /GET \/calendars\/events/, "resource details live in the guides, not the shared block");
});
