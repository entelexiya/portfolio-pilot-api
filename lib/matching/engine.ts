/**
 * Deterministic admission matching engine.
 *
 * Everything in this file is pure arithmetic over reference data. No LLM is
 * involved: the model is handed the output of `diagnose()` and only puts it into
 * words. That split is deliberate - a chance figure an LLM invents cannot be
 * defended, and a gap analysis it invents cannot be acted on.
 *
 * Self-contained on purpose (no imports): the test runner loads it directly via
 * `node --test --experimental-strip-types`, which needs explicit file extensions
 * on any relative import.
 */

// -----------------------------------------------------------------------------
// Achievement axes - the same taxonomy the achievements table uses
// -----------------------------------------------------------------------------

export const ACHIEVEMENT_TYPES = [
  'olympiad',
  'competition',
  'award_other',
  'project',
  'research',
  'internship',
  'volunteering',
  'leadership',
  'club',
  'activity_other',
] as const

export type AchievementType = (typeof ACHIEVEMENT_TYPES)[number]

/** Human labels, used in the factor/gap text handed to the UI and the model. */
export const AXIS_LABELS: Record<AchievementType, string> = {
  olympiad: 'olympiads',
  competition: 'competitions',
  award_other: 'other awards',
  project: 'projects',
  research: 'research',
  internship: 'internships',
  volunteering: 'volunteering',
  leadership: 'leadership',
  club: 'clubs',
  activity_other: 'other activities',
}

export type ProfileVector = Record<AchievementType, number>

/**
 * How much a single achievement contributes, by verification state.
 * A teacher-confirmed achievement is worth strictly more than a claimed one -
 * that is the whole point of the verification layer.
 */
const VERIFICATION_WEIGHT: Record<string, number> = {
  verified: 1,
  pending: 0.6,
  unverified: 0.5,
  rejected: 0,
}

// -----------------------------------------------------------------------------
// Inputs
// -----------------------------------------------------------------------------

export type ApplicantAchievement = {
  type?: string | null
  verification_status?: string | null
}

export type Applicant = {
  gpa?: number | null
  satScore?: number | null
  ielts?: number | null
  toefl?: number | null
  /** Annual amount the family can actually pay, USD. */
  budgetUsd?: number | null
  goalField?: string | null
  achievements?: ApplicantAchievement[] | null
}

export type University = {
  id?: string
  slug: string
  name: string
  country: string
  acceptance_rate?: number | null
  intl_acceptance_rate?: number | null
  gpa_avg?: number | null
  sat_p25?: number | null
  sat_p75?: number | null
  requires_sat?: boolean | null
  ielts_min?: number | null
  toefl_min?: number | null
  tuition_usd?: number | null
  living_cost_usd?: number | null
  aid_for_intl?: boolean | null
  avg_aid_usd?: number | null
  deadline_regular?: string | null
  admitted_profile?: Partial<Record<string, number>> | null
  data_status?: string | null
  source_url?: string | null
  verified_at?: string | null
}

export type ProgramProfile = {
  university_id?: string
  field: string
  admitted_profile?: Partial<Record<string, number>> | null
}

// -----------------------------------------------------------------------------
// Outputs
// -----------------------------------------------------------------------------

export type Band = 'dream' | 'match' | 'safety'

export type FactorVerdict = 'above' | 'in_range' | 'below' | 'unknown'

export type Factor = {
  key: 'gpa' | 'sat' | 'language' | 'portfolio'
  label: string
  verdict: FactorVerdict
  detail: string
}

export type AxisGap = {
  axis: AchievementType
  label: string
  expected: number
  actual: number
  deficit: number
}

export type Affordability = {
  annualCostUsd: number | null
  expectedAidUsd: number
  netCostUsd: number | null
  /** null when the applicant gave no budget. */
  affordable: boolean | null
  shortfallUsd: number | null
}

export type DeadlineStatus = {
  date: string | null
  daysLeft: number | null
  status: 'passed' | 'urgent' | 'open' | 'unknown'
}

