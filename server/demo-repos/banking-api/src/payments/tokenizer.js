const crypto = require('crypto');

// Card tokenization service — protects PAN data exchanged with the card vault.
const { publicKey: vaultPublicKey, privateKey: vaultPrivateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function tokenizeCard(cardNumber) {
  const encrypted = crypto.publicEncrypt(vaultPublicKey, Buffer.from(cardNumber));
  return encrypted.toString('base64');
}

function detokenizeCard(token) {
  return crypto.privateDecrypt(vaultPrivateKey, Buffer.from(token, 'base64')).toString('utf8');
}

function legacyTokenFingerprint(token) {
  return crypto.createHash('sha1').update(token).digest('hex');
}

module.exports = { tokenizeCard, detokenizeCard, legacyTokenFingerprint };
