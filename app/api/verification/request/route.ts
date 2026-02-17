import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization')
    const token = authHeader?.replace('Bearer ', '')
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser()
    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { achievementId, verifierEmail, verificationLink, message } = body
    if (!achievementId || !verifierEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifierEmail)) {
      return NextResponse.json(
        { error: 'achievementId and valid verifierEmail are required' },
        { status: 400 }
      )
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    const { data: achievement, error: achError } = await supabase
      .from('achievements')
      .select('id, user_id')
      .eq('id', achievementId)
      .single()

    if (achError || !achievement || achievement.user_id !== user.id) {
      return NextResponse.json({ error: 'Achievement not found or not yours' }, { status: 404 })
    }

    const requestToken = randomUUID()
    const { error: insertError } = await supabase.from('verification_requests').insert({
      achievement_id: achievementId,
      student_id: user.id,
      verifier_email: verifierEmail.trim().toLowerCase(),
      message: message || null,
      status: 'pending',
      token: requestToken,
    })

    if (insertError) {
      console.error('verification_requests insert:', insertError)
      return NextResponse.json({ error: 'Failed to create verification request' }, { status: 500 })
    }

    if (verificationLink) {
      await supabase
        .from('achievements')
        .update({ verification_link: verificationLink })
        .eq('id', achievementId)
    }

    // Ссылка должна вести на ФРОНТ (страница /verify/[token]), не на API. Обязательно задайте NEXT_PUBLIC_APP_URL в бэкенде.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      console.warn('NEXT_PUBLIC_APP_URL not set: verification link will point to API and return 404. Set it to your frontend URL (e.g. https://portfolio-pilot.vercel.app).')
    }
    const verifyUrl = `${baseUrl.replace(/\/$/, '')}/verify/${requestToken}`

    if (process.env.RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || 'PortfolioPilot <onboarding@resend.dev>',
          to: [verifierEmail.trim()],
          subject: 'Verify a student achievement on PortfolioPilot',
          html: `
            <p>A student asked you to confirm their achievement on PortfolioPilot.</p>
            <p><strong>Click the link below to sign in and verify:</strong></p>
            <p><a href="${verifyUrl}">${verifyUrl}</a></p>
            <p>This link is single-use. If you don't have an account, you'll get one when you click.</p>
          `,
        }),
      })
      if (!res.ok) {
        const err = await res.text()
        console.error('Resend error:', err)
      }
    } else {
      console.log('[Dev] Verification email would go to:', verifierEmail, 'Link:', verifyUrl)
    }

    return NextResponse.json({ success: true, verifyUrl })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

