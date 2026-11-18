import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { routeFor } from "../hlProxy";
import { compileRoutes, endpointNames, HL_SCOPES, listNames, pathPattern, RESOURCES, ROUTES, validateRegistry, type Resource } from "./registry";

// The proxy's allowlist as it was written by hand before the registry (2026-11-18), frozen: the registry must keep
// reproducing every one of these exactly (method, pattern, scope for writes, location, version, send).
const BEFORE = [
  ["GET", "^\\/contacts\\/?$"], ["GET", "^\\/contacts\\/[\\w-]+$"], ["GET", "^\\/contacts\\/[\\w-]+\\/appointments$"],
  ["GET", "^\\/conversations\\/search$"], ["GET", "^\\/conversations\\/[\\w-]+$"], ["GET", "^\\/conversations\\/[\\w-]+\\/messages$"],
  ["GET", "^\\/calendars\\/?$"], ["GET", "^\\/calendars\\/events$"], ["GET", "^\\/calendars\\/[\\w-]+\\/free-slots$", "no location"],
  ["POST", "^\\/contacts\\/?$", "contacts.write", "body"],
  ["PUT", "^\\/contacts\\/[\\w-]+$", "contacts.write"],
  ["POST", "^\\/contacts\\/[\\w-]+\\/tags$", "contacts.write"],
  ["POST", "^\\/contacts\\/[\\w-]+\\/notes$", "contacts.write"],
  ["POST", "^\\/calendars\\/events\\/appointments$", "calendars/events.write", "body"],
  ["PUT", "^\\/calendars\\/events\\/appointments\\/[\\w-]+$", "calendars/events.write"],
  ["PUT", "^\\/conversations\\/[\\w-]+$", "conversations.write", "body"],
  ["POST", "^\\/conversations\\/messages$", "conversations/message.write", "send"],
] as const;

test("the registry reproduces the hand-written allowlist exactly", () => {
  for (const [method, source, ...flags] of BEFORE) {
    const route = ROUTES.find((r) => r.method === method && r.path.source === source);
    assert.ok(route, `${method} ${source} is missing`);
    const write = method !== "GET";
    assert.equal(route.write, write);
    if (write) assert.equal(route.scope, flags[0], `${method} ${source}: scope`);
    assert.equal(route.send, flags.includes("send" as never), `${method} ${source}: send`);
    const location = flags.includes("no location" as never) ? null
      : write ? (flags.includes("body" as never) ? { in: "body", name: "locationId" } : null)
      : { in: "query", name: "locationId" };
    assert.deepEqual(route.location, location, `${method} ${source}: location`);
    assert.equal(route.version, source.includes("calendars") ? "2021-04-15" : "2021-07-28", `${method} ${source}: version`);
  }
});

test("connecting asks for exactly the scopes it did before", () => {
  assert.deepEqual(HL_SCOPES.split(" ").sort(), [
    "calendars.readonly", "calendars/events.readonly", "calendars/events.write", "contacts.readonly", "contacts.write",
    "conversations.readonly", "conversations.write", "conversations/message.readonly", "conversations/message.write",
    "locations.readonly",
  ]);
});

test("every endpoint is reachable through the proxy with its own route; neighbours and deletes are refused", () => {
  for (const r of ROUTES) {
    const path = r.template.replace(/\{\w+\}/g, "ab-12_c");
    assert.equal(routeFor(r.method, path).name, r.name, `${r.method} ${path}`);
    // One extra segment can be a legitimate id (/contacts/{id}); two never are.
    const deeper = `${path.replace(/\/$/, "")}/zz-extra/zz-more`;
    assert.throws(() => routeFor(r.method, deeper), { code: "path_not_allowed" }, deeper);
    assert.throws(() => routeFor("DELETE", path), { code: "method_not_allowed" });
    assert.throws(() => routeFor("PATCH", path), { code: "method_not_allowed" });
    if (r.template.includes("{")) {
      for (const bad of ["a.b", "a%2Fb", "..", "a b"]) {
        assert.throws(() => routeFor(r.method, r.template.replace(/\{\w+\}/, bad)), { code: "path_not_allowed" }, `${r.template} with "${bad}"`);
      }
    }
  }
});

test("a literal path wins over a placeholder", () => {
  assert.equal(routeFor("GET", "/conversations/search").name, "conversations");
  assert.equal(routeFor("GET", "/conversations/abc123").name, "getConversation");
  assert.equal(routeFor("POST", "/conversations/messages").name, "sendMessage");
});

test("path templates compile to strict patterns", () => {
  assert.equal(pathPattern("/contacts/").source, "^\\/contacts\\/?$");
  assert.equal(pathPattern("/contacts/{contactId}/notes").source, "^\\/contacts\\/[\\w-]+\\/notes$");
  assert.ok(pathPattern("/calendars/{id}/free-slots").test("/calendars/c1/free-slots"));
  assert.ok(!pathPattern("/calendars/{id}/free-slots").test("/calendars/c1/free-slotsX"));
});

