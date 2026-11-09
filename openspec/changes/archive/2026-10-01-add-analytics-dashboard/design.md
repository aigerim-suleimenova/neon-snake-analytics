## Context

See proposal.md for the motivation and specs/analytics/dashboard/ for the required behavior.

- The backend serves `GET /api/stats/overview` and `GET /api/stats/levels` as documented in `backend/API.md`; both answer `503` when the store misses its 3 s deadline. CORS already allows `http://localhost:5174`.
- The repository holds independent projects (`game/`, `backend/`) that share no code and talk only over HTTP. Both use pnpm 11, TypeScript 7, Vite 8 (game) and Vitest 5.
- The visual reference is `Neon Snake Analytics.dc.html` from Claude Design: dark theme, Inter and IBM Plex Mono, KPI cards, three bar graphs, a table, and loading, empty and error variants. Its sample data was checked against the API's meanings.
- New code follows SOLID with small injected interfaces and adapters at the edges.

## Goals / Non-Goals

**Goals:**
- Every rule about labels, formats, ties and "—" lives in pure functions that are unit-tested without React or HTTP.
- Components only display a prepared view model; the HTTP client is one implementation of a small interface.
- A small bundle and few dependencies: React, React DOM and Zod at runtime.

**Non-Goals:**
- A chart library, axes with computed tick rounding, animations.
- Routing, global state libraries, server-side rendering.
- End-to-end tests against the emulator (checked by hand in the last task instead).

## Decisions

