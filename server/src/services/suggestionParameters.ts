/**
 * Recommendation parameters (e.g. "Print Type") and their options (e.g. "Digital Printing"),
 * each option rated 1–5 stars per topic. Changes reach customers immediately, so all writes are
 * ADMIN-only at the route level.
 */
import { slugify, type SuggestionOption, type SuggestionParameter } from '@pw/shared';
import type { z } from 'zod';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/errors.js';
import type {
  suggestionOptionCreateSchema,
  suggestionOptionUpdateSchema,
  suggestionParameterCreateSchema,
  suggestionParameterUpdateSchema,
} from '../validation.js';
import { toSuggestionOption, toSuggestionParameter, withOrderedOptions } from './mappers.js';

const PARAM_ORDER = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }];

/** Every parameter with its options, in display order (enabled or not). */
export async function listSuggestionParameters(): Promise<SuggestionParameter[]> {
  const rows = await prisma.suggestionParameter.findMany({ orderBy: PARAM_ORDER, include: withOrderedOptions });
  return rows.map(toSuggestionParameter);
}

async function getParameter(id: string): Promise<SuggestionParameter> {
  const row = await prisma.suggestionParameter.findUnique({ where: { id }, include: withOrderedOptions });
  if (!row) throw new HttpError(404, 'Suggestion parameter not found');
  return toSuggestionParameter(row);
}

/** 404 unless the parameter exists (loads nothing else). */
async function assertParameterExists(id: string): Promise<void> {
  const row = await prisma.suggestionParameter.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw new HttpError(404, 'Suggestion parameter not found');
}

async function nextSortOrder(max: Promise<{ _max: { sortOrder: number | null } }>) {
  return ((await max)._max.sortOrder ?? 0) + 1;
}

export async function createSuggestionParameter(input: z.output<typeof suggestionParameterCreateSchema>): Promise<SuggestionParameter> {
  const { key, ...data } = input;
  const sortOrder = await nextSortOrder(prisma.suggestionParameter.aggregate({ _max: { sortOrder: true } }));
  const row = await prisma.suggestionParameter.create({
    data: { ...data, key: key ?? slugify(data.name), sortOrder },
    include: withOrderedOptions,
  });
  return toSuggestionParameter(row);
}

export async function updateSuggestionParameter(id: string, patch: z.output<typeof suggestionParameterUpdateSchema>): Promise<SuggestionParameter> {
  await assertParameterExists(id);
  const row = await prisma.suggestionParameter.update({ where: { id }, data: patch, include: withOrderedOptions });
  return toSuggestionParameter(row);
}

export async function removeSuggestionParameter(id: string): Promise<void> {
  await assertParameterExists(id);
  await prisma.suggestionParameter.delete({ where: { id } }); // cascades its options
}

/** Exact-set check for a complete new order; details are the usual `{ path, message }` list. */
function assertSameSet(ids: string[], existing: string[], what: string) {
  const known = new Set(existing);
  const sent = new Set(ids);
  const details = [
    ...existing.filter((id) => !sent.has(id)).map((id) => ({ path: 'ids', message: `Missing ${what} id: ${id}` })),
    ...ids.flatMap((id, i) => (known.has(id) ? [] : [{ path: `ids.${i}`, message: `Unknown ${what} id: ${id}` }])),
  ];
  if (details.length || ids.length !== existing.length) {
    throw new HttpError(400, `Send every ${what} id exactly once, in the new order`, details);
  }
}

