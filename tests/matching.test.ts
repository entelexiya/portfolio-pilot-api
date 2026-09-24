import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ACHIEVEMENT_TYPES,
  buildPortfolioVector,
  coverage,
  diagnose,
  diagnoseShape,
  emptyVector,
  pickExpectedProfile,
  scoreUniversity,
  toVector,
  type University,
} from '../lib/matching/engine.ts'

const NOW = new Date('2026-09-24T00:00:00Z')

// A highly selective school: strong applicants should still land in `dream`.
const selective: University = {
  id: 'u-sel',
  slug: 'selective-tech',
  name: 'Selective Tech',
  country: 'USA',
  acceptance_rate: 0.04,
  gpa_avg: 3.95,
  sat_p25: 1510,
  sat_p75: 1580,
  requires_sat: true,
  ielts_min: 7,
  tuition_usd: 62000,
  living_cost_usd: 20000,
  aid_for_intl: true,
  avg_aid_usd: 50000,
  deadline_regular: '2027-01-05',
  admitted_profile: { olympiad: 3, research: 3, project: 4, leadership: 2 },
  data_status: 'seed_unverified',
}

// A broadly accessible school: the same applicant should land in `safety`.
const accessible: University = {
  id: 'u-acc',
  slug: 'open-state',
  name: 'Open State University',
  country: 'USA',
  acceptance_rate: 0.9,
  gpa_avg: 3.2,
  sat_p25: 1080,
  sat_p75: 1300,
  requires_sat: false,
  ielts_min: 6,
  tuition_usd: 30000,
  living_cost_usd: 15000,
  aid_for_intl: false,
  deadline_regular: '2027-05-01',
  admitted_profile: { project: 1, volunteering: 1, club: 1 },
  data_status: 'seed_unverified',
}

const strongApplicant = {
  gpa: 3.9,
  satScore: 1540,
  ielts: 7.5,
  budgetUsd: 20000,
  goalField: 'computer science',
  achievements: [
    { type: 'olympiad', verification_status: 'verified' },
    { type: 'olympiad', verification_status: 'verified' },
    { type: 'olympiad', verification_status: 'verified' },
    { type: 'research', verification_status: 'verified' },
    { type: 'research', verification_status: 'verified' },
    { type: 'research', verification_status: 'pending' },
    { type: 'project', verification_status: 'verified' },
    { type: 'project', verification_status: 'verified' },
    { type: 'project', verification_status: 'verified' },
    { type: 'project', verification_status: 'verified' },
    { type: 'leadership', verification_status: 'verified' },
    { type: 'leadership', verification_status: 'verified' },
  ],
}

// -----------------------------------------------------------------------------
// Vector construction
// -----------------------------------------------------------------------------

test('emptyVector covers every achievement axis with zero', () => {
  const v = emptyVector()
  assert.equal(Object.keys(v).length, ACHIEVEMENT_TYPES.length)
  for (const t of ACHIEVEMENT_TYPES) assert.equal(v[t], 0)
})

test('toVector ignores unknown keys, negatives and non-numbers', () => {
  const v = toVector({ olympiad: 2, not_an_axis: 9, project: -3, research: 'nope' as never })
  assert.equal(v.olympiad, 2)
  assert.equal(v.project, 0)
  assert.equal(v.research, 0)
  assert.equal('not_an_axis' in v, false)
})

test('verified achievements outweigh unverified ones', () => {
  const verified = buildPortfolioVector([{ type: 'olympiad', verification_status: 'verified' }])
  const unverified = buildPortfolioVector([{ type: 'olympiad', verification_status: 'unverified' }])
  assert.ok(verified.vector.olympiad > unverified.vector.olympiad)
  assert.equal(verified.verifiedCount, 1)
  assert.equal(unverified.verifiedCount, 0)
})

test('rejected achievements contribute nothing and are not counted as pending', () => {
  const { vector, totalWeight, verifiedCount, unverifiedCount } = buildPortfolioVector([
    { type: 'project', verification_status: 'rejected' },
  ])
  assert.equal(vector.project, 0)
  assert.equal(totalWeight, 0)
  assert.equal(verifiedCount, 0)
  assert.equal(unverifiedCount, 0)
})

test('unknown achievement types are skipped rather than crashing', () => {
  const { totalWeight } = buildPortfolioVector([
    { type: 'quidditch', verification_status: 'verified' },
    { type: null },
    {},
  ])
  assert.equal(totalWeight, 0)
})

