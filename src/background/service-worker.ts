// MV3 background service worker: routes GET_QUOTE, GET_CHART_DATA and
// GET_STOCK_NEWS requests from content scripts (and the toolbar popup) to the
// Yahoo Finance, Google News and Gemini clients, through their respective TTL
// caches. Fetches happen here (rather than in the content script) so
// host_permissions grant a cross-origin fetch that bypasses the host page's
// own CORS restrictions, and so the Gemini key never reaches the page.

import {
  getCachedQuote,
  setCachedQuote,
  getCachedChartData,
  setCachedChartData,
  getCachedStockNews,
  setCachedStockNews,
} from './cache';
import { fetchQuote } from './yahooFinanceClient';
import { fetchChartData } from './yahooChartClient';
import { fetchRecentNews } from './newsClient';
import { hasGeminiKey, rankAndSummarize } from './aiClient';
import type {
  EntryKind,
  GetQuoteMessage,
  GetQuoteResponse,
  GetChartDataMessage,
  GetChartDataResponse,
  GetStockNewsMessage,
  GetStockNewsResponse,
  StockNews,
} from '../shared/types';

type IncomingMessage = GetQuoteMessage | GetChartDataMessage | GetStockNewsMessage;

/** How many provider headlines to show when the AI step is unavailable. */
const RAW_FALLBACK_COUNT = 5;

chrome.runtime.onMessage.addListener((message: IncomingMessage, _sender, sendResponse) => {
  if (!message) return undefined;

  if (message.type === 'GET_QUOTE') {
    handleGetQuote(message.yahooSymbol, message.kind ?? 'equity', message.ticker)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error fetching quote',
        } satisfies GetQuoteResponse);
      });
    return true; // keep the message channel open for the async response above
  }

  if (message.type === 'GET_CHART_DATA') {
    handleGetChartData(message.yahooSymbol)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error fetching chart data',
        } satisfies GetChartDataResponse);
      });
    return true;
  }

  if (message.type === 'GET_STOCK_NEWS') {
    handleGetStockNews(message.yahooSymbol, message.companyName)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : 'Unknown error fetching recent news',
        } satisfies GetStockNewsResponse);
      });
    return true;
  }

  return undefined;
});

async function handleGetQuote(
  yahooSymbol: string,
  kind: EntryKind,
  ticker?: string
): Promise<GetQuoteResponse> {
  const cached = await getCachedQuote(yahooSymbol);
  if (cached) {
    // `kind` was added after the cache format was established; entries
    // written by a previous version lack it and would render an index as an
    // equity until their TTL expired.
    return { ok: true, quote: { ...cached, kind: cached.kind ?? kind } };
  }

  const quote = await fetchQuote(yahooSymbol, kind, ticker);
  await setCachedQuote(yahooSymbol, quote);
  return { ok: true, quote };
}

async function handleGetChartData(yahooSymbol: string): Promise<GetChartDataResponse> {
  const cached = await getCachedChartData(yahooSymbol);
  if (cached) {
    return { ok: true, candles: cached };
  }

  const candles = await fetchChartData(yahooSymbol);
  await setCachedChartData(yahooSymbol, candles);
  return { ok: true, candles };
}

async function handleGetStockNews(
  yahooSymbol: string,
  companyName: string
): Promise<GetStockNewsResponse> {
  const cached = await getCachedStockNews(yahooSymbol);
  if (cached) {
    return { ok: true, ...cached };
  }

  // Keyed by symbol for caching, but searched by name: the news source is a
  // keyword feed, not a symbol-keyed API.
  const candidates = await fetchRecentNews(companyName);
  const news = await summarizeOrFallBack(companyName, candidates);
  await setCachedStockNews(yahooSymbol, news);
  return { ok: true, ...news };
}

/**
 * The AI layer is the optional half of this feature: with no key, a failed or
 * rate-limited call, or a model response that selects nothing, the provider's
 * own headlines are shown instead of an error.
 */
async function summarizeOrFallBack(
  companyName: string,
  candidates: StockNews['items']
): Promise<StockNews> {
  const raw: StockNews = { items: candidates.slice(0, RAW_FALLBACK_COUNT), summarized: false };
  if (candidates.length === 0 || !hasGeminiKey()) return raw;

  try {
    const items = await rankAndSummarize(companyName, candidates);
    return items.length > 0 ? { items, summarized: true } : raw;
  } catch (err) {
    console.warn('News summarization failed; falling back to raw headlines', err);
    return raw;
  }
}
