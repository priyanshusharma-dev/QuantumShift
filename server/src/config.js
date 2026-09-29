import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');

// Load .env from the project root first, then allow server/.env to override.
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });
dotenv.config({ path: path.join(SERVER_ROOT, '.env'), override: true, quiet: true });

const env = process.env;
const list = (v, d) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);

let jwtSecret = env.JWT_SECRET;
let jwtSecretEphemeral = false;
if (!jwtSecret || jwtSecret.length < 32) {
  // Never ship a hardcoded secret: generate a per-process secret when none is configured.
  jwtSecret = crypto.randomBytes(48).toString('hex');
  jwtSecretEphemeral = true;
}

export const config = {
  env: env.NODE_ENV || 'development',
  port: Number(env.PORT) || 4000,
  databaseUrl: env.DATABASE_URL || '',
  pgliteDir: path.resolve(SERVER_ROOT, env.PGLITE_DATA_DIR || 'data/pglite'),
  uploadDir: path.resolve(SERVER_ROOT, env.UPLOAD_DIR || 'data/uploads'),
  demoReposDir: path.join(SERVER_ROOT, 'demo-repos'),
  demoSourcesDir: path.join(SERVER_ROOT, 'demo-sources'),
  clientDist: path.join(PROJECT_ROOT, 'client', 'dist'),
  jwtSecret,
  jwtSecretEphemeral,
  jwtTtl: env.JWT_TTL || '8h',
  corsOrigins: list(env.CORS_ORIGINS, ['http://localhost:5173', 'http://127.0.0.1:5173']),
  defaultMode: env.DEFAULT_MODE === 'real' ? 'real' : 'demo',
  uploadMaxMb: Number(env.UPLOAD_MAX_MB) || 20,
  pacingMs: env.PACING_MS !== undefined ? Number(env.PACING_MS) : 450,
  rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE) || 600,
  watsonx: {
    apiKey: env.WATSONX_API_KEY || '',
    projectId: env.WATSONX_PROJECT_ID || '',
    url: env.WATSONX_URL || 'https://us-south.ml.cloud.ibm.com',
    modelId: env.WATSONX_MODEL_ID || 'ibm/granite-3-8b-instruct',
  },
  githubToken: env.GITHUB_TOKEN || '',
};

export const watsonxConfigured = () => Boolean(config.watsonx.apiKey && config.watsonx.projectId);
