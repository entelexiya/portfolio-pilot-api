import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET - получить все достижения пользователя
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')

    let query = supabase
      .from('achievements')
      .select('*')
      .order('date', { ascending: false })

    // Если передан userId, фильтруем по нему
    if (userId) {
      query = query.eq('user_id', userId)
    }

    const { data, error } = await query

    if (error) throw error

    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 400 }
    )
  }
}

// POST - создать новое достижение
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { user_id, title, description, type, date, file_url } = body

    // Валидация
    if (!user_id || !title || !type) {
      return NextResponse.json(
        { success: false, error: 'user_id, title и type обязательны' },
        { status: 400 }
      )
    }

    const { data, error } = await supabase
      .from('achievements')
      .insert({
        user_id,
        title,
        description,
        type,
        date,
        file_url,
        verified: false
      })
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 400 }
    )
  }
}