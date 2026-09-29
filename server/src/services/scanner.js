import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from '@babel/parser';
import { FAMILIES, statusOf, targetFor, primitiveFor } from './catalog.js';

/**
 * QuantumShift static scanner.
 *  - JavaScript/TypeScript: real AST traversal with @babel/parser.
 *  - Python / Go / Java: Semgrep-style pattern rules with semantic context
 *    (enclosing function, key-size resolution, data-context inference).
 *  - Manifests (package.json, requirements.txt, pom.xml, go.mod) and Dockerfiles:
 *    dependency / runtime analysis.
 *  - Certificates: real X.509 parsing via node:crypto.
 *  - Cloud inventories (*.inventory.json): KMS / ACM / ELB analysis.
 */

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'vendor', '__pycache__', '.venv', 'venv', '.idea', '.next', 'coverage']);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES = 5000;

const EXT_LANG = {
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript',
  '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript',
  '.py': 'Python', '.go': 'Go', '.java': 'Java', '.kt': 'Kotlin',
  '.pem': 'Certificate', '.crt': 'Certificate', '.cer': 'Certificate',
  '.conf': 'Config', '.properties': 'Config', '.yml': 'Config', '.yaml': 'Config', '.toml': 'Config', '.ini': 'Config', '.xml': 'Config', '.json': 'Config',
  '.cs': 'C#', '.rb': 'Ruby', '.php': 'PHP', '.c': 'C', '.cpp': 'C++', '.h': 'C', '.rs': 'Rust', '.sh': 'Shell', '.md': 'Docs', '.txt': 'Text',
};

export function detectLanguage(rel) {
  const base = path.basename(rel);
  if (/^Dockerfile/i.test(base) || base.endsWith('.dockerfile')) return 'Dockerfile';
  if (['package.json', 'requirements.txt', 'pom.xml', 'go.mod', 'build.gradle', 'Pipfile'].includes(base)) return 'Manifest';
  if (base.endsWith('.inventory.json')) return 'Cloud Inventory';
  return EXT_LANG[path.extname(base).toLowerCase()] || null;
}

