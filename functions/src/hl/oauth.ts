import { randomUUID } from "node:crypto";
import { onRequest } from "firebase-functions/v2/https";
import { auth, db } from "../admin";
import {
  APP_ORIGINS, APP_URL, HL_API_BASE, HL_CLIENT_ID, HL_CLIENT_SECRET, HL_REDIRECT_URI, HL_SCOPES,
} from "../config";
import { rateLimited, requireVerifiedUser, sendError } from "../http";
import { createLimiter, LIMITS } from "../rateLimits";
import { requestToken } from "./token";

const STATE_TTL_MS = 10 * 60 * 1000;

// Each start writes an OAuth state document; treated like any other write (rateLimits.ts).
const starts = createLimiter(LIMITS.apiWrites);

export const hlAuthStart = onRequest(
  { cors: APP_ORIGINS, secrets: [HL_CLIENT_ID] },
  async (req, res) => {
    try {
      const uid = await requireVerifiedUser(req);
      const wait = starts.take(uid);
      if (wait) throw rateLimited(wait, "Too many connection attempts. Wait a moment and try again.", { limit: "hlAuthStart", uid });
      const state = randomUUID();
      await db.doc(`oauthStates/${state}`).set({ uid, createdAt: Date.now() });
      const url = new URL("https://marketplace.gohighlevel.com/oauth/chooselocation");
      url.search = new URLSearchParams({
        response_type: "code",
        redirect_uri: HL_REDIRECT_URI.value(),
        client_id: HL_CLIENT_ID.value(),
        scope: HL_SCOPES,
        state,
        // Marketplace apps are looked up by app/version id: the client id without its "-suffix".
        version_id: HL_CLIENT_ID.value().split("-")[0]!,
      }).toString();
      res.json({ url: url.toString() });
    } catch (err) {
      sendError(res, err);
    }
  },
);

export const hlAuthCallback = onRequest(
  { secrets: [HL_CLIENT_ID, HL_CLIENT_SECRET] },
  async (req, res) => {
    const back = (status: string) => res.redirect(`${APP_URL.value()}/?hl=${status}`);
    try {
      const code = String(req.query.code ?? "");
      const state = String(req.query.state ?? "");
      if (!code || !state) return back("error");

      const stateRef = db.doc(`oauthStates/${state}`);
      const stateSnap = await stateRef.get();
      if (!stateSnap.exists) return back("error");
      await stateRef.delete(); // single use
      const { uid, createdAt } = stateSnap.data()!;
      if (Date.now() - createdAt > STATE_TTL_MS) return back("error");

      const t = await requestToken({
        grant_type: "authorization_code",
        code,
        redirect_uri: HL_REDIRECT_URI.value(),
      });
      if (!t.locationId) return back("error");

      const location = await hlGet<{ location?: HlLocation }>(t.access_token, `/locations/${t.locationId}`);
      const email = (await auth.getUser(uid)).email ?? null;

      // One HL location per user: both docs are overwritten on reconnect.
      await db.doc(`hlTokens/${uid}`).set({
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: Date.now() + t.expires_in * 1000,
        locationId: t.locationId,
        scope: t.scope,
      });
      await db.doc(`users/${uid}`).set(
        {
          email,
          hl: {
            locationId: t.locationId,
            locationName: location?.location?.name ?? t.locationId,
            companyId: t.companyId ?? null,
            location: {
              email: location?.location?.email ?? null,
              phone: location?.location?.phone ?? null,
              timezone: location?.location?.timezone ?? null,
            },
            connectedAt: Date.now(),
          },
        },
        { merge: true },
      );
      back("connected");
    } catch (err) {
      console.error("hlAuthCallback failed", err);
      back("error");
    }
  },
);

type HlLocation = { name?: string; email?: string; phone?: string; timezone?: string };

/** Best-effort GET: details are cosmetic (missing scope, etc.), so failures must not break connecting. */
async function hlGet<T>(accessToken: string, path: string): Promise<T | null> {
  const res = await fetch(`${HL_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Version: "2021-07-28", Accept: "application/json" },
  });
  if (!res.ok) {
    console.warn("HL detail lookup failed", path, res.status);
    return null;
  }
  return (await res.json()) as T;
}
