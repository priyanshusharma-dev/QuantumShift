import { query, one, many } from '../db/index.js';
import { createJob, updateStep, finishJob, failJob, invalidate, sleep } from '../lib/events.js';
import { config } from '../config.js';
import { mosca } from './risk.js';
import { explain } from './granite.js';
import { planTests } from './testing.js';
import { verifyChain, audit } from './audit.js';
import { agentStart, agentDone, resetAgents } from './agents.js';
import { runScan, getRepo, getMode, getZ, generatePlan, generateRemediation, executeTests, createPullRequest, SCAN_STAGES } from './pipeline.js';
import { dashboardSummary } from './dashboard.js';

export const DEMO_STEPS = [
  { key: 'load', label: 'Load demo repository', agent: 'Discovery Agent' },
  { key: 'scan', label: 'Scan repository', agent: 'Discovery Agent' },
  { key: 'detect', label: 'Detect cryptographic assets', agent: 'AST Analysis Agent' },
  { key: 'cbom', label: 'Generate CBOM (CycloneDX 1.5)', agent: 'AST Analysis Agent' },
  { key: 'mosca', label: "Calculate Mosca risk (X + Y > Z)", agent: 'Risk Assessment Agent' },
  { key: 'classify', label: 'Classify assets RED / YELLOW / GREEN', agent: 'Risk Assessment Agent' },
  { key: 'explain', label: 'Generate AI explanations', agent: 'Risk Assessment Agent (Granite-style)' },
  { key: 'plan', label: 'Create migration roadmap', agent: 'Architect Agent' },
  { key: 'remediate', label: 'Generate PQC remediation', agent: 'Code Refactoring Agent' },
  { key: 'gentests', label: 'Generate tests', agent: 'Test Agent' },
  { key: 'runtests', label: 'Run tests', agent: 'Test Agent' },
  { key: 'pr', label: 'Create simulated pull request', agent: 'Code Refactoring Agent + Compliance Agent' },
  { key: 'approval', label: 'Wait for human approval', agent: 'Human-in-the-loop' },
  { key: 'bobshell', label: 'Record all actions in BobShell', agent: 'Audit Agent' },
  { key: 'dashboard', label: 'Update executive dashboard', agent: 'Dashboard' },
];

let running = null;

/** Resets the demo repository to its pristine state so the demo is repeatable. */
async function reloadDemoRepo(repoId) {
  await query('DELETE FROM pull_requests WHERE repository_id = $1', [repoId]);
  await query('DELETE FROM remediation_jobs WHERE repository_id = $1', [repoId]);
  await query("UPDATE crypto_assets SET status = 'open' WHERE repository_id = $1", [repoId]);
}

export function startCompleteDemo(user, { slug = 'banking-api' } = {}) {
  if (running && running.status === 'running') return running;
  const job = createJob('demo', 'RUN COMPLETE QUANTUMSHIFT DEMO', DEMO_STEPS, { slug });
  running = job;
  run(job, user, slug).catch((e) => failJob(job, e));
  return job;
}

