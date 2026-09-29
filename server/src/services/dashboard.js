import { many, one } from '../db/index.js';
import { inventory, getZ, getMode } from './pipeline.js';

export const FAMILY_LABEL = {
  RSA: 'RSA', ECDSA: 'ECDSA', ECDH: 'ECDH', ECC: 'ECC', EdDSA: 'EdDSA', DSA: 'DSA', DH: 'DH',
  'SHA-1': 'SHA-1', MD5: 'MD5', '3DES': '3DES', DES: 'DES', RC4: 'RC4', 'AES-128': 'AES-128', 'AES-192': 'AES-192', 'AES-256': 'AES-256',
  'SHA-2': 'SHA-2', 'SHA-3': 'SHA-3', HMAC: 'HMAC', 'HMAC-SHA1': 'HMAC-SHA1', 'ML-KEM': 'ML-KEM', 'ML-DSA': 'ML-DSA', 'SLH-DSA': 'SLH-DSA',
  KEY: 'Hardcoded keys', SECRET: 'Hardcoded secrets', TLS: 'TLS config', LIBRARY: 'Libraries / runtimes',
};

/** Every number on the executive dashboard is computed from database state. */
export async function dashboardSummary() {
  const assets = await inventory();
  const repos = await many('SELECT id, name, slug, primary_language, criticality, status, last_scan_at, data_lifetime_years, migration_time_years, source_type FROM repositories ORDER BY id');
  const prs = await many('SELECT status FROM pull_requests');
  const tests = await many('SELECT status, execution FROM test_results');
  const jobs = await one('SELECT count(*)::int AS n FROM remediation_jobs');
  const plan = await one("SELECT id, name, summary, created_at FROM migration_plans WHERE status = 'active' ORDER BY id DESC LIMIT 1");
  const lastScan = await one("SELECT max(finished_at) AS t FROM scan_runs WHERE status = 'completed'");
  const z = await getZ();

  const level = (a) => a.risk_level || 'GREEN';
  const vulnerableEver = assets.filter((a) => !['safe', 'pqc'].includes(a.quantum_status));
  const remediated = vulnerableEver.filter((a) => a.status === 'remediated').length;
  const count = (fn) => assets.filter(fn).length;

  const byFamily = {};
  for (const a of assets) {
    const k = FAMILY_LABEL[a.family] || a.family || 'Other';
    byFamily[k] ||= { name: k, RED: 0, YELLOW: 0, GREEN: 0, total: 0 };
    byFamily[k][level(a)]++;
    byFamily[k].total++;
  }

  const byRepo = repos.map((r) => {
    const list = assets.filter((a) => a.repository_id === r.id);
    const vuln = list.filter((a) => !['safe', 'pqc'].includes(a.quantum_status));
    const done = vuln.filter((a) => a.status === 'remediated').length;
    const scores = list.filter((a) => level(a) !== 'GREEN').map((a) => a.risk_score);
    return {
      id: r.id,
      name: r.name,
      language: r.primary_language,
      criticality: r.criticality,
      status: r.status,
      RED: list.filter((a) => level(a) === 'RED').length,
      YELLOW: list.filter((a) => level(a) === 'YELLOW').length,
      GREEN: list.filter((a) => level(a) === 'GREEN').length,
      total: list.length,
      remediated: done,
      vulnerable: vuln.length,
      progress: vuln.length ? Math.round((done / vuln.length) * 100) : 100,
      maxScore: scores.length ? Math.max(...scores) : 0,
      exposureYears: Math.max(0, +(r.data_lifetime_years + r.migration_time_years - z).toFixed(1)),
    };
  });

  const byLanguage = {};
  for (const a of assets) {
    const k = a.language || 'Other';
    byLanguage[k] ||= { name: k, RED: 0, YELLOW: 0, GREEN: 0, total: 0 };
    byLanguage[k][level(a)]++;
    byLanguage[k].total++;
  }

  const TYPES = ['algorithm', 'key', 'secret', 'certificate', 'protocol', 'library'];
  const rank = { RED: 3, YELLOW: 2, GREEN: 1 };
  const heatmap = repos.map((r) => ({
    repositoryId: r.id,
    repository: r.name,
    cells: TYPES.map((t) => {
      const list = assets.filter((a) => a.repository_id === r.id && a.asset_type === t);
      const worst = list.reduce((w, a) => (rank[level(a)] > rank[w] ? level(a) : w), 'GREEN');
      return { type: t, count: list.length, level: list.length ? worst : null, red: list.filter((a) => level(a) === 'RED').length };
    }),
  }));

  const startYear = new Date().getFullYear();
  const openVuln = vulnerableEver.filter((a) => a.status !== 'remediated');
  const timeline = Array.from({ length: 31 }, (_, t) => ({
    year: startYear + t,
    offset: t,
    needingProtection: openVuln.filter((a) => (a.x_years ?? 0) + (a.y_years ?? 0) >= t).length,
    exposed: t >= z ? openVuln.filter((a) => (a.x_years ?? 0) + (a.y_years ?? 0) >= t).length : 0,
  }));

  const passed = tests.filter((t) => t.status === 'passed').length;
  return {
    mode: await getMode(),
    z,
    crqcYear: startYear + z,
    generatedAt: new Date().toISOString(),
    lastScanAt: lastScan?.t || null,
    kpis: {
      repositories: repos.length,
      repositoriesScanned: repos.filter((r) => r.last_scan_at).length,
      totalAssets: assets.length,
      high: count((a) => level(a) === 'RED'),
      medium: count((a) => level(a) === 'YELLOW'),
      low: count((a) => level(a) === 'GREEN'),
      pqcReady: count((a) => level(a) === 'GREEN'),
      pqcReadyPct: assets.length ? Math.round((count((a) => level(a) === 'GREEN') / assets.length) * 100) : 0,
      vulnerable: vulnerableEver.length,
      remediated,
      migrationProgress: vulnerableEver.length ? Math.round((remediated / vulnerableEver.length) * 100) : 0,
      pendingPRs: prs.filter((p) => p.status === 'pending_review').length,
      generatedPRs: prs.length,
      approvedPRs: prs.filter((p) => p.status === 'approved').length,
      patches: jobs.n,
      testsTotal: tests.length,
      testsPassed: passed,
      testsFailed: tests.filter((t) => t.status === 'failed').length,
      testsWarning: tests.filter((t) => t.status === 'warning').length,
      testsRealPct: tests.length ? Math.round((tests.filter((t) => t.execution === 'real').length / tests.length) * 100) : 0,
      testPassRate: tests.length ? Math.round((passed / tests.length) * 100) : 0,
      hardcodedKeys: count((a) => a.family === 'KEY' || a.family === 'SECRET'),
      certificates: count((a) => a.asset_type === 'certificate'),
    },
    riskDistribution: [
      { name: 'RED', value: count((a) => level(a) === 'RED') },
      { name: 'YELLOW', value: count((a) => level(a) === 'YELLOW') },
      { name: 'GREEN', value: count((a) => level(a) === 'GREEN') },
    ],
    algorithmDistribution: Object.values(byFamily).sort((a, b) => b.total - a.total),
    byRepository: byRepo,
    byLanguage: Object.values(byLanguage).sort((a, b) => b.total - a.total),
    heatmap,
    timeline,
    topRisks: assets.filter((a) => level(a) !== 'GREEN' && a.status !== 'remediated').slice(0, 8).map((a) => ({ id: a.id, repository: a.repository_name, repositoryId: a.repository_id, file: a.file_path, line: a.line, algorithm: a.algorithm, level: level(a), score: a.risk_score, urgency: a.urgency, functionName: a.function_name })),
    activePlan: plan,
  };
}
