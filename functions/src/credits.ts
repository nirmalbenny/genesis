import type { Usage } from "@anthropic-ai/sdk/resources/messages/messages";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./admin";
import { httpError } from "./http";

/**
 * AI credits: 1 credit = $0.001 of Claude list price. Every user gets SIGNUP_CREDITS once their email is
 * verified. A build places a hold for its worst case, then is charged what it actually used.
 * Balances live on users/{uid}.credits; every change is an entry in users/{uid}/creditLedger (append-only).
 */
export const SIGNUP_CREDITS = 2500; // keep in sync with frontend/src/composables/useCredits.ts
export const RATE_CARD_VERSION = 1;

type Rate = { input: number; output: number; cacheWrite: number; cacheRead: number }; // credits per 1M tokens
const RATES: Record<string, Rate> = {
  "claude-sonnet-5-5": { input: 2000, output: 10000, cacheWrite: 2500, cacheRead: 200 },
  "claude-haiku-5-5": { input: 100, output: 500, cacheWrite: 125, cacheRead: 10 },
};
// An unknown model is billed at the highest known rate rather than for free.
const FALLBACK = Object.values(RATES).reduce((a, b) => (a.output >= b.output ? a : b));
const rateFor = (model: string) => RATES[model] ?? FALLBACK;

export type TokenUsage = { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number };

export function toTokenUsage(u: Partial<Usage> | undefined | null): TokenUsage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
  };
}

/** Exact (fractional) credits for one model call; round once per build with chargeable(). */
export function creditsFor(model: string, u: TokenUsage): number {
  const r = rateFor(model);
  return (u.inputTokens * r.input + u.outputTokens * r.output + u.cacheWriteTokens * r.cacheWrite + u.cacheReadTokens * r.cacheRead) / 1e6;
}

export const chargeable = (credits: number) => Math.ceil(credits);

export type CreditState = { balance: number; reserved: number; granted: number; used: number };
const EMPTY: CreditState = { balance: 0, reserved: 0, granted: 0, used: 0 };

const userRef = (uid: string) => db.doc(`users/${uid}`);
const ledger = (uid: string) => userRef(uid).collection("creditLedger");
const stateOf = (data: FirebaseFirestore.DocumentData | undefined): CreditState => ({ ...EMPTY, ...(data?.credits ?? {}) });

/** Grants the signup credits once (the ledger id makes it idempotent). Returns true when granted now. */
export async function grantSignupCredits(uid: string): Promise<boolean> {
  return db.runTransaction(async (tx) => {
    const entry = ledger(uid).doc("signup");
    if ((await tx.get(entry)).exists) return false;
    const s = stateOf((await tx.get(userRef(uid))).data());
    tx.set(entry, { type: "grant", credits: SIGNUP_CREDITS, reason: "signup", createdAt: FieldValue.serverTimestamp() });
    tx.set(userRef(uid), { credits: { ...s, balance: s.balance + SIGNUP_CREDITS, granted: s.granted + SIGNUP_CREDITS } }, { merge: true });
    return true;
  });
}

/** Holds `credits` for a build, or refuses with 402 when the available balance can't cover it. */
export async function holdCredits(uid: string, generationId: string, credits: number): Promise<void> {
  await db.runTransaction(async (tx) => {
    const s = stateOf((await tx.get(userRef(uid))).data());
    const available = s.balance - s.reserved;
    if (available < credits) {
      throw httpError(402, "insufficient_credits",
        `This build needs up to ${credits} AI credits and you have ${Math.max(0, available)} available.`);
    }
    tx.set(ledger(uid).doc(`${generationId}-hold`), { type: "hold", credits, generationId, createdAt: FieldValue.serverTimestamp() });
    tx.set(userRef(uid), { credits: { ...s, reserved: s.reserved + credits } }, { merge: true });
  });
}

/** Releases a build's hold and charges what it actually used (0 to release only). Idempotent per build. */
export async function settleCredits(
  uid: string,
  generationId: string,
  held: number,
  charged: number,
  detail: Record<string, unknown>,
): Promise<number> {
  return db.runTransaction(async (tx) => {
    const entry = ledger(uid).doc(`${generationId}-charge`);
    const s = stateOf((await tx.get(userRef(uid))).data());
    if ((await tx.get(entry)).exists) return s.balance;
    const next = {
      ...s,
      reserved: Math.max(0, s.reserved - held),
      balance: s.balance - charged,
      used: s.used + charged,
    };
    tx.set(entry, {
      type: "charge", credits: charged, released: held, generationId, rateCardVersion: RATE_CARD_VERSION, ...detail,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.set(userRef(uid), { credits: next }, { merge: true });
    return next.balance;
  });
}
