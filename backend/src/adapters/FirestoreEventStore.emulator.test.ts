import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { endEvent, startEvent, validated } from '../test/events';
import { countRuns } from '../services/statsCounts';
import { FirestoreEventStore, STATS_SHARDS } from './FirestoreEventStore';
import { FirestoreStatsSnapshots } from './FirestoreStatsSnapshots';

// `firebase emulators:exec` sets both variables.
const host = process.env.FIRESTORE_EMULATOR_HOST;
const projectId = process.env.GCLOUD_PROJECT ?? 'demo-neon-snake';
if (!host) throw new Error('Run these tests with `pnpm test:emulator`.');

const app = initializeApp({ projectId }, 'firestore-adapter-test');
const db = getFirestore(app);
const store = new FirestoreEventStore(db);
const receivedAt = new Date('2026-10-01T12:00:00.000Z');

beforeEach(async () => {
  const res = await fetch(`http://${host}/emulator/v1/projects/${projectId}/databases/(default)/documents`, {
    method: 'DELETE'
  });
  if (!res.ok) throw new Error(`Could not clear the emulator: ${res.status}`);
});

afterAll(() => deleteApp(app));

const expectedRun = {
  runId: 'r1',
  sessionId: 's1',
  level: 1,
  status: 'fail',
  startedAt: '2026-10-01T11:59:00.000Z',
  endedAt: '2026-10-01T11:59:09.000Z',
  failureReason: 'wall',
  score: 30,
  levelScore: 30,
  progress: 43,
  durationMs: 9000,
  startEventId: 'start-r1',
  endEventId: 'end-r1'
};

