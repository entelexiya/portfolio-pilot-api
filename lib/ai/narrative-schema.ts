import { z } from 'zod'

/**
 * The single source of truth for the narrative shape.
 *
 * Every provider's output is validated against this, whatever schema mechanism
 * the provider itself used. Lives in its own module so the Claude provider can
 * import it without pulling in the Gemini provider or the prompt.
 */
export const NarrativeSchema = z.object({
  /** The one-line diagnosis: what the portfolio currently reads like. */
  headline: z.string(),
  /** 2-4 sentences expanding the headline. */
  summary: z.string(),
  /** What is already working, phrased so the student can repeat it. */
  strengths: z.array(z.string()),
  /** The gaps, in the student's own terms rather than axis names. */
  gaps: z.array(z.string()),
  /** Concrete next steps, most urgent first. */
  actionPlan: z.array(
    z.object({
      action: z.string(),
      why: z.string(),
      horizon: z.enum(['this_month', 'this_semester', 'this_year']),
    })
  ),
  /** Per-university notes, keyed by the slug given in the payload. */
  universityNotes: z.array(
    z.object({
      slug: z.string(),
      note: z.string(),
    })
  ),
})

export type Narrative = z.infer<typeof NarrativeSchema>
