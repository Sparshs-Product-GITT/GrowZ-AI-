// Template for the gitignored `apiKeys.ts` next to this file. Copy it, paste
// your key in, and re-run `npm run build`.
//
// The key ends up in plain text inside dist/background.js, because the news
// layer calls Gemini directly with no server in between. That is fine for a
// personally loaded unpacked extension and nowhere else: never publish this
// build to the Chrome Web Store or share the dist/ folder.
//
// Leaving it blank is safe. The news source itself (Google News RSS) needs no
// key, so an empty value simply means recent headlines are listed without
// AI ranking or summaries.

/**
 * https://aistudio.google.com/apikey -- Google AI Studio keys have a genuinely
 * free tier. Must be an AI Studio key (starts with "AIza"), not an OAuth token
 * or a Vertex AI credential, which this endpoint rejects.
 */
export const GEMINI_API_KEY = '';
