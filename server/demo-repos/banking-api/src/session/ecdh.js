const crypto = require('crypto');

// Establishes a per-session key with mobile banking clients.
function createSessionKeyExchange() {
  const ecdh = crypto.createECDH('prime256v1');
  const publicKey = ecdh.generateKeys('base64');
  return { ecdh, publicKey };
}

function deriveSessionSecret(ecdh, peerPublicKey) {
  return ecdh.computeSecret(peerPublicKey, 'base64');
}

module.exports = { createSessionKeyExchange, deriveSessionSecret };
