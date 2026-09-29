import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');

let impl = null;

/**
 * Connects to PostgreSQL. Uses an external server when DATABASE_URL is set,
 * otherwise an embedded PostgreSQL (PGlite) persisted to PGLITE_DATA_DIR.
 */
export async function initDb() {
  if (impl) return impl;
  const schema = fs.readFileSync(schemaPath, 'utf8');

  if (config.databaseUrl) {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
    pool.on('error', (err) => console.error('[db] idle client error', err.message));
    await pool.query('SELECT 1');
    await pool.query(schema);
    impl = {
      engine: 'PostgreSQL (external server)',
      query: (text, params = []) => pool.query(text, params),
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    fs.mkdirSync(config.pgliteDir, { recursive: true });
    const db = new PGlite(config.pgliteDir);
    await db.waitReady;
    await db.exec(schema);
    impl = {
      engine: 'PostgreSQL (embedded PGlite)',
      query: (text, params = []) => db.query(text, params),
      close: () => db.close(),
    };
  }
  return impl;
}

export const query = (text, params) => {
  if (!impl) throw new Error('Database not initialised');
  return impl.query(text, params);
};

export const one = async (text, params) => (await query(text, params)).rows[0] || null;
export const many = async (text, params) => (await query(text, params)).rows;
export const dbEngine = () => impl?.engine || 'not connected';
export const closeDb = () => impl?.close();

/** JSON helper for JSONB parameters (works for both pg and PGlite). */
export const j = (v) => JSON.stringify(v ?? null);

export async function getSetting(key, fallback) {
  const row = await one('SELECT value FROM app_settings WHERE key = $1', [key]);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, j(value)],
  );
}
