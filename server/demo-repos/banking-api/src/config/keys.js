// DEMO SAMPLE — intentionally insecure key handling for QuantumShift demonstrations.
// The key material below is a NON-FUNCTIONAL placeholder, not a real secret.

const LEGACY_SIGNING_KEY = `-----BEGIN RSA PRIVATE KEY-----
DEMO-ONLY-PLACEHOLDER-NOT-A-REAL-KEY-QUANTUMSHIFT-SAMPLE-000000
-----END RSA PRIVATE KEY-----`;

const API_SIGNING_SECRET = "demo-hardcoded-secret-do-not-use";

module.exports = { LEGACY_SIGNING_KEY, API_SIGNING_SECRET };
