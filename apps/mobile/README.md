# openchat mobile (Expo)

Official scaffold: `create-expo-app --template blank-typescript` (Expo SDK 57).

## Package management — pnpm

This app is a **standalone single-project pnpm workspace** (see
`pnpm-workspace.yaml`) that also vendors the monorepo's shared source packages
(`protocol` / `realtime` / `state` / `platform`) via `workspace:*`. It lives
outside the repo-root pnpm workspace because React Native requires a **hoisted**
`node_modules` layout while the root toolchain requires pnpm's isolated layout.

```bash
corepack pnpm install        # install (from apps/mobile)
corepack pnpm test           # jest-expo unit tests
corepack pnpm exec tsc --noEmit
```

## Running

```bash
EXPO_PUBLIC_API_URL=http://localhost:8787 corepack pnpm exec expo start
# then press i / a, or use a development build (see E2E)
```

## Architecture (spec docs/specs/p10 §3–§5)

- `src/platform.ts` — `PlatformAdapter` implementation (AppState lifecycle,
  SecureStore-backed token storage, ws serverUrl).
- `src/db/expo-driver.ts` — `SqliteDriver` over expo-sqlite (same SQL schema as
  web/desktop, from `packages/state`).
- `src/lib/message-db.ts` — on-device message cache (hydrate / persist).
- `src/ws/client.ts` — `RealtimeClient` + event dispatch + persistence.
- `src/stores/messages.ts` — zustand message store (web parity semantics).
- `src/lib/push.ts` — expo-notifications registration + notification deep link.
- App lifecycle: background closes the socket, foreground reconnects + syncs.

## E2E (Maestro)

Requires: Maestro CLI, a running API (`vp run api#dev`), and a dev build on a
simulator (`corepack pnpm exec expo run:ios` / `run:android`).

```bash
EMAIL=... PASSWORD=... corepack pnpm e2e        # runs e2e/*.yaml
```
