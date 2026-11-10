/**
 * Rate limits. Two mechanisms, chosen by what abuse would cost:
 * - Builds (real Claude spend) are limited exactly, in Firestore, in the same place as the credit hold:
 *   build slots with an expiry (builds running at once) and a sliding-window log (build starts).
 *   The pure logic is here; the transaction lives in credits.ts.
 * - Everything else uses in-memory token buckets, one set per function instance. They are approximate
 *   across instances, which is fine for throttling; HighLevel's own 429 is the backstop for the proxy.
 * Details and the reasoning: docs/ARCHITECTURE.md, "Rate limiting".
 */

/** Every limit in one place. `perSecond` is the refill rate, `burst` the bucket size. */
export const LIMITS = {
  build: { maxPerProject: 1, maxPerUser: 2, startsPerWindow: 10, windowMs: 10 * 60_000 },
  proxyPerUser: { perSecond: 20, burst: 40 },
  apiWrites: { perSecond: 1, burst: 20 }, // 60/min
  apiReads: { perSecond: 5, burst: 60 }, // 300/min
} as const;

/** A build slot is dropped after this long even if the build never settled (crashed instance). */
export const BUILD_SLOT_TTL_MS = 10 * 60_000; // generate's timeout is 540 s

// ---- Token bucket (in memory) ----

type Bucket = { tokens: number; last: number };
const MAX_KEYS = 10_000;

/**
 * A token bucket per key. `take(key)` returns 0 when the request may proceed, otherwise the seconds to wait.
 * Node runs this synchronously, so concurrent requests on one instance can't race on a bucket.
 */
export function createLimiter(opts: { perSecond: number; burst: number }, now: () => number = Date.now) {
  const buckets = new Map<string, Bucket>();
  return {
    take(key: string): number {
      const t = now() / 1000;
      const b = buckets.get(key) ?? { tokens: opts.burst, last: t };
      b.tokens = Math.min(opts.burst, b.tokens + (t - b.last) * opts.perSecond);
      b.last = t;
      buckets.delete(key); // re-insert so the Map stays ordered by last use
      buckets.set(key, b);
      if (buckets.size > MAX_KEYS) buckets.delete(buckets.keys().next().value!); // drop the least recently used
      if (b.tokens < 1) return (1 - b.tokens) / opts.perSecond;
      b.tokens -= 1;
      return 0;
    },
  };
}

// ---- Build slots + sliding-window log (pure; applied inside a Firestore transaction) ----

export type BuildState = {
  activeBuilds: Record<string, { projectId: string; startedAt: number }>;
  buildStarts: number[];
};

export type BuildDecision =
  | { ok: true; next: BuildState }
  | { ok: false; retryAfter: number; message: string };

/** Decides whether a new build may start, and returns the state to store if it may. */
export function decideBuildStart(state: BuildState, projectId: string, generationId: string, now: number): BuildDecision {
  const { maxPerProject, maxPerUser, startsPerWindow, windowMs } = LIMITS.build;
  const active = Object.entries(state.activeBuilds).filter(([, s]) => now - s.startedAt < BUILD_SLOT_TTL_MS);
  if (active.filter(([, s]) => s.projectId === projectId).length >= maxPerProject) {
    return { ok: false, retryAfter: 30, message: "A build is already running for this app. Wait for it to finish, or stop it." };
  }
  if (active.length >= maxPerUser) {
    return { ok: false, retryAfter: 30, message: `You can run ${maxPerUser} builds at a time. Wait for one to finish.` };
  }
  const starts = state.buildStarts.filter((t) => now - t < windowMs);
  if (starts.length >= startsPerWindow) {
    const retryAfter = Math.ceil((starts[0]! + windowMs - now) / 1000);
    return { ok: false, retryAfter, message: `You've started ${startsPerWindow} builds in 10 minutes. Try again in ${retryAfter} s.` };
  }
  return {
    ok: true,
    next: {
      activeBuilds: { ...Object.fromEntries(active), [generationId]: { projectId, startedAt: now } },
      buildStarts: [...starts, now],
    },
  };
}
