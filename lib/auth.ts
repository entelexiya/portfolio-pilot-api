import { NextRequest } from 'next/server'
import { createUserClient } from '@/lib/supabase'
import {
  isOwner as isOwnerUtil,
  parseBearerTokenFromHeader,
} from '@/lib/auth-utils'

export function parseBearerToken(req: NextRequest) {
  return parseBearerTokenFromHeader(req.headers.get('authorization'))
}

export async function getAuthenticatedUser(req: NextRequest) {
  const token = parseBearerToken(req)
  if (!token) return null

  const supabase = createUserClient(token)
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) return null

  return { user, token, supabase }
}

export function isOwner(requestedUserId: string | null, currentUserId: string) {
  return isOwnerUtil(requestedUserId, currentUserId)
}
