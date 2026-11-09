import type { EventArchive } from '../ports/EventArchive';
import type { ReceivedEvent } from '../ports/EventStore';
import { toArchiveRow } from '../services/archiveRow';

/** The part of a BigQuery `Table` the archive uses, so tests need no BigQuery. */
export interface InsertTable {
  insert(rows: Array<{ insertId: string; json: object }>, options: { raw: true }): Promise<unknown>;
}

/**
 * EventArchive on BigQuery, through streaming inserts into the table of infra/bigquery/raw_events.sql
 * (partitioned by the day of `occurredAt`). Each row's `insertId` is its event ID, so BigQuery drops most
 * redelivered events within about a minute; later duplicates are removed by `eventId` when read. A failed
 * insert, even of some rows, rejects, so the queue sends the whole batch again.
 */
export class BigQueryEventArchive implements EventArchive {
  constructor(private readonly table: InsertTable) {}

  async write(events: readonly ReceivedEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.table.insert(
      events.map((received) => ({ insertId: received.event.eventId, json: toArchiveRow(received) })),
      { raw: true }
    );
  }
}
