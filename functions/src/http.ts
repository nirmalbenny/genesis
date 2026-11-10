import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { auth } from "./admin";
import { createLimiter, LIMITS } from "./rateLimits";

export type HttpError = Error & { status: number; code: string; retryAfter?: number };

export function httpError(status: number, code: string, message: string): HttpError {
  return Object.assign(new Error(message), { status, code });
}

/** 429 for one of our own limits (HighLevel's own limit is `hl_rate_limited`). Logged so limits can be tuned. */
export function rateLimited(retryAfterSeconds: number, message: string, log: Record<string, unknown>): HttpError {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds));
  console.warn("rate_limited", { ...log, retryAfter });
  return Object.assign(httpError(429, "rate_limited", message), { retryAfter });
}

/**
 * The caller's IP. Google's front end appends the address it saw to X-Forwarded-For, after anything the
 * client sent, so the last entry is the one a client can't forge.
 */
export function clientIp(req: Request): string {
  const forwarded = (req.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded.at(-1) ?? req.ip ?? "unknown";
}

const authFailures = createLimiter(LIMITS.authFailuresPerIp);

/**
 * Turns a rejected token into a 429 once an IP has had too many rejections. Only failures are counted, after
 * the token was checked, so a request with a valid token is never limited here.
 */
export function authFailed(req: Request, err: HttpError): HttpError {
  const ip = clientIp(req);
  const wait = authFailures.take(ip);
  return wait ? rateLimited(wait, "Too many requests with an invalid sign-in. Wait and try again.", { limit: "authFailuresPerIp", ip }) : err;
}

/**
 * Verifies the Firebase ID token in the Authorization header and returns the uid. Accounts whose email is not
 * verified yet are refused: the app is unusable until then.
 */
export async function requireVerifiedUser(req: Request): Promise<string> {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw authFailed(req, httpError(401, "unauthenticated", "Missing bearer token"));
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    throw authFailed(req, httpError(401, "unauthenticated", "Invalid or expired token"));
  }
  if (decoded.email_verified !== true) {
    throw httpError(403, "email_not_verified", "Verify your email address to start using Genesis.");
  }
  return decoded.uid;
}

export function sendError(res: Response, err: unknown): void {
  const e = err as Partial<HttpError>;
  if (e.status) {
    if (e.retryAfter) res.set("Retry-After", String(e.retryAfter));
    res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}) } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal", message: "Internal error" } });
}
