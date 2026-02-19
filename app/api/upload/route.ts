import { NextRequest } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { errorMessage, failure, getRequestId, success } from '@/lib/api-response'
import { applyRateLimitHeaders, checkRateLimitSmart, getClientIp } from '@/lib/rate-limit'
import { logError, logWarn } from '@/lib/logger'

const maxFileSizeBytes = 5 * 1024 * 1024
const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])

const uploadRateLimit = {
  limit: 20,
  windowMs: 10 * 60 * 1000,
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req)
  const ip = getClientIp(req)

  try {
    const auth = await getAuthenticatedUser(req)
    if (!auth) return failure('Unauthorized', requestId, 401, 'UNAUTHORIZED')

    const rate = await checkRateLimitSmart({
      key: `upload:post:${auth.user.id}:${ip}`,
      limit: uploadRateLimit.limit,
      windowMs: uploadRateLimit.windowMs,
    })

    if (!rate.allowed) {
      logWarn({
        event: 'upload_rate_limited',
        requestId,
        meta: { userId: auth.user.id, ip, method: 'POST' },
      })
      const res = failure('Too many requests', requestId, 429, 'RATE_LIMITED')
      return applyRateLimitHeaders(res, uploadRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const formData = await req.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      const res = failure('File is required', requestId, 400, 'VALIDATION_ERROR')
      return applyRateLimitHeaders(res, uploadRateLimit.limit, rate.remaining, rate.resetAt)
    }
    if (file.size > maxFileSizeBytes) {
      const res = failure('File is too large', requestId, 400, 'VALIDATION_ERROR')
      return applyRateLimitHeaders(res, uploadRateLimit.limit, rate.remaining, rate.resetAt)
    }
    if (!allowedMimeTypes.has(file.type)) {
      const res = failure('Unsupported file type', requestId, 400, 'VALIDATION_ERROR')
      return applyRateLimitHeaders(res, uploadRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const fileExt = file.name.split('.').pop() || 'bin'
    const fileName = `${auth.user.id}/${Date.now()}.${fileExt}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { data, error } = await auth.supabase.storage
      .from('achievements')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (error) throw error

    const { data: urlData } = auth.supabase.storage.from('achievements').getPublicUrl(fileName)
    const res = success(
      {
        path: data.path,
        url: urlData.publicUrl,
      },
      requestId
    )

    return applyRateLimitHeaders(res, uploadRateLimit.limit, rate.remaining, rate.resetAt)
  } catch (error: unknown) {
    logError({ event: 'upload_post_failed', requestId, error })
    return failure(errorMessage(error), requestId, 400, 'UPLOAD_FAILED')
  }
}

export async function DELETE(req: NextRequest) {
  const requestId = getRequestId(req)
  const ip = getClientIp(req)

  try {
    const auth = await getAuthenticatedUser(req)
    if (!auth) return failure('Unauthorized', requestId, 401, 'UNAUTHORIZED')

    const rate = await checkRateLimitSmart({
      key: `upload:delete:${auth.user.id}:${ip}`,
      limit: uploadRateLimit.limit,
      windowMs: uploadRateLimit.windowMs,
    })

    if (!rate.allowed) {
      logWarn({
        event: 'upload_rate_limited',
        requestId,
        meta: { userId: auth.user.id, ip, method: 'DELETE' },
      })
      const res = failure('Too many requests', requestId, 429, 'RATE_LIMITED')
      return applyRateLimitHeaders(res, uploadRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const { searchParams } = new URL(req.url)
    const filePath = searchParams.get('path')

    if (!filePath) {
      const res = failure('path is required', requestId, 400, 'VALIDATION_ERROR')
      return applyRateLimitHeaders(res, uploadRateLimit.limit, rate.remaining, rate.resetAt)
    }
    if (!filePath.startsWith(`${auth.user.id}/`)) {
      const res = failure('Forbidden', requestId, 403, 'FORBIDDEN')
      return applyRateLimitHeaders(res, uploadRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const { error } = await auth.supabase.storage.from('achievements').remove([filePath])
    if (error) throw error

    const res = success({ message: 'File deleted successfully' }, requestId)
    return applyRateLimitHeaders(res, uploadRateLimit.limit, rate.remaining, rate.resetAt)
  } catch (error: unknown) {
    logError({ event: 'upload_delete_failed', requestId, error })
    return failure(errorMessage(error), requestId, 400, 'UPLOAD_DELETE_FAILED')
  }
}