/**
 * How much of the picture we actually had. Driven by how many academic signals
 * were comparable, not by how good the applicant is.
 */
export type Confidence = 'high' | 'partial' | 'low'

export type UniversityMatch = {
  slug: string
  name: string
  country: string
  band: Band
  /** 0-100, admission fit before selectivity. Not a probability. */
  admissionFit: number
  /** 0-100 after the selectivity penalty. Drives the band. */
  adjustedFit: number
  /** Surface this in the UI: a `low` reading is a data gap, not a verdict. */
  confidence: Confidence
  factors: Factor[]
  gaps: AxisGap[]
  affordability: Affordability
  deadline: DeadlineStatus
  /**
   * Requirements the applicant demonstrably FAILS - they have a score and it is
   * below the published minimum. These force the school into `dream`.
   */
  blockers: string[]
  /**
   * Requirements not yet satisfied because the applicant has not taken the test
   * yet. Not a failure: this is the to-do list. Deliberately kept separate from
   * `blockers` so "hasn't sat IELTS in September" does not read the same as
   * "scored 5.5 against a 7.0 minimum".
   */
  requirements: string[]
  provenance: {
    dataStatus: string
    sourceUrl: string | null
    verifiedAt: string | null
  }
}

export type ShapeDiagnosis = {
  /** Axes the portfolio over-indexes on relative to the target. */
  leaning: Array<{ axis: AchievementType; label: string; share: number; expectedShare: number }>
  /** Axes the portfolio under-indexes on relative to the target. */
  missing: Array<{ axis: AchievementType; label: string; share: number; expectedShare: number }>
  /** False when there is too little portfolio data to say anything. */
  hasEnoughData: boolean
}

export type Diagnosis = {
  goalField: string | null
  portfolio: {
    vector: ProfileVector
    totalWeight: number
    verifiedCount: number
    unverifiedCount: number
  }
  shape: ShapeDiagnosis
  matches: UniversityMatch[]
  strategyList: {
    dream: string[]
    match: string[]
    safety: string[]
  }
}

// -----------------------------------------------------------------------------
// Vector helpers
// -----------------------------------------------------------------------------

export function emptyVector(): ProfileVector {
  const v = {} as ProfileVector
  for (const t of ACHIEVEMENT_TYPES) v[t] = 0
  return v
}

function isAchievementType(value: unknown): value is AchievementType {
  return typeof value === 'string' && (ACHIEVEMENT_TYPES as readonly string[]).includes(value)
}

/** Coerce an arbitrary jsonb blob into a well-formed, non-negative vector. */
export function toVector(raw: Partial<Record<string, number>> | null | undefined): ProfileVector {
  const v = emptyVector()
  if (!raw) return v
  for (const [key, value] of Object.entries(raw)) {
    if (!isAchievementType(key)) continue
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n) || n < 0) continue
    v[key] = n
  }
  return v
}

/** Weighted portfolio vector: verified achievements count for more. */
export function buildPortfolioVector(achievements: ApplicantAchievement[] | null | undefined) {
  const vector = emptyVector()
  let verifiedCount = 0
  let unverifiedCount = 0

  for (const a of achievements ?? []) {
    if (!isAchievementType(a?.type)) continue
    const status = a.verification_status ?? 'unverified'
    const weight = VERIFICATION_WEIGHT[status] ?? VERIFICATION_WEIGHT.unverified
    vector[a.type] += weight
    if (status === 'verified') verifiedCount += 1
    else if (status !== 'rejected') unverifiedCount += 1
  }

  const totalWeight = ACHIEVEMENT_TYPES.reduce((sum, t) => sum + vector[t], 0)
  return { vector, totalWeight, verifiedCount, unverifiedCount }
}

function vectorSum(v: ProfileVector) {
  return ACHIEVEMENT_TYPES.reduce((sum, t) => sum + v[t], 0)
}

