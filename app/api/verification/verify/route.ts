import { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { errorMessage, failure, getRequestId, success } from '@/lib/api-response'
import { applyRateLimitHeaders, checkRateLimit, getClientIp } from '@/lib/rate-limit'

const verifyRateLimit = {
  limit: 60,
  windowMs: 60 * 1000,
}

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req)
  const ip = getClientIp(req)

  try {
    const rate = checkRateLimit({
      key: `verification:verify:${ip}`,
      limit: verifyRateLimit.limit,
      windowMs: verifyRateLimit.windowMs,
    })
    if (!rate.allowed) {
      const res = failure('Too many requests', requestId, 429, 'RATE_LIMITED')
      return applyRateLimitHeaders(res, verifyRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const token = req.nextUrl.searchParams.get('token')
    if (!token) {
      const res = failure('Token required', requestId, 400, 'VALIDATION_ERROR')
      return applyRateLimitHeaders(res, verifyRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const supabase = createServiceClient()
    const { data: request, error: reqError } = await supabase
      .from('verification_requests')
      .select('id, achievement_id, student_id, verifier_email, status, created_at')
      .eq('token', token)
      .single()

    if (reqError || !request) {
      const res = failure('Link not found', requestId, 404, 'NOT_FOUND')
      return applyRateLimitHeaders(res, verifyRateLimit.limit, rate.remaining, rate.resetAt)
    }
    if (request.status !== 'pending') {
      const res = failure('Link already used', requestId, 410, 'LINK_USED', {
        status: request.status,
      })
      return applyRateLimitHeaders(res, verifyRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const { data: achievement, error: achError } = await supabase
      .from('achievements')
      .select('id, title, description, date, verification_link, file_url, category, type')
      .eq('id', request.achievement_id)
      .single()

    if (achError || !achievement) {
      const res = failure('Achievement not found', requestId, 404, 'NOT_FOUND')
      return applyRateLimitHeaders(res, verifyRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', request.student_id)
      .single()

    const res = success(
      {
        request: {
          id: request.id,
          verifier_email: request.verifier_email,
          status: request.status,
        },
        achievement: {
          title: achievement.title,
          description: achievement.description,
          date: achievement.date,
          verification_link: achievement.verification_link,
          file_url: achievement.file_url,
          category: achievement.category,
          type: achievement.type,
        },
        studentName: profile?.name || 'Student',
      },
      requestId
    )
    return applyRateLimitHeaders(res, verifyRateLimit.limit, rate.remaining, rate.resetAt)
  } catch (error: unknown) {
    return failure(errorMessage(error), requestId, 500, 'VERIFICATION_VERIFY_FAILED')
  }
}
