import { describe, expect, it } from 'vitest';

import { KeyValueGameStorage, type KeyValueStore } from './GameStorage';

const memoryStore = (initial?: unknown): KeyValueStore & { saved: Map<string, string> } => {
  const saved = new Map<string, string>();
  return {
    saved,
    getItem: (key) => (saved.has(key) ? saved.get(key) : initial),
    setItem: (key, value) => saved.set(key, value)
  };
};

describe('KeyValueGameStorage', () => {
  it('returns defaults when nothing is saved', () => {
    expect(new KeyValueGameStorage(() => memoryStore(null)).loadProfile()).toEqual({
      bestScore: 0,
      highestUnlockedLevel: 1,
      totalRuns: 0,
      playerMuted: false
    });
  });

  it('round-trips a profile as JSON', () => {
    const store = memoryStore();
    const storage = new KeyValueGameStorage(() => store);
    const profile = { bestScore: 120, highestUnlockedLevel: 2, totalRuns: 7, playerMuted: true };

    storage.saveProfile(profile);

    expect(store.saved.get('neon-snake:profile')).toBe(JSON.stringify(profile));
    expect(storage.loadProfile()).toEqual(profile);
  });

  it('accepts an object value, as the SDK storage may return one', () => {
    const storage = new KeyValueGameStorage(() => memoryStore({ bestScore: 30, highestUnlockedLevel: 3 }));
    expect(storage.loadProfile()).toMatchObject({ bestScore: 30, highestUnlockedLevel: 3 });
  });

  it('falls back to defaults for corrupted JSON', () => {
    expect(new KeyValueGameStorage(() => memoryStore('{not json')).loadProfile().bestScore).toBe(0);
  });

  it('repairs missing and out-of-range fields', () => {
    const storage = new KeyValueGameStorage(() => memoryStore(JSON.stringify({ bestScore: -5, highestUnlockedLevel: 9, playerMuted: 'yes' })));
    expect(storage.loadProfile()).toEqual({
      bestScore: 0,
      highestUnlockedLevel: 3,
      totalRuns: 0,
      playerMuted: false
    });
  });

  it('survives a store that throws', () => {
    const storage = new KeyValueGameStorage(() => {
      throw new Error('blocked');
    });
    expect(storage.loadProfile().bestScore).toBe(0);
    expect(() => storage.saveProfile(storage.loadProfile())).not.toThrow();
  });
});
