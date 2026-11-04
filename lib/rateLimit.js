import Redis from 'ioredis';

// Outside api/ on purpose - a file in api/ becomes its own route on Vercel,
// this is just a shared module imported by the real endpoints.

// Module-level singleton so a warm Lambda instance reuses the same
// connection across invocations instead of reconnecting every request.
let redis = null;
function getRedis() {
  if (!redis) {
    if (!process.env.REDIS_URL) {
      throw new Error('REDIS_URL is not set in this environment.');
    }
    redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      // Serverless functions have their own timeout - don't let a slow
      // Redis connection hang the request longer than that.
      connectTimeout: 3000,
    });
    redis.on('error', (err) => console.error('Redis connection error:', err));
  }
  return redis;
}

// Simple fixed-window counter: INCR + EXPIRE on first hit. Good enough for
// abuse prevention on a handful of low-traffic endpoints - doesn't need a
// sliding-window algorithm's precision for this.
export async function checkRateLimit(key, limit, windowSeconds) {
  try {
    const client = getRedis();
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, windowSeconds);
    }
    return { allowed: count <= limit, count, limit };
  } catch (err) {
    // Fail OPEN, not closed - a Redis outage shouldn't take down signups
    // or account management. This is abuse prevention, not the actual
    // security boundary (that's the auth/role checks already in place).
    console.error('Rate limit check failed, allowing request:', err);
    return { allowed: true, count: 0, limit };
  }
}

// Like checkRateLimit but also returns the TTL (seconds remaining) when the
// limit is exceeded, so callers can tell the user when they can retry.
export async function checkRateLimitWithTTL(key, limit, windowSeconds) {
  try {
    const client = getRedis();
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, windowSeconds);
    }
    const allowed = count <= limit;
    const ttl = allowed ? null : await client.ttl(key);
    return { allowed, count, limit, ttl: ttl ?? windowSeconds };
  } catch (err) {
    console.error('Rate limit check failed, allowing request:', err);
    return { allowed: true, count: 0, limit, ttl: 0 };
  }
}

// Vercel sets x-forwarded-for on every request; first entry is the client.
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}
