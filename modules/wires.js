/**
 * Server-side Wire Sequencer Module
 */
export const wiresModule = {
  id: 'wires',
  title: 'فیوزهای چهارگانه',

  create(rng, ctx) {
    const availableColors = ['red', 'blue', 'yellow', 'green'];
    const wires = [];
    for (let i = 0; i < 4; i++) {
      wires.push(availableColors[Math.floor(rng() * availableColors.length)]);
    }

    const redCount = wires.filter((c) => c === 'red').length;
    const blueCount = wires.filter((c) => c === 'blue').length;
    let correctWireIndex = 3;

    if (redCount > 1) {
      correctWireIndex = 1;
    } else if (wires[3] === 'yellow') {
      correctWireIndex = 0;
    } else if (blueCount === 1) {
      correctWireIndex = 2;
    } else {
      correctWireIndex = 3;
    }

    return {
      id: 'wires',
      wires,
      correctWireIndex,
      cutWires: [],
      solved: false
    };
  },

  filterForRole(role, state) {
    if (!state) return null;
    // NEVER leak correctWireIndex
    if (role === 'blind') {
      return {
        id: 'wires',
        count: state.wires.length,
        cutWires: state.cutWires,
        solved: state.solved
      };
    }
    if (role === 'deaf') {
      return {
        id: 'wires',
        wires: state.wires,
        cutWires: state.cutWires,
        solved: state.solved
      };
    }
    // mute
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
