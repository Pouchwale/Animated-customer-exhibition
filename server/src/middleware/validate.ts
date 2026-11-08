import type { Request } from 'express';
import type { z } from 'zod';
import { HttpError, zodDetails } from './errors.js';

/** Parse `req.body` with a zod schema; throws a 400 with `{ path, message }[]` details. */
export function parseBody<S extends z.ZodType>(schema: S, req: Request): z.output<S> {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) throw new HttpError(400, 'Validation failed', zodDetails(result.error));
  return result.data;
}
