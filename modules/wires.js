import { WIRES_RULES } from './rules-config.js';

/**
 * Server-side Wire Sequencer Module
 */
export const wiresModule = {
  id: 'wires',
  title: 'فیوزهای چهارگانه',

  create(rng, ctx) {
    const schema = ctx?.roundRules?.wiresSchema || WIRES_RULES.defaultSchema;
    const wires = [];
    for (let i = 0; i < 4; i++) {
      wires.push(WIRES_RULES.colors[Math.floor(rng() * WIRES_RULES.colors.length)]);
    }

    const correctWireIndex = schema.evaluate(wires);

    return {
      id: 'wires',
      wires,
      correctWireIndex,
      cutWires: [],
      solved: false
    };
  },

  filterForRole(role, state, ctx = null) {
    if (!state) return null;
    const isOperator = role === 'operator' || role === 'blind';
    const isObserver = role === 'observer' || role === 'deaf';

    // NEVER leak correctWireIndex
    if (isOperator) {
      return {
        id: 'wires',
        count: state.wires.length,
        cutWires: state.cutWires,
        solved: state.solved
      };
    }
    if (isObserver) {
      return {
        id: 'wires',
        wires: state.wires,
        colors: state.wires,
        cutWires: state.cutWires,
        solved: state.solved,
        wireIndexLabels: Boolean(ctx?.difficulty?.features?.wireIndexLabels)
      };
    }
    // Manual-holder (mute)
    return {
      id: 'wires',
      solved: state.solved
    };
  },

  handleAction(state, action, data, ctx) {
    if (state.solved) return { solved: true, strike: false };

    if (action === 'cut') {
      const wireIndex = parseInt(data?.wireIndex, 10);
      if (
        isNaN(wireIndex) ||
        wireIndex < 0 ||
        wireIndex >= state.wires.length ||
        state.cutWires.includes(wireIndex)
      ) {
        return { solved: false, strike: false };
      }

      state.cutWires.push(wireIndex);

      if (wireIndex === state.correctWireIndex) {
        state.solved = true;
        return { solved: true, strike: false, reason: 'سیم صحیح قطع شد و مدار خنثی گشت!' };
      }

      return {
        solved: false,
        strike: true,
        reason: `سیم نادرست شماره ${wireIndex + 1} قطع شد! مدار بار اضافی دریافت کرد.`
      };
    }

    return { solved: false, strike: false };
  },

  isSolved(state) {
    return !!state?.solved;
  }
};
