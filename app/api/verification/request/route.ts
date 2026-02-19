import { NextRequest } from 'next/server'
import { randomUUID } from 'crypto'
import { createServiceClient } from '@/lib/supabase'
import { getAuthenticatedUser } from '@/lib/auth'
import { errorMessage, failure, getRequestId, success } from '@/lib/api-response'
import { applyRateLimitHeaders, checkRateLimitSmart, getClientIp } from '@/lib/rate-limit'
import { logError, logWarn } from '@/lib/logger'

const requestRateLimit = {
  limit: 10,
  windowMs: 10 * 60 * 1000,
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req)
  const ip = getClientIp(req)

  try {
    const auth = await getAuthenticatedUser(req)
    if (!auth) return failure('Unauthorized', requestId, 401, 'UNAUTHORIZED')

    const rate = await checkRateLimitSmart({
      key: `verification:request:${auth.user.id}:${ip}`,
      limit: requestRateLimit.limit,
      windowMs: requestRateLimit.windowMs,
    })

    if (!rate.allowed) {
      logWarn({
        event: 'verification_request_rate_limited',
        requestId,
        meta: { userId: auth.user.id, ip },
      })
      const res = failure('Too many requests', requestId, 429, 'RATE_LIMITED')
      return applyRateLimitHeaders(res, requestRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const body = await req.json()
    const { achievementId, verifierEmail, verificationLink, message } = body ?? {}
    if (
      !achievementId ||
      !verifierEmail ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(verifierEmail))
    ) {
      const res = failure(
        'achievementId and valid verifierEmail are required',
        requestId,
        400,
        'VALIDATION_ERROR'
      )
      return applyRateLimitHeaders(res, requestRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const supabase = createServiceClient()
    const { data: achievement, error: achError } = await supabase
      .from('achievements')
      .select('id, user_id')
      .eq('id', achievementId)
      .single()

    if (achError || !achievement || achievement.user_id !== auth.user.id) {
      const res = failure('Achievement not found or not yours', requestId, 404, 'NOT_FOUND')
      return applyRateLimitHeaders(res, requestRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const requestToken = randomUUID()
    const { error: insertError } = await supabase.from('verification_requests').insert({
      achievement_id: achievementId,
      student_id: auth.user.id,
      verifier_email: String(verifierEmail).trim().toLowerCase(),
      message: typeof message === 'string' ? message : null,
      status: 'pending',
      token: requestToken,
    })

    if (insertError) {
      logError({
        event: 'verification_request_insert_failed',
        requestId,
        error: insertError,
        meta: { achievementId },
      })
      const res = failure(
        'Failed to create verification request',
        requestId,
        500,
        'VERIFICATION_REQUEST_CREATE_FAILED'
      )
      return applyRateLimitHeaders(res, requestRateLimit.limit, rate.remaining, rate.resetAt)
    }

    if (typeof verificationLink === 'string' && verificationLink.trim()) {
      await supabase
        .from('achievements')
        .update({ verification_link: verificationLink.trim() })
        .eq('id', achievementId)
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      console.warn(
        'NEXT_PUBLIC_APP_URL not set: verification link may point to API host. Set frontend URL in backend env.'
      )
    }
    const verifyUrl = `${baseUrl.replace(/\/$/, '')}/verify/${requestToken}`

    let emailSent = false
    let emailError: string | null = null

    if (process.env.RESEND_API_KEY) {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || 'PortfolioPilot <onboarding@resend.dev>',
          to: [String(verifierEmail).trim()],
          subject: 'Verify a student achievement on PortfolioPilot',
          html: `
            <p>A student asked you to confirm their achievement on PortfolioPilot.</p>
            <p><strong>Click the link below to sign in and verify:</strong></p>
            <p><a href="${verifyUrl}">${verifyUrl}</a></p>
            <p>This link is single-use. If you don't have an account, you'll get one when you click.</p>
          `,
        }),
      })

      if (!resendRes.ok) {
        const resendErrorText = await resendRes.text()
        emailError = `Resend error: ${resendErrorText}`
        logWarn({
          event: 'verification_request_email_send_failed',
          requestId,
          message: resendErrorText,
          meta: { verifierEmail: String(verifierEmail).trim() },
        })
      } else {
        emailSent = true
      }
    } else {
      emailError = 'RESEND_API_KEY is not configured on backend'
      logWarn({
        event: 'verification_request_email_not_configured',
        requestId,
        message: emailError,
        meta: { verifierEmail: String(verifierEmail).trim(), verifyUrl },
      })
    }

    const res = success(
      null,
      requestId,
      200,
      {
        verifyUrl,
        emailSent,
        emailError,
      }
    )
    return applyRateLimitHeaders(res, requestRateLimit.limit, rate.remaining, rate.resetAt)
  } catch (error: unknown) {
    logError({ event: 'verification_request_failed', requestId, error })
    return failure(errorMessage(error), requestId, 500, 'VERIFICATION_REQUEST_FAILED')
  }
}
