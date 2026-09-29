import fs from 'node:fs';
import { query, one, j, dbEngine } from '../db/index.js';
import { config, watsonxConfigured } from '../config.js';
import { scanSource } from './scanner.js';
import { mosca, assessAsset } from './risk.js';
import { componentFor } from './cbom.js';
import { verifyChain } from './audit.js';
import { listAgents } from './agents.js';
import { pqcSupported } from './testing.js';
import { getMode } from './pipeline.js';
import crypto from 'node:crypto';

/**
 * System diagnostics — each check runs a real self-test of the local component.
 */
const SERVICES = [
  ['frontend', 'Frontend (React + Tailwind)'],
  ['backend', 'Backend API (Node.js + Express)'],
  ['database', 'PostgreSQL'],
  ['risk', 'Risk Engine (Mosca)'],
  ['ast', 'AST Scanner'],
  ['cbom', 'CBOM Generator (CycloneDX 1.5)'],
  ['agents', 'AI Agent Engine (IBM Bob-inspired)'],
  ['audit', 'Audit Logger (BobShell)'],
  ['testing', 'Testing Engine (ML-KEM / ML-DSA)'],
];

const time = async (fn) => {
  const t = process.hrtime.bigint();
  try {
    const r = await fn();
    return { ...r, latency: Math.max(0, Math.round(Number(process.hrtime.bigint() - t) / 1e6)) };
  } catch (e) {
    return { status: 'OFFLINE', message: e.message, latency: Math.round(Number(process.hrtime.bigint() - t) / 1e6) };
  }
};

export async function runDiagnostics() {
  const mode = await getMode();
  const checks = {
    frontend: async () => {
      const built = fs.existsSync(config.clientDist);
      return { status: 'ONLINE', message: built ? 'Production build present (served by Express)' : 'Served by the Vite dev server (client/dist not built)', details: { built } };
    },
    backend: async () => ({ status: 'ONLINE', message: `Node ${process.version} · uptime ${Math.round(process.uptime())} s · heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MB`, details: { jwtSecretEphemeral: config.jwtSecretEphemeral } }),
    database: async () => {
      const r = await one('SELECT version() AS v, (SELECT count(*)::int FROM crypto_assets) AS assets');
      return { status: 'ONLINE', message: `${dbEngine()} · ${r.v.split(' ').slice(0, 2).join(' ')} · ${r.assets} assets`, details: { engine: dbEngine() } };
    },
    risk: async () => {
      const m = mosca({ x: 10, y: 2, z: 8 });
      const a = assessAsset({ quantum_status: 'vulnerable', asset_type: 'algorithm' }, { data_lifetime_years: 10, migration_time_years: 2, criticality: 'critical' }, { z: 8 });
      const ok = m.exposed && a.level === 'RED';
      return { status: ok ? 'ONLINE' : 'WARNING', message: ok ? 'Self-test: X=10, Y=2, Z=8 → exposed, RED' : 'Unexpected Mosca result' };
    },
    ast: async () => {
      const r = scanSource('selftest.js', "const c=require('crypto');function s(p,k){const x=c.createSign('RSA-SHA256');x.update(p);return x.sign(k);}");
      const ok = r.assets.some((x) => x.ruleId === 'PQC-RSA-001' && x.functionName === 's');
      return { status: ok ? 'ONLINE' : 'WARNING', message: ok ? `Self-test: parsed ${r.nodes} AST nodes, detected PQC-RSA-001 in s()` : 'Detection self-test failed' };
    },
    cbom: async () => {
      const c = componentFor({ id: 0, asset_type: 'algorithm', algorithm: 'RSA-2048', family: 'RSA', primitive: 'pke', key_size: 2048, file_path: 'x.js', line: 1, quantum_status: 'vulnerable', rule_id: 'PQC-RSA-002', metadata: {} }, null);
      const ok = c.type === 'cryptographic-asset' && c.cryptoProperties?.algorithmProperties?.primitive === 'pke';
      return { status: ok ? 'ONLINE' : 'WARNING', message: ok ? 'Self-test: generated a valid CycloneDX 1.5 cryptographic-asset component' : 'CBOM component malformed' };
    },
    agents: async () => {
      const agents = listAgents();
      const errored = agents.filter((a) => a.status === 'error');
      const granite = mode === 'real' ? (watsonxConfigured() ? 'IBM Granite via watsonx.ai configured' : 'Real mode without watsonx credentials — using template explanations') : 'Demo mode — template explanations (Granite not connected)';
      return { status: errored.length || (mode === 'real' && !watsonxConfigured()) ? 'WARNING' : 'ONLINE', message: `${agents.length} agents registered · ${errored.length} in error · ${granite}`, details: { agents: agents.map((a) => ({ name: a.name, status: a.status })) } };
    },
    audit: async () => {
      const v = await verifyChain();
      return { status: v.valid ? 'ONLINE' : 'WARNING', message: v.valid ? `Hash chain intact · ${v.entries} entries` : `Hash chain broken at entry #${v.brokenAt}` };
    },
    testing: async () => {
      if (!pqcSupported()) return { status: 'WARNING', message: `Node ${process.version} lacks ML-KEM/ML-DSA; interoperability tests will be skipped` };
      const k = crypto.generateKeyPairSync('ml-kem-768');
      const { sharedKey, ciphertext } = crypto.encapsulate(k.publicKey);
      const ok = crypto.decapsulate(k.privateKey, ciphertext).equals(sharedKey);
      return { status: ok ? 'ONLINE' : 'WARNING', message: `Self-test: ML-KEM-768 round-trip ${ok ? 'OK' : 'FAILED'} (OpenSSL ${process.versions.openssl})` };
    },
  };

  const out = [];
  for (const [key, name] of SERVICES) {
    const r = await time(checks[key]);
    const row = { key, name, status: r.status, latency_ms: r.latency, message: r.message, details: r.details || {}, last_check: new Date().toISOString() };
    out.push(row);
    try {
      await query(
        `INSERT INTO system_services (key, name, status, latency_ms, message, details, last_check) VALUES ($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT (key) DO UPDATE SET status = EXCLUDED.status, latency_ms = EXCLUDED.latency_ms, message = EXCLUDED.message, details = EXCLUDED.details, last_check = now()`,
        [key, name, row.status, row.latency_ms, row.message, j(row.details)],
      );
    } catch { /* database itself may be down — still report */ }
  }
  return {
    mode,
    overall: out.some((s) => s.status === 'OFFLINE') ? 'OFFLINE' : out.some((s) => s.status === 'WARNING') ? 'WARNING' : 'ONLINE',
    services: out,
    integrations: integrationsStatus(mode),
    checkedAt: new Date().toISOString(),
  };
}

