/** Map Prisma rows to the shared API types. */
import type {
  Parameter as DbParameter,
  SuggestionOption as DbSuggestionOption,
  SuggestionParameter as DbSuggestionParameter,
  SuggestionRating as DbSuggestionRating,
} from '@prisma/client';
import type { BrandColor, Parameter, ParameterCategory, SuggestionOption, SuggestionParameter } from '@pw/shared';

export const toParameter = (p: DbParameter): Parameter => ({
  id: p.id,
  key: p.key,
  name: p.name,
  description: p.description,
  category: p.category as ParameterCategory,
  size: Math.min(3, Math.max(1, p.size)) as 1 | 2 | 3,
  color: p.color as BrandColor,
  sortOrder: p.sortOrder,
  active: p.active,
});

export const toSuggestionOption = (o: DbSuggestionOption & { ratings: DbSuggestionRating[] }): SuggestionOption => ({
  id: o.id,
  parameterId: o.parameterId,
  label: o.label,
  description: o.description,
  sortOrder: o.sortOrder,
  enabled: o.enabled,
  ratings: [...o.ratings]
    .sort((a, b) => a.topicKey.localeCompare(b.topicKey))
    .map((r) => ({ topicKey: r.topicKey, stars: r.stars, reason: r.reason })),
});

/** Prisma include for a parameter: its options in display order, each with its ratings. */
export const withOrderedOptions = { options: { orderBy: [{ sortOrder: 'asc' as const }, { label: 'asc' as const }], include: { ratings: true } } };

export const toSuggestionParameter = (
  p: DbSuggestionParameter & { options: (DbSuggestionOption & { ratings: DbSuggestionRating[] })[] },
): SuggestionParameter => ({
  id: p.id,
  key: p.key,
  name: p.name,
  description: p.description,
  sortOrder: p.sortOrder,
  enabled: p.enabled,
  options: p.options.map(toSuggestionOption),
});