// -----------------------------------------------------------------------------
// Coverage and gaps
// -----------------------------------------------------------------------------

test('coverage is 1 when nothing is expected', () => {
  const { score, gaps } = coverage(emptyVector(), emptyVector())
  assert.equal(score, 1)
  assert.deepEqual(gaps, [])
})

test('coverage reports gaps largest-first and ignores surplus axes', () => {
  const actual = emptyVector()
  actual.project = 5 // surplus on an axis nobody asked about
  actual.olympiad = 1

  const expected = emptyVector()
  expected.olympiad = 3
  expected.leadership = 2

  const { score, gaps } = coverage(actual, expected)
  assert.equal(gaps[0].axis, 'olympiad') // deficit 2
  assert.equal(gaps[1].axis, 'leadership') // deficit 2 -> tie, but both present
  assert.equal(gaps.length, 2)
  // deficit 4 out of expected 5 -> coverage 0.2 (float-tolerant)
  assert.ok(Math.abs(score - 0.2) < 1e-9, `expected ~0.2, got ${score}`)
})

test('surplus on one axis does not paper over a deficit on another', () => {
  const actual = emptyVector()
  actual.volunteering = 20

  const expected = emptyVector()
  expected.research = 2

  const { score, gaps } = coverage(actual, expected)
  assert.equal(score, 0)
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].axis, 'research')
})

// -----------------------------------------------------------------------------
// Shape diagnosis - the "reads like X, not Y" signal
// -----------------------------------------------------------------------------

test('shape diagnosis stays silent when the portfolio is too thin', () => {
  const actual = emptyVector()
  actual.olympiad = 1
  const expected = emptyVector()
  expected.project = 3

  const shape = diagnoseShape(actual, expected)
  assert.equal(shape.hasEnoughData, false)
  assert.deepEqual(shape.leaning, [])
  assert.deepEqual(shape.missing, [])
})

test('shape diagnosis names the wrong lean and the missing axis', () => {
  // Portfolio is all volunteering; the target expects research and projects.
  const actual = emptyVector()
  actual.volunteering = 6

  const expected = emptyVector()
  expected.research = 3
  expected.project = 3

  const shape = diagnoseShape(actual, expected)
  assert.equal(shape.hasEnoughData, true)
  assert.equal(shape.leaning[0].axis, 'volunteering')
  const missingAxes = shape.missing.map((m) => m.axis)
  assert.ok(missingAxes.includes('research'))
  assert.ok(missingAxes.includes('project'))
})

// -----------------------------------------------------------------------------
// Banding
// -----------------------------------------------------------------------------

test('a strong applicant is a reach at a 4%-acceptance school but safe at a 90% one', () => {
  const expectedSel = toVector(selective.admitted_profile)
  const expectedAcc = toVector(accessible.admitted_profile)
  const { vector } = buildPortfolioVector(strongApplicant.achievements)

  const sel = scoreUniversity(strongApplicant, selective, expectedSel, vector, NOW)
  const acc = scoreUniversity(strongApplicant, accessible, expectedAcc, vector, NOW)

  assert.equal(sel.band, 'dream')
  assert.equal(acc.band, 'safety')
  // Raw fit is high at both; only selectivity separates them.
  assert.ok(sel.admissionFit > 70, `expected high raw fit, got ${sel.admissionFit}`)
  assert.ok(sel.adjustedFit < sel.admissionFit)
})

test('a weak applicant cannot reach safety at a selective school', () => {
  const weak = {
    gpa: 2.8,
    satScore: 1050,
    ielts: 7,
    achievements: [{ type: 'club', verification_status: 'unverified' }],
  }
  const match = scoreUniversity(weak, selective, toVector(selective.admitted_profile), buildPortfolioVector(weak.achievements).vector, NOW)
  assert.equal(match.band, 'dream')
})

test('a language score BELOW the minimum forces a reach and surfaces a blocker', () => {
  const applicant = { ...strongApplicant, ielts: 5.5 }
  const { vector } = buildPortfolioVector(applicant.achievements)

  const match = scoreUniversity(applicant, accessible, toVector(accessible.admitted_profile), vector, NOW)
  assert.equal(match.band, 'dream', 'failing a hard gate cannot be a safe bet')
  assert.equal(match.blockers.length, 1)
  assert.match(match.blockers[0], /below the required/)
  assert.deepEqual(match.requirements, [], 'a failed score is a blocker, not an outstanding task')
})

