#!/usr/bin/env node
// Acceptance tests for the highlighter's matching layer.
//
// Usage:
//   npm test
//
// scanner.ts is bundled with esbuild and imported directly so these run
// against the real alias table, gating rules, and dictionaries rather than a
// reimplementation. Only findMatchesInText is exercised, which is pure -- the
// DOM traversal around it isn't covered here.

import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workDir = mkdtempSync(path.join(tmpdir(), 'gsh-test-'));
const outfile = path.join(workDir, 'scanner.mjs');

await build({
  entryPoints: [path.join(__dirname, '..', 'src', 'content', 'scanner.ts')],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node18',
  loader: { '.css': 'text' },
  logLevel: 'warning',
});

const { findMatchesInText } = await import(pathToFileURL(outfile).href);

let passed = 0;
const failures = [];

/**
 * @param name   description of the behaviour under test
 * @param text   the text node contents to scan
 * @param expect array of tickers expected, in order of appearance
 * @param around surrounding paragraph text; defaults to `text` itself, which
 *               is what the real scanner sees for a standalone paragraph
 */
function check(name, text, expect, around) {
  const got = findMatchesInText(text, () => around ?? text).map((m) => m.entry.ticker);
  const ok = got.length === expect.length && got.every((t, i) => t === expect[i]);
  if (ok) passed += 1;
  else failures.push({ name, text, expected: expect, got });
}

// --- indices: the three ways "Nifty Bank" gets written -----------------
const bankCtx = 'The index closed higher as banking stocks rallied through the session.';
check('Nifty Bank (official)', 'Nifty Bank ended 1.2% higher.', ['BANKNIFTY'], bankCtx);
check('Bank Nifty (inverted)', 'Bank Nifty ended 1.2% higher.', ['BANKNIFTY'], bankCtx);
check('BankNifty (compressed)', 'BankNifty ended 1.2% higher.', ['BANKNIFTY'], bankCtx);

// --- indices: longest-alias-first must beat the nested shorter names ---
check('Nifty 50 not split into Nifty', 'Nifty 50 closed higher.', ['NIFTY50']);
check('Nifty50 compressed form', 'Nifty50 closed higher.', ['NIFTY50']);
check('Nifty Next 50 beats Nifty 50', 'Nifty Next 50 closed higher.', ['NIFTYNEXT50']);
check('Nifty PSU Bank beats Nifty Bank', 'Nifty PSU Bank closed higher.', ['NIFTYPSUBANK']);
check('Nifty Midcap 150 beats Nifty Midcap 50', 'Nifty Midcap 150 rose.', ['NIFTYMIDCAP150']);

// --- indices: bare "Nifty" is gated on financial context ---------------
check(
  'bare Nifty in financial context',
  'The Nifty closed 120 points higher today.',
  ['NIFTY50']
);
check(
  'bare Nifty as an adjective is rejected',
  "That's a nifty solution to the problem.",
  []
);
check(
  'Nifty gate is not satisfied by its own name',
  'A nifty little trick, nifty indeed, truly nifty.',
  []
);

// --- Sensex variants ---------------------------------------------------
check('Sensex bare', 'The Sensex rose 400 points.', ['SENSEX']);
check('S&P BSE Sensex full form', 'The S&P BSE Sensex rose 400 points.', ['SENSEX']);
check('BSE Sensex prefixed form', 'The BSE Sensex rose 400 points.', ['SENSEX']);

// --- India VIX ---------------------------------------------------------
check('India VIX', 'India VIX fell 4% as volatility eased in trading.', ['INDIAVIX']);

// --- BSE: venue sense must not highlight the listed company ------------
const bseCtx = 'The company said its shares would begin trading next week.';
check('listed on the BSE (venue)', 'The shares are listed on the BSE.', [], bseCtx);
check('BSE-listed (venue)', 'A BSE-listed firm announced results.', [], bseCtx);
check('on the NSE (venue)', 'Volumes on the NSE were higher.', [], bseCtx);
check('BSE data (venue)', 'BSE data showed heavy delivery volumes.', [], bseCtx);
check('BSE shares (company)', 'BSE shares rose 3% after strong results.', ['BSE'], bseCtx);
check(
  'BSE outside any financial context',
  'The BSE outbreak affected cattle herds across the region.',
  []
);

// --- equities still work ------------------------------------------------
check('plain equity match', 'Shares of Infosys rose 2%.', ['INFY']);
check('equity alias', 'HUL reported strong quarterly results.', ['HINDUNILVR']);

// --- realistic article prose, mixing indices and equities ---------------
check(
  'index + index in one sentence',
  'Benchmark indices ended higher on Friday, with the Sensex up 412 points and the Nifty 50 closing above 23,400.',
  ['SENSEX', 'NIFTY50']
);
check(
  'index + two equities',
  'Bank Nifty outperformed, led by gains in HDFC Bank and Kotak Mahindra Bank.',
  ['BANKNIFTY', 'HDFCBANK', 'KOTAKBANK']
);
check(
  'equity kept, venue BSE dropped, index kept',
  'Shares of Reliance Industries listed on the BSE gained 2% while the Nifty IT index slipped.',
  ['RELIANCE', 'NIFTYIT']
);
check(
  'two index aliases in one sentence',
  'FinNifty and Nifty Midcap 150 both hit record highs in intraday trading.',
  ['FINNIFTY', 'NIFTYMIDCAP150']
);
check(
  'BSE as company twice in one sentence',
  'BSE Ltd said its board approved a bonus issue; BSE shares hit a 52-week high.',
  ['BSE', 'BSE']
);
check('nifty as adjective, no financial words at all', 'He wore a nifty hat to the party.', []);

// --- dictionary integrity ----------------------------------------------
const indices = JSON.parse(
  await import('node:fs').then((fs) =>
    fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'indices.json'), 'utf-8')
  )
);
const companies = JSON.parse(
  await import('node:fs').then((fs) =>
    fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'companies.json'), 'utf-8')
  )
);

function assert(name, condition, detail) {
  if (condition) passed += 1;
  else failures.push({ name, expected: 'true', got: detail ?? 'false' });
}

const equityTickers = new Set(companies.map((c) => c.ticker));
const dupeTicker = indices.find((i) => equityTickers.has(i.ticker));
assert('no index ticker collides with an equity ticker', !dupeTicker, dupeTicker?.ticker);

const yahooSymbols = indices.map((i) => i.yahooSymbol);
assert(
  'index yahoo symbols are unique',
  new Set(yahooSymbols).size === yahooSymbols.length,
  yahooSymbols.filter((s, i) => yahooSymbols.indexOf(s) !== i).join(', ')
);

const badGate = indices.find((i) =>
  (i.gated ?? []).some((g) => ![i.canonicalName, ...i.aliases].includes(g))
);
assert('every gated alias exists in its entry', !badGate, badGate?.canonicalName);

rmSync(workDir, { recursive: true, force: true });

for (const f of failures) {
  console.log(`FAIL  ${f.name}`);
  if (f.text !== undefined) console.log(`      text:     ${JSON.stringify(f.text)}`);
  console.log(`      expected: [${f.expected}]`);
  console.log(`      got:      [${f.got}]`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length === 0 ? 0 : 1);
