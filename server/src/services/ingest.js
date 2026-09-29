import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { config, SERVER_ROOT } from '../config.js';
import { one, j } from '../db/index.js';
import { httpError } from '../lib/errors.js';

/** Bundled sample enterprise codebases (demo data — no real secrets). */
export const DEMO_REPOS = [
  { slug: 'banking-api', name: 'Banking API', language: 'JavaScript', business_unit: 'Retail Banking', criticality: 'critical', data_classification: 'Financial PII & transaction records', data_lifetime_years: 10, migration_time_years: 2, description: 'Customer authentication, funds transfers and card tokenization (Node.js).', docker: 'registry.demo.local/banking-api:4.2.1' },
  { slug: 'healthcare-platform', name: 'Healthcare Platform', language: 'Python', business_unit: 'Digital Health', criticality: 'critical', data_classification: 'Protected health information (PHI)', data_lifetime_years: 25, migration_time_years: 2.5, description: 'FHIR patient records, clinician sessions and imaging archive (Python).', docker: 'registry.demo.local/healthcare-platform:2.8.0' },
  { slug: 'government-portal', name: 'Government Portal', language: 'Go', business_unit: 'Citizen Services', criticality: 'critical', data_classification: 'Citizen identity records', data_lifetime_years: 30, migration_time_years: 3, description: 'Digital identity assertions and public TLS endpoint (Go).', docker: 'registry.demo.local/citizen-portal:1.9.3' },
  { slug: 'ecommerce-platform', name: 'E-Commerce Platform', language: 'TypeScript', business_unit: 'Online Retail', criticality: 'high', data_classification: 'Orders & payment tokens', data_lifetime_years: 3, migration_time_years: 1.5, description: 'Storefront, cart and checkout services (TypeScript + nginx).', docker: 'registry.demo.local/storefront:7.0.3' },
  { slug: 'legacy-java-enterprise', name: 'Legacy Java Enterprise App', language: 'Java', business_unit: 'Corporate HR / ERP', criticality: 'high', data_classification: 'Employee & payroll records', data_lifetime_years: 15, migration_time_years: 4, description: 'Payroll, SSO and HR batch jobs on Java 8 with Bouncy Castle 1.60.', docker: 'registry.demo.local/hr-erp:3.8.0' },
];

export const DEMO_DOCKER_IMAGES = DEMO_REPOS.map((r) => ({ image: r.docker, slug: r.slug, name: r.name }));
export const DEMO_CLOUD_SOURCES = [{ id: 'aws-demo-us-east-1', name: 'AWS account 0000-0000-0000 · us-east-1 (demo inventory)', path: 'demo-sources/aws-us-east-1' }];

export const repoRoot = (repo) => (path.isAbsolute(repo.storage_path) ? repo.storage_path : path.join(SERVER_ROOT, repo.storage_path));

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'repo';

async function uniqueSlug(base) {
  let slug = slugify(base);
  for (let n = 2; await one('SELECT 1 FROM repositories WHERE slug = $1', [slug]); n++) slug = `${slugify(base)}-${n}`;
  return slug;
}

function sampleFor(text) {
  const t = String(text).toLowerCase();
  if (/health|patient|fhir|med/.test(t)) return 'healthcare-platform';
  if (/gov|citizen|portal|identity/.test(t)) return 'government-portal';
  if (/shop|commerce|store|cart|retail/.test(t)) return 'ecommerce-platform';
  if (/java|legacy|erp|hr|payroll/.test(t)) return 'legacy-java-enterprise';
  return 'banking-api';
}

/** Safely extracts a ZIP (zip-slip protected, size/count limited). Returns the extraction root. */
export function extractZip(buffer, dest) {
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length > 5000) throw httpError(413, 'Archive contains more than 5,000 entries');
  let total = 0;
  fs.mkdirSync(dest, { recursive: true });
  for (const e of entries) {
    if (e.isDirectory) continue;
    const target = path.resolve(dest, e.entryName);
    if (!target.startsWith(path.resolve(dest) + path.sep)) throw httpError(400, `Unsafe path in archive: ${e.entryName}`);
    if (e.header.size > 2 * 1024 * 1024) continue;
    total += e.header.size;
    if (total > 200 * 1024 * 1024) throw httpError(413, 'Archive expands beyond 200 MB');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.getData());
  }
  const top = fs.readdirSync(dest, { withFileTypes: true });
  return top.length === 1 && top[0].isDirectory() ? path.join(dest, top[0].name) : dest;
}

async function downloadArchive(url) {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'QuantumShift-Scanner' } });
  if (!res.ok) throw httpError(502, `Repository download failed (${res.status}). Only public repositories are supported without credentials.`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > 50 * 1024 * 1024) throw httpError(413, 'Repository archive larger than 50 MB');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 50 * 1024 * 1024) throw httpError(413, 'Repository archive larger than 50 MB');
  return buf;
}

async function insertRepo(r) {
  return one(
    `INSERT INTO repositories (name, slug, source_type, source_ref, storage_path, primary_language, business_unit, criticality, data_classification, data_lifetime_years, migration_time_years, description, is_demo, simulated_ingestion, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'registered') RETURNING *`,
    [r.name, r.slug, r.source_type, r.source_ref || null, r.storage_path, r.primary_language || null, r.business_unit || null, r.criticality || 'medium', r.data_classification || null, r.data_lifetime_years ?? 5, r.migration_time_years ?? 2, r.description || null, !!r.is_demo, !!r.simulated_ingestion],
  );
}

