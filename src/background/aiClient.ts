// Ranks and summarizes already-fetched articles through Google's Gemini API.
//
// The model only ever picks from, and rewrites the prose of, articles it was
// handed: it returns indices into the candidate list, and the title, source,
// url and timestamp of the selected items are carried over from the news
// provider untouched. A citation therefore cannot be hallucinated, which is
// the whole point of routing through indices instead of asking for links.
//
// It is also working from headlines alone, because the Google News feed
// carries no article body or blurb. The prompt is written around that limit:
// the model restates and ranks what a headline already says instead of
// summarizing an article it cannot see, since the latter invites invented
// figures and outcomes. It also does the filtering the feed itself won't --
// live-price pages, option-chain listings and same-name-different-subject
// stories all show up in a keyword search.

import { GEMINI_API_KEY } from './apiKeys';
import type { NewsItem } from '../shared/types';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

interface RankedSelection {
  items?: Array<{ index?: number; summary?: string }>;
}

/**
 * Change this one constant if the free-tier model line-up moves on. Google
 * retires model names on a schedule and the 404 it returns names the
 * replacement, which readError() surfaces verbatim.
 */
const MODEL = 'gemini-3.6-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_ITEMS = 5;

const SYSTEM_PROMPT =
  'You are a financial news assistant for retail investors following Indian listed companies. ' +
  'You are given a numbered list of recent news HEADLINES about one company, with the publisher ' +
  'and publication time. You cannot see the article bodies. Select the ones that matter most to ' +
  'someone holding or considering the stock, most material first, and for each write one short ' +
  'plain-English line saying what it reports. ' +
  'Restate only what the headline itself states: never add figures, causes, outcomes, or context ' +
  'that is not in the headline, and never invent a headline. If a headline is too vague to be ' +
  'informative on its own, leave the summary empty rather than guessing. ' +
  'Drop entries that are not news about this company: live share-price or option-chain pages, ' +
  'target-price and forecast listings, generic exchange or broker landing pages, pure promotional ' +
  'copy, and stories that merely share the company name while being about a different subject. ' +
  'Drop duplicates of the same story, keeping the most credible publisher.';

export function hasGeminiKey(): boolean {
  return GEMINI_API_KEY.trim().length > 0;
}

export async function rankAndSummarize(
  companyName: string,
  candidates: NewsItem[]
): Promise<NewsItem[]> {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Sent as a header rather than a ?key= query param so the key stays out
      // of anything that logs URLs.
      'x-goog-api-key': GEMINI_API_KEY.trim(),
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildPrompt(companyName, candidates) }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    // Google's own error text distinguishes the cases that otherwise look
    // identical from the outside -- a rejected key, an exhausted quota, a
    // retired model name -- so it is surfaced into the worker console and the
    // verify script.
    throw new Error(`Gemini request failed (${response.status}): ${await readError(response)}`);
  }

  const data = (await response.json()) as GeminiResponse;
  const content = (data.candidates?.[0]?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();
  if (!content) {
    throw new Error('Gemini returned an empty response');
  }

  const parsed = JSON.parse(content) as RankedSelection;
  const selections = Array.isArray(parsed.items) ? parsed.items : [];

  const seen = new Set<number>();
  const ranked: NewsItem[] = [];
  for (const selection of selections) {
    const index = selection.index;
    if (typeof index !== 'number' || !candidates[index] || seen.has(index)) continue;
    seen.add(index);
    ranked.push({
      ...candidates[index],
      summary: selection.summary?.trim() || candidates[index].summary,
    });
    if (ranked.length === MAX_ITEMS) break;
  }

  return ranked;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { status?: string; message?: string } };
    const { status, message } = body.error ?? {};
    return [status, message].filter(Boolean).join(' - ') || 'no error detail returned';
  } catch {
    return 'unparseable error response';
  }
}

function buildPrompt(companyName: string, candidates: NewsItem[]): string {
  const headlines = candidates
    .map((item, index) => {
      const published = item.publishedAt ? new Date(item.publishedAt).toISOString() : 'unknown';
      return `${index}. ${item.title}\n   publisher: ${item.source}\n   published: ${published}`;
    })
    .join('\n');

  return (
    `Company: ${companyName}\n\n` +
    `Headlines:\n${headlines}\n\n` +
    `Pick at most ${MAX_ITEMS} headlines and respond with JSON of the form ` +
    '{"items":[{"index":<number of the headline above>,"summary":"<one sentence, or \\"\\" if the ' +
    'headline speaks for itself>"}]}. Order the array most important first. If none of the ' +
    'headlines are real news about this company, return {"items":[]}.'
  );
}
