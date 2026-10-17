/**
 * Server-side Cipher Keypad Module
 */
const SYMBOL_POOL = ['⚡', '★', 'Ω', 'Ψ', '▲', '◆', '✦', '⚙'];

export const keypadModule = {
  id: 'keypad',
  title: 'نمادهای رمزی',

  create(rng, ctx) {
    const shuffledSymbols = [...SYMBOL_POOL].sort(() => rng() - 0.5).slice(0, 4);
    const correctOrder = [...shuffledSymbols].sort(
      (a, b) => SYMBOL_POOL.indexOf(a) - SYMBOL_POOL.indexOf(b)
    );

    return {
      id: 'keypad',
      symbols: shuffledSymbols,
      correctOrder,
      enteredOrder: [],
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
        solved: state.solved
      };
    }
    if (role === 'deaf') {
      return {
        id: 'keypad',
        symbols: state.symbols,
        enteredCount: state.enteredOrder.length,
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
      if (isNaN(slotIndex) || slotIndex < 0 || slotIndex >= state.symbols.length) {
        return { solved: false, strike: false };
      }

      const symbolPressed = state.symbols[slotIndex];
      const expectedNext = state.correctOrder[state.enteredOrder.length];

      if (symbolPressed === expectedNext) {
        state.enteredOrder.push(symbolPressed);
        if (state.enteredOrder.length === state.correctOrder.length) {
          state.solved = true;
          return { solved: true, strike: false, reason: 'کد امنیتی نمادها با موفقیت تکمیل شد!' };
        }
        return { solved: false, strike: false };
      }

      state.enteredOrder = [];
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
