/** Intro animation setting: a single row (id 1). Reads never write: a missing row means the default. */
import { isIntroChoice, type IntroSettings } from '@pw/shared';
import { prisma } from '../db.js';

/** Same as the schema default; the seed creates the row. */
const DEFAULT_STYLE = 'rotate';

const toSettings = (style: string): IntroSettings => ({ style: isIntroChoice(style) ? style : DEFAULT_STYLE });

export async function getIntroSettings(): Promise<IntroSettings> {
  const row = await prisma.introSettings.findUnique({ where: { id: 1 } });
  return toSettings(row?.style ?? DEFAULT_STYLE);
}

export async function saveIntroSettings(data: IntroSettings): Promise<IntroSettings> {
  const row = await prisma.introSettings.upsert({ where: { id: 1 }, update: data, create: { id: 1, ...data } });
  return toSettings(row.style);
}
