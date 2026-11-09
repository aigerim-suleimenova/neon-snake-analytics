## 1. Move the game

- [x] 1.1 Move `index.html`, `package.json`, `pnpm-lock.yaml`, `public/`, `src/`, `tsconfig.json` and `vite.config.ts` into `game/` with `git mv`, and delete the old root `node_modules/` and `dist/`; verify `git status` shows only renames and the root keeps only `README.md`, `LICENSE`, `.gitignore`, `.github/`, `.claude/` and `openspec/`
- [x] 1.2 In `game/`, run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test` and `pnpm build`; verify all pass (34 tests) and `game/dist` contains `index.html`, `game.js`, `game.css` and `famobi.json`
- [x] 1.3 Run `pnpm dev` in `game/` and open http://localhost:5173/; verify the game loads through the local tester (`gameReady()` in the console) and a level can be started

## 2. Deploy workflow

- [x] 2.1 Update `.github/workflows/deploy-pages.yml` to run in `game/` (`defaults.run.working-directory`), cache `game/pnpm-lock.yaml` and upload `game/dist`; verify by reading the file that every step uses `game/` and nothing else changed

## 3. README

- [x] 3.1 Update the README: install and run commands start with `cd game`, the project structure and file paths gain the `game/` prefix, and a short note says `backend/` and `dashboard/` will sit next to `game/` as independent projects; verify every path in the README exists
