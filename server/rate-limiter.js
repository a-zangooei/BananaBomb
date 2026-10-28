/**
 * Action Deduplication & Two-Tier Operator Action Rate Limiter.
 *
 * Tier 1: Per-target bounce cooldown (`cooldownMs`) blocks accidental rapid identical repeats.
 * Tier 2: Token-bucket flood guard (burst 6, refills 1 token per `refillStepMs`) blocks abusive
 *         floods without suppressing legitimate rapid interactions across distinct controls.
 */

const MAX_PROCESSED_ACTION_IDS = 500;
const MAX_BURST_TOKENS = 6;

/**
 * Checks if `actionId` has already been processed in the current round; if fresh,
 * records it in `gameState.processedActionIds` with bounded ring eviction.
 * Returns `true` if duplicate, `false` if fresh or empty.
 */
export function isDuplicateAndRecordActionId(gameState, rawActionId) {
  const actionId = typeof rawActionId === 'string' ? rawActionId.trim() : '';
  if (!actionId) return false;

  if (gameState.processedActionIds && gameState.processedActionIds.has(actionId)) {
    return true;
  }
  if (!gameState.processedActionIds) {
    gameState.processedActionIds = new Set();
  }
  gameState.processedActionIds.add(actionId);
  if (gameState.processedActionIds.size > MAX_PROCESSED_ACTION_IDS) {
    const oldest = gameState.processedActionIds.values().next().value;
    gameState.processedActionIds.delete(oldest);
  }
  return false;
}

/**
 * Evaluates per-session bounce cooldown and token-bucket rate limits for an Operator action.
 * Returns `{ allowed: true }` or `{ allowed: false, message }`.
 */
export function evaluateActionRateLimit(session, actionSig, interactionGraceMs = 70, now = Date.now()) {
  const cooldownMs = interactionGraceMs || 70;
  const refillStepMs = Math.max(45, cooldownMs);

  if (!session.actionRateState) {
    session.actionRateState = {
      tokens: MAX_BURST_TOKENS,
      lastRefill: now,
      sigLastTime: new Map()
    };
  }

  const rateState = session.actionRateState;
  const elapsedSinceRefill = Math.max(0, now - rateState.lastRefill);
  if (elapsedSinceRefill > 0) {
    rateState.tokens = Math.min(
      MAX_BURST_TOKENS,
      rateState.tokens + elapsedSinceRefill / refillStepMs
    );
    rateState.lastRefill = now;
  }

  const prevSigTime = rateState.sigLastTime.get(actionSig) || 0;
  if (now - prevSigTime < cooldownMs) {
    return {
      allowed: false,
      message: 'تکرار بسیار سریع همان فرمان مهار شد.'
    };
  }

  if (rateState.tokens < 1) {
    return {
      allowed: false,
      message: 'تعداد فرمان‌های ارسالی بیش از حد مجاز است؛ لطفاً کمی مکث کنید.'
    };
  }

  rateState.tokens -= 1;
  rateState.sigLastTime.set(actionSig, now);
  return { allowed: true };
}
