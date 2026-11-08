import { Router } from 'express';
import { prisma } from '../db.js';
import { parseBody } from '../middleware/validate.js';
import { toParameter } from '../services/mappers.js';
import { suggestFor } from '../services/suggestions.js';
import { getIdleLogoSettings } from '../services/idleLogo.js';
import { getIntroSettings } from '../services/intro.js';
import { suggestionRequestSchema } from '../validation.js';

export const publicRouter = Router();

publicRouter.get('/parameters', async (_req, res) => {
  const rows = await prisma.parameter.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  res.json(rows.map(toParameter));
});

/** Step 3: the recommended option per enabled recommendation parameter, from the Step 2 ranking (array order = priority). */
publicRouter.post('/suggestions', async (req, res) => {
  const { priorities } = parseBody(suggestionRequestSchema, req);
  res.json(await suggestFor(priorities));
});

/** Idle logo mode settings for the customer page (read-only). */
publicRouter.get('/idle-logo', async (_req, res) => {
  res.json(await getIdleLogoSettings());
});

/** Which intro animation to play (read-only). */
publicRouter.get('/intro', async (_req, res) => {
  res.json(await getIntroSettings());
});
