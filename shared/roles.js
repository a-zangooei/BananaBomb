/**
 * Isomorphic Role Identifiers, Normalizers & Player-Facing Role Metadata.
 *
 * Internal wire/storage slot keys ('blind', 'deaf', 'mute') map 1-to-1 to canonical
 * functional roles ('operator', 'observer', 'manual') for backward compatibility
 * across WebSocket messages, session storage, and integration test suites.
 */

export const ROLES = Object.freeze(['blind', 'deaf', 'mute']);

export const ALL_ROLES = Object.freeze([
  'blind',
  'deaf',
  'mute',
  'operator',
  'observer',
  'manual'
]);

export function isOperatorRole(role) {
  return role === 'operator' || role === 'blind';
}

export function isObserverRole(role) {
  return role === 'observer' || role === 'deaf';
}

export function isManualRole(role) {
  return role === 'manual' || role === 'mute';
}

// Short aliases used across UI and gameplay modules
export const isOperator = isOperatorRole;
export const isObserver = isObserverRole;
export const isManual = isManualRole;

/**
 * Normalizes any legacy or functional role identifier to its wire/storage slot key
 * ('blind' | 'deaf' | 'mute'). Returns the input unchanged if unrecognized.
 */
export function canonicalRole(role) {
  if (isOperatorRole(role)) return 'blind';
  if (isObserverRole(role)) return 'deaf';
  if (isManualRole(role)) return 'mute';
  return role;
}

/**
 * Normalizes any legacy or functional role identifier to its canonical functional key
 * ('operator' | 'observer' | 'manual'), defaulting to 'operator' when unassigned.
 */
export function toFunctionalRoleKey(role) {
  if (isObserverRole(role)) return 'observer';
  if (isManualRole(role)) return 'manual';
  return 'operator';
}

const OPERATOR_META = Object.freeze({
  title: 'اپراتور (Operator)',
  subtitle:
    'تنها بازیکن مجاز به لمس بمب ۳D؛ بدون کلام، دارای محدودیت دید توافقی (عینک آفتابی)، بدون دید به دفترچه راهنما؛ پخش صدای بازی از گوشی اپراتور'
});

const OBSERVER_META = Object.freeze({
  title: 'ناظر (Observer)',
  subtitle:
    'تنها گوینده تیم و پل ارتباطی؛ مشاهده رنگ‌ها، نمادها و پلاک سریال؛ صحبت با اپراتور و اشاره با دفترچه راهنما؛ دارای هدفون (بدون استفاده از صدای بازی) و بدون لمس بمب'
});

const MANUAL_META = Object.freeze({
  title: 'دفترچه راهنما (Manual-holder)',
  subtitle:
    'دارنده دفترچه قوانین راند جاری؛ بدون کلام، بدون دید به صفحه اپراتور و بدون لمس بمب؛ ارتباط فقط با ناظر از طریق اشاره‌های توافقی'
});

export const roleMeta = Object.freeze({
  operator: OPERATOR_META,
  observer: OBSERVER_META,
  manual: MANUAL_META,
  blind: OPERATOR_META,
  deaf: OBSERVER_META,
  mute: MANUAL_META
});
