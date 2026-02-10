import Redis from 'ioredis';
import { QuotaRecord, UsageSnapshot } from '@dumbify/shared';
import { config } from '../config/env.js';

let redisClient: Redis | null = null;

/**
 * Gets or creates the Redis client singleton.
 * Connection string comes from config (either REDIS_CONNECTION_STRING or built from REDIS_HOST/PORT/PASSWORD).
 * @returns Redis client instance
 * @throws Error if Redis is not configured
 */
function getRedisClient(): Redis {
  if (!redisClient) {
    const connectionString = config.REDIS_CONNECTION_STRING;

    if (!connectionString) {
      throw new Error(
        'Redis is not configured: set REDIS_CONNECTION_STRING or REDIS_HOST, REDIS_PORT, REDIS_PASSWORD'
      );
    }

    redisClient = new Redis(connectionString, {
      connectTimeout: 10000,
      tls: {
        servername: process.env.REDIS_HOST
      },
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3
    });

    redisClient.on('error', (error) => {
      console.error('Redis connection error:', error);
    });
  }

  return redisClient;
}

/**
 * Calculates human-readable time until reset.
 * @param resetAt - Unix timestamp in milliseconds when quota resets
 * @returns Formatted string like "24h", "23h 45m", "45m", or "< 1m"
 */
export function calculateResetIn(resetAt: number): string {
  const now = Date.now();
  const diffMs = resetAt - now;

  if (diffMs <= 0) {
    return '< 1m';
  }

  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const remainingMinutes = diffMinutes % 60;

  if (diffHours > 0 && remainingMinutes > 0) {
    return `${diffHours}h ${remainingMinutes}m`;
  } else if (diffHours > 0) {
    return `${diffHours}h`;
  } else if (diffMinutes > 0) {
    return `${diffMinutes}m`;
  } else {
    return '< 1m';
  }
}

const QUOTA_LIMIT = 200;
const WARNING_THRESHOLD = 160; // 80% of 200

const LUA_CHECK_AND_CONSUME = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local limit = tonumber(ARGV[2])
  local ttl_seconds = tonumber(ARGV[3])

  local record = redis.call('GET', key)

  -- Case 1: No record exists - initialize with count=1
  if not record then
    local new_record = cjson.encode({
      count = 1,
      windowStart = now,
      resetAt = now + (ttl_seconds * 1000)
    })
    redis.call('SETEX', key, ttl_seconds, new_record)
    return new_record
  end

  -- Case 2: Record exists - parse it
  local quota = cjson.decode(record)

  -- Case 3: Window expired - reset to count=1
  if now >= quota.resetAt then
    local reset_record = cjson.encode({
      count = 1,
      windowStart = now,
      resetAt = now + (ttl_seconds * 1000)
    })
    redis.call('SETEX', key, ttl_seconds, reset_record)
    return reset_record
  end

  -- Case 4: Quota exceeded
  if quota.count >= limit then
    return redis.error_reply('QUOTA_EXCEEDED')
  end

  -- Case 5: Increment count
  quota.count = quota.count + 1
  local updated_record = cjson.encode(quota)
  local remaining_ttl = math.ceil((quota.resetAt - now) / 1000)
  redis.call('SETEX', key, remaining_ttl, updated_record)
  return updated_record
`;

/**
 * Builds a UsageSnapshot from an existing QuotaRecord (idempotent path).
 */
function snapshotFromRecord(record: QuotaRecord): UsageSnapshot {
  return {
    used: record.count,
    limit: QUOTA_LIMIT,
    resetIn: calculateResetIn(record.resetAt),
    resetAt: record.resetAt,
    warningThreshold: record.count >= WARNING_THRESHOLD
  };
}

/**
 * Initializes quota for a device. Idempotent: if a quota record already exists,
 * returns the current usage snapshot without resetting count or extending the window.
 * When no record exists, returns a zero-usage snapshot WITHOUT persisting to Redis;
 * the windowStart/resetAt and TTL are first created in checkAndConsumeQuota() when
 * initial consumption occurs.
 * @param deviceId - The unique device identifier
 * @returns Current or initial usage snapshot
 * @throws Error if Redis is unavailable
 */
export async function initializeQuota(deviceId: string): Promise<UsageSnapshot> {
  try {
    const redis = getRedisClient();
    const key = `quota:${deviceId}`;

    const existing = await redis.get(key);
    if (existing !== null) {
      const record = JSON.parse(existing) as QuotaRecord;
      return snapshotFromRecord(record);
    }

    // No record exists - return zero-usage snapshot without persisting
    const now = Date.now();
    const resetAt = now + 24 * 60 * 60 * 1000; // 24 hours from now

    return {
      used: 0,
      limit: QUOTA_LIMIT,
      resetIn: calculateResetIn(resetAt),
      resetAt,
      warningThreshold: false
    };
  } catch (error) {
    console.error('Failed to initialize quota:', error);
    throw new Error('Quota service unavailable');
  }
}

/**
 * Atomically checks and consumes one quota unit for a device.
 * @param deviceId - The unique device identifier
 * @returns Usage snapshot after consuming quota
 * @throws Error with 'QUOTA_EXCEEDED' message if limit reached
 * @throws Error with 'Quota service unavailable' if Redis fails
 */
export async function checkAndConsumeQuota(deviceId: string): Promise<UsageSnapshot> {
  try {
    const redis = getRedisClient();
    const key = `quota:${deviceId}`;
    const now = Date.now();
    const ttlSeconds = 24 * 60 * 60; // 24 hours

    const result = await redis.eval(
      LUA_CHECK_AND_CONSUME,
      1,
      key,
      now.toString(),
      QUOTA_LIMIT.toString(),
      ttlSeconds.toString()
    ) as string;

    const record = JSON.parse(result) as QuotaRecord;
    return snapshotFromRecord(record);

  } catch (error: any) {
    // Handle quota exceeded error from Lua script
    if (error.message && error.message.includes('QUOTA_EXCEEDED')) {
      // Get current state for error response
      const currentUsage = await getCurrentUsage(deviceId);
      const quotaError = new Error('QUOTA_EXCEEDED');
      (quotaError as any).usage = currentUsage;
      throw quotaError;
    }

    // Handle Redis connection/availability errors
    console.error('Failed to check and consume quota:', error);
    throw new Error('Quota service unavailable');
  }
}

/**
 * Gets current quota usage without consuming.
 * @param deviceId - The unique device identifier
 * @returns Current usage snapshot
 * @throws Error if Redis is unavailable
 */
export async function getCurrentUsage(deviceId: string): Promise<UsageSnapshot> {
  try {
    const redis = getRedisClient();
    const key = `quota:${deviceId}`;

    const existing = await redis.get(key);

    // If no record exists, return zero usage with 24h window
    if (existing === null) {
      const now = Date.now();
      const resetAt = now + 24 * 60 * 60 * 1000;
      return {
        used: 0,
        limit: QUOTA_LIMIT,
        resetIn: calculateResetIn(resetAt),
        resetAt,
        warningThreshold: false
      };
    }

    const record = JSON.parse(existing) as QuotaRecord;

    // Check if window has expired
    const now = Date.now();
    if (now >= record.resetAt) {
      // Window expired, return zero usage with new window
      const newResetAt = now + 24 * 60 * 60 * 1000;
      return {
        used: 0,
        limit: QUOTA_LIMIT,
        resetIn: calculateResetIn(newResetAt),
        resetAt: newResetAt,
        warningThreshold: false
      };
    }

    return snapshotFromRecord(record);

  } catch (error) {
    console.error('Failed to get current usage:', error);
    throw new Error('Quota service unavailable');
  }
}
