// Heuristics to reduce false positives when a company's name/alias is also a
// common English word (e.g. "Titan", "Page", "Force"). Names listed in
// ambiguousBlocklist.json are only highlighted when nearby text contains a
// financial-context keyword.

import ambiguousData from '../data/ambiguousBlocklist.json';

interface AmbiguousData {
  contextKeywords: string[];
  ambiguousTickers: string[];
}

const { contextKeywords, ambiguousTickers } = ambiguousData as AmbiguousData;

const ambiguousTickerSet = new Set(ambiguousTickers);
const lowerContextKeywords = contextKeywords.map((kw) => kw.toLowerCase());

export function isAmbiguousTicker(ticker: string): boolean {
  return ambiguousTickerSet.has(ticker);
}

// Names that denote both a listed company and the venue other companies are
// listed on. BSE Limited is itself NSE/BSE-listed, so "BSE" is a legitimate
// company mention in "BSE shares rose" but not in "listed on the BSE" -- and
// the latter phrasing appears in a large share of Indian financial articles.
const VENUE_NAMES = new Set(['bse', 'nse', 'bombay stock exchange', 'national stock exchange']);

// Prepositional/possessive lead-ins that mark the venue sense.
const VENUE_PREFIX = /\b(?:on|at|from|to|of|via|across)\s+(?:the\s+)?$/i;
// Trailing words that mark the venue sense even without a preposition, e.g.
// "BSE-listed firms", "NSE data showed", "the BSE benchmark".
const VENUE_SUFFIX =
  /^(?:\s*-\s*listed|\s+(?:listed|data|filing|filings|circular|website|platform|benchmark|index|indices|exchange|bourse|bourses|session|trading))\b/i;

/**
 * True when the matched text is being used as a trading venue rather than as
 * the company of that name. Operates on the raw text node so it can see the
 * words immediately either side of the match, which the paragraph-level
 * context check deliberately blurs.
 */
export function isVenueMention(text: string, index: number, matchedText: string): boolean {
  if (!VENUE_NAMES.has(matchedText.toLowerCase())) return false;

  const before = text.slice(Math.max(0, index - 24), index);
  if (VENUE_PREFIX.test(before)) return true;

  const after = text.slice(index + matchedText.length);
  return VENUE_SUFFIX.test(after);
}

/**
 * `matchedText` is stripped from the text before scanning because several
 * company/index names are themselves financial-context keywords ("Nifty",
 * "BSE"). Left in, they would satisfy their own gate -- any sentence
 * containing the word would count as evidence that the word is financial,
 * which makes the gate a no-op precisely where it's needed most.
 */
export function hasFinancialContext(surroundingText: string, matchedText?: string): boolean {
  let lower = surroundingText.toLowerCase();
  if (matchedText) {
    lower = lower.split(matchedText.toLowerCase()).join(' ');
  }
  return lowerContextKeywords.some((kw) => lower.includes(kw));
}

/**
 * Walk up from a text node to find a nearby block-level ancestor with enough
 * text to reasonably judge context (e.g. the paragraph containing the match),
 * capped at a few levels so we don't end up scanning the whole page.
 */
export function getSurroundingText(node: Text, maxChars = 500): string {
  let el: HTMLElement | null = node.parentElement;
  let depth = 0;
  while (el && depth < 4) {
    const text = el.innerText ?? el.textContent ?? '';
    if (text.length > 20) break;
    el = el.parentElement;
    depth += 1;
  }
  const text = el?.innerText ?? el?.textContent ?? node.textContent ?? '';
  return text.slice(0, maxChars);
}
