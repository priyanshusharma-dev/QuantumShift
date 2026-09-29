import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { initDb, dbEngine } from './db/index.js';
import { seedIfEmpty } from './db/seed.js';
import { api } from './routes/api.js';
import { runDiagnostics } from './services/health.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)), credentials: false, methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({
  windowMs: 60_000,
  limit: config.rateLimitPerMinute,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path === '/stream',
  message: { error: { message: 'Too many requests — please slow down.', code: 429 } },
});
const heavyLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { message: 'Too many scan/upload requests — try again in a minute.', code: 429 } } });

app.use('/api', limiter);
app.use(['/api/scan', '/api/repositories/upload', '/api/demo/run', '/api/system/reset'], heavyLimiter);
app.use('/api', api);

// Serve the built React app (production) with SPA fallback.
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
}

// Central error handler — never leaks stack traces to clients.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal error';
  if (err.code === 'LIMIT_FILE_SIZE') { status = 413; message = `Upload exceeds ${config.uploadMaxMb} MB`; }
  if (err.type === 'entity.parse.failed') { status = 400; message = 'Malformed JSON body'; }
  if (status >= 500) {
    console.error(`[api] ${req.method} ${req.originalUrl} →`, err);
    message = config.env === 'production' ? 'Internal server error' : message;
  }
  res.status(status).json({ error: { message, code: status, details: err.details } });
});

async function main() {
  await initDb();
  console.log(`[db] connected — ${dbEngine()}`);
  await seedIfEmpty();
  app.listen(config.port, () => {
    console.log(`[api] QuantumShift API listening on http://localhost:${config.port}`);
    if (config.jwtSecretEphemeral) console.warn('[security] JWT_SECRET not set — using an ephemeral per-process secret (sessions reset on restart).');
    runDiagnostics().catch((e) => console.error('[diagnostics]', e.message));
  });
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
