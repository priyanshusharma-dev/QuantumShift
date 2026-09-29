import crypto from 'node:crypto';
import { query, many, one, j, getSetting } from '../db/index.js';
import { emit } from '../lib/events.js';

/**
 * BobShell-style audit logger.
 * Every agent and human action is appended to a hash chain
 * (hash = SHA-256(prev_hash + canonical entry)) so tampering is detectable.
 */
let chain = Promise.resolve();

const canonical = (e) =>
  JSON.stringify([e.ts, e.agent, e.action, e.resource ?? null, e.result ?? null, e.username ?? null, e.status, e.mode ?? null, e.details ?? {}]);

export function audit({ agent, action, resource = null, result = null, user = 'system', status = 'success', details = {} }) {
  const run = async () => {
    const mode = await getSetting('mode', 'demo');
    const last = await one('SELECT hash FROM audit_logs ORDER BY id DESC LIMIT 1');
    const prevHash = last?.hash || 'GENESIS';
    const entry = {
      ts: new Date().toISOString(),
      agent,
      action,
      resource,
      result,
      username: typeof user === 'string' ? user : user?.username || 'system',
      status,
      mode,
      details,
    };
    const hash = crypto.createHash('sha256').update(prevHash + canonical(entry)).digest('hex');
    const row = await one(
      `INSERT INTO audit_logs (ts, agent, action, resource, result, username, status, mode, details, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [entry.ts, agent, action, resource, result, entry.username, status, mode, j(details), prevHash, hash],
    );
    emit('audit', row);
    return row;
  };
  // Serialise writes so the chain stays linear.
  const p = chain.then(run, run);
  chain = p.catch((err) => console.error('[audit] write failed', err.message));
  return p;
}

/** Recomputes the whole hash chain and reports the first broken link, if any. */
export async function verifyChain() {
  const rows = await many('SELECT * FROM audit_logs ORDER BY id ASC');
  let prev = 'GENESIS';
  for (const r of rows) {
    const entry = {
      ts: new Date(r.ts).toISOString(),
      agent: r.agent,
      action: r.action,
      resource: r.resource,
      result: r.result,
      username: r.username,
      status: r.status,
      mode: r.mode,
      details: r.details,
    };
    const expected = crypto.createHash('sha256').update(prev + canonical(entry)).digest('hex');
    if (r.prev_hash !== prev || r.hash !== expected) {
      return { valid: false, entries: rows.length, brokenAt: r.id };
    }
    prev = r.hash;
  }
  return { valid: true, entries: rows.length, head: prev };
}

export async function listAudit({ search, agent, status, limit = 500 } = {}) {
  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(agent ILIKE $${params.length} OR action ILIKE $${params.length} OR resource ILIKE $${params.length} OR result ILIKE $${params.length} OR username ILIKE $${params.length})`);
  }
  if (agent) {
    params.push(agent);
    where.push(`agent = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }
  params.push(Math.min(Number(limit) || 500, 5000));
  return many(
    `SELECT * FROM audit_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT $${params.length}`,
    params,
  );
}

export const clearAudit = () => query('DELETE FROM audit_logs');
