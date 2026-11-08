import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import type { ApiError } from '@pw/shared';

/** Throw from any handler to send a specific status + message. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const zodDetails = (err: ZodError) =>
  err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

/** P2002 target fields as `{ path, message }[]` (undefined when Prisma gives no field list). */
const uniqueDetails = (target: unknown) => {
  const fields = Array.isArray(target) ? target.filter((f): f is string => typeof f === 'string') : [];
  return fields.length ? fields.map((path) => ({ path, message: 'This value is already in use.' })) : undefined;
};

const BODY_ERROR = Symbol('bodyError');

/** Wraps a body parser: its errors (bad JSON, charset, encoding, size) are the client's and may show their message. */
export const bodyErrors =
  (parser: RequestHandler): RequestHandler =>
  (req, res, next) =>
    parser(req, res, (err?: unknown) => {
      if (err && typeof err === 'object') Object.defineProperty(err, BODY_ERROR, { value: true });
      next(err);
    });

export const notFoundApi: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not found' } satisfies ApiError);
};

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // Part of a response (e.g. a file) was already sent: let Express end the connection.
  if (res.headersSent) return next(err);
  const send = (status: number, error: string, details?: unknown) =>
    res.status(status).json(details === undefined ? { error } : ({ error, details } satisfies ApiError));

  if (err instanceof HttpError) return send(err.status, err.message, err.details);
  if (err instanceof ZodError) return send(400, 'Validation failed', zodDetails(err));
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return send(409, 'A record with this value already exists', uniqueDetails(err.meta?.target));
    if (err.code === 'P2025') return send(404, 'Not found');
    if (err.code === 'P2003') return send(400, 'Referenced record does not exist');
    if (err.code === 'P2034') return send(409, 'Please try again'); // write conflict or deadlock
  }
  // Malformed JSON body from express.json()
  if (err?.type === 'entity.parse.failed') return send(400, 'Request body is not valid JSON');
  if (err?.type === 'entity.too.large') return send(413, 'Request body is too large');
  // Other body errors meant for the client, e.g. 415 unsupported charset or Content-Encoding.
  const status = Number(err?.status ?? err?.statusCode);
  if (err?.[BODY_ERROR] && err.expose === true && status >= 400 && status < 500) return send(status, String(err.message));

  console.error(`[api] unexpected error on ${req.method} ${req.originalUrl.split('?')[0]} (id ${res.locals.requestId ?? '-'}):`, err);
  return send(500, 'Something went wrong. Please try again.');
};
