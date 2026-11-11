import type { Response } from "express";
import { onRequest } from "firebase-functions/v2/https";
import { HL_API_BASE, HL_CLIENT_ID, HL_CLIENT_SECRET, PREVIEW_TOKEN_SECRET } from "./config";
import { httpError, rateLimited, sendError, type HttpError } from "./http";
import { getValidHlToken } from "./hl/token";
import { verifyPreviewToken } from "./previewToken";
import { getOwnedProject } from "./projects";
import { createLimiter, LIMITS } from "./rateLimits";

/**
 * Everything generated apps may call. Anything else is refused, and so is every DELETE.
 * - `scope`: the HighLevel scope a write needs; a connection made before writes existed is told to reconnect.
 * - `bodyLocation`: HighLevel takes the location in the body here; the proxy forces the connected one.
 * - `send`: sends a message to a real person, so it has its own, tighter limits.
 */
type Route = { method: "GET" | "POST" | "PUT"; path: RegExp; scope?: string; bodyLocation?: boolean; send?: boolean };
const ROUTES: Route[] = [
  // Reads
  { method: "GET", path: /^\/contacts\/?$/ },
  { method: "GET", path: /^\/contacts\/[\w-]+$/ },
  { method: "GET", path: /^\/contacts\/[\w-]+\/appointments$/ },
  { method: "GET", path: /^\/conversations\/search$/ },
  { method: "GET", path: /^\/conversations\/[\w-]+$/ },
  { method: "GET", path: /^\/conversations\/[\w-]+\/messages$/ },
  { method: "GET", path: /^\/calendars\/?$/ },
  { method: "GET", path: /^\/calendars\/events$/ },
  { method: "GET", path: /^\/calendars\/[\w-]+\/free-slots$/ },
  // Writes (no deletes)
  { method: "POST", path: /^\/contacts\/?$/, scope: "contacts.write", bodyLocation: true },
  { method: "PUT", path: /^\/contacts\/[\w-]+$/, scope: "contacts.write" },
  { method: "POST", path: /^\/contacts\/[\w-]+\/tags$/, scope: "contacts.write" },
  { method: "POST", path: /^\/contacts\/[\w-]+\/notes$/, scope: "contacts.write" },
  { method: "POST", path: /^\/calendars\/events\/appointments$/, scope: "calendars/events.write", bodyLocation: true },
  { method: "PUT", path: /^\/calendars\/events\/appointments\/[\w-]+$/, scope: "calendars/events.write" },
  { method: "PUT", path: /^\/conversations\/[\w-]+$/, scope: "conversations.write", bodyLocation: true },
  { method: "POST", path: /^\/conversations\/messages$/, scope: "conversations/message.write", send: true },
];

/** The route for a request, or a clear refusal: 405 for methods never allowed, 403 for anything unlisted. */
export function routeFor(method: string, path: string): Route {
  if (!["GET", "POST", "PUT"].includes(method)) {
    throw httpError(405, "method_not_allowed", "Apps can read, create and update HighLevel data, but not delete it.");
  }
  const route = ROUTES.find((r) => r.method === method && r.path.test(path));
  if (!route) throw httpError(403, "path_not_allowed", `Not allowed: ${method} ${path}`);
  return route;
}

const MAX_BODY_BYTES = 50_000;
const SEND_TYPES = ["SMS", "Email"];

/** A write's JSON body, checked before anything else happens. */
export function writeBody(route: Route, body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw httpError(400, "invalid_body", "Send a JSON object as the request body.");
  }
  if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) {
    throw httpError(413, "body_too_large", "The request body is too large.");
  }
  const b = body as Record<string, unknown>;
  if (route.send && !SEND_TYPES.includes(String(b.type))) {
    throw httpError(400, "invalid_message_type", `Messages can be sent as ${SEND_TYPES.join(" or ")} only.`);
  }
  return b;
}

// Reads that reject a locationId parameter (HL returns 422). They are still scoped to the connected
// sub-account: the access token can only read that location's calendars.
const NO_LOCATION_PARAM = [/^\/calendars\/[\w-]+\/free-slots$/];

