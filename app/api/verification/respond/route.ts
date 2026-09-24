import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { getAuthenticatedUser } from '@/lib/auth'
import { errorMessage, failure, getRequestId, success } from '@/lib/api-response'
import { applyRateLimitHeaders, checkRateLimitSmart, getClientIp } from '@/lib/rate-limit'
import { logError, logWarn } from '@/lib/logger'

const respondRateLimit = {
  limit: 30,
  windowMs: 10 * 60 * 1000,
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req)
  const ip = getClientIp(req)

  try {
    const auth = await getAuthenticatedUser(req)
    if (!auth) return failure('Unauthorized', requestId, 401, 'UNAUTHORIZED')

    const rate = await checkRateLimitSmart({
      key: `verification:respond:${auth.user.id}:${ip}`,
      limit: respondRateLimit.limit,
      windowMs: respondRateLimit.windowMs,
    })
    if (!rate.allowed) {
      logWarn({
        event: 'verification_respond_rate_limited',
        requestId,
        meta: { userId: auth.user.id, ip },
      })
      const res = failure('Too many requests', requestId, 429, 'RATE_LIMITED')
      return applyRateLimitHeaders(res, respondRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const body = await req.json()
    const { token: requestToken, action, comment } = body ?? {}
    if (
      typeof requestToken !== 'string' ||
      !requestToken ||
      !['approve', 'reject'].includes(action)
    ) {
      const res = failure(
        'token and action (approve|reject) required',
        requestId,
        400,
        'VALIDATION_ERROR'
      )
      return applyRateLimitHeaders(res, respondRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const supabase = createServiceClient()
    const { data: verificationRequest, error: fetchError } = await supabase
      .from('verification_requests')
      .select('id, verifier_email, verifier_id, status')
      .eq('token', requestToken)
      .single()

    if (fetchError || !verificationRequest) {
      const res = failure('Link not found', requestId, 404, 'NOT_FOUND')
      return applyRateLimitHeaders(res, respondRateLimit.limit, rate.remaining, rate.resetAt)
    }
    if (verificationRequest.status !== 'pending') {
      const res = failure('Link already used', requestId, 410, 'LINK_USED')
      return applyRateLimitHeaders(res, respondRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const verifierEmail = verificationRequest.verifier_email.toLowerCase()
    const userEmail = (auth.user.email || '').toLowerCase()
    if (userEmail !== verifierEmail) {
      const res = failure(
        'This link was sent to a different email. Sign in with the email that received the verification request.',
        requestId,
        403,
        'FORBIDDEN'
      )
      return applyRateLimitHeaders(res, respondRateLimit.limit, rate.remaining, rate.resetAt)
    }

    if (!verificationRequest.verifier_id) {
      await supabase
        .from('verification_requests')
        .update({ verifier_id: auth.user.id })
        .eq('id', verificationRequest.id)
      await supabase.from('profiles').update({ role: 'verifier' }).eq('id', auth.user.id)
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected'
    const { error: updateError } = await supabase
      .from('verification_requests')
      .update({
        status: newStatus,
        verifier_comment: typeof comment === 'string' ? comment : null,
      })
      .eq('id', verificationRequest.id)

    if (updateError) {
      logError({
        event: 'verification_respond_update_failed',
        requestId,
        error: updateError,
        meta: { requestToken },
      })
      const res = failure('Failed to submit', requestId, 500, 'VERIFICATION_SUBMIT_FAILED')
      return applyRateLimitHeaders(res, respondRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const res = success(null, requestId, 200, { status: newStatus })
    return applyRateLimitHeaders(res, respondRateLimit.limit, rate.remaining, rate.resetAt)
  } catch (error: unknown) {
    logError({ event: 'verification_respond_failed', requestId, error })
    return failure(errorMessage(error), requestId, 500, 'VERIFICATION_RESPOND_FAILED')
  }
}
