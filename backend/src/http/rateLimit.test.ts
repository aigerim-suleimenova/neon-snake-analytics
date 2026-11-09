import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { rateLimit, shareOf } from './rateLimit';

function setup(burst: number, perSecond: number) {
  let time = 0;
  const app = express();
  // Lets each test pick the client IP through X-Forwarded-For.
  app.set('trust proxy', true);
  app.post('/', rateLimit({ burst, perSecond, now: () => time }), (_req, res) => {
    res.sendStatus(204);
  });
  const post = (ip = '10.0.0.1') => request(app).post('/').set('X-Forwarded-For', ip);
  return { post, advance: (ms: number) => (time += ms) };
}

describe('rateLimit', () => {
  it('lets a burst through, then answers 429 with Retry-After', async () => {
    const { post } = setup(3, 1);

    for (let i = 0; i < 3; i += 1) expect((await post()).status).toBe(204);
    const res = await post();

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('1');
    expect(res.body).toEqual({ error: { message: 'Too many requests, try again in 1 s' } });
  });

  it('refills over time', async () => {
    const { post, advance } = setup(2, 1);
    await post();
    await post();
    expect((await post()).status).toBe(429);

    advance(999);
    expect((await post()).status).toBe(429);
    advance(1);
    expect((await post()).status).toBe(204);
    expect((await post()).status).toBe(429);
  });

  it('never refills above the burst', async () => {
    const { post, advance } = setup(2, 1);
    advance(60_000);

    expect((await post()).status).toBe(204);
    expect((await post()).status).toBe(204);
    expect((await post()).status).toBe(429);
  });

  it('counts each client IP separately', async () => {
    const { post } = setup(1, 1);

    expect((await post('10.0.0.1')).status).toBe(204);
    expect((await post('10.0.0.1')).status).toBe(429);
    expect((await post('10.0.0.2')).status).toBe(204);
  });

  it('asks a client to wait as long as it takes to earn the next token', async () => {
    const { post } = setup(1, 0.25);
    await post();

    expect((await post()).headers['retry-after']).toBe('4');
  });
});

describe('shareOf', () => {
  it("gives each instance its share, so all instances together keep the limit", () => {
    expect(shareOf({ burst: 60, perSecond: 1 }, 1)).toEqual({ burst: 60, perSecond: 1 });
    expect(shareOf({ burst: 60, perSecond: 1 }, 4)).toEqual({ burst: 15, perSecond: 0.25 });
  });

  it('never leaves an instance a burst below 1', () => {
    expect(shareOf({ burst: 30, perSecond: 2 }, 100)).toEqual({ burst: 1, perSecond: 0.02 });
  });
});
