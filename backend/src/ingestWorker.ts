import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreEventStore } from './adapters/FirestoreEventStore';
import { consumeEvents, createKafka, ensureEventsTopic } from './adapters/kafka';
import { ConfigError, loadConfig } from './config';
import { MAX_EVENTS_PER_BATCH } from './ports/EventStore';
import { storeQueuedBatch } from './services/queueConsumer';
import { withStoreDeadline } from './services/storeDeadline';

/** No HTTP caller waits here, unlike the API's 3 s; the deadline only keeps a hung store from stalling a partition. */
const WORKER_STORE_DEADLINE_MS = 10_000;

// Takes the events the API queued on Kafka and stores them in Firestore, in batches. Several workers can run:
// Kafka spreads the topic's partitions over them, and each partition has its own counter document.
try {
  const config = loadConfig(process.env);
  if (!config.kafkaBrokers) throw new ConfigError('KAFKA_BROKERS is not set. Start Kafka with `pnpm kafka`, then run `pnpm worker`.');

  const store = withStoreDeadline(new FirestoreEventStore(getFirestore(initializeApp({ projectId: config.projectId }))), WORKER_STORE_DEADLINE_MS);
  const kafka = createKafka(config.kafkaBrokers, 'analytics-worker');
  await ensureEventsTopic(kafka);
  // Each chunk of a partition is one Firestore transaction, whose counts go to that partition's own counter document.
  const consumer = await consumeEvents(
    kafka,
    (messages, partition) => storeQueuedBatch(store, messages, partition, console.error),
    MAX_EVENTS_PER_BATCH
  );
  console.log(`Storing events from Kafka ${config.kafkaBrokers.join(', ')} in the Firestore emulator ${config.emulatorHost}`);

  // Leaving the group lets another worker take over the partitions at once; the current message finishes first.
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
