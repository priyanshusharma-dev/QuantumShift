import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { query, one, many, j, getSetting } from '../db/index.js';
import { invalidate, sleep } from '../lib/events.js';
import { config } from '../config.js';
import { httpError } from '../lib/errors.js';
import { scanDirectory, listFiles } from './scanner.js';
import { assessAsset, LEVEL_URGENCY } from './risk.js';
import { templateExplanation, explainPatch } from './granite.js';
import { componentFor, buildCbom } from './cbom.js';
import { buildPlan } from './planner.js';
import { remediateFile } from './remediation.js';
import { runTests } from './testing.js';
import { checkCompliance } from './compliance.js';
import { agentStart, agentProgress, agentDone, agentError } from './agents.js';
import { audit } from './audit.js';
import { repoRoot } from './ingest.js';

export const getMode = () => getSetting('mode', config.defaultMode);
export const getZ = async () => Number(await getSetting('mosca_z', 8));
export const pacer = (ms = config.pacingMs) => () => (ms > 0 ? sleep(ms) : Promise.resolve());
const uname = (u) => (typeof u === 'string' ? u : u?.username || 'system');

export async function getRepo(id) {
  const repo = await one('SELECT * FROM repositories WHERE id = $1', [id]);
  if (!repo) throw httpError(404, `Repository ${id} not found`);
  return repo;
}

// ---------------------------------------------------------------------------
// Risk assessment
// ---------------------------------------------------------------------------
export async function assessRepository(repoId, { z } = {}) {
  const Z = z ?? (await getZ());
  const repo = await getRepo(repoId);
  const assets = await many('SELECT * FROM crypto_assets WHERE repository_id = $1', [repoId]);
  const counts = { RED: 0, YELLOW: 0, GREEN: 0 };
  for (const a of assets) {
    let r = assessAsset(a, repo, { z: Z });
    if (a.status === 'remediated') {
      r = { ...r, level: 'GREEN', score: 8, urgency: 'Migrated', rationale: `Remediated through an approved QuantumShift pull request (was ${a.algorithm}).` };
    }
    counts[r.level]++;
    const exp = templateExplanation(a, r, repo);
    await query(
      `INSERT INTO risk_assessments (crypto_asset_id, x_years, y_years, z_years, mosca_exposed, mosca_margin, risk_level, risk_score, business_criticality, urgency, rationale, explanation, assessed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
       ON CONFLICT (crypto_asset_id) DO UPDATE SET x_years = EXCLUDED.x_years, y_years = EXCLUDED.y_years, z_years = EXCLUDED.z_years,
         mosca_exposed = EXCLUDED.mosca_exposed, mosca_margin = EXCLUDED.mosca_margin, risk_level = EXCLUDED.risk_level, risk_score = EXCLUDED.risk_score,
         business_criticality = EXCLUDED.business_criticality, urgency = EXCLUDED.urgency, rationale = EXCLUDED.rationale,
         explanation = CASE WHEN risk_assessments.explanation->>'source' = 'watsonx' AND risk_assessments.risk_level = EXCLUDED.risk_level THEN risk_assessments.explanation ELSE EXCLUDED.explanation END,
         assessed_at = now()`,
      [a.id, r.x, r.y, r.z, r.exposed, r.margin, r.level, r.score, r.criticality, r.urgency, r.rationale, j(exp)],
    );
  }
  return counts;
}

export async function reassessAll(z) {
  const repos = await many('SELECT id FROM repositories');
  const total = { RED: 0, YELLOW: 0, GREEN: 0 };
  for (const r of repos) {
    const c = await assessRepository(r.id, { z });
    for (const k of Object.keys(total)) total[k] += c[k];
  }
  invalidate('risks', 'dashboard', 'assets');
  return total;
}

