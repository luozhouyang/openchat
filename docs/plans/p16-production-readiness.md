# P16 — Production readiness (2026-11-09)

Follow-up to P15. Scope: CI, first-deploy runbook, observability, security
review. Local docs only (see the note at the end).

## CI (`.github/workflows/ci.yml`)

| Job | What it runs |
| --- | --- |
| `check` | `pnpm install`, `vp check`, `vp run -r test` |
| `build` | `vp run openchat#build`, `vp run openchat#deploy:dry` |
| `e2e` | Playwright chromium (cached), throwaway `.dev.vars`, `pnpm exec playwright test` |
| `mobile` | standalone Expo workspace: `pnpm install`, `pnpm typecheck`, `pnpm test` |

- The e2e job puts `$GITHUB_WORKSPACE/node_modules/.bin` on `PATH` because the
  Playwright `webServer` shells out to `vp` and `wrangler`.
- `.dev.vars` is gitignored; the job writes throwaway CI values
  (`BETTER_AUTH_SECRET`, `INTERNAL_TOKEN_KEY`, R2 placeholders) before running.
- Playwright retries once on CI to absorb live-WebSocket timing flakes.
- Validated locally: workflow schema via `@action-validator/cli`, and every job
  command was executed here (build, deploy:dry, mobile typecheck/jest, e2e
  26/26). GitHub-runner execution is only confirmed by the first CI run.

## First-deploy checklist

1. **D1**: `wrangler d1 create openchat`, then replace the placeholder
   `database_id` (`00000000-0000-0000-0000-000000000000`) in
   `apps/openchat/wrangler.jsonc`.
2. **R2**: `wrangler r2 bucket create openchat-files`.
3. **Queues**: `wrangler queues create openchat-push`,
   `wrangler queues create openchat-thumbnails`,
   `wrangler queues create openchat-push-dlq`.
4. **Worker secrets** (`apps/openchat`):
   `BETTER_AUTH_SECRET`, `INTERNAL_TOKEN_KEY`, `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `VAPID_PRIVATE_KEY`.
   Vars (`BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `VAPID_PUBLIC_KEY`,
   `INVITE_FROM_EMAIL`, `R2_BUCKET_NAME`) must be set for the real host.
5. **Push worker secrets** (`apps/push`): `VAPID_PRIVATE_KEY`.
6. **Deploy**: `vp run openchat#deploy` (build + remote D1 migrations + deploy),
   then `cd apps/push && wrangler deploy`.
7. **Thumbnails**: `vp run push#setup:r2-events` (registers the R2
   object-create notification for the thumbnail queue).
8. **Smoke**: `curl https://<host>/health` returns `{ ok: true }`; sign up,
   create a team/channel, send a message, verify `/api/v1/users/me`.

## Secret rotation

- Rotating `BETTER_AUTH_SECRET` breaks decryption of the stored JWKS private key
  (`Failed to decrypt private key` on token issuance). Either clear the `jwks`
  table in the same maintenance window or keep the secret stable.
- `INTERNAL_TOKEN_KEY` rotation is safe (short-lived internal tokens).

## Backups

- D1: schedule `wrangler d1 export openchat --remote --output backup-<date>.sql`
  (operator runbook or a scheduled job outside this repo).
- R2: rely on bucket lifecycle/versioning as needed; message attachments are the
  only irreplaceable objects.

## Observability

- Done: every request gets an `x-request-id` (caller-supplied or generated),
  echoed on the response and attached to `request` / `request.error` log lines
  and error bodies. The query string is omitted from logs.
- Next: ship logs (Workers Logs / Logpush), alert on 5xx, DO errors and
  `openchat-push-dlq` depth; analytics for messages/day, active channels, WS
  connections and push failures.

## Security checklist

- Rate limiting for search/uploads/reactions is per isolate (best effort);
  auth endpoints use better-auth's limiter.
- `/ws` accepts a session cookie; the query-string JWT remains for desktop.
- Uploads: presigned PUT, size/type checks at complete, membership checks on
  download.
- Admin routes require `users.role === "admin"`; audit rows are persisted.

> Note: `docs/` is in `.gitignore`; this file is committed with `git add -f`,
> other docs stay local.
