import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { auth } from "./admin";

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
 * Verifies the Firebase ID token in the Authorization header and returns the uid. Accounts whose email is not
 * verified yet are refused: the app is unusable until then.
 */
export async function requireVerifiedUser(req: Request): Promise<string> {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw httpError(401, "unauthenticated", "Missing bearer token");
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token);
  } catch {
    throw httpError(401, "unauthenticated", "Invalid or expired token");
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
