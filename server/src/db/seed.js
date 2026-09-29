import { query, one, setSetting, getSetting } from './index.js';
import { config } from '../config.js';
import { registerDemoRepos } from '../services/ingest.js';
import { runScan, generatePlan, generateRemediation, executeTests, createPullRequest, reviewPullRequest } from '../services/pipeline.js';
import { audit } from '../services/audit.js';

/** Demo users — one per role (no passwords; demo SSO). */
export const DEMO_USERS = [
  { username: 'ava.chen', name: 'Ava Chen', email: 'ava.chen@quantumshift.demo', role: 'CTO', title: 'Chief Technology Officer' },
  { username: 'marcus.reid', name: 'Marcus Reid', email: 'marcus.reid@quantumshift.demo', role: 'CISO', title: 'CISO · Security Team' },
  { username: 'priya.nair', name: 'Priya Nair', email: 'priya.nair@quantumshift.demo', role: 'DEVELOPER', title: 'Senior Software Engineer' },
  { username: 'jonas.weber', name: 'Jonas Weber', email: 'jonas.weber@quantumshift.demo', role: 'AUDITOR', title: 'Internal Auditor · Compliance' },
];

const noPace = () => Promise.resolve();

/**
 * Seeds users, settings, the five bundled sample repositories and an initial
 * history (real scans + one approved and one pending PR) so every dashboard has data.
 */
export async function seedIfEmpty({ log = console.log } = {}) {
  const has = await one('SELECT count(*)::int AS n FROM users');
  if (has.n > 0) return false;
  log('[seed] seeding demo data…');
  for (const u of DEMO_USERS) {
    await query('INSERT INTO users (username, name, email, role, title) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username) DO NOTHING', [u.username, u.name, u.email, u.role, u.title]);
  }
  if (!(await getSetting('mode'))) await setSetting('mode', config.defaultMode);
  if (!(await getSetting('mosca_z'))) await setSetting('mosca_z', 8);
  const system = { username: 'seed' };
  await audit({ agent: 'System', action: 'Initialised QuantumShift demo data', resource: 'database', result: 'Seed data (sample repositories, no real secrets)', user: system, status: 'info' });

  await registerDemoRepos();
  const repos = await query('SELECT id, slug FROM repositories ORDER BY id');
  for (const r of repos.rows) await runScan(r.id, { user: system, pace: noPace });

  const bySlug = Object.fromEntries(repos.rows.map((r) => [r.slug, r.id]));
  const firstOpen = (repoId, file) => one("SELECT id FROM crypto_assets WHERE repository_id = $1 AND file_path = $2 AND status = 'open' AND quantum_status NOT IN ('safe','pqc') ORDER BY line LIMIT 1", [repoId, file]);

  // Historical example 1: e-commerce hash fixes — approved by the CISO.
  const ec = bySlug['ecommerce-platform'];
  const j1 = await generateRemediation((await firstOpen(ec, 'src/cart/cache.ts')).id, { user: system, pace: noPace });
  const j2 = await generateRemediation((await firstOpen(ec, 'src/legacy/coupon.ts')).id, { user: system, pace: noPace });
  const t1 = await executeTests({ remediationJobIds: [j1.id, j2.id], suite: 'all', user: system, pace: noPace });
  const pr1 = await createPullRequest({ remediationJobIds: [j1.id, j2.id], testRunId: t1.runId, user: system });
  await reviewPullRequest(pr1.id, 'approve', 'Seed history: hash migration verified — approved.', { username: 'marcus.reid' });

  // Historical example 2: legacy Java key management — pending human review.
  const lj = bySlug['legacy-java-enterprise'];
  const j3 = await generateRemediation((await firstOpen(lj, 'src/main/java/com/legacy/security/KeyManager.java')).id, { user: system, pace: noPace });
  const t2 = await executeTests({ remediationJobIds: [j3.id], suite: 'all', user: system, pace: noPace });
  await createPullRequest({ remediationJobIds: [j3.id], testRunId: t2.runId, user: system });

  await generatePlan({ strategy: 'hybrid-first', user: system });
  log('[seed] done');
  return true;
}

export async function resetAll() {
  for (const t of ['test_results', 'pull_requests', 'remediation_jobs', 'migration_plans', 'cbom_assets', 'risk_assessments', 'crypto_assets', 'scan_runs', 'repositories', 'audit_logs', 'system_services', 'users', 'app_settings']) {
    await query(`DELETE FROM ${t}`);
  }
}
