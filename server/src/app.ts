import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env, type Env } from './config/env.js';
import { bodyErrors, errorHandler, notFoundApi } from './middleware/errors.js';
import { requestLog } from './middleware/requestLog.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { publicRouter } from './routes/public.js';

/** The settings createApp reads (tests pass their own). */
export type AppConfig = Pick<Env, 'isProduction' | 'https' | 'trustProxy' | 'clientDist'>;

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function createApp(config: AppConfig = env) {
  const app = express();
  app.disable('x-powered-by');
  // Proxies trusted for the client IP (rate limits): TRUST_PROXY, default one hop in production.
  app.set('trust proxy', config.trustProxy);

  app.use(requestLog(config.isProduction));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Google Fonts are loaded by the client.
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          // Over plain HTTP (e.g. a laptop on the stall Wi-Fi) the browser must not upgrade requests to HTTPS.
          ...(config.https ? {} : { 'upgrade-insecure-requests': null }),
        },
      },
      strictTransportSecurity: config.https,
    }),
  );
  app.use(bodyErrors(express.json({ limit: '100kb' })));
  app.use(cookieParser());

  const api = express.Router();
  api.use(healthRouter); // first: health checks are never rate limited
  // Production only: in dev every LAN client comes through the Vite proxy, i.e. one address.
  if (config.isProduction) {
    api.use(
      rateLimit({
        windowMs: 60 * 1000,
        limit: 600,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { error: 'Too many requests. Please wait a minute and try again.' },
      }),
    );
  }
  api.use(publicRouter);
  api.use('/auth', authRouter);
  api.use('/admin', adminRouter);
  api.use(notFoundApi);
  app.use('/api', api);

  // Production: serve the built client. Hashed /assets never change; index.html is revalidated so new builds show.
  const indexHtml = path.join(config.clientDist, 'index.html');
  if (config.isProduction && existsSync(indexHtml)) {
    app.use('/assets', express.static(path.join(config.clientDist, 'assets'), { index: false, immutable: true, maxAge: ONE_YEAR_MS }));
    app.use(
      express.static(config.clientDist, {
        index: false,
        maxAge: '1h',
        setHeaders: (res, file) => {
          if (path.basename(file) === 'index.html') res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    // SPA routes (/admin): GET paths without a file extension. A missing file (e.g. an old chunk) stays a 404.
    app.use((req, res, next) => {
      const isApi = req.path === '/api' || req.path.startsWith('/api/');
      if ((req.method !== 'GET' && req.method !== 'HEAD') || isApi || path.extname(req.path)) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use(errorHandler);
  return app;
}
