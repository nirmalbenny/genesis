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
  proxyWritesPerUser: { perSecond: 0.5, burst: 10 }, // 30/min: creates and updates in HighLevel
  proxySendsPerUser: { perSecond: 1 / 6, burst: 5 }, // 10/min: messages reach real people and can cost money
  proxySendsPerLocation: { perSecond: 200 / 86_400, burst: 50 }, // about 200 a day per sub-account
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
  /** `exclusive`: a variant build (4 builds at once) holds every slot of the user. */
  activeBuilds: Record<string, { projectId: string; startedAt: number; exclusive?: boolean }>;
  buildStarts: number[];
};

/** A variant build runs several builds at once: it needs every slot, and counts as that many starts. */
export type BuildWeight = { exclusive: boolean; starts: number };
const SINGLE: BuildWeight = { exclusive: false, starts: 1 };

export type BuildDecision =
  | { ok: true; next: BuildState }
  | { ok: false; retryAfter: number; message: string };

/** Decides whether a new build may start, and returns the state to store if it may. */
export function decideBuildStart(state: BuildState, projectId: string, generationId: string, now: number, weight: BuildWeight = SINGLE): BuildDecision {
  const { maxPerProject, maxPerUser, startsPerWindow, windowMs } = LIMITS.build;
  const active = Object.entries(state.activeBuilds).filter(([, s]) => now - s.startedAt < BUILD_SLOT_TTL_MS);
  if (active.some(([, s]) => s.exclusive) || (weight.exclusive && active.length)) {
    return { ok: false, retryAfter: 30, message: "Your app versions are still being built. Wait for them to finish, or stop them." };
  }
  if (active.filter(([, s]) => s.projectId === projectId).length >= maxPerProject) {
    return { ok: false, retryAfter: 30, message: "A build is already running for this app. Wait for it to finish, or stop it." };
  }
  if (active.length >= maxPerUser) {
    return { ok: false, retryAfter: 30, message: `You can run ${maxPerUser} builds at a time. Wait for one to finish.` };
  }
  const starts = state.buildStarts.filter((t) => now - t < windowMs);
  if (starts.length + weight.starts > startsPerWindow) {
    // Wait until enough of the oldest starts leave the window (one for a single build).
    const oldest = starts[Math.min(starts.length - 1, starts.length + weight.starts - startsPerWindow - 1)] ?? now;
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { ok: false, retryAfter, message: `You've started ${startsPerWindow} builds in 10 minutes. Try again in ${retryAfter} s.` };
  }
  return {
    ok: true,
    next: {
      activeBuilds: { ...Object.fromEntries(active), [generationId]: { projectId, startedAt: now, ...(weight.exclusive ? { exclusive: true } : {}) } },
      buildStarts: [...starts, ...Array<number>(weight.starts).fill(now)],
    },
  };
}
