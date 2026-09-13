// Toolbar popup: lists the companies starred into chrome.storage.sync. Only
// identity is stored, so each row's price is fetched fresh through the
// background worker's GET_QUOTE (and its existing 5-minute cache) on open.

import { getQuote } from '../shared/messaging';
import { getWishlist, removeFromWishlist, onWishlistChanged } from '../shared/wishlistStore';
import type { Quote, WishlistItem } from '../shared/types';

const EMPTY_MESSAGE =
  'No stocks saved yet. Hover a highlighted company on a financial news site and tap the star to add it here.';

const listEl = document.getElementById('wl-list') as HTMLDivElement;

// Bumped on every render so quote responses from a superseded render (e.g. an
// item was removed while its price was still in flight) are dropped.
let renderId = 0;

function render(items: WishlistItem[]): void {
  const currentRender = ++renderId;
  listEl.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'wl-empty';
    empty.textContent = EMPTY_MESSAGE;
    listEl.appendChild(empty);
    return;
  }

  // Newest star first: the list is append-only in storage, so reverse rather
  // than sorting on every render.
  for (const item of [...items].reverse()) {
    listEl.appendChild(buildRow(item, currentRender));
  }
}

function buildRow(item: WishlistItem, currentRender: number): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'wl-row';

  const identity = document.createElement('div');
  identity.className = 'wl-identity';
  const ticker = document.createElement('div');
  ticker.className = 'wl-ticker';
  ticker.textContent = item.ticker;
  const name = document.createElement('div');
  name.className = 'wl-name';
  name.textContent = item.companyName;
  name.title = item.companyName;
  identity.append(ticker, name);

  const quoteEl = document.createElement('div');
  quoteEl.className = 'wl-quote';
  const ltpEl = document.createElement('div');
  ltpEl.className = 'wl-ltp';
  ltpEl.textContent = '\u2026';
  const changeEl = document.createElement('div');
  changeEl.className = 'wl-change';
  quoteEl.append(ltpEl, changeEl);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'wl-remove';
  removeBtn.textContent = '\u2715';
  removeBtn.title = `Remove ${item.ticker} from wishlist`;
  removeBtn.setAttribute('aria-label', removeBtn.title);
  removeBtn.addEventListener('click', () => {
    void removeFromWishlist(item.yahooSymbol).then(render);
  });

  row.append(identity, quoteEl, removeBtn);

  void getQuote(item.yahooSymbol, item.kind, item.ticker).then((response) => {
    if (currentRender !== renderId) return;
    if (!response.ok) {
      ltpEl.textContent = 'N/A';
      return;
    }
    paintQuote(response.quote, ltpEl, changeEl);
  });

  return row;
}

function paintQuote(quote: Quote, ltpEl: HTMLDivElement, changeEl: HTMLDivElement): void {
  ltpEl.textContent = formatLevel(quote);

  const direction = quote.change > 0 ? 'positive' : quote.change < 0 ? 'negative' : 'neutral';
  changeEl.className = `wl-change ${direction}`;
  const sign = quote.change > 0 ? '+' : '';
  changeEl.textContent = `${sign}${quote.change.toFixed(2)} (${sign}${quote.changePercent.toFixed(
    2
  )}%)`;
}

// An index level is a dimensionless number, not an amount of money, so the
// rupee symbol is dropped for indices.
function formatLevel(quote: Quote): string {
  const formatted = quote.ltp.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (quote.kind === 'index') return formatted;
  return `${quote.currency === 'INR' || !quote.currency ? '\u20b9' : ''}${formatted}`;
}

void getWishlist().then(render);
onWishlistChanged(render);