const CODE_LANGS = new Set(['JavaScript', 'TypeScript', 'Python', 'Go', 'Java', 'Kotlin', 'C#', 'Ruby', 'PHP', 'C', 'C++', 'Rust', 'Shell']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const hashName = (h) => {
  const x = String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (x === 'sha1') return 'SHA-1';
  if (x === 'md5') return 'MD5';
  const m = x.match(/^sha3(\d{3})$/);
  if (m) return `SHA3-${m[1]}`;
  const s = x.match(/^sha(224|256|384|512)/);
  if (s) return `SHA-${s[1]}`;
  return h.toUpperCase();
};

const hashFamily = (name) => (name === 'SHA-1' ? 'SHA-1' : name === 'MD5' ? 'MD5' : name.startsWith('SHA3') ? 'SHA-3' : name.startsWith('SHA-') ? 'SHA-2' : null);

const curveName = (c) => {
  const x = String(c || '').toLowerCase();
  if (['prime256v1', 'secp256r1', 'p-256', 'p256'].includes(x)) return 'P-256';
  if (['secp384r1', 'p-384', 'p384'].includes(x)) return 'P-384';
  if (['secp521r1', 'p-521', 'p521'].includes(x)) return 'P-521';
  if (x === 'secp256k1') return 'secp256k1';
  return c || 'unknown-curve';
};

function inferDataContext(rel, fn = '') {
  const p = `${rel} ${fn}`.toLowerCase();
  if (/payment|card|checkout|tokeni[sz]|pan\b|billing/.test(p)) return 'Cardholder & payment data (PCI DSS)';
  if (/patient|record|fhir|phi|medical|clinic|dicom|lab/.test(p)) return 'Protected health information (PHI)';
  if (/identity|citizen|passport|assertion/.test(p)) return 'Citizen identity records';
  if (/payroll|employee|hr[-_/]|salary/.test(p)) return 'Employee & payroll records';
  if (/auth|login|session|token|jwt|sso|signer/.test(p)) return 'Authentication tokens & session integrity';
  if (/transaction|ledger|transfer/.test(p)) return 'Financial transactions (10-year retention)';
  if (/tls|nginx|gateway|server\.go|https|ssl/.test(p)) return 'Data in transit (TLS)';
  if (/archive|backup|vault|storage/.test(p)) return 'Archived data at rest';
  if (/config|keys?\.|secret/.test(p)) return 'Key material & secrets';
  if (/cart|cache|coupon/.test(p)) return 'Low-sensitivity application data';
  return null;
}

function mk(ctx, d) {
  const family = d.family ?? null;
  let quantumStatus = d.quantumStatus || (family ? statusOf(family) : 'vulnerable');
  if (family === 'RSA' && d.keySize && d.keySize < 2048) quantumStatus = 'broken';
  const primitive = primitiveFor(family, d.primitive);
  const assetType = d.assetType || 'algorithm';
  return {
    file: ctx.rel,
    language: ctx.language,
    line: d.line ?? null,
    endLine: d.endLine ?? d.line ?? null,
    functionName: d.functionName || null,
    snippet: (d.snippet || '').slice(0, 240),
    apiCall: (d.apiCall || '').slice(0, 200),
    algorithm: d.algorithm,
    family,
    keySize: d.keySize || null,
    assetType,
    primitive,
    ruleId: d.ruleId,
    detectionMethod: d.detectionMethod || ctx.method,
    confidence: d.confidence ?? 0.9,
    quantumStatus,
    dataContext: d.dataContext || inferDataContext(ctx.rel, d.functionName),
    targetAlgorithm: ['safe', 'pqc'].includes(quantumStatus) ? 'No change required' : d.target || targetFor({ family, primitive, assetType, algorithm: d.algorithm }),
    metadata: d.metadata || {},
    dependencies: d.dependencies || [],
  };
}

// ---------------------------------------------------------------------------
// JavaScript / TypeScript — real AST analysis
// ---------------------------------------------------------------------------
const calleeName = (n) => {
  if (!n) return '';
  switch (n.type) {
    case 'Identifier': return n.name;
    case 'ThisExpression': return 'this';
    case 'Super': return 'super';
    case 'MemberExpression':
    case 'OptionalMemberExpression':
      return `${calleeName(n.object)}.${n.property?.name ?? n.property?.value ?? '?'}`;
    case 'CallExpression': return `${calleeName(n.callee)}()`;
    case 'TSNonNullExpression': return calleeName(n.expression);
    default: return '';
  }
};
const strVal = (n) => {
  if (!n) return null;
  if (n.type === 'StringLiteral') return n.value;
  if (n.type === 'TemplateLiteral' && n.expressions.length === 0) return n.quasis.map((q) => q.value.cooked).join('');
  return null;
};
const numVal = (n) => (n && n.type === 'NumericLiteral' ? n.value : null);
const objProp = (obj, name) => {
  if (!obj || obj.type !== 'ObjectExpression') return null;
  const p = obj.properties.find((pp) => (pp.key?.name ?? pp.key?.value) === name);
  return p ? p.value : null;
};

const JS_LIB = (full) => {
  if (/^crypto\.|^node:crypto/.test(full) || /^(createSign|createHash|generateKeyPairSync)/.test(full)) return 'node:crypto (OpenSSL)';
  if (/^jwt\.|jsonwebtoken/.test(full)) return 'jsonwebtoken';
  if (/^CryptoJS\./.test(full)) return 'crypto-js';
  if (/forge/.test(full)) return 'node-forge';
  if (/NodeRSA/.test(full)) return 'node-rsa';
  if (/subtle/.test(full)) return 'WebCrypto (SubtleCrypto)';
  return null;
};

function scanJs(rel, code, language) {
  const plugins = language === 'TypeScript' ? (rel.endsWith('x') ? ['typescript', 'jsx'] : ['typescript']) : ['jsx'];
  let ast;
  try {
    ast = parse(code, { sourceType: 'unambiguous', errorRecovery: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, plugins: [...plugins, 'decorators-legacy', 'classProperties', 'topLevelAwait'] });
  } catch (e) {
    return { assets: [], nodes: 0, parseError: e.message };
  }
  const lines = code.split(/\r?\n/);
  const ctx = { rel, language, method: 'AST (Babel parser)' };
  const out = [];
  const stack = [];
  let nodes = 0;

  const enclosing = () => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const n = stack[i];
      const parent = stack[i - 1];
      if (n.type === 'FunctionDeclaration' && n.id) return n.id.name;
      if ((n.type === 'ClassMethod' || n.type === 'ObjectMethod' || n.type === 'ClassPrivateMethod') && n.key) return n.key.name ?? n.key.value;
      if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') {
        if (n.id) return n.id.name;
        if (parent?.type === 'VariableDeclarator') return parent.id?.name;
        if (parent?.type === 'ObjectProperty' || parent?.type === 'ClassProperty') return parent.key?.name ?? parent.key?.value;
        if (parent?.type === 'AssignmentExpression') return calleeName(parent.left);
        if (parent?.type === 'CallExpression') return `callback→${calleeName(parent.callee)}`;
        return '<anonymous>';
      }
    }
    return '<module>';
  };

  const add = (node, d) => {
    const line = node.loc?.start.line;
    const src = code.slice(node.start, node.end);
    out.push(
      mk(ctx, {
        line,
        endLine: node.loc?.end.line,
        functionName: enclosing(),
        snippet: lines[line - 1]?.trim(),
        apiCall: src.length <= 140 ? src.replace(/\s+/g, ' ') : `${calleeName(node.callee) || 'expression'}(…)`,
        dependencies: [JS_LIB(calleeName(node.callee) || '')].filter(Boolean),
        confidence: 0.96,
        ...d,
      }),
    );
  };

  const onCall = (node) => {
    const full = calleeName(node.callee);
    const last = full.split('.').pop();
    const a = node.arguments || [];

    if (node.type === 'NewExpression' && /NodeRSA$/.test(full)) {
      const bits = numVal(objProp(a[0], 'b')) || 2048;
      return add(node, { algorithm: `RSA-${bits}`, family: 'RSA', keySize: bits, primitive: 'pke', ruleId: 'PQC-RSA-002' });
    }
    if (/rsa\.generateKeyPair$/.test(full)) {
      const bits = numVal(a[0]) || numVal(objProp(a[0], 'bits')) || 2048;
      return add(node, { algorithm: `RSA-${bits}`, family: 'RSA', keySize: bits, ruleId: 'PQC-RSA-002' });
    }
    if (full.startsWith('CryptoJS.')) {
      const op = full.split('.')[1];
      const map = {
        SHA1: ['SHA-1', 'SHA-1', 'PQC-HASH-001'], MD5: ['MD5', 'MD5', 'PQC-HASH-002'], SHA256: ['SHA-256', 'SHA-2', 'PQC-INV-001'], SHA512: ['SHA-512', 'SHA-2', 'PQC-INV-001'],
        TripleDES: ['3DES', '3DES', 'PQC-SYM-001'], DES: ['DES', 'DES', 'PQC-SYM-001'], RC4: ['RC4', 'RC4', 'PQC-SYM-001'], AES: ['AES-256-CBC (passphrase)', 'AES-256', 'PQC-INV-001'],
        HmacSHA1: ['HMAC-SHA1', 'HMAC-SHA1', 'PQC-HASH-001'], HmacSHA256: ['HMAC-SHA256', 'HMAC', 'PQC-INV-001'],
      };
      const m = map[op];
      if (m) return add(node, { algorithm: m[0], family: m[1], ruleId: m[2] });
      return;
    }
    switch (last) {
      case 'createSign':
      case 'createVerify': {
        const s = (strVal(a[0]) || 'SHA256').toUpperCase();
        const hash = hashName(s.replace(/^RSA-|^ECDSA-/, '').replace(/WITHRSA.*/, ''));
        const fam = s.includes('ECDSA') ? 'ECDSA' : 'RSA';
        return add(node, { algorithm: `${fam}-${hash.replace('-', '')}`, family: fam, primitive: 'signature', ruleId: fam === 'RSA' ? 'PQC-RSA-001' : 'PQC-ECC-001', metadata: { hash, operation: last === 'createSign' ? 'sign' : 'verify' } });
      }
      case 'generateKeyPairSync':
      case 'generateKeyPair': {
        const type = (strVal(a[0]) || '').toLowerCase();
        const opts = a[1];
        if (type.startsWith('rsa')) {
          const bits = numVal(objProp(opts, 'modulusLength')) || 2048;
          const usesEncrypt = /publicEncrypt|privateDecrypt/.test(code);
          return add(node, { algorithm: `RSA-${bits}`, family: 'RSA', keySize: bits, primitive: usesEncrypt ? 'pke' : 'signature', ruleId: 'PQC-RSA-002' });
        }
        if (type === 'ec') {
          const curve = curveName(strVal(objProp(opts, 'namedCurve')));
          const usesSign = /\bsign\(|ES256|ES384|createSign/.test(code);
          return add(node, { algorithm: `ECC-${curve}`, family: usesSign ? 'ECDSA' : 'ECC', primitive: usesSign ? 'signature' : undefined, ruleId: 'PQC-ECC-002', metadata: { curve } });
        }
        if (type === 'ed25519' || type === 'ed448') return add(node, { algorithm: type === 'ed25519' ? 'Ed25519' : 'Ed448', family: 'EdDSA', ruleId: 'PQC-ECC-002' });
        if (type === 'x25519' || type === 'x448') return add(node, { algorithm: type.toUpperCase(), family: 'ECDH', ruleId: 'PQC-ECC-003' });
        if (type === 'dsa') return add(node, { algorithm: `DSA-${numVal(objProp(opts, 'modulusLength')) || 2048}`, family: 'DSA', ruleId: 'PQC-RSA-002' });
        if (type === 'dh') return add(node, { algorithm: 'DH', family: 'DH', ruleId: 'PQC-DH-001' });
        if (type.startsWith('ml-kem')) return add(node, { algorithm: type.toUpperCase(), family: 'ML-KEM', ruleId: 'PQC-INV-001' });
        if (type.startsWith('ml-dsa')) return add(node, { algorithm: type.toUpperCase(), family: 'ML-DSA', ruleId: 'PQC-INV-001' });
        if (type.startsWith('slh-dsa')) return add(node, { algorithm: type.toUpperCase(), family: 'SLH-DSA', ruleId: 'PQC-INV-001' });
        return;
      }
      case 'publicEncrypt':
      case 'privateDecrypt':
      case 'privateEncrypt':
      case 'publicDecrypt':
        return add(node, { algorithm: 'RSA-OAEP', family: 'RSA', primitive: 'pke', ruleId: 'PQC-RSA-003', metadata: { operation: last } });
      case 'createECDH': {
        const curve = curveName(strVal(a[0]));
        return add(node, { algorithm: `ECDH-${curve}`, family: 'ECDH', ruleId: 'PQC-ECC-003', metadata: { curve } });
      }
      case 'createDiffieHellman':
      case 'getDiffieHellman':
      case 'createDiffieHellmanGroup':
        return add(node, { algorithm: 'DH', family: 'DH', ruleId: 'PQC-DH-001' });
      case 'createHash': {
        const h = hashName(strVal(a[0]) || 'unknown');
        const fam = hashFamily(h);
        if (!fam) return;
        return add(node, { algorithm: h, family: fam, ruleId: fam === 'SHA-1' ? 'PQC-HASH-001' : fam === 'MD5' ? 'PQC-HASH-002' : 'PQC-INV-001' });
      }
      case 'createHmac': {
        const h = hashName(strVal(a[0]) || 'unknown');
        const fam = h === 'SHA-1' ? 'HMAC-SHA1' : h === 'MD5' ? 'MD5' : 'HMAC';
        return add(node, { algorithm: `HMAC-${h.replace('-', '')}`, family: fam, ruleId: fam === 'HMAC' ? 'PQC-INV-001' : 'PQC-HASH-001' });
      }
      case 'createCipheriv':
      case 'createCipher': {
        const alg = (strVal(a[0]) || '').toLowerCase();
        const aes = alg.match(/^aes-?(128|192|256)/);
        if (aes) {
          const fam = aes[1] === '128' ? 'AES-128' : aes[1] === '192' ? 'AES-192' : 'AES-256';
          return add(node, { algorithm: alg.toUpperCase(), family: fam, keySize: Number(aes[1]), ruleId: fam === 'AES-128' ? 'PQC-SYM-002' : 'PQC-INV-001' });
        }
        if (/des-ede3|des3|des-ede/.test(alg)) return add(node, { algorithm: '3DES', family: '3DES', ruleId: 'PQC-SYM-001' });
        if (/^des/.test(alg)) return add(node, { algorithm: 'DES', family: 'DES', ruleId: 'PQC-SYM-001' });
        if (/rc4/.test(alg)) return add(node, { algorithm: 'RC4', family: 'RC4', ruleId: 'PQC-SYM-001' });
        return;
      }
      case 'sign':
      case 'verify': {
        if (!/(^|\.)(jwt|jsonwebtoken|jws)$/i.test(full.split('.').slice(0, -1).join('.'))) return;
        const opts = a[2];
        let alg = strVal(objProp(opts, 'algorithm'));
        const algs = objProp(opts, 'algorithms');
        if (!alg && algs?.type === 'ArrayExpression') alg = strVal(algs.elements[0]);
        if (!alg) return;
        const U = alg.toUpperCase();
        if (U.startsWith('RS') || U.startsWith('PS')) return add(node, { algorithm: `JWT ${U} (RSA)`, family: 'RSA', primitive: 'signature', ruleId: 'PQC-JWT-001' });
        if (U.startsWith('ES')) return add(node, { algorithm: `JWT ${U} (ECDSA)`, family: 'ECDSA', primitive: 'signature', ruleId: 'PQC-JWT-001' });
        if (U === 'EDDSA') return add(node, { algorithm: 'JWT EdDSA', family: 'EdDSA', ruleId: 'PQC-JWT-001' });
        if (U.startsWith('HS')) return add(node, { algorithm: `JWT ${U} (HMAC)`, family: 'HMAC', ruleId: 'PQC-INV-001' });
        return;
      }
      case 'generateKey':
      case 'importKey': {
        const spec = a.find((x) => x?.type === 'ObjectExpression');
        const name = strVal(objProp(spec, 'name'));
        if (!name) return;
        if (/^RSA/.test(name)) return add(node, { algorithm: `${name}-${numVal(objProp(spec, 'modulusLength')) || ''}`.replace(/-$/, ''), family: 'RSA', ruleId: 'PQC-RSA-002' });
        if (name === 'ECDSA') return add(node, { algorithm: `ECDSA-${curveName(strVal(objProp(spec, 'namedCurve')))}`, family: 'ECDSA', ruleId: 'PQC-ECC-002' });
        if (name === 'ECDH') return add(node, { algorithm: `ECDH-${curveName(strVal(objProp(spec, 'namedCurve')))}`, family: 'ECDH', ruleId: 'PQC-ECC-003' });
        return;
      }
      default:
    }
  };

  const onOther = (node, parent) => {
    // Hardcoded private keys inside string/template literals
    if (node.type === 'StringLiteral' || node.type === 'TemplateLiteral') {
      const text = node.type === 'StringLiteral' ? node.value : node.quasis.map((q) => q.value.raw).join('');
      const m = text.match(/-----BEGIN ((?:RSA|EC|DSA|ENCRYPTED|OPENSSH) )?PRIVATE KEY-----/);
      if (m) {
        const kind = (m[1] || '').trim();
        const holder = parent?.type === 'VariableDeclarator' ? parent.id?.name : null;
        out.push(mk(ctx, {
          line: node.loc.start.line, endLine: node.loc.end.line, functionName: enclosing(),
          snippet: lines[node.loc.start.line - 1]?.trim(), apiCall: holder ? `${holder} = <PEM private key literal>` : '<PEM private key literal>',
          algorithm: kind === 'RSA' ? 'RSA private key (PEM)' : kind === 'EC' ? 'EC private key (PEM)' : 'Private key (PEM)', family: 'KEY', assetType: 'key', primitive: kind === 'EC' ? 'signature' : 'pke',
          ruleId: 'PQC-KEY-001', confidence: 0.99, metadata: { variable: holder, keyType: kind || 'unknown', secured: false }, dependencies: ['Source control (git history)'],
        }));
      }
    }
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && /(secret|private_?key|signing_?key|api_?key|master_?key|passw(or)?d)/i.test(node.id.name)) {
      const v = strVal(node.init);
      if (v && v.length >= 12 && !v.includes('BEGIN')) {
        out.push(mk(ctx, {
          line: node.loc.start.line, functionName: enclosing(), snippet: lines[node.loc.start.line - 1]?.trim(),
          apiCall: `${node.id.name} = "<redacted ${v.length} chars>"`, algorithm: 'Static secret literal', family: 'SECRET', assetType: 'secret', primitive: 'mac',
          ruleId: 'PQC-KEY-002', confidence: 0.85, metadata: { variable: node.id.name, length: v.length },
        }));
      }
    }
    if (node.type === 'ObjectProperty') {
      const key = node.key?.name ?? node.key?.value;
      const v = strVal(node.value);
      if (key === 'ecdhCurve' && v && !/mlkem/i.test(v)) {
        out.push(mk(ctx, { line: node.loc.start.line, functionName: enclosing(), snippet: lines[node.loc.start.line - 1]?.trim(), apiCall: `ecdhCurve: '${v}'`, algorithm: `TLS ECDHE (${v})`, family: 'TLS', assetType: 'protocol', primitive: 'key-agree', ruleId: 'PQC-TLS-001' }));
      }
      if ((key === 'minVersion' || key === 'secureProtocol') && v && /TLSv1(\.1)?(_method)?$/.test(v)) {
        out.push(mk(ctx, { line: node.loc.start.line, functionName: enclosing(), snippet: lines[node.loc.start.line - 1]?.trim(), apiCall: `${key}: '${v}'`, algorithm: `TLS minimum ${v}`, family: 'TLS', assetType: 'protocol', ruleId: 'PQC-TLS-002', quantumStatus: 'broken' }));
      }
    }
  };

  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    nodes++;
    stack.push(node);
    if (node.type === 'CallExpression' || node.type === 'NewExpression' || node.type === 'OptionalCallExpression') onCall(node);
    else onOther(node, parent);
    for (const key in node) {
      if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments' || key === 'extra' || key === 'tokens') continue;
      const v = node[key];
      if (Array.isArray(v)) { for (const c of v) if (c && typeof c.type === 'string') visit(c, node); }
      else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v, node);
    }
    stack.pop();
  };
  visit(ast.program, null);
  return { assets: out, nodes, parseError: ast.errors?.length ? ast.errors[0].message : null };
}

