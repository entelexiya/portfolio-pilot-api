import { NextRequest } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { errorMessage, failure, getRequestId, success } from '@/lib/api-response'

const allowedCategories = new Set(['award', 'activity'])
const allowedTypes = new Set([
  'olympiad',
  'competition',
  'award_other',
  'project',
  'research',
  'internship',
  'volunteering',
  'leadership',
  'club',
  'activity_other',
])

function isValidDate(value: string) {
  return !Number.isNaN(Date.parse(value))
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req)
  try {
    const auth = await getAuthenticatedUser(req)
    if (!auth) return failure('Unauthorized', requestId, 401, 'UNAUTHORIZED')

    const params = await context.params
    const { data, error } = await auth.supabase
      .from('achievements')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', auth.user.id)
      .single()

    if (error) throw error
    return success(data, requestId)
  } catch (error: unknown) {
    return failure(errorMessage(error), requestId, 404, 'ACHIEVEMENT_NOT_FOUND')
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req)
  try {
    const auth = await getAuthenticatedUser(req)
    if (!auth) return failure('Unauthorized', requestId, 401, 'UNAUTHORIZED')

    const params = await context.params
    const body = await req.json()
    const payload: Record<string, string | null> = {}

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim()) {
        return failure('Invalid title', requestId, 400, 'VALIDATION_ERROR')
      }
      payload.title = body.title.trim()
    }
    if (body.description !== undefined) {
      payload.description = typeof body.description === 'string' ? body.description : null
    }
    if (body.category !== undefined) {
      if (typeof body.category !== 'string' || !allowedCategories.has(body.category)) {
        return failure('Invalid category', requestId, 400, 'VALIDATION_ERROR')
      }
      payload.category = body.category
    }
    if (body.type !== undefined) {
      if (typeof body.type !== 'string' || !allowedTypes.has(body.type)) {
        return failure('Invalid type', requestId, 400, 'VALIDATION_ERROR')
      }
      payload.type = body.type
    }
    if (body.date !== undefined) {
      if (typeof body.date !== 'string' || !isValidDate(body.date)) {
        return failure('Invalid date', requestId, 400, 'VALIDATION_ERROR')
      }
      payload.date = body.date
    }
    if (body.file_url !== undefined) {
      payload.file_url = typeof body.file_url === 'string' ? body.file_url : null
    }
    if (body.verification_link !== undefined) {
      payload.verification_link =
        typeof body.verification_link === 'string' ? body.verification_link : null
    }

    if (Object.keys(payload).length === 0) {
      return failure('No valid fields to update', requestId, 400, 'VALIDATION_ERROR')
    }

    const { data, error } = await auth.supabase
      .from('achievements')
      .update(payload)
      .eq('id', params.id)
      .eq('user_id', auth.user.id)
      .select()
      .single()

    if (error) throw error
    return success(data, requestId)
  } catch (error: unknown) {
    return failure(errorMessage(error), requestId, 400, 'ACHIEVEMENT_UPDATE_FAILED')
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req)
  try {
    const auth = await getAuthenticatedUser(req)
    if (!auth) return failure('Unauthorized', requestId, 401, 'UNAUTHORIZED')

    const params = await context.params
    const { error } = await auth.supabase
      .from('achievements')
      .delete()
      .eq('id', params.id)
      .eq('user_id', auth.user.id)

    if (error) throw error
    return success({ message: 'Achievement deleted successfully' }, requestId)
  } catch (error: unknown) {
    return failure(errorMessage(error), requestId, 400, 'ACHIEVEMENT_DELETE_FAILED')
  }
}
