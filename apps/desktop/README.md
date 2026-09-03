# openchat desktop (Electron)

Official scaffold: `create-electron-app --template=vite-typescript` (Electron
Forge template structure), adapted to the spec's packaging stack:
**electron-builder** (dmg/zip + nsis + AppImage/deb) and **electron-updater**.
Managed by the repo-root **pnpm** workspace like every other package.

```bash
vp run desktop#build        # vite-build main + preload into .vite/build
vp run desktop#start        # build + electron .
vp run desktop#test         # unit tests (token store, deep-link parser)
vp run desktop#e2e          # Playwright Electron E2E (needs X / xvfb-run)
vp run desktop#package:dir  # electron-builder --dir smoke
vp run desktop#package      # full distributables per electron-builder.yml
```

## Architecture (spec docs/specs/p10 §4, §6.2)

- Renderer = the web app, loaded over http(s) (cookie auth works end to end)
  from `OPENCHAT_DESKTOP_URL` (default: packaged → production origin, dev →
  `http://localhost:8787`). A local file build can be loaded via
  `OPENCHAT_DESKTOP_FILE` for the file:// + bearer mode.
- `src/main.ts` — window, **tray-resident** close behavior, native
  `Notification` IPC, `safeStorage`-backed token store, `openchat://` deep
  link + single-instance focus, auto-updater (packaged + feed URL env only).
- `src/preload.ts` — least-privilege contextBridge (`openchatDesktop`:
  notify/getToken/setToken/clearToken/onNavigate); `contextIsolation: true`,
  `sandbox: true`, no `nodeIntegration`.
- `src/lib/token-store.ts` — DI'd safeStorage-backed token store (unit tested).
- `src/lib/deep-link.ts` — `openchat://c/<channelId>` parser (unit tested).
- Web side: `apps/openchat/src/react-app/lib/deep-link.ts` listens for `openchat:navigate`
  DOM events and routes to the channel's team.

## Auto-update

Packaged builds only, opt-in via `OPENCHAT_DESKTOP_UPDATE_URL` (generic
electron-updater feed hosted on R2 or GitHub Releases).

## Signing

macOS notarization/identity and Windows Azure Trusted Signing are configured
through electron-builder environment variables at release time (see
`electron-builder.yml`); local builds are unsigned.
