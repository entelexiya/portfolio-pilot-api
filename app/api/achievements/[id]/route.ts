import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET - получить одно достижение
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params
    const { data, error } = await supabase
      .from('achievements')
      .select('*')
      .eq('id', params.id)
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 404 }
    )
  }
}

// PATCH - обновить достижение
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params
    const body = await req.json()
    const { title, description, type, date, file_url, verified } = body

    const { data, error } = await supabase
      .from('achievements')
      .update({
        ...(title && { title }),
        ...(description && { description }),
        ...(type && { type }),
        ...(date && { date }),
        ...(file_url !== undefined && { file_url }),
        ...(verified !== undefined && { verified })
      })
      .eq('id', params.id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, data })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 400 }
    )
  }
}

// DELETE - удалить достижение
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params
    const { error } = await supabase
      .from('achievements')
      .delete()
      .eq('id', params.id)

    if (error) throw error

    return NextResponse.json({ 
      success: true, 
      message: 'Achievement deleted successfully' 
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 400 }
    )
  }
}