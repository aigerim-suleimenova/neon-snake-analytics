import type { RequestHandler } from 'express';

/**
 * Lets only the listed origins read responses, and answers the preflight that a JSON post needs.
 * Other origins get no CORS headers, so the browser hides the response from them.
 */
export function cors(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    res.vary('Origin');
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);

    if (req.method !== 'OPTIONS') return next();
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    res.status(204).end();
  };
}

/**
 * Rejects posts from browser pages on other origins with `403`. CORS alone does not stop them: a
 * `text/plain` post (as `sendBeacon` sends) needs no preflight, so it reaches the server from any page.
 * Requests without an `Origin` header do not come from a page (the seed script, curl) and pass.
 */
export function rejectOtherOrigins(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin === undefined || allowed.has(origin)) return next();
    res.status(403).json({ error: { message: 'Origin is not allowed' } });
  };
}
