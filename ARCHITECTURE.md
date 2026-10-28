# BananaBomb — Architecture & Modularity Guide

BananaBomb is a local 3-player in-person cooperative bomb defusal game running over LAN/Hotspot using a **Server-Authoritative WebSocket** architecture and native **ES Modules** (no build step or bundler required).

Player-facing rules, physical seating setup, and Persian instructions are documented in [`README.md`](./README.md).

---

## 1. Directory & Module Structure

```text
/
├── server.js                      # HTTP/Express static host, LAN info endpoint, WS bootstrap & public re-exports
├── shared/                        # Pure isomorphic domain modules (zero Node/DOM dependencies; served at /shared)
│   ├── roles.js                   # Canonical role keys, legacy ('blind'/'deaf'/'mute') normalizers & metadata
│   ├── difficulty.js              # Difficulty presets, override sanitization, custom detection & guessing analysis
│   ├── comm-aid.js                # Easy-mode 3-symbol Communication Aid definitions & initial round state factory
│   └── utils.js                   # Seeded xmur3+mulberry32 PRNG, Fisher-Yates shuffle, serial generator & Braille maps
├── server/                        # Server-side authoritative runtime subsystems
│   ├── logger.js                  # Pure ASCII terminal logging & player/role log formatters
│   ├── lan-discovery.js           # Offline LAN / Wi-Fi / Hotspot IPv4 interface scoring & discovery
│   ├── rate-limiter.js            # Per-session sliding-window action rate limiter & actionId deduplication
│   ├── session-registry.js        # Persistent player sessions, active sockets, role ownership & host election
│   ├── game-engine.js             # Authoritative round state machine, countdown/game timers & role state filtering
│   └── ws-router.js               # WebSocket connection lifecycle & validated per-message event handlers
├── modules/                       # Server-side authoritative bomb puzzle modules & dynamic rulebook generator
│   ├── index.js                   # Ordered module registry (`activeModules`, `modulesById`) & `validateBombActionPayload`
│   ├── rules-config.js            # Seeded round rulebook selector & puzzle rule variants
│   ├── button.js                  # Catalyst Button server module
│   ├── wires.js                   # Fuse Wires server module
│   ├── keypad.js                  # Cipher Keypad server module
│   ├── beacon.js                  # Silent Optical Morse & Tactile Braille server module
│   ├── difficulty-config.js       # Compatibility re-export of `shared/difficulty.js`
│   └── utils.js                   # Compatibility re-export of `shared/utils.js`
├── public/                        # Browser client application & 3D scene subsystems (served at /)
│   ├── index.html                 # Single-page markup & importmap (`/vendor/three` offline Three.js bundle)
│   ├── styles.css                 # Responsive RTL layout, role badges, tactile HUD & manual styling
│   ├── app.js                     # Client application coordinator (session sync, lobby/round routing, Operator timer audio)
│   ├── transport.js               # Auto-reconnecting WebSocket client & NTP-like server clock offset estimator
│   ├── session-store.js           # Hybrid `sessionStorage` + `localStorage` tab-safe player identity store
│   ├── audio.js                   # Procedural Web Audio API synthesizer & accelerating timer pulse scheduler
│   ├── qr-svg.js                  # Zero-dependency Byte-mode QR Code SVG encoder (ISO/IEC 18004, Versions 1-6)
│   ├── world-graph.js             # Headless Three.js 3D Van World graph builder & 5-sample sightline evaluator
│   ├── bomb3d.js                  # Live WebGLRenderer wrapper, pointer/context-loss lifecycle & frame-budget monitor
│   ├── briefcase-rig.js           # Hard-shell briefcase rig, physical lid occluder, inner-lid timer & Morse side-lamp
│   ├── camera-rig.js              # Fixed-origin seated role cameras, bounded head-look & optical FOV-only zoom
│   ├── tactile-styler.js          # 4-pass Operator monochrome tactile wireframe pipeline & red target reticle
│   ├── interaction-controller.js  # Operator touch/pointer gesture state machine (tap vs hold, drag slop, safe cancel)
│   ├── van-environment.js         # Low-poly daytime van cabin & shared table geometry
│   ├── world-avatars.js           # Role-specific seated teammate avatars & layer masks
│   ├── ui/                        # Cohesive 2D UI & input sub-controllers
│   │   ├── viewport-ergonomics.js # Toast banner, Screen Wake Lock, Fullscreen toggle, haptics & portrait hint
│   │   ├── qr-modal.js            # Offline LAN QR invite modal, interface selector & manual Hotspot IP override
│   │   ├── reference-sheet.js     # Role permissions spec, 4-tab Reference Sheet modal, checklist & countdown prep
│   │   ├── comm-aid-ui.js         # Easy-mode 3-symbol Communication Aid widget controller
│   │   ├── manual-renderer.js     # Dynamic Tactical Field Manual HTML renderer & module/spectrum filter tabs
│   │   └── keyboard-controls.js   # Keyboard camera presets, Operator module hotkeys & Space-bar hold state machine
│   └── modules/                   # Client-side 3D bomb module builders & interactive control descriptors
│       ├── index.js               # Client module registry (`clientModules`)
│       ├── canvas-utils.js        # Isomorphic 2D canvas factory (browser `<canvas>` + headless mock for Node tests)
│       ├── button.js              # 3D Catalyst Button mesh, strip & press/hold visual state
│       ├── wires.js               # 3D Fuse Wires geometry, index badges & cut state
│       ├── keypad.js              # 3D Cipher Keypad keys & monochrome tactile Braille/relief vs color glyphs
│       └── beacon.js              # 3D Optical Morse spectrum window, 3-slot Braille dial & HOLD TX switch
└── tests/                         # Node `node:test` integration, occlusion, interaction & architecture suites
```