export async function registerDemoRepos() {
  for (const d of DEMO_REPOS) {
    if (await one('SELECT 1 FROM repositories WHERE slug = $1', [d.slug])) continue;
    await insertRepo({ ...d, source_type: 'demo', source_ref: `bundled sample: demo-repos/${d.slug}`, storage_path: `demo-repos/${d.slug}`, primary_language: d.language, is_demo: true });
  }
}

/**
 * Registers a repository from GitHub/GitLab, a Docker image, a cloud source or an upload.
 * In DEMO mode remote sources use bundled sample code and are flagged `simulated_ingestion`.
 */
export async function addRepository(input, mode) {
  const meta = {
    criticality: input.criticality || 'medium',
    business_unit: input.businessUnit || null,
    data_classification: input.dataClassification || null,
    data_lifetime_years: input.dataLifetimeYears ?? 5,
    migration_time_years: input.migrationTimeYears ?? 2,
  };

  if (input.sourceType === 'github' || input.sourceType === 'gitlab') {
    const u = new URL(input.url);
    const host = input.sourceType === 'github' ? 'github.com' : 'gitlab.com';
    if (u.hostname !== host) throw httpError(400, `URL must be a ${host} repository URL`);
    const parts = u.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
    if (parts.length < 2) throw httpError(400, 'URL must look like https://' + host + '/owner/repository');
    const [owner, name] = [parts.slice(0, -1).join('/'), parts[parts.length - 1]];
    const slug = await uniqueSlug(input.name || name);
    if (mode === 'real') {
      const archive = input.sourceType === 'github'
        ? `https://codeload.github.com/${owner}/${name}/zip/HEAD`
        : `https://gitlab.com/${owner}/${name}/-/archive/HEAD/${name}-HEAD.zip`;
      const buf = await downloadArchive(archive);
      const root = extractZip(buf, path.join(config.uploadDir, slug));
      return insertRepo({ ...meta, name: input.name || `${owner}/${name}`, slug, source_type: input.sourceType, source_ref: input.url, storage_path: root, description: `Cloned from ${input.url} (HEAD archive).` });
    }
    const sample = sampleFor(input.url);
    return insertRepo({ ...meta, name: input.name || `${owner}/${name}`, slug, source_type: input.sourceType, source_ref: input.url, storage_path: `demo-repos/${sample}`, simulated_ingestion: true, description: `Demo mode: ${input.url} registered; ingestion simulated with bundled sample "${sample}". Switch to Real Integration to download public repositories.` });
  }

  if (input.sourceType === 'docker') {
    if (mode === 'real') throw httpError(501, 'Docker registry integration is not configured on this server (requires Docker Engine access / registry credentials). Use Demo Mode or upload the image source as a ZIP.');
    const img = DEMO_DOCKER_IMAGES.find((d) => d.image === input.dockerImage);
    if (!img) throw httpError(400, 'Unknown demo image — choose one of the listed demo registry images');
    const slug = await uniqueSlug(`${img.slug}-image`);
    return insertRepo({ ...meta, name: `${img.name} (container image)`, slug, source_type: 'docker', source_ref: img.image, storage_path: `demo-repos/${img.slug}`, simulated_ingestion: true, description: `Demo mode: image ${img.image} — layers simulated from the bundled ${img.slug} sample (source + Dockerfile).` });
  }

  if (input.sourceType === 'cloud') {
    if (mode === 'real') throw httpError(501, 'AWS integration requires AWS credentials (AWS_ACCESS_KEY_ID / role), which are not configured. Use Demo Mode to scan the sample inventory.');
    const src = DEMO_CLOUD_SOURCES.find((c) => c.id === input.cloudSource);
    if (!src) throw httpError(400, 'Unknown cloud source');
    const slug = await uniqueSlug(src.id);
    return insertRepo({ ...meta, name: 'AWS Cloud Inventory (us-east-1)', slug, source_type: 'cloud', source_ref: src.id, storage_path: src.path, primary_language: 'Cloud (AWS)', simulated_ingestion: true, description: 'Demo inventory export of KMS keys, ACM certificates and load-balancer TLS policies (synthetic data).' });
  }
  throw httpError(400, 'Unsupported source type');
}

export async function addUploadedRepository(file, fields) {
  if (!file) throw httpError(400, 'A .zip file is required');
  if (!/\.zip$/i.test(file.originalname)) throw httpError(400, 'Only .zip archives are accepted');
  const base = fields.name || file.originalname.replace(/\.zip$/i, '');
  const slug = await uniqueSlug(base);
  const dest = path.join(config.uploadDir, `${slug}-${crypto.randomBytes(3).toString('hex')}`);
  const root = extractZip(file.buffer, dest);
  return insertRepo({
    name: base,
    slug,
    source_type: 'upload',
    source_ref: file.originalname,
    storage_path: root,
    criticality: fields.criticality || 'medium',
    business_unit: fields.businessUnit || null,
    data_classification: fields.dataClassification || null,
    data_lifetime_years: Number(fields.dataLifetimeYears) || 5,
    migration_time_years: Number(fields.migrationTimeYears) || 2,
    description: `Uploaded archive ${file.originalname} (${(file.size / 1024).toFixed(0)} KB) — scanned locally, never sent to third parties.`,
  });
}

export const jsonb = j;
