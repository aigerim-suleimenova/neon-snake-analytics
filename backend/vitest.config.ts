import { defineConfig } from 'vitest/config';

// Unit tests run without the emulator; the Firestore adapter tests run through `pnpm test:emulator`.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.emulator.test.ts']
  }
});
