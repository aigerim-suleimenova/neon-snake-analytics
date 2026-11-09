import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreEventStore } from './adapters/FirestoreEventStore';
import { FirestoreStatsSnapshots } from './adapters/FirestoreStatsSnapshots';
import { ConfigError, loadConfig } from './config';
import { runSnapshotLoop } from './services/statsSnapshotLoop';
import { withSnapshotDeadline, withStoreDeadline } from './services/storeDeadline';

// Adds up the statistics counter documents once a second into one snapshot document, so a statistics read
// costs one document however many partitions there are. One is enough; a second one is harmless.
try {
  const config = loadConfig(process.env);
  const firestore = getFirestore(initializeApp({ projectId: config.projectId }));
  let running = true;
  const loop = runSnapshotLoop({
    store: withStoreDeadline(new FirestoreEventStore(firestore)),
    snapshots: withSnapshotDeadline(new FirestoreStatsSnapshots(firestore)),
    isRunning: () => running,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => performance.now(),
    logError: console.error
  });
  console.log(`Writing the statistics snapshot every second in the Firestore emulator ${config.emulatorHost}`);

  // The current round finishes first, so the last snapshot written is whole.
  const shutDown = (signal: NodeJS.Signals) => {
    console.log(`${signal} received: finishing the current round`);
    running = false;
    loop.then(() => process.exit(0));
  };
  process.once('SIGTERM', shutDown);
  process.once('SIGINT', shutDown);
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}