/** Pick the field-specific expected profile when we have one, else the school default. */
export function pickExpectedProfile(
  university: University,
  programProfiles: ProgramProfile[] | null | undefined,
  goalField: string | null | undefined
): ProfileVector {
  if (goalField) {
    const wanted = goalField.trim().toLowerCase()
    const hit = (programProfiles ?? []).find(
      (p) =>
        (!p.university_id || !university.id || p.university_id === university.id) &&
        p.field.trim().toLowerCase() === wanted
    )
    if (hit) {
      const v = toVector(hit.admitted_profile)
      if (vectorSum(v) > 0) return v
    }
  }
  return toVector(university.admitted_profile)
}

// -----------------------------------------------------------------------------
// Portfolio coverage and shape
// -----------------------------------------------------------------------------

export function coverage(actual: ProfileVector, expected: ProfileVector) {
  const expectedTotal = vectorSum(expected)
  if (expectedTotal <= 0) return { score: 1, gaps: [] as AxisGap[] }

  const gaps: AxisGap[] = []
  let deficitTotal = 0

  for (const axis of ACHIEVEMENT_TYPES) {
    const exp = expected[axis]
    if (exp <= 0) continue
    const act = actual[axis]
    const deficit = Math.max(0, exp - act)
    deficitTotal += deficit
    if (deficit > 0) {
      gaps.push({ axis, label: AXIS_LABELS[axis], expected: exp, actual: act, deficit })
    }
  }

  gaps.sort((a, b) => b.deficit - a.deficit)
  return { score: clamp01(1 - deficitTotal / expectedTotal), gaps }
}

/**
 * Where the portfolio leans versus where the target expects weight.
 * This is what produces "your portfolio reads like X, not the Y you are aiming at".
 */
export function diagnoseShape(actual: ProfileVector, expected: ProfileVector): ShapeDiagnosis {
  const actualTotal = vectorSum(actual)
  const expectedTotal = vectorSum(expected)

  // Below ~2 weighted achievements there is no shape to speak of, only noise.
  if (actualTotal < 2 || expectedTotal <= 0) {
    return { leaning: [], missing: [], hasEnoughData: false }
  }

  const deltas = ACHIEVEMENT_TYPES.map((axis) => {
    const share = actual[axis] / actualTotal
    const expectedShare = expected[axis] / expectedTotal
    return { axis, label: AXIS_LABELS[axis], share, expectedShare, delta: share - expectedShare }
  })

  const significant = 0.08 // 8 percentage points of portfolio weight

  return {
    leaning: deltas
      .filter((d) => d.delta >= significant)
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3)
      .map(({ axis, label, share, expectedShare }) => ({ axis, label, share, expectedShare })),
    missing: deltas
      .filter((d) => d.delta <= -significant)
      .sort((a, b) => a.delta - b.delta)
      .slice(0, 3)
      .map(({ axis, label, share, expectedShare }) => ({ axis, label, share, expectedShare })),
    hasEnoughData: true,
  }
}

// -----------------------------------------------------------------------------
// Per-university scoring
// -----------------------------------------------------------------------------

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

/**
 * Treat a non-positive test score as absent.
 *
 * Real profiles contain `ielts: 0` and `sat_score: 0` from empty form fields, and
 * no such score exists (IELTS runs 1-9, SAT from 400). Without this, a zero reads
 * as "has a score, and it is below the minimum" and turns an unfilled field into
 * a hard blocker on every school.
 */
