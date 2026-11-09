## Why

The project grows into one Git repository with the game integration, a backend and a dashboard. Today the game fills the repository root, so there is no place for the other two projects. Moving the game into its own folder first gives the repository its planned shape: three fully independent, decoupled projects side by side, each with its own `package.json` and install, and no shared code or workspace tooling.

## What Changes

- Move the game's project files into `game/`: `index.html`, `package.json`, `pnpm-lock.yaml`, `public/`, `src/`, `tsconfig.json`, `vite.config.ts`.
- Keep repository-level files at the root: `README.md`, `LICENSE`, `.gitignore`, `.github/`, `.claude/`, `openspec/`.
- Update the GitHub Pages workflow to install, build and upload from `game/`.
- Update the README: install and run commands start with `cd game`, and file paths gain the `game/` prefix.
- No change to the game's code, behavior, dependencies, build output or tests. `backend/` and `dashboard/` are not created here; they come with their own changes.

## Capabilities

### New Capabilities
<!-- None: this is a pure restructure. -->

### Modified Capabilities
<!-- None: no spec-level behavior changes, so the change sets skip_specs: true. -->

## Impact

- **Files:** the seven game entries above move with `git mv`, so their history is kept.
- **Commands:** every `pnpm` command for the game now runs inside `game/`.
- **Deploy:** `.github/workflows/deploy-pages.yml` builds from `game/` and uploads `game/dist`. The deployed site is unchanged.
- **Docs:** README paths and commands. Archived OpenSpec changes are left as they were written.
