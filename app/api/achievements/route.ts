import { NextRequest, NextResponse } from 'next/server'
import { createUserClient } from '@/lib/supabase'

type AuthUser = { id: string }

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

function getBearerToken(req: NextRequest) {
  const authHeader = req.headers.get('authorization') || ''
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
}

async function requireAuth(req: NextRequest): Promise<AuthUser | NextResponse> {
  const token = getBearerToken(req)
  if (!token) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createUserClient(token)
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  return { id: user.id }
}

function isValidDate(value: string) {
  return !Number.isNaN(Date.parse(value))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error'
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')

    if (userId && userId !== auth.id) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const supabase = createUserClient(getBearerToken(req)!)
    const { data, error } = await supabase
      .from('achievements')
      .select('*')
      .eq('user_id', auth.id)
      .order('date', { ascending: false })

    if (error) throw error
    return NextResponse.json({ success: true, data })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req)
    if (auth instanceof NextResponse) return auth

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
      return NextResponse.json({ success: false, error: 'title is required' }, { status: 400 })
    }
    if (typeof type !== 'string' || !allowedTypes.has(type)) {
      return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 })
    }
    if (typeof category !== 'string' || !allowedCategories.has(category)) {
      return NextResponse.json({ success: false, error: 'Invalid category' }, { status: 400 })
    }
    if (typeof date !== 'string' || !isValidDate(date)) {
      return NextResponse.json({ success: false, error: 'Invalid date' }, { status: 400 })
    }

    const supabase = createUserClient(getBearerToken(req)!)
    const { data, error } = await supabase
      .from('achievements')
      .insert({
        user_id: auth.id,
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
    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 400 })
  }
}
