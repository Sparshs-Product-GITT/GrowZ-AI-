// Lightweight hover popup: ticker, full company name, LTP, day change, and a
// single "View Chart" button. No chart is loaded here -- that only happens in
// ExpandedPanel once the user explicitly clicks the button, to avoid paying
// the TradingView widget's load cost on every hover.

import css from './MiniPopup.css';
import type { EntryKind, Quote } from '../../shared/types';
import { isInWishlist, toggleWishlist } from '../../shared/wishlistStore';

export interface MiniPopupContext {
  ticker: string;
  companyName: string;
  yahooSymbol: string;
  tvSymbol: string;
  kind: EntryKind;
}

export type ViewChartHandler = (context: MiniPopupContext) => void;

const POPUP_WIDTH = 200;
const ESTIMATED_HEIGHT = 165;
const VIEWPORT_MARGIN = 8;

export class MiniPopup {
  private hostEl: HTMLDivElement;
  private shadow: ShadowRoot;
  private tickerEl: HTMLParagraphElement;
  private nameEl: HTMLParagraphElement;
  private bodyEl: HTMLDivElement;
  private context: MiniPopupContext | null = null;
  private hideTimeout: number | undefined;

  constructor(private onViewChart: ViewChartHandler) {
    this.hostEl = document.createElement('div');
    Object.assign(this.hostEl.style, {
      position: 'fixed',
      zIndex: '2147483647',
      display: 'none',
      top: '0',
      left: '0',
    });
    document.documentElement.appendChild(this.hostEl);
    this.shadow = this.hostEl.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = css;
    this.shadow.appendChild(style);

    const card = document.createElement('div');
    card.className = 'gsh-mini-popup';

    this.tickerEl = document.createElement('p');
    this.tickerEl.className = 'gsh-ticker';

    this.nameEl = document.createElement('p');
    this.nameEl.className = 'gsh-name';

    this.bodyEl = document.createElement('div');
    this.bodyEl.className = 'gsh-body';

    card.append(this.tickerEl, this.nameEl, this.bodyEl);
    this.shadow.appendChild(card);

    // Keep the popup open while the cursor is over it (e.g. moving from the
    // highlighted text down into the popup to click "View Chart").
    this.hostEl.addEventListener('mouseenter', () => this.cancelHide());
    this.hostEl.addEventListener('mouseleave', () => this.scheduleHide());
  }

  scheduleHide(delay = 200): void {
    this.cancelHide();
    this.hideTimeout = window.setTimeout(() => this.hide(), delay);
  }

  cancelHide(): void {
    if (this.hideTimeout !== undefined) {
      window.clearTimeout(this.hideTimeout);
      this.hideTimeout = undefined;
    }
  }

  showLoading(anchorRect: DOMRect, context: MiniPopupContext): void {
    // Some publisher pages rebuild large parts of the document and take our
    // host node with them. Re-attaching is cheap and idempotent.
    if (!this.hostEl.isConnected) document.documentElement.appendChild(this.hostEl);

    this.context = context;
    this.tickerEl.textContent = context.ticker;
    this.nameEl.textContent = context.companyName;
    this.bodyEl.innerHTML = '';

    const loading = document.createElement('div');
    loading.className = 'gsh-loading';
    loading.textContent = 'Loading...';
    this.bodyEl.appendChild(loading);

    this.position(anchorRect);
    this.hostEl.style.display = 'block';
    this.cancelHide();
  }

  renderQuote(yahooSymbol: string, quote: Quote): void {
    // Guard against a stale async response landing after the user has moved
    // on to hovering a different company.
    if (!this.context || this.context.yahooSymbol !== yahooSymbol) return;
    this.bodyEl.innerHTML = '';

    const ltp = document.createElement('p');
    ltp.className = 'gsh-ltp';
    ltp.textContent = formatLevel(quote);

    const change = document.createElement('p');
    const direction = quote.change > 0 ? 'positive' : quote.change < 0 ? 'negative' : 'neutral';
    change.className = `gsh-change ${direction}`;
    const sign = quote.change > 0 ? '+' : '';
    change.textContent = `${sign}${quote.change.toFixed(2)} (${sign}${quote.changePercent.toFixed(2)}%)`;

    const divider = document.createElement('hr');
    divider.className = 'gsh-divider';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gsh-view-chart-btn';
    btn.textContent = 'View Chart';
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.context) this.onViewChart(this.context);
    });

    const actionRow = document.createElement('div');
    actionRow.className = 'gsh-action-row';
    actionRow.append(btn, this.buildStarButton(this.context));

    this.bodyEl.append(ltp, change, divider, actionRow);
  }

  /**
   * The popup is a singleton reused across companies, so the button is rebuilt
   * per render against the freshly hovered company and its starred state is
   * filled in once storage answers.
   */
  private buildStarButton(context: MiniPopupContext): HTMLButtonElement {
    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = 'gsh-star-btn';

    const paint = (starred: boolean) => {
      starBtn.classList.toggle('starred', starred);
      starBtn.textContent = starred ? '\u2605' : '\u2606';
      starBtn.title = starred ? 'Remove from wishlist' : 'Add to wishlist';
      starBtn.setAttribute('aria-label', starBtn.title);
      starBtn.setAttribute('aria-pressed', String(starred));
    };
    paint(false);

    void isInWishlist(context.yahooSymbol).then((starred) => {
      // Ignore the answer if the user has already moved on to another company.
      if (this.context?.yahooSymbol === context.yahooSymbol) paint(starred);
    });

    starBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      void toggleWishlist(context).then(paint);
    });

    return starBtn;
  }

  renderError(yahooSymbol: string, message: string): void {
    if (!this.context || this.context.yahooSymbol !== yahooSymbol) return;
    this.bodyEl.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'gsh-error';
    err.textContent = message || 'Data unavailable';
    this.bodyEl.appendChild(err);
  }

  hide(): void {
    this.hostEl.style.display = 'none';
    this.context = null;
  }

  isShowing(): boolean {
    return this.hostEl.style.display !== 'none';
  }

  getActiveSymbol(): string | null {
    return this.context?.yahooSymbol ?? null;
  }

  private position(anchorRect: DOMRect): void {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = anchorRect.left;
    if (left + POPUP_WIDTH + VIEWPORT_MARGIN > viewportWidth) {
      left = Math.max(VIEWPORT_MARGIN, viewportWidth - POPUP_WIDTH - VIEWPORT_MARGIN);
    }

    let top = anchorRect.bottom + VIEWPORT_MARGIN;
    if (top + ESTIMATED_HEIGHT > viewportHeight) {
      // Flip above the highlighted text if there isn't room below.
      top = Math.max(VIEWPORT_MARGIN, anchorRect.top - ESTIMATED_HEIGHT - VIEWPORT_MARGIN);
    }

    this.hostEl.style.left = `${left}px`;
    this.hostEl.style.top = `${top}px`;
  }
}

// An index level is a dimensionless number, not an amount of money, so the
// rupee symbol is dropped for indices.
function formatLevel(quote: Quote): string {
  const prefix = quote.kind === 'index' ? '' : quote.currency === 'INR' ? '\u20b9' : '';
  return `${prefix}${quote.ltp.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
