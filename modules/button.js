import { BUTTON_RULES } from './rules-config.js';
import { isOperatorRole, isObserverRole } from '../shared/roles.js';
import { isPlainObject } from '../shared/utils.js';

/**
 * Server-side Reactor Button Module
 */
export const buttonModule = {
  id: 'button',
  title: 'دکمه کاتالیزور',

  create(rng, ctx) {
    const schema = ctx?.roundRules?.buttonSchema || BUTTON_RULES.defaultSchema;
    const color = BUTTON_RULES.colors[Math.floor(rng() * BUTTON_RULES.colors.length)];
    const holdStripColor = BUTTON_RULES.stripColors[Math.floor(rng() * BUTTON_RULES.stripColors.length)];
    const label = 'کاتالیزور';

    const { actionType, targetReleaseDigit } = schema.evaluate(
      color,
      holdStripColor,
      ctx?.isSerialEven
    );

    return {
      id: 'button',
      color,
      label,
      holdStripColor,
      actionType,
      targetReleaseDigit,
      solved: false
    };
  },

  filterForRole(role, state) {
    if (!state) return null;

    // NEVER leak actionType or targetReleaseDigit
    if (isOperatorRole(role)) {
      return {
        id: 'button',
        solved: state.solved,
        label: 'دکمه',
        color: 'monochrome',
        holdStripColor: state.solved ? null : 'monochrome'
      };
    }
    if (isObserverRole(role)) {
      return {
        id: 'button',
        solved: state.solved,
        label: state.label,
        color: state.color,
        holdStripColor: state.holdStripColor
      };
    }
    // Manual-holder (mute)
    return {
      id: 'button',
      solved: state.solved
    };
  },

  validateAction(action, rawData) {
    if (action === 'press') {
      return { ok: true, sanitizedData: {}, targetKey: 'plunger_press' };
    }
    if (action === 'release') {
      if (
        !isPlainObject(rawData) ||
        !Number.isInteger(rawData.releaseDigit) ||
        rawData.releaseDigit < 0 ||
        rawData.releaseDigit > 9
      ) {
        return {
          ok: false,
          message: 'پارامتر رقم رهاسازی دکمه نامعتبر است (باید عدد صحیح ۰ تا ۹ باشد).'
        };
      }
      return {
        ok: true,
        sanitizedData: { releaseDigit: rawData.releaseDigit },
        targetKey: 'plunger_release'
      };
    }
    return { ok: false, message: 'نوع عملیات دکمه نامعتبر است.' };
  },

  handleAction(state, action, data, ctx) {
    if (state.solved) return { solved: true, strike: false };

    if (action === 'press') {
      if (state.actionType === 'press') {
        state.solved = true;
        return { solved: true, strike: false, reason: 'دکمه کاتالیزور با موفقیت فشرده شد!' };
      }
      return { solved: false, strike: true, reason: 'فشار ناگهانی روی دکمه در حالتی که نیاز به نگه‌داشتن بود!' };
    }

    if (action === 'release') {
      const rawDigit = data?.releaseDigit !== undefined ? data.releaseDigit : ctx?.lastDigit;
      const releaseDigit = parseInt(rawDigit, 10);
      if (state.actionType === 'hold') {
        if (!isNaN(releaseDigit) && releaseDigit === state.targetReleaseDigit) {
          state.solved = true;
          return {
            solved: true,
            strike: false,
            reason: `دکمه در ثانیه با رقم ${state.targetReleaseDigit} با موفقیت رها شد!`
          };
        }
        return { solved: false, strike: true, reason: 'رهاسازی دکمه در ثانیه‌ی اشتباه!' };
      }
      return { solved: false, strike: true, reason: 'نگه‌داشتن دکمه در حالتی که نیاز به فشردن سریع بود!' };
    }

    return { solved: false, strike: false };
  },

  isSolved(state) {
    return !!state?.solved;
  }
};