function validScore(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/** Applicant with junk test values normalised away. */
function normalizeApplicant(applicant: Applicant): Applicant {
  return {
    ...applicant,
    gpa: validScore(applicant.gpa),
    satScore: validScore(applicant.satScore),
    ielts: validScore(applicant.ielts),
    toefl: validScore(applicant.toefl),
  }
}

function round(n: number) {
  return Math.round(n * 10) / 10
}

function scoreGpa(applicant: Applicant, uni: University) {
  if (typeof applicant.gpa !== 'number' || typeof uni.gpa_avg !== 'number') {
    return {
      score: null as number | null,
      factor: {
        key: 'gpa' as const,
        label: 'GPA',
        verdict: 'unknown' as FactorVerdict,
        detail:
          typeof applicant.gpa !== 'number'
            ? 'No GPA on your profile yet.'
            : 'No GPA data for this school yet.',
      },
    }
  }

  const delta = applicant.gpa - uni.gpa_avg
  // +-0.4 GPA around the admitted average spans the usable range.
  const score = clamp01(0.5 + delta / 0.8)
  const verdict: FactorVerdict = delta >= 0.05 ? 'above' : delta >= -0.15 ? 'in_range' : 'below'
  const comparison = verdict === 'above' ? 'above' : verdict === 'in_range' ? 'in line with' : 'below'

  return {
    score,
    factor: {
      key: 'gpa' as const,
      label: 'GPA',
      verdict,
      detail: `Your ${applicant.gpa.toFixed(2)} is ${comparison} the ${uni.gpa_avg.toFixed(2)} average of admitted students.`,
    },
  }
}

function scoreSat(applicant: Applicant, uni: University) {
  const hasRange = typeof uni.sat_p25 === 'number' && typeof uni.sat_p75 === 'number'

  if (typeof applicant.satScore !== 'number' || !hasRange) {
    const detail = !hasRange
      ? 'No SAT range published for this school.'
      : uni.requires_sat
        ? 'This school requires the SAT and you have no score yet.'
        : 'No SAT score yet (this school does not require it).'
    return {
      score: null as number | null,
      factor: {
        key: 'sat' as const,
        label: 'SAT',
        verdict: 'unknown' as FactorVerdict,
        detail,
      },
    }
  }

  const p25 = uni.sat_p25 as number
  const p75 = uni.sat_p75 as number
  const span = Math.max(1, p75 - p25)
  const position = (applicant.satScore - p25) / span
  const score = clamp01(0.25 + position * 0.6)
  const verdict: FactorVerdict = position >= 1 ? 'above' : position >= 0 ? 'in_range' : 'below'
  const detail =
    verdict === 'above'
      ? `Your ${applicant.satScore} is at or above the 75th percentile (${p75}).`
      : verdict === 'in_range'
        ? `Your ${applicant.satScore} sits inside the middle 50% (${p25}-${p75}).`
        : `Your ${applicant.satScore} is below the 25th percentile (${p25}).`

  return { score, factor: { key: 'sat' as const, label: 'SAT', verdict, detail } }
}

/**
 * Language minimums are real gates - but only a score that FALLS SHORT is a
 * failure. Not having sat the test yet is a task, not a verdict, and conflating
 * the two would put every school out of reach for any applicant who has not
 * taken IELTS yet.
 */
function checkLanguage(applicant: Applicant, uni: University) {
  const needsIelts = typeof uni.ielts_min === 'number'
  const needsToefl = typeof uni.toefl_min === 'number'

  const none = { blocker: null as string | null, requirement: null as string | null }

  if (!needsIelts && !needsToefl) {
    return {
      factor: {
        key: 'language' as const,
        label: 'English',
        verdict: 'unknown' as FactorVerdict,
        detail: 'No language minimum recorded for this school.',
      },
      ...none,
    }
  }

  const ieltsOk = needsIelts && typeof applicant.ielts === 'number' && applicant.ielts >= (uni.ielts_min as number)
  const toeflOk = needsToefl && typeof applicant.toefl === 'number' && applicant.toefl >= (uni.toefl_min as number)

  if (ieltsOk || toeflOk) {
    const which = ieltsOk ? `IELTS ${applicant.ielts}` : `TOEFL ${applicant.toefl}`
    return {
      factor: {
        key: 'language' as const,
        label: 'English',
        verdict: 'in_range' as FactorVerdict,
        detail: `${which} meets the requirement.`,
      },
      ...none,
    }
  }

  const needed = [
    needsIelts ? `IELTS ${uni.ielts_min}` : null,
    needsToefl ? `TOEFL ${uni.toefl_min}` : null,
  ]
    .filter(Boolean)
    .join(' or ')

  // Only count a score the school actually asks for.
  const hasRelevantScore =
    (needsIelts && typeof applicant.ielts === 'number') ||
    (needsToefl && typeof applicant.toefl === 'number')

  if (hasRelevantScore) {
    const detail = `Your score is below the required ${needed}.`
    return {
      factor: { key: 'language' as const, label: 'English', verdict: 'below' as FactorVerdict, detail },
      blocker: detail,
      requirement: null,
    }
  }

  const detail = `Needs ${needed}. You have not recorded a score yet.`
  return {
    factor: { key: 'language' as const, label: 'English', verdict: 'unknown' as FactorVerdict, detail },
    blocker: null,
    requirement: detail,
  }
}

function assessAffordability(applicant: Applicant, uni: University): Affordability {
  const tuition = typeof uni.tuition_usd === 'number' ? uni.tuition_usd : null
  const living = typeof uni.living_cost_usd === 'number' ? uni.living_cost_usd : 0
  const annualCostUsd = tuition === null ? null : tuition + living

  const expectedAidUsd = uni.aid_for_intl && typeof uni.avg_aid_usd === 'number' ? uni.avg_aid_usd : 0
  const netCostUsd = annualCostUsd === null ? null : Math.max(0, annualCostUsd - expectedAidUsd)

  if (netCostUsd === null || typeof applicant.budgetUsd !== 'number') {
    return { annualCostUsd, expectedAidUsd, netCostUsd, affordable: null, shortfallUsd: null }
  }

  const shortfall = netCostUsd - applicant.budgetUsd
  return {
    annualCostUsd,
    expectedAidUsd,
    netCostUsd,
    affordable: shortfall <= 0,
    shortfallUsd: shortfall > 0 ? shortfall : 0,
  }
}

function assessDeadline(uni: University, now: Date): DeadlineStatus {
  if (!uni.deadline_regular) return { date: null, daysLeft: null, status: 'unknown' }

  const deadline = new Date(`${uni.deadline_regular}T00:00:00Z`)
  if (Number.isNaN(deadline.getTime())) return { date: null, daysLeft: null, status: 'unknown' }

  const msPerDay = 24 * 60 * 60 * 1000
  const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / msPerDay)
  const status: DeadlineStatus['status'] = daysLeft < 0 ? 'passed' : daysLeft <= 30 ? 'urgent' : 'open'

  return { date: uni.deadline_regular, daysLeft, status }
}

