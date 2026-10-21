# Configurable Difficulty Presets & Fair Error-Cost System

Comprehensive server-authoritative difficulty architecture and proportional error-cost penalty system for BananaBomb, providing three distinct gameplay tiers (**Easy**, **Normal**, **Hard**), duplicate-action rejection, lobby host controls, and anti-guessing game balance.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following design choices have been confirmed and integrated into this implementation plan:

- **Confirmed Decision 1 (Penalty Scaling)**: Time penalties on strikes scale proportionally with difficulty:
  - **Easy**: $-15\text{s}$ per error.
  - **Normal**: $-30\text{s}$ per error.
  - **Hard**: $-45\text{s}$ per error.
- **Confirmed Decision 2 (Easy Mode Assistance)**: Easy mode equips the Observer with visual wire numbering indices ($1$ to $4$) and grants a $+30\text{s}$ timer grace buffer at round initiation.
- **Confirmed Decision 3 (Lobby Control)**: The lobby provides a one-click preset selector (**آسان / متوسط / سخت**) with an expandable host override panel allowing fine-tuning of timer duration, allowed strikes, module counts, and penalty seconds before round launch.

---

## 1. Overview & Core Concept

- **What It Does**: Centralizes all difficulty, timing, module allocation, and penalty mechanics into a single server-authoritative configuration module. Enables the room host to toggle between curated presets or customize parameters in the lobby, while freezing settings upon game start. Penalties deduct both an error token (strike) and authoritative seconds without allowing double-penalization or negative time display.
- **Target Audience**: Cooperative local trios ranging from first-time casual groups needing forgiving timers and visual aids (Easy) to coordinated competitive teams seeking tight time pressure and reduced error tolerance (Hard).
- **Key Value**: Delivers replayability and balanced tension. Eliminates brute-force guessing as a viable strategy while ensuring honest UI mis-clicks or network packet retries never penalize players unfairly.

---

## 2. User Experience & Visual Design

### Key User Flows
1. **Lobby Configuration**:
   - In the lobby, all connected players view the active difficulty card in the tactical HUD.
   - The room host sees an interactive segmented preset control (`آسان | متوسط | سخت`) along with an accordion to unlock custom slider overrides. Non-hosts observe real-time updates with a "تنظیمات توسط میزبان" (Controlled by host) badge.
2. **Round Transition & Setting Freeze**:
   - When all 3 players are ready and the host clicks **شروع عملیات (Start Game)**, difficulty parameters freeze immediately.
   - The server initializes the exact module count configured for that difficulty (e.g., 2 modules on Easy, 3 on Normal, 4 on Hard).
3. **In-Game Error Feedback**:
   - When an unauthorized or incorrect action occurs (e.g., wrong wire cut, invalid keypad symbol, premature button release, wrong beacon frequency TX):
     - The Operator receives immediate audio-tactile haptic feedback and a red HUD flash.
     - The timer authoritatively decrements by the scaled penalty ($-15\text{s}$, $-30\text{s}$, or $-45\text{s}$). A floating `−XXs` red penalty badge appears briefly beside the digital clock.
     - The strike LED lights up across all screens.
   - If the time deduction exhausts the remaining seconds, the bomb detonates with `time_out`; if strikes reach the limit, it detonates with `max_strikes`. Terminal states are strictly mutually exclusive.
4. **Easy Mode Assistance View**:
   - The Observer's 3D viewport displays numbered wire pins ($1$ through $4$) above the fuse strip, removing index ambiguity during early tutorials.

### Visual Identity & Theme
- **HUD Theme**: Obsidian base (`#0f172a`), tactical amber (`#f59e0b`), emerald disarm (`#10b981`), critical crimson alert (`#ef4444`), and tactical cyan (`#06b6d4`).
- **Typography**: Angular tabular monospace numbers for digital timer and penalty indicators; bold geometric Persian typography (`Vazirmatn`, sans-serif) for status labels.
- **Zero-Pill Restraint**: Status badges and metadata are rendered as clean unboxed typographic entries with dot separators (`·`).

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Authoritative Single-Source-of-Truth Module (`modules/difficulty-config.js`)**:
  - *Chosen Approach*: Define `DIFFICULTY_PRESETS` and penalty calculation functions in one shared module imported by `server.js` and exported to clients.
  - *Why*: Eliminates scattered constants, prevents client/server desynchronization, and simplifies automated unit testing.
  - *Alternatives Considered*: Hardcoding difficulty branches inside `server.js` was rejected as brittle and hard to maintain.

