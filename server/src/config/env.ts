import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

/** The JWT_SECRET placeholder in server/.env.example: never accepted in production. */
export const EXAMPLE_JWT_SECRET = 'replace-with-a-long-random-string-of-at-least-32-chars';

/** RECOMMENDER values. 'rule-based' is the old name, still accepted so existing .env files keep working. */
export const RECOMMENDERS = ['priority-weighted', 'rule-based'] as const;

/** The server package folder (package.json named @pw/server): found from src/config under tsx and from the bundled dist/. */
export function findServerDir(start = path.dirname(fileURLToPath(import.meta.url))): string | undefined {
  for (let dir = start; ; dir = path.dirname(dir)) {
    try {
      if (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name === '@pw/server') return dir;
    } catch {
      // No readable package.json here: keep walking up.
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** true/false, 1/0, yes/no, on/off (any case); undefined when it is none of these. */
export function parseBool(value: string): boolean | undefined {
  const v = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  return undefined;
}

export type TrustProxy = boolean | number | string[];

const isSubnet = (s: string) => {
  if (['loopback', 'linklocal', 'uniquelocal'].includes(s)) return true;
  const [ip, bits, ...rest] = s.split('/');
  const family = isIP(ip);
  if (!family || rest.length) return false;
  if (bits === undefined) return true;
  if (/^\d{1,3}$/.test(bits)) return Number(bits) <= (family === 4 ? 32 : 128);
  return family === 4 && isIP(bits) === 4; // 10.0.0.0/255.0.0.0
};

/**
 * Express "trust proxy" from TRUST_PROXY: a hop count, true/false, or a comma-separated list of addresses, subnets
 * or the names loopback / linklocal / uniquelocal. undefined when invalid.
 */
export function parseTrustProxy(value: string): TrustProxy | undefined {
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v);
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  const list = v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length && list.every(isSubnet) ? list : undefined;
}

const required = (name: string) => ({ error: `${name} is required` });

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().optional(),
    DATABASE_URL: z.string(required('DATABASE_URL')).min(1, 'DATABASE_URL is required'),
    JWT_SECRET: z.string(required('JWT_SECRET')).min(16, 'JWT_SECRET must be at least 16 characters'),
    RECOMMENDER: z.enum(RECOMMENDERS, { error: `RECOMMENDER must be one of: ${RECOMMENDERS.join(', ')}` }).default('priority-weighted'),
    CLIENT_DIST: z.string().default('../client/dist'),
    HTTPS: z
      .string()
      .optional()
      .refine((v) => v === undefined || parseBool(v) !== undefined, 'HTTPS must be true or false'),
    TRUST_PROXY: z
      .string()
      .optional()
      .refine(
        (v) => v === undefined || parseTrustProxy(v) !== undefined,
        'TRUST_PROXY must be a hop count, true/false, or a comma-separated list of addresses/subnets',
      ),
    KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(65_000),
    HEADERS_TIMEOUT_MS: z.coerce.number().int().positive().default(66_000),
    // Keep-alive ping (see keepAlive.ts). Render sets RENDER_EXTERNAL_URL itself on every web service.
    RENDER_EXTERNAL_URL: z.string().optional(),
    KEEP_ALIVE_URL: z.string().optional(),
    KEEP_ALIVE_MINUTES: z.coerce.number().min(1, 'KEEP_ALIVE_MINUTES must be at least 1').max(14, 'KEEP_ALIVE_MINUTES must be at most 14 (Render sleeps after 15)').default(10),
  })
  .superRefine((env, ctx) => {
    if (env.HEADERS_TIMEOUT_MS <= env.KEEP_ALIVE_TIMEOUT_MS) {
      const message = 'HEADERS_TIMEOUT_MS must be greater than KEEP_ALIVE_TIMEOUT_MS';
      ctx.addIssue({ code: 'custom', path: ['HEADERS_TIMEOUT_MS'], message });
    }
    if (env.NODE_ENV !== 'production') return;
    // Messages only: never the secret itself.
    if (env.JWT_SECRET.length < 32) {
      ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET must be at least 32 characters in production' });
    }
    if (env.JWT_SECRET === EXAMPLE_JWT_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message: 'JWT_SECRET is still the example value from .env.example' });
    } else if (new Set(env.JWT_SECRET).size < 10) {
      const message = 'JWT_SECRET is not random enough (fewer than 10 different characters)';
      ctx.addIssue({ code: 'custom', path: ['JWT_SECRET'], message });
    }
  });

