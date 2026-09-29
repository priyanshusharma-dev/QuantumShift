import { many, one } from '../db/index.js';
import { cbomDocument, inventory, getMode } from './pipeline.js';
import { dashboardSummary } from './dashboard.js';
import { verifyChain, listAudit } from './audit.js';
import { httpError } from '../lib/errors.js';

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formula injection and quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const toCsv = (rows, cols) => [cols.map((c) => csvCell(c.label)).join(','), ...rows.map((r) => cols.map((c) => csvCell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\n');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

export async function buildReport(type, { format = 'json', repositoryId, planId, runId, search, agent, status } = {}) {
  const mode = await getMode();
  const disclaimer = mode === 'demo' ? 'Generated in DEMO / SIMULATION MODE — sample repositories, simulated ingestion/PRs; cryptographic tests marked "real" were actually executed.' : 'Generated in REAL INTEGRATION mode.';

  switch (type) {
    case 'cbom': {
      const doc = await cbomDocument(repositoryId ? Number(repositoryId) : null);
      return { filename: `cbom-${repositoryId || 'portfolio'}-${stamp()}.cdx.json`, contentType: 'application/vnd.cyclonedx+json', body: JSON.stringify(doc, null, 2) };
    }
    case 'risk': {
      const rows = (await inventory()).filter((a) => !repositoryId || a.repository_id === Number(repositoryId));
      if (format === 'csv') {
        return {
          filename: `quantum-risk-report-${stamp()}.csv`,
          contentType: 'text/csv',
          body: toCsv(rows, [
            { label: 'Repository', key: 'repository_name' }, { label: 'File', key: 'file_path' }, { label: 'Line', key: 'line' }, { label: 'Function', key: 'function_name' },
            { label: 'Algorithm', key: 'algorithm' }, { label: 'Asset type', key: 'asset_type' }, { label: 'Rule', key: 'rule_id' }, { label: 'Quantum status', key: 'quantum_status' },
            { label: 'Risk level', key: 'risk_level' }, { label: 'Risk score', key: 'risk_score' }, { label: 'X (years)', key: 'x_years' }, { label: 'Y (years)', key: 'y_years' }, { label: 'Z (years)', key: 'z_years' },
            { label: 'Mosca exposed', key: 'mosca_exposed' }, { label: 'Urgency', key: 'urgency' }, { label: 'Target', key: 'target_algorithm' }, { label: 'Status', key: 'status' },
          ]),
        };
      }
      return { filename: `quantum-risk-report-${stamp()}.json`, contentType: 'application/json', body: JSON.stringify({ generatedAt: new Date().toISOString(), disclaimer, assets: rows }, null, 2) };
    }
    case 'migration': {
      const plan = planId ? await one('SELECT * FROM migration_plans WHERE id = $1', [planId]) : await one("SELECT * FROM migration_plans WHERE status = 'active' ORDER BY id DESC LIMIT 1");
      if (!plan) throw httpError(404, 'No migration plan exists yet — generate one in the Migration Planner');
      if (format === 'json') return { filename: `migration-plan-${plan.id}.json`, contentType: 'application/json', body: JSON.stringify(plan, null, 2) };
      const s = plan.summary;
      const md = [
        `# ${plan.name}`, '', `_${disclaimer}_`, '', `Strategy: **${plan.strategy}** · Items: **${s.totalItems}** (P1 ${s.p1} / P2 ${s.p2} / P3 ${s.p3}) · Effort: **${s.totalEffortDays} engineer-days** · Duration: **${s.estimatedWeeks} weeks** · Progress: **${s.progressPct}%**`, '',
        '## Phases', '', ...plan.phases.map((p) => `### Phase ${p.id} — ${p.name} (${p.status}, ${p.progress}%)\n${p.description}\n${p.tasks.map((t) => `- ${t}`).join('\n')}\n`),
        '## Work items', '', '| Priority | Repository | Asset | Current | Target | Effort (d) | Status |', '|---|---|---|---|---|---|---|',
        ...plan.items.map((i) => `| ${i.priority} | ${i.repository} | \`${i.file}${i.line ? ':' + i.line : ''}\` | ${i.currentAlgorithm} | ${i.targetAlgorithm} | ${i.effortDays} | ${i.status} |`),
      ].join('\n');
      return { filename: `migration-plan-${plan.id}.md`, contentType: 'text/markdown', body: md };
    }
    case 'tests': {
      const run = runId || (await one('SELECT run_id FROM test_results ORDER BY id DESC LIMIT 1'))?.run_id;
      if (!run) throw httpError(404, 'No test runs yet — run tests first');
      const rows = await many('SELECT * FROM test_results WHERE run_id = $1 ORDER BY id', [run]);
      if (format === 'csv') return { filename: `test-report-${run}.csv`, contentType: 'text/csv', body: toCsv(rows, ['suite', 'category', 'name', 'status', 'execution', 'duration_ms', 'details'].map((k) => ({ label: k, key: k }))) };
      const sum = rows.reduce((m, r) => ({ ...m, [r.status]: (m[r.status] || 0) + 1 }), {});
      return { filename: `test-report-${run}.json`, contentType: 'application/json', body: JSON.stringify({ runId: run, generatedAt: new Date().toISOString(), disclaimer, summary: sum, results: rows }, null, 2) };
    }
    case 'audit': {
      const rows = await listAudit({ search, agent, status, limit: 5000 });
      const chain = await verifyChain();
      if (format === 'csv') return { filename: `bobshell-audit-${stamp()}.csv`, contentType: 'text/csv', body: toCsv(rows, ['id', 'ts', 'agent', 'action', 'resource', 'result', 'username', 'status', 'mode', 'prev_hash', 'hash'].map((k) => ({ label: k, key: k, get: k === 'ts' ? (r) => new Date(r.ts).toISOString() : undefined }))) };
      return { filename: `bobshell-audit-${stamp()}.json`, contentType: 'application/json', body: JSON.stringify({ generatedAt: new Date().toISOString(), chainIntegrity: chain, entries: rows }, null, 2) };
    }
    case 'executive': {
      const d = await dashboardSummary();
      const k = d.kpis;
      const prs = await many('SELECT p.*, r.name AS repository FROM pull_requests p JOIN repositories r ON r.id = p.repository_id ORDER BY p.id DESC LIMIT 10');
      const chain = await verifyChain();
      const bar = (v, c) => `<div style="background:#1e293b;border-radius:4px;height:8px"><div style="width:${v}%;background:${c};height:8px;border-radius:4px"></div></div>`;
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>QuantumShift Executive Security Report</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:Inter,Segoe UI,system-ui,sans-serif;background:#0b1020;color:#e2e8f0;margin:0;padding:32px}h1{margin:0;font-size:26px}h2{margin-top:32px;font-size:16px;color:#93c5fd;text-transform:uppercase;letter-spacing:.08em}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-top:16px}.card{background:#111831;border:1px solid #243154;border-radius:12px;padding:14px}.v{font-size:26px;font-weight:700}.l{font-size:12px;color:#94a3b8}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:10px}td,th{padding:8px;border-bottom:1px solid #243154;text-align:left}.RED{color:#fb7185}.YELLOW{color:#fbbf24}.GREEN{color:#34d399}.note{font-size:12px;color:#94a3b8;margin-top:6px}
@media print{body{background:#fff;color:#0f172a}.card{background:#f8fafc;border-color:#cbd5e1}h2{color:#1d4ed8}}</style></head><body>
<h1>QuantumShift — Executive Security Report</h1><div class="note">Agentic PQC Migration of Enterprise Codebases using IBM Bob · generated ${esc(new Date().toUTCString())}</div>
<div class="note">${esc(disclaimer)}</div>
<h2>Posture</h2><div class="grid">
<div class="card"><div class="v">${k.totalAssets}</div><div class="l">Cryptographic assets</div></div>
<div class="card"><div class="v RED">${k.high}</div><div class="l">High risk (RED)</div></div>
<div class="card"><div class="v YELLOW">${k.medium}</div><div class="l">Medium risk (YELLOW)</div></div>
<div class="card"><div class="v GREEN">${k.low}</div><div class="l">Quantum-safe (GREEN)</div></div>
<div class="card"><div class="v">${k.migrationProgress}%</div><div class="l">Migration progress (${k.remediated}/${k.vulnerable})</div>${bar(k.migrationProgress, '#34d399')}</div>
<div class="card"><div class="v">${k.pendingPRs}</div><div class="l">PRs awaiting human approval</div></div>
<div class="card"><div class="v">${k.testPassRate}%</div><div class="l">Test pass rate (${k.testsPassed}/${k.testsTotal})</div></div>
<div class="card"><div class="v">${d.crqcYear}</div><div class="l">Assumed CRQC year (Z = ${d.z})</div></div></div>
<h2>Repositories</h2><table><tr><th>Repository</th><th>Criticality</th><th>RED</th><th>YELLOW</th><th>GREEN</th><th>Mosca exposure</th><th>Progress</th></tr>
${d.byRepository.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.criticality)}</td><td class="RED">${r.RED}</td><td class="YELLOW">${r.YELLOW}</td><td class="GREEN">${r.GREEN}</td><td>${r.exposureYears} yr</td><td>${r.progress}%</td></tr>`).join('')}</table>
<h2>Top risks</h2><table><tr><th>Level</th><th>Score</th><th>Asset</th><th>Location</th><th>Urgency</th></tr>
${d.topRisks.map((t) => `<tr><td class="${t.level}">${t.level}</td><td>${t.score}</td><td>${esc(t.algorithm)}</td><td>${esc(t.repository)} · ${esc(t.file)}${t.line ? ':' + t.line : ''}</td><td>${esc(t.urgency)}</td></tr>`).join('')}</table>
<h2>Pull requests</h2><table><tr><th>#</th><th>Repository</th><th>Title</th><th>Status</th><th>Risk reduction</th></tr>
${prs.map((p) => `<tr><td>${p.number}</td><td>${esc(p.repository)}</td><td>${esc(p.title)}</td><td>${esc(p.status.replace('_', ' '))}</td><td>−${p.risk_reduction}%</td></tr>`).join('') || '<tr><td colspan="5">No pull requests yet</td></tr>'}</table>
<h2>Governance</h2><div class="note">BobShell audit trail: ${chain.entries} entries · SHA-256 hash chain ${chain.valid ? 'verified intact' : `BROKEN at #${chain.brokenAt}`}. Human approval is mandatory for every Bob-generated change.</div>
</body></html>`;
      return { filename: `executive-security-report-${stamp()}.html`, contentType: 'text/html', body: html };
    }
    default:
      throw httpError(404, `Unknown report type "${type}"`);
  }
}
