type Bucket = {
  count: number
  resetAt: number
}

type CheckRateLimitInput = {
  key: string
  limit: number
  windowMs: number
  now?: number
}

type CheckRateLimitResult = {
  allowed: boolean
  remaining: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export function resetRateLimitState() {
  buckets.clear()
}

export function checkRateLimit(input: CheckRateLimitInput): CheckRateLimitResult {
  const now = input.now ?? Date.now()
  const current = buckets.get(input.key)

  if (!current || current.resetAt <= now) {
    buckets.set(input.key, { count: 1, resetAt: now + input.windowMs })
    return {
      allowed: true,
      remaining: input.limit - 1,
      resetAt: now + input.windowMs,
    }
  }

  if (current.count >= input.limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: current.resetAt,
    }
  }

  current.count += 1
  return {
    allowed: true,
    remaining: input.limit - current.count,
    resetAt: current.resetAt,
  }
}
