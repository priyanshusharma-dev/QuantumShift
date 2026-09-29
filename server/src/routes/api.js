import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { query, one, many, setSetting, dbEngine } from '../db/index.js';
import { asyncHandler as ah, httpError } from '../lib/errors.js';
import { bus, createJob, updateStep, finishJob, failJob, getJob, listJobs, invalidate } from '../lib/events.js';
import { authenticate, can, signToken, PERMISSIONS } from '../middleware/auth.js';
import { validate, S } from '../middleware/validate.js';
import { RULES } from '../services/catalog.js';
import { scanSource } from '../services/scanner.js';
import { mosca, assessAsset } from '../services/risk.js';
import { explain, explainPatch } from '../services/granite.js';
import { listAgents } from '../services/agents.js';
import { audit, listAudit, verifyChain } from '../services/audit.js';
import { addRepository, addUploadedRepository, repoRoot, DEMO_DOCKER_IMAGES, DEMO_CLOUD_SOURCES } from '../services/ingest.js';
import {
  getRepo, getMode, getZ, runScan, SCAN_STAGES, inventory, assessRepository, reassessAll, regenerateCbom, cbomDocument,
  generatePlan, generateRemediation, executeTests, createPullRequest, reviewPullRequest, summarise,
} from '../services/pipeline.js';
import { dashboardSummary } from '../services/dashboard.js';
import { runDiagnostics, integrationsStatus } from '../services/health.js';
import { buildReport } from '../services/reports.js';
import { startCompleteDemo, DEMO_STEPS } from '../services/demo.js';
import { resetAll, seedIfEmpty } from '../db/seed.js';

export const api = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadMaxMb * 1024 * 1024, files: 1 } });

// ---------------------------------------------------------------------------
// Public endpoints
// ---------------------------------------------------------------------------
api.get('/system/health', ah(async (_req, res) => {
  const t = Date.now();
  let db = 'ONLINE';
  try { await one('SELECT 1'); } catch { db = 'OFFLINE'; }
  const services = await many('SELECT key, name, status, latency_ms, message, last_check FROM system_services ORDER BY id').catch(() => []);
  res.json({ status: db === 'ONLINE' ? 'ok' : 'degraded', api: 'ONLINE', database: db, latencyMs: Date.now() - t, uptimeSec: Math.round(process.uptime()), services, mode: await getMode().catch(() => 'unknown') });
}));

api.get('/auth/users', ah(async (_req, res) => {
  res.json(await many('SELECT id, username, name, role, title FROM users ORDER BY id'));
}));

api.post('/auth/login', validate(S.login), ah(async (req, res) => {
  const user = await one('SELECT id, username, name, email, role, title FROM users WHERE username = $1', [req.body.username]);
  if (!user) throw httpError(401, 'Unknown demo user');
  await audit({ agent: 'Auth', action: 'Signed in (demo SSO)', resource: user.role, result: user.title, user, status: 'info' });
  res.json({ token: signToken(user), user, permissions: Object.entries(PERMISSIONS).filter(([, r]) => r.includes(user.role)).map(([p]) => p) });
}));

// Everything below requires a valid session.
api.use(authenticate);

api.get('/auth/me', ah(async (req, res) => {
  const user = await one('SELECT id, username, name, email, role, title FROM users WHERE id = $1', [req.user.id]);
  if (!user) throw httpError(401, 'User no longer exists');
  res.json({ user, permissions: Object.entries(PERMISSIONS).filter(([, r]) => r.includes(user.role)).map(([p]) => p) });
}));

