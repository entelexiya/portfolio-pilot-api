import test from 'node:test'
import assert from 'node:assert/strict'
import { isOwner, parseBearerTokenFromHeader } from '../lib/auth-utils.ts'
import { checkRateLimit, resetRateLimitState } from '../lib/rate-limit-core.ts'

test('parseBearerToken returns token from valid Authorization header', () => {
  assert.equal(parseBearerTokenFromHeader('Bearer abc.def.ghi'), 'abc.def.ghi')
})

test('parseBearerToken returns null for invalid Authorization header', () => {
  assert.equal(parseBearerTokenFromHeader('Basic 123'), null)
})

test('isOwner allows empty userId and same userId', () => {
  assert.equal(isOwner(null, 'user-1'), true)
  assert.equal(isOwner('user-1', 'user-1'), true)
  assert.equal(isOwner('user-2', 'user-1'), false)
})

test('checkRateLimit blocks requests after limit and resets after window', () => {
  resetRateLimitState()

  const key = 'test-key'
  const limit = 2
  const windowMs = 1_000
  const now = 1_000_000

  const first = checkRateLimit({ key, limit, windowMs, now })
  const second = checkRateLimit({ key, limit, windowMs, now: now + 1 })
  const third = checkRateLimit({ key, limit, windowMs, now: now + 2 })

  assert.equal(first.allowed, true)
  assert.equal(second.allowed, true)
  assert.equal(third.allowed, false)

  const afterReset = checkRateLimit({ key, limit, windowMs, now: now + windowMs + 5 })
  assert.equal(afterReset.allowed, true)
})
