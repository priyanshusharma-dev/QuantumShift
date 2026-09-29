import { config, watsonxConfigured } from '../config.js';
import { threatFor } from './risk.js';

/**
 * IBM Granite-style risk explanations.
 * DEMO MODE: explanations are produced by a deterministic template engine and
 * labelled "AI-generated explanation — Demo Mode". When mode = real and
 * WATSONX_API_KEY / WATSONX_PROJECT_ID are configured, the same prompt is sent to
 * an IBM Granite model on watsonx.ai; any failure falls back to the template.
 */

const DEMO_LABEL = 'AI-generated explanation — Demo Mode (template engine; IBM Granite not connected)';

const ACTIONS = {
  RSA: (a) => [
    a.primitive === 'pke'
      ? 'Replace RSA key transport with ML-KEM-768 encapsulation; derive an AES-256-GCM key from the shared secret.'
      : 'Replace RSA signatures with ML-DSA-65 (FIPS 204); keep RSA verification only for legacy inbound traffic during the transition.',
    'Deploy in hybrid mode first (classical + PQC) so partners without PQC support keep working.',
    'Rotate and destroy the old RSA keys once all consumers verify PQC signatures.',
  ],
  ECDSA: () => ['Replace ECDSA with ML-DSA-65 signatures.', 'Re-issue dependent tokens/certificates and update verifiers.', 'Monitor signature size (3,309 bytes vs 64–72 bytes) in headers and tokens.'],
  ECC: () => ['Replace elliptic-curve keys with ML-DSA-65 (signing) or ML-KEM-768 (key agreement).', 'Update every consumer of the public key.'],
  ECDH: () => ['Switch key agreement to the X25519MLKEM768 hybrid, then to pure ML-KEM-768.', 'Harvest-now-decrypt-later applies: prioritise before signature migrations.'],
  EdDSA: () => ['Replace Ed25519 with ML-DSA-65.'],
  DH: () => ['Replace Diffie-Hellman with ML-KEM-768 (hybrid first).'],
  DSA: () => ['Replace DSA with ML-DSA-65.'],
  'SHA-1': () => ['Replace SHA-1 with SHA-256 (or SHA3-256).', 'Recompute stored digests or keep dual digests during migration.'],
  MD5: () => ['Replace MD5 with SHA-256.', 'If the value is only a cache key, the change is safe; if it is persisted, re-hash stored values.'],
  '3DES': () => ['Replace 3DES with AES-256-GCM.', 'Re-encrypt stored ciphertexts with the new key during a maintenance window.'],
  DES: () => ['Replace DES with AES-256-GCM.'],
  'AES-128': () => ['Move to 256-bit AES keys (AES-256-GCM).', 'Prefer authenticated modes (GCM) over CBC.'],
  KEY: () => ['Remove the literal key from source and git history.', 'Store keys in an HSM/KMS and reference them by ID.', 'Rotate the key — generate the replacement as ML-DSA-65.'],
  SECRET: () => ['Move the secret to a secrets manager / environment variable.', 'Rotate the exposed value immediately.'],
  TLS: () => ['Enable TLS 1.3 with the X25519MLKEM768 hybrid group (OpenSSL 3.5+, Go 1.24+).', 'Keep X25519 as fallback for legacy clients.'],
  LIBRARY: (a) => [`Upgrade: ${a.target_algorithm || 'a PQC-capable release'}.`, 'Run the regression suite after upgrading.'],
};

