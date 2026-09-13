#!/usr/bin/env node
// Runs the recent-news pipeline exactly as the background worker does, so the
// Gemini key in src/background/apiKeys.ts can be checked without loading the
// extension into Chrome and digging through the service worker's console.
//
// Usage:
//   npm run verify:news                          -- checks a default company
//   npm run verify:news -- "Titan Company Limited"
//
// The real newsClient.ts/aiClient.ts modules are bundled on the fly and
// imported from memory, rather than reimplemented here, so a pass genuinely
// exercises the shipped code path (feed parsing included).

import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const age = (ms) => `${Math.round((Date.now() - ms) / 3600000)}h ago`;

async function loadPipeline() {
  const bundle = await build({
    stdin: {
      contents: [
        "export { fetchRecentNews } from './src/background/newsClient';",
        "export { rankAndSummarize, hasGeminiKey } from './src/background/aiClient';",
      ].join('\n'),
      resolveDir: repoRoot,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    write: false,
    logLevel: 'error',
  });

  const encoded = Buffer.from(bundle.outputFiles[0].text).toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}

async function run() {
  const company = process.argv[2] || 'Reliance Industries Limited';
  const { fetchRecentNews, rankAndSummarize, hasGeminiKey } = await loadPipeline();

  console.log(`Company: ${company}`);
  console.log(`Gemini key present: ${hasGeminiKey() ? 'yes' : 'no'}\n`);

  const candidates = await fetchRecentNews(company);
  console.log(`Google News returned ${candidates.length} headline(s) from the last 48h.`);
  for (const item of candidates.slice(0, 5)) {
    console.log(`  - [${item.source}, ${age(item.publishedAt)}] ${item.title}`);
  }

  if (candidates.length === 0) {
    console.log('\nFAIL: no headlines found. Try another company name.');
    return 1;
  }

  if (!hasGeminiKey()) {
    console.log(
      '\nPASS (headlines only): paste your key into src/background/apiKeys.ts to enable' +
        ' AI ranking and summaries, then run this again.'
    );
    return 0;
  }

  console.log('\nAsking Gemini to rank and summarize...\n');
  let ranked;
  try {
    ranked = await rankAndSummarize(company, candidates);
  } catch (err) {
    console.log(`FAIL: Gemini call failed -- ${err.message}`);
    console.log('The extension still works: it falls back to the raw headlines above.');
    return 1;
  }

  if (ranked.length === 0) {
    console.log('WARN: Gemini judged none of these headlines to be real news for this company.');
    console.log('The extension will show the raw headlines above instead.');
    return 0;
  }

  // Mirrors what the panel renders: summary first, then the attribution line.
  for (const item of ranked) {
    console.log(`* ${item.title}`);
    if (item.summary) console.log(`  ${item.summary}`);
    console.log(`  ${item.source} \u00b7 ${age(item.publishedAt)}`);
    console.log(`  ${item.url}\n`);
  }

  console.log(`PASS: ${ranked.length} summarized item(s). This is what the panel will show.`);
  return 0;
}

// Set rather than passed to process.exit(): esbuild keeps a helper process
// around, and tearing this process down mid-shutdown trips a libuv assertion
// on Windows.
process.exitCode = await run();