const apiError = (code: string, message: string) => ({ error: { code, message } });

// A preview token is bound to one app: it only works while that app exists, is not deleted, and belongs to
// the token's user. Successful checks are remembered briefly per instance so paging apps don't read Firestore
// on every call; a deleted app's previews stop working within PROJECT_CHECK_TTL_MS.
const PROJECT_CHECK_TTL_MS = 60_000;
const verifiedProjects = new Map<string, number>(); // "uid/projectId" -> verified until (ms)

async function assertPreviewProject(uid: string, projectId: string): Promise<void> {
  const key = `${uid}/${projectId}`;
  if ((verifiedProjects.get(key) ?? 0) > Date.now()) return;
  try {
    await getOwnedProject(uid, projectId);
  } catch {
    verifiedProjects.delete(key);
    throw httpError(403, "project_not_allowed", "This preview token isn't valid for this app. Reload the preview.");
  }
  verifiedProjects.set(key, Date.now() + PROJECT_CHECK_TTL_MS);
}

// ---- Rate limiting (see rateLimits.ts). All per instance. ----
// Per user: stops a generated app that loops on requests before it costs HighLevel quota.
const perUser = createLimiter(LIMITS.proxyPerUser);
// Writes, and message sends in particular, get their own tighter budgets on top.
const writesPerUser = createLimiter(LIMITS.proxyWritesPerUser);
const sendsPerUser = createLimiter(LIMITS.proxySendsPerUser);
const sendsPerLocation = createLimiter(LIMITS.proxySendsPerLocation);

// Successful GETs are reused for a few seconds per sub-account + URL: reloads and several open previews
// then cost one HighLevel call instead of many.
const CACHE_TTL_MS = 10_000;
const CACHE_MAX = 500;
const cache = new Map<string, { body: string; until: number }>();

function cached(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.until > Date.now()) return hit.body;
  cache.delete(key);
  return null;
}

function remember(key: string, body: string) {
  cache.set(key, { body, until: Date.now() + CACHE_TTL_MS });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!); // drop the oldest
}

/** After a write, the sub-account's cached reads may be stale: drop them so the app sees its change. */
function forgetLocation(locationId: string) {
  for (const key of cache.keys()) if (key.startsWith(`${locationId} `)) cache.delete(key);
}

// When HighLevel answers 429 for a sub-account, stop calling it for that sub-account until its Retry-After
// passes; requests in the meantime get the 429 straight away instead of piling on.
const pausedUntil = new Map<string, number>();

/** Seconds from HighLevel's Retry-After header (seconds or an HTTP date), 10 when absent. */
function retryAfterSeconds(header: string | null): number {
  if (!header) return 10;
  const n = Number(header);
  if (Number.isFinite(n)) return Math.max(1, n);
  const at = Date.parse(header);
  return Number.isNaN(at) ? 10 : Math.max(1, (at - Date.now()) / 1000);
}

function hlRateLimited(retryAfter: number): HttpError {
  return Object.assign(httpError(429, "hl_rate_limited", "HighLevel rate limit reached. Try again shortly."), {
    retryAfter: Math.max(1, Math.ceil(retryAfter)),
  });
}