test('a required SAT with no score is an outstanding task, not a failure', () => {
  const applicant = { ...strongApplicant, satScore: null }
  const { vector } = buildPortfolioVector(applicant.achievements)

  const match = scoreUniversity(applicant, selective, toVector(selective.admitted_profile), vector, NOW)
  assert.deepEqual(match.blockers, [], 'not having sat the SAT yet is not a failed requirement')
  assert.ok(match.requirements.some((r) => /requires an SAT/.test(r)))
})

test('a missing language score is a requirement and does not force a reach', () => {
  // The case that made every school unreachable before: an applicant who simply
  // has not taken IELTS yet must not be treated as failing the language gate.
  const applicant = { ...strongApplicant, ielts: null, toefl: null }
  const { vector } = buildPortfolioVector(applicant.achievements)

  const match = scoreUniversity(applicant, accessible, toVector(accessible.admitted_profile), vector, NOW)
  assert.deepEqual(match.blockers, [])
  assert.ok(match.requirements.some((r) => /Needs IELTS 6/.test(r)))
  assert.equal(match.band, 'safety', 'an untaken test must not push a 90%-acceptance school out of reach')
  assert.equal(match.factors.find((f) => f.key === 'language')?.verdict, 'unknown')
})

test('a score for a test the school does not ask for is not treated as a miss', () => {
  // School publishes only an IELTS minimum; applicant has TOEFL only.
  const ieltsOnlySchool: University = { ...accessible, ielts_min: 6, toefl_min: null }
  const applicant = { ...strongApplicant, ielts: null, toefl: 100 }
  const { vector } = buildPortfolioVector(applicant.achievements)

  const match = scoreUniversity(applicant, ieltsOnlySchool, toVector(accessible.admitted_profile), vector, NOW)
  assert.deepEqual(match.blockers, [], 'having the wrong test is not a failed minimum')
  assert.equal(match.requirements.length, 1)
})

test('unavailable academic data becomes a neutral prior, not a penalty', () => {
  // UK and much of the EU admit on A-levels, so gpa_avg and SAT are legitimately
  // null. Our missing reference data must not read as the applicant failing.
  const noAcademicData: University = {
    ...accessible,
    slug: 'uk-style',
    gpa_avg: null,
    sat_p25: null,
    sat_p75: null,
    // Expectations this portfolio fully covers, to isolate the academic term.
    admitted_profile: { project: 2 },
  }
  const expected = toVector(noAcademicData.admitted_profile)
  const { vector } = buildPortfolioVector(strongApplicant.achievements)

  const match = scoreUniversity(strongApplicant, noAcademicData, expected, vector, NOW)

  assert.equal(match.confidence, 'low')
  assert.equal(match.factors.find((f) => f.key === 'gpa')?.verdict, 'unknown')
  assert.equal(match.factors.find((f) => f.key === 'sat')?.verdict, 'unknown')
  // Full portfolio coverage (55%) + neutral academic prior (0.5 * 45%) = 77.5
  assert.equal(match.admissionFit, 77.5)
  assert.equal(match.band, 'safety', 'a 90%-acceptance school must not become a reach')
})

test('confidence reflects how many academic signals were comparable', () => {
  const { vector } = buildPortfolioVector(strongApplicant.achievements)
  const expected = toVector(selective.admitted_profile)

  const both = scoreUniversity(strongApplicant, selective, expected, vector, NOW)
  const onlyGpa = scoreUniversity(
    strongApplicant,
    { ...selective, sat_p25: null, sat_p75: null },
    expected,
    vector,
    NOW
  )
  const neither = scoreUniversity(
    strongApplicant,
    { ...selective, gpa_avg: null, sat_p25: null, sat_p75: null },
    expected,
    vector,
    NOW
  )

  assert.equal(both.confidence, 'high')
  assert.equal(onlyGpa.confidence, 'partial')
  assert.equal(neither.confidence, 'low')
})

