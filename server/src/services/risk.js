import { FAMILIES } from './catalog.js';

/**
 * Mosca's theorem:  if X + Y > Z  the data is at risk.
 *   X = security shelf-life — how long the data must stay confidential/authentic (years)
 *   Y = migration time — how long it takes to move this system to PQC (years)
 *   Z = collapse time — estimated years until a cryptographically relevant quantum computer (CRQC)
 */
export function mosca({ x, y, z }) {
  const X = Number(x);
  const Y = Number(y);
  const Z = Number(z);
  if (![X, Y, Z].every((v) => Number.isFinite(v) && v >= 0 && v <= 200)) {
    throw Object.assign(new Error('X, Y and Z must be numbers between 0 and 200 years'), { status: 400 });
  }
  const lhs = +(X + Y).toFixed(2);
  const margin = +(lhs - Z).toFixed(2);
  return {
    x: X,
    y: Y,
    z: Z,
    lhs,
    exposed: lhs > Z,
    margin,
    yearsExposed: Math.max(0, margin),
    verdict: lhs > Z
      ? `X + Y = ${lhs} > Z = ${Z}: data protected today will still need protection ${margin} year(s) after a CRQC is expected — migration is already late.`
      : `X + Y = ${lhs} ≤ Z = ${Z}: ${Math.abs(margin)} year(s) of headroom before quantum exposure — plan migration within this window.`,
  };
}

const CRIT_WEIGHT = { critical: 10, high: 6, medium: 2, low: 0 };
const BASE = { broken: 82, exposed: 88, vulnerable: 58, weakened: 34, unsupported: 38, safe: 6, pqc: 2 };
const TYPE_Y_ADJ = { certificate: 1, library: 0.5, protocol: 0.5, key: 0.25, secret: 0, algorithm: 0 };

export const LEVEL_URGENCY = {
  RED: 'Immediate Migration',
  YELLOW: 'Migration Planned',
  GREEN: 'No Immediate Action',
};

/** Classifies one asset. Every number is derived from asset + repository + global Z. */
export function assessAsset(asset, repo, { z }) {
  const status = asset.quantum_status || asset.quantumStatus;
  const assetType = asset.asset_type || asset.assetType;
  const x = Number(repo.data_lifetime_years);
  const y = +(Number(repo.migration_time_years) + (TYPE_Y_ADJ[assetType] ?? 0)).toFixed(2);
  const m = mosca({ x, y, z });
  const crit = repo.criticality || 'medium';

  let level;
  let rationale;
  if (status === 'safe' || status === 'pqc') {
    level = 'GREEN';
    rationale = status === 'pqc' ? 'NIST post-quantum algorithm — already quantum-safe.' : 'Quantum-resistant primitive (Grover only gives a square-root speed-up).';
  } else if (status === 'broken' || status === 'exposed') {
    level = 'RED';
    rationale = status === 'exposed' ? 'Key material is hardcoded in source — exploitable today, independent of quantum timelines.' : 'Classically broken today — no quantum computer required.';
  } else if (status === 'vulnerable') {
    level = m.exposed ? 'RED' : 'YELLOW';
    rationale = m.exposed ? `Mosca exposed: X(${x}) + Y(${y}) > Z(${z}).` : `Mosca headroom of ${Math.abs(m.margin)} year(s): X(${x}) + Y(${y}) ≤ Z(${z}).`;
  } else {
    level = 'YELLOW';
    rationale = status === 'weakened' ? "Grover's algorithm halves effective security; migrate during normal refresh." : 'Library/runtime blocks PQC adoption; upgrade before code migration.';
  }

  let score = BASE[status] ?? 50;
  if (level !== 'GREEN') {
    score += Math.max(-18, Math.min(18, m.margin * 2.5));
    score += CRIT_WEIGHT[crit] ?? 0;
    if (assetType === 'certificate') score += 3;
    if (asset.key_size && asset.key_size < 2048) score += 5;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (level === 'RED') score = Math.max(score, 70);
  if (level === 'YELLOW') score = Math.min(Math.max(score, 35), 69);
  if (level === 'GREEN') score = Math.min(score, 20);

  return {
    x,
    y,
    z: Number(z),
    exposed: m.exposed,
    margin: m.margin,
    level,
    score,
    criticality: crit,
    urgency: LEVEL_URGENCY[level],
    rationale,
  };
}

export const threatFor = (family) => FAMILIES[family]?.threat || 'Classical public-key cryptography is vulnerable to quantum attacks.';
