# BananaBomb — Modular Architecture & Dependency Refactoring

Reorganize the BananaBomb codebase from three oversized multi-responsibility scripts into cohesive, unidirectional ES modules across shared domain logic, authoritative server orchestration, headless 3D geometry, and client UI controllers—improving maintainability, testability, and extensibility while preserving 100% of existing gameplay rules, role boundaries, wire protocols, offline LAN operation, and player experience.

## User Review & Critical Decisions

> [!IMPORTANT]
> All architectural preferences from Phase 1 have been confirmed and govern this plan:

- **Confirmed Decision 1 — Isomorphic Shared Domain Layer**: Pure constants, role normalizers, difficulty presets/sanitizers, communication-aid symbols, deterministic PRNG/Braille tables, and shared math helpers will live in a single pure ES module layer exposed statically to browsers as well as imported directly by Node—eliminating copy-pasted logic across server and client with zero bundler overhead.
- **Confirmed Decision 2 — Align Static Source Audits with Extracted Modules**: Existing automated tests that scan raw client source text for security, ergonomics, and role-audio invariants will be updated to inspect the newly extracted UI and controller modules alongside the main entry point, while preserving every behavioral assertion.
- **Confirmed Decision 3 — Bilingual Documentation Split**: Keep the existing Persian player/setup guide intact for local LAN players and add a dedicated, concise English architecture reference documenting module boundaries, dependency direction, extension contracts, and verification commands.

---

## 1. Overview & Core Concept

- **What It Does**: Decomposes monolithic server orchestration, client UI coordination, and 3D briefcase rendering into focused, single-responsibility subsystems with explicit interfaces, unidirectional dependencies, and self-contained gameplay module contracts.
- **Target Audience / Persona**: Developers, contributors, and maintainers debugging multiplayer WebSocket state, extending the briefcase with new defusal modules, or running headless Node test suites on desktop and mobile/Termux environments.
- **Key Value**:
  - **Single Source of Truth**: Role aliases, difficulty baselines, Braille/shuffle utilities, and communication-aid symbols are defined once instead of maintained across a dozen server and browser scripts.
  - **Plug-and-Play Module Extensibility**: Adding a new bomb module no longer requires editing central server payload switch statements—each module owns its own action payload validation alongside generation, state filtering, and action resolution.
  - **Clear Separation of Concerns**: Networking, session/seat ownership, rate limiting, authoritative game rules, headless 3D occlusion math, WebGL rendering, and 2D overlays can each be read, reasoned about, and tested in isolation.

---

## 2. User Experience & Visual Design

> [!NOTE]
> **Strict Behavioral & UX Preservation Guarantee**: This initiative is purely structural. Zero gameplay rules, puzzle mechanics, role information boundaries, wire message schemas, or visual layouts will change.

- **Key User Flows (Unchanged)**:
  - **Lobby & Offline LAN Onboarding**: Players join over local Wi-Fi or mobile hotspot via offline SVG QR code or manual LAN IP selection, claim one of the three asymmetric roles (Operator, Observer, Manual-Holder), configure difficulty presets or custom parameters, review the 4-tab role reference sheet and 7-item readiness checklist, and trigger a synchronized 3-second readiness curtain.
  - **Active Asymmetric Defusal**: All three players view a shared 3D briefcase from role-locked physical viewpoints—monochrome top-down with tactile feedback and accelerating speaker timer pulses for the Operator; full-color lateral sightline onto module clues and the flat inner-lid digital timer/`maxStrikes - 1` strike display for the Observer; rear occluded viewpoint paired with the dynamic Persian tactical manual for the Manual-Holder.
  - **Disconnect Resilience & Round Summary**: Mid-round disconnects preserve seat reservations and keep the authoritative timer running for seamless automatic rejoin, concluding in a synchronized defusal or detonation summary screen.
- **Visual Identity & Theme (Preserved Intact)**:
  - *Aesthetic Direction*: Tactical industrial dark-room hardware paired with high-contrast RTL Persian typography and physical briefcase materiality.
  - *Color Palette & Mood*: Deep slate-black surfaces, amber/crimson 7-segment hardware telemetry, isoluminant monochrome filtering for the Operator's cortical visor, and crisp role-coded status accents.
  - *Typography & Hierarchy*: Clean RTL Persian UI copy paired with tabular monospace numerals for serial plates, seed codes, and hardware readouts—while keeping all server/terminal diagnostics strictly ASCII English.
  - *Interactive Feedback & Motion*: Instant tactile 3D pointer capture, continuous tempo-accelerating WebAudio timer synthesis, screen wake-lock retention, fullscreen toggles, and non-blocking toast notifications.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Isomorphic Pure ES Modules Served Over Static HTTP**
  - *Chosen Approach*: Consolidate pure role identifiers/normalizers, difficulty presets and sanitization rules, communication-aid symbol metadata, and deterministic RNG/shuffle/Braille helpers into a zero-dependency shared layer imported natively by Node ESM and browser ES modules.
  - *Why*: Eliminates drift between server and browser copies (such as duplicated preset baselines, role-key normalizers, and Fisher–Yates shuffles) while preserving native unbundled execution and 100% offline LAN operation.
  - *Alternatives Considered*: Keeping duplicated helpers synchronized via tests (retains maintenance burden) or introducing a build bundler (violates the zero-bundler native runtime constraint).