describe('FirestoreEventStore (emulator)', () => {
  it('creates the run with when its event arrived, and no event document', async () => {
    expect(await store.saveEvent(validated(startEvent()), receivedAt)).toBe('stored');

    const run = (await db.collection('runs').doc('r1').get()).data();
    expect(run).toMatchObject({ sessionId: 's1', level: 1, status: 'unfinished', startEventId: 'start-r1' });
    expect(run?.startReceivedAt.toDate()).toEqual(receivedAt);
    expect(run?.updatedAt).toBeDefined();
    expect((await db.collection('events').get()).empty).toBe(true);
    expect(await store.listRuns()).toEqual([
      expect.objectContaining({ runId: 'r1', status: 'unfinished', endedAt: null })
    ]);
  });

  it('reports a resent event as a duplicate and changes nothing', async () => {
    await store.saveEvent(validated(startEvent()), receivedAt);
    const before = (await db.collection('runs').doc('r1').get()).data();

    expect(await store.saveEvent(validated(startEvent()), new Date())).toBe('duplicate');

    expect((await db.collection('runs').doc('r1').get()).data()).toEqual(before);
  });

  it('reports a resent end event as a duplicate once the run has both events', async () => {
    await store.saveEvent(validated(startEvent()), receivedAt);
    await store.saveEvent(validated(endEvent()), receivedAt);
    const before = (await db.collection('runs').doc('r1').get()).data();

    expect(await store.saveEvent(validated(endEvent()), new Date())).toBe('duplicate');
    expect(await store.saveEvent(validated(startEvent()), new Date())).toBe('duplicate');

    expect((await db.collection('runs').doc('r1').get()).data()).toEqual(before);
  });

  it('keeps when each of the run\'s events arrived', async () => {
    const endReceivedAt = new Date('2026-10-01T12:00:09.000Z');
    await store.saveEvent(validated(startEvent()), receivedAt);
    await store.saveEvent(validated(endEvent()), endReceivedAt);

    const run = (await db.collection('runs').doc('r1').get()).data();
    expect(run?.startReceivedAt.toDate()).toEqual(receivedAt);
    expect(run?.endReceivedAt.toDate()).toEqual(endReceivedAt);
  });

  it('rejects a conflicting event and changes nothing', async () => {
    await store.saveEvent(validated(startEvent()), receivedAt);
    const before = (await db.collection('runs').doc('r1').get()).data();

    expect(await store.saveEvent(validated(endEvent({ level: 2 })), receivedAt)).toEqual({
      conflict: 'level: run r1 is on level 1'
    });

    expect((await db.collection('runs').doc('r1').get()).data()).toEqual(before);
  });

  it('merges start then end into the finished run', async () => {
    await store.saveEvent(validated(startEvent()), receivedAt);
    await store.saveEvent(validated(endEvent()), receivedAt);

    expect(await store.listRuns()).toEqual([expectedRun]);
  });

  it('merges end then start into the same run', async () => {
    await store.saveEvent(validated(endEvent()), receivedAt);
    await store.saveEvent(validated(startEvent()), receivedAt);

    expect(await store.listRuns()).toEqual([expectedRun]);
  });

  it('keeps counts over its shards that match a recount of the runs', async () => {
    let shard = 0;
    // Steps through the shards, so the events land on several of them.
    const sharded = new FirestoreEventStore(db, () => (shard++ % STATS_SHARDS) / STATS_SHARDS);
    await sharded.saveEvent(validated(startEvent()), receivedAt);
    await sharded.saveEvent(validated(endEvent()), receivedAt);
    await sharded.saveEvent(validated(startEvent({ eventId: 'start-r2', runId: 'r2', level: 2 })), receivedAt);
    await sharded.saveEvent(validated(startEvent({ eventId: 'start-r3', runId: 'r3', sessionId: 's2' })), receivedAt);

    expect((await db.collection('statsShards').get()).size).toBeGreaterThan(1);
    const counts = await sharded.readStats();
    expect(counts.sessions).toBe(2);
    expect(counts).toEqual(countRuns(await sharded.listRuns()));
  });

  it('leaves the counts unchanged for a duplicate', async () => {
    await store.saveEvent(validated(startEvent()), receivedAt);
    const before = await store.readStats();

    await store.saveEvent(validated(startEvent()), receivedAt);

    expect(await store.readStats()).toEqual(before);
  });

  it('rebuilds the counts of runs stored before them', async () => {
    await store.saveEvent(validated(startEvent()), receivedAt);
    await store.saveEvent(validated(endEvent()), receivedAt);
    const expected = await store.readStats();
    const shards = await db.collection('statsShards').get();
    await Promise.all(shards.docs.map((doc) => doc.ref.delete()));
    await db.collection('sessions').doc('s1').delete();

    expect(await store.rebuildStats()).toEqual(expected);
    expect(await store.readStats()).toEqual(expected);

    // The session is marked as counted again, so its next run does not count it twice.
    await store.saveEvent(validated(startEvent({ eventId: 'start-r2', runId: 'r2' })), receivedAt);
    expect((await store.readStats()).sessions).toBe(1);
  });

  describe('saveEvents', () => {
    const later = new Date('2026-10-01T12:00:09.000Z');

    it('stores a batch in one transaction, with its counts on the named counter document only', async () => {
      const results = await store.saveEvents(
        [
          { event: validated(startEvent()), receivedAt },
          { event: validated(endEvent()), receivedAt: later },
          { event: validated(startEvent({ eventId: 'start-r2', runId: 'r2', level: 2 })), receivedAt },
          { event: validated(startEvent()), receivedAt }
        ],
        'partition-0'
      );

      expect(results).toEqual(['stored', 'stored', 'stored', 'duplicate']);
      expect(await store.listRuns()).toEqual([expectedRun, expect.objectContaining({ runId: 'r2', status: 'unfinished' })]);
      const run = (await db.collection('runs').doc('r1').get()).data();
      expect(run?.startReceivedAt.toDate()).toEqual(receivedAt);
      expect(run?.endReceivedAt.toDate()).toEqual(later);
      expect((await db.collection('statsShards').get()).docs.map((doc) => doc.id)).toEqual(['partition-0']);
      const counts = await store.readStats();
      expect(counts.sessions).toBe(1);
      expect(counts).toEqual(countRuns(await store.listRuns()));
    });

    it('finds duplicates and stored sessions from earlier batches', async () => {
      await store.saveEvents([{ event: validated(startEvent()), receivedAt }], 'partition-0');

      const results = await store.saveEvents(
        [
          { event: validated(startEvent()), receivedAt },
          { event: validated(startEvent({ eventId: 'start-r2', runId: 'r2' })), receivedAt },
          { event: validated(endEvent()), receivedAt: later }
        ],
        'partition-1'
      );

      expect(results).toEqual(['duplicate', 'stored', 'stored']);
      expect((await db.collection('runs').doc('r1').get()).data()?.startReceivedAt.toDate()).toEqual(receivedAt);
      expect((await store.readStats()).sessions).toBe(1);
      expect(await store.readStats()).toEqual(countRuns(await store.listRuns()));
    });

    it('writes nothing for a batch of duplicates', async () => {
      await store.saveEvents([{ event: validated(startEvent()), receivedAt }], 'partition-0');
      const before = (await db.collection('runs').doc('r1').get()).data();

      expect(await store.saveEvents([{ event: validated(startEvent()), receivedAt: later }], 'partition-1')).toEqual(['duplicate']);

      expect((await db.collection('runs').doc('r1').get()).data()).toEqual(before);
      expect((await db.collection('statsShards').get()).docs.map((doc) => doc.id)).toEqual(['partition-0']);
    });

    it('is undone as a whole when the transaction fails', async () => {
      const failing = new FirestoreEventStore(db);
      const events = [
        { event: validated(startEvent()), receivedAt },
        { event: validated(startEvent({ eventId: 'start-r2', runId: 'r2' })), receivedAt }
      ];
      // An invalid document ID fails the commit after the reads.
      await expect(failing.saveEvents(events, 'a/b')).rejects.toThrow();

      expect(await store.listRuns()).toEqual([]);
      expect((await db.collection('sessions').get()).empty).toBe(true);
    });
  });

  it('rebuilds into one counter document, removing the per-partition ones', async () => {
    await store.saveEvents([{ event: validated(startEvent()), receivedAt }], 'partition-0');
    await store.saveEvents([{ event: validated(endEvent()), receivedAt }], 'partition-1');
    const expected = await store.readStats();

    expect(await store.rebuildStats()).toEqual(expected);

    expect((await db.collection('statsShards').get()).docs.map((doc) => doc.id)).toEqual(['0']);
    expect(await store.readStats()).toEqual(expected);
  });

  it('keeps a statistics snapshot in one document, with the server time it was written', async () => {
    const snapshots = new FirestoreStatsSnapshots(db);
    expect(await snapshots.read()).toBeNull();
    await store.saveEvent(validated(startEvent()), receivedAt);
    await store.saveEvent(validated(endEvent()), receivedAt);
    const counts = await store.readStats();
    const before = Date.now();

    await snapshots.write(counts);
    const snapshot = await snapshots.read();

    expect(snapshot?.counts).toEqual(counts);
    expect(snapshot?.computedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(snapshot?.computedAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('answers a ping', async () => {
    expect(await store.ping()).toBe(true);
  });
});
