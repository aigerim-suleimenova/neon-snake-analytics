import { Kafka, logLevel, Partitioners, type Consumer, type EachBatchPayload, type KafkaMessage, type Producer } from 'kafkajs';
import type { EventQueue } from '../ports/EventQueue';
import { groupCommit } from '../services/groupCommit';
import type { QueuedMessage } from '../services/queueConsumer';

export const EVENTS_TOPIC = 'analytics-events';
/** Events are keyed by run, so each run's events stay in order on one partition; partitions let workers share the load. */
const EVENTS_PARTITIONS = 3;
/** Stores events in Firestore; see ingestWorker.ts. */
export const INGESTION_GROUP = 'analytics-ingestion';
/** Keeps every raw event; see archiveWorker.ts. A group of its own reads the whole topic independently of storing. */
export const ARCHIVE_GROUP = 'analytics-archive';

export function createKafka(brokers: readonly string[], clientId: string): Kafka {
  return new Kafka({ clientId, brokers: [...brokers], logLevel: logLevel.WARN });
}

/** Creates the events topic unless it exists. */
export async function ensureEventsTopic(kafka: Kafka): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();
  try {
    // Checked first: the API and the worker start together, and creating an existing topic logs an error.
    if ((await admin.listTopics()).includes(EVENTS_TOPIC)) return;
    await admin.createTopics({ topics: [{ topic: EVENTS_TOPIC, numPartitions: EVENTS_PARTITIONS }] });
  } finally {
    await admin.disconnect();
  }
}

/** Most events one producer request carries; about 300 kB, well below Kafka's default 1 MB request limit. */
const MAX_EVENTS_PER_SEND = 1000;

/**
 * EventQueue on Kafka: one message per event, keyed by run ID, acknowledged by every in-sync replica.
 *
 * The producer is idempotent, so a retry never writes a message twice, and kafkajs then sends one request
 * per broker at a time. One `send` per HTTP request would queue every post behind all the earlier ones,
 * capping the API at about one broker round trip per post. So posts are group-committed: while a send runs,
 * new events wait and then go out together in the next one, and each post's promise settles with its send.
 */
export class KafkaEventQueue implements EventQueue {
  private readonly producer: Producer;
  private readonly send: (events: Parameters<EventQueue['publish']>[0]) => Promise<void>;

  constructor(kafka: Kafka) {
    // The default partitioner, named so kafkajs does not warn about its v2 change: same key, same partition.
    this.producer = kafka.producer({ idempotent: true, allowAutoTopicCreation: false, createPartitioner: Partitioners.DefaultPartitioner });
    this.send = groupCommit(async (events) => {
      await this.producer.send({
        topic: EVENTS_TOPIC,
        acks: -1,
        messages: events.map((event) => ({ key: event.runId, value: JSON.stringify(event) }))
      });
    }, MAX_EVENTS_PER_SEND);
  }

  connect(): Promise<void> {
    return this.producer.connect();
  }

  disconnect(): Promise<void> {
    return this.producer.disconnect();
  }

  publish(events: Parameters<EventQueue['publish']>[0]): Promise<void> {
    return this.send(events);
  }
}

/** Handles a batch of messages from one partition; resolves once they are stored. */
export type BatchHandler = (messages: QueuedMessage[], partition: number) => Promise<unknown>;

const toQueuedMessage = (message: KafkaMessage): QueuedMessage => ({
  value: message.value?.toString() ?? null,
  queuedAt: new Date(Number(message.timestamp))
});

/**
 * Splits each fetched batch into chunks of at most `maxMessages` and hands them to `handle` in order. A
 * chunk's offsets are resolved only after `handle` resolves; when it throws, kafkajs commits the chunks
 * already resolved and fetches the rest again, so nothing is lost and only the failed chunk repeats.
 */
export function createBatchConsumer(
  handle: BatchHandler,
  maxMessages: number
): (payload: Pick<EachBatchPayload, 'batch' | 'resolveOffset' | 'heartbeat' | 'isRunning' | 'isStale'>) => Promise<void> {
  return async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
    for (let start = 0; start < batch.messages.length; start += maxMessages) {
      // Stopping, or the partition moved to another worker in a rebalance: leave the rest unresolved.
      if (!isRunning() || isStale()) return;
      const chunk = batch.messages.slice(start, start + maxMessages);
      await handle(chunk.map(toQueuedMessage), batch.partition);
      resolveOffset(chunk[chunk.length - 1].offset);
      await heartbeat();
    }
  };
}

/**
 * Hands every message of the events topic to `handle` in chunks of at most `maxMessages`, one chunk at a time
 * per partition. Each consumer group gets every message once, whatever the other groups do.
 */
export async function consumeEvents(kafka: Kafka, handle: BatchHandler, maxMessages: number, groupId = INGESTION_GROUP): Promise<Consumer> {
  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  await consumer.subscribe({ topic: EVENTS_TOPIC, fromBeginning: true });
  // Offsets are resolved per stored chunk, never for a whole batch that was only partly stored.
  await consumer.run({ eachBatchAutoResolve: false, eachBatch: createBatchConsumer(handle, maxMessages) });
  return consumer;
}
