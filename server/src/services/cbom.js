import crypto from 'node:crypto';
import { FAMILIES, PQC_TARGETS } from './catalog.js';

/**
 * CycloneDX 1.5 Cryptography Bill of Materials (CBOM) generator.
 * Produces `cryptographic-asset` components (algorithm, certificate,
 * related-crypto-material, protocol) plus `library` components, with
 * evidence.occurrences pointing at each call site.
 */

const NIST_Q = { safe: 1, pqc: 3 };
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function functionsFor(a) {
  switch (a.primitive) {
    case 'signature': return ['sign', 'verify', 'keygen'];
    case 'pke': return ['encrypt', 'decrypt', 'keygen'];
    case 'kem': return ['encapsulate', 'decapsulate', 'keygen'];
    case 'key-agree': return ['keygen', 'keyderive'];
    case 'hash': return ['digest'];
    case 'mac': return ['tag'];
    case 'block-cipher':
    case 'ae': return ['encrypt', 'decrypt'];
    default: return ['other'];
  }
}

const qProps = (a, risk) => [
  { name: 'quantumshift:quantumStatus', value: a.quantum_status },
  { name: 'quantumshift:riskLevel', value: risk?.risk_level || 'n/a' },
  { name: 'quantumshift:riskScore', value: String(risk?.risk_score ?? 'n/a') },
  { name: 'quantumshift:ruleId', value: a.rule_id },
  { name: 'quantumshift:migrationTarget', value: a.target_algorithm || 'n/a' },
  { name: 'quantumshift:detectionMethod', value: a.detection_method || 'n/a' },
  { name: 'quantumshift:function', value: a.function_name || 'n/a' },
  { name: 'quantumshift:line', value: String(a.line ?? 'n/a') },
];

/** Builds the CycloneDX component for one crypto asset row. */
export function componentFor(a, risk) {
  const bomRef = `crypto/${a.asset_type}/${slug(a.algorithm)}@${slug(a.file_path)}:${a.line ?? 0}`;
  const occurrence = { location: a.line ? `${a.file_path}#L${a.line}` : a.file_path, additionalContext: a.api_call || a.snippet || undefined };
  const fam = FAMILIES[a.family] || {};

  if (a.asset_type === 'library') {
    return {
      type: 'library',
      'bom-ref': `lib/${slug(a.metadata?.package || a.algorithm)}@${slug(a.metadata?.version || '')}`,
      name: a.metadata?.package || a.algorithm,
      version: a.metadata?.version || undefined,
      description: a.metadata?.note,
      evidence: { occurrences: [occurrence] },
      properties: qProps(a, risk),
    };
  }

  const base = { type: 'cryptographic-asset', 'bom-ref': bomRef, name: a.algorithm, evidence: { occurrences: [occurrence] }, properties: qProps(a, risk) };

  if (a.asset_type === 'certificate') {
    const md = a.metadata || {};
    return {
      ...base,
      cryptoProperties: {
        assetType: 'certificate',
        certificateProperties: {
          subjectName: md.subject || undefined,
          issuerName: md.issuer || undefined,
          notValidBefore: md.validFrom ? new Date(md.validFrom).toISOString() : undefined,
          notValidAfter: md.validTo ? new Date(md.validTo).toISOString() : undefined,
          signatureAlgorithmRef: `crypto/algorithm/${slug(a.family)}`,
          subjectPublicKeyRef: `crypto/key/${slug(a.algorithm)}`,
          certificateFormat: 'X.509',
          certificateExtension: a.file_path.split('.').pop(),
        },
        oid: fam.oid || undefined,
      },
    };
  }

  if (a.asset_type === 'key' || a.asset_type === 'secret') {
    return {
      ...base,
      cryptoProperties: {
        assetType: 'related-crypto-material',
        relatedCryptoMaterialProperties: {
          type: a.asset_type === 'secret' ? 'secret-key' : a.algorithm.includes('KMS') ? 'private-key' : 'private-key',
          size: a.key_size || undefined,
          format: a.asset_type === 'key' && !a.file_path.startsWith('aws://') ? 'PEM' : undefined,
          secured: a.file_path.startsWith('aws://') ? { mechanism: 'AWS KMS (HSM-backed)' } : undefined,
          state: 'active',
        },
        oid: fam.oid || undefined,
      },
    };
  }

  if (a.asset_type === 'protocol') {
    return {
      ...base,
      cryptoProperties: {
        assetType: 'protocol',
        protocolProperties: {
          type: 'tls',
          version: /1\.3/.test(a.algorithm) ? '1.3' : /1\.1/.test(a.algorithm) ? '1.1' : '1.2',
          cipherSuites: (a.metadata?.ciphers || []).map((c) => ({ name: c })),
        },
      },
    };
  }

  return {
    ...base,
    cryptoProperties: {
      assetType: 'algorithm',
      algorithmProperties: {
        primitive: a.primitive || 'other',
        parameterSetIdentifier: a.key_size ? String(a.key_size) : a.metadata?.curve || undefined,
        curve: a.metadata?.curve || undefined,
        executionEnvironment: 'software-plain-ram',
        implementationPlatform: 'generic',
        certificationLevel: ['none'],
        mode: a.metadata?.mode ? a.metadata.mode.toLowerCase() : undefined,
        cryptoFunctions: functionsFor(a),
        classicalSecurityLevel: fam.classical ?? undefined,
        nistQuantumSecurityLevel: NIST_Q[a.quantum_status] ?? 0,
      },
      oid: fam.oid || undefined,
    },
  };
}

/** Full CycloneDX 1.5 document for one or more repositories. */
export function buildCbom({ repos, assets, risks, mode }) {
  const riskBy = new Map(risks.map((r) => [r.crypto_asset_id, r]));
  const components = [];
  const seenRefs = new Set();
  const libRefs = new Map();
  const deps = new Map();

  for (const a of assets) {
    const c = componentFor(a, riskBy.get(a.id));
    if (seenRefs.has(c['bom-ref'])) {
      const existing = components.find((x) => x['bom-ref'] === c['bom-ref']);
      existing.evidence.occurrences.push(...c.evidence.occurrences);
      continue;
    }
    seenRefs.add(c['bom-ref']);
    components.push(c);
    if (c.type === 'library') libRefs.set(a.repository_id + ':' + c.name, c['bom-ref']);
  }
  for (const a of assets) {
    if (a.asset_type === 'library') continue;
    const repoRef = `app/${a.repository_id}`;
    if (!deps.has(repoRef)) deps.set(repoRef, new Set());
    deps.get(repoRef).add(componentFor(a, null)['bom-ref']);
  }

  const single = repos.length === 1 ? repos[0] : null;
  return {
    $schema: 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${crypto.randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: { components: [{ type: 'application', author: 'QuantumShift', name: 'QuantumShift CBOM Generator', version: '1.0.0' }] },
      component: single
        ? { type: 'application', 'bom-ref': `app/${single.id}`, name: single.name, description: single.description || undefined }
        : { type: 'application', 'bom-ref': 'app/portfolio', name: 'Enterprise portfolio', description: `${repos.length} repositories` },
      properties: [
        { name: 'quantumshift:mode', value: mode },
        { name: 'quantumshift:pqcTargets', value: Object.keys(PQC_TARGETS).join(', ') },
      ],
    },
    components,
    dependencies: [...deps.entries()].map(([ref, set]) => ({ ref, dependsOn: [...set] })),
  };
}
