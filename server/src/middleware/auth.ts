import type { RequestHandler, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AdminRole, AdminUser } from '@pw/shared';
import { env } from '../config/env.js';
import { prisma } from '../db.js';
import { HttpError } from './errors.js';

export const SESSION_COOKIE = 'pw_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;

interface SessionClaims {
  sub: string;
  role: AdminRole;
  /** The account's token version when signed in (missing on sessions from before versions existed = 0). */
  ver?: number;
}

declare global {
  namespace Express {
    interface Locals {
      user?: AdminUser;
      /** Set when a password change failed on the current password (counts toward the limit). */
      wrongPassword?: boolean;
    }
  }
}

export function setSessionCookie(res: Response, user: AdminUser, tokenVersion: number) {
  const token = jwt.sign({ sub: user.id, role: user.role, ver: tokenVersion } satisfies SessionClaims, env.JWT_SECRET, {
    expiresIn: SESSION_TTL_SECONDS,
    algorithm: 'HS256',
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.cookieSecure,
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/api',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: env.cookieSecure, path: '/api' });
}

/** Verifies the session cookie and loads the user (so deleted users / role changes take effect). */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || !token) throw new HttpError(401, 'Please sign in');
  let claims: SessionClaims;
  try {
    claims = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as SessionClaims;
  } catch {
    clearSessionCookie(res);
    throw new HttpError(401, 'Your session has expired. Please sign in again');
  }
  const user = await prisma.adminUser.findUnique({ where: { id: claims.sub } });
  if (!user) {
    clearSessionCookie(res);
    throw new HttpError(401, 'Please sign in');
  }
  // The password was changed since this session started: it no longer counts.
  if ((claims.ver ?? 0) !== user.tokenVersion) {
    clearSessionCookie(res);
    throw new HttpError(401, 'Your password was changed. Please sign in again');
  }
  res.locals.user = { id: user.id, email: user.email, name: user.name, role: user.role };
  next();
};

const RANK: Record<AdminRole, number> = { EDITOR: 1, ADMIN: 2 };

/** Allow users whose role is at least `minRole` (ADMIN ⊇ EDITOR). Use after requireAuth. */
export const requireRole =
  (minRole: AdminRole): RequestHandler =>
  (_req, res, next) => {
    const user = res.locals.user;
    if (!user) throw new HttpError(401, 'Please sign in');
    // Fail closed: an unknown role has no rank and is refused.
    if (!(RANK[user.role] >= RANK[minRole])) throw new HttpError(403, 'Your role does not allow this action');
    next();
  };
