import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_ALLOWED_ORIGINS, loadArchiveConfig, loadConfig } from './config';

const env = { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCLOUD_PROJECT: 'demo-neon-snake' };

describe('loadConfig', () => {
  it('reads the emulator settings with default host, port and origins', () => {
    expect(loadConfig(env)).toEqual({
      projectId: 'demo-neon-snake',
      emulatorHost: '127.0.0.1:8080',
      host: '127.0.0.1',
      port: 3000,
      allowedOrigins: DEFAULT_ALLOWED_ORIGINS,
      kafkaBrokers: null,
      trustProxy: false,
      apiInstances: 1
    });
  });

  it('reads the port and a comma-separated origin list', () => {
    const config = loadConfig({ ...env, PORT: '4100', ALLOWED_ORIGINS: 'http://a.test, http://b.test,' });

    expect(config.port).toBe(4100);
    expect(config.allowedOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('reads the host, so a container can listen on every interface', () => {
    expect(loadConfig({ ...env, HOST: '0.0.0.0' }).host).toBe('0.0.0.0');
    expect(loadConfig({ ...env, HOST: ' ' }).host).toBe('127.0.0.1');
  });

  it('reads a comma-separated Kafka broker list, which turns the queue on', () => {
    expect(loadConfig({ ...env, KAFKA_BROKERS: '127.0.0.1:9092, 127.0.0.1:9093' }).kafkaBrokers).toEqual([
      '127.0.0.1:9092',
      '127.0.0.1:9093'
    ]);
    expect(loadConfig({ ...env, KAFKA_BROKERS: ' ' }).kafkaBrokers).toBeNull();
  });

  it('refuses to start without an emulator host and explains how to start it', () => {
    expect(() => loadConfig({ GCLOUD_PROJECT: 'demo-neon-snake' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, FIRESTORE_EMULATOR_HOST: ' ' })).toThrow(/pnpm emulators/);
  });

  it.each([undefined, 'neon-snake', 'my-demo-project'])('refuses the project ID %j', (GCLOUD_PROJECT) => {
    expect(() => loadConfig({ ...env, GCLOUD_PROJECT })).toThrow(/demo-/);
  });

  it('reads which proxies to trust as a hop count or as addresses', () => {
    expect(loadConfig({ ...env, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ ...env, TRUST_PROXY: ' 10.0.0.0/8, loopback ' }).trustProxy).toBe('10.0.0.0/8, loopback');
    expect(loadConfig({ ...env, TRUST_PROXY: 'false' }).trustProxy).toBe(false);
    expect(loadConfig({ ...env, TRUST_PROXY: '0' }).trustProxy).toBe(false);
  });

  it('refuses to trust every proxy, which would let clients choose their IP', () => {
    expect(() => loadConfig({ ...env, TRUST_PROXY: 'true' })).toThrow(/any client could pick its own IP/);
  });

  it('reads how many API instances share the limits', () => {
    expect(loadConfig({ ...env, API_INSTANCES: '4' }).apiInstances).toBe(4);
  });

  it.each(['0', '-1', '1.5', 'two'])('refuses the instance count %j', (API_INSTANCES) => {
    expect(() => loadConfig({ ...env, API_INSTANCES })).toThrow(/API_INSTANCES/);
  });

  it.each(['abc', '0', '70000'])('refuses the port %j', (PORT) => {
    expect(() => loadConfig({ ...env, PORT })).toThrow(/PORT/);
  });
});

describe('loadArchiveConfig', () => {
  const kafka = { KAFKA_BROKERS: '127.0.0.1:9092' };

  it('archives to local files by default, without needing the emulator', () => {
    expect(loadArchiveConfig(kafka)).toEqual({ kafkaBrokers: ['127.0.0.1:9092'], target: { kind: 'file', directory: 'archive-data' } });
    expect(loadArchiveConfig({ ...kafka, ARCHIVE_DIR: '/tmp/raw' }).target).toEqual({ kind: 'file', directory: '/tmp/raw' });
  });

  it('archives to BigQuery only when asked, with an explicit project', () => {
    expect(loadArchiveConfig({ ...kafka, ARCHIVE: 'bigquery', BIGQUERY_PROJECT: 'neon-prod' }).target).toEqual({
      kind: 'bigquery',
      projectId: 'neon-prod',
      dataset: 'neon_snake',
      table: 'raw_events'
    });
    expect(() => loadArchiveConfig({ ...kafka, ARCHIVE: 'bigquery' })).toThrow(/BIGQUERY_PROJECT/);
  });

  it('refuses to start without Kafka or with an unknown archive', () => {
    expect(() => loadArchiveConfig({})).toThrow(/KAFKA_BROKERS/);
    expect(() => loadArchiveConfig({ ...kafka, ARCHIVE: 's3' })).toThrow(/ARCHIVE must be/);
  });
});
