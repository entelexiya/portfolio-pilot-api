import { NextRequest, NextResponse } from 'next/server'
import { createUserClient } from '@/lib/supabase'

const maxFileSizeBytes = 5 * 1024 * 1024
const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error'
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getUserClient(req)
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'File is required' }, { status: 400 })
    }
    if (file.size > maxFileSizeBytes) {
      return NextResponse.json({ success: false, error: 'File is too large' }, { status: 400 })
    }
    if (!allowedMimeTypes.has(file.type)) {
      return NextResponse.json({ success: false, error: 'Unsupported file type' }, { status: 400 })
    }

    const fileExt = file.name.split('.').pop() || 'bin'
    const fileName = `${auth.userId}/${Date.now()}.${fileExt}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { data, error } = await auth.supabase.storage
      .from('achievements')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (error) throw error

    const { data: urlData } = auth.supabase.storage.from('achievements').getPublicUrl(fileName)

    return NextResponse.json({
      success: true,
      data: {
        path: data.path,
        url: urlData.publicUrl,
      },
    })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await getUserClient(req)
    if (!auth) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const filePath = searchParams.get('path')

    if (!filePath) {
      return NextResponse.json({ success: false, error: 'path is required' }, { status: 400 })
    }
    if (!filePath.startsWith(`${auth.userId}/`)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const { error } = await auth.supabase.storage.from('achievements').remove([filePath])
    if (error) throw error

    return NextResponse.json({
      success: true,
      message: 'File deleted successfully',
    })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 400 })
  }
}
