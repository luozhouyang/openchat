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

## Implemented — round 4 (UI)

### Password reset

- better-auth `sendResetPassword` hook + `sendPasswordResetMail` (logs the URL in
  dev, uses the EMAIL binding when configured).
- New `/auth/forgot-password` page (always shows the generic confirmation, so it
  cannot enumerate accounts) and `/auth/reset-password?token=...` page; the
  login page links to it and both routes are in the public-path allowlist.
- Worker tests cover no-enumeration and invalid-token behaviour; an e2e test
  covers the page.

### Profile editing and avatars

- `PATCH /api/v1/users/me` updates display name / nickname; `GET /users/me`
  now returns `name`.
- `POST /api/v1/users/me/avatar` accepts PNG/JPEG/WebP up to 2 MB and stores the
  object in R2 (`avatars/{userId}`); `GET /users/:id/avatar` serves it publicly
  with cache headers. The settings page has an avatar preview/upload and the
  name/nickname form; existing avatar renderers pick the new image up through
  the users store.
- Worker tests plus an e2e test cover the upload and persistence.

### Channel member management

- `POST /channels/:channelId/members/:userId` lets channel admins add another
  team member (idempotent); `ChannelDetail.callerRole` exposes the caller role.
- The members dialog shows an admin-only search + add section with inline
  confirmation.
- Worker tests cover admin add, duplicate add, non-team targets and 403 for
  non-admins.

## Implemented — round 5

### Admin console

- The user menu shows an "Admin console" entry when `role === "admin"`;
  `GET /users/me` now returns `role`.
- Admin page: a registration-mode control backed by `GET/PUT /admin/settings`
  and an audit-log tab backed by `GET /admin/audit` (protocol types and client
  methods added).
- App tests cover the registration control and the audit table; a worker test
  covers the settings roundtrip, 403 and 422 paths.

### Cross-device notification read

- `POST /users/me/notifications/read` now pushes a `notifications.read` frame to
  the user's DO, so other tabs/devices clear the bell immediately instead of
  waiting for the poll.
- Covered by a worker test that reads the frame from a live websocket.

### E2E coverage

- New specs: theme persistence across reloads, pinning a message and finding it
  in the pinned dialog, replying in the thread panel, the notification bell
  clearing after an entry is opened, online presence in the members dialog,
  leaving a channel, and browsing/joining a public channel (the join flow now
  reloads the workspace payload so the sidebar cannot stay stale).

## Implemented — round 6 (mobile)

### Notification inbox

- The workspace screen header shows a 通知 button with the unread count; tapping
  it opens a modal inbox fed by `GET /users/me/notifications` (loaded on mount
  and refreshed every 60 seconds).
- Tapping an entry marks it read and opens the owning channel; kind labels
  (提及/回复/私信) live in `apps/mobile/src/lib/notifications.ts` with a jest
  test.

### Channel search

- The channel header has a 搜索 button opening a modal with a debounced (250 ms)
  query against `GET /channels/:id/posts/search`; results show author id and
  content with empty/loading states.

### Presence and author names

- Channel messages resolve author ids through the batch users endpoint and show
  nickname/name/username plus a presence dot from the batch status endpoint;
  helpers live in `apps/mobile/src/lib/people.ts` with a jest test.

### Settings (push toggle)

- The workspace header has a 设置 button opening a modal with a push-notification
  switch backed by `GET/POST/DELETE /users/me/push_subscriptions` (client
  methods added) and the existing Expo registration helper.
- Theme/language remain web-only for now; the modal says so.

## Deferred — backend

1. Distributed rate limiting: the current limiter is per isolate; move to a
   Durable Object or Cloudflare Rate Limiting binding if abuse needs hard limits.
2. Search indexing/ranking (current search is a bounded substring scan).

## Deferred — frontend / UI

1. Mobile parity: theme/language settings and threads are still missing from
   `apps/mobile`.
2. E2E coverage for channel settings saves (the team settings path is covered).

> Note: `docs/` is listed in `.gitignore`; this file was committed explicitly
> with `git add -f`, other docs stay local.