test('portfolio still dominates the score when academic data is missing', () => {
  // Same school, same unknown academics: only the portfolio separates these two.
  const noAcademicData: University = {
    ...accessible,
    gpa_avg: null,
    sat_p25: null,
    sat_p75: null,
    admitted_profile: { research: 3, project: 3 },
  }
  const expected = toVector(noAcademicData.admitted_profile)

  const covered = scoreUniversity(
    strongApplicant,
    noAcademicData,
    expected,
    buildPortfolioVector(strongApplicant.achievements).vector,
    NOW
  )
  const uncovered = scoreUniversity(
    { ...strongApplicant, achievements: [{ type: 'volunteering', verification_status: 'verified' }] },
    noAcademicData,
    expected,
    buildPortfolioVector([{ type: 'volunteering', verification_status: 'verified' }]).vector,
    NOW
  )

  assert.ok(
    covered.admissionFit - uncovered.admissionFit > 40,
    `portfolio should still drive the result, got ${covered.admissionFit} vs ${uncovered.admissionFit}`
  )
})

test('a STEM-only portfolio under-covers a school that expects community activities', () => {
  // Guards the deliberate choice that surplus on one axis earns no credit
  // elsewhere: 3 olympiads do not substitute for the volunteering and club
  // participation this school's admitted students show.
  const expected = toVector(accessible.admitted_profile)
  const { vector } = buildPortfolioVector(strongApplicant.achievements)

  const { score, gaps } = coverage(vector, expected)
  assert.ok(Math.abs(score - 1 / 3) < 1e-9, `expected ~0.333, got ${score}`)
  assert.deepEqual(
    gaps.map((g) => g.axis),
    ['volunteering', 'club']
  )
})

test('a zero test score is treated as absent, not as a failing grade', () => {
  // Real profiles contain ielts: 0 from empty form fields. Before this guard that
  // zero read as "has a score, below the minimum" and blocked every school.
  const applicant = { ...strongApplicant, ielts: 0, toefl: 0 }
  const { vector } = buildPortfolioVector(applicant.achievements)

  const match = scoreUniversity(applicant, accessible, toVector(accessible.admitted_profile), vector, NOW)
  assert.deepEqual(match.blockers, [])
  assert.ok(match.requirements.some((r) => /not recorded a score yet/.test(r)))
  assert.equal(match.band, 'safety')
})

test('a zero GPA or SAT does not count as a comparable signal', () => {
  const applicant = { ...strongApplicant, gpa: 0, satScore: 0 }
  const { vector } = buildPortfolioVector(applicant.achievements)

  const match = scoreUniversity(applicant, accessible, toVector(accessible.admitted_profile), vector, NOW)
  assert.equal(match.confidence, 'low')
  assert.equal(match.factors.find((f) => f.key === 'gpa')?.verdict, 'unknown')
  assert.equal(match.factors.find((f) => f.key === 'sat')?.verdict, 'unknown')
})

// -----------------------------------------------------------------------------
// Affordability
// -----------------------------------------------------------------------------

test('affordability subtracts expected aid and reports the shortfall', () => {
  const { vector } = buildPortfolioVector(strongApplicant.achievements)
  const match = scoreUniversity(strongApplicant, selective, toVector(selective.admitted_profile), vector, NOW)

  assert.equal(match.affordability.annualCostUsd, 82000)
  assert.equal(match.affordability.expectedAidUsd, 50000)
  assert.equal(match.affordability.netCostUsd, 32000)
  assert.equal(match.affordability.affordable, false)
  assert.equal(match.affordability.shortfallUsd, 12000) // 32000 net vs 20000 budget
})

test('schools without international aid get no phantom discount', () => {
  const { vector } = buildPortfolioVector(strongApplicant.achievements)
  const match = scoreUniversity(strongApplicant, accessible, toVector(accessible.admitted_profile), vector, NOW)

  assert.equal(match.affordability.expectedAidUsd, 0)
  assert.equal(match.affordability.netCostUsd, 45000)
})

test('affordability is unknown, not false, when the applicant gave no budget', () => {
  const applicant = { ...strongApplicant, budgetUsd: null }
  const { vector } = buildPortfolioVector(applicant.achievements)
  const match = scoreUniversity(applicant, accessible, toVector(accessible.admitted_profile), vector, NOW)

  assert.equal(match.affordability.affordable, null)
  assert.equal(match.affordability.shortfallUsd, null)
})

// -----------------------------------------------------------------------------
// Deadlines
// -----------------------------------------------------------------------------

test('deadline status distinguishes passed, urgent and open', () => {
  const { vector } = buildPortfolioVector(strongApplicant.achievements)
  const base = toVector(accessible.admitted_profile)

  const passed = scoreUniversity(
    strongApplicant,
    { ...accessible, deadline_regular: '2026-09-01' },
    base,
    vector,
    NOW
  )
  const urgent = scoreUniversity(
    strongApplicant,
    { ...accessible, deadline_regular: '2026-10-10' },
    base,
    vector,
    NOW
  )
  const open = scoreUniversity(strongApplicant, accessible, base, vector, NOW)

  assert.equal(passed.deadline.status, 'passed')
  assert.equal(urgent.deadline.status, 'urgent')
  assert.equal(open.deadline.status, 'open')
})

