import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase clients for the API.
 *
 * Nothing is validated or constructed at module load. This module throwing at
 * import time failed the production build rather than any request: Next collects
 * page data for every route during `next build`, which evaluates each route's
 * module graph, so a missing variable surfaced as
 *
 *   Error: Supabase environment variables are missing
 *   Failed to collect page data for /api/achievements/[id]
 *
 * with a stack pointing into a minified chunk instead of at the configuration.
 *
 * Validation now happens when a client is actually needed, so a misconfigured
 * deployment builds and then fails per-request with a message that names the
 * missing variable - which is the difference between a broken deploy you can
 * read and one you cannot.
 */

function required(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set. Add it to the API's environment and redeploy.`)
  }
  return value
}

let cachedAnon: SupabaseClient | null = null

function anonClient(): SupabaseClient {
  if (!cachedAnon) {
    cachedAnon = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('NEXT_PUBLIC_SUPABASE_ANON_KEY'))
  }
  return cachedAnon
}

/**
 * Anonymous client, for public reference data (RLS still applies). Behaves like a
 * SupabaseClient but is constructed on first property access; methods are bound
 * to the real instance so `this` stays correct.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const real = anonClient()
    const value = Reflect.get(real, property, real)
    return typeof value === 'function' ? value.bind(real) : value
  },
  has(_target, property) {
    return property in anonClient()
  },
})

/** Client acting as the calling user, so RLS policies apply to them. */
export function createUserClient(accessToken: string) {
  return createClient(
    required('NEXT_PUBLIC_SUPABASE_URL'),
    required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
  )
}

/** Service-role client. Bypasses RLS - server only, never expose the key. */
export function createServiceClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. Add it to the API environment and redeploy.'
    )
  }
  return createClient(required('NEXT_PUBLIC_SUPABASE_URL'), serviceRoleKey)
}
