import type { SuggestionProvider } from './types.js';
import { PRIORITY_WEIGHTED, priorityWeightedProvider } from './priorityWeighted.js';

const providers: Record<string, SuggestionProvider> = {
  [PRIORITY_WEIGHTED]: priorityWeightedProvider,
  // Accepted so older .env files that still say RECOMMENDER=rule-based keep working.
  'rule-based': priorityWeightedProvider,
  // Future: an AI provider implementing the same interface, selected with RECOMMENDER.
};

const availableProviders = Object.keys(providers);

export function getProvider(name: string): SuggestionProvider {
  const provider = providers[name];
  if (!provider) throw new Error(`Unknown RECOMMENDER "${name}". Available: ${availableProviders.join(', ')}`);
  return provider;
}
