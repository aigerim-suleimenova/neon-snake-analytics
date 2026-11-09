import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { closeGracefully } from './gracefulShutdown';

/** A server whose `/slow` requests answer only when `finishSlow()` is called. */
async function startServer() {
  let finishSlow = () => {};
  let slowArrived = () => {};
  const slowStarted = new Promise<void>((resolve) => (slowArrived = resolve));
  const server = createServer((req, res) => {
    if (req.url !== '/slow') return res.end('fast');
    finishSlow = () => res.end('slow');
    slowArrived();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { server, url, slowStarted, finishSlow: () => finishSlow() };
}

describe('closeGracefully', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.closeAllConnections();
    server?.close();
  });

  it('lets an open request finish before it resolves', async () => {
    const started = await startServer();
    server = started.server;
    const response = fetch(`${started.url}/slow`).then((res) => res.text());
    await started.slowStarted;

    let closed = false;
    const closing = closeGracefully(server).then((complete) => ((closed = true), complete));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed).toBe(false);

    started.finishSlow();
    expect(await response).toBe('slow');
    expect(await closing).toBe(true);
  });

  it('refuses new connections once closing has started', async () => {
    const started = await startServer();
    server = started.server;
    const slow = fetch(`${started.url}/slow`).then((res) => res.text());
    await started.slowStarted;

    const closing = closeGracefully(server);
    await expect(fetch(`${started.url}/fast`, { headers: { connection: 'close' } })).rejects.toThrow();

    started.finishSlow();
    await slow;
    await closing;
  });

  it('does not wait for idle keep-alive connections', async () => {
    const started = await startServer();
    server = started.server;
    // fetch keeps the connection open for reuse after the answer.
    expect(await fetch(`${started.url}/fast`).then((res) => res.text())).toBe('fast');

    expect(await closeGracefully(server, 1000)).toBe(true);
  });

  it('cuts off requests still running at the deadline', async () => {
    const started = await startServer();
    server = started.server;
    const response = fetch(`${started.url}/slow`);
    response.catch(() => {});
    await started.slowStarted;

    expect(await closeGracefully(server, 50)).toBe(false);
    await expect(response).rejects.toThrow();
  });
});
