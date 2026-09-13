// Content script entry point: scans the page for company mentions, wires up
// hover -> mini popup -> "View Chart" -> expanded panel interactions.

import { scanRoot, observeMutations, injectHighlightStyles, HIGHLIGHT_CLASS } from './scanner';
import { MiniPopup, type MiniPopupContext } from './components/MiniPopup';
import { ExpandedPanel } from './components/ExpandedPanel';
import { getQuote } from '../shared/messaging';

const HOVER_DELAY_MS = 350;

function readContext(span: HTMLElement): MiniPopupContext {
  return {
    ticker: span.getAttribute('data-ticker') ?? '',
    companyName: span.getAttribute('data-company-name') ?? '',
    yahooSymbol: span.getAttribute('data-yahoo-symbol') ?? '',
    tvSymbol: span.getAttribute('data-tv-symbol') ?? '',
    kind: span.getAttribute('data-kind') === 'index' ? 'index' : 'equity',
  };
}

function init(): void {
  injectHighlightStyles();

  // Both the mini popup and the expanded panel are process-wide singletons:
  // only one of each should ever exist, so a second hover/click updates the
  // existing instance in place rather than stacking new ones.
  const panel = new ExpandedPanel();
  const popup = new MiniPopup((context) => {
    void openOrUpdatePanel(context);
  });

  let hoverTimeout: number | undefined;
  let activeSpan: HTMLElement | null = null;
  let pointerX = 0;
  let pointerY = 0;

  /**
   * News homepages re-render their widgets on a timer, which detaches the
   * highlight the cursor is sitting on and replaces it with an identical new
   * one. Re-acquire the live span under the cursor so the popup still anchors
   * to the right place instead of to a detached node's all-zero rect.
   */
  function anchorRectFor(span: HTMLElement): DOMRect {
    if (span.isConnected) return span.getBoundingClientRect();

    const replacement = document
      .elementFromPoint(pointerX, pointerY)
      ?.closest<HTMLElement>(`.${HIGHLIGHT_CLASS}`);
    if (replacement?.getAttribute('data-ticker') === span.getAttribute('data-ticker')) {
      return replacement.getBoundingClientRect();
    }
    return new DOMRect(pointerX, pointerY, 0, 0);
  }

  async function fetchAndRenderQuote(context: MiniPopupContext): Promise<void> {
    if (!context.yahooSymbol) {
      popup.renderError(context.yahooSymbol, 'Data unavailable');
      return;
    }
    const response = await getQuote(context.yahooSymbol, context.kind, context.ticker);
    if (response.ok) {
      popup.renderQuote(context.yahooSymbol, response.quote);
    } else {
      popup.renderError(context.yahooSymbol, 'Data unavailable');
    }
  }

  async function openOrUpdatePanel(context: MiniPopupContext): Promise<void> {
    if (!context.yahooSymbol) return;
    const wasOpen = panel.isOpen();
    const response = await getQuote(context.yahooSymbol, context.kind, context.ticker);
    if (!response.ok) return;
    if (wasOpen) {
      panel.updateInPlace(response.quote, context);
    } else {
      panel.show(response.quote, context);
    }
  }

  // Capture phase, not bubble: several of the curated sites attach their own
  // mouseover handlers to article cards and call stopPropagation(), which
  // silently swallows the event before it reaches a document-level bubble
  // listener. Capturing runs this first, so page scripts can't suppress it.
  document.addEventListener(
    'mouseover',
    (event) => {
      const target = event.target as HTMLElement | null;
      const span = target?.closest<HTMLElement>(`.${HIGHLIGHT_CLASS}`) ?? null;
      if (!span) return;

      pointerX = event.clientX;
      pointerY = event.clientY;
      if (span === activeSpan) return;

      activeSpan = span;
      window.clearTimeout(hoverTimeout);
      hoverTimeout = window.setTimeout(() => {
        const context = readContext(span);
        popup.showLoading(anchorRectFor(span), context);
        void fetchAndRenderQuote(context);

        // If the expanded panel is already open, hovering a different company
        // updates it in place without requiring another "View Chart" click.
        if (panel.isOpen()) {
          void openOrUpdatePanel(context);
        }
      }, HOVER_DELAY_MS);
    },
    true
  );

  document.addEventListener(
    'mouseout',
    (event) => {
      const target = event.target as HTMLElement | null;
      const span = target?.closest<HTMLElement>(`.${HIGHLIGHT_CLASS}`) ?? null;
      if (!span) return;

      const related = event.relatedTarget as Node | null;
      if (related && span.contains(related)) return;

      // A detached span means the page re-rendered the text out from under the
      // cursor, not that the pointer actually left it. Cancelling here is what
      // made hover look dead on homepages whose widgets refresh on a timer:
      // every refresh killed the pending hover before it could fire.
      if (!span.isConnected) return;

      window.clearTimeout(hoverTimeout);
      activeSpan = null;
      popup.scheduleHide();
    },
    true
  );

  // Scanning runs last, and guarded. It walks every text node on the page
  // against the whole dictionary, so on a large, widget-heavy homepage it is
  // by far the most likely step to throw -- and when it ran first, a failure
  // part-way through left the page covered in highlights that had no hover
  // handlers attached yet, which looks exactly like a broken extension.
  try {
    scanRoot(document.body);
    observeMutations();
  } catch (err) {
    console.error('[growz-ai] page scan failed:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
