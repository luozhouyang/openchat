# P15 — Backend hardening (2026-11-08)

Follow-up to the backend review. Rounds 1–2 are backend-only; every UI item
listed at the end is intentionally deferred.

## Implemented — round 1

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

- `ChannelDO.alarm` enforces `MESSAGE_RETENTION_MS` (90 days) in bounded passes
  via `purgeMessagesBefore` (messages + reactions + thread rows + sidebar meta
  refresh). Seq is AUTOINCREMENT, so gaps never reuse ids.
- New hourly cron (`wrangler.jsonc` `triggers.crons`) runs `runMaintenance`
  (`src/worker/maintenance.ts`): deletes notifications older than 90 days,
  abandoned upload sessions older than 24 hours, and invites expired more than
  30 days ago (`test/worker/maintenance/maintenance.test.ts`).
- `recordNotifications` and thread-reply pushes run under `waitUntil`, so D1
  writes and per-subscriber pushes no longer delay the post ack.

### Message edits

- Editing a message re-parses `@[id]` mentions: `mentions` column, per-member
  `mention_count` (increment/decrement with clamp) and D1 inbox rows are synced
  (add creates, remove deletes). Broadcast mentions (`@[channel]`/`@[all]`)
  adjust every member on transition (`test/worker/messaging/edit-mentions.test.ts`).

### Other (round 1)

- Global search fans out to channel DOs with bounded concurrency (8).
- Fan-out deliveries (User DO pushes and structure events) run in waves of 50
  subrequests so large channels/teams stay under Workers limits.
- Rate-limit regression test (`test/worker/messaging/rate-limit.test.ts`).
- Channel archive/restore HTTP routes covered
  (`test/worker/messaging/channel-archive.test.ts`).

## Implemented — round 2

### Audit log persistence

- New D1 `audit_logs` table (migration `0019_adorable_harrier.sql`) with
  `idx_audit_created` / `idx_audit_actor`.
- `auditLog(db, entry)` still writes the `admin.audit` log line and now inserts
  the row (best-effort: a storage failure never fails the request). All call
  sites updated (admin actions, registration gating, ban disconnect).
- New `GET /api/v1/admin/audit?limit=&before=` returns
  `{ entries: [{ id, actorId, action, target, status, detail, createdAt }] }`
  (`test/worker/admin/audit.test.ts`).

### API rate limiting

- New `lib/rate-limit.ts`: per-isolate fixed windows keyed by user id (IP
  fallback), bounded map (10k buckets), `429 { error: "rate_limited" }`.
- Wired after `requireSession`: `GET /search` 20/min, `POST /uploads` 30/min,
  `POST /reactions` + reaction delete 120/min
  (`test/worker/routes/rate-limit.test.ts`).
- Authentication endpoints keep better-auth's built-in limiter.

### Push notification title

- `message.new` fan-out now carries `channelDisplayName` (cached in DO storage
  for 5 minutes, D1 as the source of truth).
- `UserDO.push` uses it as the web-push title instead of the raw channel id
  (`test/worker/messaging/push-title.test.ts`).

### WebSocket auth

- `/ws` accepts the same-origin session cookie when no bearer token is present;
  the query-string JWT stays supported for the desktop client
  (`test/worker/auth/ws-cookie.test.ts`).

### D1 ↔ DO reconciliation

- `services/reconcile.service.ts`: `reconcileChannel` makes `member_state` match
  D1 `channel_members` (adds missing, removes extra, preserves admin role);
  `reconcileBatch` walks channels with a `system_settings` cursor.
- `POST /api/v1/admin/channels/:channelId/reconcile` for on-demand repair.
- The hourly cron reconciles 5 channels per run after maintenance
  (`test/worker/admin/reconcile.test.ts`).

### Operations

- `vp run openchat#deploy` now applies remote D1 migrations before
  `wrangler deploy`.
- `vp run push#setup:r2-events` registers the R2 object-create notification for
  the thumbnail queue (R2 notifications cannot be declared in `wrangler.jsonc`).
- `makeAuth` captures `env` in its closures instead of a module-level variable.

## Implemented — round 3

### DM notifications

- `NotificationKindSchema` gains `dm`; DM/GM channels now create an inbox row
  for every member except the sender (mention/reply still win over `dm`).
- The channel type is cached in DO storage for 5 minutes, mirroring the display
  name cache (`test/worker/notifications/dm-notifications.test.ts`).
- `notifications.dm` labels added to the en/zh locales, so the existing inbox
  dialog renders DM entries without further UI work.

## Deferred — backend

1. Distributed rate limiting: the current limiter is per isolate; move to a
   Durable Object or Cloudflare Rate Limiting binding if abuse needs hard limits.
2. Search indexing/ranking (current search is a bounded substring scan).

## Deferred — frontend / UI

1. Password reset / forgot-password pages (backend endpoint also missing).
2. Profile editing and avatar upload UI (no `PATCH /users/:id` endpoint yet).
3. Channel member management UI (adding other members; API only supports
   self-join and admin removal).
4. Admin entry point in the UI and registration-mode control (the API exists;
   `/admin` currently shows static copy). Audit log viewer also missing.
5. Cross-device notification read state (needs a WS event plus client handling).
6. Mobile app parity with the new notifications/search/settings features.
7. E2E coverage for presence, theme switching, notification read, channel
   settings, pins, threads, leave/browse/join flows.

> Note: `docs/` is listed in `.gitignore`; this file was committed explicitly
> with `git add -f`, other docs stay local.
