import type { RateLimitHit, UsageEntry } from "./types.js";

/**
 * 複数アダプタ(Claude Code / Codex等)を横断してdedupする際の名前空間衝突防止のため、
 * 内部マージキーには provider を必ずプレフィックスする(entry.key/hit.key 自体は変更しない)。
 */
function mergeMapKey(provider: string, key: string): string {
  return `${provider}:${key}`;
}

/**
 * dedupマージ本体: 同一key(provider名前空間つき)のエントリをフィールドごとにmaxで統合する。
 * timestampは最初に見たものを保持。単一アダプタ内の複数ファイル横断dedupにも、
 * 複数アダプタを結合した後の最終dedupにも共通して使う。
 */
export function mergeEntry(map: Map<string, UsageEntry>, entry: UsageEntry): void {
  const mapKey = mergeMapKey(entry.provider, entry.key);
  const existing = map.get(mapKey);
  if (!existing) {
    map.set(mapKey, entry);
    return;
  }

  map.set(mapKey, {
    key: existing.key,
    provider: existing.provider,
    product: existing.product,
    model: existing.model,
    timestamp: existing.timestamp, // 最初に見たものを保持
    inputTokens: Math.max(existing.inputTokens, entry.inputTokens),
    outputTokens: Math.max(existing.outputTokens, entry.outputTokens),
    cacheReadTokens: Math.max(existing.cacheReadTokens, entry.cacheReadTokens),
    cacheCreationTokens: Math.max(existing.cacheCreationTokens, entry.cacheCreationTokens),
    requestId: existing.requestId ?? entry.requestId,
  });
}

/** entries配列全体をmergeEntryで畳み込み、dedup済みの配列を返す(順不同)。 */
export function mergeEntries(entries: UsageEntry[]): UsageEntry[] {
  const map = new Map<string, UsageEntry>();
  for (const entry of entries) {
    mergeEntry(map, entry);
  }
  return Array.from(map.values());
}

/**
 * レート制限ヒットの複数アダプタ横断dedup: 同一key(providerプレフィックスつき)は
 * 最初に見たものだけを1件として採用する。
 */
export function mergeRateLimitHits(hits: RateLimitHit[]): RateLimitHit[] {
  const map = new Map<string, RateLimitHit>();
  for (const hit of hits) {
    const mapKey = mergeMapKey(hit.provider, hit.key);
    if (!map.has(mapKey)) {
      map.set(mapKey, hit);
    }
  }
  return Array.from(map.values());
}
