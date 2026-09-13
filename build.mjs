// Build script for the GrowZ AI extension.
// Bundles the background service worker, the content script and the toolbar
// popup script independently (each as a self-contained IIFE, since MV3 content
// scripts and service workers are loaded as classic scripts) and copies
// manifest.json plus the popup's HTML/CSS/icons into dist/.
//
// Usage:
//   node build.mjs            one-off production build
//   node build.mjs --watch    rebuild on file changes

import { build, context } from 'esbuild';
import { mkdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(__dirname, 'dist');
const watch = process.argv.includes('--watch');

function copyStaticAssets() {
  cpSync(path.join(__dirname, 'manifest.json'), path.join(outdir, 'manifest.json'));
  // The popup is a real HTML page rather than a shadow-root component, so its
  // stylesheet is copied and <link>ed instead of imported as a text loader.
  cpSync(path.join(__dirname, 'popup.html'), path.join(outdir, 'popup.html'));
  cpSync(path.join(__dirname, 'src/popup/popup.css'), path.join(outdir, 'popup.css'));
  cpSync(path.join(__dirname, 'icons'), path.join(outdir, 'icons'), { recursive: true });
}

const commonOptions = {
  bundle: true,
  sourcemap: true,
  target: 'chrome110',
  format: 'iife',
  loader: { '.css': 'text' },
  logLevel: 'info',
};

const entryConfigs = [
  {
    entryPoints: [path.join(__dirname, 'src/background/service-worker.ts')],
    outfile: path.join(outdir, 'background.js'),
  },
  {
    entryPoints: [path.join(__dirname, 'src/content/index.ts')],
    outfile: path.join(outdir, 'content.js'),
  },
  {
    entryPoints: [path.join(__dirname, 'src/popup/popup.ts')],
    outfile: path.join(outdir, 'popup.js'),
  },
];

async function run() {
  if (existsSync(outdir)) rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  copyStaticAssets();

  if (watch) {
    for (const cfg of entryConfigs) {
      const ctx = await context({ ...commonOptions, ...cfg });
      await ctx.watch();
    }
    console.log('Watching for changes... (Ctrl+C to stop)');
  } else {
    for (const cfg of entryConfigs) {
      await build({ ...commonOptions, ...cfg });
    }
    console.log('Build complete -> dist/');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
