/**
 * Idempotent, non-destructive seed: creates missing rows only, never overwrites admin edits.
 *   npm run setup -w server   (migrate deploy + seed)
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { passwordProblems } from '@pw/shared';
import bcrypt from 'bcryptjs';
import { seedParameters, seedSuggestionParameters } from './seed-data.js';

// server/.env, like the API, whether run as prisma/seed.ts or dist/seed.js and from any folder. Real env vars win.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const prisma = new PrismaClient();

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * ADMIN_PASSWORD values that are public: the placeholder server/.env.example ships with now (read from the file, so they
 * can't drift) and the one older versions shipped with. That old one is kept only as a SHA-256 fingerprint, so this
 * public code doesn't spell out a password that older installs may still use.
 */
const OLD_PLACEHOLDER_SHA256 = '2471a9eb4d709d78c59cb8141ec108cce7db9c71b901d76b01cb1efcc2913b94';

function isPlaceholderPassword(password: string): boolean {
  if (sha256(password) === OLD_PLACEHOLDER_SHA256) return true;
  try {
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    return /^ADMIN_PASSWORD=(.*)$/m.exec(example)?.[1]?.trim() === password;
  } catch {
    return false; // no .env.example (e.g. a slim deploy): the fingerprint check still applies
  }
}

/**
 * Production refuses a placeholder or weak ADMIN_PASSWORD when it would create the admin; development only warns.
 * Once the admin exists the password isn't used (it's changed in the admin panel), so a release isn't blocked.
 */
async function checkAdminPassword(email: string, password: string) {
  const problems = isPlaceholderPassword(password) ? ['It is the placeholder from server/.env.example.'] : passwordProblems(password, email);
  if (!problems.length) return;
  const creating = !(await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() }, select: { id: true } }));
  if (process.env.NODE_ENV === 'production' && creating) {
    throw new Error(`ADMIN_PASSWORD is not safe for production: ${problems.join(' ')} Set a strong, unique one and run the seed again.`);
  }
  console.warn(`[seed] warning: ADMIN_PASSWORD is weak (${problems.join(' ')}) Fine for local development only.`);
}

async function main() {
  // Checked first, so a refused run changes nothing.
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set to seed the first admin.');
  await checkAdminPassword(email, password);

  // Topics (the bubbles customers rank): create missing ones only.
  for (const [i, p] of seedParameters.entries()) {
    await prisma.parameter.upsert({
      where: { key: p.key },
      update: {},
      create: { ...p, sortOrder: i + 1 },
    });
  }

  // Recommendation parameters (Print Type, Material Type …): defaults only while none exist, so admin edits are never undone.
  if ((await prisma.suggestionParameter.count()) === 0) {
    const topics = new Set((await prisma.parameter.findMany({ select: { key: true } })).map((p) => p.key));
    for (const [i, { options, ...param }] of seedSuggestionParameters.entries()) {
      await prisma.suggestionParameter.create({
        data: {
          ...param,
          sortOrder: i + 1,
          options: {
            create: options.map((o, j) => ({
              label: o.label,
              description: o.description,
              sortOrder: j + 1,
              ratings: {
                create: Object.entries(o.ratings)
                  .filter(([key]) => topics.has(key))
                  .map(([topicKey, [stars, reason]]) => ({ topicKey, stars, reason })),
              },
            })),
          },
        },
      });
    }
  }

  // Settings rows with the schema defaults, when missing (reads never create them).
  await prisma.introSettings.createMany({ data: [{ id: 1 }], skipDuplicates: true });
  await prisma.idleLogoSettings.createMany({ data: [{ id: 1 }], skipDuplicates: true });

  // The admin account: the only seeded login (the EDITOR role still exists, but no editor account is seeded).
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.adminUser.upsert({
    where: { email: email.toLowerCase() },
    update: {},
    create: { email: email.toLowerCase(), name: 'PouchWale Admin', passwordHash, role: 'ADMIN' },
  });

  console.log('[seed] done');
}

main()
  .catch((e) => {
    console.error('[seed] failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
