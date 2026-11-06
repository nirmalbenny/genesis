import { db } from "../admin";
import { HL_API_BASE, HL_CLIENT_ID, HL_CLIENT_SECRET } from "../config";
import { httpError } from "../http";

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  locationId?: string;
  companyId?: string;
};

/** POST /oauth/token (form-encoded) for both the code exchange and refresh. */
export async function requestToken(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${HL_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: HL_CLIENT_ID.value(),
      client_secret: HL_CLIENT_SECRET.value(),
      user_type: "Location",
      ...params,
    }),
  });
  if (!res.ok) {
    console.error("HL token request failed", res.status, await res.text());
    throw httpError(502, "hl_token_failed", "HighLevel rejected the token request");
  }
  return res.json() as Promise<TokenResponse>;
}

export type ValidHlToken = { accessToken: string; locationId: string };

const inflight = new Map<string, Promise<ValidHlToken>>();

/**
 * Returns a usable access token, refreshing when it expires within 60s.
 * Refresh tokens rotate (single use), so concurrent callers share one refresh per instance.
 */
export function getValidHlToken(uid: string): Promise<ValidHlToken> {
  const running = inflight.get(uid);
  if (running) return running;
  const p = loadValidToken(uid).finally(() => inflight.delete(uid));
  inflight.set(uid, p);
  return p;
}

const isFresh = (expiresAt: number) => expiresAt - 60_000 > Date.now();

async function loadValidToken(uid: string): Promise<ValidHlToken> {
  const ref = db.doc(`hlTokens/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw httpError(409, "hl_not_connected", "HighLevel is not connected");
  const d = snap.data()!;
  if (isFresh(d.expiresAt)) return { accessToken: d.accessToken, locationId: d.locationId };

  try {
    // The network call stays outside the transaction so no locks are held while waiting on HighLevel.
    const t = await requestToken({ grant_type: "refresh_token", refresh_token: d.refreshToken });
    await db.runTransaction(async (tx) => {
      tx.update(ref, {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: Date.now() + t.expires_in * 1000,
        scope: t.scope,
      });
    });
    return { accessToken: t.access_token, locationId: d.locationId };
  } catch (err) {
    // Refresh tokens are single-use: if a concurrent request already rotated it, wait for its result.
    for (let attempt = 0; attempt < 25; attempt++) {
      await new Promise((r) => setTimeout(r, 400));
      const latest = (await ref.get()).data();
      if (latest && isFresh(latest.expiresAt)) return { accessToken: latest.accessToken, locationId: latest.locationId };
    }
    throw err;
  }
}