### 1. Project setup
`dashboard/` is its own Vite + React + TypeScript project with its own `package.json` and pnpm lock, like `game/` and `backend/`. Scripts: `dev` and `preview` (both on port 5174 with `strictPort`, so neither lands on a port CORS rejects or on the game's preview port 4173), `build`, `check`, `test` (`--passWithNoTests`, like the other projects). The backend address comes from `VITE_API_URL` (default `http://localhost:3000`), documented in `dashboard/.env.example`. Fonts are loaded from Google Fonts with system fallbacks, so the page also works offline.

*Alternative:* a workspace with a shared types package. Rejected: the projects stay decoupled by choice; the dashboard keeps its own copy of the response types, checked at runtime.

### 2. Layering
```
main.tsx (composition root: config → HttpStatsApi → <App api clock>)
  └─ App + useDashboard(api, clock)   state: loading | ready | refreshing | error | retrying; refresh(), retry()
       └─ view/toDashboardView(overview, levels)   pure: KPIs, rows, segments, scale, labels, formats
            └─ components/   Header, Notice, KpiGrid, ChartCard, CompletionChart, StackedBarChart, LevelTable
api/
  StatsApi           interface { getOverview(): Promise<Overview>; getLevels(): Promise<LevelStats[]> }
  HttpStatsApi       fetch adapter: base URL, injected fetch, timeout, response check → StatsUnavailableError
  FakeStatsApi       test double with controllable answers
```
- `toDashboardView` is the only place that knows the formatting rules (spec: Number formats, Per-level table). It returns plain strings, numbers and percentages for widths, so components contain no logic beyond mapping.
- `StackedBarChart` is generic (rows of segments + legend + total) and used for both failure graphs; `CompletionChart` is the single-value variant.
- `useDashboard` is the only place with effects. It takes the `StatsApi` and a `Clock` (`now(): Date`) as parameters, so tests drive it with fakes and a fixed time.

*Alternative:* fetching and formatting inside the components. Rejected: the rules would be spread over the UI and need DOM tests for every edge case.

### 3. Loading model
```
            open
              │
          ┌───▼────┐   both ok    ┌───────┐  Refresh  ┌────────────┐
          │loading │─────────────▶│ ready │──────────▶│ refreshing │
          └───┬────┘              └───▲───┘◀──────────└─────┬──────┘
              │ any failure           │ both ok   ok         │ any failure
              ▼                       │                      ▼
          ┌───────┐  Retry  ┌──────────┐                ┌───────┐
          │ error │────────▶│ retrying │─── failure ───▶│ error │
          └───────┘         └──────────┘                └───────┘
```
- Both requests run in parallel (`Promise.all`); the first failure moves to `error` (spec: no partial view).
- "Empty" is not a state of its own: it is `ready` with `overview.runs === 0`, decided in the view model.
- Refresh and Retry are disabled while a load runs, so there is never more than one load in flight and no stale answer can overwrite a newer one. A load started before unmount is ignored after unmount.
- No polling: the "Updated HH:MM" status shows how old the data is, and a demo is "play a level, click Refresh".

*Alternative:* polling every few seconds. Rejected: a dashboard looked at now and then does not need live data, and polling adds timers, overlapping requests and flicker for little gain.

*Alternative:* keep old data visible with an error banner when a refresh fails. Rejected for now: one error state is simpler to build and test; listed as an improvement.

### 4. HTTP client
`HttpStatsApi` calls `${baseUrl}/api/stats/overview` and `/levels` with `AbortSignal.timeout(10 s)` (above the backend's 3 s store deadline, so the backend's `503` normally arrives first). A network error, a timeout, a non-2xx status or a body that fails the Zod schema becomes a `StatsUnavailableError`. The schemas mirror `backend/API.md` (counts as non-negative integers, rates in 0–1 or `null`, all five progress ranges and four reasons present).

*Alternative:* trust the response type without checking. Rejected: a changed or broken backend would render `NaN` and `undefined` instead of the error state.

### 5. Graphs as plain CSS bars
Bars are `div`s with percentage widths or heights computed in the view model. The completion graph uses a fixed 0–100% scale. Both failure graphs share one scale: the largest failed-run count of any level is 100% width (spec: shared scale), and each bar shows its total as text, so no axis is needed. When that largest count is 0, all widths are 0 (no division by zero). Hover details use the native `title`; each bar has an `aria-label` with the level, total and per-segment counts.

*Alternative:* Recharts. Rejected: about 100 kB more bundle and a new API for three simple bar graphs; axes and tooltips it would add are covered by printed values, legends and labels.

### 6. Which graphs and why
- **Completion rate by level:** the difficulty curve; the single most useful per-level number.
- **Failed runs by progress:** where in a level players fail (early fails point to the start of a level, late fails to its end).
- **Failed runs by reason:** why they fail (walls, own tail, obstacles, platform game over).

The raw outcome counts, including unfinished runs, are in the table instead of a fourth graph, because a stacked outcome graph would mostly repeat the completion rate. This reasoning goes into the README.

### 7. Styling
Design tokens (colors, fonts, radii) are CSS custom properties in one global stylesheet; components use CSS Modules, which Vite supports without extra dependencies. Fixes compared to the reference:
- Reason colors differ in hue and do not repeat an outcome color: Wall `#F5B841` (amber), Self collision `#A88BFF` (violet), Obstacle `#2BB3A3` (teal), Ended by platform `#9AA8BC` (grey).
- The progress ranges use a neutral slate ramp ordered by lightness, so they carry no outcome meaning and never reuse the "complete" green `#39FF88`: 0–19% `#3B4A5E`, 20–39% `#56677F`, 40–59% `#7489A3`, 60–79% `#9DB0C6`, 80–99% `#CBD7E4`.
- Table rows have no `tabIndex`.
- The ↻ text glyph becomes a small inline SVG icon. The layout uses wrapping grids (KPIs and graphs reflow on narrow screens) and the table scrolls inside its card.

### 8. From the design file to React
The `.dc.html` runs on Claude Design's runtime (`support.js`), which is not used. It is translated, not copied:

| Design file | React |
|---|---|
| colors, fonts, radii in inline styles | CSS variables in `styles/tokens.css` (with the fixes in §7) |
| inline `style` per element | one CSS Module per component, same sizes and spacing |
| `renderVals()` (formats, ties, "—", bar widths) | `view/toDashboardView.ts` (pure, unit-tested) |
| hard-coded `BASE` sample data | test fixtures and `FakeStatsApi` answers |
| `<sc-if>` / `<sc-for>` | conditional rendering / `array.map` with stable keys |
| `state` switch and fake refresh timer | the real load states in `useDashboard` |
| `style-hover`, `title` | CSS `:hover`; `title` + `aria-label` on bars |

```
<App>
├─ <Header>          eyebrow · title · subtitle · status · Refresh
├─ <Notice>          empty notice | error notice + Retry
├─ <KpiGrid>         6 × KPI card (key figure, skeleton, unavailable)
├─ graphs grid
│   ├─ <ChartCard> ── <CompletionChart>
│   ├─ <ChartCard> ── <StackedBarChart>  (progress)
│   └─ <ChartCard> ── <StackedBarChart>  (reason)
├─ <LevelTable>      10 columns, skeleton rows, message row
└─ footer
```
`ChartCard` holds the shared skeleton, "No level data yet" and "Data unavailable" variants once. Layout, spacing, copy and states follow the design; the only differences are the fixes in §7. After the UI is composed, the app is run with the design's sample data and compared with the design file side by side at desktop and phone width.

### 9. React conventions
- **Structure:** components only display a prepared view model; no `fetch`, formatting or rules inside them. One component per file, named exports, a typed `Props` interface. Folders `api/`, `view/`, `hooks/`, `components/`, `styles/`.
- **Effects in one place:** only `useDashboard` has effects. Its load is cancelled in the effect cleanup (`AbortController`) and answers after unmount are ignored, so `<StrictMode>` (kept on) running effects twice in development causes no double state.
- **Dependencies injected:** `App` receives `api` and `clock` from `main.tsx`; nothing creates `HttpStatsApi` or reads `Date.now()` itself.
- **State:** one union for the load state (via `useReducer`), not several booleans; nothing derivable (empty flag, labels) is stored in state or synced with an effect. No context or global store: props are enough.
- **Types:** strict TypeScript, no `any`; response types come from the Zod schemas with `z.infer`. `useMemo`/`useCallback` only when a measured problem needs them.
- **Lists:** stable keys (`level.level`, range or reason key), never the array index.
- **Styling:** CSS Modules and the token variables; inline styles only for computed bar sizes.
- **Accessibility:** `<button>` for actions, a real `<table>` with `<th scope>`, headings in order, a visible focus outline, no handlers or `tabIndex` on non-interactive elements.
- **Tests:** Testing Library queries by role and visible text, not by class or test ID; rules are unit-tested on `toDashboardView`, not through the DOM.

### 10. Tests
- `toDashboardView`: every spec scenario: formats, zero vs `null`, minimal 0% bar, shared scale (also with no failed runs at all), ties for Most fails at and Top failure reason, the empty overview, a level with only unfinished runs.
- `HttpStatsApi` with a fake `fetch`: success, non-2xx, invalid body, network error, timeout.
- `useDashboard` / `App` with `FakeStatsApi` and a fixed clock (Testing Library, jsdom): loading, ready with "Updated 12:04", refreshing keeps data and disables the button, empty, error with one request failing, Retry back to ready, no request without a click.

## Risks / Trade-offs

- [Without a chart library, the graphs have no axis ticks] → Each bar prints its value or total, the completion graph has a fixed 0/50/100% guide, and the shared scale is stated under the failure graphs.
- [The response types are copied from `backend/API.md` and can drift] → Runtime checks turn a drift into the visible error state instead of wrong numbers; the README points to `API.md` as the one contract.
- [The two requests are not one snapshot: an event stored between them can make the overview's run count differ by one from the table's sum] → Only visible while someone is playing and fixed by the next Refresh; the empty state is decided from the overview alone; noted as a README limitation.
- [Many levels make the page long] → One row per level is fine for the game's level count; paging or a level filter is listed as an improvement.
- [Data only changes on Refresh] → The status shows when it was loaded; automatic refresh is listed as an improvement.
- [Fonts from Google Fonts need a network] → System font fallbacks keep the layout usable offline.
