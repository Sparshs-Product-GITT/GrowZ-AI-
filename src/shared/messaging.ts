// Typed helpers for messaging the background worker. These live in shared/
// rather than content/ because the toolbar popup needs the same helpers and
// none of them touch the DOM.

import type {
  EntryKind,
  GetQuoteMessage,
  GetQuoteResponse,
  GetChartDataMessage,
  GetChartDataResponse,
  GetStockNewsMessage,
  GetStockNewsResponse,
} from './types';

/**
 * Shape every response type shares for its failure case, so a dropped message
 * (dead worker, no listener) can be reported through the same union the
 * caller already handles instead of throwing.
 */
type MessageFailure = { ok: false; error: string };

function sendToBackground<TResponse>(message: object): Promise<TResponse | MessageFailure> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response: TResponse | undefined) => {
        if (chrome.runtime.lastError || !response) {
          resolve({
            ok: false,
            error: chrome.runtime.lastError?.message ?? 'No response from background worker',
          });
          return;
        }
        resolve(response);
      });
    } catch (err) {
      // Reloading or updating the extension orphans the content script already
      // running on open tabs: sendMessage then throws synchronously instead of
      // reporting through lastError. Resolve so the caller renders an error
      // state rather than leaking an unhandled rejection.
      resolve({
        ok: false,
        error: err instanceof Error ? err.message : 'Extension context invalidated',
      });
    }
  });
}

export function getQuote(
  yahooSymbol: string,
  kind: EntryKind = 'equity',
  ticker?: string
): Promise<GetQuoteResponse> {
  const message: GetQuoteMessage = { type: 'GET_QUOTE', yahooSymbol, kind, ticker };
  return sendToBackground<GetQuoteResponse>(message);
}

export function getChartData(yahooSymbol: string): Promise<GetChartDataResponse> {
  const message: GetChartDataMessage = { type: 'GET_CHART_DATA', yahooSymbol };
  return sendToBackground<GetChartDataResponse>(message);
}

export function getStockNews(
  yahooSymbol: string,
  ticker: string,
  companyName: string
): Promise<GetStockNewsResponse> {
  const message: GetStockNewsMessage = {
    type: 'GET_STOCK_NEWS',
    yahooSymbol,
    ticker,
    companyName,
  };
  return sendToBackground<GetStockNewsResponse>(message);
}
