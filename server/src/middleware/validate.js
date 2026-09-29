import { z } from 'zod';
import { httpError } from '../lib/errors.js';

/** Validates req[source] against a zod schema and replaces it with the parsed value. */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const r = schema.safeParse(req[source] ?? {});
  if (!r.success) {
    const details = r.error.issues.map((i) => ({ field: i.path.join('.') || source, message: i.message }));
    return next(httpError(400, `Invalid request: ${details.map((d) => `${d.field} — ${d.message}`).join('; ')}`, details));
  }
  if (source === 'query') req.validQuery = r.data;
  else req[source] = r.data;
  return next();
};

const id = z.coerce.number().int().positive();
const years = z.coerce.number().min(0).max(200);

export const S = {
  id,
  login: z.object({ username: z.string().trim().min(2).max(64).regex(/^[a-z0-9._-]+$/i) }),
  settings: z.object({ mode: z.enum(['demo', 'real']).optional(), moscaZ: z.coerce.number().min(1).max(60).optional() }).refine((v) => v.mode || v.moscaZ !== undefined, 'Provide mode and/or moscaZ'),
  addRepo: z.discriminatedUnion('sourceType', [
    z.object({ sourceType: z.enum(['github', 'gitlab']), url: z.string().trim().url().max(300), name: z.string().trim().max(80).optional(), criticality: z.enum(['critical', 'high', 'medium', 'low']).optional(), businessUnit: z.string().trim().max(80).optional(), dataClassification: z.string().trim().max(120).optional(), dataLifetimeYears: years.optional(), migrationTimeYears: years.optional() }),
    z.object({ sourceType: z.literal('docker'), dockerImage: z.string().trim().max(200), criticality: z.enum(['critical', 'high', 'medium', 'low']).optional(), dataLifetimeYears: years.optional(), migrationTimeYears: years.optional() }),
    z.object({ sourceType: z.literal('cloud'), cloudSource: z.string().trim().max(80), criticality: z.enum(['critical', 'high', 'medium', 'low']).optional(), dataLifetimeYears: years.optional(), migrationTimeYears: years.optional() }),
  ]),
  scan: z.object({ repositoryId: id }),
  astScan: z.object({ filename: z.string().trim().min(1).max(160).regex(/^[\w./-]+$/, 'filename may only contain letters, digits, . / _ -'), code: z.string().min(1).max(200_000) }),
  mosca: z.object({ x: years, y: years, z: years, algorithm: z.string().max(60).optional(), criticality: z.enum(['critical', 'high', 'medium', 'low']).optional() }),
  riskProfile: z.object({ dataLifetimeYears: years, migrationTimeYears: years, criticality: z.enum(['critical', 'high', 'medium', 'low']) }),
  plan: z.object({ strategy: z.enum(['hybrid-first', 'direct-pqc']).default('hybrid-first'), repositoryIds: z.array(id).max(100).optional(), name: z.string().trim().max(120).optional(), teamSize: z.coerce.number().int().min(1).max(50).default(4) }),
  remediate: z.object({ assetId: id }),
  tests: z.object({ remediationJobIds: z.array(id).max(20).optional(), suite: z.enum(['all', 'regression', 'interoperability', 'unit', 'security']).default('all') }),
  createPr: z.object({ remediationJobIds: z.array(id).min(1).max(20), testRunId: z.string().max(64).regex(/^run-[\w-]+$/).optional() }),
  review: z.object({ comment: z.string().trim().max(2000).optional() }),
  assetsQuery: z.object({
    repositoryId: id.optional(), risk: z.enum(['RED', 'YELLOW', 'GREEN']).optional(), family: z.string().max(40).optional(), language: z.string().max(40).optional(),
    type: z.enum(['algorithm', 'key', 'secret', 'certificate', 'protocol', 'library']).optional(), search: z.string().max(120).optional(), file: z.string().max(300).optional(), status: z.string().max(40).optional(),
  }),
  auditQuery: z.object({ search: z.string().max(120).optional(), agent: z.string().max(80).optional(), status: z.enum(['success', 'warning', 'failure', 'pending', 'info']).optional(), limit: z.coerce.number().int().min(1).max(5000).optional() }),
  reportQuery: z.object({ format: z.enum(['json', 'csv', 'md', 'html']).optional(), repositoryId: id.optional(), planId: id.optional(), runId: z.string().max(64).regex(/^run-[\w-]+$/).optional(), search: z.string().max(120).optional(), agent: z.string().max(80).optional(), status: z.string().max(20).optional() }),
};

export { httpError };
