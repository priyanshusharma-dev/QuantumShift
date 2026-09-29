import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { detectLanguage } from './scanner.js';
import { jsAdapter, pythonAdapter, goAdapter, javaAdapter } from './adapters.js';

/**
 * Code Refactoring Agent ("Code Mode").
 * Applies deterministic, reviewable source transformations that migrate
 * quantum-vulnerable call sites to ML-KEM / ML-DSA (via a generated liboqs-style
 * adapter) or to quantum-resistant symmetric/hash primitives.
 * Nothing is written to any repository: the output is a patch for human review.
 */

const indentOf = (s) => (s || '').match(/^\s*/)[0];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function replaceRange(lines, start, end, newLines) {
  lines.splice(start, end - start + 1, ...newLines);
}

/** Split a call's argument text on top-level commas. */
function splitArgs(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (const ch of text) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Index of the line where the statement starting at `start` ends (balanced brackets). */
function stmtEnd(lines, start) {
  let depth = 0;
  let seen = false;
  for (let i = start; i < Math.min(lines.length, start + 40); i++) {
    const l = lines[i].replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
    for (const ch of l) {
      if ('([{'.includes(ch)) { depth++; seen = true; }
      else if (')]}'.includes(ch)) depth--;
    }
    if (seen && depth <= 0) return i;
  }
  return start;
}

/** Replaces the first call matching `calleeRe` (balanced parens) using fn(argsText). */
function replaceCall(text, calleeRe, fn) {
  const m = calleeRe.exec(text);
  if (!m) return text;
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let k = open; k < text.length; k++) {
    if (text[k] === '(') depth++;
    else if (text[k] === ')' && --depth === 0) {
      return text.slice(0, m.index) + fn(text.slice(open + 1, k)) + text.slice(k + 1);
    }
  }
  return text;
}

const change = (a, to, rationale, confidence, standard) => ({ ruleId: a.rule_id, from: a.algorithm, to, rationale, confidence, standard });

