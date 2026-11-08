import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

declare global {
  namespace Express {
    interface Locals {
      /** This request's id: echoed in X-Request-Id and logged. */
      requestId?: string;
    }
  }
}

/** Incoming ids we keep (e.g. from a proxy): short, printable, no spaces. */
const SANE_ID = /^[\w.:@-]{1,128}$/;

/**
 * Gives each request an id (a sane incoming X-Request-Id, else a new UUID) and echoes it in the response.
 * Logs one JSON line per request in production; elsewhere only 5xx responses.
 */
export function requestLog(production: boolean): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get('x-request-id');
    const id = incoming && SANE_ID.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = id;
    res.setHeader('X-Request-Id', id);

    const start = process.hrtime.bigint();
    res.once('close', () => {
      const status = res.statusCode;
      if (!production && status < 500) return;
      const ms = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
      const aborted = res.writableFinished ? {} : { aborted: true };
      const line = { method: req.method, path: req.originalUrl.split('?')[0], status, ms, id, ...aborted };
      (status >= 500 ? console.error : console.log)(JSON.stringify(line));
    });
    next();
  };
}
