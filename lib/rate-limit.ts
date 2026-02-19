import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, resetRateLimitState } from '@/lib/rate-limit-core'

export { checkRateLimit, resetRateLimitState }

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
