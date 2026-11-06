import { createHmac, timingSafeEqual } from "node:crypto";
import { PREVIEW_TOKEN_SECRET } from "./config";
import { httpError } from "./http";

export type PreviewClaims = { uid: string; projectId: string; locationId: string; exp: number };

const TTL_MS = 15 * 60 * 1000;

const sign = (body: string) =>
  createHmac("sha256", PREVIEW_TOKEN_SECRET.value()).update(body).digest("base64url");

export function signPreviewToken(c: Omit<PreviewClaims, "exp">): { token: string; expiresAt: number } {
  const exp = Date.now() + TTL_MS;
  const body = Buffer.from(JSON.stringify({ ...c, exp })).toString("base64url");
  return { token: `${body}.${sign(body)}`, expiresAt: exp };
}

export function verifyPreviewToken(token: string): PreviewClaims {
  const [body, sig] = token.split(".");
  const expected = Buffer.from(body ? sign(body) : "");
  const actual = Buffer.from(sig ?? "");
  if (!body || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw httpError(401, "invalid_preview_token", "Invalid preview token");
  }
  const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as PreviewClaims;
  if (claims.exp < Date.now()) throw httpError(401, "expired_preview_token", "Preview token expired");
  return claims;
}
