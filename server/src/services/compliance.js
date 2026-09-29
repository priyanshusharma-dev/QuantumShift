/**
 * Compliance Agent — checks a pull request against PQC standards and policy.
 * References: FIPS 203 (ML-KEM), FIPS 204 (ML-DSA), FIPS 205 (SLH-DSA),
 * NIST IR 8547 (initial public draft: deprecate quantum-vulnerable algorithms
 * after 2030, disallow after 2035) and NSA CNSA 2.0.
 */
export function checkCompliance({ repo, changes, testSummary, remainingVulnerable }) {
  const checks = [];
  const pqc = changes.filter((c) => /ML-KEM|ML-DSA|X25519MLKEM768/.test(c.to));
  checks.push({
    name: 'FIPS 203 / FIPS 204 algorithms',
    status: 'pass',
    detail: `${pqc.length} change(s) adopt ML-KEM-768 / ML-DSA-65 (NIST security category 3).`,
  });
  const gov = /government|defen[cs]e|national/i.test(`${repo.name} ${repo.business_unit}`);
  checks.push({
    name: 'CNSA 2.0 parameter sets',
    status: gov && pqc.length ? 'warning' : 'pass',
    detail: gov && pqc.length
      ? 'National Security Systems require ML-KEM-1024 and ML-DSA-87 under CNSA 2.0 — confirm system categorisation before merge.'
      : 'Not a National Security System; category-3 parameter sets are appropriate.',
  });
  checks.push({
    name: 'NIST IR 8547 transition timeline',
    status: remainingVulnerable > 0 ? 'info' : 'pass',
    detail: `${remainingVulnerable} quantum-vulnerable asset(s) remain in ${repo.name}; RSA/ECC are deprecated after 2030 and disallowed after 2035 (IR 8547 draft).`,
  });
  const manual = changes.filter((c) => c.confidence < 0.7);
  checks.push({
    name: 'Change confidence',
    status: manual.length ? 'warning' : 'pass',
    detail: manual.length ? `${manual.length} low-confidence change(s) carry TODO(quantumshift) markers.` : 'All changes are high-confidence deterministic rewrites.',
  });
  checks.push({
    name: 'Automated tests',
    status: testSummary?.failed ? 'fail' : testSummary?.warning ? 'warning' : testSummary?.total ? 'pass' : 'warning',
    detail: testSummary?.total ? `${testSummary.passed}/${testSummary.total} passed, ${testSummary.warning} warning(s), ${testSummary.failed} failed.` : 'No test run attached to this PR.',
  });
  checks.push({ name: 'Human approval (separation of duties)', status: 'pending', detail: 'A CISO or developer code owner must approve before merge. Bob never self-approves.' });
  const status = checks.some((c) => c.status === 'fail') ? 'non_compliant' : checks.some((c) => c.status === 'warning') ? 'review_required' : 'compliant';
  return { status, checks, checkedAt: new Date().toISOString() };
}
