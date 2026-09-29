/**
 * Cryptographic knowledge base used by the scanner, risk engine, CBOM
 * generator and remediation agent.
 *
 * quantum_status values:
 *   vulnerable  – broken by Shor's algorithm on a CRQC (RSA, ECC, DH, DSA)
 *   broken      – already classically broken (SHA-1, MD5, DES/3DES, RSA-1024)
 *   exposed     – key material hardcoded in source
 *   weakened    – security halved by Grover (AES-128, HMAC-SHA1)
 *   unsupported – library/runtime without PQC primitives
 *   safe        – quantum-resistant classical primitive (AES-256, SHA-256+)
 *   pqc         – NIST post-quantum algorithm (ML-KEM, ML-DSA, SLH-DSA)
 */
export const FAMILIES = {
  RSA: { status: 'vulnerable', threat: "Shor's algorithm factors the RSA modulus in polynomial time on a CRQC.", oid: '1.2.840.113549.1.1.1', classical: 112 },
  ECDSA: { status: 'vulnerable', threat: "Shor's algorithm solves the elliptic-curve discrete log problem, enabling signature forgery.", oid: '1.2.840.10045.4.3.2', classical: 128 },
  ECDH: { status: 'vulnerable', threat: "Shor's algorithm recovers ECDH private keys; recorded sessions can be decrypted later (harvest-now-decrypt-later).", oid: '1.3.132.1.12', classical: 128 },
  ECC: { status: 'vulnerable', threat: "Elliptic-curve keys are broken by Shor's algorithm regardless of whether they are used for signing or key agreement.", oid: '1.2.840.10045.2.1', classical: 128 },
  EdDSA: { status: 'vulnerable', threat: "Ed25519 relies on the elliptic-curve discrete log problem and is broken by Shor's algorithm.", oid: '1.3.101.112', classical: 128 },
  DSA: { status: 'vulnerable', threat: "DSA relies on the discrete log problem, broken by Shor's algorithm.", oid: '1.2.840.10040.4.1', classical: 112 },
  DH: { status: 'vulnerable', threat: "Finite-field Diffie-Hellman is broken by Shor's algorithm.", oid: '1.2.840.10046.2.1', classical: 112 },
  'SHA-1': { status: 'broken', threat: 'SHA-1 has practical collision attacks (SHAttered, 2017) and is disallowed for signatures by NIST.', oid: '1.3.14.3.2.26', classical: 63 },
  MD5: { status: 'broken', threat: 'MD5 collisions can be produced in seconds on commodity hardware.', oid: '1.2.840.113549.2.5', classical: 18 },
  '3DES': { status: 'broken', threat: '3DES has a 64-bit block (Sweet32) and was withdrawn by NIST (SP 800-67 Rev.2 withdrawn 2024).', oid: '1.2.840.113549.3.7', classical: 112 },
  DES: { status: 'broken', threat: 'DES keys can be brute-forced classically.', oid: '1.3.14.3.2.7', classical: 56 },
  RC4: { status: 'broken', threat: 'RC4 keystream biases make it insecure.', oid: '1.2.840.113549.3.4', classical: 0 },
  'AES-128': { status: 'weakened', threat: "Grover's algorithm halves effective security to ~64 bits against a quantum adversary.", oid: '2.16.840.1.101.3.4.1.2', classical: 128 },
  'HMAC-SHA1': { status: 'weakened', threat: 'HMAC-SHA1 is still unbroken but deprecated; migrate for long-term assurance.', oid: '1.2.840.113549.2.7', classical: 128 },
  'AES-256': { status: 'safe', threat: 'AES-256 retains ~128-bit security under Grover — considered quantum-resistant.', oid: '2.16.840.1.101.3.4.1.46', classical: 256 },
  'AES-192': { status: 'safe', threat: 'AES-192 retains ~96-bit security under Grover.', oid: '2.16.840.1.101.3.4.1.22', classical: 192 },
  'SHA-2': { status: 'safe', threat: 'SHA-256/384/512 remain secure against known quantum attacks (Grover only gives a square-root speed-up).', oid: '2.16.840.1.101.3.4.2.1', classical: 128 },
  'SHA-3': { status: 'safe', threat: 'SHA-3 remains secure against known quantum attacks.', oid: '2.16.840.1.101.3.4.2.8', classical: 128 },
  HMAC: { status: 'safe', threat: 'HMAC with SHA-256 or stronger is quantum-resistant.', oid: '1.2.840.113549.2.9', classical: 256 },
  'ML-KEM': { status: 'pqc', threat: 'NIST FIPS 203 module-lattice KEM — quantum-safe.', oid: '2.16.840.1.101.3.4.4.2', classical: 192 },
  'ML-DSA': { status: 'pqc', threat: 'NIST FIPS 204 module-lattice signature — quantum-safe.', oid: '2.16.840.1.101.3.4.3.18', classical: 192 },
  'SLH-DSA': { status: 'pqc', threat: 'NIST FIPS 205 stateless hash-based signature — quantum-safe.', oid: '2.16.840.1.101.3.4.3.20', classical: 192 },
  KEY: { status: 'exposed', threat: 'Private key material committed to source control can be extracted by anyone with repository access and is typically quantum-vulnerable too.', oid: null, classical: 0 },
  SECRET: { status: 'exposed', threat: 'Static secrets in source code cannot be rotated safely and leak through history, forks and CI logs.', oid: null, classical: 0 },
  TLS: { status: 'vulnerable', threat: 'Classical ECDHE/RSA key exchange lets adversaries record TLS traffic today and decrypt it once a CRQC exists.', oid: null, classical: 128 },
  LIBRARY: { status: 'unsupported', threat: 'This library/runtime version provides no NIST PQC primitives, blocking ML-KEM/ML-DSA adoption.', oid: null, classical: null },
};

