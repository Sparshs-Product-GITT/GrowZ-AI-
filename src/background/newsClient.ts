// Fetches recent company news from Google News' RSS search, pinned to the
// India edition (hl/gl/ceid) so results come from the Indian financial press
// the rest of this extension already deals with. Chosen over the symbol-keyed
// finance APIs because Yahoo returns no news at all for NSE symbols and the
// global wires carry little Indian mid/small-cap coverage; this feed needs no
// API key or quota at all.
//
// Two consequences of the source worth knowing:
//   1. MV3 service workers have no DOMParser, so the feed is picked apart with
//      regex rather than parsed as XML.
//   2. The feed carries no article blurb -- only a headline, publisher and
//      timestamp -- so NewsItem.summary starts empty and is filled in (if at
//      all) by the AI step from the headline alone.

import type { NewsItem } from '../shared/types';

const LOOKBACK_HOURS = 48;
/** Upper bound on what gets handed to the summarizer, to cap token spend. */
const MAX_CANDIDATES = 20;

/**
 * Quoting the query makes Google match the phrase exactly, so the NSE-style
 * corporate suffix is trimmed first: "Titan Company Limited" as a literal
 * phrase barely appears in press coverage, while "Titan Company" does.
 */
const CORPORATE_SUFFIX_RE = /\s+(?:limited|ltd\.?)$/i;

const ITEM_RE = /<item>([\s\S]*?)<\/item>/g;
const TITLE_RE = /<title>([\s\S]*?)<\/title>/;
const LINK_RE = /<link>([\s\S]*?)<\/link>/;
const PUB_DATE_RE = /<pubDate>([\s\S]*?)<\/pubDate>/;
const SOURCE_RE = /<source[^>]*>([\s\S]*?)<\/source>/;

/**
 * Takes the dictionary's canonical name rather than a ticker: this feed is
 * keyword-searched, and the canonical name is what disambiguates the entries
 * flagged in ambiguousBlocklist.json (a bare "Titan" also matches Saturn's
 * moon).
 */
export async function fetchRecentNews(companyName: string): Promise<NewsItem[]> {
  const phrase = companyName.replace(CORPORATE_SUFFIX_RE, '').trim() || companyName;
  const query = `"${phrase}" when:${Math.round(LOOKBACK_HOURS / 24)}d`;
  const url =
    `https://news.google.com/rss/search?q=${encodeURIComponent(query)}` +
    '&hl=en-IN&gl=IN&ceid=IN:en';

  const response = await fetch(url, { headers: { Accept: 'application/rss+xml, text/xml' } });
  if (!response.ok) {
    throw new Error(`Google News request failed (${response.status})`);
  }

  const cutoff = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;

  // Feed order is Google's own relevance ranking, which is a better candidate
  // filter than recency for a phrase query, so it is preserved here and the AI
  // step re-ranks what survives.
  return parseFeed(await response.text())
    .filter((item) => item.publishedAt >= cutoff)
    .slice(0, MAX_CANDIDATES);
}

function parseFeed(xml: string): NewsItem[] {
  const items: NewsItem[] = [];

  for (const match of xml.matchAll(ITEM_RE)) {
    const block = match[1];
    const title = decodeXml(extract(block, TITLE_RE));
    const url = decodeXml(extract(block, LINK_RE));
    if (!title || !url) continue;

    const source = decodeXml(extract(block, SOURCE_RE)) || 'Unknown source';
    const publishedAt = Date.parse(extract(block, PUB_DATE_RE));

    items.push({
      title: stripSourceSuffix(title, source),
      summary: '',
      source,
      url,
      publishedAt: Number.isNaN(publishedAt) ? 0 : publishedAt,
    });
  }

  return items;
}

function extract(block: string, pattern: RegExp): string {
  return pattern.exec(block)?.[1]?.trim() ?? '';
}

/** Feed titles end with " - Publisher", which we render separately. */
function stripSourceSuffix(title: string, source: string): string {
  const suffix = ` - ${source}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos|nbsp));/gi, (match, dec, hex, named) => {
      if (dec) return String.fromCodePoint(Number(dec));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      switch (String(named).toLowerCase()) {
        case 'amp':
          return '&';
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        case 'nbsp':
          return ' ';
        default:
          return match;
      }
    })
    .trim();
}