// ---------------------------------------------------------------------------
// Pattern rules for other languages (Semgrep-style)
// ---------------------------------------------------------------------------
function enclosingFn(lines, i, language) {
  const indent = (s) => s.match(/^\s*/)[0].length;
  const cur = indent(lines[i]);
  for (let k = i; k >= 0; k--) {
    const l = lines[k];
    if (language === 'Python') {
      const m = l.match(/^(\s*)(?:async\s+)?def\s+(\w+)/);
      if (m && (m[1].length < cur || k === i)) return m[2];
    } else if (language === 'Go') {
      const m = l.match(/^func\s+(?:\([^)]*\)\s*)?(\w+)/);
      if (m) return m[1];
    } else if (language === 'Java' || language === 'Kotlin') {
      const m = l.match(/^\s*(?:(?:public|private|protected|static|final|synchronized|abstract|override|suspend|fun)\s+)+[\w<>\[\],.?\s]*?(\w+)\s*\([^;]*$/);
      if (m && !['if', 'for', 'while', 'switch', 'catch', 'new', 'return'].includes(m[1])) return m[1];
    }
  }
  return language === 'Go' || language === 'Python' ? '<module>' : '<class>';
}

const lookahead = (lines, i, n = 6) => lines.slice(i, i + n).join('\n');

/** Extracts the full call expression starting at the match (balanced parentheses, same line). */
function callText(line, idx, fallback) {
  const open = line.indexOf('(', idx);
  if (open < 0) return fallback;
  let depth = 0;
  for (let k = open; k < line.length; k++) {
    if (line[k] === '(') depth++;
    else if (line[k] === ')' && --depth === 0) return line.slice(idx, k + 1).trim();
  }
  return line.slice(idx).trim();
}

