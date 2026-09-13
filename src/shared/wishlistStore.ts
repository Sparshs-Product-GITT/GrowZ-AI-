// Wishlist persistence, shared by the content script (star toggles) and the
// toolbar popup (list view). Backed by chrome.storage.sync rather than .local
// so the list follows the user's signed-in Chrome profile across devices --
// note that with sync switched off Chrome silently treats it as local-only.
// Content scripts can reach chrome.storage directly, so unlike the Yahoo/news
// fetches none of this needs to go through the background worker.

import type { WishlistItem } from './types';

const STORAGE_KEY = 'wishlist';

/** Everything needed to identify a company; `addedAt` is stamped on write. */
export type WishlistCandidate = Omit<WishlistItem, 'addedAt'>;

export async function getWishlist(): Promise<WishlistItem[]> {
  try {
    const stored = await chrome.storage.sync.get(STORAGE_KEY);
    const items = stored[STORAGE_KEY];
    return Array.isArray(items) ? (items as WishlistItem[]) : [];
  } catch {
    // Sync storage can fail (quota, transient profile errors); an empty list
    // degrades to "nothing starred" rather than breaking the hover popup.
    return [];
  }
}

export async function isInWishlist(yahooSymbol: string): Promise<boolean> {
  const items = await getWishlist();
  return items.some((item) => item.yahooSymbol === yahooSymbol);
}

export async function addToWishlist(candidate: WishlistCandidate): Promise<WishlistItem[]> {
  const items = await getWishlist();
  if (items.some((item) => item.yahooSymbol === candidate.yahooSymbol)) return items;

  const next = [...items, { ...candidate, addedAt: Date.now() }];
  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}

export async function removeFromWishlist(yahooSymbol: string): Promise<WishlistItem[]> {
  const items = await getWishlist();
  const next = items.filter((item) => item.yahooSymbol !== yahooSymbol);
  if (next.length === items.length) return items;

  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return next;
}

/** Resolves to whether the company is starred *after* the toggle. */
export async function toggleWishlist(candidate: WishlistCandidate): Promise<boolean> {
  const items = await getWishlist();
  const alreadyStarred = items.some((item) => item.yahooSymbol === candidate.yahooSymbol);

  const next = alreadyStarred
    ? items.filter((item) => item.yahooSymbol !== candidate.yahooSymbol)
    : [...items, { ...candidate, addedAt: Date.now() }];

  await chrome.storage.sync.set({ [STORAGE_KEY]: next });
  return !alreadyStarred;
}

/**
 * Fires on every wishlist write, including ones made in another tab, in the
 * toolbar popup, or on another synced device -- so an open star icon and the
 * popup list never drift out of step.
 */
export function onWishlistChanged(callback: (items: WishlistItem[]) => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    const change = changes[STORAGE_KEY];
    if (!change) return;
    callback(Array.isArray(change.newValue) ? (change.newValue as WishlistItem[]) : []);
  });
}
