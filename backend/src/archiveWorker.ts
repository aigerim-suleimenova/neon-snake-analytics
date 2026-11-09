import { BigQuery } from '@google-cloud/bigquery';
import { BigQueryEventArchive } from './adapters/BigQueryEventArchive';
import { ARCHIVE_GROUP, consumeEvents, createKafka, ensureEventsTopic } from './adapters/kafka';
import { NdjsonFileArchive } from './adapters/NdjsonFileArchive';
import { ConfigError, loadArchiveConfig, type ArchiveTarget } from './config';
import type { EventArchive } from './ports/EventArchive';
import { archiveQueuedBatch } from './services/queueConsumer';

/** Rows per streaming insert; well within BigQuery's limits per request. */
const ARCHIVE_BATCH = 500;

function createArchive(target: ArchiveTarget): EventArchive {
  if (target.kind === 'file') return new NdjsonFileArchive(target.directory);
  // Credentials come from the environment (Application Default Credentials), as on Cloud Run.
  return new BigQueryEventArchive(new BigQuery({ projectId: target.projectId }).dataset(target.dataset).table(target.table));
}

const describe = (target: ArchiveTarget) =>
  target.kind === 'file' ? `files in ${target.directory}/` : `BigQuery ${target.projectId}.${target.dataset}.${target.table}`;

// Keeps every raw event the API queued, for analysis. Its own consumer group reads the whole topic apart from
// the ingestion worker, so neither slows the other down. Several archive workers share the partitions.
try {
  const config = loadArchiveConfig(process.env);
  const archive = createArchive(config.target);
  const kafka = createKafka(config.kafkaBrokers, 'analytics-archive');
  await ensureEventsTopic(kafka);
  const consumer = await consumeEvents(kafka, (messages) => archiveQueuedBatch(archive, messages, console.error), ARCHIVE_BATCH, ARCHIVE_GROUP);
  console.log(`Archiving events from Kafka ${config.kafkaBrokers.join(', ')} to ${describe(config.target)}`);

  const shutDown = (signal: NodeJS.Signals) => {
    console.log(`${signal} received: leaving the consumer group`);
    consumer.disconnect().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error(error);
        process.exit(1);
      }
    );
  };
  process.once('SIGTERM', shutDown);
  process.once('SIGINT', shutDown);
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}
