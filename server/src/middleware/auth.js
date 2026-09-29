import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { httpError } from '../lib/errors.js';

/**
 * Authentication-ready structure: demo SSO issues a signed JWT for one of the
 * seeded demo users (no passwords). Swap `login` for OIDC/SAML in production;
 * every route already relies only on req.user { id, username, role }.
 */
export const signToken = (u) =>
  jwt.sign({ sub: String(u.id), username: u.username, name: u.name, role: u.role }, config.jwtSecret, { expiresIn: config.jwtTtl, issuer: 'quantumshift', audience: 'quantumshift-ui' });

export function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  // EventSource cannot send headers, so the SSE stream accepts ?token=.
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.path === '/stream' ? req.query.token : null;
  if (!token) return next(httpError(401, 'Authentication required'));
  try {
    const p = jwt.verify(token, config.jwtSecret, { issuer: 'quantumshift', audience: 'quantumshift-ui' });
    req.user = { id: Number(p.sub), username: p.username, name: p.name, role: p.role };
    return next();
  } catch {
    return next(httpError(401, 'Session expired or invalid — sign in again'));
  }
}

/** Role-based authorization per capability. */
export const PERMISSIONS = {
  'scan:run': ['CTO', 'CISO', 'DEVELOPER'],
  'repo:manage': ['CTO', 'CISO', 'DEVELOPER'],
  'risk:configure': ['CTO', 'CISO'],
  'plan:generate': ['CTO', 'CISO', 'DEVELOPER'],
  'remediation:generate': ['CISO', 'DEVELOPER'],
  'tests:run': ['CISO', 'DEVELOPER'],
  'pr:create': ['CISO', 'DEVELOPER'],
  'pr:review': ['CISO', 'DEVELOPER'],
  'settings:write': ['CTO', 'CISO'],
  'demo:run': ['CTO', 'CISO', 'DEVELOPER'],
};

const ROLE_LABEL = { CTO: 'CTO', CISO: 'CISO / Security Team', DEVELOPER: 'Developer', AUDITOR: 'Auditor' };

export const can = (perm) => (req, _res, next) => {
  const roles = PERMISSIONS[perm] || [];
  if (roles.includes(req.user?.role)) return next();
  return next(httpError(403, `Your role (${ROLE_LABEL[req.user?.role] || 'unknown'}) cannot perform this action. Allowed: ${roles.map((r) => ROLE_LABEL[r]).join(', ')}.`, { permission: perm }));
};
