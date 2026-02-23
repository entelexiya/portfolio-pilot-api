import { NextRequest } from 'next/server'
import { getAuthenticatedUser } from '@/lib/auth'
import { errorMessage, failure, getRequestId, success } from '@/lib/api-response'
import { logError } from '@/lib/logger'
import { applyRateLimitHeaders, checkRateLimitSmart, getClientIp } from '@/lib/rate-limit'

type InputAchievement = {
  title?: string
  description?: string
  category?: string
  type?: string
  verification_status?: string
}

type AdvisorResponse = {
  portfolio_score: number
  profile_summary: string
  suggested_majors: string[]
  strengths: string[]
  gaps: string[]
  action_plan: string[]
}

function clampScore(value: unknown) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

function parseJsonObject(text: string) {
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last === -1 || last <= first) return null
  const slice = text.slice(first, last + 1)
  try {
    return JSON.parse(slice) as Record<string, unknown>
  } catch {
    return null
  }
}

function asStringArray(value: unknown, max = 6) {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean)
    .slice(0, max)
}

function normalizeAdvisorPayload(raw: Record<string, unknown> | null): AdvisorResponse {
  if (!raw) {
    return {
      portfolio_score: 0,
      profile_summary: 'No AI output available.',
      suggested_majors: [],
      strengths: [],
      gaps: [],
      action_plan: [],
    }
  }

  const summary =
    typeof raw.profile_summary === 'string'
      ? raw.profile_summary.trim()
      : 'AI advisor generated an incomplete response.'

  return {
    portfolio_score: clampScore(raw.portfolio_score),
    profile_summary: summary,
    suggested_majors: asStringArray(raw.suggested_majors, 5),
    strengths: asStringArray(raw.strengths, 6),
    gaps: asStringArray(raw.gaps, 6),
    action_plan: asStringArray(raw.action_plan, 6),
  }
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req)

  try {
    const auth = await getAuthenticatedUser(req)
    if (!auth) return failure('Unauthorized', requestId, 401, 'UNAUTHORIZED')

    const ip = getClientIp(req)
    const limit = 12
    const rl = await checkRateLimitSmart({
      key: `ai:advisor:${auth.user.id}:${ip}`,
      limit,
      windowMs: 60_000,
    })
    if (!rl.allowed) {
      const res = failure('Too many AI requests. Try again in a minute.', requestId, 429, 'RATE_LIMITED')
      return applyRateLimitHeaders(res, limit, rl.remaining, rl.resetAt)
    }

    const body = (await req.json()) as {
      achievements?: InputAchievement[]
      goalMajor?: string
      gpa?: number | null
      satScore?: number | null
    }

    const achievements = Array.isArray(body?.achievements) ? body.achievements.slice(0, 60) : []
    const goalMajor = typeof body?.goalMajor === 'string' ? body.goalMajor.trim() : ''
    const gpa = typeof body?.gpa === 'number' ? body.gpa : null
    const satScore = typeof body?.satScore === 'number' ? body.satScore : null

    const openAiKey = process.env.OPENAI_API_KEY
    if (!openAiKey) {
      const res = failure('OPENAI_API_KEY is required', requestId, 503, 'OPENAI_NOT_CONFIGURED')
      return applyRateLimitHeaders(res, limit, rl.remaining, rl.resetAt)
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini'

    const system = [
      'You are a strict but supportive academic portfolio advisor for university admissions.',
      'Return only valid JSON with keys:',
      'portfolio_score (0-100), profile_summary (string), suggested_majors (array of strings), strengths (array), gaps (array), action_plan (array).',
      'Action plan must be practical and specific for a high school student.',
      'If goal major is given, tailor recommendations directly to that goal.',
    ].join(' ')

    const compactAchievements = achievements.map((a) => ({
      title: (a.title || '').slice(0, 120),
      description: (a.description || '').slice(0, 220),
      category: a.category || '',
      type: a.type || '',
      verification_status: a.verification_status || '',
    }))

    const userPrompt = JSON.stringify(
      {
        student_profile: {
          goal_major: goalMajor || null,
          gpa,
          sat_score: satScore,
        },
        achievements: compactAchievements,
      },
      null,
      2
    )

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_output_tokens: 900,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: system }] },
          { role: 'user', content: [{ type: 'input_text', text: userPrompt }] },
        ],
      }),
      cache: 'no-store',
    })

    const raw = await response.json()
    if (!response.ok) {
      const message =
        (raw as { error?: { message?: string } })?.error?.message || `OpenAI request failed with status ${response.status}`
      throw new Error(message)
    }

    const outputText = (raw as { output_text?: string }).output_text || ''
    const parsed = parseJsonObject(outputText)
    const advisor = normalizeAdvisorPayload(parsed)

    const res = success(advisor, requestId)
    return applyRateLimitHeaders(res, limit, rl.remaining, rl.resetAt)
  } catch (error: unknown) {
    logError({ event: 'ai_advisor_failed', requestId, error })
    return failure(errorMessage(error), requestId, 400, 'AI_ADVISOR_FAILED')
  }
}