/** True when DATABASE_URL still uses the example postgres/postgres login. */
const usesExampleDbLogin = (url: string) => {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.username) === 'postgres' && decodeURIComponent(u.password) === 'postgres';
  } catch {
    return false;
  }
};

/**
 * Validates raw environment variables (blank counts as unset) and derives the runtime settings. Pure: no I/O, no exit.
 * Relative CLIENT_DIST is resolved against `baseDir` (the server package folder).
 */
export function parseEnv(raw: Record<string, string | undefined>, baseDir: string) {
  const input = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const data = parsed.data;
  const isProduction = data.NODE_ENV === 'production';
  const https = data.HTTPS === undefined ? isProduction : parseBool(data.HTTPS)!;
  const warnings: string[] = [];
  const keepAliveUrl = keepAliveTarget(data.KEEP_ALIVE_URL, data.RENDER_EXTERNAL_URL);
  if (keepAliveUrl === undefined && data.KEEP_ALIVE_URL && parseBool(data.KEEP_ALIVE_URL) !== false) {
    return { ok: false as const, errors: ['KEEP_ALIVE_URL: must be an http(s) address, or false to turn the keep-alive ping off'] };
  }
  if (isProduction && usesExampleDbLogin(data.DATABASE_URL)) {
    warnings.push('DATABASE_URL uses the example postgres/postgres login. Fine for embedded Postgres on a laptop; change it on a server.');
  }
  return {
    ok: true as const,
    warnings,
    env: {
      ...data,
      isProduction,
      /** Listen address: loopback in development (LAN clients come through the Vite proxy), all interfaces in production. */
      host: data.HOST?.trim() || (isProduction ? '0.0.0.0' : '127.0.0.1'),
      /** Served over HTTPS (directly or behind a TLS proxy): HSTS, upgrade-insecure-requests, Secure cookies. */
      https,
      cookieSecure: https,
      trustProxy: data.TRUST_PROXY === undefined ? (isProduction ? 1 : false) : parseTrustProxy(data.TRUST_PROXY)!,
      clientDist: path.resolve(baseDir, data.CLIENT_DIST),
      /** Health URL the server pings every KEEP_ALIVE_MINUTES so a free Render service never sleeps; null = off. */
      keepAliveUrl: keepAliveUrl ?? null,
    },
  };
}

/**
 * The keep-alive target: KEEP_ALIVE_URL if given (`false` turns it off), else Render's own public address.
 * Off everywhere else (local development, other hosts). Returns the full /api/health URL, or undefined when off.
 */
export function keepAliveTarget(setting: string | undefined, renderUrl: string | undefined): string | undefined {
  if (setting !== undefined && parseBool(setting) === false) return undefined;
  const base = setting ?? renderUrl;
  if (!base) return undefined;
  try {
    const u = new URL(base);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined;
    return new URL('/api/health', u.origin).toString();
  } catch {
    return undefined;
  }
}

export type Env = Extract<ReturnType<typeof parseEnv>, { ok: true }>['env'];

/** server/ (from src/config or dist/); the working directory if the package.json is not deployed. */
export const serverDir = findServerDir() ?? process.cwd();

// Real environment variables win over server/.env.
dotenv.config({ path: path.join(serverDir, '.env') });

const result = parseEnv(process.env, serverDir);
if (!result.ok) {
  console.error('[env] invalid configuration:');
  for (const error of result.errors) console.error(`  - ${error}`);
  process.exit(1);
}
for (const warning of result.warnings) console.warn(`[env] warning: ${warning}`);
if (result.env.isProduction && !existsSync(path.join(result.env.clientDist, 'index.html'))) {
  console.warn(`[env] warning: no client build at ${result.env.clientDist}; only the API is served.`);
}

export const env: Env = result.env;
