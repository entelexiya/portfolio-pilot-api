import { NextRequest } from 'next/server'
import { supabase } from '@/lib/supabase'
import { errorMessage, failure, getRequestId, success } from '@/lib/api-response'
import { logError } from '@/lib/logger'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const requestId = getRequestId(req)
  try {
    const params = await context.params

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', params.id)
      .single()

    if (profileError) throw profileError

    const { data: achievements, error: achievementsError } = await supabase
      .from('achievements')
      .select('*')
      .eq('user_id', params.id)
      .order('date', { ascending: false })

    if (achievementsError) throw achievementsError

    const verifiedCount = achievements.filter(
      (a: { verification_status?: string }) => a.verification_status === 'verified'
    ).length

    const stats = {
      total: achievements.length,
      olympiad: achievements.filter((a: { type: string }) => a.type === 'olympiad').length,
      project: achievements.filter((a: { type: string }) => a.type === 'project').length,
      volunteering: achievements.filter((a: { type: string }) => a.type === 'volunteering').length,
      verified: verifiedCount,
    }

    return success(
      {
        profile,
        achievements,
        stats,
      },
      requestId
    )
  } catch (error: unknown) {
    logError({ event: 'profile_get_failed', requestId, error })
    return failure(errorMessage(error), requestId, 404, 'PROFILE_NOT_FOUND')
  }
}
