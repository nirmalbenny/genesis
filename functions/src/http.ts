import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { auth } from "./admin";

export type HttpError = Error & { status: number; code: string };

export function httpError(status: number, code: string, message: string): HttpError {
  return Object.assign(new Error(message), { status, code });
}

/** Verifies the Firebase ID token in the Authorization header. */
export async function verifyUser(req: Request): Promise<{ uid: string; emailVerified: boolean }> {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw httpError(401, "unauthenticated", "Missing bearer token");
  try {
    const decoded = await auth.verifyIdToken(token);
    return { uid: decoded.uid, emailVerified: decoded.email_verified === true };
  } catch {
    throw httpError(401, "unauthenticated", "Invalid or expired token");
  }
}

/** Verifies the Firebase ID token and returns the uid. */
export async function requireUser(req: Request): Promise<string> {
  return (await verifyUser(req)).uid;
}

export function sendError(res: Response, err: unknown): void {
  const e = err as Partial<HttpError>;
  if (e.status) {
    res.status(e.status).json({ error: { code: e.code, message: e.message } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "internal", message: "Internal error" } });
}
