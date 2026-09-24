/**
 * Smoke-run the matching engine with no database and no API key.
 *
 *   npm run diagnose:demo
 *   npm run diagnose:demo -- internationalist
 *
 * Prints the same diagnosis object the /api/advisor/diagnose endpoint returns,
 * formatted for a terminal. Use it to sanity-check banding, gaps and the shape
 * diagnosis after changing the engine.
 *
 * The universities below are a small FIXTURE, not the seed. They mirror the shape
 * of the real rows so the output is representative; the real data lives in
 * ../portfolio-pilot-frontend/supabase/seed/universities_seed.sql.
 */

import {
  diagnose,
  type Applicant,
  type ProgramProfile,
  type University,
} from '../lib/matching/engine.ts'

const universities: University[] = [
  {
    id: 'f-mit',
    slug: 'mit',
    name: 'Massachusetts Institute of Technology',
    country: 'USA',
    acceptance_rate: 0.04,
    intl_acceptance_rate: 0.03,
    gpa_avg: 3.96,
    sat_p25: 1520,
    sat_p75: 1580,
    ielts_min: 7,
    tuition_usd: 62000,
    living_cost_usd: 20000,
    aid_for_intl: true,
    avg_aid_usd: 55000,
    deadline_regular: '2027-01-04',
    admitted_profile: { olympiad: 3, competition: 2, research: 3, project: 4, leadership: 2 },
    data_status: 'seed_unverified',
    source_url: 'https://mitadmissions.org/apply/',
  },
  {
    id: 'f-cmu',
    slug: 'carnegie-mellon',
    name: 'Carnegie Mellon University',
    country: 'USA',
    acceptance_rate: 0.11,
    gpa_avg: 3.9,
    sat_p25: 1500,
    sat_p75: 1560,
    requires_sat: true,
    ielts_min: 7.5,
    tuition_usd: 66000,
    living_cost_usd: 18000,
    aid_for_intl: true,
    avg_aid_usd: 35000,
    deadline_regular: '2027-01-03',
    admitted_profile: { olympiad: 2, competition: 3, research: 2, project: 4, internship: 1 },
    data_status: 'seed_unverified',
  },
  {
    id: 'f-tum',
    slug: 'tu-munich',
    name: 'Technical University of Munich',
    country: 'Germany',
    acceptance_rate: 0.4,
    ielts_min: 6.5,
    tuition_usd: 6000,
    living_cost_usd: 12000,
    deadline_regular: '2027-01-15',
    admitted_profile: { olympiad: 1, project: 2, research: 2 },
    data_status: 'verified',
    verified_at: '2026-09-20',
    source_url: 'https://www.tum.de/en/studies/application',
  },
  {
    id: 'f-bilkent',
    slug: 'bilkent',
    name: 'Bilkent University',
    country: 'Turkey',
    acceptance_rate: 0.4,
    gpa_avg: 3.3,
    ielts_min: 6.5,
    tuition_usd: 18000,
    living_cost_usd: 6000,
    aid_for_intl: true,
    avg_aid_usd: 12000,
    deadline_regular: '2027-05-01',
    admitted_profile: { olympiad: 1, competition: 1, project: 1, club: 1 },
    data_status: 'seed_unverified',
  },
  {
    id: 'f-asu',
    slug: 'arizona-state',
    name: 'Arizona State University',
    country: 'USA',
    acceptance_rate: 0.9,
    gpa_avg: 3.5,
    sat_p25: 1120,
    sat_p75: 1380,
    ielts_min: 6,
    tuition_usd: 33000,
    living_cost_usd: 15000,
    aid_for_intl: true,
    avg_aid_usd: 10000,
    deadline_regular: '2027-02-01',
    admitted_profile: { project: 1, volunteering: 1, club: 1 },
    data_status: 'seed_unverified',
  },
]

const programProfiles: ProgramProfile[] = [
  {
    university_id: 'f-mit',
    field: 'computer science',
    admitted_profile: { olympiad: 4, competition: 3, project: 4, research: 3, internship: 1 },
  },
  {
    university_id: 'f-cmu',
    field: 'computer science',
    admitted_profile: { olympiad: 3, competition: 4, project: 5, research: 2, internship: 1 },
  },
]

function repeat(type: string, count: number, status = 'verified') {
  return Array.from({ length: count }, () => ({ type, verification_status: status }))
}

