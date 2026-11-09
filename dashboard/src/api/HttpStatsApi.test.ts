// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { HttpStatsApi } from './HttpStatsApi';
import { sampleLevels, sampleOverview } from './sampleStats';
import { StatsUnavailableError } from './StatsApi';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const apiWith = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
  new HttpStatsApi({ baseUrl: 'http://localhost:3000', fetch, timeoutMs });

/** A fetch that never answers and rejects only when its signal aborts, like a hanging server. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

describe('HttpStatsApi', () => {
  it('reads the overview', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(sampleOverview));

    await expect(apiWith(fetch).getOverview()).resolves.toEqual(sampleOverview);
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/stats/overview', expect.anything());
  });

  it('reads the levels and returns the list', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ levels: sampleLevels }));

    await expect(apiWith(fetch).getLevels()).resolves.toEqual(sampleLevels);
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/stats/levels', expect.anything());
  });

  it('ignores a trailing slash in the base URL', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(sampleOverview));

    await new HttpStatsApi({ baseUrl: 'http://localhost:3000/', fetch }).getOverview();
    expect(fetch).toHaveBeenCalledWith('http://localhost:3000/api/stats/overview', expect.anything());
  });

  it('fails on a 503', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json({ error: { message: 'Store unavailable' } }, 503));

    await expect(apiWith(fetch).getOverview()).rejects.toThrow(new StatsUnavailableError('/api/stats/overview answered 503'));
  });

  it('fails on a body that does not match the contract', async () => {
    const { '80-99': _dropped, ...withoutLastRange } = sampleLevels[0].failedByProgress;
    const broken = { levels: [{ ...sampleLevels[0], failedByProgress: withoutLastRange }] };
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(json(broken));

    await expect(apiWith(fetch).getLevels()).rejects.toThrow(new StatsUnavailableError('/api/stats/levels returned an unexpected body'));
  });

  it('fails on a body that is not JSON', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('<html>proxy error</html>'));

    await expect(apiWith(fetch).getOverview()).rejects.toThrow(new StatsUnavailableError('/api/stats/overview returned an unexpected body'));
  });

  it('fails when the backend cannot be reached', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('fetch failed'));

    await expect(apiWith(fetch).getOverview()).rejects.toThrow(new StatsUnavailableError('/api/stats/overview could not be reached'));
  });

  it('fails after the timeout when the backend does not answer', async () => {
    await expect(apiWith(hangingFetch, 20).getLevels()).rejects.toThrow(
      new StatsUnavailableError('/api/stats/levels timed out after 20 ms')
    );
  });

  it('passes a cancellation by the caller through instead of reporting the backend as unavailable', async () => {
    const controller = new AbortController();
    const request = apiWith(hangingFetch).getOverview(controller.signal);
    controller.abort();

    const error = await request.catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(StatsUnavailableError);
    expect((error as Error).name).toBe('AbortError');
  });
});
