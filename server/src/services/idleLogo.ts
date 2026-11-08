/** Idle logo mode settings: a single row (id 1). Reads never write: a missing row means the defaults. */
import { isTransitionSpeed, type IdleLogoSettings } from '@pw/shared';
import { prisma } from '../db.js';

/** Same as the schema defaults; the seed creates the row. */
const DEFAULTS: IdleLogoSettings = { enabled: true, idleMinutes: 1, formSeconds: 3, transitionSpeed: 'normal', holdSeconds: 20 };

const toSettings = (r: Omit<IdleLogoSettings, 'transitionSpeed'> & { transitionSpeed: string }): IdleLogoSettings => ({
  enabled: r.enabled,
  idleMinutes: r.idleMinutes,
  formSeconds: r.formSeconds,
  transitionSpeed: isTransitionSpeed(r.transitionSpeed) ? r.transitionSpeed : DEFAULTS.transitionSpeed,
  holdSeconds: r.holdSeconds,
});

export async function getIdleLogoSettings(): Promise<IdleLogoSettings> {
  const row = await prisma.idleLogoSettings.findUnique({ where: { id: 1 } });
  return row ? toSettings(row) : { ...DEFAULTS };
}

export async function saveIdleLogoSettings(data: Partial<IdleLogoSettings>): Promise<IdleLogoSettings> {
  const row = await prisma.idleLogoSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  return toSettings(row);
}
