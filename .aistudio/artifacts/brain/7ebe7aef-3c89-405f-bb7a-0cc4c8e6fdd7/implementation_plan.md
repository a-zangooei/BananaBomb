# Implementation Plan: Game-Rule Pipeline Audit & Correction

Establish a single, authoritative, testable definition of each module's rules across server generation, client 3D interaction, manual presentation, and automated test fixtures.

## 1. User Decisions & Rule Architecture Alignment

Based on the clarifying answers:
- **Button Module Rules**: Button body color determines whether the Blind player must **Tap (press & immediate release)** or **Hold**. If a Hold is required, the lit side strip color determines the countdown timer release digit. The unused random button label is replaced with a standard, non-misleading military designation.
- **Button Tap vs. Hold Threshold**: Explicit **350 ms** duration threshold (`duration < 350` is a Tap/Press, `duration >= 350` is a Hold/Release).
- **Keypad Error Behavior**: An incorrect symbol press issues exactly **one strike**, clears `enteredOrder` and `enteredSlots`, turning off all key illumination and resetting the sequence cleanly without allowing race-condition duplicate strikes.

---

## 2. Proposed Changes & Module Contracts

### A. Shared Rule Definition (`modules/rules-config.js` or `modules/contract.js`)
Create a single source of truth for all module constants, rule descriptions, and evaluation functions so server validation and client manual instructions never drift:
- **Button Constants**:
  - `BUTTON_COLORS = ['white', 'red', 'blue', 'yellow']`
  - `STRIP_COLORS = ['blue', 'yellow', 'white', 'red']`
  - Strip-to-digit mapping: `blue: 4`, `yellow: 5`, `white: 1`, `red: 7`.
  - Tap rules: `white` (always tap), `red` with odd serial digit (tap). All others hold and release on the strip's target digit.
- **Wire Constants**:
  - `WIRE_COLORS = ['red', 'blue', 'yellow', 'green']`
  - Sequential priority rules:
    1. If red wires > 1 $\rightarrow$ Cut Wire #2 (index 1).
    2. Else if last wire is yellow $\rightarrow$ Cut Wire #1 (index 0).
    3. Else if exactly 1 blue wire $\rightarrow$ Cut Wire #3 (index 2).
    4. Otherwise $\rightarrow$ Cut Wire #4 (index 3).
- **Keypad Constants**:
  - `SYMBOL_POOL = ['⚡', '★', 'Ω', 'Ψ', '▲', '◆', '✦', '⚙']`
  - 4 unique symbols selected via Fisher-Yates shuffle and sorted by canonical pool index.

---

### B. Module Implementations & Audits

#### 1. Reactor Button Module (`modules/button.js` & `public/modules/button.js`)
- **Generation (`create`)**:
  - Generates `color` from `BUTTON_COLORS` and `holdStripColor` from `STRIP_COLORS`.
  - Computes `actionType`: `'press'` if `color === 'white'` or (`color === 'red'` and `!ctx.isSerialEven`); else `'hold'`.
  - Computes `targetReleaseDigit`: `null` if press; otherwise `STRIP_DIGIT_MAP[holdStripColor]`.
  - Removes misleading randomized `buttonLabels` — uses fixed label `'کاتالیزور'` / `'REACTOR'` on the 3D model.
- **Role Filtering (`filterForRole`)**:
  - `blind`: receives `color: 'monochrome'`, `holdStripColor: state.solved ? null : 'monochrome'`. Never receives `actionType` or `targetReleaseDigit`.
  - `deaf`: receives `color`, `holdStripColor`. Never receives `actionType` or `targetReleaseDigit`.
  - `mute`: receives only `solved`.
- **Server Validation (`handleAction`)**:
  - `'press'`: valid if and only if `actionType === 'press'`. If pressed when hold was required, registers strike.
  - `'release'`: valid if and only if `actionType === 'hold'` AND `releaseDigit === state.targetReleaseDigit`. Strike on wrong digit or if released when quick press was expected.

#### 2. Wire Sequencer Module (`modules/wires.js` & `public/modules/wires.js`)
- **Generation & Exhaustive Evaluation**:
  - Exactly 4 wires from `['red', 'blue', 'yellow', 'green']`.
  - Deterministically evaluates `correctWireIndex` (0 to 3).