/** The new sortOrder (1, 2, …) of each id, sorted by id: concurrent reorders then lock rows in the same order. */
function sortOrdersById(ids: string[]) {
  return ids.map((id, i) => ({ id, sortOrder: i + 1 })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function reorderSuggestionParameters(ids: string[]): Promise<SuggestionParameter[]> {
  const existing = await prisma.suggestionParameter.findMany({ select: { id: true } });
  assertSameSet(
    ids,
    existing.map((x) => x.id),
    'parameter',
  );
  await prisma.$transaction(
    sortOrdersById(ids).map(({ id, sortOrder }) => prisma.suggestionParameter.update({ where: { id }, data: { sortOrder } })),
  );
  return listSuggestionParameters();
}

// ---- Options -------------------------------------------------------------------

export async function addSuggestionOption(parameterId: string, input: z.output<typeof suggestionOptionCreateSchema>): Promise<SuggestionOption> {
  await assertParameterExists(parameterId);
  const sortOrder = await nextSortOrder(prisma.suggestionOption.aggregate({ where: { parameterId }, _max: { sortOrder: true } }));
  const { ratings, ...data } = input;
  const entries = rated(ratings);
  await assertTopicsExist(entries.map(([key]) => key));
  const row = await prisma.suggestionOption.create({
    data: { ...data, parameterId, sortOrder, ratings: { create: entries.map(([topicKey, r]) => ({ topicKey, stars: r.stars, reason: r.reason })) } },
    include: { ratings: true },
  });
  return toSuggestionOption(row);
}

/** 404 unless the option exists (loads nothing else). */
async function assertOptionExists(id: string): Promise<void> {
  const row = await prisma.suggestionOption.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw new HttpError(404, 'Option not found');
}

export async function updateSuggestionOption(id: string, patch: z.output<typeof suggestionOptionUpdateSchema>): Promise<SuggestionOption> {
  await assertOptionExists(id);
  const { ratings, ...data } = patch;
  const entries = ratings ? rated(ratings) : null;
  if (entries) await assertTopicsExist(entries.map(([key]) => key));
  await prisma.$transaction([
    // Always touches the row (even for a ratings-only save): that locks it, so two saves of one option queue up
    // instead of interleaving their delete-then-insert and colliding (409).
    prisma.suggestionOption.update({ where: { id }, data: { ...data, updatedAt: new Date() } }),
    ...(entries
      ? [
          prisma.suggestionRating.deleteMany({ where: { optionId: id } }),
          prisma.suggestionRating.createMany({
            data: entries.map(([topicKey, r]) => ({ optionId: id, topicKey, stars: r.stars, reason: r.reason })),
          }),
        ]
      : []),
  ]);
  const row = await prisma.suggestionOption.findUniqueOrThrow({ where: { id }, include: { ratings: true } });
  return toSuggestionOption(row);
}

/** The ratings to store: 1–5 stars (0 = not rated, so left out). */
function rated(ratings: Record<string, { stars: number; reason: string | null }>) {
  return Object.entries(ratings).filter(([, r]) => r.stars > 0);
}

/** Every rating must be for a priority topic that exists. */
async function assertTopicsExist(keys: string[]) {
  if (!keys.length) return;
  const found = new Set((await prisma.parameter.findMany({ where: { key: { in: keys } }, select: { key: true } })).map((p) => p.key));
  const unknown = keys.filter((k) => !found.has(k));
  if (unknown.length) {
    throw new HttpError(
      400,
      `Unknown priority topic: ${unknown.join(', ')}`,
      unknown.map((k) => ({ path: `ratings.${k}`, message: 'Unknown topic' })),
    );
  }
}

export async function removeSuggestionOption(id: string): Promise<void> {
  await assertOptionExists(id);
  await prisma.suggestionOption.delete({ where: { id } });
}

export async function reorderSuggestionOptions(parameterId: string, ids: string[]): Promise<SuggestionParameter> {
  await assertParameterExists(parameterId);
  const current = await prisma.suggestionOption.findMany({ where: { parameterId }, select: { id: true } });
  assertSameSet(
    ids,
    current.map((o) => o.id),
    'option',
  );
  await prisma.$transaction(sortOrdersById(ids).map(({ id, sortOrder }) => prisma.suggestionOption.update({ where: { id }, data: { sortOrder } })));
  return getParameter(parameterId);
}