- **Decision 2: Self-Contained Gameplay Module Validation Contract**
  - *Chosen Approach*: Extend the server gameplay module contract so each bomb module (Wires, Button, Keypad, Optical Beacon) implements its own `validateAction(action, rawData)` method, invoked generically through the module registry before `handleAction`.
  - *Why*: Removes hardcoded module-ID branching from the central server validator so new puzzle modules can be registered in one place without touching transport or engine code.
  - *Alternatives Considered*: Leaving a centralized schema switch inside the WebSocket router (creates hidden coupling every time a module is added or modified).

- **Decision 3: Decouple Headless 3D World Graph from Browser WebGL Scene**
  - *Chosen Approach*: Separate the deterministic Three.js briefcase scene-graph builder, strike/optical display models, and 5-point whole-scene raycast occlusion evaluator from the DOM-bound WebGL renderer, ResizeObserver, pointer listeners, and GPU software-renderer fence throttling.
  - *Why*: Allows headless sightline and geometry verification tests to import lightweight scene-graph math directly without pulling in browser lifecycle orchestration, and clarifies what is shared spatial geometry vs. interactive viewport presentation.
  - *Alternatives Considered*: Keeping both layers in one 1,300-line file (obscures the boundary between pure spatial math and stateful WebGL lifecycle).

- **Decision 4: Explicit Dependency Injection Over Mutable Window Globals**
  - *Chosen Approach*: Pass the audio synthesizer instance explicitly into the 3D scene constructor and extracted UI controllers rather than relying on an undocumented `window.soundEngine` global side effect, while preserving public entry-point re-exports (`gameState`, `roles`, `sessions`, `activeSockets`, and lifecycle helpers) expected by existing integration suites.
  - *Why*: Eliminates hidden initialization-order coupling on the client while guaranteeing zero breakage across all existing server and WebSocket integration tests.
  - *Alternatives Considered*: Replacing server state containers with encapsulated classes that break in-place test mutations (unnecessary churn that would break test compatibility).

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Dependency Direction Diagram

All dependencies flow strictly downward from orchestration entry points toward domain modules and pure shared primitives—with zero circular imports:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          ISOMORPHIC SHARED DOMAIN LAYER                          │
│  • Role IDs, legacy/canonical normalizers & role display metadata                │
│  • Difficulty presets, custom range clamps & sanitization                        │
│  • Communication-Aid symbol catalog  • Deterministic PRNG, Shuffle & Braille     │
└───────────────────────▲──────────────────────────────────────▲───────────────────┘
                        │                                      │
      ┌─────────────────┴────────────────┐   ┌─────────────────┴────────────────┐
      │     AUTHORITATIVE NODE SERVER    │   │      NATIVE ES BROWSER APP       │
      └─────────────────┬────────────────┘   └─────────────────┬────────────────┘
                        │                                      │
  ┌─────────────────────▼──────────────────┐ ┌─────────────────▼───────────────────┐
  │       HTTP & WebSocket Bootstrap       │ │       Client App Coordinator        │
  │  • Express static + offline vendor     │ │  • Phase routing & state reconcile  │
  │  • Lifecycle exports for test harness  │ │  • Accelerating Operator audio loop │
  └──────┬──────────────┬──────────────┬───┘ └──┬──────────────┬───────────────┬───┘
         │              │              │        │              │               │
 ┌───────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐ │    ┌─────────▼────────┐ ┌────▼─────────────┐
 │ LAN & ASCII  │ │  Session,  │ │ WebSocket  │ │    │  2D UI Modules   │ │  WebGL 3D Scene  │
 │   Logger     │ │  Seats &   │ │  Router &  │ │    │ • Manual View    │ │ • Render Loop &  │
 │ • Termux IP  │ │   Host     │ │   Rate     │ │    │ • QR LAN Modal   │ │   GPU Fence Sync │
 │   scoring    │ │  Registry  │ │  Limiter   │ │    │ • Role Ref/Check │ │ • Camera, Styler │
 │ • Sanitized  │ └─────┬──────┘ └─────┬──────┘ │    │ • WakeLock/Full  │ │   & Pointer Rig  │
 │   EN logs    │       │              │        │    │ • Comm-Aid & Key │ └────────┬─────────┘
 └──────────────┘       └──────┬───────┘        │    └──────────────────┘          │
                               │                │                                  │
                     ┌─────────▼──────────┐     │                        ┌─────────▼─────────┐
                     │ Authoritative Game │     │                        │  Headless World   │
                     │   State Engine     │     │                        │  Graph & Sightline│
                     │ • Countdown/Timer  │     │                        │ • Briefcase Rig   │
                     │ • Strike/Defuse    │     │                        │ • 5-pt Raycast    │
                     │ • Role Projection  │     │                        │ • 3D Module Views │
                     └─────────┬──────────┘     │                        └───────────────────┘
                               │                │
                     ┌─────────▼──────────┐     │    ┌───────────────────────────────────────┐
                     │ Bomb Module Reg.   │     └───►│    Transport, Session & Audio Core    │
                     │ • generate()       │          │ • Reconnecting WS + seq/actionId      │
                     │ • validateAction() │          │ • Hybrid tab-lease session store      │
                     │ • handleAction()   │          │ • Procedural WebAudio synthesizer     │
                     │ • getViewForRole() │          └───────────────────────────────────────┘
                     └────────────────────┘