async function run(job, user, slug) {
  const pace = () => sleep(config.pacingMs);
  const step = async (key, fn) => {
    updateStep(job, key, { status: 'running', progress: 10 });
    const r = await fn((progress, message) => updateStep(job, key, { progress, message }));
    updateStep(job, key, { status: r?.status || 'done', message: r?.message ?? job.steps.find((s) => s.key === key).message, data: r?.data });
    await pace();
    return r?.data;
  };
  resetAgents();
  const mode = await getMode();
  await audit({ agent: 'IBM Bob Orchestrator', action: 'Started complete QuantumShift demo', resource: slug, result: `Mode: ${mode === 'demo' ? 'Demo / Simulation' : 'Real Integration'}`, user, status: 'info' });
  const auditStart = (await one('SELECT max(id)::int AS id FROM audit_logs')).id || 0;

  const repo = await step('load', async (p) => {
    agentStart('discovery', 'Loading demo repository');
    const r = await one('SELECT * FROM repositories WHERE slug = $1', [slug]);
    if (!r) throw new Error(`Demo repository ${slug} is not registered — reset demo data in Settings`);
    p(50, 'Restoring pristine demo state');
    await reloadDemoRepo(r.id);
    return { message: `${r.name} · ${r.source_type === 'demo' ? 'bundled sample codebase' : r.source_type} · ${r.primary_language}`, data: r };
  });

  const scan = await step('scan', async (p) => {
    const res = await runScan(repo.id, {
      user,
      pace: () => sleep(Math.round(config.pacingMs * 0.6)),
      onStage: (key, pct, msg) => {
        const idx = SCAN_STAGES.findIndex((s) => s.key === key);
        p(Math.round(((idx + pct / 100) / SCAN_STAGES.length) * 100), `${SCAN_STAGES[idx]?.label}: ${msg}`);
      },
    });
    return { message: `${res.stats.files} files · ${res.stats.loc} lines · ${res.stats.astNodes.toLocaleString()} AST nodes in ${res.stats.durationMs} ms`, data: res };
  });

  await step('detect', async () => {
    const rows = await many('SELECT algorithm, rule_id, quantum_status FROM crypto_assets WHERE repository_id = $1', [repo.id]);
    const v = rows.filter((a) => !['safe', 'pqc'].includes(a.quantum_status));
    const rsa = rows.filter((a) => /RSA/.test(a.algorithm)).length;
    return { message: `${rows.length} cryptographic assets · ${v.length} quantum-vulnerable/weak · ${rsa} RSA usages`, data: { total: rows.length } };
  });

  await step('cbom', async () => {
    const n = (await one('SELECT count(*)::int AS n FROM cbom_assets WHERE repository_id = $1', [repo.id])).n;
    return { message: `CycloneDX 1.5 CBOM with ${n} components (exportable as JSON)` };
  });

  const z = await getZ();
  await step('mosca', async () => {
    agentStart('risk', "Applying Mosca's theorem");
    const m = mosca({ x: repo.data_lifetime_years, y: repo.migration_time_years, z });
    await agentDone('risk', { action: 'Calculated Mosca risk', resource: repo.name, result: `X=${m.x} + Y=${m.y} = ${m.lhs} ${m.exposed ? '>' : '≤'} Z=${m.z}`, user, status: m.exposed ? 'warning' : 'success' });
    return { message: m.verdict, data: m };
  });

  await step('classify', async () => {
    const c = scan.counts;
    return { message: `RED ${c.RED} · YELLOW ${c.YELLOW} · GREEN ${c.GREEN}`, data: c };
  });

  await step('explain', async (p) => {
    agentStart('risk', 'Writing Granite-style explanations');
    const rows = await many(
      `SELECT a.*, r.* , a.id AS id FROM crypto_assets a JOIN risk_assessments r ON r.crypto_asset_id = a.id
       WHERE a.repository_id = $1 AND r.risk_level <> 'GREEN' ORDER BY r.risk_score DESC`,
      [repo.id],
    );
    let sample = null;
    for (const [i, row] of rows.entries()) {
      const assess = { level: row.risk_level, x: row.x_years, y: row.y_years, z: row.z_years, exposed: row.mosca_exposed, margin: row.mosca_margin, criticality: row.business_criticality, rationale: row.rationale };
      const exp = await explain(row, assess, repo, mode);
      await query('UPDATE risk_assessments SET explanation = $2 WHERE crypto_asset_id = $1', [row.id, JSON.stringify(exp)]);
      if (!sample || (row.family === 'RSA' && sample.family !== 'RSA')) sample = { ...exp, family: row.family };
      p(Math.round(((i + 1) / rows.length) * 100), `Explained ${row.algorithm} (${row.file_path})`);
    }
    await agentDone('risk', { action: 'Generated AI risk explanations', resource: repo.name, result: `${rows.length} explanations · ${sample?.label || ''}`, user });
    return { message: sample ? `“${sample.summary.slice(0, 180)}…”` : 'No risks to explain', data: { count: rows.length, label: sample?.label } };
  });

  const plan = await step('plan', async () => {
    const pl = await generatePlan({ strategy: 'hybrid-first', repositoryIds: [repo.id], name: `${repo.name} PQC roadmap (demo)`, user });
    return { message: `${pl.summary.totalItems} items · P1 ${pl.summary.p1} · ${pl.summary.totalEffortDays} engineer-days · 7 phases`, data: pl };
  });

  const jobs = await step('remediate', async (p) => {
    const files = await many(
      `SELECT a.file_path, max(r.risk_score) AS score FROM crypto_assets a JOIN risk_assessments r ON r.crypto_asset_id = a.id
       WHERE a.repository_id = $1 AND r.risk_level = 'RED' AND a.language IN ('JavaScript','TypeScript','Python','Go','Java') AND a.status = 'open'
       GROUP BY a.file_path ORDER BY bool_or(a.rule_id LIKE 'PQC-RSA-00%') DESC, max(r.risk_score) DESC, a.file_path LIMIT 2`,
      [repo.id],
    );
    const out = [];
    for (const [i, f] of files.entries()) {
      const a = await one("SELECT id FROM crypto_assets WHERE repository_id = $1 AND file_path = $2 AND status = 'open' AND quantum_status NOT IN ('safe','pqc') ORDER BY line LIMIT 1", [repo.id, f.file_path]);
      p(Math.round((i / files.length) * 100) + 10, `Code Mode: rewriting ${f.file_path}`);
      out.push(await generateRemediation(a.id, { user }));
    }
    const changes = out.reduce((s, x) => s + x.changes.length, 0);
    return { message: `${out.length} patch(es): ${out.map((x) => x.file_path).join(', ')} — ${changes} call sites → ML-DSA-65 / ML-KEM-768`, data: out };
  });

  await step('gentests', async () => {
    const planned = planTests(jobs, 'all');
    const by = planned.reduce((m, t) => ({ ...m, [t.category]: (m[t.category] || 0) + 1 }), {});
    await audit({ agent: 'Test Agent', action: 'Generated tests', resource: jobs.map((x) => x.file_path).join(', '), result: Object.entries(by).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(' · '), user });
    return { message: `${planned.length} test cases: ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ')}` };
  });

  const tests = await step('runtests', async (p) => {
    const r = await executeTests({ remediationJobIds: jobs.map((x) => x.id), suite: 'all', user, onResult: (t) => p(Math.round(((t.index + 1) / t.total) * 100), `${t.status.toUpperCase()} · ${t.name}`) });
    const s = r.summary;
    return { message: `${s.passed}/${s.total} passed · ${s.warning} warning · ${s.failed} failed (${s.real} executed for real, ${s.simulated} simulated)`, data: r };
  });

  const pr = await step('pr', async () => {
    const created = await createPullRequest({ remediationJobIds: jobs.map((x) => x.id), testRunId: tests.runId, user });
    return { message: `PR #${created.number} ${created.branch} · ${created.changed_files.length} files · risk −${created.risk_reduction}% · compliance: ${created.compliance.status.replace('_', ' ')}`, data: created };
  });

  await step('approval', async () => ({ status: 'waiting', message: `Human approval required before merge — PR #${pr.number} is pending in the PR Review & Approval Hub.`, data: { prId: pr.id } }));

  await step('bobshell', async () => {
    agentStart('audit', 'Verifying BobShell hash chain');
    const v = await verifyChain();
    const n = (await one('SELECT count(*)::int AS n FROM audit_logs WHERE id > $1', [auditStart])).n;
    await agentDone('audit', { action: 'Verified audit trail', resource: 'BobShell', result: `${n + 1} entries this run · chain ${v.valid ? 'intact' : 'BROKEN'}`, user, status: v.valid ? 'success' : 'failure' });
    return { message: `${n + 1} actions recorded this run · SHA-256 hash chain ${v.valid ? 'verified ✓' : 'broken ✗'} (${v.entries + 1} total entries)` };
  });

  await step('dashboard', async () => {
    invalidate('dashboard', 'repositories', 'assets', 'risks', 'plans', 'prs', 'tests', 'audit', 'cbom', 'remediation');
    const d = await dashboardSummary();
    return { message: `Executive dashboard refreshed: ${d.kpis.totalAssets} assets · ${d.kpis.high} RED · ${d.kpis.pendingPRs} PR(s) awaiting approval` };
  });

  finishJob(job, { repositoryId: repo.id, planId: plan.id, jobIds: jobs.map((x) => x.id), runId: tests.runId, prId: pr.id, prNumber: pr.number });
}
