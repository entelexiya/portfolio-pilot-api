/**
 * The narrative layer.
 *
 * The model is handed a finished diagnosis and asked to put it into words. It is
 * explicitly forbidden from inventing chances, requirements or statistics: every
 * number it may cite is already in the payload, computed by the engine from
 * reference data. If this call fails, the diagnosis is still valid and complete -
 * callers must treat the narrative as optional.
 *
 * Provider-agnostic on purpose. The prompt and the validation live here; only the
 * transport differs per provider, so swapping Claude for Gemini changes one env
 * var and nothing about what the product promises.
 */

import type { Diagnosis } from '@/lib/matching/engine'
import { NarrativeSchema, type Narrative } from '@/lib/ai/narrative-schema'
import { ProviderError, type NarrativeProvider } from '@/lib/ai/providers/types'
import { createGeminiProvider } from '@/lib/ai/providers/gemini'
import { createClaudeProvider } from '@/lib/ai/providers/claude'

export { NarrativeSchema }
export type { Narrative }

/** Raised when no narrative could be produced. Never fatal to a diagnosis. */
export class NarrativeUnavailableError extends Error {}

const SYSTEM = [
  'You are an admissions advisor writing for a high school applicant who has no access to a paid consultant.',
  '',
  'You will receive a COMPUTED diagnosis: band assignments, factor verdicts, portfolio gaps and affordability, all calculated from reference data before you were called.',
  '',
  'Hard rules:',
  '- Never invent or restate a probability, percentage, requirement, deadline, cost or statistic that is not present in the payload. If you want to cite a number, it must already be there.',
  '- Never describe a band as a guarantee. "Safety" means likely, not certain; "dream" means unlikely, not impossible.',
  '- Never say a school has a minimum portfolio. Admission is holistic. Speak in terms of what admitted students typically show.',
  '- If a row is marked unverified in the payload, do not present its figures as established fact - say the figure still needs checking.',
  '- Distinguish failed_requirements (the student has a score and it falls short) from outstanding_tasks (a test not taken yet). Never tell a student they failed something they have not attempted.',
  '- When data_confidence is low, the school published little comparable academic data. Say the reading is less certain; do not imply the student lacks credentials.',
  '- Do not offer to write essays or applications for the student.',
  '',
  'Tone: direct and specific, the way a good mentor talks. Address the student as "you". No flattery, no hedging into uselessness. Name the real problem.',
  '',
  'The headline is the most important line you write, and it is a SENTENCE spoken to the student, not a report title. It must name what the portfolio currently reads like versus what the stated goal needs.',
  'Good: "Your portfolio reads like a community organiser, not the computer scientist you are aiming to be."',
  'Bad: "Rebalancing Portfolio Towards Technical Projects" - that is a heading, not a diagnosis.',
  'Base it strictly on the shape analysis in the payload. If the payload says there is not enough data, say that plainly instead of guessing.',
].join('\n')

/** Strip the diagnosis down to what the model needs, so the prompt stays small. */
function toPayload(diagnosis: Diagnosis) {
  return {
    goal_field: diagnosis.goalField,
    portfolio: {
      verified_achievements: diagnosis.portfolio.verifiedCount,
      unverified_achievements: diagnosis.portfolio.unverifiedCount,
      weighted_total: diagnosis.portfolio.totalWeight,
      by_axis: diagnosis.portfolio.vector,
    },
    shape_analysis: diagnosis.shape.hasEnoughData
      ? {
          enough_data: true,
          over_indexed_on: diagnosis.shape.leaning.map((l) => ({
            area: l.label,
            your_share: Math.round(l.share * 100),
            typical_share: Math.round(l.expectedShare * 100),
          })),
          under_indexed_on: diagnosis.shape.missing.map((m) => ({
            area: m.label,
            your_share: Math.round(m.share * 100),
            typical_share: Math.round(m.expectedShare * 100),
          })),
        }
      : { enough_data: false },
    universities: diagnosis.matches.slice(0, 20).map((m) => ({
      slug: m.slug,
      name: m.name,
      country: m.country,
      band: m.band,
      factors: m.factors.map((f) => ({ area: f.label, verdict: f.verdict, detail: f.detail })),
      portfolio_gaps: m.gaps.slice(0, 4).map((g) => ({ area: g.label, short_by: g.deficit })),
      failed_requirements: m.blockers,
      outstanding_tasks: m.requirements,
      data_confidence: m.confidence,
      money: {
        annual_cost_usd: m.affordability.annualCostUsd,
        typical_aid_usd: m.affordability.expectedAidUsd,
        net_cost_usd: m.affordability.netCostUsd,
        within_budget: m.affordability.affordable,
        shortfall_usd: m.affordability.shortfallUsd,
      },
      deadline: m.deadline,
      data_status: m.provenance.dataStatus,
    })),
  }
}

export type ProviderName = 'gemini' | 'claude'

/**
 * Explicit AI_PROVIDER wins. Otherwise use whichever key is present, preferring
 * Gemini because its free tier is what an unfunded project actually has.
 */
export function resolveProvider(): NarrativeProvider {
  const configured = process.env.AI_PROVIDER?.trim().toLowerCase()

  if (configured === 'gemini') return createGeminiProvider()
  if (configured === 'claude') return createClaudeProvider()
  if (configured) {
    throw new NarrativeUnavailableError(
      `AI_PROVIDER "${configured}" is not recognised (expected "gemini" or "claude")`
    )
  }

  if (process.env.GEMINI_API_KEY) return createGeminiProvider()
  if (process.env.ANTHROPIC_API_KEY) return createClaudeProvider()

  throw new NarrativeUnavailableError(
    'No AI provider configured. Set GEMINI_API_KEY or ANTHROPIC_API_KEY.'
  )
}

export type NarrativeResult = {
  narrative: Narrative
  provider: string
}

export async function generateNarrative(diagnosis: Diagnosis): Promise<NarrativeResult> {
  let provider: NarrativeProvider
  try {
    provider = resolveProvider()
  } catch (error) {
    if (error instanceof NarrativeUnavailableError) throw error
    throw new NarrativeUnavailableError(
      error instanceof ProviderError ? error.message : 'Could not initialise an AI provider'
    )
  }

  let raw: unknown
  try {
    raw = await provider.generateJson({
      system: SYSTEM,
      user: [
        'Here is the computed diagnosis for this applicant. Put it into words following your rules.',
        '',
        JSON.stringify(toPayload(diagnosis), null, 2),
      ].join('\n'),
    })
  } catch (error) {
    throw new NarrativeUnavailableError(
      error instanceof ProviderError || error instanceof Error
        ? `${provider.name}: ${error.message}`
        : `${provider.name}: request failed`
    )
  }

  // One validation path for every provider.
  const parsed = NarrativeSchema.safeParse(raw)
  if (!parsed.success) {
    throw new NarrativeUnavailableError(
      `${provider.name}: output did not match the expected shape (${parsed.error.issues[0]?.path.join('.') || 'unknown field'})`
    )
  }

  // Drop notes for slugs that were not in the payload, so the UI can trust the keys.
  const knownSlugs = new Set(diagnosis.matches.map((m) => m.slug))
  return {
    provider: provider.name,
    narrative: {
      ...parsed.data,
      universityNotes: parsed.data.universityNotes.filter((n) => knownSlugs.has(n.slug)),
    },
  }
}
