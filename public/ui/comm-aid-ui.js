/**
 * Easy-Mode 3-Symbol Communication Aid UI Controller (Observer <-> Manual-holder bridge only).
 */
import { isObserver, isManual } from '../../shared/roles.js';

function flashCommAidWidget(widgetEl) {
  if (!widgetEl) return;
  widgetEl.classList.add('comm-flash');
  setTimeout(() => {
    widgetEl.classList.remove('comm-flash');
  }, 900);
}

export function createCommAidController({ elements, getMyRole, getPlayerId, sendSignal }) {
  const {
    observerCommAidWidget,
    observerCommAidBudget,
    observerCommAidFeedback,
    manualCommAidWidget,
    manualCommAidBudget,
    manualCommAidFeedback,
    symbolButtons = []
  } = elements;

  function dispatchSymbol(symbolId) {
    if (!symbolId) return;
    const pid = getPlayerId?.() || 'p';
    const actionId = `${pid}-comm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    sendSignal?.({ symbolId, actionId });
  }

  symbolButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const symbolId = btn.getAttribute('data-comm-symbol');
      dispatchSymbol(symbolId);
    });
  });

  function flashForCurrentRole() {
    const role = getMyRole?.();
    if (isObserver(role)) flashCommAidWidget(observerCommAidWidget);
    if (isManual(role)) flashCommAidWidget(manualCommAidWidget);
  }

  function renderCommAidWidgets(state) {
    const role = getMyRole?.();
    const commAid = state?.commAid;
    const isRunning = state?.status === 'running';
    const showForObserver = isRunning && isObserver(role) && Boolean(commAid?.enabled);
    const showForManual = isRunning && isManual(role) && Boolean(commAid?.enabled);

    if (observerCommAidWidget) {
      observerCommAidWidget.style.display = showForObserver ? 'flex' : 'none';
    }
    if (manualCommAidWidget) {
      manualCommAidWidget.style.display = showForManual ? 'flex' : 'none';
    }

    if (!commAid || (!showForObserver && !showForManual)) return;

    const remaining = commAid.remainingUses ?? 0;
    const total = commAid.totalBudget ?? 0;
    const budgetStr = `${remaining} / ${total}`;
    const isExhausted = remaining <= 0;

    let feedbackText = isExhausted
      ? 'سهمیه کمک‌ارتباطی تمام شد؛ با اشاره‌های توافقی ادامه دهید.'
      : 'ارسال فقط در پل ناظر ↔ دفترچه راهنما · هر ارسال ۱ سهمیه';

    if (commAid.lastSignal) {
      const sig = commAid.lastSignal;
      feedbackText = `آخرین پیام (${sig.senderTitle}): «${sig.symbol} ${sig.label}» · باقی‌مانده: ${remaining} از ${total}`;
    }

    [
      { widget: observerCommAidWidget, budgetEl: observerCommAidBudget, fbEl: observerCommAidFeedback },
      { widget: manualCommAidWidget, budgetEl: manualCommAidBudget, fbEl: manualCommAidFeedback }
    ].forEach(({ widget, budgetEl, fbEl }) => {
      if (!widget) return;
      if (budgetEl) {
        budgetEl.textContent = budgetStr;
        budgetEl.classList.toggle('exhausted', isExhausted);
      }
      if (fbEl) {
        fbEl.textContent = feedbackText;
      }
      widget.querySelectorAll('[data-comm-symbol]').forEach((btn) => {
        btn.disabled = isExhausted;
      });
    });
  }

  return {
    renderCommAidWidgets,
    flashForCurrentRole
  };
}
