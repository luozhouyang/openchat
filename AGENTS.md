# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# openchat Toolchain (canonical — read before running any command)

Environment facts verified on this machine:

- `node`, `npm`, `npx`, `corepack`, `vp`, `vpr`, `vpx` on PATH all resolve to Vite+ managed
  binaries in `~/.vite-plus/bin/`. Do NOT use nvm to switch runtimes.
- **`pnpm` on PATH is nvm's 10.22 and CANNOT read this repo's committed lockfile.**
  Never run bare `pnpm`. Always go through `vp` (which uses pnpm 11.x via Vite+ corepack,
  matching the `packageManager` field).

## Command map (use these, never bare pnpm / npx / dlx)

| Task                            | Command                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Install deps                    | `vp install`                                                                                                                          |
| Add runtime dep                 | `vp add <pkg>`                                                                                                                        |
| Add dev dep                     | `vp add -D <pkg>`                                                                                                                     |
| Add to one workspace            | `vp add <pkg> --filter <name>`                                                                                                        |
| Remove dep                      | `vp remove <pkg>`                                                                                                                     |
| Run a package script/task       | `vp run <pkg>#<script>` (e.g. `vp run openchat#test`, `vp run openchat#types`, `vp run openchat#deploy:dry`, `vp run openchat#build`) |
| Run across all packages         | `vp run -r test` / `vp run -r check`                                                                                                  |
| Format / lint / typecheck       | `vp check` (all-in-one); `vp lint`, `vp fmt` alone                                                                                    |
| Tests                           | `vp test` (repo root); package tests via `vp run <pkg>#test`                                                                          |
| One-off binary (not a dep)      | `vp dlx <pkg>` or `vpx <pkg>` (e.g. `vp dlx shadcn@latest` from `apps/openchat`)                                                      |
| Exec a project-local binary     | `vp exec <bin>` (e.g. `vp exec wrangler types`)                                                                                       |
| Raw package-manager passthrough | `vp pm <cmd>...` (e.g. `vp pm --filter openchat exec wrangler types`)                                                                 |
| Show toolchain versions         | `vp toolchain` (do NOT rely on `node -v` / `pnpm -v`)                                                                                 |

Notes:

- `vp <name>` runs a built-in; `vp run <name>` runs a `package.json` script/task.
- Don't call `node -v`, `pnpm -v`, or `npm -v` directly — Vite+ binaries may not
  answer them cleanly; use `vp toolchain`.
- Root `vp test` runs the plain-Vitest suites only (shared `packages/*` +
  the openchat React app + desktop/push unit tests); the root `vite.config.ts`
  `test.exclude` keeps the special runners out:
  - `apps/openchat/test/worker` — Cloudflare vitest plugin + D1 migrations →
    `vp run openchat#test` (never `vp test` for the worker suite).
  - `apps/mobile` — jest-expo standalone workspace → `cd apps/mobile &&
corepack pnpm test`.
  - `apps/openchat/e2e` + `apps/desktop/e2e` — Playwright → `vp run
openchat#e2e` / `vp run desktop#e2e`.
- jsdom-dependent test files declare `// @vitest-environment jsdom` themselves
  (docblock) so they pass under both the per-package and root runners — keep
  that convention for new DOM-touching tests.
- New dependencies belong in `pnpm-workspace.yaml` `catalog:` (project convention)
  unless the package is used only once (then a direct pinned version is acceptable,
  matching how `better-auth` is handled).
