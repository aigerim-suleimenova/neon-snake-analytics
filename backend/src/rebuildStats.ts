import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { FirestoreEventStore } from './adapters/FirestoreEventStore';
import { ConfigError, loadConfig } from './config';
import { overview } from './services/stats';

// Recounts the statistics from every stored run, for emulator data saved before the counts existed.
// Stop the backend first, so no event arrives while the counts are replaced.
try {
  const config = loadConfig(process.env);
  const store = new FirestoreEventStore(getFirestore(initializeApp({ projectId: config.projectId })));
  const { sessions, runs } = overview(await store.rebuildStats());
  console.log(`Rebuilt the statistics counts from ${runs} runs in ${sessions} sessions.`);
  process.exit(0);
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
}
