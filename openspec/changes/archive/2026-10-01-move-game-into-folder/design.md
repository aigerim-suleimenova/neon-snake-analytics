## Context

See proposal.md for the motivation. The game is a self-contained Vite project at the repository root; its paths are all relative to its own folder (`vite.config.ts` reads `index.html` and `src/main.ts`, `public/` is Vite's default, `tsconfig.json` includes `src`). The only places that assume the game sits at the root are the GitHub Pages workflow and the README.

## Goals / Non-Goals

**Goals:**
- The game builds, tests and deploys from `game/` exactly as it does today.
- The repository is ready for `backend/` and `dashboard/` as further independent projects.

**Non-Goals:**
- Creating `backend/` or `dashboard/`, or any root `package.json`.
- Any change to the game's code, dependencies or output.

## Decisions

### 1. Fully independent projects, no workspace
Each project keeps its own `package.json`, lockfile and `node_modules`, and is installed and run inside its own folder. Nothing is shared between projects; they will talk only over HTTP.

*Alternative:* a pnpm workspace with a shared event package. Rejected by choice: the projects stay decoupled and each can be understood, run or moved on its own, at the cost of describing the event format on both sides of the API.

### 2. Move with `git mv`
The seven game entries move in one step with `git mv`, so `git log --follow` keeps their history. `node_modules/` and `dist/` are ignored and are recreated inside `game/` by `pnpm install` and `pnpm build`; `.gitignore` already matches them in any folder.

### 3. Workflow runs inside `game/`
`deploy-pages.yml` sets `defaults.run.working-directory: game`, points the pnpm cache at `game/pnpm-lock.yaml` (`cache-dependency-path`) and uploads `game/dist`. The pnpm version stays pinned in the workflow, so it does not depend on where `package.json` sits.

*Alternative:* `cd game` inside every `run` step. Rejected: easier to miss a step.

### 4. A root script to start everything comes later
A small root `package.json` that starts all projects at once is useful only when there is more than one project. It is left to the backend change; until then the README says `cd game`.

## Risks / Trade-offs

- [The deploy workflow can only be fully checked on GitHub] → Run `pnpm install --frozen-lockfile` and `pnpm build` inside `game/` locally, the same commands the workflow runs, and check that `game/dist` holds `index.html`, `game.js`, `game.css` and `famobi.json`.
- [Editors or terminals still pointing at the old root paths] → The README states `cd game` at the top of every game command.