export function templateExplanation(asset, assessment, repo) {
  const fam = asset.family || 'RSA';
  const loc = asset.line ? `${asset.file_path}:${asset.line}` : asset.file_path;
  const fn = asset.function_name && !asset.function_name.startsWith('<') ? ` in \`${asset.function_name}()\`` : '';
  const data = asset.data_context || repo.data_classification || 'application data';
  const level = assessment.level;
  const isSafe = level === 'GREEN';

  const summary = isSafe
    ? `${asset.algorithm} at ${loc}${fn} is quantum-resistant. It is recorded in the CBOM for completeness; no migration is required.`
    : `${asset.algorithm} at ${loc}${fn} is ${asset.quantum_status === 'broken' ? 'already classically broken' : asset.quantum_status === 'exposed' ? 'exposed key material' : 'vulnerable to future quantum attacks'}. ` +
      (fam === 'RSA' || fam === 'ECDSA' || fam === 'ECDH' || fam === 'ECC' || fam === 'TLS'
        ? `${threatFor(fam)} Because this asset protects ${data.toLowerCase()} with a ${assessment.x}-year confidentiality requirement, `
        : `${threatFor(fam)} Because this asset protects ${data.toLowerCase()}, `) +
      (level === 'RED' ? 'migration should begin immediately.' : 'migration should be scheduled in the current roadmap.');

  return {
    label: DEMO_LABEL,
    source: 'template',
    model: 'quantumshift-template-v1',
    summary,
    whyRisky: isSafe ? threatFor(fam) : `${threatFor(fam)} Mosca check: X(${assessment.x}) + Y(${assessment.y}) ${assessment.exposed ? '>' : '≤'} Z(${assessment.z}) → ${assessment.exposed ? `${assessment.margin} year(s) of exposure` : `${Math.abs(assessment.margin)} year(s) of headroom`}. ${assessment.rationale}`,
    dataAffected: `${data} in ${repo.name} (${repo.business_unit || 'business unit n/a'}, criticality ${String(assessment.criticality).toUpperCase()}).`,
    recommendation: isSafe ? 'No change required.' : `Migrate to ${asset.target_algorithm}.`,
    dependencies: (asset.dependencies || []).length ? asset.dependencies : ['No other cryptographic dependencies detected in this file.'],
    developerActions: isSafe ? ['Keep using this primitive; re-verify during the next crypto-agility review.'] : (ACTIONS[fam] || ACTIONS.RSA)(asset),
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Optional real integration: IBM Granite on watsonx.ai
// ---------------------------------------------------------------------------
let iamToken = null;
let iamExpiry = 0;

async function getIamToken() {
  if (iamToken && Date.now() < iamExpiry - 60_000) return iamToken;
  const res = await fetch('https://iam.cloud.ibm.com/identity/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ibm:params:oauth:grant-type:apikey', apikey: config.watsonx.apiKey }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`IBM Cloud IAM returned ${res.status}`);
  const body = await res.json();
  iamToken = body.access_token;
  iamExpiry = Date.now() + (body.expires_in || 3600) * 1000;
  return iamToken;
}

async function graniteExplanation(asset, assessment, repo) {
  const base = templateExplanation(asset, assessment, repo);
  const prompt = `You are a post-quantum cryptography advisor. In plain language (max 90 words), explain to a developer why the following finding matters and what to do.
Finding: ${asset.algorithm} (${asset.rule_id}) in ${asset.file_path}:${asset.line ?? '-'} function ${asset.function_name}.
Protects: ${asset.data_context || repo.data_classification}. Risk: ${assessment.level}, Mosca X=${assessment.x} Y=${assessment.y} Z=${assessment.z}.
Recommended target: ${asset.target_algorithm}.`;
  const token = await getIamToken();
  const res = await fetch(`${config.watsonx.url}/ml/v1/text/generation?version=2024-05-31`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ model_id: config.watsonx.modelId, project_id: config.watsonx.projectId, input: prompt, parameters: { decoding_method: 'greedy', max_new_tokens: 220 } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`watsonx.ai returned ${res.status}`);
  const body = await res.json();
  const text = body.results?.[0]?.generated_text?.trim();
  if (!text) throw new Error('Empty Granite response');
  return { ...base, summary: text, label: `AI-generated explanation — IBM Granite (${config.watsonx.modelId}) via watsonx.ai`, source: 'watsonx', model: config.watsonx.modelId };
}

/** Returns an explanation; uses Granite only in real mode with credentials configured. */
export async function explain(asset, assessment, repo, mode) {
  if (mode === 'real' && watsonxConfigured()) {
    try {
      return await graniteExplanation(asset, assessment, repo);
    } catch (e) {
      return { ...templateExplanation(asset, assessment, repo), fallbackReason: `Granite call failed (${e.message}); template explanation shown.` };
    }
  }
  const exp = templateExplanation(asset, assessment, repo);
  if (mode === 'real') exp.fallbackReason = 'Real Integration mode is on, but WATSONX_API_KEY / WATSONX_PROJECT_ID are not configured.';
  return exp;
}

/** Explains a generated patch (Code Mode → "Explain Changes"). */
export function explainPatch(job) {
  const lines = job.changes.map((c) => `• ${c.from} → ${c.to} (${c.file}:${c.line}) — ${c.rationale}`);
  const manual = job.changes.filter((c) => c.confidence < 0.7);
  return {
    label: DEMO_LABEL,
    source: 'template',
    summary: `This patch migrates ${job.changes.length} cryptographic call site(s) in ${job.file_path} to NIST post-quantum or quantum-resistant primitives using a liboqs-style adapter (${job.adapter || 'pqc adapter'}).`,
    changes: lines,
    compatibility: 'Hybrid-first: classical verification paths can stay enabled behind a feature flag until all consumers accept PQC signatures / key encapsulation.',
    reviewNotes: manual.length
      ? `${manual.length} change(s) have low confidence and are marked TODO(quantumshift) for manual review.`
      : 'All changes are mechanical API substitutions with high confidence; review key-management follow-ups.',
    generatedAt: new Date().toISOString(),
  };
}
