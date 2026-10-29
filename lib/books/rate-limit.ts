const buckets = new Map<string, { count: number; reset: number }>();

// In-memory limiter for expensive admin actions (upload/reindex). Suitable for
// the single-VPS V1; a distributed limiter belongs to a later phase.
export function allowBookAction(key: string, now = Date.now(), limit = 10, windowMs = 10 * 60_000): boolean {
  if (buckets.size > 500) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.reset < now) buckets.delete(bucketKey);
    }
  }
  const bucket = buckets.get(key);
  if (!bucket || bucket.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function bookActionKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return request.headers.get('cf-connecting-ip') || forwarded || 'local';
}
