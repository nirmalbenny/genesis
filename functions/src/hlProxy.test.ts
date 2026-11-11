import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFor, writeBody } from "./hlProxy";

const refused = (fn: () => unknown, status: number, code: string) =>
  assert.throws(fn, (e: { status?: number; code?: string }) => e.status === status && e.code === code);

test("reads and the listed writes are allowed, with the scope each write needs", () => {
  assert.equal(routeFor("GET", "/contacts/").scope, undefined);
  assert.equal(routeFor("POST", "/contacts/").scope, "contacts.write");
  assert.equal(routeFor("PUT", "/contacts/abc123").scope, "contacts.write");
  assert.equal(routeFor("POST", "/contacts/abc123/tags").scope, "contacts.write");
  assert.equal(routeFor("POST", "/contacts/abc123/notes").scope, "contacts.write");
  assert.equal(routeFor("POST", "/calendars/events/appointments").scope, "calendars/events.write");
  assert.equal(routeFor("PUT", "/calendars/events/appointments/ev1").scope, "calendars/events.write");
  assert.equal(routeFor("PUT", "/conversations/conv1").scope, "conversations.write");
  assert.equal(routeFor("POST", "/conversations/messages").send, true);
});

test("the location is forced into the body where HighLevel takes it there", () => {
  assert.equal(routeFor("POST", "/contacts/").bodyLocation, true);
  assert.equal(routeFor("POST", "/calendars/events/appointments").bodyLocation, true);
  assert.equal(routeFor("PUT", "/conversations/conv1").bodyLocation, true);
  assert.equal(routeFor("PUT", "/contacts/abc123").bodyLocation, undefined, "HighLevel doesn't accept it on contact updates");
});

test("deletes are never allowed, and unlisted writes are refused", () => {
  refused(() => routeFor("DELETE", "/contacts/abc123"), 405, "method_not_allowed");
  refused(() => routeFor("PATCH", "/contacts/abc123"), 405, "method_not_allowed");
  refused(() => routeFor("POST", "/contacts/abc123"), 403, "path_not_allowed");
  refused(() => routeFor("PUT", "/contacts/abc123/notes/n1"), 403, "path_not_allowed");
  refused(() => routeFor("POST", "/locations/loc1"), 403, "path_not_allowed");
  refused(() => routeFor("GET", "/users/"), 403, "path_not_allowed");
});

test("write bodies must be JSON objects under 50 KB", () => {
  const contact = routeFor("POST", "/contacts/");
  assert.deepEqual(writeBody(contact, { firstName: "Ada" }), { firstName: "Ada" });
  refused(() => writeBody(contact, undefined), 400, "invalid_body");
  refused(() => writeBody(contact, [1, 2]), 400, "invalid_body");
  refused(() => writeBody(contact, "text"), 400, "invalid_body");
  refused(() => writeBody(contact, { note: "x".repeat(50_001) }), 413, "body_too_large");
});

test("messages can only be sent as SMS or email", () => {
  const send = routeFor("POST", "/conversations/messages");
  assert.ok(writeBody(send, { type: "Email", contactId: "c1", subject: "Hi", html: "<p>Hi</p>" }));
  assert.ok(writeBody(send, { type: "SMS", contactId: "c1", message: "Hi" }));
  for (const type of ["InternalComment", "WhatsApp", "Custom", undefined]) {
    refused(() => writeBody(send, { type, contactId: "c1" }), 400, "invalid_message_type");
  }
});
