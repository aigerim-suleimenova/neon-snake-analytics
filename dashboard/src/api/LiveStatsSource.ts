import type { LiveStats } from '@neon-snake/contract';

/** `connecting` while a stream is being (re)opened, `live` while it delivers, `off` after the server refused it. */
export type LiveStatus = 'connecting' | 'live' | 'off';

export interface LiveHandlers {
  onStats(stats: LiveStats): void;
  /** The backend could not read the statistics; the stream stays open and recovers on its own. */
  onUnavailable(): void;
  onStatus(status: LiveStatus): void;
}

/** Pushes the statistics whenever they change. */
export interface LiveStatsSource {
  /** Starts listening; returns the function that stops. */
  connect(handlers: LiveHandlers): () => void;
}
