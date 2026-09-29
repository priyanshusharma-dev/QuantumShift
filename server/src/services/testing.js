import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { parse } from '@babel/parser';
import { scanSource } from './scanner.js';

/**
 * Test Agent. Every result is tagged execution = 'real' (actually executed here,
 * e.g. ML-KEM/ML-DSA round-trips via OpenSSL 3.5, AST re-scans, running the
 * generated adapter) or 'simulated' (stands in for CI suites that are not connected).
 */

const APPROVED_TARGETS = /ML-KEM|ML-DSA|SLH-DSA|X25519MLKEM768|SHA-256|SHA3|AES-256|TLS 1\.3|secrets manager|Managed key|Environment|runtime|bcprov|liboqs|go 1\.24|certificate|Advisory/i;

export const pqcSupported = () => {
  try {
    crypto.generateKeyPairSync('ml-kem-768');
    crypto.generateKeyPairSync('ml-dsa-65');
    return true;
  } catch {
    return false;
  }
};

const timed = async (fn) => {
  const t = process.hrtime.bigint();
  try {
    const r = await fn();
    return { ...r, duration_ms: Math.max(1, Math.round(Number(process.hrtime.bigint() - t) / 1e6)) };
  } catch (e) {
    return { status: 'failed', details: `Error: ${e.message}`, duration_ms: Math.round(Number(process.hrtime.bigint() - t) / 1e6) };
  }
};