- **Role Filtering**:
  - `blind`: receives only `count: 4`, `cutWires: [...]`, `solved`. Colors and `correctWireIndex` are strictly omitted.
  - `deaf`: receives `wires: [...]` (colors), `cutWires: [...]`, `solved`. `correctWireIndex` is strictly omitted.
  - `mute`: receives only `solved`.
- **Server Validation**:
  - Ignores duplicate cuts or invalid indices without issuing extra strikes.
  - Correct wire cuts defuse the module (`solved = true`). Incorrect cuts add to `cutWires` and trigger a strike.

#### 3. Cipher Keypad Module (`modules/keypad.js` & `public/modules/keypad.js`)
- **Generation & Ordering**:
  - Selects 4 distinct symbols using Fisher-Yates shuffle.
  - `correctOrder` is strictly derived from canonical `SYMBOL_POOL` order.
- **Action Validation & Error Reset**:
  - Ignores presses on already entered slots.
  - If pressed symbol matches `correctOrder[enteredOrder.length]`: advances sequence. If all 4 match, marks `solved = true`.
  - If mismatch: issues **1 strike**, resets `enteredOrder = []` and `enteredSlots = []`.
- **Role Filtering**:
  - `blind`: receives `slotCount: 4`, `enteredCount`, `enteredSlots`, `solved`. No symbols or correct order.
  - `deaf`: receives `symbols: [...]` in physical slot positions, `enteredCount`, `enteredSlots`, `solved`. No `correctOrder`.
  - `mute`: receives only `solved`.

---

### C. Manual / Rulebook Documentation (`public/index.html`)
Update the static manual table and checklist displayed to the Mute player:
1. **Button Rulebook**:
   - Condition table matching the exact server logic:
     - White button $\rightarrow$ Immediate quick click.
     - Red button + Odd serial $\rightarrow$ Immediate quick click.
     - All other buttons $\rightarrow$ Hold button, watch side strip color:
       - Blue strip $\rightarrow$ Release on **4**.
       - Yellow strip $\rightarrow$ Release on **5**.
       - White strip $\rightarrow$ Release on **1**.
       - Red strip $\rightarrow$ Release on **7**.
   - Removes obsolete text claiming the side strip is purely decorative.
2. **Wires Checklist**:
   - Clear, numbered wire instructions matching indices 0–3 from top to bottom.
3. **Keypad Ribbon**:
   - Exact symbol priority ribbon `⚡ ➜ ★ ➜ Ω ➜ Ψ ➜ ▲ ➜ ◆ ➜ ✦ ➜ ⚙`.

---

### D. Automated Test Suite (`tests/gameplay-rules.test.js`)
- Test 100% of all button branches (White, Red+Odd, Red+Even, Blue, Yellow with all strip colors).
- Exhaustive Monte Carlo test: 1,000 random bomb generations verifying that every single generated state produces a valid, solvable state that the manual accurately predicts.
- Exhaustive permutation test for all 256 wire combinations ($4^4$) verifying that every combination resolves to exactly one correct wire matching the manual.
- Keypad test covering full solve flow, wrong key press error reset, and re-press deduplication.
- Role-filter privacy test asserting that `correctWireIndex`, `correctOrder`, `actionType`, and `targetReleaseDigit` never leak in client payloads.

---

## 3. Verification Plan

### Automated Tests
- Run `npm test` to verify:
  1. `tests/gameplay-rules.test.js` (all branch assertions, 256 wire permutations, 1000 Monte Carlo runs).
  2. `tests/responsive-interaction.test.js` (Phase 3 interaction and camera tests).
  3. `tests/session-lifecycle.test.js` (connection and multi-role state tests).
- Verify zero regressions and 100% test pass rate.

### Browser / Manual Verification
- Test running game as Deaf, Blind, and Mute players simultaneously:
  - Deaf inspects serial plate and informs team of serial and button/strip colors.
  - Mute reads the updated manual and confirms the exact condition.
  - Blind performs the action (tap vs hold on correct second) and verifies success or strike.
