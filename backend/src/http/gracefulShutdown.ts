import type { Server } from 'node:http';

/** Long enough for any request that respects the 3 s store deadline. */
export const SHUTDOWN_DEADLINE_MS = 10_000;
const IDLE_SWEEP_MS = 100;

/**
 * Stops accepting connections and waits for the open requests to finish. Idle keep-alive
 * connections close at once; requests still running at the deadline are cut off.
 * Resolves `true` when every request finished, `false` when the deadline cut some.
 */
export function closeGracefully(server: Server, deadlineMs = SHUTDOWN_DEADLINE_MS): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let cutOff = false;
    const deadline = setTimeout(() => {
      cutOff = true;
      server.closeAllConnections();
    }, deadlineMs);
    // A connection whose request finishes during shutdown stays open for keep-alive; close it once idle.
    const idleSweep = setInterval(() => server.closeIdleConnections(), IDLE_SWEEP_MS);

    server.close((error) => {
      clearTimeout(deadline);
      clearInterval(idleSweep);
      if (error) reject(error);
      else resolve(!cutOff);
    });
  });
}