export const statusOf = (family) => FAMILIES[family]?.status || 'vulnerable';

/** NIST security category of recommended PQC targets. */
export const PQC_TARGETS = {
  'ML-KEM-768': { standard: 'FIPS 203', nistLevel: 3, publicKeyBytes: 1184, ciphertextBytes: 1088 },
  'ML-DSA-65': { standard: 'FIPS 204', nistLevel: 3, publicKeyBytes: 1952, signatureBytes: 3309 },
  X25519MLKEM768: { standard: 'IETF hybrid (X25519 + FIPS 203)', nistLevel: 3 },
};

/** Chooses the migration target for an asset. */
export function targetFor({ family, primitive, assetType, algorithm }) {
  if (assetType === 'library') return 'Upgrade to a PQC-capable release (see recommendation)';
  if (assetType === 'protocol') return 'TLS 1.3 + X25519MLKEM768 hybrid key exchange';
  if (assetType === 'certificate') return 'ML-DSA-65 certificate (composite ML-DSA-65 + RSA during transition)';
  switch (family) {
    case 'RSA':
      if (['pke', 'kem', 'key-agree'].includes(primitive)) return 'ML-KEM-768 (hybrid X25519MLKEM768)';
      return 'ML-DSA-65';
    case 'ECDSA':
    case 'EdDSA':
    case 'DSA':
      return 'ML-DSA-65';
    case 'ECDH':
    case 'DH':
      return 'X25519MLKEM768 hybrid → ML-KEM-768';
    case 'ECC':
      return primitive === 'key-agree' ? 'X25519MLKEM768 hybrid → ML-KEM-768' : 'ML-DSA-65';
    case 'SHA-1':
    case 'MD5':
      return 'SHA-256 (or SHA3-256)';
    case '3DES':
    case 'DES':
    case 'RC4':
    case 'AES-128':
      return 'AES-256-GCM';
    case 'HMAC-SHA1':
      return 'HMAC-SHA256';
    case 'KEY':
      return 'KMS/HSM-managed key, rotated to ML-DSA-65';
    case 'SECRET':
      return 'Secrets manager reference (no literal in source)';
    case 'TLS':
      return 'TLS 1.3 + X25519MLKEM768 hybrid key exchange';
    default:
      return algorithm?.startsWith('ML-') ? 'No change (already PQC)' : 'No change required';
  }
}

