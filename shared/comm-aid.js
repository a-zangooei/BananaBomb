/**
 * Isomorphic Easy-Mode 3-Symbol Communication Aid Catalog & State Factory.
 *
 * Strictly restricted to the Observer <-> Manual-holder bridge (never delivered to Operator).
 */

export const COMM_AID_SYMBOLS = Object.freeze({
  confirm: Object.freeze({ id: 'confirm', symbol: '✓', label: 'تأیید' }),
  reject: Object.freeze({ id: 'reject', symbol: '✕', label: 'رد' }),
  urgent: Object.freeze({ id: 'urgent', symbol: '⏱', label: 'زمان / فوری' })
});

export function createCommAidState(difficulty) {
  const budget = difficulty?.features?.commAidEnabled ? (difficulty?.features?.commAidBudget || 0) : 0;
  return {
    enabled: Boolean(difficulty?.features?.commAidEnabled && budget > 0),
    totalBudget: budget,
    remainingUses: budget,
    seq: 0,
    lastSignal: null
  };
}