/** Each rule: [regex, (match, env) => detection | null]. env = { lines, i, code, win } */
const PY_RULES = [
  [/\brsa\.generate_private_key\(/, (m, e) => {
    const bits = Number(e.win.match(/key_size\s*=\s*(\d+)/)?.[1]) || 2048;
    return { algorithm: `RSA-${bits}`, family: 'RSA', keySize: bits, primitive: /\.encrypt\(|OAEP/.test(e.code) ? 'pke' : 'signature', ruleId: 'PQC-RSA-002', dependencies: ['cryptography'] };
  }],
  [/\bRSA\.generate\(\s*(\d+)/, (m) => ({ algorithm: `RSA-${m[1]}`, family: 'RSA', keySize: Number(m[1]), ruleId: 'PQC-RSA-002', dependencies: ['pycryptodome'] })],
  [/\bpadding\.OAEP\(/, () => ({ algorithm: 'RSA-OAEP', family: 'RSA', primitive: 'pke', ruleId: 'PQC-RSA-003', dependencies: ['cryptography'] })],
  [/\bpadding\.PKCS1v15\(/, () => ({ algorithm: 'RSA-PKCS1v15', family: 'RSA', primitive: 'signature', ruleId: 'PQC-RSA-001', dependencies: ['cryptography'] })],
  [/\bec\.generate_private_key\(\s*ec\.(\w+)\(/, (m, e) => ({ algorithm: `ECC-${curveName(m[1])}`, family: /ES256|ECDSA|sign/.test(e.code) ? 'ECDSA' : 'ECC', primitive: /ES256|ECDSA|sign/.test(e.code) ? 'signature' : undefined, ruleId: 'PQC-ECC-002', dependencies: ['cryptography'], metadata: { curve: curveName(m[1]) } })],
  [/\bec\.ECDSA\(/, () => ({ algorithm: 'ECDSA', family: 'ECDSA', ruleId: 'PQC-ECC-001', dependencies: ['cryptography'] })],
  [/\bec\.ECDH\(\)/, () => ({ algorithm: 'ECDH', family: 'ECDH', ruleId: 'PQC-ECC-003', dependencies: ['cryptography'] })],
  [/\bhashlib\.(sha1|md5|sha224|sha256|sha384|sha512|sha3_256|sha3_512)\(/, (m, e) => {
    if (/hmac\.new\(/.test(e.lines[e.i])) return null;
    const h = hashName(m[1].replace('_', ''));
    const fam = hashFamily(h);
    return { algorithm: h, family: fam, ruleId: fam === 'SHA-1' ? 'PQC-HASH-001' : fam === 'MD5' ? 'PQC-HASH-002' : 'PQC-INV-001', dependencies: ['hashlib (stdlib)'] };
  }],
  [/\bhashlib\.new\(\s*["'](\w+)["']/, (m) => {
    const h = hashName(m[1]);
    const fam = hashFamily(h);
    return fam ? { algorithm: h, family: fam, ruleId: fam === 'SHA-1' ? 'PQC-HASH-001' : fam === 'MD5' ? 'PQC-HASH-002' : 'PQC-INV-001' } : null;
  }],
  [/\bhmac\.new\([^)]*hashlib\.(sha1|md5|sha256|sha384|sha512)/, (m) => {
    const h = hashName(m[1]);
    return { algorithm: `HMAC-${h.replace('-', '')}`, family: h === 'SHA-1' ? 'HMAC-SHA1' : h === 'MD5' ? 'MD5' : 'HMAC', ruleId: h === 'SHA-1' || h === 'MD5' ? 'PQC-HASH-001' : 'PQC-INV-001', dependencies: ['hmac (stdlib)'] };
  }],
  [/\bAES\.new\([^,]+,\s*AES\.MODE_(\w+)/, (m, e) => {
    const size = Number(e.code.match(/get_random_bytes\((16|24|32)\)/)?.[1] || 0) * 8;
    const fam = size === 128 ? 'AES-128' : size === 192 ? 'AES-192' : 'AES-256';
    return { algorithm: `AES-${size || 256}-${m[1]}`, family: fam, keySize: size || null, ruleId: fam === 'AES-128' ? 'PQC-SYM-002' : 'PQC-INV-001', confidence: size ? 0.92 : 0.6, dependencies: ['pycryptodome'], metadata: { mode: m[1] } };
  }],
  [/\bDES3\.new\(/, () => ({ algorithm: '3DES', family: '3DES', ruleId: 'PQC-SYM-001', dependencies: ['pycryptodome'] })],
  [/\bDES\.new\(/, () => ({ algorithm: 'DES', family: 'DES', ruleId: 'PQC-SYM-001', dependencies: ['pycryptodome'] })],
  [/\bjwt\.(?:encode|decode)\([^)]*algorithms?\s*=\s*\[?\s*["'](RS|ES|PS|HS|EdDSA)(\d*)["']/, (m) => {
    const U = `${m[1]}${m[2]}`;
    if (m[1] === 'HS') return { algorithm: `JWT ${U} (HMAC)`, family: 'HMAC', ruleId: 'PQC-INV-001', dependencies: ['PyJWT'] };
    const fam = m[1] === 'ES' ? 'ECDSA' : m[1] === 'EdDSA' ? 'EdDSA' : 'RSA';
    return { algorithm: `JWT ${U} (${fam})`, family: fam, primitive: 'signature', ruleId: 'PQC-JWT-001', dependencies: ['PyJWT'] };
  }],
  [/\boqs\.(KeyEncapsulation|Signature)\(\s*["']([^"']+)["']/, (m) => ({ algorithm: m[2], family: /KEM/i.test(m[2]) ? 'ML-KEM' : /SLH/i.test(m[2]) ? 'SLH-DSA' : 'ML-DSA', ruleId: 'PQC-INV-001', dependencies: ['liboqs-python'] })],
  [/^\s*([A-Z0-9_]*(?:SECRET|PRIVATE_KEY|API_KEY|MASTER_KEY|PASSWORD)[A-Z0-9_]*)\s*=\s*["']([^"']{8,})["']/, (m) => ({ algorithm: 'Static secret literal', family: 'SECRET', assetType: 'secret', primitive: 'mac', ruleId: 'PQC-KEY-002', apiCall: `${m[1]} = "<redacted>"`, metadata: { variable: m[1] } })],
];

const GO_RULES = [
  [/\brsa\.GenerateKey\(\s*[\w.]+\s*,\s*(\d+)\s*\)/, (m) => ({ algorithm: `RSA-${m[1]}`, family: 'RSA', keySize: Number(m[1]), primitive: 'signature', ruleId: 'PQC-RSA-002', dependencies: ['Go stdlib crypto/rsa'] })],
  [/\brsa\.(SignPKCS1v15|SignPSS|VerifyPKCS1v15|VerifyPSS)\(/, (m) => ({ algorithm: `RSA-${m[1].replace(/^(Sign|Verify)/, '')}`, family: 'RSA', primitive: 'signature', ruleId: 'PQC-RSA-001', dependencies: ['Go stdlib crypto/rsa'] })],
  [/\brsa\.(EncryptOAEP|EncryptPKCS1v15|DecryptOAEP|DecryptPKCS1v15)\(/, (m) => ({ algorithm: `RSA-${m[1].replace(/^(Encrypt|Decrypt)/, '')}`, family: 'RSA', primitive: 'pke', ruleId: 'PQC-RSA-003', dependencies: ['Go stdlib crypto/rsa'] })],
  [/\becdsa\.GenerateKey\(\s*elliptic\.(P\d+)\(\)/, (m) => ({ algorithm: `ECDSA-${curveName(m[1])}`, family: 'ECDSA', primitive: 'signature', ruleId: 'PQC-ECC-002', dependencies: ['Go stdlib crypto/ecdsa'], metadata: { curve: curveName(m[1]) } })],
  [/\becdsa\.(Sign|SignASN1|Verify|VerifyASN1)\(/, () => ({ algorithm: 'ECDSA signature', family: 'ECDSA', primitive: 'signature', ruleId: 'PQC-ECC-001', dependencies: ['Go stdlib crypto/ecdsa'] })],
  [/\becdh\.(P256|P384|P521|X25519)\(\)/, (m) => ({ algorithm: `ECDH-${m[1] === 'X25519' ? 'X25519' : curveName(m[1])}`, family: 'ECDH', ruleId: 'PQC-ECC-003', dependencies: ['Go stdlib crypto/ecdh'] })],
  [/\bed25519\.(GenerateKey|Sign)\(/, () => ({ algorithm: 'Ed25519', family: 'EdDSA', ruleId: 'PQC-ECC-001' })],
  [/CurvePreferences:\s*\[\]tls\.CurveID\{([^}]*)\}/, (m) => (/MLKEM/i.test(m[1])
    ? { algorithm: 'TLS X25519MLKEM768 hybrid', family: 'ML-KEM', assetType: 'protocol', ruleId: 'PQC-INV-001' }
    : { algorithm: `TLS ECDHE (${m[1].replace(/tls\./g, '').trim()})`, family: 'TLS', assetType: 'protocol', primitive: 'key-agree', ruleId: 'PQC-TLS-001', dependencies: ['Go stdlib crypto/tls'] })],
  [/MinVersion:\s*tls\.VersionTLS1([01])\b/, (m) => ({ algorithm: `TLS minimum 1.${m[1]}`, family: 'TLS', assetType: 'protocol', ruleId: 'PQC-TLS-002', quantumStatus: 'broken' })],
  [/\bsha1\.(New|Sum)\(/, () => ({ algorithm: 'SHA-1', family: 'SHA-1', ruleId: 'PQC-HASH-001', dependencies: ['Go stdlib crypto/sha1'] })],
  [/\bmd5\.(New|Sum)\(/, () => ({ algorithm: 'MD5', family: 'MD5', ruleId: 'PQC-HASH-002', dependencies: ['Go stdlib crypto/md5'] })],
  [/\bsha256\.(New|Sum256)\(/, () => ({ algorithm: 'SHA-256', family: 'SHA-2', ruleId: 'PQC-INV-001' })],
  [/\bsha512\.(New|Sum512)\(/, () => ({ algorithm: 'SHA-512', family: 'SHA-2', ruleId: 'PQC-INV-001' })],
  [/\bdes\.NewTripleDESCipher\(/, () => ({ algorithm: '3DES', family: '3DES', ruleId: 'PQC-SYM-001' })],
  [/\bdes\.NewCipher\(/, () => ({ algorithm: 'DES', family: 'DES', ruleId: 'PQC-SYM-001' })],
  [/\bmlkem\.GenerateKey(768|1024)\(/, (m) => ({ algorithm: `ML-KEM-${m[1]}`, family: 'ML-KEM', ruleId: 'PQC-INV-001', dependencies: ['Go stdlib crypto/mlkem'] })],
  [/\bx509\.CreateCertificate\(/, (m, e) => ({ algorithm: /ecdsa/.test(e.code) ? 'X.509 issuance (ECDSA)' : 'X.509 issuance (RSA)', family: /ecdsa/.test(e.code) ? 'ECDSA' : 'RSA', assetType: 'certificate', primitive: 'signature', ruleId: 'PQC-CERT-001' })],
];

const JAVA_RULES = [
  [/KeyPairGenerator\.getInstance\(\s*"([\w-]+)"/, (m, e) => {
    const alg = m[1].toUpperCase();
    const size = Number(e.win.match(/\.initialize\(\s*(\d+)/)?.[1]) || null;
    const dep = [/"BC"/.test(e.lines[e.i]) ? 'Bouncy Castle provider' : 'JCA provider (SunRsaSign/SunEC)'];
    if (alg === 'RSA') return { algorithm: `RSA-${size || 2048}`, family: 'RSA', keySize: size || 2048, primitive: /Cipher\.getInstance\("RSA/.test(e.code) ? 'pke' : 'signature', ruleId: 'PQC-RSA-002', dependencies: dep };
    if (alg === 'EC') {
      const spec = e.win.match(/ECGenParameterSpec\(\s*"(\w+)"/)?.[1];
      const curve = spec ? curveName(spec) : size === 384 ? 'P-384' : 'P-256';
      const signs = /withECDSA/.test(e.code);
      return { algorithm: `ECC-${curve}`, family: signs ? 'ECDSA' : 'ECC', primitive: signs ? 'signature' : undefined, ruleId: 'PQC-ECC-002', dependencies: dep, metadata: { curve } };
    }
    if (alg === 'DSA') return { algorithm: `DSA-${size || 2048}`, family: 'DSA', ruleId: 'PQC-RSA-002' };
    if (alg === 'DH') return { algorithm: 'DH', family: 'DH', ruleId: 'PQC-DH-001' };
    if (alg.startsWith('ML-KEM')) return { algorithm: 'ML-KEM', family: 'ML-KEM', ruleId: 'PQC-INV-001' };
    if (alg.startsWith('ML-DSA')) return { algorithm: 'ML-DSA', family: 'ML-DSA', ruleId: 'PQC-INV-001' };
    return null;
  }],
  [/Signature\.getInstance\(\s*"(\w+?)with(RSA|ECDSA|DSA)(?:\/PSS)?"/i, (m) => {
    const fam = m[2].toUpperCase() === 'RSA' ? 'RSA' : m[2].toUpperCase() === 'DSA' ? 'DSA' : 'ECDSA';
    return { algorithm: `${m[1]}with${m[2]}`, family: fam, primitive: 'signature', ruleId: fam === 'RSA' ? 'PQC-RSA-001' : 'PQC-ECC-001', dependencies: ['JCA provider'] };
  }],
  [/Cipher\.getInstance\(\s*"([^"]+)"/, (m, e) => {
    const t = m[1];
    const alg = t.split('/')[0].toUpperCase();
    if (alg === 'RSA') return { algorithm: `RSA/${t.split('/').slice(1).join('/')}`, family: 'RSA', primitive: 'pke', ruleId: 'PQC-RSA-003', dependencies: ['JCA provider'] };
    if (alg === 'DESEDE') return { algorithm: `3DES (${t})`, family: '3DES', ruleId: 'PQC-SYM-001', metadata: { transformation: t } };
    if (alg === 'DES') return { algorithm: `DES (${t})`, family: 'DES', ruleId: 'PQC-SYM-001' };
    if (alg === 'RC4' || alg === 'ARCFOUR') return { algorithm: 'RC4', family: 'RC4', ruleId: 'PQC-SYM-001' };
    if (alg === 'AES') {
      const size = Number(e.code.match(/\.init\(\s*(128|192|256)\s*\)/)?.[1]) || null;
      const fam = size === 128 ? 'AES-128' : 'AES-256';
      return { algorithm: `AES${size ? '-' + size : ''} (${t})`, family: fam, keySize: size, ruleId: fam === 'AES-128' ? 'PQC-SYM-002' : 'PQC-INV-001', confidence: size ? 0.9 : 0.6 };
    }
    return null;
  }],
  [/MessageDigest\.getInstance\(\s*"([\w-]+)"/, (m) => {
    const h = hashName(m[1]);
    const fam = hashFamily(h);
    return fam ? { algorithm: h, family: fam, ruleId: fam === 'SHA-1' ? 'PQC-HASH-001' : fam === 'MD5' ? 'PQC-HASH-002' : 'PQC-INV-001' } : null;
  }],
  [/KeyAgreement\.getInstance\(\s*"(ECDH|DH|X25519|XDH)"/, (m) => ({ algorithm: m[1], family: m[1] === 'DH' ? 'DH' : 'ECDH', ruleId: m[1] === 'DH' ? 'PQC-DH-001' : 'PQC-ECC-003' })],
  [/Mac\.getInstance\(\s*"Hmac(SHA1|MD5|SHA256|SHA384|SHA512)"/i, (m) => {
    const h = hashName(m[1]);
    return { algorithm: `HMAC-${h.replace('-', '')}`, family: h === 'SHA-1' ? 'HMAC-SHA1' : h === 'MD5' ? 'MD5' : 'HMAC', ruleId: h === 'SHA-1' || h === 'MD5' ? 'PQC-HASH-001' : 'PQC-INV-001' };
  }],
  [/KeyGenerator\.getInstance\(\s*"(AES|DESede|DES)"/, (m, e) => {
    if (m[1] !== 'AES') return { algorithm: m[1] === 'DES' ? 'DES' : '3DES', family: m[1] === 'DES' ? 'DES' : '3DES', ruleId: 'PQC-SYM-001' };
    const size = Number(e.win.match(/\.init\(\s*(\d+)/)?.[1]) || 128;
    return { algorithm: `AES-${size} key generation`, family: size >= 256 ? 'AES-256' : size === 192 ? 'AES-192' : 'AES-128', keySize: size, ruleId: size === 128 ? 'PQC-SYM-002' : 'PQC-INV-001' };
  }],
  [/static\s+final\s+String\s+(\w*(?:KEY|SECRET|PASSWORD|TOKEN)\w*)\s*=\s*"([^"]{8,})"/i, (m) => ({ algorithm: 'Static secret literal', family: 'SECRET', assetType: 'secret', primitive: 'mac', ruleId: 'PQC-KEY-002', apiCall: `${m[1]} = "<redacted>"`, metadata: { variable: m[1] } })],
];

const COMMENT = { Python: /^\s*#/, Go: /^\s*\/\//, Java: /^\s*(\/\/|\*|\/\*)/, Kotlin: /^\s*(\/\/|\*|\/\*)/ };

function scanWithRules(rel, code, language, rules) {
  const lines = code.split(/\r?\n/);
  const ctx = { rel, language, method: `Semgrep-style rule engine (${language})` };
  const out = [];
  lines.forEach((line, i) => {
    if (COMMENT[language]?.test(line)) return;
    for (const [re, fn] of rules) {
      const m = line.match(re);
      if (!m) continue;
      const d = fn(m, { lines, i, code, win: lookahead(lines, i) });
      if (!d) continue;
      const functionName = enclosingFn(lines, i, language);
      out.push(mk(ctx, { line: i + 1, functionName, snippet: line.trim(), apiCall: d.apiCall || callText(line, m.index, m[0].trim()), confidence: 0.9, ...d }));
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Config / Dockerfile / manifests / certificates / cloud inventory
// ---------------------------------------------------------------------------
const cmpVer = (a, b) => {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
};

function scanDockerfile(rel, code) {
  const lines = code.split(/\r?\n/);
  const ctx = { rel, language: 'Dockerfile', method: 'Container configuration analysis' };
  const out = [];
  lines.forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    const from = line.match(/^\s*FROM\s+([\w./-]+):([\w.-]+)/i);
    if (from) {
      const [, image, tag] = from;
      const v = tag.match(/^\d+(\.\d+)?/)?.[0];
      const base = image.split('/').pop();
      let issue = null;
      if (base === 'node' && v && cmpVer(v, '24') < 0) issue = { algorithm: `Node.js ${v} runtime (OpenSSL 3.0.x — no ML-KEM/ML-DSA)`, target: 'node:24 (OpenSSL 3.5 with native ML-KEM / ML-DSA)' };
      if (base === 'python' && v && cmpVer(v, '3.13') < 0) issue = { algorithm: `Python ${v} runtime (system OpenSSL < 3.5)`, target: 'python:3.13+ on an OpenSSL 3.5 base image, plus liboqs-python' };
      if (base === 'golang' && v && cmpVer(v, '1.24') < 0) issue = { algorithm: `Go ${v} toolchain (no crypto/mlkem, no X25519MLKEM768)`, target: 'golang:1.24+ (crypto/mlkem, hybrid TLS by default)' };
      if (/openjdk|temurin|jdk/.test(base) && v && cmpVer(v, '24') < 0) issue = { algorithm: `JDK ${v} (no ML-KEM/ML-DSA — JEP 496/497 arrive in JDK 24)`, target: 'JDK 24+ or Bouncy Castle 1.80' };
      if (issue) out.push(mk(ctx, { line: i + 1, functionName: '<container>', snippet: line.trim(), apiCall: `FROM ${image}:${tag}`, family: 'LIBRARY', assetType: 'library', primitive: 'other', ruleId: 'PQC-LIB-001', metadata: { image, tag }, ...issue }));
    }
    const req = line.match(/openssl\s+req\b.*-newkey\s+(rsa|ec):?(\d+)?/i);
    if (req) {
      const isRsa = req[1].toLowerCase() === 'rsa';
      out.push(mk(ctx, { line: i + 1, functionName: '<container build>', snippet: line.trim().slice(0, 200), apiCall: req[0], algorithm: isRsa ? `Self-signed X.509 (RSA-${req[2] || 2048}) generated at build` : 'Self-signed X.509 (ECDSA) generated at build', family: isRsa ? 'RSA' : 'ECDSA', keySize: isRsa ? Number(req[2] || 2048) : null, assetType: 'certificate', primitive: 'signature', ruleId: 'PQC-CERT-001', dependencies: ['OpenSSL CLI (container)'] }));
    }
    const gen = line.match(/openssl\s+genrsa\b[^\n]*?\b(\d{3,4})\b/i);
    if (gen) out.push(mk(ctx, { line: i + 1, functionName: '<container build>', snippet: line.trim(), apiCall: gen[0], algorithm: `RSA-${gen[1]}`, family: 'RSA', keySize: Number(gen[1]), ruleId: 'PQC-RSA-002' }));
  });
  return out;
}

function scanConfig(rel, code) {
  const lines = code.split(/\r?\n/);
  const ctx = { rel, language: 'Config', method: 'Configuration rule engine' };
  const out = [];
  const push = (i, d) => out.push(mk(ctx, { line: i + 1, functionName: '<config>', snippet: lines[i].trim(), apiCall: lines[i].trim(), assetType: 'protocol', ...d }));
  lines.forEach((line, i) => {
    if (/^\s*[#;]/.test(line)) return;
    let m;
    if ((m = line.match(/^\s*ssl_protocols\s+([^;]+);/))) {
      if (!/TLSv1\.3/.test(m[1])) push(i, { algorithm: `TLS protocols: ${m[1].trim()}`, family: 'TLS', ruleId: 'PQC-TLS-002', quantumStatus: /TLSv1(\.1)?\b(?!\.2)/.test(m[1].replace(/TLSv1\.2/g, '')) ? 'broken' : 'vulnerable', target: 'TLSv1.3 (required for hybrid ML-KEM key exchange)' });
    }
    if ((m = line.match(/^\s*ssl_ecdh_curve\s+([^;]+);/))) {
      if (!/mlkem/i.test(m[1])) push(i, { algorithm: `TLS ECDHE (${m[1].trim()})`, family: 'TLS', primitive: 'key-agree', ruleId: 'PQC-TLS-001', target: 'ssl_ecdh_curve X25519MLKEM768:X25519 (OpenSSL 3.5+)' });
      else push(i, { algorithm: `TLS hybrid (${m[1].trim()})`, family: 'ML-KEM', ruleId: 'PQC-INV-001' });
    }
    if ((m = line.match(/^\s*ssl_ciphers\s+([^;]+);/)) && /RSA/.test(m[1])) {
      push(i, { algorithm: 'TLS ECDHE-RSA cipher suites', family: 'RSA', primitive: 'signature', ruleId: 'PQC-TLS-001', metadata: { ciphers: m[1].split(':') }, target: 'TLS 1.3 suites + ML-DSA / composite server certificate' });
    }
    if ((m = line.match(/(enabled-protocols|ssl\.protocol|tls[.-]version|protocols)\s*[=:]\s*(.*TLSv1(?:\.[01])?\b.*)$/i)) && /TLSv1(\.1|\.0)?(,|\s|$)/.test(m[2])) {
      push(i, { algorithm: `Legacy TLS enabled (${m[2].trim()})`, family: 'TLS', ruleId: 'PQC-TLS-002', quantumStatus: 'broken', target: 'TLSv1.3 only' });
    }
    if ((m = line.match(/([\w.-]*jwt[\w.-]*algorithm)\s*[=:]\s*["']?(RS|ES|PS)(\d{3})/i))) {
      const fam = m[2].toUpperCase() === 'ES' ? 'ECDSA' : 'RSA';
      push(i, { algorithm: `JWT ${m[2]}${m[3]} (${fam})`, family: fam, assetType: 'algorithm', primitive: 'signature', ruleId: 'PQC-JWT-001' });
    }
  });
  return out;
}

const JS_LIBS = {
  'node-rsa': { note: 'RSA-only library — no PQC primitives', target: 'node:crypto ML-KEM/ML-DSA (Node 24+) or liboqs bindings' },
  'node-forge': { note: 'Pure-JS RSA/X.509 toolkit — no PQC primitives', target: 'node:crypto (OpenSSL 3.5) for ML-DSA certificates' },
  jsonwebtoken: { note: 'Supports RS/ES/HS algorithms only — no ML-DSA JOSE support', target: 'PQC-capable JOSE library once ML-DSA JOSE is standardised; hybrid tokens meanwhile' },
  'crypto-js': { note: 'Unmaintained (archived 2023) — no PQC, legacy SHA-1/MD5 APIs', target: 'node:crypto / WebCrypto' },
  elliptic: { note: 'ECC-only library — no PQC', target: 'node:crypto ML-DSA' },
};
const PY_LIBS = {
  cryptography: { note: 'No ML-KEM/ML-DSA API in this version', target: 'liboqs-python alongside cryptography ≥ 44' },
  pycryptodome: { note: 'No PQC primitives', target: 'liboqs-python (ML-KEM / ML-DSA)' },
  pyjwt: { note: 'Supports RS/ES/HS only — no ML-DSA', target: 'Hybrid tokens / PQC-capable JOSE' },
  pyopenssl: { note: 'Bound to system OpenSSL; PQC requires OpenSSL 3.5', target: 'OpenSSL 3.5 base image' },
};

function scanManifest(rel, code) {
  const base = path.basename(rel);
  const lines = code.split(/\r?\n/);
  const ctx = { rel, language: 'Manifest', method: 'Dependency analysis' };
  const out = [];
  const lineOf = (needle) => Math.max(1, lines.findIndex((l) => l.includes(needle)) + 1);
  const lib = (name, version, info, needle, safe = false) =>
    out.push(mk(ctx, {
      line: lineOf(needle), functionName: '<dependencies>', snippet: lines[lineOf(needle) - 1]?.trim(), apiCall: `${name}@${version}`,
      algorithm: `${name} ${version}`, family: safe ? 'ML-KEM' : 'LIBRARY', assetType: 'library', primitive: 'other', ruleId: safe ? 'PQC-INV-001' : 'PQC-LIB-001',
      quantumStatus: safe ? 'pqc' : 'unsupported', target: info.target, metadata: { package: name, version, note: info.note, ecosystem: base },
    }));
  if (base === 'package.json') {
    try {
      const pkg = JSON.parse(code);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [name, ver] of Object.entries(deps)) {
        if (JS_LIBS[name]) lib(name, ver, JS_LIBS[name], `"${name}"`);
        if (['@noble/post-quantum', 'liboqs-node'].includes(name)) lib(name, ver, { note: 'PQC library', target: 'No change' }, `"${name}"`, true);
      }
    } catch { /* invalid JSON — ignore */ }
  } else if (base === 'requirements.txt' || base === 'Pipfile') {
    lines.forEach((l) => {
      const m = l.match(/^\s*([A-Za-z0-9_.-]+)\s*(?:==|>=|~=)?\s*([\w.]+)?/);
      if (!m || l.trim().startsWith('#')) return;
      const name = m[1].toLowerCase();
      if (PY_LIBS[name]) lib(m[1], m[2] || '*', PY_LIBS[name], m[1]);
      if (name === 'liboqs-python' || name === 'oqs') lib(m[1], m[2] || '*', { note: 'Open Quantum Safe bindings', target: 'No change' }, m[1], true);
    });
  } else if (base === 'pom.xml') {
    const re = /<artifactId>(bcprov-[\w-]+)<\/artifactId>\s*<version>([\w.]+)<\/version>/g;
    let m;
    while ((m = re.exec(code))) {
      const ok = m[1].includes('jdk18on') && cmpVer(m[2], '1.79') >= 0;
      lib(m[1], m[2], { note: ok ? 'Bouncy Castle with FIPS 203/204 ML-KEM/ML-DSA' : 'Bouncy Castle release without final ML-KEM/ML-DSA (FIPS 203/204) support', target: 'org.bouncycastle:bcprov-jdk18on:1.80' }, m[1], ok);
    }
  } else if (base === 'go.mod') {
    const gv = code.match(/^go\s+([\d.]+)/m)?.[1];
    if (gv && cmpVer(gv, '1.24') < 0) lib('go', gv, { note: 'Go toolchain before 1.24 lacks crypto/mlkem and default X25519MLKEM768', target: 'go 1.24+' }, `go ${gv}`);
    if (/open-quantum-safe\/liboqs-go/.test(code)) lib('liboqs-go', '*', { note: 'Open Quantum Safe Go bindings', target: 'No change' }, 'liboqs-go', true);
  }
  return out;
}

function scanCertificates(rel, code) {
  const out = [];
  const lines = code.split(/\r?\n/);
  const ctx = { rel, language: 'Certificate', method: 'X.509 parser (node:crypto)' };
  const re = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
  let m;
  while ((m = re.exec(code))) {
    const line = code.slice(0, m.index).split(/\r?\n/).length;
    try {
      const cert = new crypto.X509Certificate(m[0]);
      const kt = cert.publicKey.asymmetricKeyType;
      const det = cert.publicKey.asymmetricKeyDetails || {};
      const cn = (cert.subject.match(/CN=([^\n,]+)/) || [])[1] || cert.subject;
      let algorithm;
      let family;
      if (kt === 'rsa' || kt === 'rsa-pss') { algorithm = `RSA-${det.modulusLength}`; family = 'RSA'; }
      else if (kt === 'ec') { algorithm = `ECDSA-${curveName(det.namedCurve)}`; family = 'ECDSA'; }
      else if (kt === 'ed25519' || kt === 'ed448') { algorithm = kt === 'ed25519' ? 'Ed25519' : 'Ed448'; family = 'EdDSA'; }
      else if (/ml-dsa/.test(kt)) { algorithm = kt.toUpperCase(); family = 'ML-DSA'; }
      else { algorithm = kt || 'unknown'; family = 'RSA'; }
      out.push(mk(ctx, {
        line, endLine: line + m[0].split(/\r?\n/).length - 1, functionName: '<certificate>', snippet: `CN=${cn} · valid to ${cert.validTo}`,
        apiCall: `X.509 subject: CN=${cn}`, algorithm: `X.509 ${algorithm}`, family, keySize: det.modulusLength || null, assetType: 'certificate', primitive: 'signature',
        ruleId: family === 'ML-DSA' ? 'PQC-INV-001' : 'PQC-CERT-001', confidence: 0.99,
        metadata: { subject: cert.subject.replace(/\n/g, ', '), issuer: cert.issuer.replace(/\n/g, ', '), validFrom: cert.validFrom, validTo: cert.validTo, serialNumber: cert.serialNumber, fingerprint256: cert.fingerprint256, selfSigned: cert.subject === cert.issuer, keyType: kt, curve: det.namedCurve || null },
      }));
    } catch (e) {
      out.push(mk(ctx, { line, functionName: '<certificate>', snippet: lines[line - 1], algorithm: 'X.509 (unparseable)', family: 'RSA', assetType: 'certificate', ruleId: 'PQC-CERT-001', confidence: 0.5, metadata: { parseError: e.message } }));
    }
  }
  return out;
}

function scanPrivateKeyLiterals(rel, code, language) {
  const out = [];
  const lines = code.split(/\r?\n/);
  lines.forEach((l, i) => {
    const m = l.match(/-----BEGIN ((?:RSA|EC|DSA|ENCRYPTED|OPENSSH) )?PRIVATE KEY-----/);
    if (!m) return;
    const kind = (m[1] || '').trim();
    out.push(mk({ rel, language, method: 'Secret pattern detection' }, { line: i + 1, functionName: '<file>', snippet: l.trim(), apiCall: '<PEM private key>', algorithm: kind === 'EC' ? 'EC private key (PEM)' : kind === 'RSA' ? 'RSA private key (PEM)' : 'Private key (PEM)', family: 'KEY', assetType: 'key', primitive: 'pke', ruleId: 'PQC-KEY-001', confidence: 0.99, metadata: { keyType: kind || 'unknown', secured: false } }));
  });
  return out;
}

function scanCloudInventory(rel, code) {
  const out = [];
  let inv;
  try { inv = JSON.parse(code); } catch { return out; }
  const base = { language: 'Cloud (AWS)', method: 'Cloud inventory analysis' };
  const add = (res, d) => out.push(mk({ rel: res, ...base }, { line: null, functionName: '<cloud resource>', snippet: d.apiCall, ...d }));
  for (const k of inv.kms || []) {
    const spec = k.keySpec || '';
    const res = `aws://kms/${inv.region}/${k.alias}`;
    if (/^RSA_(\d+)/.test(spec)) add(res, { apiCall: `KMS ${k.alias} ${spec} ${k.keyUsage}`, algorithm: `RSA-${spec.split('_')[1]} (KMS)`, family: 'RSA', keySize: Number(spec.split('_')[1]), assetType: 'key', primitive: k.keyUsage === 'SIGN_VERIFY' ? 'signature' : 'pke', ruleId: 'PQC-CLOUD-001', target: k.keyUsage === 'SIGN_VERIFY' ? 'KMS ML_DSA_65 key spec' : 'Hybrid envelope (ML-KEM-768 + AES-256)' });
    else if (/^ECC_/.test(spec)) add(res, { apiCall: `KMS ${k.alias} ${spec} ${k.keyUsage}`, algorithm: `ECDSA-P256 (KMS)`, family: 'ECDSA', assetType: 'key', primitive: 'signature', ruleId: 'PQC-CLOUD-001', target: 'KMS ML_DSA_65 key spec' });
    else if (/^ML_DSA/.test(spec)) add(res, { apiCall: `KMS ${k.alias} ${spec}`, algorithm: spec.replace(/_/g, '-'), family: 'ML-DSA', assetType: 'key', ruleId: 'PQC-INV-001' });
    else add(res, { apiCall: `KMS ${k.alias} ${spec}`, algorithm: 'AES-256-GCM (KMS symmetric)', family: 'AES-256', assetType: 'key', ruleId: 'PQC-INV-001' });
  }
  for (const c of inv.acm || []) {
    const rsa = /^RSA_(\d+)/.exec(c.keyAlgorithm || '');
    add(`aws://acm/${inv.region}/${c.domain}`, { apiCall: `ACM ${c.domain} ${c.keyAlgorithm}`, algorithm: rsa ? `X.509 RSA-${rsa[1]}` : 'X.509 ECDSA-P-256', family: rsa ? 'RSA' : 'ECDSA', keySize: rsa ? Number(rsa[1]) : null, assetType: 'certificate', primitive: 'signature', ruleId: 'PQC-CLOUD-002', metadata: { validTo: c.notAfter } });
  }
  for (const lb of inv.elb || []) {
    const pq = /-PQ-/i.test(lb.sslPolicy);
    add(`aws://elb/${inv.region}/${lb.name}`, { apiCall: `ELB ${lb.name} ${lb.sslPolicy}`, algorithm: pq ? `TLS PQ hybrid (${lb.sslPolicy})` : `TLS policy ${lb.sslPolicy}`, family: pq ? 'ML-KEM' : 'TLS', assetType: 'protocol', primitive: 'key-agree', ruleId: pq ? 'PQC-INV-001' : 'PQC-CLOUD-003', target: 'ELBSecurityPolicy-TLS13-1-2-PQ-* (hybrid ML-KEM)' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Scans one file's content. Used by the repository scan and by the Test Agent (re-scan of patches). */
export function scanSource(rel, content) {
  const language = detectLanguage(rel);
  const res = { language, assets: [], nodes: 0, parseError: null, method: null };
  if (!language) return res;
  if (language === 'JavaScript' || language === 'TypeScript') {
    const r = scanJs(rel, content, language);
    Object.assign(res, r, { method: 'ast' });
  } else if (language === 'Python') res.assets = scanWithRules(rel, content, language, PY_RULES);
  else if (language === 'Go') res.assets = scanWithRules(rel, content, language, GO_RULES);
  else if (language === 'Java' || language === 'Kotlin') res.assets = scanWithRules(rel, content, language, JAVA_RULES);
  else if (language === 'Dockerfile') res.assets = scanDockerfile(rel, content);
  else if (language === 'Manifest') res.assets = scanManifest(rel, content);
  else if (language === 'Certificate') res.assets = scanCertificates(rel, content);
  else if (language === 'Cloud Inventory') res.assets = scanCloudInventory(rel, content);
  else if (language === 'Config') res.assets = scanConfig(rel, content);
  if (!['JavaScript', 'TypeScript', 'Certificate', 'Cloud Inventory'].includes(language)) {
    res.assets.push(...scanPrivateKeyLiterals(rel, content, language));
  }
  return res;
}

export function listFiles(root) {
  const files = [];
  const walk = (dir) => {
    if (files.length >= MAX_FILES) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name.startsWith('.') && ent.name !== '.env.example') continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(abs);
      } else if (ent.isFile()) {
        const rel = path.relative(root, abs).split(path.sep).join('/');
        const language = detectLanguage(rel);
        if (!language) continue;
        const size = fs.statSync(abs).size;
        if (size > MAX_FILE_BYTES) continue;
        files.push({ abs, rel, language, size });
      }
    }
  };
  walk(root);
  return files;
}

/**
 * Full repository scan in the six PPT stages. `onStage(key, progress, message)`
 * reports progress; `pace` adds visual pacing between stages.
 */
export async function scanDirectory(root, { onStage = () => {}, pace = async () => {} } = {}) {
  const t0 = Date.now();
  const timings = {};
  const mark = (k, s) => { timings[k] = Date.now() - s; };

  // 1. Repository ingestion
  let s = Date.now();
  onStage('ingestion', 10, 'Enumerating files');
  const files = listFiles(root);
  const languages = {};
  let loc = 0;
  for (const f of files) {
    f.content = fs.readFileSync(f.abs, 'utf8');
    f.lines = f.content.split(/\r?\n/).length;
    loc += f.lines;
    languages[f.language] = (languages[f.language] || 0) + f.lines;
  }
  mark('ingestion', s);
  onStage('ingestion', 100, `${files.length} files · ${loc.toLocaleString()} lines ingested`);
  await pace();

  // 2. AST parsing (+ 4. crypto API detection happens per file)
  s = Date.now();
  let astNodes = 0;
  let astFiles = 0;
  const parseErrors = [];
  const perFile = [];
  const codeFiles = files.filter((f) => CODE_LANGS.has(f.language));
  for (const [idx, f] of files.entries()) {
    const r = scanSource(f.rel, f.content);
    if (r.method === 'ast') { astFiles++; astNodes += r.nodes; }
    if (r.parseError) parseErrors.push({ file: f.rel, error: r.parseError });
    perFile.push({ file: f, result: r });
    if (idx % 5 === 0) onStage('ast', Math.round(((idx + 1) / files.length) * 100), `Parsed ${f.rel}`);
  }
  mark('ast', s);
  onStage('ast', 100, `${astFiles} JS/TS files → ${astNodes.toLocaleString()} AST nodes; ${codeFiles.length - astFiles} files via language rules`);
  await pace();

  // 3. Semantic analysis — dedupe + dependency linking
  s = Date.now();
  let assets = perFile.flatMap((p) => p.result.assets);
  const seen = new Set();
  assets = assets.filter((a) => {
    const k = `${a.file}|${a.line}|${a.ruleId}|${a.algorithm}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const byFile = new Map();
  for (const a of assets) {
    if (!byFile.has(a.file)) byFile.set(a.file, []);
    byFile.get(a.file).push(a);
  }
  for (const a of assets) {
    const siblings = byFile.get(a.file).filter((b) => b !== a && !['safe', 'pqc'].includes(b.quantumStatus)).slice(0, 3);
    a.dependencies = [...new Set([...(a.dependencies || []), ...siblings.map((b) => `${b.algorithm} @ line ${b.line ?? '—'}`)])];
  }
  mark('semantic', s);
  onStage('semantic', 100, `Resolved enclosing functions, data context and ${assets.reduce((n, a) => n + a.dependencies.length, 0)} dependency links`);
  await pace();

  // 4. Crypto API detection summary
  const vulnerable = assets.filter((a) => !['safe', 'pqc'].includes(a.quantumStatus));
  onStage('detection', 100, `${assets.length} cryptographic assets (${vulnerable.length} quantum-vulnerable or weak)`);
  await pace();

  // 5. Dependency analysis summary
  const libs = assets.filter((a) => a.assetType === 'library');
  onStage('dependencies', 100, `${libs.length} crypto libraries/runtimes flagged across manifests & containers`);
  await pace();

  return {
    files: files.map(({ rel, language, lines, size }) => ({ rel, language, lines, size })),
    assets,
    stats: { files: files.length, loc, languages, astNodes, astFiles, parseErrors, durationMs: Date.now() - t0, timings, rules: 'PQC rule pack v1.0' },
  };
}
