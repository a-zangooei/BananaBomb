/**
 * Authoritative Single Source of Truth for BOMBANANA / BananaBomb Module Rules
 * Defines constants, clue generation pools, and deterministic solution evaluators.
 */

export const BUTTON_RULES = {
  colors: ['white', 'red', 'blue', 'yellow'],
  stripColors: ['blue', 'yellow', 'white', 'red'],
  stripDigitMap: {
    blue: 4,
    yellow: 5,
    white: 1,
    red: 7
  },
  tapHoldThresholdMs: 350,

  /**
   * Evaluates the button rule:
   * 1. White button -> Press immediately (Tap).
   * 2. Red button with odd serial digit -> Press immediately (Tap).
   * 3. All other button colors -> Hold button and release on strip color's target digit.
   */
  evaluate(color, holdStripColor, isSerialEven) {
    if (color === 'white') {
      return {
        actionType: 'press',
        targetReleaseDigit: null
      };
    }
    if (color === 'red' && !isSerialEven) {
      return {
        actionType: 'press',
        targetReleaseDigit: null
      };
    }
    const targetReleaseDigit = BUTTON_RULES.stripDigitMap[holdStripColor] ?? 1;
    return {
      actionType: 'hold',
      targetReleaseDigit
    };
  }
};

export const WIRES_RULES = {
  colors: ['red', 'blue', 'yellow', 'green'],

  /**
   * Evaluates wire cutting rule deterministically:
   * Rule 1: If red wires > 1 -> Cut wire #2 (index 1).
   * Rule 2: Else if 4th wire is yellow -> Cut wire #1 (index 0).
   * Rule 3: Else if exactly 1 blue wire -> Cut wire #3 (index 2).
   * Rule 4: Otherwise -> Cut wire #4 (index 3).
   */
  evaluate(wires) {
    const redCount = wires.filter((c) => c === 'red').length;
    const blueCount = wires.filter((c) => c === 'blue').length;

    if (redCount > 1) {
      return 1; // 2nd wire
    }
    if (wires[3] === 'yellow') {
      return 0; // 1st wire
    }
    if (blueCount === 1) {
      return 2; // 3rd wire
    }
    return 3; // 4th wire
  }
};

export const KEYPAD_RULES = {
  symbolPool: ['⚡', '★', 'Ω', 'Ψ', '▲', '◆', '✦', '⚙'],

  /**
   * Sorts any subset of symbols according to canonical symbolPool priority order.
   */
  evaluate(symbols) {
    return [...symbols].sort(
      (a, b) => KEYPAD_RULES.symbolPool.indexOf(a) - KEYPAD_RULES.symbolPool.indexOf(b)
    );
  }
};
