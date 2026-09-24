/**
 * Gemini provider, over the REST API.
 *
 * Deliberately uses `fetch` rather than an SDK: the request shape here was
 * verified against the live endpoint, and the dependency buys nothing for a
 * single JSON call.
 *
 * The free tier drives the retry design. Probing six flash models in one second
 * returned three 503s and three 200s, and the set that fails changes minute to
 * minute - so we walk a chain of models AND retry each one, while refusing to
 * retry anything that will not improve (bad key, exhausted quota, bad output).
 */

import { ProviderError, type NarrativeProvider } from './types'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Tried in order. Overridable via GEMINI_MODEL (comma-separated).
 * Note: gemini-2.5-flash is rejected outright for keys created after its
 * deprecation, so it is deliberately absent.
 */
const DEFAULT_MODELS = [
  'gemini-3.6-flash',
  'gemini-3-flash-preview',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
]

/** Attempts per model before moving on, and the pause between them. */
const ATTEMPTS_PER_MODEL = 2
const RETRY_DELAY_MS = 700

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Gemini's responseSchema is an OpenAPI subset - no $ref, no unions. It must
 * mirror NarrativeSchema in ../narrative-schema.ts; zod still validates the
 * result, so drift here surfaces as a validation failure rather than bad data
 * reaching the UI.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    summary: { type: 'string' },
    strengths: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    actionPlan: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          why: { type: 'string' },
          horizon: { type: 'string', enum: ['this_month', 'this_semester', 'this_year'] },
        },
        required: ['action', 'why', 'horizon'],
        propertyOrdering: ['action', 'why', 'horizon'],
      },
    },
    universityNotes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['slug', 'note'],
        propertyOrdering: ['slug', 'note'],
      },
    },
  },
  required: ['headline', 'summary', 'strengths', 'gaps', 'actionPlan', 'universityNotes'],
  propertyOrdering: ['headline', 'summary', 'strengths', 'gaps', 'actionPlan', 'universityNotes'],
} as const

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  error?: { code?: number; message?: string; status?: string }
}

function models() {
  const configured = process.env.GEMINI_MODEL
  if (!configured) return DEFAULT_MODELS
  const list = configured
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean)
  return list.length > 0 ? list : DEFAULT_MODELS
}

function classifyStatus(status: number) {
  if (status === 503 || status === 500 || status === 504) return 'transient' as const
  // Per-model quota: another model in the chain may still have budget.
  if (status === 429 || status === 404) return 'model' as const
  return 'fatal' as const
}

async function callModel(model: string, apiKey: string, system: string, user: string) {
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    }),
    cache: 'no-store',
  })

  const payload = (await res.json().catch(() => null)) as GeminiResponse | null

  if (!res.ok) {
    const message = payload?.error?.message || `request failed with status ${res.status}`
    throw new ProviderError(`${model}: ${message}`, { kind: classifyStatus(res.status) })
  }

  const candidate = payload?.candidates?.[0]
  const text = (candidate?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim()

  if (!text) {
    const reason = candidate?.finishReason
    // Truncation means the answer was too long, not that the model is unwell.
    throw new ProviderError(`${model}: empty response${reason ? ` (finishReason: ${reason})` : ''}`, {
      kind: reason === 'MAX_TOKENS' ? 'fatal' : 'transient',
    })
  }

  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new ProviderError(`${model}: response was not valid JSON`, { kind: 'fatal', cause: error })
  }
}

export function createGeminiProvider(): NarrativeProvider {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new ProviderError('GEMINI_API_KEY is not configured')
  }

  const chain = models()

  return {
    name: `gemini:${chain[0]}`,
    async generateJson({ system, user }) {
      const failures: string[] = []

      for (const model of chain) {
        for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt += 1) {
          try {
            return await callModel(model, apiKey, system, user)
          } catch (error) {
            const kind = error instanceof ProviderError ? error.kind : 'transient'
            failures.push(error instanceof ProviderError ? error.message : String(error))

            if (kind === 'fatal') {
              throw new ProviderError(`Gemini gave up -> ${failures.join(' | ')}`, { kind: 'fatal' })
            }
            if (kind === 'model') break // next model, no point retrying this one
            if (attempt < ATTEMPTS_PER_MODEL) await sleep(RETRY_DELAY_MS)
          }
        }
      }

      throw new ProviderError(
        `Gemini failed on all ${chain.length} models tried -> ${failures.join(' | ')}`,
        { kind: 'transient' }
      )
    },
  }
}
