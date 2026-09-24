import { NextRequest } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { failure, getRequestId, success } from '@/lib/api-response'
import { applyRateLimitHeaders, checkRateLimitSmart, getClientIp } from '@/lib/rate-limit'
import { logError, logInfo, logWarn } from '@/lib/logger'
import { diagnose, type ProgramProfile, type University } from '@/lib/matching/engine'
import { generateNarrative, NarrativeUnavailableError, type Narrative } from '@/lib/ai/narrative'

const diagnoseRateLimit = {
  limit: 15,
  windowMs: 10 * 60 * 1000,
}

// Must stay a string literal: supabase-js infers the row type from it, and a
// runtime-built string (e.g. via .join) degrades the result to an error type.
const UNIVERSITY_COLUMNS =
  'id, slug, name, country, acceptance_rate, intl_acceptance_rate, gpa_avg, sat_p25, sat_p75, requires_sat, ielts_min, toefl_min, tuition_usd, living_cost_usd, aid_for_intl, avg_aid_usd, deadline_regular, admitted_profile, data_status, source_url, verified_at'

const MAX_UNIVERSITIES = 60

function parseOptionalNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req)
  const ip = getClientIp(req)

  try {
    const auth = await getAuthenticatedUser(req)
    if (!auth) return failure('Unauthorized', requestId, 401, 'UNAUTHORIZED')

    const rate = await checkRateLimitSmart({
      key: `advisor:diagnose:${auth.user.id}:${ip}`,
      limit: diagnoseRateLimit.limit,
      windowMs: diagnoseRateLimit.windowMs,
    })
    if (!rate.allowed) {
      logWarn({
        event: 'advisor_diagnose_rate_limited',
        requestId,
        meta: { userId: auth.user.id, ip },
      })
      const res = failure('Too many requests', requestId, 429, 'RATE_LIMITED')
      return applyRateLimitHeaders(res, diagnoseRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const body = (await req.json().catch(() => ({}))) as {
      goalField?: unknown
      budgetUsd?: unknown
      countries?: unknown
      includeNarrative?: unknown
    }

    const goalField = typeof body.goalField === 'string' ? body.goalField.trim() || null : null
    const budgetUsd = parseOptionalNumber(body.budgetUsd)
    if (budgetUsd !== null && budgetUsd < 0) {
      const res = failure('budgetUsd must not be negative', requestId, 400, 'VALIDATION_ERROR')
      return applyRateLimitHeaders(res, diagnoseRateLimit.limit, rate.remaining, rate.resetAt)
    }
    const countries = Array.isArray(body.countries)
      ? body.countries.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      : []
    const includeNarrative = body.includeNarrative !== false

    // --- The applicant: academic profile + portfolio, read as the user themselves
    const [profileResult, achievementsResult] = await Promise.all([
      auth.supabase
        .from('profiles')
        .select('gpa, sat_score, ielts, toefl')
        .eq('id', auth.user.id)
        .single(),
      auth.supabase
        .from('achievements')
        .select('type, category, verification_status')
        .eq('user_id', auth.user.id),
    ])

    if (profileResult.error) throw profileResult.error
    if (achievementsResult.error) throw achievementsResult.error

    const profile = profileResult.data ?? {}
    const achievements = achievementsResult.data ?? []

    if (achievements.length === 0) {
      const res = failure(
        'Add at least one achievement before running a diagnosis.',
        requestId,
        400,
        'EMPTY_PORTFOLIO'
      )
      return applyRateLimitHeaders(res, diagnoseRateLimit.limit, rate.remaining, rate.resetAt)
    }

    // --- Reference data: public, read with the anon client
    let universityQuery = supabase.from('universities').select(UNIVERSITY_COLUMNS).limit(MAX_UNIVERSITIES)
    if (countries.length > 0) universityQuery = universityQuery.in('country', countries)

    const { data: universities, error: universitiesError } = await universityQuery
    if (universitiesError) throw universitiesError

    if (!universities || universities.length === 0) {
      const res = failure(
        'No universities available for the selected filters.',
        requestId,
        404,
        'NO_UNIVERSITIES'
      )
      return applyRateLimitHeaders(res, diagnoseRateLimit.limit, rate.remaining, rate.resetAt)
    }

    const universityIds = (universities as University[]).map((u) => u.id).filter(Boolean)
    const { data: programProfiles, error: programError } = await supabase
      .from('program_profiles')
      .select('university_id, field, admitted_profile')
      .in('university_id', universityIds)
    if (programError) throw programError

    // --- Deterministic diagnosis. No model involved.
    const applicant = {
      gpa: parseOptionalNumber((profile as Record<string, unknown>).gpa),
      satScore: parseOptionalNumber((profile as Record<string, unknown>).sat_score),
      ielts: parseOptionalNumber((profile as Record<string, unknown>).ielts),
      toefl: parseOptionalNumber((profile as Record<string, unknown>).toefl),
      budgetUsd,
      goalField,
      achievements,
    }

    const diagnosis = diagnose(
      applicant,
      universities as University[],
      (programProfiles ?? []) as ProgramProfile[]
    )

    // --- Optional narrative. A failure here must not fail the request.
    let narrative: Narrative | null = null
    let narrativeError: string | null = null
    let narrativeProvider: string | null = null

    if (includeNarrative) {
      try {
        const result = await generateNarrative(diagnosis)
        narrative = result.narrative
        narrativeProvider = result.provider
      } catch (error: unknown) {
        narrativeError =
          error instanceof NarrativeUnavailableError
            ? error.message
            : 'Narrative generation failed; the diagnosis below is still complete.'
        logWarn({
          event: 'advisor_narrative_failed',
          requestId,
          message: narrativeError,
          meta: { userId: auth.user.id },
          error,
        })
      }
    }

    // --- Persist the run so it can be revisited and compared later.
    const { data: saved, error: saveError } = await auth.supabase
      .from('match_runs')
      .insert({
        user_id: auth.user.id,
        goal_field: goalField,
        budget_usd: budgetUsd,
        input_snapshot: applicant,
        results: diagnosis,
        narrative,
      })
      .select('id, created_at')
      .single()

    if (saveError) {
      // The diagnosis is worth returning even if we could not store it.
      logWarn({
        event: 'advisor_run_persist_failed',
        requestId,
        error: saveError,
        meta: { userId: auth.user.id },
      })
    }

    logInfo({
      event: 'advisor_diagnose_completed',
      requestId,
      meta: {
        userId: auth.user.id,
        universities: diagnosis.matches.length,
        dream: diagnosis.strategyList.dream.length,
        match: diagnosis.strategyList.match.length,
        safety: diagnosis.strategyList.safety.length,
        hasNarrative: narrative !== null,
        narrativeProvider,
      },
    })

    const res = success(
      {
        runId: saved?.id ?? null,
        createdAt: saved?.created_at ?? null,
        diagnosis,
        narrative,
        narrativeError,
        narrativeProvider,
      },
      requestId
    )
    return applyRateLimitHeaders(res, diagnoseRateLimit.limit, rate.remaining, rate.resetAt)
  } catch (error: unknown) {
    logError({ event: 'advisor_diagnose_failed', requestId, error })
    return failure(
      'Could not complete the diagnosis. Please try again.',
      requestId,
      500,
      'ADVISOR_DIAGNOSE_FAILED'
    )
  }
}
