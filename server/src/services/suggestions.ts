/**
 * Priority-based recommendations (customer Step 3): the Step 2 ranking plus the admin's recommendation
 * parameters (options rated 1–5 stars per topic) go into the engine.
 */
import type { PriorityInput, SuggestionResult } from '@pw/shared';
import { env } from '../config/env.js';
import { prisma } from '../db.js';
import { getProvider } from '../engine/index.js';
import type { EngineContext } from '../engine/types.js';
import { cachedLoad } from './cache.js';
import { listSuggestionParameters } from './suggestionParameters.js';

async function loadContext(): Promise<EngineContext> {
  const [parameters, topics] = await Promise.all([
    listSuggestionParameters(),
    prisma.parameter.findMany({ select: { key: true, name: true, sortOrder: true, active: true } }),
  ]);
  return { parameters, topics };
}

// The engine context is the same for every customer, so it is loaded at most once a minute. Admin writes drop it
// at once (see routes/admin.ts). It is shared between requests: engines must never change it.
const context = cachedLoad(loadContext, 60_000);

/** Make the next suggestion request reload parameters, options, ratings and topics. */
export const invalidateSuggestionCache = context.invalidate;

export async function suggestFor(priorities: PriorityInput[]): Promise<SuggestionResult> {
  return getProvider(env.RECOMMENDER).suggest(priorities, await context.get());
}
