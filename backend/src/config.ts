export interface Config {
  projectId: string;
  emulatorHost: string;
  /** Network interface the API listens on. */
  host: string;
  port: number;
  allowedOrigins: string[];
  /** Kafka brokers to queue events on; null stores them directly in Firestore. */
  kafkaBrokers: string[] | null;
  /**
   * Which proxies in front of the API to trust for the client IP in `X-Forwarded-For`, as Express's
   * `trust proxy`: a hop count, or addresses and subnets. `false` uses the connection's address.
   */
  trustProxy: number | string | false;
  /** How many API instances share the rate limits; each instance enforces its share. */
  apiInstances: number;
}

/** Game dev server, game preview, dashboard. */
export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:5174'];
/** Only this machine can reach the API; a container sets HOST=0.0.0.0. */
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Reads the configuration from environment variables. Refuses anything that could reach a real
 * Firebase project: an emulator host is required and the project ID must start with `demo-`.
 */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const emulatorHost = env.FIRESTORE_EMULATOR_HOST?.trim();
  if (!emulatorHost) {
    throw new ConfigError(
      'FIRESTORE_EMULATOR_HOST is not set. This backend only runs against the Firestore emulator: ' +
        'start it with `pnpm emulators`, then start the API with `pnpm dev`.'
    );
  }

  const projectId = env.GCLOUD_PROJECT?.trim() ?? '';
  if (!projectId.startsWith('demo-')) {
    throw new ConfigError(
      `GCLOUD_PROJECT must be a demo project ID starting with "demo-" (got "${projectId}"), ` +
        'so no real Firebase project can be reached.'
    );
  }

  const host = env.HOST?.trim() || DEFAULT_HOST;
  const port = env.PORT ? Number(env.PORT) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`PORT must be a port number (got "${env.PORT}").`);
  }

  const allowedOrigins = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : DEFAULT_ALLOWED_ORIGINS;

  const kafkaBrokers = env.KAFKA_BROKERS?.trim()
    ? env.KAFKA_BROKERS.split(',').map((broker) => broker.trim()).filter(Boolean)
    : null;

  return { projectId, emulatorHost, host, port, allowedOrigins, kafkaBrokers, trustProxy: readTrustProxy(env.TRUST_PROXY), apiInstances: readApiInstances(env.API_INSTANCES) };
}

function readTrustProxy(value: string | undefined): Config['trustProxy'] {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === 'false' || trimmed === '0') return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true') {
    throw new ConfigError(
      'TRUST_PROXY=true trusts every X-Forwarded-For entry, so any client could pick its own IP and escape the rate limit. ' +
        'Set the number of proxies in front of the API (e.g. TRUST_PROXY=1 behind one load balancer) or their addresses.'
    );
  }
  // Addresses, subnets or Express's names (loopback, linklocal, uniquelocal); Express checks them at start.
  return trimmed;
}

function readApiInstances(value: string | undefined): number {
  if (!value?.trim()) return 1;
  const instances = Number(value);
  if (!Number.isInteger(instances) || instances < 1) throw new ConfigError(`API_INSTANCES must be a positive integer (got "${value}").`);
  return instances;
}

/** Where the archive worker keeps raw events. */
export type ArchiveTarget =
  | { kind: 'file'; directory: string }
  | { kind: 'bigquery'; projectId: string; dataset: string; table: string };

export interface ArchiveConfig {
  kafkaBrokers: string[];
  target: ArchiveTarget;
}

/**
 * Reads the archive worker's configuration. It never touches Firestore, so it needs no emulator; BigQuery is
 * a real Google Cloud project, so it is used only when asked for with ARCHIVE=bigquery and a project ID.
 */
export function loadArchiveConfig(env: NodeJS.ProcessEnv): ArchiveConfig {
  const kafkaBrokers = env.KAFKA_BROKERS?.split(',').map((broker) => broker.trim()).filter(Boolean) ?? [];
  if (kafkaBrokers.length === 0) throw new ConfigError('KAFKA_BROKERS is not set. Start Kafka with `pnpm kafka`, then run `pnpm archive`.');

  const kind = env.ARCHIVE?.trim() || 'file';
  if (kind === 'file') return { kafkaBrokers, target: { kind, directory: env.ARCHIVE_DIR?.trim() || 'archive-data' } };
  if (kind !== 'bigquery') throw new ConfigError(`ARCHIVE must be "file" or "bigquery" (got "${kind}").`);

  const projectId = env.BIGQUERY_PROJECT?.trim();
  if (!projectId) throw new ConfigError('ARCHIVE=bigquery needs BIGQUERY_PROJECT, the Google Cloud project that holds the dataset.');
  return {
    kafkaBrokers,
    target: { kind, projectId, dataset: env.BIGQUERY_DATASET?.trim() || 'neon_snake', table: env.BIGQUERY_TABLE?.trim() || 'raw_events' }
  };
}
