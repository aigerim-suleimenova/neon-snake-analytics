import { MAX_BATCH_EVENTS } from '@neon-snake/contract';
import { generateDemoEvents, seededRandom } from './seed/demoEvents';

// Fills a running backend with demo gameplay, so the dashboard has data without playing first.
// Posts through the real API, so every event is validated like the game's. Same data on every run:
// a second run only reports duplicates.
const apiUrl = process.env.SEED_API_URL ?? 'http://localhost:3000';
const sessions = Number(process.env.SEED_SESSIONS ?? 40);

const events = generateDemoEvents(seededRandom(2026), { sessions, start: new Date('2026-10-01T09:00:00.000Z') });
const totals = { accepted: 0, duplicates: 0, rejected: 0 };
const ATTEMPTS = 5;

/**
 * Resends on `503` (e.g. the store's slow first call after a start), which the API says is safe, and on
 * `429` after the `Retry-After` wait, which a large SEED_SESSIONS reaches.
 */
async function post(batch: unknown[]): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${apiUrl}/api/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch)
    });
    if ((response.status !== 503 && response.status !== 429) || attempt === ATTEMPTS) return response;
    const waitSeconds = Number(response.headers.get('Retry-After') ?? 1);
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
  }
}

try {
  for (let i = 0; i < events.length; i += MAX_BATCH_EVENTS) {
    const response = await post(events.slice(i, i + MAX_BATCH_EVENTS));
    if (response.status !== 202) throw new Error(`POST /api/events answered ${response.status}: ${await response.text()}`);
    const result = (await response.json()) as { accepted: number; duplicates: number; rejected: unknown[] };
    totals.accepted += result.accepted;
    totals.duplicates += result.duplicates;
    totals.rejected += result.rejected.length;
  }
} catch (error) {
  console.error(`Seeding ${apiUrl} failed. Is the backend running (pnpm dev)?`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

console.log(
  `Seeded ${sessions} sessions (${events.length} events): ${totals.accepted} accepted, ` +
    `${totals.duplicates} duplicates, ${totals.rejected} rejected.`
);
