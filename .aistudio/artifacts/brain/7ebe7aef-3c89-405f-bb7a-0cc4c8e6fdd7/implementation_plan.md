# Implementation Plan: Seed-Based Rule Generation System

Implement a robust, seed-based rule-generation system for BananaBomb so players cannot memorize a small set of fixed solutions across rounds.

## 1. User Decisions & Architectural Alignment

Based on the clarifying answers:
- **Rulebook Delivery**: The server transmits a structured round rulebook (`roundManual`) exclusively over WebSocket to the manual-holder (`mute` role) in the state update. The static HTML is cleaned of hardcoded answers so unauthorized roles cannot inspect secret rules.
- **Seed Visibility & Control**: The active match seed is displayed in the lobby with an optional custom seed input for the host, allowing competitive replays and deterministic testing.
- **Rule Variations**: Pick from multiple distinct curated rule schemas per seed for the button, wires, and keypad modules, ensuring every rule set is intuitive, unambiguous, and solvable.

---

## 2. Proposed Changes & Technical Architecture

### A. Authoritative Curated Rule Schemas (`modules/rules-config.js`)
Expand `modules/rules-config.js` into a dynamic schema engine:
- **Deterministic Seeded Selection**:
  - `selectRoundRules(rng)`: picks a curated schema for Button, Wires, and Keypad deterministically based on the round's seeded PRNG.
- **Curated Button Schemas (3 Variants)**:
  - **Protocol A (Standard Reactor)**:
    - Tap: White button; or Red button + Odd serial last digit.
    - Hold: Blue $\rightarrow$ 4, Yellow $\rightarrow$ 5, White $\rightarrow$ 1, Red $\rightarrow$ 7.
  - **Protocol B (High-Frequency Capacitor)**:
    - Tap: Yellow button; or Blue button + Even serial last digit.
    - Hold: Red $\rightarrow$ 3, Blue $\rightarrow$ 6, White $\rightarrow$ 8, Yellow $\rightarrow$ 2.
  - **Protocol C (Thermal Matrix)**:
    - Tap: Red button; or White button + Even serial last digit.
    - Hold: Yellow $\rightarrow$ 1, Red $\rightarrow$ 5, Blue $\rightarrow$ 9, White $\rightarrow$ 4.
- **Curated Wires Schemas (3 Variants)** (each verified across all 256 wire arrangements):
  - **Protocol A (Sequential Fuse)**:
    - 1: If red > 1 $\rightarrow$ Wire 2.
    - 2: Else if wire 4 is yellow $\rightarrow$ Wire 1.
    - 3: Else if blue == 1 $\rightarrow$ Wire 3.
    - 4: Otherwise $\rightarrow$ Wire 4.
  - **Protocol B (Ground Bypass)**:
    - 1: If no red wires $\rightarrow$ Wire 1.
    - 2: Else if green > 1 $\rightarrow$ Wire 4.
    - 3: Else if wire 4 is red $\rightarrow$ Wire 2.
    - 4: Otherwise $\rightarrow$ Wire 3.
  - **Protocol C (Dual Bus Distribution)**:
    - 1: If blue > 1 $\rightarrow$ Wire 3.
    - 2: Else if wire 1 is green $\rightarrow$ Wire 2.
    - 3: Else if yellow > 1 $\rightarrow$ Wire 4.
    - 4: Otherwise $\rightarrow$ Wire 1.
- **Curated Keypad Priority Permutations**:
  - Deterministically permutes canonical symbol priority using the round seed so symbol rankings change predictably across rounds.
- **Structured Manual Generator**:
  - `generateRulebook(roundRules)` generates a structured object (`{ button, wires, keypad }`) explaining the current round's exact rules in Persian for the manual-holder.

---

### B. Server Round Lifecycle & State Management (`server.js`)
- **Round Seed Management**:
  - `gameState.roundSeed`: initialized in lobby (e.g. `'B7K2X9'`), persistent across client reconnects during the round.
  - New WebSocket message `{ type: 'set_seed', payload: { seed: '...' } }`: validated by server (alphanumeric, 3–12 chars) and only allowed in lobby by the host.
  - `startGame(optionalSeed)`: initializes round rules once using `createRng(roundSeed)` and stores `gameState.roundRules`.
  - Reconnecting players receive the existing active `roundRules` and `roundSeed` without re-randomizing or resetting timer.
- **Role-Filtered State Isolation (`getFilteredStateForRole`)**:
  - Include `roundSeed` in common lobby state so players see the match seed.
  - Include `roundManual: gameState.roundRules.rulebook` **strictly if `role === 'mute'`**.
  - For `blind`, `deaf`, and spectators: `roundManual` is `null`.
  - Never leak `actionType`, `targetReleaseDigit`, `correctWireIndex`, or `correctOrder`.

---

### C. Client Manual Renderer & Lobby UI (`public/index.html`, `public/app.js`, `public/style.css`)
- **Lobby Seed Control**:
  - Add seed display tag and custom seed input field in the lobby section.
  - Allow host to type a custom seed and click "تنظیم سید" (Apply Seed).
- **Dynamic Rulebook Rendering in `#muteSection`**:
  - Replace hardcoded static HTML tables with a dynamic container `#muteManualContainer`.
  - In `public/app.js`: when `state.roundManual` is received, render the round's specific Button table, Wires checklist, and Keypad priority ribbon.
  - If unauthorized role inspects DOM or devtools, no secret rules exist in their client memory or DOM.

---

### D. Automated Test Suite (`tests/gameplay-rules.test.js`)
1. **Seed Determinism**: Verify identical seed produces identical serial, module states, button schema, wire schema, and keypad order.
2. **Seed Variance**: Verify different seeds produce different schemas and solutions.
3. **Reconnect Stability**: Verify reconnecting does not alter active round rules or seed.
4. **Exhaustive Wire Validation**: Test all 3 wire protocols across all 256 wire permutations ($3 \times 256 = 768$ combinations), proving 100% unambiguous single solutions.
5. **Cross-Module Monte Carlo (1000 rounds)**: Generate 1,000 seeded bombs and verify every round is solvable and in 100% agreement with the generated rulebook.
6. **Role Isolation & Anti-Leak**: Assert that non-mute clients never receive `roundManual` or private solution parameters.
7. **Malformed & Edge-Case Seeds**: Test empty, non-alphanumeric, and long seeds handling.

---

## 3. Verification Plan

### Automated Tests
- Run `npm test` covering:
  - `tests/gameplay-rules.test.js` (including all new seed determinism, rulebook agreement, and schema permutation tests).
  - `tests/responsive-interaction.test.js` (Phase 3 3D and responsive controls).
  - `tests/session-lifecycle.test.js` (session persistence and host controls).

### Manual / Browser Verification
- Verify lobby shows current round seed with editable input for the host.
- Start game as Mute: verify dynamic manual renders protocol title and custom rules.
- Open second and third browser tabs as Deaf and Blind: verify 3D bomb works seamlessly, and inspect network/DOM to ensure `roundManual` is absent.
- Defuse/explode and restart: verify seed updates for next round unless host pins a custom seed.