// ---------------------------------------------------------------------------
// CBOM persistence
// ---------------------------------------------------------------------------
export async function regenerateCbom(repoId) {
  const assets = await many('SELECT * FROM crypto_assets WHERE repository_id = $1 ORDER BY file_path, line', [repoId]);
  const risks = await many('SELECT r.* FROM risk_assessments r JOIN crypto_assets a ON a.id = r.crypto_asset_id WHERE a.repository_id = $1', [repoId]);
  const riskBy = new Map(risks.map((r) => [r.crypto_asset_id, r]));
  await query('DELETE FROM cbom_assets WHERE repository_id = $1', [repoId]);
  for (const a of assets) {
    const c = componentFor(a, riskBy.get(a.id));
    await query(
      'INSERT INTO cbom_assets (repository_id, crypto_asset_id, bom_ref, name, asset_type, primitive, component) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [repoId, a.id, c['bom-ref'], c.name, c.cryptoProperties?.assetType || c.type, c.cryptoProperties?.algorithmProperties?.primitive || a.primitive, j(c)],
    );
  }
  return assets.length;
}

export async function cbomDocument(repositoryId) {
  const repos = repositoryId ? [await getRepo(repositoryId)] : await many('SELECT * FROM repositories ORDER BY id');
  const ids = repos.map((r) => r.id);
  const assets = (await many('SELECT * FROM crypto_assets ORDER BY repository_id, file_path, line')).filter((a) => ids.includes(a.repository_id));
  const risks = await many('SELECT * FROM risk_assessments');
  return buildCbom({ repos, assets, risks, mode: await getMode() });
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------
export const SCAN_STAGES = [
  { key: 'ingestion', label: 'Repository ingestion' },
  { key: 'ast', label: 'AST parsing' },
  { key: 'semantic', label: 'Semantic analysis' },
  { key: 'detection', label: 'Cryptographic API detection' },
  { key: 'dependencies', label: 'Dependency analysis' },
  { key: 'cbom', label: 'CBOM generation' },
];

export async function runScan(repoId, { user, onStage = () => {}, pace = pacer() } = {}) {
  const repo = await getRepo(repoId);
  const mode = await getMode();
  const root = repoRoot(repo);
  if (!fs.existsSync(root)) throw httpError(410, `Source for ${repo.name} is no longer available at ${repo.storage_path}`);
  const started = new Date();
  const run = await one('INSERT INTO scan_runs (repository_id, started_at, triggered_by, mode) VALUES ($1, $2, $3, $4) RETURNING id', [repoId, started.toISOString(), uname(user), mode]);
  await query("UPDATE repositories SET status = 'scanning' WHERE id = $1", [repoId]);
  invalidate('repositories');

  try {
    agentStart('discovery', `Ingesting ${repo.name}`);
    const stage = (key, pct, msg) => {
      onStage(key, pct, msg);
      if (key === 'ingestion') agentProgress('discovery', pct, msg);
      else agentProgress('ast', pct, msg);
    };
    let astStarted = false;
    const result = await scanDirectory(root, {
      onStage: (key, pct, msg) => {
        if (key !== 'ingestion' && !astStarted) {
          astStarted = true;
          agentDone('discovery', { action: 'Scanned repository', resource: repo.name, result: `Ingested ${repo.source_type === 'demo' ? 'bundled sample' : repo.source_type} source${repo.simulated_ingestion ? ' (simulated ingestion)' : ''}`, user });
          agentStart('ast', `Parsing ${repo.name}`);
        }
        stage(key, pct, msg);
      },
      pace,
    });

    // Persist assets (upsert by fingerprint so remediation status survives re-scans)
    const scanTime = new Date().toISOString();
    for (const a of result.assets) {
      const fp = crypto.createHash('sha256').update(`${repoId}|${a.file}|${a.line}|${a.ruleId}|${a.algorithm}`).digest('hex');
      await query(
        `INSERT INTO crypto_assets (repository_id, fingerprint, file_path, language, function_name, line, end_line, snippet, api_call, algorithm, family, key_size, asset_type, primitive, rule_id, detection_method, confidence, quantum_status, data_context, dependencies, target_algorithm, metadata, first_seen, last_seen)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$23)
         ON CONFLICT (fingerprint) DO UPDATE SET function_name = EXCLUDED.function_name, end_line = EXCLUDED.end_line, snippet = EXCLUDED.snippet, api_call = EXCLUDED.api_call,
           family = EXCLUDED.family, key_size = EXCLUDED.key_size, primitive = EXCLUDED.primitive, detection_method = EXCLUDED.detection_method, confidence = EXCLUDED.confidence,
           quantum_status = EXCLUDED.quantum_status, data_context = EXCLUDED.data_context, dependencies = EXCLUDED.dependencies, target_algorithm = EXCLUDED.target_algorithm,
           metadata = EXCLUDED.metadata, last_seen = EXCLUDED.last_seen`,
        [repoId, fp, a.file, a.language, a.functionName, a.line, a.endLine, a.snippet, a.apiCall, a.algorithm, a.family, a.keySize, a.assetType, a.primitive, a.ruleId, a.detectionMethod, a.confidence, a.quantumStatus, a.dataContext, j(a.dependencies), a.targetAlgorithm, j(a.metadata), scanTime],
      );
    }
    await query('DELETE FROM crypto_assets WHERE repository_id = $1 AND last_seen < $2', [repoId, scanTime]);
    const vulnerable = result.assets.filter((a) => !['safe', 'pqc'].includes(a.quantumStatus));
    await agentDone('ast', {
      action: vulnerable.some((a) => a.family === 'RSA') ? 'Detected RSA usage' : 'Detected cryptographic API usage',
      resource: repo.name,
      result: `${result.assets.length} assets, ${vulnerable.length} quantum-vulnerable/weak (${result.stats.astNodes} AST nodes)`,
      user,
      details: { rules: [...new Set(result.assets.map((a) => a.ruleId))] },
    });

    // Risk assessment (Mosca) + CBOM
    agentStart('risk', `Assessing ${repo.name}`);
    const counts = await assessRepository(repoId);
    await agentDone('risk', { action: counts.RED ? 'Classified assets as RED' : 'Classified assets', resource: repo.name, result: `RED ${counts.RED} · YELLOW ${counts.YELLOW} · GREEN ${counts.GREEN}`, user, status: counts.RED ? 'warning' : 'success' });

    onStage('cbom', 40, 'Building CycloneDX 1.5 components');
    const n = await regenerateCbom(repoId);
    onStage('cbom', 100, `CycloneDX 1.5 CBOM: ${n} components`);
    await audit({ agent: 'AST Analysis Agent', action: 'Generated CBOM', resource: repo.name, result: `CycloneDX 1.5 · ${n} components`, user });

    await query(
      "UPDATE repositories SET status = 'scanned', files_scanned = $2, loc = $3, languages = $4, last_scan_at = now(), scan_duration_ms = $5, primary_language = COALESCE(primary_language, $6) WHERE id = $1",
      [repoId, result.stats.files, result.stats.loc, j(result.stats.languages), Date.now() - started.getTime(), Object.entries(result.stats.languages).filter(([l]) => !['Config', 'Manifest', 'Dockerfile', 'Certificate'].includes(l)).sort((a, b) => b[1] - a[1])[0]?.[0] || null],
    );
    await query('UPDATE scan_runs SET finished_at = now(), status = $2, files_scanned = $3, assets_found = $4, red = $5, yellow = $6, green = $7 WHERE id = $1', [run.id, 'completed', result.stats.files, result.assets.length, counts.RED, counts.YELLOW, counts.GREEN]);
    invalidate('repositories', 'assets', 'cbom', 'risks', 'dashboard');
    return { repository: repo.name, repositoryId: repoId, stats: result.stats, assets: result.assets.length, vulnerable: vulnerable.length, counts, cbomComponents: n };
  } catch (e) {
    agentError('discovery', e);
    agentError('ast', e);
    await query("UPDATE repositories SET status = 'error' WHERE id = $1", [repoId]);
    await query("UPDATE scan_runs SET finished_at = now(), status = 'failed', error = $2 WHERE id = $1", [run.id, e.message]);
    await audit({ agent: 'Discovery Agent', action: 'Scan failed', resource: repo.name, result: e.message, user, status: 'failure' });
    invalidate('repositories');
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Inventory helpers
// ---------------------------------------------------------------------------
export async function inventory() {
  return many(`SELECT a.*, r.risk_level, r.risk_score, r.x_years, r.y_years, r.z_years, r.mosca_exposed, r.mosca_margin, r.urgency, r.business_criticality, r.rationale,
                      repo.name AS repository_name, repo.slug AS repository_slug
               FROM crypto_assets a
               LEFT JOIN risk_assessments r ON r.crypto_asset_id = a.id
               JOIN repositories repo ON repo.id = a.repository_id
               ORDER BY COALESCE(r.risk_score, 0) DESC, a.id`);
}

// ---------------------------------------------------------------------------
// Migration planning (Architect Agent)
// ---------------------------------------------------------------------------
export async function generatePlan({ strategy = 'hybrid-first', repositoryIds, name, teamSize = 4, user }) {
  agentStart('architect', 'Designing PQC migration roadmap');
  const allRepos = await many('SELECT * FROM repositories ORDER BY id');
  const repos = repositoryIds?.length ? allRepos.filter((r) => repositoryIds.includes(r.id)) : allRepos;
  const ids = new Set(repos.map((r) => r.id));
  const assets = (await many('SELECT * FROM crypto_assets')).filter((a) => ids.has(a.repository_id));
  const risks = await many('SELECT * FROM risk_assessments');
  const prs = (await many('SELECT * FROM pull_requests')).filter((p) => ids.has(p.repository_id));
  const tests = await many('SELECT status FROM test_results');
  agentProgress('architect', 60, 'Sequencing hybrid → PQC phases');
  const plan = buildPlan({ assets, risks, repos, prs, tests, strategy, teamSize });
  const mode = await getMode();
  const row = await one(
    `INSERT INTO migration_plans (name, scope, strategy, phases, items, summary, status, mode, created_by) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8) RETURNING *`,
    [name || `PQC roadmap — ${repos.length === allRepos.length ? 'enterprise portfolio' : repos.map((r) => r.name).join(', ')}`, j({ repositoryIds: [...ids] }), strategy, j(plan.phases), j(plan.items), j(plan.summary), mode, uname(user)],
  );
  await query("UPDATE migration_plans SET status = 'superseded' WHERE id <> $1 AND status = 'active'", [row.id]);
  await agentDone('architect', { action: 'Generated migration plan', resource: row.name, result: `${plan.summary.totalItems} items · ${plan.summary.totalEffortDays} engineer-days · ${plan.summary.estimatedWeeks} weeks (${strategy})`, user });
  invalidate('plans', 'dashboard');
  return row;
}

// ---------------------------------------------------------------------------
// Remediation (Code Refactoring Agent)
// ---------------------------------------------------------------------------
export async function generateRemediation(assetId, { user, pace = pacer(300) } = {}) {
  const asset = await one('SELECT * FROM crypto_assets WHERE id = $1', [assetId]);
  if (!asset) throw httpError(404, `Asset ${assetId} not found`);
  if (['safe', 'pqc'].includes(asset.quantum_status)) throw httpError(400, `${asset.algorithm} is already quantum-safe — no remediation needed.`);
  if (asset.status === 'remediated') throw httpError(409, 'This asset was already remediated by an approved pull request.');
  if (asset.file_path.startsWith('aws://')) throw httpError(422, 'Cloud resources are remediated through infrastructure change requests (KMS key rotation / TLS policy), not code patches — see the Migration Planner.');
  const repo = await getRepo(asset.repository_id);
  const root = repoRoot(repo);
  const abs = path.resolve(root, asset.file_path);
  if (!abs.startsWith(path.resolve(root)) || !fs.existsSync(abs)) throw httpError(410, `Source file ${asset.file_path} is not available`);

  agentStart('refactor', `Code Mode: ${asset.file_path}`);
  await pace();
  const code = fs.readFileSync(abs, 'utf8');
  const siblings = await many(
    "SELECT * FROM crypto_assets WHERE repository_id = $1 AND file_path = $2 AND quantum_status NOT IN ('safe','pqc') AND status IN ('open','patch_generated') ORDER BY line",
    [repo.id, asset.file_path],
  );
  const goModule = fs.existsSync(path.join(root, 'go.mod')) ? fs.readFileSync(path.join(root, 'go.mod'), 'utf8').match(/^module\s+(\S+)/m)?.[1] : undefined;
  const existing = new Set(listFiles(root).map((f) => f.rel));
  agentProgress('refactor', 50, `Rewriting ${siblings.length} call site(s)`);
  const out = remediateFile({ filePath: asset.file_path, code, assets: siblings, goModule, existingFiles: existing });
  await pace();
  if (!out.changes.length || (out.after === code && !out.extraFiles.length)) {
    agentError('refactor', 'no transformation');
    throw httpError(422, `No automatic transformation is available for ${asset.file_path} (${asset.algorithm}). Dependency manifests like package.json need a manual upgrade — tracked in the Migration Planner.`);
  }
  const mode = await getMode();
  const job = await one(
    `INSERT INTO remediation_jobs (repository_id, file_path, language, asset_ids, changes, extra_files, before_code, after_code, diff, confidence, status, mode, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'generated',$11,$12) RETURNING *`,
    [repo.id, asset.file_path, out.language, j(siblings.map((s) => s.id)), j(out.changes), j(out.extraFiles), code, out.after, out.diff, out.confidence, mode, uname(user)],
  );
  const explanation = { ...explainPatch({ ...job, adapter: out.adapter }), adapter: out.adapter };
  await query('UPDATE remediation_jobs SET explanation = $2 WHERE id = $1', [job.id, j(explanation)]);
  await query("UPDATE crypto_assets SET status = 'patch_generated' WHERE id = ANY($1::int[])", [siblings.map((s) => s.id)]);
  await agentDone('refactor', { action: 'Generated PQC patch', resource: `${repo.name}:${asset.file_path}`, result: `${out.changes.length} change(s) · confidence ${Math.round(out.confidence * 100)}% · ${out.adapter}`, user, details: { jobId: job.id } });
  invalidate('remediation', 'assets', 'plans');
  return { ...job, explanation };
}

// ---------------------------------------------------------------------------
// Tests (Test Agent)
// ---------------------------------------------------------------------------
export function summarise(results) {
  const s = { total: results.length, passed: 0, failed: 0, warning: 0, real: 0, simulated: 0 };
  for (const r of results) {
    s[r.status]++;
    s[r.execution]++;
  }
  return s;
}

export async function executeTests({ remediationJobIds, suite = 'all', user, onResult = () => {}, pace = pacer(160) }) {
  let jobs;
  if (remediationJobIds?.length) jobs = await many('SELECT * FROM remediation_jobs WHERE id = ANY($1::int[])', [remediationJobIds]);
  else jobs = await many("SELECT * FROM remediation_jobs WHERE status IN ('generated','tested','in_review','changes_requested') ORDER BY id DESC LIMIT 5");
  const runId = `run-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`;
  agentStart('test', `Running ${suite} tests on ${jobs.length} patch(es)`);
  const results = await runTests({
    jobs,
    suite,
    pace,
    onResult: async (r) => {
      await query(
        'INSERT INTO test_results (run_id, remediation_job_id, suite, category, name, status, execution, duration_ms, details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [runId, r.remediation_job_id, r.suite, r.category, r.name, r.status, r.execution, r.duration_ms, r.details],
      );
      agentProgress('test', ((r.index + 1) / r.total) * 100, r.name);
      await onResult(r);
    },
  });
  const summary = summarise(results);
  if (jobs.length) await query("UPDATE remediation_jobs SET status = 'tested' WHERE id = ANY($1::int[]) AND status = 'generated'", [jobs.map((x) => x.id)]);
  const label = suite === 'regression' ? 'Regression tests' : suite === 'interoperability' ? 'Interoperability tests' : 'Test suite';
  await agentDone('test', {
    action: `${label} ${summary.failed ? 'failed' : 'passed'}`,
    resource: jobs.map((x) => x.file_path).join(', ') || 'PQC primitives',
    result: `${summary.passed}/${summary.total} passed · ${summary.warning} warning · ${summary.failed} failed (${summary.real} real, ${summary.simulated} simulated)`,
    user,
    status: summary.failed ? 'failure' : summary.warning ? 'warning' : 'success',
    details: { runId },
  });
  invalidate('tests', 'dashboard', 'plans');
  return { runId, summary, results, jobIds: jobs.map((x) => x.id) };
}

// ---------------------------------------------------------------------------
// Pull requests + human approval
// ---------------------------------------------------------------------------
const diffStats = (diff) => {
  const files = [];
  let cur = null;
  for (const l of (diff || '').split('\n')) {
    if (l.startsWith('+++ ')) {
      cur = { path: l.slice(4).replace(/^b\//, ''), additions: 0, deletions: 0, isNew: false };
      files.push(cur);
    } else if (l.startsWith('--- ') && cur === null) continue;
    else if (cur && l.startsWith('+') && !l.startsWith('+++')) cur.additions++;
    else if (cur && l.startsWith('-') && !l.startsWith('---')) cur.deletions++;
  }
  return files;
};

export async function createPullRequest({ remediationJobIds, testRunId, user }) {
  if (!remediationJobIds?.length) throw httpError(400, 'At least one remediation job is required');
  const jobs = await many('SELECT * FROM remediation_jobs WHERE id = ANY($1::int[]) ORDER BY id', [remediationJobIds]);
  if (jobs.length !== remediationJobIds.length) throw httpError(404, 'One or more remediation jobs were not found');
  const repoIds = [...new Set(jobs.map((x) => x.repository_id))];
  if (repoIds.length > 1) throw httpError(400, 'A pull request can only contain patches for one repository');
  const open = jobs.filter((x) => ['in_review', 'merged'].includes(x.status));
  if (open.length) throw httpError(409, `Patch #${open[0].id} is already part of a pull request`);
  const repo = await getRepo(repoIds[0]);

  agentStart('refactor', 'Opening pull request');
  let runId = testRunId;
  if (!runId) {
    const last = await one('SELECT run_id FROM test_results WHERE remediation_job_id = ANY($1::int[]) ORDER BY id DESC LIMIT 1', [jobs.map((x) => x.id)]);
    runId = last?.run_id || null;
  }
  const tests = runId ? await many('SELECT * FROM test_results WHERE run_id = $1', [runId]) : [];
  const testSummary = summarise(tests);

  const assetIds = jobs.flatMap((x) => x.asset_ids);
  const risks = assetIds.length ? await many('SELECT crypto_asset_id, risk_score FROM risk_assessments WHERE crypto_asset_id = ANY($1::int[])', [assetIds]) : [];
  const changes = jobs.flatMap((x) => x.changes);
  const confBy = new Map(changes.map((c) => [c.assetId, c.confidence]));
  const before = risks.reduce((s, r) => s + r.risk_score, 0);
  const after = Math.round(risks.reduce((s, r) => s + r.risk_score * (1 - (confBy.get(r.crypto_asset_id) ?? 0.5)), 0));
  const reduction = before ? Math.round(((before - after) / before) * 100) : 0;

  const seen = new Set();
  const changed = [];
  for (const job of jobs) {
    for (const f of diffStats(job.diff)) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      changed.push({ ...f, isNew: (job.extra_files || []).some((e) => e.path === f.path) });
    }
  }
  const remaining = (await one("SELECT count(*)::int AS n FROM crypto_assets WHERE repository_id = $1 AND quantum_status NOT IN ('safe','pqc') AND status <> 'remediated' AND NOT (id = ANY($2::int[]))", [repo.id, assetIds])).n;

  agentStart('compliance', 'Checking PR against FIPS 203/204, NIST IR 8547, CNSA 2.0');
  const compliance = checkCompliance({ repo, changes, testSummary, remainingVulnerable: remaining });
  await agentDone('compliance', { action: 'Compliance check', resource: repo.name, result: compliance.status.replace('_', ' '), user, status: compliance.status === 'non_compliant' ? 'failure' : compliance.status === 'review_required' ? 'warning' : 'success' });

  const number = ((await one('SELECT max(number)::int AS n FROM pull_requests')).n || 100) + 1;
  const branch = `quantumshift/pqc-${repo.slug}-${number}`;
  const explanation = jobs.map((x) => x.explanation?.summary).filter(Boolean).join(' ');
  const title = `PQC migration: ${[...new Set(changes.map((c) => c.to.split(' (')[0]))].slice(0, 3).join(', ')} in ${repo.name}`;
  const pr = await one(
    `INSERT INTO pull_requests (number, repository_id, title, branch, remediation_job_ids, changed_files, crypto_changes, risk_before, risk_after, risk_reduction, test_run_id, test_summary, ai_explanation, compliance, status, audit_status, simulated, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending_review','awaiting human approval',true,$15) RETURNING *`,
    [number, repo.id, title, branch, j(jobs.map((x) => x.id)), j(changed), j(changes), before, after, reduction, runId, j(testSummary), explanation, j(compliance), uname(user)],
  );
  await query("UPDATE remediation_jobs SET status = 'in_review' WHERE id = ANY($1::int[])", [jobs.map((x) => x.id)]);
  await query("UPDATE crypto_assets SET status = 'in_review' WHERE id = ANY($1::int[])", [assetIds]);
  await agentDone('refactor', { action: `Created PR #${number}`, resource: `${repo.name} ← ${branch}`, result: `${changed.length} file(s) · risk −${reduction}% · simulated PR (no remote push)`, user });
  await audit({ agent: 'Human Approval', action: `PR #${number} awaiting review`, resource: repo.name, result: 'Pending', user, status: 'pending' });
  agentStart('audit', 'Awaiting human decision');
  invalidate('prs', 'remediation', 'assets', 'dashboard', 'plans');
  return pr;
}

export async function reviewPullRequest(id, action, comment, user) {
  const pr = await one('SELECT * FROM pull_requests WHERE id = $1', [id]);
  if (!pr) throw httpError(404, `Pull request ${id} not found`);
  if (pr.status === 'approved' || pr.status === 'rejected') throw httpError(409, `PR #${pr.number} is already ${pr.status}`);
  const repo = await getRepo(pr.repository_id);
  const jobIds = pr.remediation_job_ids;
  const jobs = jobIds.length ? await many('SELECT asset_ids FROM remediation_jobs WHERE id = ANY($1::int[])', [jobIds]) : [];
  const assetIds = jobs.flatMap((x) => x.asset_ids);
  const map = {
    approve: { pr: 'approved', job: 'merged', asset: 'remediated', audit: 'approved', verb: 'approved' },
    reject: { pr: 'rejected', job: 'rejected', asset: 'open', audit: 'rejected', verb: 'rejected' },
    request_changes: { pr: 'changes_requested', job: 'changes_requested', asset: 'patch_generated', audit: 'changes requested', verb: 'returned for changes' },
  }[action];
  if (!map) throw httpError(400, 'Unknown review action');
  if (action !== 'approve' && !comment?.trim()) throw httpError(400, 'A reviewer comment is required when rejecting or requesting changes');

  const updated = await one(
    'UPDATE pull_requests SET status = $2, reviewer = $3, review_comment = $4, reviewed_at = now(), audit_status = $5 WHERE id = $1 RETURNING *',
    [id, map.pr, uname(user), comment || null, `${map.audit} by ${uname(user)} — recorded in BobShell`],
  );
  if (jobIds.length) await query('UPDATE remediation_jobs SET status = $2 WHERE id = ANY($1::int[])', [jobIds, map.job]);
  if (assetIds.length) await query('UPDATE crypto_assets SET status = $2 WHERE id = ANY($1::int[])', [assetIds, map.asset]);
  await assessRepository(repo.id);
  await regenerateCbom(repo.id);
  await audit({ agent: 'Human Approval', action: `PR #${pr.number} ${map.verb}`, resource: `${repo.name} ← ${pr.branch}`, result: comment || (action === 'approve' ? 'Approved for merge (simulated merge — no remote repository modified)' : ''), user, status: action === 'approve' ? 'success' : 'warning' });
  agentStart('audit', 'Recording approval evidence');
  await agentDone('audit', { action: 'Recorded review evidence', resource: `PR #${pr.number}`, result: `Hash-chained entry for ${map.verb} decision`, user });
  invalidate('prs', 'remediation', 'assets', 'risks', 'dashboard', 'plans', 'cbom');
  return updated;
}

export { LEVEL_URGENCY };
