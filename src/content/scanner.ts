// Scans the page's DOM text nodes for recognized NSE/BSE company names and
// wraps every occurrence in a highlighted <span>. Runs entirely client-side
// against the static dictionary in src/data/companies.json.

import companiesData from '../data/companies.json';
import indicesData from '../data/indices.json';
import type { CompanyEntry } from '../shared/types';
import {
  getSurroundingText,
  hasFinancialContext,
  isAmbiguousTicker,
  isVenueMention,
} from './disambiguation';

export const HIGHLIGHT_CLASS = 'gsh-highlight';

interface AliasEntry {
  alias: string;
  entry: CompanyEntry;
  /** Only match this alias when the surrounding text looks financial. */
  gated: boolean;
}

// Indices are kept in their own file because buildCompanyDictionary.mjs
// overwrites companies.json wholesale on every regeneration from an NSE CSV.
const companies = [...(companiesData as CompanyEntry[]), ...(indicesData as CompanyEntry[])];

// Build alias -> entry lookup, preferring the longest alias when the same
// text is somehow claimed by multiple entries.
const aliasEntries: AliasEntry[] = [];
for (const entry of companies) {
  const gatedAliases = new Set((entry.gated ?? []).map((a) => a.toLowerCase()));
  for (const alias of [entry.canonicalName, ...entry.aliases]) {
    if (alias && alias.trim().length > 1) {
      const trimmed = alias.trim();
      aliasEntries.push({
        alias: trimmed,
        entry,
        gated: gatedAliases.has(trimmed.toLowerCase()),
      });
    }
  }
}
aliasEntries.sort((a, b) => b.alias.length - a.alias.length);

const aliasLookup = new Map<string, AliasEntry>();
for (const aliasEntry of aliasEntries) {
  const key = aliasEntry.alias.toLowerCase();
  if (!aliasLookup.has(key)) aliasLookup.set(key, aliasEntry);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const matchRegex = new RegExp(
  `\\b(${aliasEntries.map((a) => escapeRegExp(a.alias)).join('|')})\\b`,
  'gi'
);

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT']);

function shouldSkipElement(el: Element | null): boolean {
  if (!el) return true;
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.closest(`.${HIGHLIGHT_CLASS}`)) return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

// Text nodes we've already processed (either highlighted or determined to
// have no matches) so the MutationObserver-driven rescans don't loop forever
// on nodes we create ourselves.
const processedNodes = new WeakSet<Node>();

export interface MatchInfo {
  index: number;
  length: number;
  entry: CompanyEntry;
}

/**
 * Pure matching pass over a string. `getSurrounding` is a callback rather
 * than a string so the (comparatively expensive) walk up to a block-level
 * ancestor only happens for the gated aliases that actually need it.
 */
export function findMatchesInText(text: string, getSurrounding: () => string): MatchInfo[] {
  const matches: MatchInfo[] = [];
  matchRegex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = matchRegex.exec(text)) !== null) {
    const matchedText = m[0];
    const aliasEntry = aliasLookup.get(matchedText.toLowerCase());
    if (!aliasEntry) continue;
    const { entry } = aliasEntry;

    // "BSE"/"NSE"/"Bombay Stock Exchange" name both a listed company and the
    // venue everything else is listed on, and the venue sense is by far the
    // more common one in financial news ("listed on the BSE"). The financial-
    // context check below can't separate them -- it fires on exactly the
    // sentences that are false positives -- so venue usage is rejected first.
    if (isVenueMention(text, m.index, matchedText)) continue;

    if (aliasEntry.gated || isAmbiguousTicker(entry.ticker)) {
      if (!hasFinancialContext(getSurrounding(), matchedText)) continue;
    }

    matches.push({ index: m.index, length: matchedText.length, entry });
  }
  return matches;
}

function buildHighlightSpan(text: string, entry: CompanyEntry): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = HIGHLIGHT_CLASS;
  span.setAttribute('data-yahoo-symbol', entry.yahooSymbol);
  span.setAttribute('data-tv-symbol', entry.tvSymbol);
  span.setAttribute('data-company-name', entry.canonicalName);
  span.setAttribute('data-ticker', entry.ticker);
  span.setAttribute('data-kind', entry.kind ?? 'equity');
  span.textContent = text;
  return span;
}

function processTextNode(textNode: Text): void {
  if (processedNodes.has(textNode)) return;
  processedNodes.add(textNode);

  const text = textNode.nodeValue;
  if (!text || !text.trim()) return;
  if (shouldSkipElement(textNode.parentElement)) return;

  const matches = findMatchesInText(text, () => getSurroundingText(textNode));
  if (matches.length === 0) return;

  const frag = document.createDocumentFragment();
  let lastIndex = 0;
  for (const match of matches) {
    if (match.index > lastIndex) {
      const before = document.createTextNode(text.slice(lastIndex, match.index));
      processedNodes.add(before);
      frag.appendChild(before);
    }
    const matchedText = text.slice(match.index, match.index + match.length);
    frag.appendChild(buildHighlightSpan(matchedText, match.entry));
    lastIndex = match.index + match.length;
  }
  if (lastIndex < text.length) {
    const after = document.createTextNode(text.slice(lastIndex));
    processedNodes.add(after);
    frag.appendChild(after);
  }

  textNode.parentNode?.replaceChild(frag, textNode);
}

function collectTextNodes(root: Node): Text[] {
  if (root.nodeType === Node.TEXT_NODE) {
    return processedNodes.has(root) || shouldSkipElement((root as Text).parentElement)
      ? []
      : [root as Text];
  }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    return [];
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (processedNodes.has(node)) return NodeFilter.FILTER_REJECT;
      if (shouldSkipElement((node as Text).parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

export function scanRoot(root: Node): void {
  for (const node of collectTextNodes(root)) {
    processTextNode(node);
  }
}

const HIGHLIGHT_STYLE_ID = 'gsh-highlight-style';

/**
 * Injects the light background-highlight style for recognized company
 * mentions once per page. Idempotent, safe to call multiple times.
 */
export function injectHighlightStyles(): void {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background-color: rgba(59, 130, 246, 0.18);
      border-radius: 3px;
      padding: 0 1px;
      cursor: pointer;
      transition: background-color 0.15s ease;
    }
    .${HIGHLIGHT_CLASS}:hover {
      background-color: rgba(59, 130, 246, 0.32);
    }
  `;
  document.head.appendChild(style);
}

/**
 * Observes the document for newly added content (e.g. infinite-scroll
 * articles, SPA navigation) and re-scans only the newly added subtrees,
 * debounced to avoid thrashing on bursty DOM updates.
 */
export function observeMutations(debounceMs = 300, maxWaitMs = 1500): MutationObserver {
  let pendingRoots: Node[] = [];
  let timeoutId: number | undefined;
  let firstPendingAt = 0;

  const flush = () => {
    const roots = pendingRoots;
    pendingRoots = [];
    firstPendingAt = 0;
    if (timeoutId) window.clearTimeout(timeoutId);
    timeoutId = undefined;
    for (const root of roots) {
      if (root.isConnected) scanRoot(root);
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => pendingRoots.push(node));
    }
    if (!firstPendingAt) firstPendingAt = Date.now();

    // A homepage with a live market ticker mutates faster than the debounce
    // window, so a pure debounce is never allowed to fire and nothing after
    // the first pass ever gets highlighted. Force a flush once the oldest
    // pending root has waited long enough.
    if (Date.now() - firstPendingAt >= maxWaitMs) {
      flush();
      return;
    }
    if (timeoutId) window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(flush, debounceMs);
  });

  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}
