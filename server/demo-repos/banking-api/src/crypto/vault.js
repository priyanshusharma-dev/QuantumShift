const crypto = require('crypto');

// Field-level encryption for account balances (already quantum-resistant: AES-256-GCM).
function sealField(key, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv, data, tag: cipher.getAuthTag() };
}

function auditDigest(record) {
  return crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

module.exports = { sealField, auditDigest };
