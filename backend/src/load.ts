import type { Overview } from '@neon-snake/contract';
import { InMemoryEventStore } from './adapters/InMemoryEventStore';
import { planLoad, percentile, type PlannedPost } from './load/loadPlan';
import { MAX_EVENTS_PER_BATCH } from './ports/EventStore';
import { seededRandom } from './seed/demoEvents';
import { overview } from './services/stats';

// Posts made-up gameplay to a running API at a fixed rate and checks the statistics end up exactly right.
// Each simulated player posts each event on its own, from its own client IP in X-Forwarded-For, so start the
// API with TRUST_PROXY=1, as behind a load balancer. With Kafka, the worker stores the events after the
// posts, so the check waits up to LOAD_DRAIN_SECONDS for the statistics to catch up.
// With LOAD_READERS, that many dashboards poll both statistics routes meanwhile, each from its own IP; the run
// then also fails if any viewer saw the numbers go backwards. LOAD_EVENTS_PER_SECOND=0 tests reads alone.
const apiUrl = process.env.LOAD_API_URL ?? 'http://localhost:3000';
const eventsPerSecond = Number(process.env.LOAD_EVENTS_PER_SECOND ?? 200);
const seconds = Number(process.env.LOAD_SECONDS ?? 30);
const resendRate = Number(process.env.LOAD_RESEND_RATE ?? 0.05);
// Three seconds between a player's events keeps each one below the 1 post per second the API allows.
const concurrentSessions = Number(process.env.LOAD_SESSIONS ?? eventsPerSecond * 3);
const drainSeconds = Number(process.env.LOAD_DRAIN_SECONDS ?? 60);
const readers = Number(process.env.LOAD_READERS ?? 0);
// Each viewer asks for both routes every 2 s: one request per second per IP, half what the API allows.
const readIntervalMs = Number(process.env.LOAD_READ_INTERVAL_MS ?? 2000);

/** Like the game: 408, 429, 5xx and network errors are retried; 429 after its Retry-After. */
const ATTEMPTS = 5;
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const tag = Date.now().toString(36);
const plan = planLoad({ eventsPerSecond, seconds, resendRate, concurrentSessions, tag, random: seededRandom(Date.now()), now: new Date() });

const latencies: number[] = [];
const statuses = new Map<string, number>();
const results = { accepted: 0, duplicates: 0, rejected: 0, failed: 0, retries: 0 };
let inFlight = 0;
let maxInFlight = 0;

