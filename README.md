# Portfolio Pilot API

## Run locally

```bash
npm install
npm run dev
```

## Tests

```bash
npm run test
```

## Required env vars

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

## Optional env vars

- `NEXT_PUBLIC_APP_URL` for verification links
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` for email sending

### Persistent rate limit (recommended for production)

Set these to use Upstash Redis for distributed limits:

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

If these are not set, the API falls back to in-memory rate limiting.

## Observability

- Every API response includes `requestId` in JSON and `x-request-id` header.
- Error logs are structured JSON with event name and `requestId`.