// ---------------------------------------------------------------------------
// JavaScript / TypeScript
// ---------------------------------------------------------------------------
function jsTransform(ctx, a) {
  const L = ctx.lines;
  const i = a.line - 1;
  const line = L[i] ?? '';
  const ind = indentOf(line);
  const note = (to) => `${ind}// QuantumShift (${a.rule_id}): ${a.algorithm} → ${to}`;

  switch (a.rule_id) {
    case 'PQC-RSA-001':
    case 'PQC-ECC-001': {
      const m = line.match(/^(\s*)(?:const|let|var)\s+(\w+)\s*=\s*[\w.]*create(Sign|Verify)\([^)]*\);?\s*$/);
      if (!m) break;
      const v = m[2];
      const isSign = m[3] === 'Sign';
      let data = null;
      let fin = null;
      let finIdx = -1;
      for (let j = i + 1; j < Math.min(L.length, i + 8); j++) {
        const u = L[j].match(new RegExp(`^\\s*${v}\\.update\\((.+)\\);?\\s*$`));
        if (u && !data) { data = u[1]; continue; }
        const f = L[j].match(new RegExp(`^(\\s*)(return\\s+|(?:const|let|var)\\s+\\w+\\s*=\\s*)?${v}\\.(?:sign|verify)\\((.+)\\);?\\s*$`));
        if (f) { fin = f; finIdx = j; break; }
      }
      if (!data || !fin) break;
      const args = splitArgs(fin[3]);
      const prefix = fin[2] || '';
      const call = isSign ? `pqc.mlDsaSign(${data}, ${args.join(', ')})` : `pqc.mlDsaVerify(${data}, ${args.join(', ')})`;
      replaceRange(L, i, finIdx, [note('ML-DSA-65 (FIPS 204)'), `${ind}${prefix}${call};`]);
      ctx.adapter = true;
      return change(a, 'ML-DSA-65', `create${m[3]} → update → ${isSign ? 'sign' : 'verify'} sequence collapsed into one ML-DSA-65 ${isSign ? 'signature' : 'verification'} via the PQC adapter (node:crypto, OpenSSL 3.5). Callers must supply ML-DSA keys.`, 0.92, 'FIPS 204');
    }
    case 'PQC-RSA-002':
    case 'PQC-ECC-002': {
      const end = stmtEnd(L, i);
      const text = L.slice(i, end + 1).join('\n');
      const alg = a.primitive === 'pke' || a.family === 'ECDH' ? 'ml-kem-768' : 'ml-dsa-65';
      const out = replaceCall(text, /(?:[\w.]+\.)?generateKeyPairSync\(/, () => `pqc.generateKeyPair('${alg}')`);
      if (out === text) break;
      replaceRange(L, i, end, [note(`${alg.toUpperCase()} (${alg.startsWith('ml-kem') ? 'FIPS 203' : 'FIPS 204'})`), ...out.split('\n')]);
      ctx.adapter = true;
      return change(a, alg.toUpperCase(), `Key generation switched from ${a.algorithm} to ${alg.toUpperCase()}; key objects keep the same { publicKey, privateKey } shape.`, 0.9, alg.startsWith('ml-kem') ? 'FIPS 203' : 'FIPS 204');
    }
    case 'PQC-RSA-003': {
      let out = line.replace(/(?:[\w.]+\.)?publicEncrypt\(/, 'pqc.kemSeal(').replace(/(?:[\w.]+\.)?privateDecrypt\(/, 'pqc.kemOpen(');
      if (out === line) break;
      replaceRange(L, i, i, [note('ML-KEM-768 + AES-256-GCM (FIPS 203)'), out]);
      ctx.adapter = true;
      return change(a, 'ML-KEM-768 + AES-256-GCM', 'RSA-OAEP key transport replaced by ML-KEM-768 encapsulation; the shared secret is expanded with HKDF-SHA256 into an AES-256-GCM key (KEM-DEM). Ciphertext format changes — re-tokenise stored values.', 0.85, 'FIPS 203');
    }
    case 'PQC-ECC-003':
    case 'PQC-DH-001': {
      const out = replaceCall(line, /(?:[\w.]+\.)?create(?:ECDH|DiffieHellman(?:Group)?)\(/, () => 'pqc.createHybridKeyExchange()');
      if (out === line) break;
      replaceRange(L, i, i, [note('X25519MLKEM768 hybrid'), out]);
      ctx.adapter = true;
      return change(a, 'X25519 + ML-KEM-768 hybrid', 'Key agreement replaced by the hybrid X25519MLKEM768 construction. KEM exchanges are asymmetric: the responder must call respond(); review the handshake protocol with the mobile team.', 0.72, 'FIPS 203 + IETF hybrid');
    }
    case 'PQC-HASH-001':
    case 'PQC-HASH-002': {
      const out = line
        .replace(/create(Hash|Hmac)\(\s*(['"])(sha-?1|md5)\2/i, "create$1('sha256'")
        .replace(/CryptoJS\.(SHA1|MD5)\(/, 'CryptoJS.SHA256(')
        .replace(/CryptoJS\.Hmac(SHA1|MD5)\(/, 'CryptoJS.HmacSHA256(');
      if (out === line) break;
      replaceRange(L, i, i, [note('SHA-256'), out]);
      return change(a, 'SHA-256', `${a.algorithm} replaced by SHA-256. ${ctx.persisted ? 'Stored digests must be recomputed.' : 'If these digests are persisted, keep dual values during migration.'}`, 0.95, 'FIPS 180-4');
    }
    case 'PQC-SYM-001':
    case 'PQC-SYM-002': {
      const out = line.replace(/create(Cipheriv|Decipheriv|Cipher)\(\s*(['"])[\w-]+\2/, "create$1('aes-256-gcm'");
      if (out === line) break;
      replaceRange(L, i, i, [note('AES-256-GCM'), `${ind}// TODO(quantumshift): use a 32-byte key and persist cipher.getAuthTag()`, out]);
      return change(a, 'AES-256-GCM', 'Cipher replaced by AES-256-GCM; requires 32-byte keys and auth-tag handling.', 0.6, 'FIPS 197 / SP 800-38D');
    }
    case 'PQC-JWT-001': {
      const end = stmtEnd(L, i);
      let text = L.slice(i, end + 1).join('\n');
      if (!/jwt\.sign\(/.test(text)) break;
      text = replaceCall(text, /(?:jwt|jsonwebtoken)\.sign\(/, (args) => {
        const cleaned = args
          .replace(/\n\s*algorithm:\s*['"]\w+['"],?[ \t]*(?=\n)/, '')
          .replace(/algorithm:\s*['"]\w+['"],\s*/, '')
          .replace(/,\s*algorithm:\s*['"]\w+['"]/, '');
        return `pqc.signJwt(${cleaned})`;
      });
      replaceRange(L, i, end, [note('ML-DSA-65 JWS'), ...text.split('\n')]);
      ctx.adapter = true;
      return change(a, 'ML-DSA-65 JWS', 'Token signing moved to ML-DSA-65 (alg "ML-DSA-65", IETF draft-ietf-cose-dilithium). Verifiers must use pqc.verifyJwt(); expect ~4.4 KB tokens.', 0.8, 'FIPS 204 (draft JOSE)');
    }
    case 'PQC-KEY-001': {
      const m = line.match(/^(\s*)(const|let|var)\s+(\w+)\s*=/);
      if (!m) break;
      let end = i;
      while (end < L.length - 1 && !/-----END [A-Z ]*PRIVATE KEY-----/.test(L[end])) end++;
      replaceRange(L, i, end, [
        `${ind}// QuantumShift (PQC-KEY-001): private key removed from source — load from HSM/KMS-mounted secret (${m[3]}_FILE).`,
        `${ind}// Rotate this key: the literal remains in git history. Re-issue as ML-DSA-65.`,
        `${ind}${m[2]} ${m[3]} = pqc.loadManagedKey('${m[3]}');`,
      ]);
      ctx.adapter = true;
      return change(a, 'Managed key reference', 'Hardcoded PEM literal removed; the key is loaded from a secrets-manager/HSM-mounted file. The exposed key must be rotated.', 0.93, 'NIST SP 800-57');
    }
    case 'PQC-KEY-002': {
      const m = line.match(/^(\s*)(const|let|var)\s+(\w+)\s*=\s*(['"`]).*\4;?\s*$/);
      if (!m) break;
      replaceRange(L, i, i, [`${ind}// QuantumShift (PQC-KEY-002): secret moved to the secrets manager — rotate the exposed value.`, `${ind}${m[2]} ${m[3]} = process.env.${m[3]};`]);
      return change(a, 'Environment / secrets manager', 'Static secret replaced by an environment reference populated from the secrets manager.', 0.95, 'CWE-798');
    }
    case 'PQC-TLS-001': {
      const out = line.replace(/ecdhCurve:\s*(['"])[^'"]+\1/, "ecdhCurve: 'X25519MLKEM768:X25519'");
      if (out === line) break;
      replaceRange(L, i, i, [note('X25519MLKEM768'), out]);
      return change(a, 'X25519MLKEM768', 'TLS groups now prefer the hybrid post-quantum group (OpenSSL 3.5).', 0.93, 'IETF hybrid');
    }
    default:
  }
  return null;
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------
function pyTransform(ctx, a) {
  const L = ctx.lines;
  const i = a.line - 1;
  const line = L[i] ?? '';
  const ind = indentOf(line);
  const note = (to) => `${ind}# QuantumShift (${a.rule_id}): ${a.algorithm} → ${to}`;
  switch (a.rule_id) {
    case 'PQC-RSA-002': {
      const m = line.match(/^(\s*)(\w+)\s*=\s*rsa\.generate_private_key\(/);
      if (!m) break;
      const end = stmtEnd(L, i);
      const kem = a.primitive === 'pke';
      replaceRange(L, i, end, [note(kem ? 'ML-KEM-768 (liboqs)' : 'ML-DSA-65 (liboqs)'), `${ind}${m[2]} = pqc.${kem ? 'generate_kem_keypair' : 'generate_signing_keypair'}()`]);
      ctx.adapter = true;
      return change(a, kem ? 'ML-KEM-768' : 'ML-DSA-65', `RSA key generation replaced by ${kem ? 'an ML-KEM-768' : 'an ML-DSA-65'} key pair from liboqs-python; public_key() is preserved.`, 0.88, kem ? 'FIPS 203' : 'FIPS 204');
    }
    case 'PQC-RSA-003': {
      let start = i;
      for (let k = i; k >= Math.max(0, i - 4); k--) if (/\.encrypt\(/.test(L[k])) { start = k; break; }
      const m = L[start].match(/^(\s*)(return\s+|\w+\s*=\s*)?(\w+)\.encrypt\((.*)$/);
      if (!m) break;
      const end = stmtEnd(L, start);
      const args = splitArgs(L.slice(start, end + 1).join('\n').replace(/^[\s\S]*?\.encrypt\(/, '').replace(/\)\s*$/, ''));
      const sInd = m[1];
      replaceRange(L, start, end, [`${sInd}# QuantumShift (PQC-RSA-003): RSA-OAEP → ML-KEM-768 + AES-256-GCM (FIPS 203)`, `${sInd}${m[2] || ''}pqc.kem_seal(${m[3]}, ${args[0]})`]);
      ctx.adapter = true;
      return change(a, 'ML-KEM-768 + AES-256-GCM', 'RSA-OAEP data-key wrapping replaced by ML-KEM-768 encapsulation + AES-256-GCM (KEM-DEM).', 0.84, 'FIPS 203');
    }
    case 'PQC-ECC-002': {
      const out = replaceCall(line, /ec\.generate_private_key\(/, () => 'pqc.generate_signing_keypair()');
      if (out === line) break;
      replaceRange(L, i, i, [note('ML-DSA-65 (liboqs)'), out]);
      ctx.adapter = true;
      return change(a, 'ML-DSA-65', 'EC P-256 signing key replaced by an ML-DSA-65 key from liboqs-python.', 0.88, 'FIPS 204');
    }
    case 'PQC-JWT-001': {
      const out = replaceCall(line, /jwt\.encode\(/, (args) => {
        const p = splitArgs(args).filter((x) => !/^algorithm\s*=/.test(x));
        return `pqc.sign_jwt(${p.join(', ')})`;
      });
      if (out === line) break;
      replaceRange(L, i, i, [note('ML-DSA-65 JWS'), out]);
      ctx.adapter = true;
      return change(a, 'ML-DSA-65 JWS', 'JWT ES256 replaced by an ML-DSA-65 compact JWS (draft JOSE).', 0.8, 'FIPS 204');
    }
    case 'PQC-HASH-001':
    case 'PQC-HASH-002': {
      const out = line.replace(/hashlib\.(sha1|md5)\(/, 'hashlib.sha256(').replace(/hashlib\.new\(\s*(['"])(sha1|md5)\1/, "hashlib.new('sha256'");
      if (out === line) break;
      replaceRange(L, i, i, [note('SHA-256'), out]);
      return change(a, 'SHA-256', `${a.algorithm} replaced by SHA-256; archived digests should be recomputed or dual-stored.`, 0.95, 'FIPS 180-4');
    }
    case 'PQC-SYM-002': {
      const out = line.replace(/AES\.MODE_(CBC|ECB|CFB|OFB|CTR)/, 'AES.MODE_GCM');
      ctx.lines = ctx.lines.map((l) => l.replace(/get_random_bytes\(16\)/, 'get_random_bytes(32)').replace(/cipher\.iv\b/, 'cipher.nonce'));
      ctx.lines[i] = out;
      ctx.lines.splice(i, 0, note('AES-256-GCM'), `${ind}# TODO(quantumshift): persist cipher.digest() (GCM tag) with the ciphertext; padding is no longer required`);
      return change(a, 'AES-256-GCM', '128-bit data keys raised to 256-bit and CBC replaced by authenticated GCM.', 0.66, 'FIPS 197 / SP 800-38D');
    }
    default:
  }
  return null;
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------
function goTransform(ctx, a) {
  const L = ctx.lines;
  const i = a.line - 1;
  const line = L[i] ?? '';
  const ind = indentOf(line);
  const note = (to) => `${ind}// QuantumShift (${a.rule_id}): ${a.algorithm} → ${to}`;
  switch (a.rule_id) {
    case 'PQC-ECC-002':
    case 'PQC-RSA-002': {
      const out = replaceCall(line, /(?:ecdsa|rsa)\.GenerateKey\(/, () => 'pqc.GenerateMLDSA65()');
      if (out === line) break;
      replaceRange(L, i, i, [note('ML-DSA-65 (liboqs-go)'), out]);
      ctx.lines = ctx.lines.map((l) => l.replace(/\*(ecdsa|rsa)\.PrivateKey/g, '*pqc.SigningKey'));
      ctx.adapter = true;
      const tls = a.rule_id === 'PQC-RSA-002';
      return change(a, 'ML-DSA-65', tls
        ? 'RSA server key replaced by ML-DSA-65. NOTE: ML-DSA TLS certificates need a PQC-capable TLS stack/CA; until then keep the RSA certificate and rely on hybrid key exchange (Phase 3).'
        : 'ECDSA P-256 assertion key replaced by an ML-DSA-65 key (liboqs-go).', tls ? 0.55 : 0.87, 'FIPS 204');
    }
    case 'PQC-ECC-001': {
      const out = replaceCall(line, /ecdsa\.SignASN1\(/, (args) => {
        const p = splitArgs(args);
        return `pqc.Sign(${p.slice(1).join(', ')})`;
      });
      if (out === line) break;
      replaceRange(L, i, i, [note('ML-DSA-65'), out]);
      ctx.adapter = true;
      return change(a, 'ML-DSA-65', 'ECDSA signing replaced by ML-DSA-65 via liboqs-go (randomness handled internally).', 0.86, 'FIPS 204');
    }
    case 'PQC-TLS-001': {
      const out = line.replace(/CurvePreferences:\s*\[\]tls\.CurveID\{[^}]*\}/, 'CurvePreferences: []tls.CurveID{tls.X25519MLKEM768, tls.X25519}');
      if (out === line) break;
      replaceRange(L, i, i, [note('X25519MLKEM768 hybrid (Go 1.24+)'), out]);
      ctx.goToolchain = true;
      return change(a, 'X25519MLKEM768', 'TLS key exchange now prefers the hybrid X25519MLKEM768 group (crypto/tls, Go 1.24+) with X25519 fallback.', 0.97, 'FIPS 203 + IETF hybrid');
    }
    case 'PQC-HASH-001':
    case 'PQC-HASH-002': {
      const out = line.replace(/\b(sha1|md5)\.New\(\)/, 'sha256.New()').replace(/\b(sha1|md5)\.Sum\(/, 'sha256.Sum256(');
      if (out === line) break;
      replaceRange(L, i, i, [note('SHA-256'), out]);
      ctx.goImportsAdd.add('crypto/sha256');
      return change(a, 'SHA-256', `${a.algorithm} fingerprint replaced by SHA-256; re-fingerprint archived documents.`, 0.95, 'FIPS 180-4');
    }
    default:
  }
  return null;
}

// ---------------------------------------------------------------------------
// Java
// ---------------------------------------------------------------------------
function javaTransform(ctx, a) {
  const L = ctx.lines;
  const i = a.line - 1;
  const line = L[i] ?? '';
  const ind = indentOf(line);
  const note = (to) => `${ind}// QuantumShift (${a.rule_id}): ${a.algorithm} → ${to}`;
  switch (a.rule_id) {
    case 'PQC-RSA-002':
    case 'PQC-ECC-002': {
      const m = line.match(/KeyPairGenerator\s+(\w+)\s*=\s*KeyPairGenerator\.getInstance\(/);
      if (!m) break;
      const v = m[1];
      let end = -1;
      for (let j = i + 1; j < Math.min(L.length, i + 5); j++) if (new RegExp(`return\\s+${v}\\.generateKeyPair\\(\\)`).test(L[j])) { end = j; break; }
      if (end < 0) break;
      const kem = a.primitive === 'pke';
      replaceRange(L, i, end, [note(kem ? 'ML-KEM-768 (Bouncy Castle)' : 'ML-DSA-65 (Bouncy Castle)'), `${ind}return PqcAdapter.${kem ? 'generateMlKem768' : 'generateMlDsa65'}();`]);
      ctx.adapter = true;
      return change(a, kem ? 'ML-KEM-768' : 'ML-DSA-65', `${a.algorithm} key-pair generation replaced by ${kem ? 'ML-KEM-768' : 'ML-DSA-65'} (Bouncy Castle 1.80).`, 0.9, kem ? 'FIPS 203' : 'FIPS 204');
    }
    case 'PQC-RSA-003': {
      const m = line.match(/Cipher\s+(\w+)\s*=\s*Cipher\.getInstance\(\s*"RSA/);
      if (!m) break;
      const v = m[1];
      let key = null;
      let end = -1;
      let data = null;
      for (let j = i + 1; j < Math.min(L.length, i + 5); j++) {
        const k = L[j].match(new RegExp(`${v}\\.init\\(\\s*Cipher\\.ENCRYPT_MODE\\s*,\\s*(\\w+)`));
        if (k) key = k[1];
        const d = L[j].match(new RegExp(`return\\s+${v}\\.doFinal\\((.+)\\);`));
        if (d) { data = d[1]; end = j; break; }
      }
      if (!key || end < 0) break;
      replaceRange(L, i, end, [note('ML-KEM-768 + AES-256-GCM'), `${ind}return PqcAdapter.kemSeal(${key}, ${data});`]);
      ctx.adapter = true;
      return change(a, 'ML-KEM-768 + AES-256-GCM', 'RSA/ECB/PKCS1 key wrapping replaced by ML-KEM-768 encapsulation + AES-256-GCM. Callers must provide ML-KEM public keys.', 0.86, 'FIPS 203');
    }
    case 'PQC-RSA-001':
    case 'PQC-ECC-001': {
      const out = line.replace(/Signature\.getInstance\(\s*"[\w/]+"\s*\)/, 'Signature.getInstance("ML-DSA", PqcAdapter.provider())');
      if (out === line) break;
      replaceRange(L, i, i, [note('ML-DSA (Bouncy Castle)'), out]);
      ctx.adapter = true;
      return change(a, 'ML-DSA-65', 'JCA signature algorithm switched to ML-DSA (Bouncy Castle). Signing keys must be ML-DSA-65 (see generateSigningKey).', 0.88, 'FIPS 204');
    }
    case 'PQC-SYM-001': {
      const out = line.replace(/Cipher\.getInstance\(\s*"DES(?:ede)?\/[^"]*"\s*\)/, 'Cipher.getInstance("AES/GCM/NoPadding")');
      if (out === line) break;
      replaceRange(L, i, i, [note('AES-256-GCM'), `${ind}// TODO(quantumshift): initialise with a 32-byte key and new GCMParameterSpec(128, iv)`, out]);
      for (let j = i + 2; j < Math.min(L.length, i + 5); j++) L[j] = L[j].replace(/"DESede"/, '"AES"');
      return change(a, 'AES-256-GCM', '3DES (64-bit block, withdrawn) replaced by AES-256-GCM; key size and IV handling need review.', 0.62, 'FIPS 197 / SP 800-38D');
    }
    case 'PQC-HASH-001':
    case 'PQC-HASH-002': {
      const out = line.replace(/MessageDigest\.getInstance\(\s*"(SHA-?1|MD5)"\s*\)/i, 'MessageDigest.getInstance("SHA-256")');
      if (out === line) break;
      const pw = /password/i.test(a.function_name || '');
      replaceRange(L, i, i, [note('SHA-256'), ...(pw ? [`${ind}// TODO(quantumshift): passwords need a slow KDF (PBKDF2/Argon2), not a bare hash`] : []), out]);
      return change(a, 'SHA-256', pw ? 'SHA-1 replaced by SHA-256; password storage should additionally move to PBKDF2/Argon2.' : `${a.algorithm} replaced by SHA-256.`, pw ? 0.75 : 0.95, 'FIPS 180-4');
    }
    case 'PQC-KEY-002': {
      const out = line.replace(/=\s*"[^"]*"\s*;/, (s) => `= System.getenv("${(line.match(/String\s+(\w+)/) || [])[1] || 'SECRET'}");`);
      if (out === line) break;
      replaceRange(L, i, i, [`${ind}// QuantumShift (PQC-KEY-002): secret moved to the secrets manager — rotate the exposed value.`, out]);
      return change(a, 'Environment / secrets manager', 'Hardcoded key string replaced by an environment reference.', 0.95, 'CWE-798');
    }
    default:
  }
  return null;
}

// ---------------------------------------------------------------------------
// Config, Dockerfile and manifests
// ---------------------------------------------------------------------------
function configTransform(ctx, a) {
  const L = ctx.lines;
  const i = (a.line || 1) - 1;
  const line = L[i] ?? '';
  const base = path.basename(ctx.file);
  const note = (to) => `${indentOf(line)}# QuantumShift (${a.rule_id}): ${a.algorithm} → ${to}`;
  const edit = (out, to, rationale, conf, std) => {
    if (out === line) return null;
    replaceRange(L, i, i, [note(to), out]);
    return change(a, to, rationale, conf, std);
  };

  if (ctx.language === 'Dockerfile') {
    if (a.rule_id === 'PQC-LIB-001') {
      const out = line
        .replace(/FROM\s+node:[\w.-]+/i, 'FROM node:24-bookworm-slim')
        .replace(/FROM\s+python:[\w.-]+/i, 'FROM python:3.13-slim')
        .replace(/FROM\s+golang:[\w.]+(-alpine)?/i, (m, al) => `FROM golang:1.24${al || ''}`)
        .replace(/FROM\s+(openjdk|eclipse-temurin):[\w.-]+/i, 'FROM eclipse-temurin:24-jdk');
      return edit(out, 'PQC-capable runtime', 'Base image upgraded to a runtime with native ML-KEM/ML-DSA (OpenSSL 3.5 / Go 1.24 / JDK 24).', 0.85, 'Runtime upgrade');
    }
    if (a.rule_id === 'PQC-CERT-001') {
      return edit(line.replace(/-newkey\s+(rsa|ec):?\d*/i, '-newkey ML-DSA-65').replace(/-pkeyopt\s+ec_paramgen_curve:\S+\s*/i, ''), 'ML-DSA-65 certificate', 'Build-time certificate generated with ML-DSA-65 (OpenSSL 3.5 `-newkey ML-DSA-65`).', 0.82, 'FIPS 204');
    }
  }
  if (base === 'pom.xml' && a.rule_id === 'PQC-LIB-001') {
    const j = L.findIndex((l) => /<artifactId>bcprov-jdk15on<\/artifactId>|<artifactId>bcprov-jdk18on<\/artifactId>/.test(l));
    if (j < 0) return null;
    L[j] = L[j].replace(/bcprov-jdk1[58]on/, 'bcprov-jdk18on');
    if (/<version>/.test(L[j + 1] || '')) L[j + 1] = L[j + 1].replace(/<version>[\w.]+<\/version>/, '<version>1.80</version>');
    L.splice(j, 0, `${indentOf(L[j])}<!-- QuantumShift (PQC-LIB-001): Bouncy Castle 1.80 adds FIPS 203/204 ML-KEM / ML-DSA -->`);
    return change(a, 'bcprov-jdk18on 1.80', 'Bouncy Castle upgraded to 1.80 (ML-KEM / ML-DSA, required by PqcAdapter.java).', 0.9, 'Dependency upgrade');
  }
  if (base === 'requirements.txt' && a.rule_id === 'PQC-LIB-001') {
    if (ctx.pyReqDone) return change(a, 'liboqs-python', 'Covered by the liboqs-python addition in this file.', 0.9, 'Dependency upgrade');
    ctx.pyReqDone = true;
    const out = L.map((l) => l.replace(/^cryptography==[\d.]+/, 'cryptography==44.0.0'));
    out.push('# QuantumShift (PQC-LIB-001): Open Quantum Safe bindings for ML-KEM / ML-DSA', 'liboqs-python==0.12.0');
    ctx.lines = out;
    return change(a, 'liboqs-python 0.12 + cryptography 44', 'Adds liboqs-python (ML-KEM-768 / ML-DSA-65) used by pqc_adapter.py and bumps cryptography.', 0.88, 'Dependency upgrade');
  }
  if (base === 'go.mod' && a.rule_id === 'PQC-LIB-001') {
    ctx.lines = L.map((l) => l.replace(/^go\s+[\d.]+/, 'go 1.24'));
    const r = ctx.lines.findIndex((l) => /^require\s*\(/.test(l));
    if (r >= 0) ctx.lines.splice(r + 1, 0, '\tgithub.com/open-quantum-safe/liboqs-go v0.12.0');
    return change(a, 'go 1.24 + liboqs-go', 'Toolchain raised to Go 1.24 (crypto/mlkem, hybrid TLS) and liboqs-go added for ML-DSA.', 0.88, 'Toolchain upgrade');
  }
  if (base === 'package.json') return null;

  if (a.rule_id === 'PQC-TLS-002') {
    const out = line.replace(/ssl_protocols\s+[^;]+;/, 'ssl_protocols TLSv1.2 TLSv1.3;').replace(/(enabled-protocols\s*[=:]\s*).*/, '$1TLSv1.2,TLSv1.3');
    return edit(out, 'TLS 1.3 enabled', 'TLS 1.3 enabled (required for hybrid ML-KEM groups); legacy TLS 1.0/1.1 removed.', 0.9, 'RFC 8446');
  }
  if (a.rule_id === 'PQC-TLS-001') {
    if (/ssl_ecdh_curve/.test(line)) return edit(line.replace(/ssl_ecdh_curve\s+[^;]+;/, 'ssl_ecdh_curve X25519MLKEM768:X25519:prime256v1;'), 'X25519MLKEM768 hybrid', 'nginx now offers the hybrid X25519MLKEM768 group first (requires nginx built against OpenSSL 3.5).', 0.9, 'IETF hybrid');
    if (/ssl_ciphers/.test(line)) {
      replaceRange(L, i, i, [`${indentOf(line)}# QuantumShift (PQC-TLS-001): RSA authentication remains until the server certificate is re-issued (ML-DSA / composite) — tracked in the Migration Planner.`, line]);
      return change(a, 'Advisory: certificate re-issuance', 'Cipher suites unchanged; RSA authentication is retired when the certificate is re-issued (PKI change, not a code change).', 0.5, 'Advisory');
    }
  }
  if (a.rule_id === 'PQC-JWT-001') {
    return edit(line.replace(/(algorithm\s*[=:]\s*["']?)(RS|ES|PS)\d{3}/i, '$1ML-DSA-65'), 'ML-DSA-65', 'SSO token algorithm switched to ML-DSA-65 (requires a PQC-capable JOSE library on both IdP and SP).', 0.7, 'FIPS 204 (draft JOSE)');
  }
  return null;
}

function certificatePlan(ctx, a) {
  const md = a.metadata || {};
  const cn = (md.subject || '').match(/CN=([^,]+)/)?.[1] || 'service.example';
  const name = path.basename(ctx.file).replace(/\.[^.]+$/, '');
  ctx.extraFiles.push({
    path: `${path.posix.dirname(ctx.file)}/REISSUE-${name}.md`,
    reason: 'PKI re-issuance runbook (certificates are replaced, not patched)',
    content: `# Re-issue ${ctx.file} with ML-DSA-65\n\nGenerated by the QuantumShift Code Refactoring Agent (${a.rule_id}).\n\nCurrent: ${a.algorithm} — subject \`${md.subject || 'n/a'}\`, valid to ${md.validTo || 'n/a'}.\n\n## Steps\n1. Generate an ML-DSA-65 key and CSR with OpenSSL 3.5:\n   \`\`\`sh\n   openssl req -new -newkey ML-DSA-65 -nodes -keyout ${name}.key -out ${name}.csr -subj "/CN=${cn}"\n   \`\`\`\n2. Submit the CSR to a CA that issues ML-DSA (or composite ML-DSA-65 + RSA) certificates.\n3. Deploy alongside the existing certificate (dual-certificate / composite) until all clients validate ML-DSA.\n4. Revoke the ${a.algorithm} certificate after cut-over.\n`,
  });
  return change(a, 'ML-DSA-65 certificate (runbook)', 'Certificates are re-issued through PKI; a runbook with OpenSSL 3.5 commands was generated.', 0.8, 'FIPS 204');
}

function fallback(ctx, a) {
  const cm = { Python: '#', Dockerfile: '#', Config: '#', Manifest: '#' }[ctx.language] || '//';
  if (ctx.language === 'Certificate' || path.basename(ctx.file) === 'package.json') return null;
  const i = Math.max(0, (a.line || 1) - 1);
  ctx.lines.splice(i, 0, `${indentOf(ctx.lines[i])}${cm} TODO(quantumshift): migrate ${a.algorithm} → ${a.target_algorithm} (${a.rule_id}) — no safe automatic rewrite; manual review required`);
  return change(a, a.target_algorithm, 'No deterministic rewrite matched this call shape; a TODO marker was inserted for the developer.', 0.3, 'Manual');
}

// ---------------------------------------------------------------------------
// Imports + adapter placement
// ---------------------------------------------------------------------------
function addImports(ctx) {
  const L = ctx.lines;
  const { language, file } = ctx;
  if ((language === 'JavaScript' || language === 'TypeScript') && ctx.adapter) {
    const ts = language === 'TypeScript';
    const top = file.split('/')[0];
    const adapterPath = `${file.includes('/') ? top : '.'}/crypto/pqc-adapter.${ts ? 'ts' : 'js'}`;
    let rel = path.posix.relative(path.posix.dirname(file), adapterPath.replace(/\.(js|ts)$/, ''));
    if (!rel.startsWith('.')) rel = `./${rel}`;
    const cjs = /\brequire\(/.test(ctx.original);
    const stmt = cjs ? `const pqc = require('${rel}');` : `import * as pqc from '${rel}';`;
    let at = -1;
    L.forEach((l, k) => { if (k < 60 && (cjs ? /^(const|let|var)\s.*=\s*require\(/.test(l) : /^import\s/.test(l))) at = k; });
    if (at < 0) at = L.findIndex((l) => /['"]use strict['"]/.test(l));
    L.splice(at + 1, 0, stmt);
    if (!ctx.existingFiles.has(adapterPath)) ctx.extraFiles.push({ path: adapterPath, reason: 'PQC adapter (node:crypto ML-KEM / ML-DSA)', content: jsAdapter({ esm: !cjs, typescript: ts }) });
    return 'node:crypto (OpenSSL 3.5) PQC adapter';
  }
  if (language === 'Python' && ctx.adapter) {
    const pkg = file.includes('/') ? file.split('/')[0] : null;
    const stmt = pkg ? `from ${pkg} import pqc_adapter as pqc` : 'import pqc_adapter as pqc';
    let at = -1;
    L.forEach((l, k) => { if (k < 40 && /^(import|from)\s/.test(l)) at = k; });
    L.splice(at + 1, 0, stmt);
    const p = pkg ? `${pkg}/pqc_adapter.py` : 'pqc_adapter.py';
    if (!ctx.existingFiles.has(p)) ctx.extraFiles.push({ path: p, reason: 'PQC adapter (liboqs-python)', content: pythonAdapter() });
    return 'liboqs-python adapter';
  }
  if (language === 'Go') {
    const want = new Set(ctx.goImportsAdd);
    if (ctx.adapter) want.add(`${ctx.goModule || 'example.com/app'}/internal/pqc`);
    const start = L.findIndex((l) => /^import\s*\(/.test(l));
    if (start >= 0) {
      let end = start;
      while (end < L.length && !/^\)/.test(L[end])) end++;
      const body = L.slice(start + 1, end).map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/"/g, ''));
      const code = L.filter((_, k) => k < start || k > end).join('\n');
      const used = (imp) => {
        const name = imp.split(/\s+/).pop().split('/').pop();
        return new RegExp(`\\b${esc(name)}\\.`).test(code);
      };
      const keep = body.filter((imp) => used(imp) || /^_ /.test(imp));
      for (const w of want) if (!keep.includes(w)) keep.push(w);
      const std = keep.filter((k) => !k.includes('.')).sort();
      const ext = keep.filter((k) => k.includes('.')).sort();
      const block = [...std.map((k) => `\t"${k}"`), ...(ext.length && std.length ? [''] : []), ...ext.map((k) => `\t"${k}"`)];
      replaceRange(L, start + 1, end - 1, block);
    }
    if (ctx.adapter && !ctx.existingFiles.has('internal/pqc/pqc.go')) ctx.extraFiles.push({ path: 'internal/pqc/pqc.go', reason: 'PQC adapter (liboqs-go + crypto/mlkem)', content: goAdapter() });
    return ctx.adapter ? 'liboqs-go adapter' : 'Go standard library';
  }
  if ((language === 'Java' || language === 'Kotlin') && ctx.adapter) {
    const pkg = ctx.original.match(/^package\s+([\w.]+);/m)?.[1] || 'app';
    const p = `${path.posix.dirname(file)}/PqcAdapter.java`;
    if (!ctx.existingFiles.has(p)) ctx.extraFiles.push({ path: p, reason: 'PQC adapter (Bouncy Castle 1.80)', content: javaAdapter(pkg) });
    return 'Bouncy Castle PQC adapter';
  }
  return ['JavaScript', 'TypeScript', 'Python', 'Java', 'Kotlin'].includes(language) ? 'Direct API substitution (no adapter needed)' : 'Configuration / dependency change';
}

/**
 * Remediates every open, non-GREEN asset in one file.
 * @returns {{ after, changes, extraFiles, adapter, confidence, diff }}
 */
export function remediateFile({ filePath, code, assets, goModule, existingFiles = new Set(), extraFilesAlreadyGenerated = new Set() }) {
  const language = detectLanguage(filePath);
  const eol = code.includes('\r\n') ? '\r\n' : '\n';
  const ctx = {
    lines: code.split(/\r?\n/),
    original: code,
    language,
    file: filePath,
    adapter: false,
    extraFiles: [],
    goImportsAdd: new Set(),
    goModule,
    existingFiles: new Set([...existingFiles, ...extraFilesAlreadyGenerated]),
    persisted: false,
  };
  const ordered = [...assets].sort((x, y) => (y.line || 0) - (x.line || 0));
  const changes = [];
  for (const a of ordered) {
    let c = null;
    if (language === 'Certificate') c = certificatePlan(ctx, a);
    else if (language === 'JavaScript' || language === 'TypeScript') c = jsTransform(ctx, a);
    else if (language === 'Python') c = pyTransform(ctx, a);
    else if (language === 'Go') c = goTransform(ctx, a);
    else if (language === 'Java' || language === 'Kotlin') c = javaTransform(ctx, a);
    else c = configTransform(ctx, a);
    if (!c) c = fallback(ctx, a);
    if (c) changes.push({ ...c, assetId: a.id, file: filePath, line: a.line, functionName: a.function_name });
  }
  const adapter = addImports(ctx);
  const after = ctx.lines.join(eol);
  let diff = after !== code ? createTwoFilesPatch(`a/${filePath}`, `b/${filePath}`, code, after, '', '', { context: 3 }) : '';
  for (const f of ctx.extraFiles) diff += createTwoFilesPatch('/dev/null', `b/${f.path}`, '', f.content, '', '', { context: 3 });
  changes.sort((x, y) => (x.line || 0) - (y.line || 0));
  const confidence = changes.length ? +(changes.reduce((s, c) => s + c.confidence, 0) / changes.length).toFixed(2) : 0;
  return { language, after, changes, extraFiles: ctx.extraFiles, adapter, confidence, diff };
}
