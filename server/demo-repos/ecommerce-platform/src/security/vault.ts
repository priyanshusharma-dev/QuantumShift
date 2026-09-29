import crypto from 'crypto';

// Payment-token vault (already quantum-resistant: AES-256-GCM + HMAC-SHA256).
export function sealPaymentToken(key: Buffer, token: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { iv, data, tag: cipher.getAuthTag() };
}

export function webhookSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}
