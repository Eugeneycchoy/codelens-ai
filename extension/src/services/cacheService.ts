interface CacheEntry {
  explanation: string;
  timestamp: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
}

/**
 * In-memory cache for AI explanations keyed by a hash of the code.
 * Entries expire after TTL so stale results don't persist indefinitely.
 * Tracks hits/misses for monitoring (target hit rate >50% after initial use).
 */
export class CacheService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly ttlMs = 30 * 60 * 1000; // 30 minutes
  private hits = 0;
  private misses = 0;

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
    if (!entry) {
      this.misses++;
      return null;
    }
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.explanation;
  }

  set(code: string, explanation: string): void {
    const key = this.generateKey(code);
    this.cache.set(key, {
      explanation,
      timestamp: Date.now(),
    });
  }

  /**
   * Deletes a single cache entry for the given code.
   * Use this for targeted invalidation (e.g., refresh) instead of clear().
   */
  delete(code: string): void {
    const key = this.generateKey(code);
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Returns hit/miss counts and hit rate (0–1). Use for monitoring; target >0.5 after initial use.
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }
}
