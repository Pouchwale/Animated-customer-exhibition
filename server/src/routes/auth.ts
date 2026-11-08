import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { passwordProblems, type AdminUser } from '@pw/shared';
import { prisma } from '../db.js';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { parseBody } from '../middleware/validate.js';
import { changePasswordSchema, loginSchema } from '../validation.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' },
});

// Used to keep timing similar when the email does not exist.
const DUMMY_HASH = bcrypt.hashSync('pouchwale-dummy-password', 12);

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = parseBody(loginSchema, req);
  const user = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Incorrect email or password');

  const publicUser: AdminUser = { id: user.id, email: user.email, name: user.name, role: user.role };
  setSessionCookie(res, publicUser, user.tokenVersion);
  res.json(publicUser);
});

/** Wrong current passwords, per account: a stolen session can't be used to guess the password. */
const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (_req, res) => `user:${res.locals.user?.id}`,
  requestWasSuccessful: (_req, res) => !res.locals.wrongPassword,
  skipSuccessfulRequests: true,
  message: { error: 'Too many wrong passwords. Please wait 15 minutes and try again.' },
});

/** Change your own password (any role). Other sessions of this account are signed out. */
authRouter.post('/password', requireAuth, passwordLimiter, async (req, res) => {
  const { currentPassword, newPassword } = parseBody(changePasswordSchema, req);
  const user = await prisma.adminUser.findUnique({ where: { id: res.locals.user!.id } });
  if (!user) throw new HttpError(401, 'Please sign in');

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    res.locals.wrongPassword = true;
    throw new HttpError(400, 'Your current password is not correct', [{ path: 'currentPassword', message: 'Your current password is not correct.' }]);
  }
  const problems = passwordProblems(newPassword, user.email);
  if (problems.length)
    throw new HttpError(
      400,
      'Validation failed',
      problems.map((message) => ({ path: 'newPassword', message })),
    );

  const updated = await prisma.adminUser.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 12), tokenVersion: { increment: 1 } },
  });
  // This browser stays signed in with a fresh session; older ones (other devices) stop working.
  const publicUser: AdminUser = { id: updated.id, email: updated.email, name: updated.name, role: updated.role };
  setSessionCookie(res, publicUser, updated.tokenVersion);
  res.json(publicUser);
});

authRouter.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

authRouter.get('/me', requireAuth, (_req, res) => {
  res.json(res.locals.user);
});
