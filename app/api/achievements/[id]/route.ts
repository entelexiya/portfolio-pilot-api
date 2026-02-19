import { NextRequest, NextResponse } from 'next/server'
import { createUserClient } from '@/lib/supabase'

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

async function getUserClient(req: NextRequest) {
  const token = getBearerToken(req)
  if (!token) return null

  const supabase = createUserClient(token)
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null
  return { supabase, userId: user.id }
}

function isValidDate(value: string) {
  return !Number.isNaN(Date.parse(value))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error'
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getUserClient(req)
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const params = await context.params
    const { data, error } = await auth.supabase
      .from('achievements')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', auth.userId)
      .single()

    if (error) throw error
    return NextResponse.json({ success: true, data })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 404 })
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getUserClient(req)
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const params = await context.params
    const body = await req.json()
    const payload: Record<string, string | null> = {}

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim()) {
        return NextResponse.json({ success: false, error: 'Invalid title' }, { status: 400 })
      }
      payload.title = body.title.trim()
    }
    if (body.description !== undefined) {
      payload.description = typeof body.description === 'string' ? body.description : null
    }
    if (body.category !== undefined) {
      if (typeof body.category !== 'string' || !allowedCategories.has(body.category)) {
        return NextResponse.json({ success: false, error: 'Invalid category' }, { status: 400 })
      }
      payload.category = body.category
    }
    if (body.type !== undefined) {
      if (typeof body.type !== 'string' || !allowedTypes.has(body.type)) {
        return NextResponse.json({ success: false, error: 'Invalid type' }, { status: 400 })
      }
      payload.type = body.type
    }
    if (body.date !== undefined) {
      if (typeof body.date !== 'string' || !isValidDate(body.date)) {
        return NextResponse.json({ success: false, error: 'Invalid date' }, { status: 400 })
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
      return NextResponse.json({ success: false, error: 'No valid fields to update' }, { status: 400 })
    }

    const { data, error } = await auth.supabase
      .from('achievements')
      .update(payload)
      .eq('id', params.id)
      .eq('user_id', auth.userId)
      .select()
      .single()

    if (error) throw error
    return NextResponse.json({ success: true, data })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 400 })
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getUserClient(req)
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const params = await context.params
    const { error } = await auth.supabase
      .from('achievements')
      .delete()
      .eq('id', params.id)
      .eq('user_id', auth.userId)

    if (error) throw error

    return NextResponse.json({
      success: true,
      message: 'Achievement deleted successfully',
    })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 400 })
  }
}