const count = (status: string) => statuses.set(status, (statuses.get(status) ?? 0) + 1);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function send(post: PlannedPost): Promise<void> {
  inFlight += 1;
  maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const started = performance.now();
      let response: Response | null = null;
      try {
        response = await fetch(`${apiUrl}/api/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': post.clientIp },
          body: JSON.stringify([post.event]),
          signal: AbortSignal.timeout(5000)
        });
      } catch (error) {
        count(error instanceof Error && error.name === 'TimeoutError' ? 'timeout (5 s)' : 'network error');
      }
      latencies.push(performance.now() - started);
      if (response) count(String(response.status));

      if (response?.status === 202) {
        const body = (await response.json()) as { accepted: number; duplicates: number; rejected: unknown[] };
        results.accepted += body.accepted;
        results.duplicates += body.duplicates;
        results.rejected += body.rejected.length;
        return;
      }
      if (response && !RETRY_STATUSES.has(response.status)) break;
      if (attempt < ATTEMPTS) {
        results.retries += 1;
        // The game's backoff: 1 s doubling, ±20 % so retries spread out, or the API's Retry-After if longer.
        const backoffMs = 1000 * 2 ** (attempt - 1) * (0.8 + Math.random() * 0.4);
        await sleep(Math.max(backoffMs, Number(response?.headers.get('Retry-After') ?? 0) * 1000));
      }
    }
    results.failed += 1;
  } finally {
    inFlight -= 1;
  }
}

/** Retried for up to 30 s: an overloaded store answers 503 for a while, which is part of what is measured. */
const reads = { latencies: [] as number[], statuses: new Map<string, number>(), backwards: 0 };
const countRead = (status: string) => reads.statuses.set(status, (reads.statuses.get(status) ?? 0) + 1);

async function timedGet(path: string, clientIp: string): Promise<unknown> {
  const started = performance.now();
  try {
    const response = await fetch(`${apiUrl}${path}`, { headers: { 'X-Forwarded-For': clientIp }, signal: AbortSignal.timeout(5000) });
    countRead(String(response.status));
    return response.ok ? await response.json() : null;
  } catch (error) {
    countRead(error instanceof Error && error.name === 'TimeoutError' ? 'timeout (5 s)' : 'network error');
    return null;
  } finally {
    reads.latencies.push(performance.now() - started);
  }
}

/** One dashboard: asks for both routes every interval until told to stop, and notes if `runs` ever goes down. */
async function view(index: number, stop: () => boolean): Promise<void> {
  const clientIp = `198.20.${Math.floor(index / 250) % 256}.${(index % 250) + 1}`;
  let lastRuns = -1;
  await sleep(Math.random() * readIntervalMs);
  while (!stop()) {
    const started = performance.now();
    const [overviewBody] = await Promise.all([timedGet('/api/stats/overview', clientIp), timedGet('/api/stats/levels', clientIp)]);
    const runs = (overviewBody as Overview | null)?.runs;
    if (runs !== undefined) {
      if (runs < lastRuns) reads.backwards += 1;
      lastRuns = runs;
    }
    await sleep(Math.max(0, readIntervalMs - (performance.now() - started)));
  }
}

async function readOverview(): Promise<Overview> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${apiUrl}/api/stats/overview`, { headers: { 'X-Forwarded-For': '198.19.0.1' } }).catch(() => null);
    if (response?.ok) return (await response.json()) as Overview;
    if (attempt === 30) throw new Error(`GET /api/stats/overview answered ${response?.status ?? 'nothing'}`);
    await sleep(1000);
  }
}

/** The statistics the plan's events add on their own, from the same code the backend counts with. */
async function expectedChange(): Promise<Overview> {
  const store = new InMemoryEventStore();
  const received = plan.events.map((event) => ({ event, receivedAt: new Date() }));
  for (let start = 0; start < received.length; start += MAX_EVENTS_PER_BATCH) {
    await store.saveEvents(received.slice(start, start + MAX_EVENTS_PER_BATCH), 'expected');
  }
  return overview(await store.readStats());
}

const COMPARED = ['sessions', 'runs', 'finished', 'unfinished'] as const;
const changeBetween = (before: Overview, after: Overview) =>
  Object.fromEntries(COMPARED.map((field) => [field, after[field] - before[field]])) as Record<(typeof COMPARED)[number], number>;

/** Waits until the statistics stop changing, so events still being stored from an earlier run are not counted. */
async function settledOverview(): Promise<Overview> {
  let previous = await readOverview();
  for (let checks = 0; checks < 30; checks += 1) {
    await sleep(2000);
    const current = await readOverview();
    if (COMPARED.every((field) => current[field] === previous[field])) return current;
    previous = current;
  }
  throw new Error('The statistics are still changing after 60 s; is an earlier run still being stored?');
}