---

## 2. Dependency Direction & Layering Rules

Dependencies flow strictly inward toward pure domain modules with **zero circular imports**:

1. **`shared/*`** depends on nothing outside `shared/`. Because Express mounts `/shared` alongside `public/`, relative imports from `public/*.js` (`../shared/...`) and `public/ui/*.js` (`../../shared/...`) resolve identically on disk in Node tests and over HTTP in the browser.
2. **`modules/*`** (server puzzle logic) depends only on `shared/*` and sibling files in `modules/`.
3. **`server/*`** depends on `shared/*` and `modules/*`. Within `server/`:
   - `logger.js`, `lan-discovery.js`, and `rate-limiter.js` are leaf utilities.
   - `session-registry.js` manages player sessions, sockets, and role slots.
   - `game-engine.js` owns `gameState`, round timers, and role-filtered state snapshots.
   - `ws-router.js` routes incoming WebSocket events into `session-registry.js`, `game-engine.js`, and `modules/index.js`.
   - `server.js` wires Express routes and attaches `ws-router.js` to the HTTP server.
4. **`public/*`** never imports from `server/*` or server `modules/*`:
   - `world-graph.js` constructs the complete Three.js scene graph without requiring `window`, `document`, or WebGL so `tests/shared-world-occlusion-and-roles.test.js` can verify sightlines and physical briefcase-lid occlusion in Node.
   - `bomb3d.js` wraps `world-graph.js` with `THREE.WebGLRenderer`, resize/context-loss listeners, and `BombInteractionController`.
   - `app.js` coordinates `transport.js`, `audio.js`, `bomb3d.js`, and the focused UI controllers in `public/ui/*`.

---

## 3. Gameplay Module Contracts & Adding a New Module

Adding a new bomb module requires registering a **server module** and a matching **client 3D module** with the same `id`:

### Server Module Contract (`modules/<name>.js`)
Register in `modules/index.js`:
- `id` (`string`) and `title` (`string`): Unique module key and player-facing Persian title.
- `create(rng, ctx) -> state`: Deterministically builds initial authoritative module state using the seeded `rng` (`ctx` provides `{ serialNumber, isSerialEven, rng, roundRules, difficulty }`).
- `filterForRole(role, state, ctx?) -> filteredState`: Strips secret clues not permitted for `role` (`'blind'`/Operator, `'deaf'`/Observer, `'mute'`/Manual-holder) before any network serialization.
- `validateAction(action, rawData) -> { ok: true, sanitizedData, targetKey } | { ok: false, message }`: Validates incoming WebSocket action payloads before state mutation.
- `isRedundantAction?(state, action, sanitizedData) -> boolean`: Optional idempotency check (e.g., ignoring duplicate cuts on an already cut wire).
- `handleAction(state, action, sanitizedData, ctx) -> { solved, strike, reason? }`: Evaluates a validated Operator action against authoritative state.
- `isSolved(state) -> boolean`: Returns whether the module is defused.

### Client 3D Module Contract (`public/modules/<name>.js`)
Register in `public/modules/index.js`:
- `id` (`string`): Must match the server module `id`.
- `build(THREE, slot, role) -> THREE.Group`: Builds the module's 3D meshes within `slot` (`1.08 × 1.08` bay unit), tagging interactive hitboxes (`userData.isTouchHitbox`) and visual clue surfaces (`userData.clueId`).
- `update(group, role, filteredModState)`: Updates 3D visuals from the server's role-filtered module state.
- `resolveControl(hit, modState, role, timingConfig) -> descriptor | null`: Maps a raycast hit to an interaction descriptor (`moduleId`, `controlId`, `interactionMode`, `buildAction`).
- `onVisualState?(group, visualEvent, role, modState, descriptor)`: Optional visual feedback hook during active pointer/keyboard press or hold gestures.

Finally, add the corresponding rulebook section generator in `modules/rules-config.js` and render its manual card in `public/ui/manual-renderer.js`.

---

## 4. Development, Lint & Verification Commands

```bash
# Install dependencies
npm install

# Start the local LAN server on port 3000
npm start

# Syntax-check all shared, server, module, and client ES modules
npm run lint

# Execute the full automated test suite (concurrency=1 for shared HTTP/WS server tests)
npm test
```
