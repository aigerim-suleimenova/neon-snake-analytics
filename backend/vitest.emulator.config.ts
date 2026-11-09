import { defineConfig } from 'vitest/config';

// Runs inside `firebase emulators:exec`, which sets FIRESTORE_EMULATOR_HOST.
export default defineConfig({
  test: {
    include: ['src/**/*.emulator.test.ts']
  }
});
