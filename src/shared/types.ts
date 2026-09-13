// Shared types used across the background service worker, content scripts,
// and UI components.

/**
 * Indices behave differently enough from equities to need distinguishing:
 * they have no market cap, their level isn't a currency amount, and their
 * Yahoo/TradingView symbols can't be derived from the ticker the way an
 * equity's `${ticker}.NS` can.
 */
export type EntryKind = 'equity' | 'index';

export interface CompanyEntry {
  /** Defaults to 'equity' when absent, so companies.json needs no migration. */
  kind?: EntryKind;
  /** Full legal name, e.g. "Nestle India Limited" */
  canonicalName: string;
  /** Short forms / aliases that should also trigger a highlight, e.g. ["Nestle India", "Nestle"] */
  aliases: string[];
  /**
   * Subset of `aliases` (or `canonicalName`) that is too generic to match on
   * its own and only counts when the surrounding text looks financial, e.g.
   * bare "Nifty" for Nifty 50. Per-alias rather than per-entry, because an
   * entry can have both safe and unsafe names.
   */
  gated?: string[];
  /** NSE ticker symbol, e.g. "NESTLEIND"; for indices a stable id, e.g. "NIFTY50" */
  ticker: string;
  /** Yahoo Finance symbol, e.g. "NESTLEIND.NS" or "^NSEI" */
  yahooSymbol: string;
  /** TradingView symbol, e.g. "NSE:NESTLEIND" or "NSE:NIFTY" */
  tvSymbol: string;
}

export interface Quote {
  ticker: string;
  name: string;
  kind: EntryKind;
  ltp: number;
  change: number;
  changePercent: number;
  marketCap?: number;
  /** Shares traded so far in the current session. */
  volume?: number;
  /** Average daily volume over the trailing 3 months, for comparison. */
  avgVolume3M?: number;
  currency?: string;
  /** epoch ms when this quote was fetched, used for TTL cache checks */
  fetchedAt: number;
}

export interface GetQuoteMessage {
  type: 'GET_QUOTE';
  yahooSymbol: string;
  kind?: EntryKind;
  /**
   * Display ticker from the dictionary. Passed explicitly because it can't be
   * recovered from `yahooSymbol` for indices -- stripping ".NS" off "^NSEI"
   * leaves "^NSEI".
   */
  ticker?: string;
}

export type GetQuoteResponse =
  | { ok: true; quote: Quote }
  | { ok: false; error: string };

export interface Candle {
  /** unix seconds */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface GetChartDataMessage {
  type: 'GET_CHART_DATA';
  yahooSymbol: string;
}

export type GetChartDataResponse =
  | { ok: true; candles: Candle[] }
  | { ok: false; error: string };

/**
 * A starred company. Deliberately identity-only (no quote snapshot): quotes go
 * stale within minutes and are re-fetched on demand, and small entries keep
 * the list well inside chrome.storage.sync's per-item quota.
 */
export interface WishlistItem {
  ticker: string;
  companyName: string;
  yahooSymbol: string;
  tvSymbol: string;
  kind: EntryKind;
  /** epoch ms when the user starred this company */
  addedAt: number;
}

export interface NewsItem {
  title: string;
  summary: string;
  /** Publisher name, e.g. "Reuters" -- always shown alongside the summary. */
  source: string;
  url: string;
  /** epoch ms */
  publishedAt: number;
}

export interface StockNews {
  items: NewsItem[];
  /**
   * False when the AI step was skipped or failed and `items` carry the news
   * provider's own headlines/blurbs instead of generated summaries.
   */
  summarized: boolean;
}

export interface GetStockNewsMessage {
  type: 'GET_STOCK_NEWS';
  yahooSymbol: string;
  ticker: string;
  companyName: string;
}

export type GetStockNewsResponse =
  | ({ ok: true } & StockNews)
  | { ok: false; error: string };
