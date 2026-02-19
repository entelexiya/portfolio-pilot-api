import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, resetRateLimitState } from '@/lib/rate-limit-core'

export { checkRateLimit, resetRateLimitState }

type RateLimitInput = {
  key: string
  limit: number
  windowMs: number
}

type RateLimitResult = {
  allowed: boolean
  remaining: number
  resetAt: number
}

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN

function parsePipelineNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

async function checkRateLimitDistributed(input: RateLimitInput): Promise<RateLimitResult | null> {
  if (!upstashUrl || !upstashToken) return null

  const ttlSec = Math.max(1, Math.ceil(input.windowMs / 1000))
  const endpoint = `${upstashUrl.replace(/\/$/, '')}/pipeline`

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${upstashToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      ['INCR', input.key],
      ['EXPIRE', input.key, ttlSec, 'NX'],
      ['PTTL', input.key],
    ]),
    cache: 'no-store',
  })

  if (!res.ok) return null

  const payload = (await res.json()) as Array<{ result?: unknown; error?: string }>
  if (!Array.isArray(payload) || payload.length < 3) return null
  if (payload.some((entry) => entry.error)) return null

  const count = parsePipelineNumber(payload[0]?.result, input.limit + 1)
  const pttl = parsePipelineNumber(payload[2]?.result, input.windowMs)
  const resetAt = Date.now() + (pttl > 0 ? pttl : input.windowMs)

  return {
    allowed: count <= input.limit,
    remaining: Math.max(0, input.limit - count),
    resetAt,
  }
}

export async function checkRateLimitSmart(input: RateLimitInput): Promise<RateLimitResult> {
  try {
    const distributed = await checkRateLimitDistributed(input)
    if (distributed) return distributed
  } catch (error) {
    console.warn('rate_limit_distributed_fallback', {
      key: input.key,
      reason: error instanceof Error ? error.message : 'unknown',
    })
  }

  return checkRateLimit(input)
}

export function getClientIp(req: NextRequest) {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  return req.headers.get('x-real-ip') || 'unknown'
}

export function applyRateLimitHeaders(
  res: NextResponse,
  limit: number,
  remaining: number,
  resetAt: number
) {
  res.headers.set('x-ratelimit-limit', String(limit))
  res.headers.set('x-ratelimit-remaining', String(Math.max(0, remaining)))
  res.headers.set('x-ratelimit-reset', String(Math.floor(resetAt / 1000)))
  return res
}
