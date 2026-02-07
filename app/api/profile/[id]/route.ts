import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET - получить публичный профиль пользователя
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params
    
    // Получаем профиль пользователя
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', params.id)
      .single()

    if (profileError) throw profileError

    // Получаем достижения пользователя
    const { data: achievements, error: achievementsError } = await supabase
      .from('achievements')
      .select('*')
      .eq('user_id', params.id)
      .order('date', { ascending: false })

    if (achievementsError) throw achievementsError

    // Статистика по типам достижений
    const stats = {
      total: achievements.length,
      olympiad: achievements.filter(a => a.type === 'olympiad').length,
      project: achievements.filter(a => a.type === 'project').length,
      volunteering: achievements.filter(a => a.type === 'volunteering').length,
      verified: achievements.filter(a => a.verified).length
    }

    return NextResponse.json({
      success: true,
      data: {
        profile,
        achievements,
        stats
      }
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 404 }
    )
  }
}