/** Named sample applicants, so a change can be eyeballed against several shapes. */
const PROFILES: Record<string, Applicant> = {
  // Textbook CS candidate: should sit near the top everywhere.
  strong: {
    gpa: 3.9,
    satScore: 1540,
    ielts: 7.5,
    budgetUsd: 20000,
    goalField: 'computer science',
    achievements: [
      ...repeat('olympiad', 3),
      ...repeat('research', 2),
      ...repeat('project', 4),
      ...repeat('leadership', 2),
    ],
  },
  // The case the product exists for: good student, wrong-shaped portfolio.
  internationalist: {
    gpa: 3.8,
    satScore: 1500,
    ielts: 7.5,
    budgetUsd: 25000,
    goalField: 'computer science',
    achievements: [
      ...repeat('volunteering', 4),
      ...repeat('leadership', 3),
      ...repeat('club', 2),
      ...repeat('award_other', 1),
    ],
  },
  // Nothing verified yet: every achievement carries reduced weight.
  unverified: {
    gpa: 3.7,
    satScore: 1450,
    ielts: 7,
    budgetUsd: 15000,
    goalField: 'computer science',
    achievements: [
      ...repeat('olympiad', 3, 'unverified'),
      ...repeat('project', 4, 'unverified'),
      ...repeat('research', 2, 'unverified'),
    ],
  },
  // No tests on file: language gates become blockers, academics become unknown.
  noTests: {
    gpa: null,
    satScore: null,
    ielts: null,
    toefl: null,
    budgetUsd: 10000,
    goalField: 'computer science',
    achievements: [...repeat('olympiad', 2), ...repeat('project', 3)],
  },
}

const which = process.argv[2] ?? 'internationalist'
const applicant = PROFILES[which]

if (!applicant) {
  console.error(`Unknown profile "${which}". Available: ${Object.keys(PROFILES).join(', ')}`)
  process.exit(1)
}

const result = diagnose(applicant, universities, programProfiles)

const BAND_ORDER = ['match', 'safety', 'dream'] as const
const money = (n: number | null) => (n === null ? 'n/a' : `$${n.toLocaleString('en-US')}`)

console.log(`\n=== Profile: ${which} ===`)
console.log(
  `GPA ${applicant.gpa ?? '-'} | SAT ${applicant.satScore ?? '-'} | IELTS ${applicant.ielts ?? '-'} | budget ${money(applicant.budgetUsd ?? null)}`
)
console.log(
  `Portfolio: ${result.portfolio.verifiedCount} verified, ${result.portfolio.unverifiedCount} self-reported, weighted total ${result.portfolio.totalWeight}`
)

console.log('\n--- Shape ---')
if (!result.shape.hasEnoughData) {
  console.log('Not enough portfolio data to diagnose shape.')
} else {
  const fmt = (r: { label: string; share: number; expectedShare: number }) =>
    `${r.label} (you ${Math.round(r.share * 100)}% vs typical ${Math.round(r.expectedShare * 100)}%)`
  console.log(`Over-indexed:  ${result.shape.leaning.map(fmt).join(', ') || 'nothing'}`)
  console.log(`Under-indexed: ${result.shape.missing.map(fmt).join(', ') || 'nothing'}`)
}

for (const band of BAND_ORDER) {
  const rows = result.matches.filter((m) => m.band === band)
  console.log(`\n--- ${band.toUpperCase()} (${rows.length}) ---`)

  for (const m of rows) {
    console.log(`\n  ${m.name} [${m.country}]  fit ${m.admissionFit} -> adjusted ${m.adjustedFit}`)
    for (const f of m.factors) {
      console.log(`    ${f.verdict.padEnd(9)} ${f.label}: ${f.detail}`)
    }
    if (m.gaps.length) {
      console.log(
        `    gaps: ${m.gaps.map((g) => `${g.label} short by ${Math.round(g.deficit * 10) / 10}`).join(', ')}`
      )
    }
    if (m.blockers.length) {
      for (const b of m.blockers) console.log(`    BLOCKER: ${b}`)
    }
    const aff = m.affordability
    const verdict =
      aff.affordable === null
        ? 'no budget given'
        : aff.affordable
          ? 'within budget'
          : `${money(aff.shortfallUsd)} over budget`
    console.log(
      `    money: ${money(aff.annualCostUsd)}/yr - ${money(aff.expectedAidUsd)} aid = ${money(aff.netCostUsd)} net (${verdict})`
    )
    console.log(
      `    deadline: ${m.deadline.date ?? 'unknown'} (${m.deadline.status}${m.deadline.daysLeft !== null ? `, ${m.deadline.daysLeft}d` : ''}) | data: ${m.provenance.dataStatus}`
    )
  }
}

console.log('\nNo database and no API key were used. This is the deterministic layer only.\n')
