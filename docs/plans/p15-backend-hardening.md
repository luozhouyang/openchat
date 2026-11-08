# P15 — Backend hardening (2026-11-08)

Follow-up to the backend review. This round is **backend-only**; every UI item
listed at the end is intentionally deferred.

## Implemented

### D1 bound-parameter limit

D1 rejects queries with more than 100 bound parameters. `POST /users/status/ids`
with 150 ids returned HTTP 500 before this change.

- New `apps/openchat/src/worker/lib/chunks.ts` (`chunkItems`, size 90).
- Chunked: `status/ids`, `notifications/read`, `structure-broadcast` team online
  lookup, `listChannelsForTeams`, `listChannelMembersWithNames`,
  `listChannelsByIds`, `GET /users?ids=`, `ChannelDO.fetchOnlineMemberIds`.
- Regression tests: `test/worker/routes/status-params.test.ts`,
  `test/worker/routes/notifications-params.test.ts`.

### Durable Object lifecycle

- `ChannelDO.purge()` deletes all DO storage and recreates the empty schema;
  admin channel delete now calls it before removing D1 rows
  (`test/worker/admin/channel-purge.test.ts`).
- Reaction broadcasts no longer rely on `setTimeout`: dirty seqs are persisted
  in DO storage and flushed by the alarm, so eviction cannot drop them
  (`do/reaction-batch.ts`, `ChannelDO.alarm`, unit test
  `test/worker/unit/reaction-batch.test.ts`).

### Retention and cleanup

- `ChannelDO.alarm` now enforces `MESSAGE_RETENTION_MS` (90 days) in bounded
  passes via `purgeMessagesBefore` (messages + reactions + thread rows + sidebar
  meta refresh). Seq is AUTOINCREMENT, so gaps never reuse ids.
- New hourly cron (`wrangler.jsonc` `triggers.crons`) runs
  `runMaintenance` (`src/worker/maintenance.ts`): deletes notifications older
  than 90 days, abandoned upload sessions older than 24 hours, and invites
  expired more than 30 days ago. Tests:
  `test/worker/maintenance/maintenance.test.ts`.
- `recordNotifications` and thread-reply pushes now run under `waitUntil`, so
  D1 writes and per-subscriber pushes no longer delay the post ack.

### Message edits

- Editing a message re-parses `@[id]` mentions: `mentions` column, per-member
  `mention_count` (increment/decrement with clamp) and D1 inbox rows are synced
  (add creates, remove deletes). Broadcast mentions (`@[channel]`/`@[all]`)
  adjust every member on transition. Test:
  `test/worker/messaging/edit-mentions.test.ts`.

### Other

- Global search fans out to channel DOs with bounded concurrency (8) instead of
  sequentially.
- Fan-out deliveries (User DO pushes and structure events) now run in waves of
  50 subrequests so large channels/teams stay under Workers limits.
- Rate-limit regression test (`test/worker/messaging/rate-limit.test.ts`).
- Channel archive/restore HTTP routes covered
  (`test/worker/messaging/channel-archive.test.ts`).

## Deferred — backend (next round)

1. Audit log persistence: `auditLog` still writes to `console.info` only; add an
   `audit_logs` table + admin query endpoint.
2. Global rate limiting beyond `postMessage` (login, uploads, search, reactions,
   typing).
3. Push notification title: `UserDO.push` sends `channelId` as the title; needs a
   channel/author display name in the push payload.
4. D1↔DO reconciliation job (periodic drift check for memberships and counts).
5. `makeAuth` module-level `currentEnv` capture (fragile under concurrency).
6. WS JWT in the query string (prefer the session cookie).
7. Deploy pipeline does not apply D1 migrations automatically.
8. R2 thumbnail event notification still requires a one-off CLI command.

## Deferred — frontend / UI (not in this round)

These remain open and need UI work (tracked in the backend review):

1. Password reset / forgot-password pages (backend endpoint also missing).
2. Profile editing and avatar upload UI (no `PATCH /users/:id` endpoint yet).
3. Channel member management UI (adding other members; API only supports
   self-join and admin removal).
4. Admin entry point in the UI and registration-mode control (the API exists;
   `/admin` currently shows static copy).
5. DM notifications in the inbox (server kinds are `mention`/`reply` only).
6. Cross-device notification read state (no WS event; polling only).
7. Mobile app parity with the new notifications/search/settings features.
8. E2E coverage for presence, theme switching, notification read, channel
   settings, pins, threads, leave/browse/join flows.

> Note: `docs/` is listed in `.gitignore`, so this file is local-only and is not
> part of the commit.
