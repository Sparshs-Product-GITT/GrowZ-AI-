// Yahoo Finance tightened its unofficial API in 2024: requests without a
// valid session cookie + "crumb" token now get rejected with 401. This module
// performs that handshake once (caching the crumb) so yahooFinanceClient.ts
// can attach it to every request.
//
// Flow (mirrors what browsers/other unofficial clients do):
//   1. GET https://fc.yahoo.com -- establishes the session cookie Yahoo needs.
//   2. GET https://query2.finance.yahoo.com/v1/test/getcrumb (with that
//      cookie) -- returns a short-lived crumb string.
//   3. Append `&crumb=<value>` to subsequent quote/quoteSummary requests.
//
// If Yahoo changes this flow again, requests will start failing with 401
// again and this is the file to revisit first.

let cachedCrumb: string | null = null;
let inFlightCrumbRequest: Promise<string> | null = null;

async function primeSessionCookie(): Promise<void> {
  try {
    await fetch('https://fc.yahoo.com', { credentials: 'include', redirect: 'follow' });
  } catch {
    // Best-effort -- if this fails, the getcrumb call below will surface the
    // real error.
  }
}

async function requestCrumb(): Promise<string> {
  await primeSessionCookie();
  const res = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    credentials: 'include',
    headers: { Accept: 'text/plain' },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Yahoo crumb: ${res.status}`);
  }
  const crumb = (await res.text()).trim();
  if (!crumb || crumb.includes('<html')) {
    throw new Error('Yahoo returned an unexpected crumb response');
  }
  return crumb;
}

export async function getCrumb(forceRefresh = false): Promise<string> {
  if (cachedCrumb && !forceRefresh) return cachedCrumb;
  if (inFlightCrumbRequest && !forceRefresh) return inFlightCrumbRequest;

  inFlightCrumbRequest = requestCrumb()
    .then((crumb) => {
      cachedCrumb = crumb;
      return crumb;
    })
    .finally(() => {
      inFlightCrumbRequest = null;
    });

  return inFlightCrumbRequest;
}

export function invalidateCrumb(): void {
  cachedCrumb = null;
}

/**
 * Fetches a Yahoo Finance URL with the current crumb attached and
 * credentials included. If the request fails with 401 (stale/missing
 * crumb), fetches a fresh crumb and retries exactly once. Shared by every
 * Yahoo Finance client (quotes, chart data, ...) so the crumb/retry logic
 * only lives in one place.
 */
export async function fetchYahooJson(buildUrl: (crumb: string) => string): Promise<unknown> {
  const crumb = await getCrumb();
  let res = await fetch(buildUrl(crumb), {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (res.status === 401) {
    invalidateCrumb();
    const freshCrumb = await getCrumb(true);
    res = await fetch(buildUrl(freshCrumb), {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
  }

  if (!res.ok) {
    throw new Error(`Yahoo request failed: ${res.status}`);
  }
  return res.json();
}
