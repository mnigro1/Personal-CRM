import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";

export type RateLimitRule = { limit: number; windowSeconds: number };

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

/**
 * Count one hit against `key` and report whether it is still inside `rule`.
 *
 * Fixed window: the first hit opens a window of `windowSeconds`; hits beyond
 * `limit` inside it are refused; the first hit after it lapses opens a new
 * one. A single atomic upsert, so concurrent requests can't both slip under
 * the limit. Postgres-backed because Vercel functions share no memory — an
 * in-process counter would reset on every cold start.
 *
 * Fails OPEN: if the database is unreachable the caller is let through. The
 * request is about to fail on its own database access anyway, and a limiter
 * outage must never become a lockout.
 */
export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const expired = sql`${rateLimits.windowStart} < now() - (${rule.windowSeconds} * interval '1 second')`;
  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ key, hits: 1, windowStart: sql`now()` })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          hits: sql`case when ${expired} then 1 else ${rateLimits.hits} + 1 end`,
          windowStart: sql`case when ${expired} then now() else ${rateLimits.windowStart} end`,
        },
      })
      .returning({ hits: rateLimits.hits, windowStart: rateLimits.windowStart });

    // Keys are unbounded (one per address / IP / token), so sweep stale
    // rows now and then rather than letting the table grow forever.
    if (Math.random() < 0.02) {
      void db
        .delete(rateLimits)
        .where(sql`${rateLimits.windowStart} < now() - interval '1 day'`)
        .catch(() => {});
    }

    const hits = row?.hits ?? 1;
    const elapsed = row
      ? (Date.now() - new Date(row.windowStart).getTime()) / 1000
      : 0;
    return {
      allowed: hits <= rule.limit,
      remaining: Math.max(0, rule.limit - hits),
      retryAfterSeconds: Math.max(1, Math.ceil(rule.windowSeconds - elapsed)),
    };
  } catch (err) {
    console.error("rate limiter unavailable; allowing request", err);
    return { allowed: true, remaining: rule.limit, retryAfterSeconds: 0 };
  }
}

/**
 * Best-effort client address for per-IP keys. Vercel sets x-forwarded-for
 * from the real connection, so the first entry is trustworthy there; behind
 * nothing at all (local dev) it is simply absent.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
