#!/usr/bin/env node
// Validates every entry in src/data/indices.json against the live data
// sources it depends on.
//
// Usage:
//   node scripts/verifyIndexSymbols.mjs
//
// Why this exists: Yahoo's coverage of Indian sectoral/strategy indices is
// uneven and its legacy "^CNX*" symbols don't track NSE's current branding,
// so index symbols can't be derived from the name the way equity symbols can
// (`${symbol}.NS`). Several plausible-looking symbols resolve to a live quote
// but carry almost no history, which would render an empty chart, and at
// least one (^NSMIDCP) is named as if it were a midcap index but is actually
// Nifty Next 50. Both classes of mistake are silent in the UI -- they show a
// confident but wrong panel -- so each symbol is checked here rather than
// trusted.
//
// A symbol passes only if it returns a reasonably dense 6-month daily series;
// MIN_CANDLES is deliberately well below the ~126 Indian trading days in that
// window so that genuinely gappy-but-usable series still pass.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIN_CANDLES = 80;
const THROTTLE_MS = 250;
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function checkYahoo(symbol) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=6mo&interval=1d`;
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };

  const result = (await res.json())?.chart?.result?.[0];
  const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter((c) => c != null);
  if (closes.length < MIN_CANDLES) {
    return { ok: false, detail: `only ${closes.length} candles in 6mo` };
  }
  return { ok: true, detail: `${closes.length} candles`, name: result?.meta?.shortName };
}

async function checkTradingView(tvSymbol) {
  const slug = tvSymbol.replace(':', '-');
  const res = await fetch(`https://www.tradingview.com/symbols/${slug}/`, {
    redirect: 'manual',
    headers: { 'User-Agent': UA },
  });
  if (res.status === 200) return { ok: true, detail: 'ok' };
  const location = res.headers.get('location');
  if (location) return { ok: false, detail: `redirects to ${location}` };
  return { ok: false, detail: `HTTP ${res.status}` };
}

const indices = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'src', 'data', 'indices.json'), 'utf-8')
);

let failures = 0;

for (const entry of indices) {
  const yahoo = await checkYahoo(entry.yahooSymbol).catch((e) => ({ ok: false, detail: e.message }));
  await sleep(THROTTLE_MS);
  const tv = await checkTradingView(entry.tvSymbol).catch((e) => ({ ok: false, detail: e.message }));
  await sleep(THROTTLE_MS);

  const ok = yahoo.ok && tv.ok;
  if (!ok) failures += 1;

  // Yahoo's own shortName is reported so a symbol that resolves to a
  // different index than its canonicalName claims is visible on inspection.
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${entry.canonicalName.padEnd(26)}` +
      `${entry.yahooSymbol.padEnd(22)} yahoo=${yahoo.detail.padEnd(14)}` +
      `tv=${tv.detail.padEnd(12)}${yahoo.name ? `meta="${yahoo.name}"` : ''}`
  );
}

console.log(`\n${indices.length - failures}/${indices.length} passed`);
process.exit(failures === 0 ? 0 : 1);
