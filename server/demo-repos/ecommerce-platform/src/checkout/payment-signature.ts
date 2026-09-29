import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// Signs checkout sessions handed to the payment service provider.
const { privateKey: checkoutKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });

export function signCheckoutSession(sessionId: string, amountCents: number): string {
  return jwt.sign({ sid: sessionId, amt: amountCents }, checkoutKey, { algorithm: 'ES256', expiresIn: '10m' });
}
