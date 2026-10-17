process.env.NODE_ENV = 'test';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { buttonModule } from '../modules/button.js';
import { wiresModule } from '../modules/wires.js';
import { keypadModule } from '../modules/keypad.js';
import { fisherYatesShuffle } from '../modules/utils.js';

// Deterministic PRNG for reproducible tests
function createLcgRng(seed = 123456789) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('Gameplay Rules Verification & Module Correctness', () => {

  describe('1. Button Module Rules & Logic', () => {
    test('Rule Branch 1: White button requires quick press in all conditions', () => {
      // Mock RNG that picks 'white'
      const rng = () => 0.99; // buttonColors: ['red', 'blue', 'yellow', 'white'][3] = white
      const ctx = { serialNumber: 'A1-22-B2', isSerialEven: true };
      const state = buttonModule.create(rng, ctx);

      assert.equal(state.color, 'white');
      assert.equal(state.actionType, 'press');
      assert.equal(state.targetReleaseDigit, null);

      // Correct action: press
      const pressResult = buttonModule.handleAction(state, 'press', {}, ctx);
      assert.equal(pressResult.solved, true);
      assert.equal(pressResult.strike, false);
      assert.equal(buttonModule.isSolved(state), true);

      // Reset state and test incorrect action: release
      state.solved = false;
      const releaseResult = buttonModule.handleAction(state, 'release', { releaseDigit: 1 }, ctx);
      assert.equal(releaseResult.solved, false);
      assert.equal(releaseResult.strike, true);
    });

    test('Rule Branch 2: Red button with odd serial requires quick press', () => {
      const rng = () => 0.05; // picks 'red'
      const ctx = { serialNumber: 'A1-22-B3', isSerialEven: false };
      const state = buttonModule.create(rng, ctx);

      assert.equal(state.color, 'red');
      assert.equal(state.actionType, 'press');
      assert.equal(state.targetReleaseDigit, null);

      const pressResult = buttonModule.handleAction(state, 'press', {}, ctx);
      assert.equal(pressResult.solved, true);
      assert.equal(pressResult.strike, false);
    });

    test('Rule Branch 3: Red button with even serial requires hold and release on 1', () => {
      const rng = () => 0.05; // picks 'red'
      const ctx = { serialNumber: 'A1-22-B4', isSerialEven: true };
      const state = buttonModule.create(rng, ctx);

      assert.equal(state.color, 'red');
      assert.equal(state.actionType, 'hold');
      assert.equal(state.targetReleaseDigit, 1);

      // Pressing instead of holding produces strike
      const pressResult = buttonModule.handleAction(state, 'press', {}, ctx);
      assert.equal(pressResult.solved, false);
      assert.equal(pressResult.strike, true);

      // Releasing at wrong digit produces strike
      const wrongRelease = buttonModule.handleAction(state, 'release', { releaseDigit: 4 }, ctx);
      assert.equal(wrongRelease.solved, false);
      assert.equal(wrongRelease.strike, true);

      // Releasing at target digit 1 defuses button
      const correctRelease = buttonModule.handleAction(state, 'release', { releaseDigit: 1 }, ctx);
      assert.equal(correctRelease.solved, true);
      assert.equal(correctRelease.strike, false);
    });

    test('Rule Branch 4: Blue button requires hold and release on 4', () => {
      const rng = () => 0.35; // picks 'blue'
      const ctx = { serialNumber: 'A1-22-B1', isSerialEven: false };
      const state = buttonModule.create(rng, ctx);

      assert.equal(state.color, 'blue');
      assert.equal(state.actionType, 'hold');
      assert.equal(state.targetReleaseDigit, 4);

      // Release at 4 succeeds
      const res = buttonModule.handleAction(state, 'release', { releaseDigit: 4 }, ctx);
      assert.equal(res.solved, true);
      assert.equal(res.strike, false);
    });

    test('Rule Branch 5: Yellow button requires hold and release on 7', () => {
      const rng = () => 0.65; // picks 'yellow'
      const ctx = { serialNumber: 'A1-22-B8', isSerialEven: true };
      const state = buttonModule.create(rng, ctx);

      assert.equal(state.color, 'yellow');
      assert.equal(state.actionType, 'hold');
      assert.equal(state.targetReleaseDigit, 7);

      // Release at 7 succeeds
      const res = buttonModule.handleAction(state, 'release', { releaseDigit: 7 }, ctx);
      assert.equal(res.solved, true);
      assert.equal(res.strike, false);
    });

    test('Button: Text labels and holdStripColor are decorative and do not alter rules', () => {
      const lcg = createLcgRng(42);
      for (let i = 0; i < 50; i++) {
        const stateEven = buttonModule.create(lcg, { serialNumber: 'A0-00-B2', isSerialEven: true });
        const stateOdd = buttonModule.create(lcg, { serialNumber: 'A0-00-B3', isSerialEven: false });

        // Verify rule mapping is strictly dependent on color and isSerialEven:
        if (stateEven.color === 'white') assert.equal(stateEven.actionType, 'press');
        if (stateEven.color === 'blue') assert.equal(stateEven.targetReleaseDigit, 4);
        if (stateEven.color === 'yellow') assert.equal(stateEven.targetReleaseDigit, 7);
        if (stateEven.color === 'red') assert.equal(stateEven.targetReleaseDigit, 1);

        if (stateOdd.color === 'white') assert.equal(stateOdd.actionType, 'press');
        if (stateOdd.color === 'red') assert.equal(stateOdd.actionType, 'press');
      }
    });

    test('Button: Malformed inputs and already solved states handled cleanly', () => {
      const state = {
        id: 'button',
        color: 'blue',
        actionType: 'hold',
        targetReleaseDigit: 4,
        solved: false
      };

      // Invalid action type
      const invalidAction = buttonModule.handleAction(state, 'cut', {}, {});
      assert.equal(invalidAction.solved, false);
      assert.equal(invalidAction.strike, false);

      // Release with NaN releaseDigit
      const nanRelease = buttonModule.handleAction(state, 'release', { releaseDigit: 'abc' }, {});
      assert.equal(nanRelease.solved, false);
      assert.equal(nanRelease.strike, true);

      // Once solved, subsequent actions return solved: true without strikes
      state.solved = true;
      const solvedAction = buttonModule.handleAction(state, 'press', {}, {});
      assert.equal(solvedAction.solved, true);
      assert.equal(solvedAction.strike, false);
    });

    test('Button: Role filtering protects hidden answers', () => {
      const state = {
        id: 'button',
        color: 'red',
        label: 'هشدار',
        holdStripColor: 'yellow',
        actionType: 'hold',
        targetReleaseDigit: 1,
        solved: false
      };

      const blindView = buttonModule.filterForRole('blind', state);
      assert.equal(blindView.actionType, undefined);
      assert.equal(blindView.targetReleaseDigit, undefined);
      assert.equal(blindView.color, 'monochrome');
      assert.equal(blindView.label, 'دکمه');

      const deafView = buttonModule.filterForRole('deaf', state);
      assert.equal(deafView.actionType, undefined);
      assert.equal(deafView.targetReleaseDigit, undefined);
      assert.equal(deafView.color, 'red');
      assert.equal(deafView.label, 'هشدار');

      const muteView = buttonModule.filterForRole('mute', state);
      assert.equal(muteView.actionType, undefined);
      assert.equal(muteView.targetReleaseDigit, undefined);
      assert.equal(muteView.color, undefined);
    });
  });

  describe('2. Wires Module Rules & Logic', () => {
    test('Rule Branch 1 (Priority 1): More than one red wire -> cut wire 2 (index 1)', () => {
      const state = {
        id: 'wires',
        wires: ['red', 'red', 'blue', 'yellow'], // Overlap: redCount > 1, last is yellow, 1 blue!
        correctWireIndex: 1,
        cutWires: [],
        solved: false
      };

      // Cut correct wire (index 1 / wire 2)
      const res = wiresModule.handleAction(state, 'cut', { wireIndex: 1 });
      assert.equal(res.solved, true);
      assert.equal(res.strike, false);
      assert.deepEqual(state.cutWires, [1]);
    });

    test('Rule Branch 2 (Priority 2): Last wire is yellow (redCount <= 1) -> cut wire 1 (index 0)', () => {
      const state = {
        id: 'wires',
        wires: ['green', 'blue', 'green', 'yellow'], // Overlap: last is yellow AND 1 blue
        correctWireIndex: 0,
        cutWires: [],
        solved: false
      };

      // Priority 2 requires cutting wire 1 (index 0)
      const res = wiresModule.handleAction(state, 'cut', { wireIndex: 0 });
      assert.equal(res.solved, true);
      assert.equal(res.strike, false);
      assert.deepEqual(state.cutWires, [0]);
    });

    test('Rule Branch 3 (Priority 3): Exactly one blue wire (not yellow last, redCount <= 1) -> cut wire 3 (index 2)', () => {
      const state = {
        id: 'wires',
        wires: ['red', 'blue', 'green', 'green'],
        correctWireIndex: 2,
        cutWires: [],
        solved: false
      };

      const res = wiresModule.handleAction(state, 'cut', { wireIndex: 2 });
      assert.equal(res.solved, true);
      assert.equal(res.strike, false);
      assert.deepEqual(state.cutWires, [2]);
    });

    test('Rule Branch 4 (Priority 4 / Otherwise): None of above -> cut wire 4 (index 3)', () => {
      const state = {
        id: 'wires',
        wires: ['green', 'green', 'green', 'green'],
        correctWireIndex: 3,
        cutWires: [],
        solved: false
      };

      const res = wiresModule.handleAction(state, 'cut', { wireIndex: 3 });
      assert.equal(res.solved, true);
      assert.equal(res.strike, false);
      assert.deepEqual(state.cutWires, [3]);
    });

    test('Wires: Wrong cuts, repeated cuts on cut wires, and bounds checks', () => {
      const state = {
        id: 'wires',
        wires: ['red', 'red', 'green', 'green'],
        correctWireIndex: 1,
        cutWires: [],
        solved: false
      };

      // Cut wrong wire (index 0)
      const wrongCut = wiresModule.handleAction(state, 'cut', { wireIndex: 0 });
      assert.equal(wrongCut.solved, false);
      assert.equal(wrongCut.strike, true);
      assert.deepEqual(state.cutWires, [0]);

      // Attempting to cut the already-cut wire 0 must NOT register another strike
      const reCut = wiresModule.handleAction(state, 'cut', { wireIndex: 0 });
      assert.equal(reCut.solved, false);
      assert.equal(reCut.strike, false);
      assert.deepEqual(state.cutWires, [0]);

      // Out of bounds wireIndex ignored
      const outOfBounds1 = wiresModule.handleAction(state, 'cut', { wireIndex: -1 });
      assert.equal(outOfBounds1.strike, false);
      const outOfBounds2 = wiresModule.handleAction(state, 'cut', { wireIndex: 99 });
      assert.equal(outOfBounds2.strike, false);

      // Now cut the correct wire 1
      const correctCut = wiresModule.handleAction(state, 'cut', { wireIndex: 1 });
      assert.equal(correctCut.solved, true);
      assert.equal(correctCut.strike, false);
      assert.deepEqual(state.cutWires, [0, 1]);

      // Once solved, future cuts do not strike
      const postSolved = wiresModule.handleAction(state, 'cut', { wireIndex: 2 });
      assert.equal(postSolved.solved, true);
      assert.equal(postSolved.strike, false);
    });

    test('Wires: Role filtering conceals correct answer', () => {
      const state = {
        id: 'wires',
        wires: ['red', 'blue', 'green', 'yellow'],
        correctWireIndex: 0,
        cutWires: [1],
        solved: false
      };

      const blindView = wiresModule.filterForRole('blind', state);
      assert.equal(blindView.correctWireIndex, undefined);
      assert.equal(blindView.wires, undefined);
      assert.equal(blindView.count, 4);
      assert.deepEqual(blindView.cutWires, [1]);

      const deafView = wiresModule.filterForRole('deaf', state);
      assert.equal(deafView.correctWireIndex, undefined);
      assert.deepEqual(deafView.wires, ['red', 'blue', 'green', 'yellow']);

      const muteView = wiresModule.filterForRole('mute', state);
      assert.equal(muteView.correctWireIndex, undefined);
      assert.equal(muteView.wires, undefined);
    });
  });

  describe('3. Keypad Module Rules & Logic', () => {
    test('Keypad: Generates 4 unique symbols and correct order matches manual canonical priority', () => {
      const SYMBOL_PRIORITY = ['⚡', '★', 'Ω', 'Ψ', '▲', '◆', '✦', '⚙'];
      const lcg = createLcgRng(999);

      for (let i = 0; i < 50; i++) {
        const state = keypadModule.create(lcg, {});
        assert.equal(state.symbols.length, 4);
        assert.equal(new Set(state.symbols).size, 4, 'All 4 symbols must be unique');

        // Check correctOrder is sorted strictly by SYMBOL_PRIORITY
        assert.equal(state.correctOrder.length, 4);
        for (let j = 0; j < 3; j++) {
          const idxA = SYMBOL_PRIORITY.indexOf(state.correctOrder[j]);
          const idxB = SYMBOL_PRIORITY.indexOf(state.correctOrder[j + 1]);
          assert.ok(idxA < idxB, `Symbols must be sorted by priority: ${state.correctOrder[j]} before ${state.correctOrder[j+1]}`);
        }
      }
    });

    test('Keypad: Full solving flow in correct sequence', () => {
      const state = {
        id: 'keypad',
        symbols: ['Ψ', '⚡', '⚙', '★'], // slots: 0=Ψ, 1=⚡, 2=⚙, 3=★
        // Canonical order: ⚡ (slot 1), ★ (slot 3), Ψ (slot 0), ⚙ (slot 2)
        correctOrder: ['⚡', '★', 'Ψ', '⚙'],
        enteredOrder: [],
        enteredSlots: [],
        solved: false
      };

      // Step 1: Press slot 1 (⚡)
      const step1 = keypadModule.handleAction(state, 'press', { slotIndex: 1 });
      assert.equal(step1.solved, false);
      assert.equal(step1.strike, false);
      assert.deepEqual(state.enteredSlots, [1]);
      assert.deepEqual(state.enteredOrder, ['⚡']);

      // Step 2: Press slot 3 (★)
      const step2 = keypadModule.handleAction(state, 'press', { slotIndex: 3 });
      assert.equal(step2.solved, false);
      assert.equal(step2.strike, false);
      assert.deepEqual(state.enteredSlots, [1, 3]);

      // Step 3: Press slot 0 (Ψ) -- verifies slot index less than earlier slots works!
      const step3 = keypadModule.handleAction(state, 'press', { slotIndex: 0 });
      assert.equal(step3.solved, false);
      assert.equal(step3.strike, false);
      assert.deepEqual(state.enteredSlots, [1, 3, 0]);

      // Step 4: Press slot 2 (⚙) -> completes puzzle
      const step4 = keypadModule.handleAction(state, 'press', { slotIndex: 2 });
      assert.equal(step4.solved, true);
      assert.equal(step4.strike, false);
      assert.deepEqual(state.enteredSlots, [1, 3, 0, 2]);
      assert.equal(keypadModule.isSolved(state), true);
    });

    test('Keypad: Wrong symbol causes strike and resets enteredOrder and enteredSlots', () => {
      const state = {
        id: 'keypad',
        symbols: ['⚡', '★', 'Ω', 'Ψ'],
        correctOrder: ['⚡', '★', 'Ω', 'Ψ'],
        enteredOrder: [],
        enteredSlots: [],
        solved: false
      };

      // Correct first press: slot 0 (⚡)
      keypadModule.handleAction(state, 'press', { slotIndex: 0 });
      assert.deepEqual(state.enteredSlots, [0]);

      // Incorrect second press: slot 3 (Ψ) instead of slot 1 (★)
      const wrong = keypadModule.handleAction(state, 'press', { slotIndex: 3 });
      assert.equal(wrong.solved, false);
      assert.equal(wrong.strike, true);
      assert.deepEqual(state.enteredSlots, [], 'enteredSlots must reset on strike');
      assert.deepEqual(state.enteredOrder, [], 'enteredOrder must reset on strike');
    });

    test('Keypad: Re-pressing already entered key is ignored', () => {
      const state = {
        id: 'keypad',
        symbols: ['⚡', '★', 'Ω', 'Ψ'],
        correctOrder: ['⚡', '★', 'Ω', 'Ψ'],
        enteredOrder: ['⚡'],
        enteredSlots: [0],
        solved: false
      };

      const rePress = keypadModule.handleAction(state, 'press', { slotIndex: 0 });
      assert.equal(rePress.solved, false);
      assert.equal(rePress.strike, false);
      assert.deepEqual(state.enteredSlots, [0]);
    });

    test('Keypad: Malformed inputs and role filtering', () => {
      const state = {
        id: 'keypad',
        symbols: ['⚡', '★', 'Ω', 'Ψ'],
        correctOrder: ['⚡', '★', 'Ω', 'Ψ'],
        enteredOrder: ['⚡'],
        enteredSlots: [0],
        solved: false
      };

      // Out of bounds slotIndex
      const oob1 = keypadModule.handleAction(state, 'press', { slotIndex: -1 });
      assert.equal(oob1.strike, false);
      const oob2 = keypadModule.handleAction(state, 'press', { slotIndex: 4 });
      assert.equal(oob2.strike, false);

      // Role filter check
      const blindView = keypadModule.filterForRole('blind', state);
      assert.equal(blindView.correctOrder, undefined);
      assert.equal(blindView.symbols, undefined);
      assert.equal(blindView.slotCount, 4);
      assert.deepEqual(blindView.enteredSlots, [0]);

      const deafView = keypadModule.filterForRole('deaf', state);
      assert.equal(deafView.correctOrder, undefined);
      assert.deepEqual(deafView.symbols, ['⚡', '★', 'Ω', 'Ψ']);
      assert.deepEqual(deafView.enteredSlots, [0]);
    });
  });

  describe('4. Cross-Module Consistency & 1000-Game Monte Carlo Verification', () => {
    test('1000 random bombs: every instance has valid solutions derivable from manual', () => {
      const lcg = createLcgRng(777);
      const SYMBOL_PRIORITY = ['⚡', '★', 'Ω', 'Ψ', '▲', '◆', '✦', '⚙'];

      for (let gameIdx = 0; gameIdx < 1000; gameIdx++) {
        // Generate serial number
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        const digits = '0123456789';
        const serial = `${chars[Math.floor(lcg() * chars.length)]}${digits[Math.floor(lcg() * digits.length)]}-${digits[Math.floor(lcg() * digits.length)]}${digits[Math.floor(lcg() * digits.length)]}-${chars[Math.floor(lcg() * chars.length)]}${digits[Math.floor(lcg() * digits.length)]}`;
        const lastSerialDigit = parseInt(serial[serial.length - 1], 10);
        const isSerialEven = lastSerialDigit % 2 === 0;
        const ctx = { serialNumber: serial, isSerialEven, rng: lcg };

        // 1. Button Test
        const btn = buttonModule.create(lcg, ctx);
        // Deduce solution purely using manual rules:
        let expectedAction, expectedReleaseDigit;
        if (btn.color === 'white') {
          expectedAction = 'press';
          expectedReleaseDigit = null;
        } else if (btn.color === 'red' && !isSerialEven) {
          expectedAction = 'press';
          expectedReleaseDigit = null;
        } else if (btn.color === 'blue') {
          expectedAction = 'hold';
          expectedReleaseDigit = 4;
        } else if (btn.color === 'yellow') {
          expectedAction = 'hold';
          expectedReleaseDigit = 7;
        } else {
          expectedAction = 'hold';
          expectedReleaseDigit = 1;
        }

        assert.equal(btn.actionType, expectedAction, `Game ${gameIdx}: button actionType mismatch`);
        assert.equal(btn.targetReleaseDigit, expectedReleaseDigit, `Game ${gameIdx}: targetReleaseDigit mismatch`);

        // Execute manual's solution
        let btnRes;
        if (expectedAction === 'press') {
          btnRes = buttonModule.handleAction(btn, 'press', {}, ctx);
        } else {
          btnRes = buttonModule.handleAction(btn, 'release', { releaseDigit: expectedReleaseDigit }, ctx);
        }
        assert.equal(btnRes.solved, true, `Game ${gameIdx}: Button failed to solve using manual rule`);
        assert.equal(btnRes.strike, false);

        // 2. Wires Test
        const wires = wiresModule.create(lcg, ctx);
        const redCount = wires.wires.filter((c) => c === 'red').length;
        const blueCount = wires.wires.filter((c) => c === 'blue').length;
        let expectedWireIndex;
        if (redCount > 1) {
          expectedWireIndex = 1;
        } else if (wires.wires[3] === 'yellow') {
          expectedWireIndex = 0;
        } else if (blueCount === 1) {
          expectedWireIndex = 2;
        } else {
          expectedWireIndex = 3;
        }

        assert.equal(wires.correctWireIndex, expectedWireIndex, `Game ${gameIdx}: Wire correctWireIndex mismatch`);
        const wireRes = wiresModule.handleAction(wires, 'cut', { wireIndex: expectedWireIndex }, ctx);
        assert.equal(wireRes.solved, true, `Game ${gameIdx}: Wires failed to solve using manual rule`);
        assert.equal(wireRes.strike, false);

        // 3. Keypad Test
        const keypad = keypadModule.create(lcg, ctx);
        // Deduce order purely from manual priority:
        const expectedOrder = [...keypad.symbols].sort(
          (a, b) => SYMBOL_PRIORITY.indexOf(a) - SYMBOL_PRIORITY.indexOf(b)
        );
        assert.deepEqual(keypad.correctOrder, expectedOrder, `Game ${gameIdx}: Keypad order mismatch`);

        for (const targetSymbol of expectedOrder) {
          const slot = keypad.symbols.indexOf(targetSymbol);
          assert.ok(slot >= 0 && slot < 4);
          const kRes = keypadModule.handleAction(keypad, 'press', { slotIndex: slot }, ctx);
          assert.equal(kRes.strike, false);
        }
        assert.equal(keypad.solved, true, `Game ${gameIdx}: Keypad failed to solve using manual rule`);
      }
    });
  });
});
