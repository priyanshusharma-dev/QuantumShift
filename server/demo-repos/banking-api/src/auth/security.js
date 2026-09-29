/**
 * Banking API — authentication & transaction security module.
 *
 * DEMO SAMPLE: this file intentionally contains quantum-vulnerable cryptography
 * (RSA / ECDSA) so that QuantumShift can demonstrate discovery, risk assessment
 * and PQC remediation. It contains no real secrets.
 *
 * Owner: Retail Banking Platform Team
 */
'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { LEGACY_SIGNING_KEY } = require('../config/keys');

const TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 30 * 60 * 1000;

const failedAttempts = new Map();

/**
 * Records a failed login attempt and returns whether the account is locked.
 */
function registerFailedAttempt(customerId) {
  const now = Date.now();
  const entry = failedAttempts.get(customerId) || { count: 0, first: now };
  if (now - entry.first > LOCKOUT_WINDOW_MS) {
    entry.count = 0;
    entry.first = now;
  }
  entry.count += 1;
  failedAttempts.set(customerId, entry);
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

function clearFailedAttempts(customerId) {
  failedAttempts.delete(customerId);
}

function isLocked(customerId) {
  const entry = failedAttempts.get(customerId);
  if (!entry) return false;
  if (Date.now() - entry.first > LOCKOUT_WINDOW_MS) {
    failedAttempts.delete(customerId);
    return false;
  }
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

/**
 * Normalises a customer identifier coming from the mobile or web channel.
 */
function normaliseCustomerId(raw) {
  if (typeof raw !== 'string') throw new TypeError('customerId must be a string');
  const trimmed = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,16}$/.test(trimmed)) {
    throw new Error('Invalid customer identifier format');
  }
  return trimmed;
}

/**
 * Builds the claims included in every access token.
 */
function buildClaims(customer, channel) {
  return {
    sub: customer.id,
    tier: customer.tier,
    channel,
    scope: customer.scopes.join(' '),
    iat: Math.floor(Date.now() / 1000),
  };
}

/**
 * Issues a short-lived access token for an authenticated customer session.
 * Tokens are signed with the bank's RSA key (RS256).
 */
function issueAccessToken(customer, channel) {
  const claims = buildClaims(customer, channel);
  return jwt.sign(claims, LEGACY_SIGNING_KEY, {
    algorithm: 'RS256',
    expiresIn: TOKEN_TTL_SECONDS,
    issuer: 'banking-api',
  });
}

/**
 * Issues a long-lived refresh token.
 */
function issueRefreshToken(customer) {
  const tokenId = crypto.randomUUID();
  return {
    tokenId,
    customerId: customer.id,
    expiresAt: Date.now() + REFRESH_TTL_SECONDS * 1000,
  };
}

/**
 * Canonicalises a transaction so the signature is independent of key ordering.
 */
function canonicalise(transaction) {
  const ordered = {};
  for (const key of Object.keys(transaction).sort()) {
    ordered[key] = transaction[key];
  }
  return JSON.stringify(ordered);
}

/**
 * Validates the business rules that apply before a transfer is signed.
 */
function validateTransfer(transaction) {
  if (!transaction || typeof transaction !== 'object') {
    throw new Error('Transaction payload is required');
  }
  if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) {
    throw new Error('Transfer amount must be positive');
  }
  if (transaction.amount > 250000) {
    throw new Error('Transfer exceeds single-transaction limit');
  }
  if (!transaction.fromAccount || !transaction.toAccount) {
    throw new Error('Source and destination accounts are required');
  }
  if (transaction.fromAccount === transaction.toAccount) {
    throw new Error('Source and destination accounts must differ');
  }
  return true;
}

/**
 * Signs a funds-transfer instruction before it is sent to the core banking
 * ledger. Signed instructions are archived for 10 years (regulatory retention).
 */
function signTransaction(transaction, privateKey) {
  validateTransfer(transaction);
  const payload = canonicalise(transaction);
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(payload);
  return signer.sign(privateKey, 'base64');
}

/**
 * Verifies a signed funds-transfer instruction received from the ledger.
 */
function verifyTransaction(transaction, signature, publicKey) {
  const payload = canonicalise(transaction);
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(payload);
  return verifier.verify(publicKey, signature, 'base64');
}

module.exports = {
  registerFailedAttempt,
  clearFailedAttempts,
  isLocked,
  normaliseCustomerId,
  issueAccessToken,
  issueRefreshToken,
  signTransaction,
  verifyTransaction,
};
