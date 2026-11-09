import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreEventStore } from './adapters/FirestoreEventStore';
import { FirestoreStatsSnapshots } from './adapters/FirestoreStatsSnapshots';
import { createKafka, ensureEventsTopic, KafkaEventQueue } from './adapters/kafka';
import { systemClock } from './adapters/systemClock';
import { ConfigError, loadConfig, type Config } from './config';
import { createApp } from './http/createApp';
import { closeGracefully } from './http/gracefulShutdown';
import { EVENTS_RATE_LIMIT, READS_RATE_LIMIT, shareOf } from './http/rateLimit';
import { IngestionService } from './services/IngestionService';
import { QueuedIngestionService } from './services/QueuedIngestionService';
import { LiveStatsBroadcaster } from './services/LiveStats';
import { StatsService } from './services/StatsService';
import { withQueueDeadline, withSnapshotDeadline, withStoreDeadline } from './services/storeDeadline';

// Composition root: the only place that knows every concrete part.
function readConfig(): Config {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}

const config = readConfig();

/** Says once that statistics are read from the counter documents, since no fresh snapshot exists. */
let warned = false;
const warnOnce = (reason: 'missing' | 'stale') => {
  if (warned) return;
  warned = true;
  console.warn(`No fresh statistics snapshot (${reason}): adding up the counter documents instead. Run \`pnpm snapshot\` to read one document.`);
};
// firebase-admin connects to FIRESTORE_EMULATOR_HOST without credentials.
const firestore = getFirestore(initializeApp({ projectId: config.projectId }));
const store = withStoreDeadline(new FirestoreEventStore(firestore));

// With KAFKA_BROKERS, posted events go on a queue and `pnpm worker` stores them; otherwise they are stored at once.
let queue: KafkaEventQueue | null = null;
if (config.kafkaBrokers) {
  const kafka = createKafka(config.kafkaBrokers, 'analytics-api');
  await ensureEventsTopic(kafka);
  queue = new KafkaEventQueue(kafka);
  await queue.connect();
}

const stats = new StatsService(store, { snapshots: withSnapshotDeadline(new FirestoreStatsSnapshots(firestore)), onFallback: warnOnce });
// One read loop per instance for every open stream, through the same cached StatsService as the routes.
const live = new LiveStatsBroadcaster({ read: async () => ({ overview: await stats.overview(), levels: await stats.levels() }) });

const app = createApp({
  ingestion: queue ? new QueuedIngestionService(withQueueDeadline(queue), systemClock) : new IngestionService(store, systemClock),
  // Reads the snapshot `pnpm snapshot` writes; without it, adds up the counter documents as before.
  stats,
  live,
  health: store,
  allowedOrigins: config.allowedOrigins,
  trustProxy: config.trustProxy,
  eventsRateLimit: shareOf(EVENTS_RATE_LIMIT, config.apiInstances),
  readsRateLimit: shareOf(READS_RATE_LIMIT, config.apiInstances)
});

const server = app.listen(config.port, config.host, () => {
  console.log(`Analytics API on http://${config.host}:${config.port} (Firestore emulator ${config.emulatorHost}, project ${config.projectId})`);
  if (config.kafkaBrokers) console.log(`Queuing events on Kafka ${config.kafkaBrokers.join(', ')}; run \`pnpm worker\` to store them`);
});

// The Firestore client keeps the process alive, so exit explicitly once the requests are done.
function shutDown(signal: NodeJS.Signals): void {
  console.log(`${signal} received: finishing open requests`);
  // Live streams never finish on their own; ending them lets the requests left finish within the deadline.
  live.close();
  // The producer goes last, so requests still finishing can publish.
  closeGracefully(server).then(
    async (complete) => {
      await queue?.disconnect();
      process.exit(complete ? 0 : 1);
    },
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    }
  );
}

// `once`: a second Ctrl+C falls back to Node's default and stops the process at once.
process.once('SIGTERM', shutDown);
process.once('SIGINT', shutDown);