/**
 * Selectivity penalty. A perfect academic profile is still a reach at a school
 * that turns away 96% of applicants, and that has to show up in the band.
 */
function selectivityPenalty(uni: University) {
  const rate =
    typeof uni.intl_acceptance_rate === 'number'
      ? uni.intl_acceptance_rate
      : typeof uni.acceptance_rate === 'number'
        ? uni.acceptance_rate
        : 0.3
  const difficulty = clamp01(1 - rate)
  return Math.pow(difficulty, 1.5) * 60
}

export function scoreUniversity(
  rawApplicant: Applicant,
  uni: University,
  expected: ProfileVector,
  portfolio: ProfileVector,
  now: Date
): UniversityMatch {
  const applicant = normalizeApplicant(rawApplicant)
  const gpa = scoreGpa(applicant, uni)
  const sat = scoreSat(applicant, uni)
  const language = checkLanguage(applicant, uni)
  const { score: portfolioScore, gaps } = coverage(portfolio, expected)

  // Academic half: average whichever of GPA/SAT we actually have.
  const academicParts = [gpa.score, sat.score].filter((s): s is number => s !== null)
  const confidence: Confidence =
    academicParts.length === 2 ? 'high' : academicParts.length === 1 ? 'partial' : 'low'

  // When a school publishes no comparable academic data - UK and much of the EU
  // admit on A-levels or Abitur, so gpa_avg and SAT are legitimately null - fall
  // back to a neutral 0.5 rather than dropping the term. Dropping it would make
  // the portfolio 100% of the score and turn OUR missing data into the
  // applicant's penalty. `confidence` is how the UI communicates the gap instead.
  const academic = academicParts.length
    ? academicParts.reduce((a, b) => a + b, 0) / academicParts.length
    : 0.5

  // Portfolio weighs slightly more than grades - that is the product's thesis.
  const admissionFit = round((academic * 0.45 + portfolioScore * 0.55) * 100)
  const adjustedFit = round(Math.max(0, admissionFit - selectivityPenalty(uni)))

  const blockers: string[] = []
  const requirements: string[] = []

  if (language.blocker) blockers.push(language.blocker)
  if (language.requirement) requirements.push(language.requirement)
  if (uni.requires_sat && typeof applicant.satScore !== 'number') {
    // Also a task rather than a failure - the applicant can still sit the SAT.
    requirements.push('This school requires an SAT score, which you have not recorded yet.')
  }

  let band: Band = adjustedFit >= 60 ? 'safety' : adjustedFit >= 35 ? 'match' : 'dream'
  // A demonstrably failed requirement cannot be a safe bet, whatever the
  // arithmetic says. Outstanding tasks do not move the band.
  if (blockers.length > 0) band = 'dream'

  const portfolioDetail = gaps.length
    ? `Closest gaps: ${gaps
        .slice(0, 3)
        .map((g) => g.label)
        .join(', ')}.`
    : 'Your portfolio covers what admitted students typically show.'

  const factors: Factor[] = [
    gpa.factor,
    sat.factor,
    language.factor,
    {
      key: 'portfolio',
      label: 'Portfolio',
      verdict: portfolioScore >= 0.85 ? 'above' : portfolioScore >= 0.5 ? 'in_range' : 'below',
      detail: portfolioDetail,
    },
  ]

  return {
    slug: uni.slug,
    name: uni.name,
    country: uni.country,
    band,
    admissionFit,
    adjustedFit,
    confidence,
    factors,
    gaps,
    affordability: assessAffordability(applicant, uni),
    deadline: assessDeadline(uni, now),
    blockers,
    requirements,
    provenance: {
      dataStatus: uni.data_status ?? 'seed_unverified',
      sourceUrl: uni.source_url ?? null,
      verifiedAt: uni.verified_at ?? null,
    },
  }
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

export function diagnose(
  rawApplicant: Applicant,
  universities: University[],
  programProfiles: ProgramProfile[] | null | undefined,
  now: Date = new Date()
): Diagnosis {
  const applicant = normalizeApplicant(rawApplicant)
  const portfolio = buildPortfolioVector(applicant.achievements)
  const goalField = applicant.goalField?.trim() || null

  const matches = universities
    .map((uni) =>
      scoreUniversity(
        applicant,
        uni,
        pickExpectedProfile(uni, programProfiles, goalField),
        portfolio.vector,
        now
      )
    )
    .sort((a, b) => b.adjustedFit - a.adjustedFit)

  // Shape is diagnosed against what the applicant is actually aiming at, so we
  // average the expectations of the schools they could plausibly reach.
  const reachable = matches.filter((m) => m.band !== 'dream')
  const shapeBasis = (reachable.length >= 3 ? reachable : matches).slice(0, 8)
  const bySlug = new Map(universities.map((u) => [u.slug, u]))
  const aggregated = emptyVector()
  for (const m of shapeBasis) {
    const uni = bySlug.get(m.slug)
    if (!uni) continue
    const exp = pickExpectedProfile(uni, programProfiles, goalField)
    for (const axis of ACHIEVEMENT_TYPES) aggregated[axis] += exp[axis]
  }

  return {
    goalField,
    portfolio: {
      vector: portfolio.vector,
      totalWeight: round(portfolio.totalWeight),
      verifiedCount: portfolio.verifiedCount,
      unverifiedCount: portfolio.unverifiedCount,
    },
    shape: diagnoseShape(portfolio.vector, aggregated),
    matches,
    strategyList: {
      dream: matches.filter((m) => m.band === 'dream').map((m) => m.slug),
      match: matches.filter((m) => m.band === 'match').map((m) => m.slug),
      safety: matches.filter((m) => m.band === 'safety').map((m) => m.slug),
    },
  }
}
