import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token')
    if (!token) {
      return NextResponse.json({ error: 'Token required' }, { status: 400 })
    }

    const { data: request, error: reqError } = await supabase
      .from('verification_requests')
      .select('id, achievement_id, student_id, verifier_email, status, created_at')
      .eq('token', token)
      .single()

    if (reqError || !request) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    }
    if (request.status !== 'pending') {
      return NextResponse.json(
        { error: 'Link already used', status: request.status },
        { status: 410 }
      )
    }

    const { data: achievement, error: achError } = await supabase
      .from('achievements')
      .select('id, title, description, date, verification_link, file_url, category, type')
      .eq('id', request.achievement_id)
      .single()

    if (achError || !achievement) {
      return NextResponse.json({ error: 'Achievement not found' }, { status: 404 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', request.student_id)
      .single()

    return NextResponse.json({
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
    })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
