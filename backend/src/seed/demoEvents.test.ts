import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '../adapters/InMemoryEventStore';
import { IngestionService } from '../services/IngestionService';
import { StatsService } from '../services/StatsService';
import { validateEvent } from '@neon-snake/contract/schemas';
import { generateDemoEvents, seededRandom } from './demoEvents';

const options = { sessions: 40, start: new Date('2026-10-01T09:00:00.000Z') };
const now = new Date('2026-10-05T00:00:00.000Z');
const demo = () => generateDemoEvents(seededRandom(2026), options);

describe('generateDemoEvents', () => {
  it('gives the same events for the same seed', () => {
    expect(demo()).toEqual(demo());
  });

  it('only produces events that pass the contract', () => {
    for (const event of demo()) {
      expect(validateEvent(event, now)).toEqual({ ok: true, event });
    }
  });

  it('stores without conflicts and fills every dashboard graph', async () => {
    const store = new InMemoryEventStore();
    const ingestion = new IngestionService(store, { now: () => now });
    const events = demo();

    const result = await ingestion.ingest(events);
    expect(result).toEqual({ accepted: events.length, duplicates: 0, rejected: [] });

    const stats = new StatsService(store);
    const overview = await stats.overview();
    expect(overview.sessions).toBe(40);
    expect(overview.unfinished).toBeGreaterThan(0);

    const levels = await stats.levels();
    expect(levels.map((level) => level.level)).toEqual([1, 2, 3]);
  });
});
