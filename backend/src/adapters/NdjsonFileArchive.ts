import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { EventArchive } from '../ports/EventArchive';
import type { ReceivedEvent } from '../ports/EventStore';
import { toArchiveRow, type ArchiveRow } from '../services/archiveRow';

/**
 * EventArchive in local files, for running without BigQuery: one `raw_events-YYYY-MM-DD.ndjson` per day of
 * `occurredAt`, one row per line, in the same shape as the BigQuery table, so `bq load` can read them.
 */
export class NdjsonFileArchive implements EventArchive {
  constructor(private readonly directory: string) {}

  async write(events: readonly ReceivedEvent[]): Promise<void> {
    const byDay = new Map<string, ArchiveRow[]>();
    for (const received of events) {
      const row = toArchiveRow(received);
      const day = row.occurredAt.slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), row]);
    }
    await mkdir(this.directory, { recursive: true });
    for (const [day, rows] of byDay) {
      await appendFile(join(this.directory, `raw_events-${day}.ndjson`), rows.map((row) => JSON.stringify(row) + '\n').join(''));
    }
  }
}
