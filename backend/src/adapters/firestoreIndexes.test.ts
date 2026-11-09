import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface FieldOverride {
  collectionGroup: string;
  fieldPath: string;
  indexes: unknown[];
}

const config = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8')) as {
  indexes: unknown[];
  fieldOverrides: FieldOverride[];
};
const unindexed = config.fieldOverrides.filter((override) => override.indexes.length === 0).map((o) => `${o.collectionGroup}.${o.fieldPath}`);

// Firestore indexes every field by default. An indexed field whose values only grow, like a time, keeps writing
// to the end of one index, which caps a collection at about 500 writes per second. Nothing queries these fields.
describe('firestore.indexes.json', () => {
  it('leaves every time field unindexed', () => {
    expect(unindexed).toEqual(
      expect.arrayContaining([
        'runs.startedAt',
        'runs.endedAt',
        'runs.startReceivedAt',
        'runs.endReceivedAt',
        'runs.updatedAt',
        'sessions.firstSeenAt'
      ])
    );
  });

  it('leaves the counters and the snapshot unindexed, so the busiest documents write no index entries', () => {
    expect(unindexed).toEqual(expect.arrayContaining(['statsShards.levels', 'statsShards.sessions', 'stats.counts', 'stats.computedAt']));
  });

  it('defines no composite index, because no request queries with a filter', () => {
    expect(config.indexes).toEqual([]);
  });
});
