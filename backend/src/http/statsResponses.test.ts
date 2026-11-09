import { LevelsResponseSchema, OverviewSchema } from '@neon-snake/contract/schemas';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '../adapters/InMemoryEventStore';
import { generateDemoEvents, seededRandom } from '../seed/demoEvents';
import { IngestionService } from '../services/IngestionService';
import { StatsService } from '../services/StatsService';
import { createApp } from './createApp';

const now = new Date('2026-10-05T00:00:00.000Z');

// The dashboard reads the statistics through these shared schemas; an answer they reject shows it as offline.
describe('statistics answers', () => {
  it('match the shared schemas exactly, with every graph filled', async () => {
    const store = new InMemoryEventStore();
    const app = createApp({
      ingestion: new IngestionService(store, { now: () => now }),
      stats: new StatsService(store),
      health: store,
      allowedOrigins: []
    });
    const events = generateDemoEvents(seededRandom(2026), { sessions: 40, start: new Date('2026-10-01T09:00:00.000Z') });
    for (let index = 0; index < events.length; index += 50) {
      expect((await request(app).post('/api/events').send(events.slice(index, index + 50))).status).toBe(202);
    }

    const overview = await request(app).get('/api/stats/overview');
    const levels = await request(app).get('/api/stats/levels');

    // Parsing drops unknown fields, so equal means the answer has no field the schemas leave out.
    expect(OverviewSchema.parse(overview.body)).toEqual(overview.body);
    expect(LevelsResponseSchema.parse(levels.body)).toEqual(levels.body);
    expect(levels.body.levels.length).toBeGreaterThan(0);
  });
});
