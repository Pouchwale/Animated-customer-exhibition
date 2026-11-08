/**
 * Priority-weighted recommendation engine: the customer's ranked topics (Step 2) and the admin's
 * recommendation parameters, whose options are rated 1–5 stars per topic. The scoring itself is the
 * shared `recommend()` (also used by the admin "Try it"), so both always agree. See docs/API.md.
 */
import { recommend, type PriorityInput, type SuggestionResult } from '@pw/shared';
import type { EngineContext, SuggestionProvider } from './types.js';

export const PRIORITY_WEIGHTED = 'priority-weighted';

export function suggest(priorities: PriorityInput[], ctx: EngineContext, now: Date = new Date()): SuggestionResult {
  return { engine: PRIORITY_WEIGHTED, generatedAt: now.toISOString(), ...recommend(ctx.parameters, priorities, ctx.topics) };
}

export const priorityWeightedProvider: SuggestionProvider = {
  name: PRIORITY_WEIGHTED,
  async suggest(priorities, ctx) {
    return suggest(priorities, ctx);
  },
};
