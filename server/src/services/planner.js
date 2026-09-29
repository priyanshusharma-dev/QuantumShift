/**
 * IBM Bob "Architect Mode"-inspired migration planner.
 * Builds a seven-phase roadmap (Discovery → Production Deployment) from the
 * current asset inventory, risk assessments, remediation jobs and PRs.
 */

const EFFORT_DAYS = { algorithm: 1.5, key: 1, secret: 0.5, certificate: 3, library: 2, protocol: 1 };
const CRIT_FACTOR = { critical: 1.4, high: 1.2, medium: 1, low: 0.8 };
const HYBRID_FAMILIES = new Set(['ECDH', 'DH', 'TLS']);

const STATUS_LABEL = {
  open: 'Not started',
  patch_generated: 'Patch generated',
  in_review: 'In review',
  remediated: 'Done',
};

function phaseFor(a) {
  if (HYBRID_FAMILIES.has(a.family) || a.primitive === 'pke' || a.primitive === 'key-agree' || a.asset_type === 'protocol') return 3;
  return 4;
}

export function buildPlan({ assets, risks, repos, prs, tests, strategy = 'hybrid-first', teamSize = 4 }) {
  const riskBy = new Map(risks.map((r) => [r.crypto_asset_id, r]));
  const repoBy = new Map(repos.map((r) => [r.id, r]));

  const items = assets
    .map((a) => ({ a, r: riskBy.get(a.id) }))
    .filter(({ r }) => r && r.risk_level !== 'GREEN')
    .sort((p, q) => q.r.risk_score - p.r.risk_score)
    .map(({ a, r }) => {
      const repo = repoBy.get(a.repository_id) || {};
      const priority = r.risk_level === 'RED' ? (r.risk_score >= 85 ? 'P1' : 'P2') : 'P3';
      const effort = +((EFFORT_DAYS[a.asset_type] ?? 1.5) * (CRIT_FACTOR[repo.criticality] ?? 1)).toFixed(1);
      const target = strategy === 'direct-pqc' ? a.target_algorithm.replace(/\s*\(hybrid[^)]*\)/i, '').replace(/X25519MLKEM768 hybrid → /, '') : a.target_algorithm;
      return {
        assetId: a.id,
        repositoryId: a.repository_id,
        repository: repo.name,
        file: a.file_path,
        line: a.line,
        functionName: a.function_name,
        priority,
        riskLevel: r.risk_level,
        riskScore: r.risk_score,
        currentAlgorithm: a.algorithm,
        targetAlgorithm: target,
        assetType: a.asset_type,
        dependencies: a.dependencies || [],
        effortDays: effort,
        phase: phaseFor(a),
        status: STATUS_LABEL[a.status] || a.status,
        statusKey: a.status,
      };
    });

  const vulnerable = items.length;
  const done = items.filter((i) => i.statusKey === 'remediated').length;
  const inReview = items.filter((i) => i.statusKey === 'in_review').length;
  const patched = items.filter((i) => i.statusKey === 'patch_generated').length;
  const hybridItems = items.filter((i) => i.phase === 3);
  const pqcItems = items.filter((i) => i.phase === 4);
  const pending = prs.filter((p) => p.status === 'pending_review').length;
  const approved = prs.filter((p) => p.status === 'approved').length;
  const testTotal = tests.length;
  const testPassed = tests.filter((t) => t.status === 'passed').length;
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  const progressOf = (list) => pct(list.filter((i) => ['remediated', 'in_review'].includes(i.statusKey)).length + list.filter((i) => i.statusKey === 'patch_generated').length * 0.5, list.length);

  const totalEffort = items.reduce((s, i) => s + i.effortDays, 0);
  const weeks = (d) => Math.max(1, Math.ceil(d / (teamSize * 5)));
  const hybridEffort = hybridItems.reduce((s, i) => s + i.effortDays, 0);
  const pqcEffort = pqcItems.reduce((s, i) => s + i.effortDays, 0);

  const st = (p) => (p >= 100 ? 'complete' : p > 0 ? 'in_progress' : 'pending');
  let week = 1;
  const phase = (id, name, description, tasks, progress, durationWeeks, extra = {}) => {
    const out = { id, name, description, tasks, progress, status: st(progress), startWeek: week, durationWeeks, ...extra };
    week += durationWeeks;
    return out;
  };

  const phases = [
    phase(1, 'Discovery', 'Inventory every cryptographic asset across repositories, containers and cloud.', [`${repos.length} repositories scanned`, `${assets.length} cryptographic assets catalogued in the CBOM`], assets.length ? 100 : 0, 1, { assetCount: assets.length }),
    phase(2, 'Risk Classification', "Apply Mosca's theorem and classify assets RED / YELLOW / GREEN.", [`${items.filter((i) => i.riskLevel === 'RED').length} RED`, `${items.filter((i) => i.riskLevel === 'YELLOW').length} YELLOW`, 'Granite-style explanations generated'], risks.length ? 100 : 0, 1, { assetCount: risks.length }),
    phase(3, 'Hybrid Cryptography', strategy === 'direct-pqc' ? 'Key-exchange and encryption assets move directly to ML-KEM (direct-PQC strategy).' : 'Protect data in transit and key transport first with X25519MLKEM768 / ML-KEM hybrids (stops harvest-now-decrypt-later).', hybridItems.slice(0, 6).map((i) => `${i.currentAlgorithm} → ${i.targetAlgorithm} (${i.repository})`), progressOf(hybridItems), weeks(hybridEffort), { assetCount: hybridItems.length, effortDays: +hybridEffort.toFixed(1) }),
    phase(4, 'PQC Migration', 'Replace signatures with ML-DSA, retire SHA-1/MD5/3DES, remove hardcoded keys, upgrade libraries.', pqcItems.slice(0, 6).map((i) => `${i.currentAlgorithm} → ${i.targetAlgorithm} (${i.repository})`), progressOf(pqcItems), weeks(pqcEffort), { assetCount: pqcItems.length, effortDays: +pqcEffort.toFixed(1) }),
    phase(5, 'Testing', 'Regression, interoperability (ML-KEM/ML-DSA round-trips), unit and security tests on every patch.', [`${testTotal} test executions recorded`, `${testPassed} passed`], testTotal ? pct(testPassed, testTotal) : 0, 1),
    phase(6, 'Developer Approval', 'Human-in-the-loop review of every Bob-generated pull request.', [`${pending} PR(s) awaiting review`, `${approved} approved`], prs.length ? pct(approved, prs.length) : 0, 1),
    phase(7, 'Production Deployment', 'Merge approved PRs, rotate keys, re-issue certificates and monitor.', [`${done} of ${vulnerable} assets remediated`], pct(done, vulnerable), 2),
  ];

  return {
    phases,
    items,
    summary: {
      strategy,
      teamSize,
      totalItems: vulnerable,
      p1: items.filter((i) => i.priority === 'P1').length,
      p2: items.filter((i) => i.priority === 'P2').length,
      p3: items.filter((i) => i.priority === 'P3').length,
      totalEffortDays: +totalEffort.toFixed(1),
      estimatedWeeks: phases.reduce((s, p) => s + p.durationWeeks, 0),
      completed: done,
      inReview,
      patched,
      progressPct: pct(done, vulnerable),
    },
  };
}
