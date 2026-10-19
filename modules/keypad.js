/**
 * Server-side Cipher Keypad Module
 */
import { fisherYatesShuffle } from './utils.js';
import { KEYPAD_RULES } from './rules-config.js';

export const keypadModule = {
  id: 'keypad',
  title: 'نمادهای رمزی',

  create(rng, ctx) {
    // Unbiased Fisher-Yates shuffle of the symbol pool
    const shuffledPool = fisherYatesShuffle(KEYPAD_RULES.symbolPool, rng);
    const shuffledSymbols = shuffledPool.slice(0, 4);
    const correctOrder = KEYPAD_RULES.evaluate(shuffledSymbols);

    return {
      id: 'keypad',
      symbols: shuffledSymbols,
      correctOrder,
      enteredOrder: [],
      enteredSlots: [],
      solved: false
    };
  },

  filterForRole(role, state) {
    if (!state) return null;
    // NEVER leak correctOrder
    if (role === 'blind') {
      return {
        id: 'keypad',
        slotCount: state.symbols.length,
        enteredCount: state.enteredOrder.length,
        enteredSlots: state.enteredSlots || [],
        solved: state.solved
      };
    }
    if (role === 'deaf') {
      return {
        id: 'keypad',
        symbols: state.symbols,
        enteredCount: state.enteredOrder.length,
        enteredSlots: state.enteredSlots || [],
        solved: state.solved
      };
    }
    // mute
    return {
      id: 'keypad',
      solved: state.solved
    };
  },

  handleAction(state, action, data, ctx) {
    if (state.solved) return { solved: true, strike: false };

    if (action === 'press') {
      const slotIndex = parseInt(data?.slotIndex, 10);
      if (
        isNaN(slotIndex) ||
        slotIndex < 0 ||
        slotIndex >= state.symbols.length ||
        state.enteredSlots?.includes(slotIndex)
      ) {
        return { solved: false, strike: false };
      }

      const symbolPressed = state.symbols[slotIndex];
      const expectedNext = state.correctOrder[state.enteredOrder.length];

      if (symbolPressed === expectedNext) {
        state.enteredOrder.push(symbolPressed);
        state.enteredSlots.push(slotIndex);
        if (state.enteredOrder.length === state.correctOrder.length) {
          state.solved = true;
          return { solved: true, strike: false, reason: 'کد امنیتی نمادها با موفقیت تکمیل شد!' };
        }
        return { solved: false, strike: false };
      }

      state.enteredOrder = [];
      state.enteredSlots = [];
      return {
        solved: false,
        strike: true,
        reason: 'ترتیب نماد نادرست وارد شد! کلید رمزنگاری ریست شد.'
      };
    }

    return { solved: false, strike: false };
  },

  isSolved(state) {
    return !!state?.solved;
  }
};
