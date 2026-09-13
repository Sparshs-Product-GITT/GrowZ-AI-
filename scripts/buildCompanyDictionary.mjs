#!/usr/bin/env node
// One-time / periodic tool to turn NSE's public "Equity List" CSV into
// src/data/companies.json.
//
// Usage:
//   node scripts/buildCompanyDictionary.mjs <path-to-nse-equity-list.csv>
//
// Download the source CSV from NSE's website (Markets > Securities Available
// for Trading > Equity List). It contains columns including:
//   SYMBOL, NAME OF COMPANY, SERIES, DATE OF LISTING, ...
//
// This script:
//   1. Parses the CSV.
//   2. Derives a short-name alias for each row by stripping common suffixes
//      ("Limited", "Ltd", "India Limited", etc).
//   3. Merges in manual alias overrides from scripts/manualAliases.json (for
//      well-known short forms that can't be derived automatically, e.g.
//      "TCS", "Infy", "HUL").
//   4. Writes the merged result to src/data/companies.json.
//
// Re-run this whenever you want to refresh/expand the dictionary beyond the
// hand-seeded starter list already committed at src/data/companies.json.
// Keep scripts/manualAliases.json as the source of truth for hand-curated
// aliases so re-running this script doesn't lose them.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Note: deliberately NOT stripping "India" as part of a compound suffix
// (e.g. " india limited") here -- for many companies "India" is a
// meaningful, load-bearing part of the colloquial short name, not a
// redundant subsidiary marker. E.g. "Nestle India Limited" is always called
// "Nestle India" (not bare "Nestle") and "Coal India Limited" is always
// "Coal India" (bare "Coal" would be both wrong and a dangerously generic,
// high-false-positive-risk alias). Stripping only the legal-entity suffix
// keeps these intact; genuinely redundant "India" qualifiers (e.g. "GAIL
// (India) Limited" -> colloquially just "GAIL") are handled via
// manualAliases.json overrides instead, on a per-company basis.
const SUFFIXES_TO_STRIP = [' limited', ' ltd.', ' ltd'];

function deriveShortName(name) {
  const lower = name.toLowerCase();
  for (const suffix of SUFFIXES_TO_STRIP) {
    if (lower.endsWith(suffix)) {
      return name.slice(0, name.length - suffix.length).trim();
    }
  }
  return name.trim();
}

// A leading "The " is legally accurate (e.g. "The Federal Bank Limited",
// "The Phoenix Mills Limited") but is almost always dropped in colloquial/
// news usage ("Federal Bank", "Phoenix Mills"). Unlike the trailing-"India"
// case above, dropping a leading "The" is safe across the board -- it's
// never load-bearing for disambiguation. Returns null if there's no leading
// "The " to strip.
function deriveWithoutLeadingThe(shortName) {
  const match = /^the\s+(.+)$/i.exec(shortName);
  return match ? match[1].trim() : null;
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map((h) => h.trim().toUpperCase());
  const symbolIdx = header.indexOf('SYMBOL');
  const nameIdx = header.indexOf('NAME OF COMPANY');
  if (symbolIdx === -1 || nameIdx === -1) {
    throw new Error(
      'CSV must contain SYMBOL and NAME OF COMPANY columns (NSE equity list format)'
    );
  }
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    return { symbol: cols[symbolIdx]?.trim(), name: cols[nameIdx]?.trim() };
  }).filter((row) => row.symbol && row.name);
}

function loadManualAliases() {
  const filePath = path.join(__dirname, 'manualAliases.json');
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    delete parsed._comment;
    return parsed;
  } catch {
    return {};
  }
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node scripts/buildCompanyDictionary.mjs <path-to-nse-equity-list.csv>');
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(csvPath, 'utf-8'));
  const manualAliases = loadManualAliases();

  const companies = rows.map(({ symbol, name }) => {
    const shortName = deriveShortName(name);
    const aliasSet = new Set();
    if (shortName && shortName !== name) aliasSet.add(shortName);
    const withoutThe = deriveWithoutLeadingThe(shortName);
    if (withoutThe) aliasSet.add(withoutThe);
    for (const alias of manualAliases[symbol] ?? []) aliasSet.add(alias);

    return {
      canonicalName: name,
      aliases: Array.from(aliasSet),
      ticker: symbol,
      yahooSymbol: `${symbol}.NS`,
      tvSymbol: `NSE:${symbol}`,
    };
  });

  const outPath = path.join(__dirname, '..', 'src', 'data', 'companies.json');
  writeFileSync(outPath, JSON.stringify(companies, null, 2) + '\n');
  console.log(`Wrote ${companies.length} companies to ${outPath}`);
}

main();
