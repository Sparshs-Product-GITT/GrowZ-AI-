// Fetches historical OHLC candles from Yahoo Finance's v8/finance/chart
// endpoint so the expanded panel can render its own chart (via
// lightweight-charts) instead of embedding TradingView's widget, which some
// host pages' CSP blocks. Reuses the same crumb-attached request helper as
// yahooFinanceClient.ts.

import type { Candle } from '../shared/types';
import { fetchYahooJson } from './yahooAuth';

interface YahooChartResponse {
  chart: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
          close?: Array<number | null>;
        }>;
      };
    }>;
    error?: unknown;
  };
}

const DEFAULT_RANGE = '6mo';
const DEFAULT_INTERVAL = '1d';

export async function fetchChartData(yahooSymbol: string): Promise<Candle[]> {
  const data = (await fetchYahooJson(
    (crumb) =>
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        yahooSymbol
      )}?range=${DEFAULT_RANGE}&interval=${DEFAULT_INTERVAL}&crumb=${encodeURIComponent(crumb)}`
  )) as YahooChartResponse;

  const result = data.chart?.result?.[0];
  const timestamps = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0];

  if (!result || timestamps.length === 0 || !quote) {
    throw new Error('No chart data returned for symbol');
  }

  const candles: Candle[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    // Yahoo returns null entries for gaps (e.g. holidays within the range);
    // skip anything incomplete rather than plotting a broken candle.
    if (open == null || high == null || low == null || close == null) continue;
    candles.push({ time: timestamps[i], open, high, low, close });
  }

  if (candles.length === 0) {
    throw new Error('Chart data was empty after filtering');
  }
  return candles;
}
