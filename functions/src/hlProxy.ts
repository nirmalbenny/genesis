import { onRequest } from "firebase-functions/v2/https";
import { HL_API_BASE, HL_CLIENT_ID, HL_CLIENT_SECRET, PREVIEW_TOKEN_SECRET } from "./config";
import { authFailed, httpError, rateLimited, sendError, type HttpError } from "./http";
import { getValidHlToken } from "./hl/token";
import { verifyPreviewToken } from "./previewToken";
import { getOwnedProject } from "./projects";
import { createLimiter, LIMITS } from "./rateLimits";

// GET-only allowlist of HighLevel paths generated apps may call.
const ALLOWED = [
  /^\/contacts\/?$/,
  /^\/contacts\/[\w-]+$/,
  /^\/contacts\/[\w-]+\/appointments$/,
  /^\/conversations\/search$/,
  /^\/conversations\/[\w-]+$/,
  /^\/conversations\/[\w-]+\/messages$/,
  /^\/calendars\/?$/,
  /^\/calendars\/events$/,
  /^\/calendars\/[\w-]+\/free-slots$/,
];

// Endpoints that reject a locationId parameter (HL returns 422). They are still scoped to the connected
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
      if (req.method !== "GET") throw httpError(405, "method_not_allowed", "Only GET is supported");
      const header = req.get("authorization") ?? "";
      let claims;
      try {
        claims = verifyPreviewToken(header.startsWith("Bearer ") ? header.slice(7) : "");
      } catch (err) {
        throw authFailed(req, err as HttpError);
      }

      const path = req.path;
      if (!ALLOWED.some((re) => re.test(path))) throw httpError(403, "path_not_allowed", `Path not allowed: ${path}`);
      await assertPreviewProject(claims.uid, claims.projectId);

      const wait = perUser.take(claims.uid);
      if (wait) {
        throw rateLimited(wait, "This app is making requests too quickly. Wait a moment and try again.", {
          limit: "proxyPerUser", uid: claims.uid, path,
        });
      }

      const { accessToken, locationId } = await getValidHlToken(claims.uid);
      if (locationId !== claims.locationId) {
        throw httpError(409, "connection_changed", "The HighLevel connection changed. Refresh the preview to load the current sub-account.");
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
    } catch (err) {
      sendError(res, err);
    }
  },
);
