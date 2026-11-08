import { Router, type NextFunction, type Request, type Response } from 'express';
import { slugify } from '@pw/shared';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { parseBody } from '../middleware/validate.js';
import { toParameter } from '../services/mappers.js';
import { invalidateSuggestionCache } from '../services/suggestions.js';
import {
  addSuggestionOption,
  createSuggestionParameter,
  listSuggestionParameters,
  removeSuggestionOption,
  removeSuggestionParameter,
  reorderSuggestionOptions,
  reorderSuggestionParameters,
  updateSuggestionOption,
  updateSuggestionParameter,
} from '../services/suggestionParameters.js';
import { getIdleLogoSettings, saveIdleLogoSettings } from '../services/idleLogo.js';
import { getIntroSettings, saveIntroSettings } from '../services/intro.js';
import {
  parameterCreateSchema,
  parameterUpdateSchema,
  reorderSchema,
  suggestionOptionCreateSchema,
  suggestionOptionUpdateSchema,
  suggestionParameterCreateSchema,
  suggestionParameterUpdateSchema,
  idleLogoSettingsSchema,
  introSettingsSchema,
} from '../validation.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('EDITOR'));

/**
 * Any write (topics included) can change what customers are recommended: drop the cached engine context.
 * On 'close', not 'finish': 'finish' never fires when the client disconnects first, though the write may have committed.
 * Failed writes clear it too; that only costs one extra load.
 */
export const invalidateOnWrite =
  (clear: () => void = invalidateSuggestionCache) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') res.once('close', () => clear());
    next();
  };
adminRouter.use(invalidateOnWrite());

const id = (req: Request) => String(req.params.id);

// ---- Parameters -------------------------------------------------------------

adminRouter.get('/parameters', async (_req, res) => {
  const rows = await prisma.parameter.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  res.json(rows.map(toParameter));
});

adminRouter.post('/parameters', async (req, res) => {
  const { key, ...data } = parseBody(parameterCreateSchema, req);
  const row = await prisma.parameter.create({ data: { ...data, description: data.description ?? null, key: key ?? slugify(data.name) } });
  res.status(201).json(toParameter(row));
});

adminRouter.put('/parameters/:id', async (req, res) => {
  const data = parseBody(parameterUpdateSchema, req);
  const row = await prisma.parameter.update({ where: { id: req.params.id }, data });
  res.json(toParameter(row));
});

// ADMIN only: deleting a topic also deletes every star rating on it, and ratings are admin-only.
adminRouter.delete('/parameters/:id', requireRole('ADMIN'), async (req, res) => {
  await prisma.parameter.delete({ where: { id: id(req) } });
  res.status(204).end();
});

// ---- Recommendation parameters & options -----------------------------------------------
// e.g. Print Type → Flexo, Gravure, Digital…, each option rated 1–5 stars per topic.
// Changes reach customers immediately, so writes are ADMIN only.

adminRouter.get('/suggestion-parameters', async (_req, res) => {
  res.json(await listSuggestionParameters());
});

adminRouter.post('/suggestion-parameters/reorder', requireRole('ADMIN'), async (req, res) => {
  const { ids } = parseBody(reorderSchema, req);
  res.json(await reorderSuggestionParameters(ids));
});

adminRouter.post('/suggestion-parameters', requireRole('ADMIN'), async (req, res) => {
  res.status(201).json(await createSuggestionParameter(parseBody(suggestionParameterCreateSchema, req)));
});

adminRouter.put('/suggestion-parameters/:id', requireRole('ADMIN'), async (req, res) => {
  res.json(await updateSuggestionParameter(id(req), parseBody(suggestionParameterUpdateSchema, req)));
});

adminRouter.delete('/suggestion-parameters/:id', requireRole('ADMIN'), async (req, res) => {
  await removeSuggestionParameter(id(req));
  res.status(204).end();
});

adminRouter.post('/suggestion-parameters/:id/options/reorder', requireRole('ADMIN'), async (req, res) => {
  const { ids } = parseBody(reorderSchema, req);
  res.json(await reorderSuggestionOptions(id(req), ids));
});

adminRouter.post('/suggestion-parameters/:id/options', requireRole('ADMIN'), async (req, res) => {
  res.status(201).json(await addSuggestionOption(id(req), parseBody(suggestionOptionCreateSchema, req)));
});

adminRouter.put('/suggestion-options/:id', requireRole('ADMIN'), async (req, res) => {
  res.json(await updateSuggestionOption(id(req), parseBody(suggestionOptionUpdateSchema, req)));
});

adminRouter.delete('/suggestion-options/:id', requireRole('ADMIN'), async (req, res) => {
  await removeSuggestionOption(id(req));
  res.status(204).end();
});

// ---- Idle logo mode -----------------------------------------------------------------
// Everyone signed in can read; only admins can change it.

adminRouter.get('/idle-logo', async (_req, res) => {
  res.json(await getIdleLogoSettings());
});

adminRouter.put('/idle-logo', requireRole('ADMIN'), async (req, res) => {
  res.json(await saveIdleLogoSettings(parseBody(idleLogoSettingsSchema, req)));
});

// ---- Intro animation ---------------------------------------------------------------
// Everyone signed in can read; only admins can change it.

adminRouter.get('/intro', async (_req, res) => {
  res.json(await getIntroSettings());
});

adminRouter.put('/intro', requireRole('ADMIN'), async (req, res) => {
  res.json(await saveIntroSettings(parseBody(introSettingsSchema, req)));
});
