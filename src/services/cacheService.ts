interface CacheEntry {
  explanation: string;
  timestamp: number;
}

/**
 * In-memory cache for AI explanations keyed by a hash of the code.
 * Entries expire after TTL so stale results don't persist indefinitely.
 */
export class CacheService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 30 * 60 * 1000; // 30 minutes

  /**
   * Simple non-cryptographic hash for cache keys.
   * Fast and deterministic so the same code always maps to the same key.
   */
  private generateKey(code: string): string {
    let hash = 0;
    for (let i = 0; i < code.length; i++) {
      const char = code.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return String(hash);
  }

  get(code: string): string | null {
    const key = this.generateKey(code);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.explanation;
  }

  set(code: string, explanation: string): void {
    const key = this.generateKey(code);
    this.cache.set(key, {
      explanation,
      timestamp: Date.now(),
    });
  }

  clear(): void {
    this.cache.clear();
  }
}
