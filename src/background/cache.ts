// Generic short-TTL cache, backed by an in-memory Map for the life of the
// service worker plus chrome.storage.session so a worker restart (MV3
// workers are killed/respawned by Chrome) doesn't force an immediate
// re-fetch. Used for quotes (5 min TTL), chart candle data (15 min TTL, since
// historical daily bars don't need refreshing as often), and AI-summarized
// news (45 min TTL, which also caps how often a panel open can spend a Gemini
// free-tier request on the same company).

import type { Candle, Quote, StockNews } from '../shared/types';

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

export interface TtlCache<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T): Promise<void>;
}

export function createTtlCache<T>(ttlMs: number, namespace: string): TtlCache<T> {
  const memoryCache = new Map<string, CacheEntry<T>>();
  const storageKey = (key: string) => `${namespace}:${key}`;

  function isFresh(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.storedAt < ttlMs;
  }

  return {
    async get(key: string): Promise<T | null> {
      const inMemory = memoryCache.get(key);
      if (inMemory && isFresh(inMemory)) return inMemory.value;

      try {
        const sKey = storageKey(key);
        const stored = await chrome.storage.session.get(sKey);
        const entry = stored[sKey] as CacheEntry<T> | undefined;
        if (entry && isFresh(entry)) {
          memoryCache.set(key, entry);
          return entry.value;
        }
      } catch {
        // chrome.storage.session may not be available in every context; the
        // in-memory cache is a sufficient best-effort fallback.
      }
      return null;
    },

    async set(key: string, value: T): Promise<void> {
      const entry: CacheEntry<T> = { value, storedAt: Date.now() };
      memoryCache.set(key, entry);
      try {
        await chrome.storage.session.set({ [storageKey(key)]: entry });
      } catch {
        // Best-effort persistence only.
      }
    },
  };
}

const quoteCache = createTtlCache<Quote>(5 * 60 * 1000, 'quote');
const chartCache = createTtlCache<Candle[]>(15 * 60 * 1000, 'chart');
const newsCache = createTtlCache<StockNews>(45 * 60 * 1000, 'news');

export function getCachedQuote(symbol: string): Promise<Quote | null> {
  return quoteCache.get(symbol);
}

export function setCachedQuote(symbol: string, quote: Quote): Promise<void> {
  return quoteCache.set(symbol, quote);
}

export function getCachedChartData(symbol: string): Promise<Candle[] | null> {
  return chartCache.get(symbol);
}

export function setCachedChartData(symbol: string, candles: Candle[]): Promise<void> {
  return chartCache.set(symbol, candles);
}

export function getCachedStockNews(symbol: string): Promise<StockNews | null> {
  return newsCache.get(symbol);
}

export function setCachedStockNews(symbol: string, news: StockNews): Promise<void> {
  return newsCache.set(symbol, news);
}