// Server-Sent Events: jobs, agents, audit entries and data invalidations.
api.get('/stream', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: hello\ndata: ${JSON.stringify({ user: req.user.username })}\n\n`);
  const on = (e) => res.write(`event: ${e.type}\ndata: ${JSON.stringify(e.payload)}\n\n`);
  bus.on('event', on);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => {
    bus.off('event', on);
    clearInterval(ping);
  });
});

api.get('/jobs', (_req, res) => res.json(listJobs().slice(0, 20)));
api.get('/jobs/:id', (req, res, next) => {
  const job = getJob(req.params.id);
  return job ? res.json(job) : next(httpError(404, 'Job not found (jobs are kept in memory for the current server session)'));
});

// ---------------------------------------------------------------------------
// System & settings
// ---------------------------------------------------------------------------
api.get('/system/settings', ah(async (_req, res) => {
  const mode = await getMode();
  res.json({ mode, moscaZ: await getZ(), integrations: integrationsStatus(mode), pacingMs: config.pacingMs, dbEngine: dbEngine() });
}));

api.put('/system/settings', can('settings:write'), validate(S.settings), ah(async (req, res) => {
  const { mode, moscaZ } = req.body;
  if (mode && mode !== (await getMode())) {
    await setSetting('mode', mode);
    await audit({ agent: 'System', action: `Switched to ${mode === 'demo' ? 'DEMO MODE' : 'REAL INTEGRATION'}`, resource: 'settings', result: mode === 'real' ? 'Real integrations: public GitHub/GitLab downloads, watsonx.ai if configured' : 'All external integrations simulated', user: req.user, status: 'info' });
  }
  let counts = null;
  if (moscaZ !== undefined && moscaZ !== (await getZ())) {
    await setSetting('mosca_z', moscaZ);
    counts = await reassessAll(moscaZ);
    const repos = await many('SELECT id FROM repositories');
    for (const r of repos) await regenerateCbom(r.id);
    await audit({ agent: 'Risk Assessment Agent', action: 'Re-assessed portfolio with new Z', resource: `Z = ${moscaZ} years`, result: `RED ${counts.RED} · YELLOW ${counts.YELLOW} · GREEN ${counts.GREEN}`, user: req.user, status: 'info' });
  }
  const m = await getMode();
  res.json({ mode: m, moscaZ: await getZ(), counts, integrations: integrationsStatus(m) });
}));

api.post('/system/diagnostics', ah(async (req, res) => {
  const r = await runDiagnostics();
  await audit({ agent: 'System', action: 'Ran system diagnostics', resource: 'platform', result: `Overall ${r.overall} · ${r.services.filter((s) => s.status === 'ONLINE').length}/${r.services.length} online`, user: req.user, status: r.overall === 'ONLINE' ? 'success' : 'warning' });
  res.json(r);
}));

api.post('/system/reset', can('settings:write'), ah(async (req, res) => {
  const who = req.user.username;
  await resetAll();
  await seedIfEmpty({ log: () => {} });
  await audit({ agent: 'System', action: 'Reset demo data', resource: 'database', result: `Requested by ${who}`, user: { username: who }, status: 'warning' });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Dashboard, agents
// ---------------------------------------------------------------------------
api.get('/dashboard/summary', ah(async (_req, res) => res.json(await dashboardSummary())));
api.get('/agents', (_req, res) => res.json(listAgents()));

// ---------------------------------------------------------------------------
// Repositories & discovery
// ---------------------------------------------------------------------------
api.get('/sources', ah(async (_req, res) => res.json({ mode: await getMode(), dockerImages: DEMO_DOCKER_IMAGES, cloudSources: DEMO_CLOUD_SOURCES })));

api.get('/repositories', ah(async (_req, res) => {
  res.json(await many(`
    SELECT repo.*,
      (SELECT count(*)::int FROM crypto_assets a WHERE a.repository_id = repo.id) AS asset_count,
      (SELECT count(*)::int FROM crypto_assets a JOIN risk_assessments r ON r.crypto_asset_id = a.id WHERE a.repository_id = repo.id AND r.risk_level = 'RED') AS red,
      (SELECT count(*)::int FROM crypto_assets a JOIN risk_assessments r ON r.crypto_asset_id = a.id WHERE a.repository_id = repo.id AND r.risk_level = 'YELLOW') AS yellow,
      (SELECT count(*)::int FROM crypto_assets a JOIN risk_assessments r ON r.crypto_asset_id = a.id WHERE a.repository_id = repo.id AND r.risk_level = 'GREEN') AS green
    FROM repositories repo ORDER BY repo.id`));
}));

api.get('/repositories/:id', ah(async (req, res) => {
  const repo = await getRepo(S.id.parse(req.params.id));
  const files = await many(
    `SELECT a.file_path, a.language, count(*)::int AS assets,
        count(*) FILTER (WHERE r.risk_level = 'RED')::int AS red, count(*) FILTER (WHERE r.risk_level = 'YELLOW')::int AS yellow, count(*) FILTER (WHERE r.risk_level = 'GREEN')::int AS green
     FROM crypto_assets a LEFT JOIN risk_assessments r ON r.crypto_asset_id = a.id WHERE a.repository_id = $1 GROUP BY a.file_path, a.language ORDER BY red DESC, a.file_path`,
    [repo.id],
  );
  const scans = await many('SELECT * FROM scan_runs WHERE repository_id = $1 ORDER BY id DESC LIMIT 10', [repo.id]);
  res.json({ ...repo, files, scans });
}));

api.get('/repositories/:id/file', ah(async (req, res) => {
  const repo = await getRepo(S.id.parse(req.params.id));
  const rel = String(req.query.path || '');
  if (!rel || rel.startsWith('aws://')) throw httpError(400, 'A repository-relative file path is required');
  const root = path.resolve(repoRoot(repo));
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) throw httpError(400, 'Path escapes the repository root');
  if (!fs.existsSync(abs)) throw httpError(404, 'File not found');
  if (fs.statSync(abs).size > 512 * 1024) throw httpError(413, 'File too large to display');
  res.json({ path: rel, content: fs.readFileSync(abs, 'utf8') });
}));

api.post('/repositories', can('repo:manage'), validate(S.addRepo), ah(async (req, res) => {
  const repo = await addRepository(req.body, await getMode());
  await audit({ agent: 'Discovery Agent', action: 'Registered repository', resource: repo.name, result: `${repo.source_type}${repo.simulated_ingestion ? ' (simulated ingestion — demo mode)' : ''}`, user: req.user });
  res.status(201).json(repo);
}));

api.post('/repositories/upload', can('repo:manage'), upload.single('archive'), ah(async (req, res) => {
  const repo = await addUploadedRepository(req.file, req.body || {});
  await audit({ agent: 'Discovery Agent', action: 'Uploaded source archive', resource: repo.name, result: repo.source_ref, user: req.user });
  res.status(201).json(repo);
}));

api.put('/repositories/:id/risk-profile', can('risk:configure'), validate(S.riskProfile), ah(async (req, res) => {
  const id = S.id.parse(req.params.id);
  await getRepo(id);
  await query('UPDATE repositories SET data_lifetime_years = $2, migration_time_years = $3, criticality = $4 WHERE id = $1', [id, req.body.dataLifetimeYears, req.body.migrationTimeYears, req.body.criticality]);
  const counts = await assessRepository(id);
  await regenerateCbom(id);
  const repo = await getRepo(id);
  await audit({ agent: 'Risk Assessment Agent', action: 'Updated risk profile', resource: repo.name, result: `X=${repo.data_lifetime_years}, Y=${repo.migration_time_years}, ${repo.criticality} → RED ${counts.RED} · YELLOW ${counts.YELLOW} · GREEN ${counts.GREEN}`, user: req.user });
  invalidate('risks', 'dashboard', 'repositories', 'assets');
  res.json({ repository: repo, counts });
}));

api.delete('/repositories/:id', can('settings:write'), ah(async (req, res) => {
  const repo = await getRepo(S.id.parse(req.params.id));
  if (repo.is_demo) throw httpError(400, 'Bundled demo repositories cannot be deleted (use Reset demo data instead)');
  await query('DELETE FROM repositories WHERE id = $1', [repo.id]);
  if (path.isAbsolute(repo.storage_path) && repo.storage_path.startsWith(config.uploadDir)) fs.rmSync(repo.storage_path, { recursive: true, force: true });
  await audit({ agent: 'Discovery Agent', action: 'Removed repository', resource: repo.name, user: req.user, status: 'warning' });
  invalidate('repositories', 'dashboard', 'assets', 'risks', 'cbom');
  res.json({ ok: true });
}));

api.post('/scan', can('scan:run'), validate(S.scan), ah(async (req, res) => {
  const repo = await getRepo(req.body.repositoryId);
  if (repo.status === 'scanning') throw httpError(409, `${repo.name} is already being scanned`);
  const job = createJob('scan', `Scan ${repo.name}`, SCAN_STAGES, { repositoryId: repo.id, repository: repo.name, simulated: repo.simulated_ingestion });
  runScan(repo.id, {
    user: req.user,
    onStage: (key, pct, msg) => {
      const idx = SCAN_STAGES.findIndex((s) => s.key === key);
      for (const s of SCAN_STAGES.slice(0, idx)) if (job.steps.find((x) => x.key === s.key).status !== 'done') updateStep(job, s.key, { status: 'done' });
      updateStep(job, key, { status: pct >= 100 ? 'done' : 'running', progress: pct, message: msg });
    },
  }).then((r) => finishJob(job, r)).catch((e) => failJob(job, e));
  res.status(202).json({ jobId: job.id, job });
}));

api.post('/scan/ast', validate(S.astScan), ah(async (req, res) => {
  const t = Date.now();
  const r = scanSource(req.body.filename, req.body.code);
  if (!r.language) throw httpError(400, 'Unsupported file type — use .js, .ts, .py, .go, .java, Dockerfile, nginx .conf, .properties, package.json, requirements.txt, pom.xml, go.mod or .pem');
  await audit({ agent: 'AST Analysis Agent', action: 'Ran AST scan on snippet', resource: req.body.filename, result: `${r.assets.length} finding(s)`, user: req.user, status: 'info' });
  res.json({ language: r.language, nodes: r.nodes, parseError: r.parseError, durationMs: Date.now() - t, findings: r.assets });
}));

api.get('/rules', (_req, res) => res.json(RULES));

// ---------------------------------------------------------------------------
// Assets, CBOM, risk
// ---------------------------------------------------------------------------
api.get('/assets', validate(S.assetsQuery, 'query'), ah(async (req, res) => {
  const q = req.validQuery;
  let rows = await inventory();
  if (q.repositoryId) rows = rows.filter((a) => a.repository_id === q.repositoryId);
  if (q.risk) rows = rows.filter((a) => a.risk_level === q.risk);
  if (q.family) rows = rows.filter((a) => a.family === q.family);
  if (q.language) rows = rows.filter((a) => a.language === q.language);
  if (q.type) rows = rows.filter((a) => a.asset_type === q.type);
  if (q.file) rows = rows.filter((a) => a.file_path === q.file);
  if (q.status) rows = rows.filter((a) => a.status === q.status);
  if (q.search) {
    const s = q.search.toLowerCase();
    rows = rows.filter((a) => [a.algorithm, a.file_path, a.function_name, a.api_call, a.rule_id, a.repository_name].some((v) => String(v || '').toLowerCase().includes(s)));
  }
  res.json(rows);
}));

api.get('/assets/:id', ah(async (req, res) => {
  const id = S.id.parse(req.params.id);
  const a = await one('SELECT * FROM crypto_assets WHERE id = $1', [id]);
  if (!a) throw httpError(404, 'Asset not found');
  const risk = await one('SELECT * FROM risk_assessments WHERE crypto_asset_id = $1', [id]);
  const repo = await getRepo(a.repository_id);
  const cbom = await one('SELECT component FROM cbom_assets WHERE crypto_asset_id = $1', [id]);
  let context = null;
  if (!a.file_path.startsWith('aws://') && a.line) {
    const abs = path.resolve(repoRoot(repo), a.file_path);
    if (abs.startsWith(path.resolve(repoRoot(repo))) && fs.existsSync(abs)) {
      const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
      const start = Math.max(1, a.line - 6);
      context = { start, lines: lines.slice(start - 1, Math.min(lines.length, (a.end_line || a.line) + 6)) };
    }
  }
  const jobs = await many("SELECT id, status, created_at FROM remediation_jobs WHERE asset_ids @> $1::jsonb ORDER BY id DESC", [JSON.stringify([id])]);
  res.json({ asset: a, risk, repository: { id: repo.id, name: repo.name, criticality: repo.criticality, data_classification: repo.data_classification }, cbom: cbom?.component || null, context, remediationJobs: jobs });
}));

api.get('/cbom', ah(async (req, res) => {
  const rid = req.query.repositoryId ? S.id.parse(req.query.repositoryId) : null;
  const rows = await many(
    `SELECT c.id, c.repository_id, c.crypto_asset_id, c.bom_ref, c.name, c.asset_type, c.primitive, c.component, repo.name AS repository_name,
            a.file_path, a.line, a.language, a.function_name, a.api_call, a.family, a.quantum_status, a.status, r.risk_level, r.risk_score
     FROM cbom_assets c JOIN repositories repo ON repo.id = c.repository_id
     LEFT JOIN crypto_assets a ON a.id = c.crypto_asset_id LEFT JOIN risk_assessments r ON r.crypto_asset_id = a.id
     ${rid ? 'WHERE c.repository_id = $1' : ''} ORDER BY COALESCE(r.risk_score,0) DESC, c.id`,
    rid ? [rid] : [],
  );
  res.json(rows);
}));

api.get('/cbom/document', ah(async (req, res) => {
  const rid = req.query.repositoryId ? S.id.parse(req.query.repositoryId) : null;
  res.json(await cbomDocument(rid));
}));

api.post('/risk/calculate', validate(S.mosca), ah(async (req, res) => {
  const { x, y, z } = req.body;
  const m = mosca({ x, y, z });
  const examples = [
    { algorithm: 'RSA-2048', status: 'vulnerable' },
    { algorithm: 'ECDSA P-256', status: 'vulnerable' },
    { algorithm: 'SHA-1', status: 'broken' },
    { algorithm: 'AES-128', status: 'weakened' },
    { algorithm: 'ML-KEM-768', status: 'pqc' },
  ].map((e) => ({ ...e, ...assessAsset({ quantum_status: e.status, asset_type: 'algorithm' }, { data_lifetime_years: x, migration_time_years: y, criticality: req.body.criticality || 'high' }, { z }) }));
  const repos = await many('SELECT id, name, data_lifetime_years, migration_time_years FROM repositories ORDER BY id');
  res.json({ ...m, examples, repositories: repos.map((r) => ({ ...r, ...mosca({ x: r.data_lifetime_years, y: r.migration_time_years, z }) })) });
}));

api.get('/risks', ah(async (_req, res) => {
  const rows = await many(`SELECT a.id, a.repository_id, a.file_path, a.line, a.function_name, a.algorithm, a.family, a.asset_type, a.language, a.quantum_status, a.target_algorithm, a.status, a.data_context, a.rule_id,
      r.risk_level, r.risk_score, r.x_years, r.y_years, r.z_years, r.mosca_exposed, r.mosca_margin, r.business_criticality, r.urgency, r.rationale, r.explanation, repo.name AS repository_name
    FROM crypto_assets a JOIN risk_assessments r ON r.crypto_asset_id = a.id JOIN repositories repo ON repo.id = a.repository_id ORDER BY r.risk_score DESC, a.id`);
  res.json(rows);
}));

api.post('/risks/:assetId/explain', ah(async (req, res) => {
  const id = S.id.parse(req.params.assetId);
  const a = await one('SELECT * FROM crypto_assets WHERE id = $1', [id]);
  const r = await one('SELECT * FROM risk_assessments WHERE crypto_asset_id = $1', [id]);
  if (!a || !r) throw httpError(404, 'Assessed asset not found');
  const repo = await getRepo(a.repository_id);
  const mode = await getMode();
  const exp = await explain(a, { level: r.risk_level, x: r.x_years, y: r.y_years, z: r.z_years, exposed: r.mosca_exposed, margin: r.mosca_margin, criticality: r.business_criticality, rationale: r.rationale }, repo, mode);
  await query('UPDATE risk_assessments SET explanation = $2 WHERE crypto_asset_id = $1', [id, JSON.stringify(exp)]);
  await audit({ agent: 'Risk Assessment Agent', action: 'Generated AI explanation', resource: `${a.file_path}:${a.line ?? '-'}`, result: exp.label, user: req.user, status: 'info' });
  res.json(exp);
}));

// ---------------------------------------------------------------------------
// Migration planning
// ---------------------------------------------------------------------------
api.post('/migration/plan', can('plan:generate'), validate(S.plan), ah(async (req, res) => {
  res.status(201).json(await generatePlan({ ...req.body, user: req.user }));
}));
api.get('/migration/plans', ah(async (_req, res) => res.json(await many('SELECT id, name, strategy, status, summary, created_by, created_at, mode FROM migration_plans ORDER BY id DESC LIMIT 20'))));
api.get('/migration/plans/:id', ah(async (req, res) => {
  const p = await one('SELECT * FROM migration_plans WHERE id = $1', [S.id.parse(req.params.id)]);
  if (!p) throw httpError(404, 'Plan not found');
  res.json(p);
}));

// ---------------------------------------------------------------------------
// Remediation (Code Mode)
// ---------------------------------------------------------------------------
api.post('/remediation/generate', can('remediation:generate'), validate(S.remediate), ah(async (req, res) => {
  res.status(201).json(await generateRemediation(req.body.assetId, { user: req.user }));
}));
api.get('/remediation/jobs', ah(async (_req, res) => {
  res.json(await many(`SELECT j.id, j.repository_id, j.file_path, j.language, j.asset_ids, j.changes, j.confidence, j.status, j.created_by, j.created_at, j.mode, repo.name AS repository_name,
    jsonb_array_length(j.extra_files) AS extra_file_count FROM remediation_jobs j JOIN repositories repo ON repo.id = j.repository_id ORDER BY j.id DESC LIMIT 100`));
}));
api.get('/remediation/jobs/:id', ah(async (req, res) => {
  const job = await one('SELECT j.*, repo.name AS repository_name FROM remediation_jobs j JOIN repositories repo ON repo.id = j.repository_id WHERE j.id = $1', [S.id.parse(req.params.id)]);
  if (!job) throw httpError(404, 'Remediation job not found');
  res.json(job);
}));
api.post('/remediation/jobs/:id/explain', ah(async (req, res) => {
  const job = await one('SELECT * FROM remediation_jobs WHERE id = $1', [S.id.parse(req.params.id)]);
  if (!job) throw httpError(404, 'Remediation job not found');
  const exp = { ...explainPatch({ ...job, adapter: job.explanation?.adapter }), adapter: job.explanation?.adapter };
  await query('UPDATE remediation_jobs SET explanation = $2 WHERE id = $1', [job.id, JSON.stringify(exp)]);
  await audit({ agent: 'Code Refactoring Agent', action: 'Explained patch changes', resource: job.file_path, result: `${job.changes.length} change(s)`, user: req.user, status: 'info' });
  res.json(exp);
}));
api.post('/remediation/jobs/:id/discard', can('remediation:generate'), ah(async (req, res) => {
  const job = await one('SELECT * FROM remediation_jobs WHERE id = $1', [S.id.parse(req.params.id)]);
  if (!job) throw httpError(404, 'Remediation job not found');
  if (['in_review', 'merged'].includes(job.status)) throw httpError(409, 'Patches that are part of a pull request cannot be discarded');
  await query("UPDATE remediation_jobs SET status = 'discarded' WHERE id = $1", [job.id]);
  await query("UPDATE crypto_assets SET status = 'open' WHERE id = ANY($1::int[]) AND status = 'patch_generated'", [job.asset_ids]);
  await audit({ agent: 'Code Refactoring Agent', action: 'Discarded patch', resource: job.file_path, user: req.user, status: 'warning' });
  invalidate('remediation', 'assets');
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
api.post('/tests/run', can('tests:run'), validate(S.tests), ah(async (req, res) => {
  const { remediationJobIds, suite } = req.body;
  const job = createJob('tests', `Run ${suite} tests`, [{ key: 'run', label: `${suite} tests` }], { suite, remediationJobIds });
  updateStep(job, 'run', { status: 'running', progress: 0 });
  const results = [];
  executeTests({
    remediationJobIds, suite, user: req.user,
    onResult: (r) => {
      results.push(r);
      job.meta.results = results;
      updateStep(job, 'run', { progress: Math.round(((r.index + 1) / r.total) * 100), message: r.name });
    },
  }).then((r) => { updateStep(job, 'run', { status: 'done' }); finishJob(job, { runId: r.runId, summary: r.summary }); }).catch((e) => failJob(job, e));
  res.status(202).json({ jobId: job.id, job });
}));

api.get('/tests/runs', ah(async (_req, res) => {
  res.json(await many(`SELECT run_id, min(created_at) AS started_at, count(*)::int AS total,
      count(*) FILTER (WHERE status = 'passed')::int AS passed, count(*) FILTER (WHERE status = 'failed')::int AS failed, count(*) FILTER (WHERE status = 'warning')::int AS warning,
      count(*) FILTER (WHERE execution = 'real')::int AS real
    FROM test_results GROUP BY run_id ORDER BY min(id) DESC LIMIT 30`));
}));

api.get('/tests', ah(async (req, res) => {
  const runId = req.query.runId ? String(req.query.runId) : (await one('SELECT run_id FROM test_results ORDER BY id DESC LIMIT 1'))?.run_id;
  if (!runId) return res.json({ runId: null, summary: summarise([]), results: [] });
  const results = await many('SELECT t.*, j.file_path FROM test_results t LEFT JOIN remediation_jobs j ON j.id = t.remediation_job_id WHERE t.run_id = $1 ORDER BY t.id', [runId]);
  res.json({ runId, summary: summarise(results), results });
}));

// ---------------------------------------------------------------------------
// Pull requests (human-in-the-loop)
// ---------------------------------------------------------------------------
api.get('/pull-requests', ah(async (_req, res) => {
  res.json(await many('SELECT p.*, repo.name AS repository_name FROM pull_requests p JOIN repositories repo ON repo.id = p.repository_id ORDER BY p.id DESC'));
}));
api.get('/pull-requests/:id', ah(async (req, res) => {
  const pr = await one('SELECT p.*, repo.name AS repository_name FROM pull_requests p JOIN repositories repo ON repo.id = p.repository_id WHERE p.id = $1', [S.id.parse(req.params.id)]);
  if (!pr) throw httpError(404, 'Pull request not found');
  const jobs = pr.remediation_job_ids.length ? await many('SELECT id, file_path, language, diff, before_code, after_code, extra_files, changes, explanation, confidence FROM remediation_jobs WHERE id = ANY($1::int[]) ORDER BY id', [pr.remediation_job_ids]) : [];
  const tests = pr.test_run_id ? await many('SELECT suite, category, name, status, execution, duration_ms, details FROM test_results WHERE run_id = $1 ORDER BY id', [pr.test_run_id]) : [];
  res.json({ ...pr, jobs, tests });
}));
api.post('/pull-requests', can('pr:create'), validate(S.createPr), ah(async (req, res) => {
  res.status(201).json(await createPullRequest({ ...req.body, user: req.user }));
}));
for (const [route, action] of [['approve', 'approve'], ['reject', 'reject'], ['request-changes', 'request_changes']]) {
  api.post(`/pull-requests/:id/${route}`, can('pr:review'), validate(S.review), ah(async (req, res) => {
    res.json(await reviewPullRequest(S.id.parse(req.params.id), action, req.body.comment, req.user));
  }));
}

// ---------------------------------------------------------------------------
// BobShell audit
// ---------------------------------------------------------------------------
api.get('/audit-logs', validate(S.auditQuery, 'query'), ah(async (req, res) => res.json(await listAudit(req.validQuery))));
api.get('/audit-logs/verify', ah(async (req, res) => {
  const v = await verifyChain();
  await audit({ agent: 'Audit Agent', action: 'Verified hash chain', resource: 'BobShell', result: v.valid ? `Intact · ${v.entries} entries` : `Broken at #${v.brokenAt}`, user: req.user, status: v.valid ? 'success' : 'failure' });
  res.json(v);
}));

// ---------------------------------------------------------------------------
// Complete demo + reports
// ---------------------------------------------------------------------------
api.get('/demo/steps', (_req, res) => res.json(DEMO_STEPS));
api.post('/demo/run', can('demo:run'), ah(async (req, res) => {
  const job = startCompleteDemo(req.user);
  res.status(202).json({ jobId: job.id, job });
}));

api.get('/reports/:type', validate(S.reportQuery, 'query'), ah(async (req, res) => {
  const r = await buildReport(req.params.type, req.validQuery);
  await audit({ agent: 'Audit Agent', action: 'Exported report', resource: r.filename, result: req.params.type, user: req.user, status: 'info' });
  res.setHeader('Content-Type', `${r.contentType}; charset=utf-8`);
  res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
  res.send(r.body);
}));

api.use((req, _res, next) => next(httpError(404, `No API route for ${req.method} ${req.originalUrl}`)));