try {
  const before = await settledOverview();
  const expected = await expectedChange();
  if (readers > 0) console.log(`${readers} dashboards polling both statistics routes every ${readIntervalMs} ms.`);
  console.log(
    `Posting ${plan.posts.length} requests (${plan.events.length} events, ${plan.posts.length - plan.events.length} resends) ` +
      `to ${apiUrl} at ${eventsPerSecond} events/s for ${seconds} s, ${concurrentSessions} players at once.`
  );

  const start = performance.now();
  let writesDone = false;
  const viewing = Array.from({ length: readers }, (_, index) =>
    view(index, () => writesDone && performance.now() - start >= seconds * 1000)
  );
  const sending: Promise<void>[] = [];
  for (let index = 0; index < plan.posts.length; ) {
    const elapsed = performance.now() - start;
    while (index < plan.posts.length && plan.posts[index].atMs <= elapsed) sending.push(send(plan.posts[index++]));
    if (index < plan.posts.length) await sleep(Math.min(5, plan.posts[index].atMs - elapsed));
  }
  const sentIn = (performance.now() - start) / 1000;
  await Promise.all(sending);
  const doneIn = (performance.now() - start) / 1000;
  writesDone = true;
  await Promise.all(viewing);
  const viewedIn = (performance.now() - start) / 1000;

  // The statistics are cached for a second, and with Kafka the worker stores the events after the answers.
  const target = Object.fromEntries(COMPARED.map((field) => [field, expected[field]])) as ReturnType<typeof changeBetween>;
  let change = changeBetween(before, await readOverview());
  const drainStart = performance.now();
  while (COMPARED.some((field) => change[field] !== target[field]) && performance.now() - drainStart < drainSeconds * 1000) {
    await sleep(1000);
    change = changeBetween(before, await readOverview());
  }
  const drainedIn = (performance.now() - drainStart) / 1000;

  latencies.sort((a, b) => a - b);
  reads.latencies.sort((a, b) => a - b);
  const ms = (value: number) => `${value.toFixed(1)} ms`;
  const readCount = reads.latencies.length;
  const readsOk = readers === 0 || (reads.backwards === 0 && readCount > 0 && [...reads.statuses.keys()].every((status) => status === '200'));
  if (readers > 0) {
    console.log(`
Reads       ${readCount} requests from ${readers} dashboards in ${viewedIn.toFixed(1)} s (${(readCount / viewedIn).toFixed(0)}/s)
Latency     p50 ${ms(percentile(reads.latencies, 0.5))}, p95 ${ms(percentile(reads.latencies, 0.95))}, p99 ${ms(percentile(reads.latencies, 0.99))}, max ${ms(reads.latencies.at(-1) ?? 0)}
Statuses    ${[...reads.statuses].map(([status, n]) => `${status}: ${n}`).join(', ')}
Backwards   ${reads.backwards} times a dashboard saw fewer runs than before`);
  }
  if (plan.posts.length > 0) console.log(`
Sent        ${plan.posts.length} requests in ${sentIn.toFixed(1)} s (${(plan.posts.length / sentIn).toFixed(0)}/s); all answered after ${doneIn.toFixed(1)} s
Latency     p50 ${ms(percentile(latencies, 0.5))}, p95 ${ms(percentile(latencies, 0.95))}, p99 ${ms(percentile(latencies, 0.99))}, max ${ms(latencies.at(-1) ?? 0)}
Statuses    ${[...statuses].map(([status, n]) => `${status}: ${n}`).join(', ')}
Events      ${results.accepted} accepted, ${results.duplicates} duplicates, ${results.rejected} rejected, ${results.failed} never delivered, ${results.retries} retries
In flight   at most ${maxInFlight} requests at once
Statistics  expected +${JSON.stringify(target)}
            got      +${JSON.stringify(change)} (${drainedIn.toFixed(1)} s after the last answer)`);

  const counted = COMPARED.every((field) => change[field] === target[field]) && results.failed === 0 && results.rejected === 0;
  const ok = counted && readsOk;
  if (!counted) console.log('\nFAILED: the statistics do not match the events sent.');
  if (!readsOk) console.log('\nFAILED: a dashboard got an error or saw the numbers go backwards.');
  if (ok) console.log(`\nOK: every event delivered and counted exactly once${readers > 0 ? ', and every dashboard read succeeded and only ever saw the numbers grow' : ''}.`);
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.error(`Load test against ${apiUrl} failed. Is the backend running with TRUST_PROXY=1?`);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
