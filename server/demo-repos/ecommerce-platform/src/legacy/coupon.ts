import CryptoJS from 'crypto-js';

// Legacy coupon code obfuscation inherited from the 2016 storefront.
export function couponDigest(code: string): string {
  return CryptoJS.SHA1(code).toString();
}