/** Semgrep-style PQC rule registry (IDs are referenced by every detection). */
export const RULES = [
  { id: 'PQC-RSA-001', name: 'RSA digital signature', severity: 'HIGH', family: 'RSA', cwe: 'CWE-327', pattern: 'crypto.createSign("RSA-…") | Signature.getInstance("…withRSA") | rsa.SignPKCS1v15(…)', message: 'RSA signatures can be forged once a cryptographically relevant quantum computer exists.' },
  { id: 'PQC-RSA-002', name: 'RSA key generation', severity: 'HIGH', family: 'RSA', cwe: 'CWE-327', pattern: "generateKeyPairSync('rsa', …) | rsa.generate_private_key(…) | KeyPairGenerator.getInstance(\"RSA\") | rsa.GenerateKey(…)", message: 'New RSA keys extend quantum-vulnerable cryptography into the future.' },
  { id: 'PQC-RSA-003', name: 'RSA encryption / key transport', severity: 'CRITICAL', family: 'RSA', cwe: 'CWE-327', pattern: 'crypto.publicEncrypt(…) | padding.OAEP(…) | Cipher.getInstance("RSA/…")', message: 'Data encrypted with RSA today can be harvested now and decrypted later.' },
  { id: 'PQC-ECC-001', name: 'ECDSA / EdDSA signature', severity: 'HIGH', family: 'ECDSA', cwe: 'CWE-327', pattern: 'ecdsa.SignASN1(…) | Signature.getInstance("SHA256withECDSA") | ec.ECDSA(…)', message: 'Elliptic-curve signatures are forgeable with Shor\'s algorithm.' },
  { id: 'PQC-ECC-002', name: 'Elliptic-curve key generation', severity: 'HIGH', family: 'ECC', cwe: 'CWE-327', pattern: "generateKeyPairSync('ec', …) | ec.generate_private_key(…) | ecdsa.GenerateKey(…)", message: 'EC keys are broken by Shor\'s algorithm.' },
  { id: 'PQC-ECC-003', name: 'ECDH key agreement', severity: 'CRITICAL', family: 'ECDH', cwe: 'CWE-327', pattern: 'crypto.createECDH(…) | ec.ECDH() | KeyAgreement.getInstance("ECDH")', message: 'Harvest-now-decrypt-later risk for recorded key exchanges.' },
  { id: 'PQC-DH-001', name: 'Finite-field Diffie-Hellman', severity: 'CRITICAL', family: 'DH', cwe: 'CWE-327', pattern: 'crypto.createDiffieHellman(…) | KeyAgreement.getInstance("DH")', message: 'Diffie-Hellman is broken by Shor\'s algorithm.' },
  { id: 'PQC-HASH-001', name: 'SHA-1 usage', severity: 'HIGH', family: 'SHA-1', cwe: 'CWE-328', pattern: "createHash('sha1') | hashlib.sha1(…) | MessageDigest.getInstance(\"SHA-1\") | sha1.New()", message: 'SHA-1 is classically broken and must be replaced.' },
  { id: 'PQC-HASH-002', name: 'MD5 usage', severity: 'HIGH', family: 'MD5', cwe: 'CWE-328', pattern: "createHash('md5') | hashlib.md5(…) | MessageDigest.getInstance(\"MD5\")", message: 'MD5 is classically broken and must be replaced.' },
  { id: 'PQC-SYM-001', name: 'DES / 3DES cipher', severity: 'HIGH', family: '3DES', cwe: 'CWE-327', pattern: 'Cipher.getInstance("DESede/…") | DES3.new(…) | des.NewTripleDESCipher(…)', message: '64-bit block ciphers are deprecated.' },
  { id: 'PQC-SYM-002', name: 'AES-128 (Grover-weakened)', severity: 'MEDIUM', family: 'AES-128', cwe: 'CWE-326', pattern: "createCipheriv('aes-128-…') | get_random_bytes(16) + AES.new(…)", message: "Grover's algorithm halves AES-128 security; prefer AES-256." },
  { id: 'PQC-KEY-001', name: 'Hardcoded private key', severity: 'CRITICAL', family: 'KEY', cwe: 'CWE-321', pattern: '"-----BEGIN … PRIVATE KEY-----" literal', message: 'Private keys must never be committed to source code.' },
  { id: 'PQC-KEY-002', name: 'Hardcoded secret / key literal', severity: 'HIGH', family: 'SECRET', cwe: 'CWE-798', pattern: 'const *SECRET* = "…" | static final String *KEY* = "…"', message: 'Static secrets cannot be rotated and leak through history.' },
  { id: 'PQC-CERT-001', name: 'Quantum-vulnerable X.509 certificate', severity: 'HIGH', family: 'RSA', cwe: 'CWE-327', pattern: '-----BEGIN CERTIFICATE----- (RSA/EC subject public key)', message: 'Certificates with RSA/EC keys must be re-issued with ML-DSA (or composite) keys.' },
  { id: 'PQC-TLS-001', name: 'Classical-only TLS key exchange', severity: 'HIGH', family: 'TLS', cwe: 'CWE-327', pattern: 'ssl_ecdh_curve prime256v1 | CurvePreferences{CurveP256…} | ssl_ciphers ECDHE-RSA-…', message: 'Enable hybrid X25519MLKEM768 key exchange to stop harvest-now-decrypt-later.' },
  { id: 'PQC-TLS-002', name: 'Legacy TLS protocol version', severity: 'MEDIUM', family: 'TLS', cwe: 'CWE-326', pattern: 'ssl_protocols TLSv1.2 | enabled-protocols=TLSv1.1 | MinVersion: tls.VersionTLS12', message: 'Hybrid PQC key exchange requires TLS 1.3.' },
  { id: 'PQC-JWT-001', name: 'JWT signed with RSA/ECDSA', severity: 'HIGH', family: 'RSA', cwe: 'CWE-327', pattern: "jwt.sign(…, { algorithm: 'RS256' | 'ES256' }) | jwt.encode(…, algorithm=\"ES256\")", message: 'JWT signatures are forgeable with a CRQC; plan ML-DSA (draft JOSE) tokens.' },
  { id: 'PQC-LIB-001', name: 'Crypto library/runtime without PQC support', severity: 'MEDIUM', family: 'LIBRARY', cwe: 'CWE-1104', pattern: 'package.json / requirements.txt / pom.xml / go.mod / Dockerfile FROM', message: 'Upgrade to a release with ML-KEM/ML-DSA support.' },
  { id: 'PQC-CLOUD-001', name: 'Cloud KMS asymmetric key (classical)', severity: 'HIGH', family: 'RSA', cwe: 'CWE-327', pattern: 'KMS KeySpec RSA_* | ECC_*', message: 'Rotate to ML-DSA key specs where supported.' },
  { id: 'PQC-CLOUD-002', name: 'Cloud-managed certificate (classical)', severity: 'HIGH', family: 'RSA', cwe: 'CWE-327', pattern: 'ACM KeyAlgorithm RSA_* | EC_*', message: 'Plan PQC certificate re-issuance.' },
  { id: 'PQC-CLOUD-003', name: 'Load balancer TLS policy without PQ key exchange', severity: 'HIGH', family: 'TLS', cwe: 'CWE-327', pattern: 'ELB SslPolicy without -PQ-', message: 'Switch to a post-quantum hybrid TLS policy.' },
  { id: 'PQC-INV-001', name: 'Quantum-safe primitive (inventory)', severity: 'INFO', family: null, cwe: null, pattern: "createCipheriv('aes-256-gcm') | createHash('sha256') | ML-KEM / ML-DSA", message: 'Recorded in the CBOM for completeness — no action required.' },
];

export const ruleById = Object.fromEntries(RULES.map((r) => [r.id, r]));

/** CycloneDX 1.5 crypto primitive for a family/asset. */
export function primitiveFor(family, hint) {
  if (hint) return hint;
  if (['SHA-1', 'MD5', 'SHA-2', 'SHA-3'].includes(family)) return 'hash';
  if (['HMAC', 'HMAC-SHA1'].includes(family)) return 'mac';
  if (['AES-128', 'AES-256', 'AES-192', '3DES', 'DES'].includes(family)) return 'block-cipher';
  if (family === 'RC4') return 'stream-cipher';
  if (['ECDH', 'DH'].includes(family)) return 'key-agree';
  if (family === 'ML-KEM') return 'kem';
  if (['ECDSA', 'EdDSA', 'DSA', 'ML-DSA', 'SLH-DSA'].includes(family)) return 'signature';
  if (family === 'RSA') return 'pke';
  return 'other';
}
