# Portfolio Pilot API

The backend for [Portfolio Pilot](https://github.com/entelexiya/portfolio-pilot-frontend):
the matching engine that diagnoses an applicant's portfolio, and the AI layer that
puts its result into words.

The web app and the database migrations live in that repository. Full setup for
both is in its `SETUP.md`.

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

## Tests

```bash
npm run test
```

## Env vars

See [.env.example](.env.example) for the full list with notes. Required to boot:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

An AI provider key is required only for the **written narrative** — the advisor
returns a complete diagnosis without one.

| Provider | Key | Notes |
|---|---|---|
| Gemini | `GEMINI_API_KEY` | Has a free tier. Default choice. |
| Claude | `ANTHROPIC_API_KEY` | Paid only — a Claude *subscription* does not include API access. |

`AI_PROVIDER=gemini|claude` picks one explicitly; with it unset, whichever key is
present wins, preferring Gemini. Both providers are validated against the same zod
schema in `lib/ai/narrative-schema.ts`, so swapping them cannot change the
response contract.

Gemini's free tier returns 503 "high demand" frequently and unpredictably — a probe
of six flash models once returned three 503s and three 200s in the same second — so
`lib/ai/providers/gemini.ts` walks a chain of four models and retries each. It
distinguishes transient faults (retry), per-model quota (skip to the next model)
and fatal errors such as a bad key (give up immediately).

### Persistent rate limit (recommended for production)

Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to use Upstash Redis
for distributed limits. Without them the API falls back to in-memory rate
limiting, which on serverless is per-instance and therefore close to unenforced.

## Observability

- Every API response includes `requestId` in JSON and an `x-request-id` header.
- Error logs are structured JSON with an event name and the `requestId`.

---

## The advisor

`POST /api/advisor/diagnose` — diagnoses a portfolio against the university
reference data and returns a Dream / Match / Safety list with per-school reasoning.

### The one rule that matters

**Chances and gaps are computed in code. The model never calculates them.**

```
universities table  ──▶  lib/matching/engine.ts  ──▶  bands, factors, gaps, costs
  (reference data)         (pure arithmetic)                    │
                                                               ▼
                                                   lib/ai/narrative.ts
                                                   (puts it into words only)
```

`lib/matching/engine.ts` has no imports and no side effects, so it is fully unit
tested (`tests/matching.test.ts`). The model receives a finished diagnosis and is
forbidden from introducing any number that is not already in the payload. If the
narrative call fails, the endpoint still returns the full diagnosis and reports
the failure in `narrativeError`.

This split is the reason the product can defend its output. A percentage an LLM
invents cannot be justified to a student or a reviewer; one derived from published
admitted-student data can.

It also means the provider is an implementation detail. Switching Gemini to Claude
changes one env var and nothing about what the product promises.

### How banding works

1. **Academic fit** — GPA against the admitted average, SAT against the
   published 25th–75th percentile range. Missing data is `unknown`, never a zero.
2. **Portfolio coverage** — the applicant's achievements as a weighted vector over
   the 10 achievement types, compared axis by axis against what admitted students
   typically show. Verified achievements weigh more than self-reported ones.
   Surplus on one axis earns no credit on another.
3. **Selectivity penalty** — subtracted from the combined fit, scaled by
   acceptance rate. A perfect profile is still a reach where 96% are turned away.
4. **Hard gates** — a language score that falls *below* a published minimum forces
   the school into `dream` and is reported in `blockers`, regardless of the arithmetic.
5. **Outstanding tasks** — a test the applicant simply has not taken yet goes to
   `requirements` and does **not** move the band. Conflating the two would put every
   school out of reach for anyone who has not sat IELTS yet, which is most
   applicants in September.

`confidence` (`high` / `partial` / `low`) reports how many academic signals the
school actually publishes. UK and much of the EU admit on A-levels, so `gpa_avg`
and SAT are legitimately null there; a missing reference figure falls back to a
neutral prior instead of scoring the applicant at zero.

Affordability is assessed separately and never inflates or deflates admission
odds: cost minus typical international aid, compared against the stated budget.

### Request

```jsonc
{
  "goalField": "computer science",  // optional, selects field-specific expectations
  "budgetUsd": 20000,              // optional, annual, what the family can pay
  "countries": ["USA", "UK"],      // optional filter
  "includeNarrative": true         // default true; false skips the model call
}
```

### Response

```jsonc
{
  "success": true,
  "data": {
    "runId": "...",
    "diagnosis": {
      "shape": { "leaning": [...], "missing": [...], "hasEnoughData": true },
      "matches": [ { "slug": "mit", "band": "dream", "factors": [...], "gaps": [...],
                     "affordability": {...}, "deadline": {...},
                     "blockers": [], "requirements": [...], "confidence": "high",
                     "provenance": { "dataStatus": "seed_unverified", ... } } ],
      "strategyList": { "dream": [...], "match": [...], "safety": [...] }
    },
    "narrative": { "headline": "...", "actionPlan": [...] },  // null if unavailable
    "narrativeError": null
  }
}
```

Every run is stored in `match_runs` with the input snapshot, so an old diagnosis
stays explainable after the profile changes.

## Data provenance

Every row in `universities` carries `source_url`, `verified_at` and `data_status`:

| `data_status` | Meaning |
|---|---|
| `seed_unverified` | Hand-entered approximation. **Must not be presented as fact in the UI.** |
| `agent_extracted` | Pulled from `source_url` by the data agent, awaiting human review. |
| `verified` | Checked against `source_url` on `verified_at`. |
| `stale` | The source changed since the last check. |

The seed lives in the web repository, at `supabase/seed/universities_seed.sql`. It is
entirely `seed_unverified` on purpose. Refreshing it is the data agent's job;
`provenance` is carried through to every match so the UI can show the badge.