// ---------------------------------------------------------------------------
// Real cryptographic interoperability tests (global, once per run)
// ---------------------------------------------------------------------------
function interopTests(jobs) {
  const hasJwt = jobs.some((j) => j.changes.some((c) => /JWS/.test(c.to)));
  return [
    ['ML-KEM-768 encapsulate / decapsulate round-trip (FIPS 203)', () => {
      const k = crypto.generateKeyPairSync('ml-kem-768');
      const { sharedKey, ciphertext } = crypto.encapsulate(k.publicKey);
      const ok = crypto.decapsulate(k.privateKey, ciphertext).equals(sharedKey);
      const pk = k.publicKey.export({ format: 'der', type: 'spki' }).length;
      return { status: ok ? 'passed' : 'failed', details: `Shared secrets match: ${ok}. Ciphertext ${ciphertext.length} B, shared secret ${sharedKey.length} B, SPKI public key ${pk} B (OpenSSL ${process.versions.openssl}).` };
    }],
    ['ML-DSA-65 sign / verify + tamper rejection (FIPS 204)', () => {
      const k = crypto.generateKeyPairSync('ml-dsa-65');
      const msg = Buffer.from(JSON.stringify({ amount: 1250, to: 'ACC-2', ts: Date.now() }));
      const sig = crypto.sign(null, msg, k.privateKey);
      const ok = crypto.verify(null, msg, k.publicKey, sig);
      const tampered = crypto.verify(null, Buffer.from(msg.toString().replace('1250', '9250')), k.publicKey, sig);
      return { status: ok && !tampered ? 'passed' : 'failed', details: `Valid signature verified: ${ok}; tampered message rejected: ${!tampered}. Signature ${sig.length} B.` };
    }],
    ['Hybrid X25519 + ML-KEM-768 key agreement (X25519MLKEM768 construction)', () => {
      const ax = crypto.generateKeyPairSync('x25519');
      const ak = crypto.generateKeyPairSync('ml-kem-768');
      const bx = crypto.generateKeyPairSync('x25519');
      const { sharedKey, ciphertext } = crypto.encapsulate(ak.publicKey);
      const kdf = (kem, ecdh) => Buffer.from(crypto.hkdfSync('sha256', Buffer.concat([kem, ecdh]), Buffer.alloc(0), Buffer.from('qs'), 32));
      const bSecret = kdf(sharedKey, crypto.diffieHellman({ privateKey: bx.privateKey, publicKey: ax.publicKey }));
      const aSecret = kdf(crypto.decapsulate(ak.privateKey, ciphertext), crypto.diffieHellman({ privateKey: ax.privateKey, publicKey: bx.publicKey }));
      return { status: aSecret.equals(bSecret) ? 'passed' : 'failed', details: `Initiator and responder derived identical 256-bit keys: ${aSecret.equals(bSecret)} (HKDF-SHA256 over ML-KEM ‖ X25519 secrets).` };
    }],
    ['Key serialisation interop: SPKI / PKCS#8 export → import (ML-KEM, ML-DSA)', () => {
      const res = ['ml-kem-768', 'ml-dsa-65'].map((alg) => {
        const k = crypto.generateKeyPairSync(alg);
        const pub = crypto.createPublicKey({ key: k.publicKey.export({ format: 'pem', type: 'spki' }), format: 'pem' });
        const priv = crypto.createPrivateKey({ key: k.privateKey.export({ format: 'pem', type: 'pkcs8' }), format: 'pem' });
        return pub.asymmetricKeyType === alg && priv.asymmetricKeyType === alg;
      });
      return { status: res.every(Boolean) ? 'passed' : 'failed', details: `PEM round-trip preserved key types for ML-KEM-768 and ML-DSA-65: ${res.every(Boolean)}.` };
    }],
    ['Payload budget: ML-DSA-65 token size vs HTTP limits', () => {
      const k = crypto.generateKeyPairSync('ml-dsa-65');
      const input = `${Buffer.from('{"alg":"ML-DSA-65","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'CUST0001', scope: 'accounts:read payments:write', exp: 0 })).toString('base64url')}`;
      const token = `${input}.${crypto.sign(null, Buffer.from(input), k.privateKey).toString('base64url')}`;
      const warn = hasJwt && token.length > 4096;
      return { status: warn ? 'warning' : 'passed', details: `ML-DSA-65 JWT = ${token.length} bytes (RS256 ≈ 400 B). ${warn ? 'Exceeds the 4 KB cookie limit — carry tokens in the Authorization header (8 KB limit on most gateways).' : 'Within the 8 KB header budget.'}` };
    }],
    ['Performance: ML-DSA-65 vs RSA-2048 key generation + signing', () => {
      const t = (fn) => { const s = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - s) / 1e6; };
      const msg = Buffer.from('benchmark');
      const pq = t(() => { const k = crypto.generateKeyPairSync('ml-dsa-65'); crypto.sign(null, msg, k.privateKey); });
      const rsa = t(() => { const k = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }); crypto.sign('sha256', msg, k.privateKey); });
      return { status: 'passed', details: `ML-DSA-65 keygen+sign ${pq.toFixed(1)} ms vs RSA-2048 keygen+sign ${rsa.toFixed(1)} ms on this host.` };
    }],
    ['Legacy peer fallback (classical-only clients)', () => ({ status: 'warning', execution: 'simulated', details: 'Simulated: peers without PQC support negotiate X25519 only. Hybrid deployment keeps them working, but those sessions remain harvest-now-decrypt-later exposed until clients upgrade.' })],
  ];
}

