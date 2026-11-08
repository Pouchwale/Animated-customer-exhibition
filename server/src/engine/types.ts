import type { PriorityInput, RecommendTopic, SuggestionParameter, SuggestionResult } from '@pw/shared';

/** Everything an engine needs. Loaded from the database by the service layer. */
export interface EngineContext {
  /** Every recommendation parameter with its options (enabled or not); engines use enabled ones only. */
  parameters: SuggestionParameter[];
  /** All priority topics, so each recommendation also lists the ones the customer didn't rank. */
  topics?: RecommendTopic[];
}

/**
 * A recommendation strategy. Today: `priority-weighted`. Later an AI provider can implement the
 * same interface and be selected via RECOMMENDER.
 */
export interface SuggestionProvider {
  readonly name: string;
  suggest(priorities: PriorityInput[], context: EngineContext): Promise<SuggestionResult>;
}