export function integrationsStatus(mode) {
  return [
    { key: 'ibm-bob', name: 'IBM Bob', status: 'simulated', detail: 'No public IBM Bob API is used. QuantumShift ships a local, Bob-inspired orchestrator (Architect / Code / Ask modes, BobShell-style audit).' },
    { key: 'granite', name: 'IBM Granite (watsonx.ai)', status: watsonxConfigured() ? (mode === 'real' ? 'connected' : 'configured (inactive in demo mode)') : 'not configured', detail: 'Set WATSONX_API_KEY and WATSONX_PROJECT_ID, then switch to Real Integration.' },
    { key: 'github', name: 'GitHub / GitLab', status: mode === 'real' ? 'available (public repos)' : 'simulated', detail: 'Real mode downloads public repository archives (HEAD) and scans them locally. PR creation stays simulated — nothing is pushed.' },
    { key: 'docker', name: 'Docker registry', status: mode === 'real' ? 'not configured' : 'simulated', detail: 'Demo images map to bundled sample source + Dockerfiles.' },
    { key: 'aws', name: 'AWS', status: mode === 'real' ? 'not configured' : 'simulated', detail: 'Demo inventory of KMS keys, ACM certificates and ELB TLS policies (synthetic).' },
    { key: 'pqc', name: 'PQC primitives (OpenSSL)', status: pqcSupported() ? 'available' : 'unavailable', detail: `Node ${process.version}, OpenSSL ${process.versions.openssl} — used for real ML-KEM / ML-DSA tests. liboqs is the reference for generated Python/Go adapters.` },
  ];
}