test('a missing or malformed deadline is unknown rather than an error', () => {
  const { vector } = buildPortfolioVector(strongApplicant.achievements)
  const base = toVector(accessible.admitted_profile)

  for (const value of [null, 'not-a-date']) {
    const match = scoreUniversity(
      strongApplicant,
      { ...accessible, deadline_regular: value },
      base,
      vector,
      NOW
    )
    assert.equal(match.deadline.status, 'unknown')
    assert.equal(match.deadline.daysLeft, null)
  }
})

// -----------------------------------------------------------------------------
// Program-specific expectations
// -----------------------------------------------------------------------------

test('a field-specific profile overrides the school default', () => {
  const programProfiles = [
    { university_id: 'u-sel', field: 'Computer Science', admitted_profile: { project: 9 } },
  ]
  const picked = pickExpectedProfile(selective, programProfiles, 'computer science')
  assert.equal(picked.project, 9)
  assert.equal(picked.olympiad, 0, 'the override replaces the default, it does not merge')
})

test('the school default is used when no program profile matches', () => {
  const picked = pickExpectedProfile(selective, [{ university_id: 'u-sel', field: 'History' }], 'physics')
  assert.equal(picked.olympiad, 3)
})

test('an empty program profile falls back to the school default', () => {
  const picked = pickExpectedProfile(
    selective,
    [{ university_id: 'u-sel', field: 'Computer Science', admitted_profile: {} }],
    'Computer Science'
  )
  assert.equal(picked.olympiad, 3)
})

// -----------------------------------------------------------------------------
// End-to-end
// -----------------------------------------------------------------------------

test('diagnose sorts by adjusted fit and splits into a strategy list', () => {
  const result = diagnose(strongApplicant, [selective, accessible], [], NOW)

  assert.equal(result.matches.length, 2)
  assert.ok(result.matches[0].adjustedFit >= result.matches[1].adjustedFit)
  assert.deepEqual(result.strategyList.safety, ['open-state'])
  assert.deepEqual(result.strategyList.dream, ['selective-tech'])
  assert.equal(result.goalField, 'computer science')
  assert.equal(result.portfolio.verifiedCount, 11)
})

test('diagnose carries provenance through to every match', () => {
  const withSource: University = {
    ...accessible,
    data_status: 'verified',
    source_url: 'https://example.edu/admissions',
    verified_at: '2026-09-20',
  }
  const result = diagnose(strongApplicant, [withSource], [], NOW)

  assert.equal(result.matches[0].provenance.dataStatus, 'verified')
  assert.equal(result.matches[0].provenance.sourceUrl, 'https://example.edu/admissions')
  assert.equal(result.matches[0].provenance.verifiedAt, '2026-09-20')
})

test('diagnose handles an empty portfolio and an empty university list', () => {
  const empty = diagnose({ achievements: [] }, [], [], NOW)
  assert.deepEqual(empty.matches, [])
  assert.equal(empty.shape.hasEnoughData, false)
  assert.equal(empty.portfolio.totalWeight, 0)
})

test('a volunteering-heavy portfolio aimed at a research school is diagnosed as mis-shaped', () => {
  const internationalist = {
    gpa: 3.8,
    satScore: 1500,
    ielts: 7.5,
    goalField: 'computer science',
    achievements: [
      { type: 'volunteering', verification_status: 'verified' },
      { type: 'volunteering', verification_status: 'verified' },
      { type: 'volunteering', verification_status: 'verified' },
      { type: 'leadership', verification_status: 'verified' },
      { type: 'leadership', verification_status: 'verified' },
      { type: 'club', verification_status: 'verified' },
    ],
  }

  const result = diagnose(internationalist, [selective, accessible], [], NOW)
  assert.equal(result.shape.hasEnoughData, true)
  assert.ok(
    result.shape.leaning.some((l) => l.axis === 'volunteering'),
    'should notice the volunteering lean'
  )
  assert.ok(
    result.shape.missing.some((m) => m.axis === 'research' || m.axis === 'project'),
    'should notice the missing technical axes'
  )
})
