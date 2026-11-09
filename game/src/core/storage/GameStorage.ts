export type PlayerProfile = {
  bestScore: number;
  highestUnlockedLevel: number;
  totalRuns: number;
  playerMuted: boolean;
};

export interface GameStorage {
  loadProfile(): PlayerProfile;
  saveProfile(profile: PlayerProfile): void;
}

export type KeyValueStore = {
  getItem(key: string): unknown;
  setItem(key: string, value: string): void;
};

const defaultProfile = (): PlayerProfile => ({
  bestScore: 0,
  highestUnlockedLevel: 1,
  totalRuns: 0,
  playerMuted: false
});

export class KeyValueGameStorage implements GameStorage {
  private readonly storageKey = 'neon-snake:profile';

  // The store is resolved lazily because accessing window.localStorage can throw when storage is blocked.
  constructor(private readonly getStore: () => KeyValueStore = () => window.localStorage) {}

  loadProfile(): PlayerProfile {
    try {
      const storedProfile = this.getStore().getItem(this.storageKey);
      if (!storedProfile) return defaultProfile();

      const value = (typeof storedProfile === 'string' ? JSON.parse(storedProfile) : storedProfile) as Partial<PlayerProfile>;
      if (typeof value !== 'object' || value === null) return defaultProfile();
      return {
        bestScore: this.nonNegativeInteger(value.bestScore, 0),
        highestUnlockedLevel: Math.min(3, Math.max(1, this.nonNegativeInteger(value.highestUnlockedLevel, 1))),
        totalRuns: this.nonNegativeInteger(value.totalRuns, 0),
        playerMuted: typeof value.playerMuted === 'boolean' ? value.playerMuted : false
      };
    } catch {
      return defaultProfile();
    }
  }

  saveProfile(profile: PlayerProfile): void {
    try {
      this.getStore().setItem(this.storageKey, JSON.stringify(profile));
    } catch {
      // The game remains playable when storage is unavailable.
    }
  }

  private nonNegativeInteger(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
  }
}