const resource = (over: Partial<Resource> = {}, endpoint: Record<string, unknown> = {}): Resource => ({
  id: "deals", label: "Deals", summary: "deals", scopes: ["deals.readonly", "deals.write"], version: "2021-07-28",
  endpoints: [{ name: "listDeals", method: "GET", path: "/deals/", scope: "deals.readonly", location: "query", ...endpoint } as Resource["endpoints"][number]],
  ...over,
});

test("the registry is checked strictly: deletes, loose paths, unknown scopes and clashes are refused", () => {
  assert.deepEqual(validateRegistry(RESOURCES), [], "the real registry is valid");
  assert.deepEqual(validateRegistry([resource()]), []);
  const cases: [Resource[], RegExp][] = [
    [[resource({}, { method: "DELETE" })], /never DELETE/],
    [[resource({}, { method: "PATCH" })], /GET, POST or PUT/],
    [[resource({}, { path: "/deals/.*" })], /path must be/],
    [[resource({}, { path: "deals" })], /path must be/],
    [[resource({}, { path: "/deals/{id/x" })], /path must be/],
    [[resource({}, { scope: "deals.all" })], /not in the resource's scopes/],
    [[resource({}, { method: "POST", location: "query", scope: "deals.write" })], /write takes the location in the body/],
    [[resource({}, { location: "body" })], /read takes the location as a query/],
    [[resource({}, { location: { in: "query", name: "bad name" } })], /location name must be an identifier/],
    [[resource({}, { send: true })], /only a POST can send/],
    [[resource({}, { name: "1x" })], /name must be an identifier/],
    [[resource({ label: undefined })], /label is required/],
    [[resource({ version: "" })], /version is required/],
    [[resource({ id: "Deals" })], /id must be lowercase/],
    [[resource(), resource({ id: "deals" })], /duplicate id/],
    [[resource(), resource({ id: "more" }, { name: "listDeals", path: "/more/" })], /name is already used/],
    [[resource({ endpoints: [...resource().endpoints, { ...resource().endpoints[0]!, name: "again", path: "/deals" }] })], /same method and path/],
    [[resource({}, { pager: { strategy: "magic", items: "deals" } })], /strategy must be/],
    [[resource({}, { pager: { strategy: "page", items: "deals[0]" } })], /items must be a dot path/],
    [[resource({}, { pager: { strategy: "cursorFields", items: "deals" } })], /cursorFields needs cursor/],
    [[resource({}, { pager: { strategy: "lastItem", items: "deals", param: "after" } })], /lastItem needs param and from/],
    [[resource({}, { pager: { strategy: "token", items: "deals", param: "after" } })], /token needs param, token and hasNext/],
    [[resource({}, { pager: { strategy: "page", items: "deals", search: { param: "q", min: -1 } } })], /search needs/],
    [[resource({}, { method: "POST", scope: "deals.write", location: "body", pager: { strategy: "page", items: "deals" } })], /pager is only for GET/],
    [[resource({}, { unwrap: "deal.name" })], /unwrap must be a field name/],
  ];
  for (const [resources, error] of cases) {
    assert.match(validateRegistry(resources).join("\n"), error);
  }
});

test("lists and calls the client offers come from the registry", () => {
  assert.deepEqual(listNames(RESOURCES), ["contacts", "conversations", "messages"]);
  assert.ok(endpointNames(RESOURCES).includes("getContact"));
  assert.deepEqual(validateRegistry([resource({}, { pager: { strategy: "page", items: "deals", total: "meta.total", search: { param: "q", min: 2 } } })]), []);
});

test("a resource's own version and location name are used; an endpoint can override the version", () => {
  const [route] = compileRoutes([resource({ version: "v3" }, { location: { in: "query", name: "location_id" } })]);
  assert.equal(route!.version, "v3");
  assert.deepEqual(route!.location, { in: "query", name: "location_id" });
  assert.equal(compileRoutes([resource({}, { version: "2021-04-15" })])[0]!.version, "2021-04-15");
});

test("ARCHITECTURE §10 lists every route", () => {
  const doc = readFileSync(join(__dirname, "..", "..", "..", "docs", "ARCHITECTURE.md"), "utf8");
  const section = doc.split("\n## 10. ")[1]!.split("\n## 11. ")[0]!.replace(/\{\w+\}/g, "{id}");
  for (const r of ROUTES) {
    const path = r.template.replace(/\{\w+\}/g, "{id}");
    assert.ok(section.includes(r.write ? `${r.method} ${path}` : `\`${path}\``), `${r.method} ${r.template} is missing from ARCHITECTURE §10`);
  }
});