- **Decision 2: Deduplication & Idempotent Action IDs**:
  - *Chosen Approach*: Actions carry a client-generated UUID / sequence nonce. The server maintains an action receipt ring-buffer.
  - *Why*: Prevents network resends or rapid multi-clicks from subtracting $2\times 30\text{s}$ or burning multiple strikes for a single physical player mistake.

- **Decision 3: Anti-Guessing Mathematical Balancing**:
  - *Chosen Approach*: On Hard difficulty ($210\text{s}$, $2$ strikes, $-45\text{s}$ penalty, 4 modules), a single blind guess has an expected loss value of $-45\text{s}$ and burns 50% of the team's lifeline.
  - *Why*: Wires ($1/4$ chance), Keypad ($1/24$ chance), Button ($1/10$ chance), and Beacon ($1/3$ chance) all yield negative expected utility for guessing compared to communicating.

---

## 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                 LOBBY & PRE-ROUND CONFIG                    │
│  Host selects preset (Easy/Normal/Hard) or custom overrides │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               v
┌─────────────────────────────────────────────────────────────┐
│             modules/difficulty-config.js                     │
│  • Single Source of Truth for presets & penalty scaling     │
│  • Parameters: duration, maxStrikes, moduleCount, penalty   │
│  • Features: wireIndexLabels, timerGraceSeconds             │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               v
┌─────────────────────────────────────────────────────────────┐
│                       server.js                             │
│  • Host authority enforcement for set_difficulty            │
│  • Frozen difficulty on gameState.status === 'running'      │
│  • Idempotency ring-buffer (prevents double penalties)      │
│  • Clamped timer decrements: Math.max(0, time - penalty)    │
│  • Mutually exclusive terminal state transitions            │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               v                               v
┌──────────────────────────────┐ ┌────────────────────────────┐
│   Observer View (3D/HUD)     │ │   Operator View (3D/HUD)   │
│ • Full color viewport        │ │ • Monochrome 3D viewport   │
│ • Easy mode wire numbering   │ │ • Tactile action executor  │
│ • Read-only difficulty info  │ │ • Floating penalty HUD     │
└──────────────────────────────┘ └────────────────────────────┘
```

### Difficulty Preset Specification Table

| Preset | Time | Allowed Strikes | Modules | Error Time Penalty | Assistance Features |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Easy** | $300\text{s}$ ($+30\text{s}$ grace) | $3$ | $2$ (Wires + Button or Beacon) | $-15\text{s}$ | Observer wire index badges, generous timing |
| **Normal** | $300\text{s}$ | $3$ | $3$ (3 of 4 active) | $-30\text{s}$ | Standard rules, standard cooldown |
| **Hard** | $210\text{s}$ ($3.5\text{m}$) | $2$ | $4$ (All active) | $-45\text{s}$ | Tight timing, no assistance |

---

## 5. Verification Plan

- **Automated Test Suite**:
  - `difficulty-presets.test.js`:
    - Validates preset schema constraints and default values.
    - Tests server rejection of difficulty changes by non-hosts or mid-round.
    - Tests error penalties: exact deduction ($-15\text{s}$, $-30\text{s}$, $-45\text{s}$) applied exactly once.
    - Tests action deduplication: replayed actions with identical nonce do not trigger second penalty.
    - Tests timer floor: penalties exceeding remaining seconds trigger `time_out` without negative values.
    - Tests terminal exclusivity: simultaneous zero-timer and max-strikes resolve deterministically to exactly one outcome.
    - 1,000-round Monte Carlo simulation across all three difficulty presets confirming 100% solvability.
- **Applet Compilation & Linting**:
  - Run `lint_applet` and `compile_applet` to ensure zero syntax or build regressions.