export const hlProxy = onRequest(
  { cors: true, secrets: [PREVIEW_TOKEN_SECRET, HL_CLIENT_ID, HL_CLIENT_SECRET] },
  async (req, res) => {
    try {
      const header = req.get("authorization") ?? "";
      const claims = verifyPreviewToken(header.startsWith("Bearer ") ? header.slice(7) : "");

      const path = req.path;
      const route = routeFor(req.method, path);
      const isWrite = route.method !== "GET";
      const body = isWrite ? writeBody(route, req.body) : null;
      await assertPreviewProject(claims.uid, claims.projectId);

      const limits: [ReturnType<typeof createLimiter>, string, string][] = [[perUser, claims.uid, "proxyPerUser"]];
      if (isWrite) limits.push([writesPerUser, claims.uid, "proxyWritesPerUser"]);
      if (route.send) limits.push([sendsPerUser, claims.uid, "proxySendsPerUser"], [sendsPerLocation, claims.locationId, "proxySendsPerLocation"]);
      for (const [limiter, key, name] of limits) {
        const wait = limiter.take(key);
        if (wait) {
          throw rateLimited(wait, route.send
            ? "Too many messages sent from this app. Wait a moment and try again."
            : "This app is making requests too quickly. Wait a moment and try again.", { limit: name, uid: claims.uid, path });
        }
      }

      const { accessToken, locationId, scopes } = await getValidHlToken(claims.uid);
      if (locationId !== claims.locationId) {
        throw httpError(409, "connection_changed", "The HighLevel connection changed. Refresh the preview to load the current sub-account.");
      }
      if (route.scope && !scopes.includes(route.scope)) {
        throw httpError(403, "hl_scope_missing", "This app needs permission to make changes in HighLevel. Reconnect HighLevel to grant it.");
      }

      if (isWrite) {
        const paused = (pausedUntil.get(locationId) ?? 0) - Date.now();
        if (paused > 0) throw hlRateLimited(paused / 1000);
        if (route.bodyLocation) body!.locationId = locationId; // always forced to the token's location
        const upstream = await fetch(HL_API_BASE + path, {
          method: route.method,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Version: path.startsWith("/calendars") ? "2021-04-15" : "2021-07-28",
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        // Every write is logged (never its body: it holds customer data).
        console.info("hl_write", { uid: claims.uid, locationId, method: route.method, path, status: upstream.status });
        if (upstream.ok) {
          forgetLocation(locationId);
          res.status(upstream.status).type("application/json").send(await upstream.text());
          return;
        }
        await sendUpstreamError(res, upstream, path, locationId);
        return;
      }

      const url = new URL(HL_API_BASE + path);
      for (const [k, v] of Object.entries(req.query)) if (typeof v === "string") url.searchParams.set(k, v);
      if (NO_LOCATION_PARAM.some((re) => re.test(path))) url.searchParams.delete("locationId");
      else url.searchParams.set("locationId", locationId); // always forced to the token's location

      // Same sub-account, path and query: the same data, whichever of the user's apps asks for it.
      url.searchParams.sort();
      const cacheKey = `${locationId} ${url.pathname}?${url.searchParams}`;
      const hit = cached(cacheKey);
      if (hit !== null) {
        res.status(200).set("X-Cache", "hit").type("application/json").send(hit);
        return;
      }
      const paused = (pausedUntil.get(locationId) ?? 0) - Date.now();
      if (paused > 0) throw hlRateLimited(paused / 1000);

      const upstream = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: path.startsWith("/calendars") ? "2021-04-15" : "2021-07-28",
          Accept: "application/json",
        },
      });

      if (upstream.ok) {
        const body = await upstream.text();
        remember(cacheKey, body);
        res.status(200).set("X-Cache", "miss").type("application/json").send(body);
        return;
      }
      await sendUpstreamError(res, upstream, path, locationId);
    } catch (err) {
      sendError(res, err);
    }
  },
);

/** Maps a HighLevel error to the proxy's error format, and starts the pause on a 429. */
async function sendUpstreamError(res: Response, upstream: globalThis.Response, path: string, locationId: string) {
  const detail = await upstream.text().catch(() => "");
  console.error("HL upstream error", upstream.status, path, detail.slice(0, 500));
  if (upstream.status === 401) res.status(401).json(apiError("hl_unauthorized", "HighLevel rejected the credentials. Reconnect HighLevel."));
  else if (upstream.status === 429) {
    const retryAfter = retryAfterSeconds(upstream.headers.get("retry-after"));
    pausedUntil.set(locationId, Date.now() + retryAfter * 1000);
    console.warn("hl_rate_limited", { locationId, retryAfter });
    sendError(res, hlRateLimited(retryAfter));
  }
  else if (upstream.status >= 500) res.status(502).json(apiError("hl_unavailable", "HighLevel is temporarily unavailable."));
  else res.status(upstream.status).json(apiError("hl_request_failed", `HighLevel returned ${upstream.status}: ${detail.slice(0, 200)}`));
}
