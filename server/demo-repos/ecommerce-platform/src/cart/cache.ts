import crypto from 'crypto';

// Builds the cache key used for cart snapshots.
export function cartCacheKey(userId: string, items: string[]): string {
  return crypto.createHash('md5').update(userId + items.join('|')).digest('hex');
}
