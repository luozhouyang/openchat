# Services

Services wrap business logic and DB/Durable Object operations. They sit between
thin HTTP routes and data-access repos.

## Conventions

- **Services own business logic.** Routes parse and validate input, then delegate
  to a service. Services never parse HTTP bodies or touch `c` (the Hono context).
- **Repos are data-access only.** Repos in `../db/repos/*` execute single queries
  and never encode business rules (e.g. who may join a team, admin transfer rules).
- **Multi-write operations use `db.batch([...])`.** D1 `batch` is atomic
  (all-or-nothing) and is the only transaction mechanism available to the D1
  binding in workerd. drizzle's `db.transaction()` issues `BEGIN TRANSACTION` /
  `SAVEPOINT` SQL, which the workerd D1 binding rejects — **do NOT use it**
  (error: "please use the state.storage.transaction() ... instead of the SQL BEGIN
  TRANSACTION").
- **Duplicate-name conflicts** are detected with `insert().onConflictDoNothing()`
  followed by a re-fetch. If the re-fetch misses the row, the insert lost a
  conflict and the service throws `apiError("name_taken", "name taken", 409)`.
- **Errors are thrown as `HttpError`** via `apiError(code, message, status)` from
  `../lib/errors.ts`. Routes catch `HttpError` and map it to `{ error: err.code }`
  with `err.status` (legacy REST shape).
- **Routes are thin.** They keep guards (`requireSession`, `requireTeamRole`,
  `requireChannelRole`), parse zod inputs from `protocol`, call a service, and
  shape the JSON response.
- **DO side-effects stay in routes.** `syncUserChannels`, `syncChannelMember`,
  `removeChannelMemberFromDo`, etc. need `env`, so they live in the route after the
  service call. Service functions take `db` as their first argument and never
  touch `env` directly.