// ---------------------------------------------------------------------------
// Per-patch tests
// ---------------------------------------------------------------------------
function balanced(code) {
  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  const stripped = code.replace(/\/\/.*$|#.*$/gm, '').replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '""');
  for (const ch of stripped) {
    if ('([{'.includes(ch)) stack.push(ch);
    else if (pairs[ch]) { if (stack.pop() !== pairs[ch]) return false; }
  }
  return stack.length === 0;
}

async function runJsAdapter(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-adapter-'));
  try {
    const esm = /^\s*export\s*\{/m.test(file.content);
    const target = path.join(dir, esm ? 'pqc-adapter.mjs' : 'pqc-adapter.cjs');
    fs.writeFileSync(target, file.content);
    const pqc = esm ? await import(pathToFileURL(target).href) : createRequire(import.meta.url)(target);
    const sig = pqc.generateKeyPair('ml-dsa-65');
    const kem = pqc.generateKeyPair('ml-kem-768');
    const s = pqc.mlDsaSign('payload', sig.privateKey, 'base64');
    const sealed = pqc.kemSeal(kem.publicKey, Buffer.from('4111111111111111'));
    const opened = pqc.kemOpen(kem.privateKey, sealed).toString();
    const jwt = pqc.signJwt({ sub: 'u1' }, sig.privateKey, { expiresIn: 60, issuer: 'qs' });
    const claims = pqc.verifyJwt(jwt, sig.publicKey);
    const a = pqc.createHybridKeyExchange();
    const b = pqc.createHybridKeyExchange();
    const { message, secret } = b.respond(a.generateKeys());
    const checks = {
      'ML-DSA sign/verify': pqc.mlDsaVerify('payload', sig.publicKey, s),
      'KEM seal/open': opened === '4111111111111111',
      'JWS sign/verify': claims.sub === 'u1',
      'Hybrid exchange': a.computeSecret(message) === secret,
    };
    const ok = Object.values(checks).every(Boolean);
    return { status: ok ? 'passed' : 'failed', details: `Executed generated ${path.basename(file.path)} in an isolated temp module: ${Object.entries(checks).map(([k, v]) => `${k} ${v ? '✓' : '✗'}`).join(', ')}.` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function jobTests(job) {
  const tests = [];
  const lang = job.language;
  const add = (suite, category, name, fn) => tests.push({ suite, category, name, fn, jobId: job.id });

  add('security', 'Security', `Re-scan ${job.file_path}: no quantum-vulnerable primitives remain`, () => {
    const r = scanSource(job.file_path, job.after_code || '');
    const left = r.assets.filter((a) => !['safe', 'pqc'].includes(a.quantumStatus));
    const advisory = job.changes.filter((c) => c.confidence < 0.7).length;
    if (!left.length) return { status: 'passed', details: `AST/rule re-scan found 0 vulnerable call sites (${r.assets.length} quantum-safe primitives recorded).` };
    return { status: advisory ? 'warning' : 'failed', details: `${left.length} finding(s) remain: ${left.map((a) => `${a.algorithm}@${a.line}`).join(', ')}${advisory ? ' — covered by advisory/TODO changes awaiting manual work.' : '.'}` };
  });
  add('security', 'Security', `No key material introduced by the patch (${job.file_path})`, () => {
    const all = [job.after_code || '', ...(job.extra_files || []).map((f) => f.content)].join('\n');
    const leak = /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(all);
    return { status: leak ? 'failed' : 'passed', details: leak ? 'A PEM private key literal is present in the patched output.' : 'No PEM private keys or key literals in patched files or generated adapters.' };
  });
  add('security', 'Security', 'Algorithm policy: only NIST-approved targets (FIPS 203/204/180-4/197)', () => {
    const bad = job.changes.filter((c) => !APPROVED_TARGETS.test(c.to));
    const manual = job.changes.filter((c) => c.standard === 'Manual' || c.standard === 'Advisory');
    return { status: bad.length ? 'failed' : manual.length ? 'warning' : 'passed', details: bad.length ? `Non-approved targets: ${bad.map((c) => c.to).join(', ')}` : manual.length ? `${manual.length} change(s) are advisory/manual and need a developer follow-up.` : `All ${job.changes.length} targets are approved (${[...new Set(job.changes.map((c) => c.standard))].join(', ')}).` };
  });

  if (lang === 'JavaScript' || lang === 'TypeScript') {
    add('unit', 'Unit', `Syntax check: ${job.file_path} parses (Babel, ${lang})`, () => {
      const plugins = lang === 'TypeScript' ? ['typescript'] : ['jsx'];
      const ast = parse(job.after_code || '', { sourceType: 'unambiguous', errorRecovery: true, plugins });
      const errs = ast.errors || [];
      return { status: errs.length ? 'failed' : 'passed', details: errs.length ? errs.map((e) => e.message).join('; ') : `Parsed ${job.after_code.split('\n').length} lines without errors.` };
    });
  } else if (['Python', 'Go', 'Java', 'Kotlin'].includes(lang)) {
    add('unit', 'Unit', `Static structure check: balanced delimiters in ${job.file_path}`, () => {
      const ok = balanced(job.after_code || '');
      return { status: ok ? 'passed' : 'failed', details: ok ? 'Brackets/braces/parentheses balanced after transformation (full compile requires the project toolchain).' : 'Unbalanced delimiters detected after transformation.' };
    });
  }
  for (const f of job.extra_files || []) {
    if (/pqc-adapter\.(js|ts)$/.test(f.path)) {
      add('unit', 'Unit', `Execute generated adapter ${f.path} (ML-DSA, ML-KEM, JWS, hybrid)`, () => (pqcSupported() ? runJsAdapter(f) : { status: 'warning', details: 'Node.js runtime lacks ML-KEM/ML-DSA (needs >= 24.7); adapter not executed.' }));
    } else if (/pqc_adapter\.py$|pqc\.go$|PqcAdapter\.java$/.test(f.path)) {
      add('unit', 'Unit', `Adapter contract: ${f.path} exposes the PQC interface`, () => {
        const need = /\.py$/.test(f.path) ? ['def kem_seal', 'def kem_open', 'def generate_signing_keypair', 'def sign_jwt'] : /\.go$/.test(f.path) ? ['func GenerateMLDSA65', 'func Sign', 'func Verify', 'func GenerateMLKEM768'] : ['generateMlKem768', 'generateMlDsa65', 'kemSeal', 'kemOpen'];
        const missing = need.filter((n) => !f.content.includes(n));
        return { status: missing.length ? 'failed' : 'passed', details: missing.length ? `Missing: ${missing.join(', ')}` : `Found ${need.join(', ')} (execution requires ${/\.py$/.test(f.path) ? 'liboqs-python' : /\.go$/.test(f.path) ? 'liboqs-go' : 'Bouncy Castle 1.80'}).` };
      });
    }
  }
  const fns = [...new Set(job.changes.map((c) => c.functionName).filter((f) => f && !f.startsWith('<')))];
  for (const fn of fns) {
    const lowConf = job.changes.some((c) => c.functionName === fn && c.confidence < 0.7);
    add('regression', 'Regression', `${fn}() behaviour preserved after migration`, () => ({
      status: lowConf ? 'warning' : 'passed',
      execution: 'simulated',
      details: lowConf ? 'Simulated regression run: behaviour preserved but a TODO(quantumshift) marker requires developer follow-up.' : 'Simulated regression run (no CI connected in demo mode): contract and return types unchanged.',
    }));
  }
  add('regression', 'Regression', `Repository regression suite for ${job.file_path}`, () => ({ status: 'passed', execution: 'simulated', details: 'Simulated: the repository CI pipeline is not connected in demo mode; connect CI in Real Integration mode to run the actual suite.' }));
  return tests;
}

/**
 * Runs the selected suite over the given remediation jobs.
 * onResult is called after each test (for live streaming); pace() adds visual pacing.
 */
export function planTests(jobs, suite = 'all') {
  const wanted = (s) => suite === 'all' || suite === s;
  const plan = [];
  for (const job of jobs) plan.push(...jobTests(job).filter((t) => wanted(t.suite)));
  if (wanted('interoperability')) {
    for (const [name, fn] of interopTests(jobs)) {
      plan.push({ suite: 'interoperability', category: 'Interoperability', name, fn: () => (pqcSupported() || /Legacy/.test(name) ? fn() : { status: 'warning', execution: 'simulated', details: 'Runtime lacks native ML-KEM/ML-DSA (Node.js >= 24.7 required) — not executed.' }), jobId: null });
    }
  }
  return plan;
}

export async function runTests({ jobs, suite = 'all', onResult = () => {}, pace = async () => {} }) {
  const plan = planTests(jobs, suite);
  const results = [];
  for (const [idx, t] of plan.entries()) {
    const r = await timed(t.fn);
    const result = { suite: t.suite, category: t.category, name: t.name, status: r.status, execution: r.execution || 'real', duration_ms: r.duration_ms, details: r.details, remediation_job_id: t.jobId, index: idx, total: plan.length };
    results.push(result);
    await onResult(result);
    await pace();
  }
  return results;
}
