import { NextRequest } from 'next/server'
import { getAuthenticatedUser, isOwner } from '@/lib/auth'
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

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req)
  try {
    const auth = await getAuthenticatedUser(req)
    if (!auth) return failure('Unauthorized', requestId, 401, 'UNAUTHORIZED')

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!isOwner(userId, auth.user.id)) {
      return failure('Forbidden', requestId, 403, 'FORBIDDEN')
    }

    const { data, error } = await auth.supabase
      .from('achievements')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('date', { ascending: false })

    if (error) throw error
    return success(data, requestId)
  } catch (error: unknown) {
    return failure(errorMessage(error), requestId, 400, 'ACHIEVEMENTS_LIST_FAILED')
  }
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req)
  try {
    const auth = await getAuthenticatedUser(req)
    if (!auth) return failure('Unauthorized', requestId, 401, 'UNAUTHORIZED')

    const body = await req.json()
    const {
      title,
      description,
      category = 'activity',
      type,
      date = new Date().toISOString().split('T')[0],
      file_url,
      verification_link,
    } = body ?? {}

    if (typeof title !== 'string' || !title.trim()) {
      return failure('title is required', requestId, 400, 'VALIDATION_ERROR')
    }
    if (typeof type !== 'string' || !allowedTypes.has(type)) {
      return failure('Invalid type', requestId, 400, 'VALIDATION_ERROR')
    }
    if (typeof category !== 'string' || !allowedCategories.has(category)) {
      return failure('Invalid category', requestId, 400, 'VALIDATION_ERROR')
    }
    if (typeof date !== 'string' || !isValidDate(date)) {
      return failure('Invalid date', requestId, 400, 'VALIDATION_ERROR')
    }

    const { data, error } = await auth.supabase
      .from('achievements')
      .insert({
        user_id: auth.user.id,
        title: title.trim(),
        description: typeof description === 'string' ? description : null,
        category,
        type,
        date,
        file_url: typeof file_url === 'string' ? file_url : null,
        verification_link: typeof verification_link === 'string' ? verification_link : null,
      })
      .select()
      .single()

    if (error) throw error
    return success(data, requestId, 201)
  } catch (error: unknown) {
    return failure(errorMessage(error), requestId, 400, 'ACHIEVEMENT_CREATE_FAILED')
  }
}
