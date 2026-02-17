import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabase as supabaseServer } from '@/lib/supabase'

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
    const { token: requestToken, action, comment } = body
    if (!requestToken || !action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'token and action (approve|reject) required' },
        { status: 400 }
      )
    }

    const { data: verificationRequest, error: fetchError } = await supabaseServer
      .from('verification_requests')
      .select('id, verifier_email, verifier_id, status')
      .eq('token', requestToken)
      .single()

    if (fetchError || !verificationRequest) {
      return NextResponse.json({ error: 'Link not found' }, { status: 404 })
    }
    if (verificationRequest.status !== 'pending') {
      return NextResponse.json({ error: 'Link already used' }, { status: 410 })
    }

    const verifierEmail = verificationRequest.verifier_email.toLowerCase()
    const userEmail = (user.email || '').toLowerCase()
    if (userEmail !== verifierEmail) {
      return NextResponse.json(
        {
          error:
            'This link was sent to a different email. Sign in with the email that received the verification request.',
        },
        { status: 403 }
      )
    }

    if (!verificationRequest.verifier_id) {
      await supabaseServer
        .from('verification_requests')
        .update({ verifier_id: user.id })
        .eq('id', verificationRequest.id)
      await supabaseServer.from('profiles').update({ role: 'verifier' }).eq('id', user.id)
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected'
    const { error: updateError } = await supabaseServer
      .from('verification_requests')
      .update({
        status: newStatus,
        verifier_comment: comment || null,
      })
      .eq('id', verificationRequest.id)

    if (updateError) {
      console.error('verification_requests update:', updateError)
      return NextResponse.json({ error: 'Failed to submit' }, { status: 500 })
    }

    return NextResponse.json({ success: true, status: newStatus })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
