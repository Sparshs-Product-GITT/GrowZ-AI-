// Client for Yahoo Finance's unofficial endpoints. This is undocumented and
// can change or rate-limit without notice -- acceptable for a free,
// personal-project phase, but should be swapped for a licensed data vendor
// (or Groww's internal feed) before this becomes an official product.
//
// As of 2024, Yahoo requires a session cookie + "crumb" token on these
// endpoints (see yahooAuth.ts) or they respond with 401. Every request below
// goes through fetchYahooJson() (shared with yahooChartClient.ts), which
// attaches the cached crumb and retries once with a freshly fetched crumb if
// the first attempt comes back 401.
//
// A single call is made: v7/finance/quote, which carries LTP, day change,
// market cap and session/average volume in one response. An earlier version
// also hit v10/finance/quoteSummary for an analyst rating; that was dropped
// with the KPI that displayed it, halving the requests per hover.

import type { EntryKind, Quote } from '../shared/types';
import { fetchYahooJson } from './yahooAuth';

interface YahooQuoteV7Result {
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  marketCap?: number;
  regularMarketVolume?: number;
  averageDailyVolume3Month?: number;
  currency?: string;
  longName?: string;
  shortName?: string;
}

interface YahooQuoteV7Response {
  quoteResponse: {
    result: YahooQuoteV7Result[];
  };
}

export async function fetchQuote(
  yahooSymbol: string,
  kind: EntryKind = 'equity',
  displayTicker?: string
): Promise<Quote> {
  const base = await fetchBaseQuote(yahooSymbol);

  return {
    // Can't be derived from yahooSymbol for indices: stripping ".NS" off
    // "^NSEI" leaves "^NSEI".
    ticker: displayTicker || yahooSymbol.replace(/\.NS$/i, ''),
    name: base.longName ?? base.shortName ?? yahooSymbol,
    kind,
    ltp: base.regularMarketPrice ?? 0,
    change: base.regularMarketChange ?? 0,
    changePercent: base.regularMarketChangePercent ?? 0,
    marketCap: base.marketCap,
    volume: base.regularMarketVolume,
    avgVolume3M: base.averageDailyVolume3Month,
    currency: base.currency ?? 'INR',
    fetchedAt: Date.now(),
  };
}

async function fetchBaseQuote(yahooSymbol: string): Promise<YahooQuoteV7Result> {
  const data = (await fetchYahooJson(
    (crumb) =>
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(
        yahooSymbol
      )}&crumb=${encodeURIComponent(crumb)}`
  )) as YahooQuoteV7Response;

  const result = data.quoteResponse?.result?.[0];
  if (!result) throw new Error('No quote data returned for symbol');
  return result;
}