```

### Data Model & State Stores

- **Authoritative Server State**:
  - **Session & Seat Registry**: Maps persistent `playerId` tokens to active WebSocket connections, role slots (`blind` / `deaf` / `mute` wire keys), connection status, and deterministic host election (`blind` -> `deaf` -> `mute`), keeping live exported map/object bindings intact.
  - **Game Engine State**: Tracks phase (`waiting`, `ready`, `countdown`, `running`, `exploded`, `defused`), round seed, serial number, difficulty configuration, authoritative clock (`startTime`, `duration`, `remainingSeconds`), strike counters, active module instances, dynamic round manual rules, and role-projected state snapshots (`getFilteredStateForRole`).
  - **Action Guard State**: Per-player token bucket, mechanical bounce cooldowns, and bounded `actionId` deduplication window preventing duplicate WebSocket retries from double-striking.
- **Client State**:
  - **Coordinator State**: Holds current role assignment, latest server-projected state snapshot, active modal/tab flags, and Operator audio tick scheduler handles.
  - **3D Scene & Interaction State**: Encapsulates camera rig presets, role-locked orbit clamps, tactile styler materials, pointer capture state machine, and headless world-graph meshes.

### Interactive Component & State Mapping

- **Gameplay Module Registry & Action Pipeline**:
  - Incoming `action` messages pass through rate-limiting and `actionId` deduplication -> resolve the target module from the registry -> invoke `module.validateAction(action, rawData)` for strict schema/bounds checking -> execute `module.handleAction(instance, action, validatedData, context)` -> apply strike penalties, module defusal transitions, or round end -> broadcast role-filtered `state_update` snapshots.
- **2D UI Subsystems (Extracted from Monolithic Client Entry)**:
  - **Dynamic Manual Renderer**: Pure/DOM module rendering randomized round rules, module step filters, and empty/locked states exclusively for the Manual-Holder.
  - **Offline LAN & QR Invite Controller**: Fetches `/api/lan-info`, renders zero-dependency SVG QR codes, handles manual hotspot IP overrides with input validation, and manages clipboard copy fallbacks.
  - **Role Reference & Readiness Checklist Controller**: Owns `ROLE_PERMISSIONS_SPEC`, the 4-tab role capability modal, persistent 7-item pre-round checklist state, and countdown preparation prompts.
  - **Viewport Ergonomics Controller**: Manages Screen Wake Lock lifecycle across visibility changes, Fullscreen API toggles, portrait-orientation advisories, and transient toast banners.
  - **Communication-Aid & Keyboard Accessibility Controllers**: Handles Easy-mode 3-symbol quick signals (cooldowns, flashes) and full Operator keyboard navigation (module cycling, sub-control focus, Space-bar press-and-hold state machine).

### Incremental Verification & Deliverables

1. **Incremental Refactor Sequence**:
   - Establish the shared domain layer and `/shared` static route first.
   - Extend server gameplay modules with `validateAction` and decompose server subsystems while preserving all top-level `server.js` exports.
   - Separate the headless 3D world graph from the interactive WebGL scene and inject `soundEngine` explicitly.
   - Extract cohesive 2D UI controllers from the client coordinator.
   - Update lint glob patterns, align static source-text test checks, add dependency/module-contract verification, and author the English architecture guide.
2. **Automated Verification Gate**:
   - Syntax validation across every JavaScript directory (`npm run lint`).
   - Full Node test suite execution (`npm test`), verifying all WebSocket flows, 3D raycast occlusion guarantees, hybrid session leases, rate limits, and ASCII-English terminal log audits pass with zero regressions.
   - Static import-graph check confirming zero circular dependencies and zero dead imports, followed by build/server health verification and the 6-part Final Report.
