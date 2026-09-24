export function parseBearerTokenFromHeader(authHeader: string | null) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

export function isOwner(requestedUserId: string | null, currentUserId: string) {
  if (!requestedUserId) return true
  return requestedUserId === currentUserId
}
