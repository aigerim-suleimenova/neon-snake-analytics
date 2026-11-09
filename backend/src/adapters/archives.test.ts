import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toArchiveRow } from '../services/archiveRow';
import { endEvent, startEvent, validated } from '../test/events';
import { BigQueryEventArchive, type InsertTable } from './BigQueryEventArchive';
import { NdjsonFileArchive } from './NdjsonFileArchive';

const receivedAt = new Date('2026-10-01T12:00:00.000Z');
const start = { event: validated(startEvent()), receivedAt };
const end = { event: validated(endEvent()), receivedAt };

describe('toArchiveRow', () => {
  it('flattens a run_ended event with when it arrived', () => {
    expect(toArchiveRow(end)).toEqual({
      eventId: 'end-r1',
      schemaVersion: 1,
      type: 'run_ended',
      sessionId: 's1',
      runId: 'r1',
      level: 1,
      occurredAt: '2026-10-01T11:59:09.000Z',
      receivedAt: '2026-10-01T12:00:00.000Z',
      outcome: 'fail',
      failureReason: 'wall',
      score: 30,
      levelScore: 30,
      progress: 43,
      durationMs: 9000
    });
  });

  it('has exactly the columns of the BigQuery table, nullable where run_started leaves them null', () => {
    const schema = JSON.parse(readFileSync(new URL('../../../infra/bigquery/raw_events.schema.json', import.meta.url), 'utf8')) as Array<{
      name: string;
      mode: string;
    }>;
    const startRow = toArchiveRow(start);

    expect(schema.map((column) => column.name)).toEqual(Object.keys(toArchiveRow(end)));
    for (const column of schema) expect(column.mode).toBe(startRow[column.name as keyof typeof startRow] === null ? 'NULLABLE' : 'REQUIRED');
  });

  it('leaves the run_ended fields null for run_started', () => {
    expect(toArchiveRow(start)).toMatchObject({ type: 'run_started', outcome: null, failureReason: null, score: null, durationMs: null });
  });
});

describe('BigQueryEventArchive', () => {
  it('inserts one raw row per event, with the event ID as insertId so BigQuery drops redeliveries', async () => {
    const insert = vi.fn<InsertTable['insert']>(async () => ({}));

    await new BigQueryEventArchive({ insert }).write([start, end]);

    expect(insert).toHaveBeenCalledWith(
      [
        { insertId: 'start-r1', json: toArchiveRow(start) },
        { insertId: 'end-r1', json: toArchiveRow(end) }
      ],
      { raw: true }
    );
  });

  it('passes an insert error on, so the queue sends the batch again', async () => {
    const failure = new Error('PartialFailureError');

    await expect(new BigQueryEventArchive({ insert: async () => Promise.reject(failure) }).write([start])).rejects.toBe(failure);
  });

  it('sends nothing for an empty batch', async () => {
    const insert = vi.fn<InsertTable['insert']>(async () => ({}));

    await new BigQueryEventArchive({ insert }).write([]);

    expect(insert).not.toHaveBeenCalled();
  });
});

describe('NdjsonFileArchive', () => {
  let directory = '';
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it('appends one row per line to a file per day of occurredAt', async () => {
    directory = await mkdtemp(join(tmpdir(), 'archive-'));
    const archive = new NdjsonFileArchive(join(directory, 'nested'));
    const dayBefore = { event: validated(startEvent({ eventId: 'start-r2', runId: 'r2', occurredAt: '2026-09-30T08:00:00.000Z' })), receivedAt };

    await archive.write([start, dayBefore]);
    await archive.write([end]);

    expect((await readdir(join(directory, 'nested'))).sort()).toEqual(['raw_events-2026-09-30.ndjson', 'raw_events-2026-10-01.ndjson']);
    const lines = (await readFile(join(directory, 'nested', 'raw_events-2026-10-01.ndjson'), 'utf8')).trim().split('\n');
    expect(lines.map((line) => JSON.parse(line))).toEqual([toArchiveRow(start), toArchiveRow(end)]);
  });
});
