# Implementation Plan: Phase 3 — Cross-Device 3D Interaction, Responsive Layout, and Input Reliability

Enhance the BananaBomb game with an auto-fit responsive viewport, compact landscape HUD sidebar, rich tactile feedback for the Blind player (subtle haptics, glow ring, tick sound), and camera controls (Front View reset + camera sensitivity slider).

## 1. User Preferences & Architecture Alignment

- **Orientation & Viewport Layout**: Mobile landscape uses an **auto-fit viewport with compact HUD sidebar** (sidebar on one side with timer, strikes, and quick cues, 3D bomb occupying the remaining view).
- **Tactile & Auditory Feedback for Blind Player**:
  - Subtle multi-pulse haptics (`navigator.vibrate([40, 30, 40])` on button hold/wire cut/keypad press, single pulse on tap).
  - Procedural glow ring around the active interactive element (canvas-rendered glowing ring / material emissive flash).
  - Short procedural audio tick/click sound on successful interaction.
- **On-Screen Camera Controls**:
  - Quick Reset to Front View button (`👀 روبرو / بازنشانی`).
  - Smooth Camera Sensitivity Slider (`سرعت چرخش`) saved in `localStorage` and dynamically adjusting pointer drag multipliers.

---

## 2. Proposed Implementation Steps

### Step 1: Fix Mobile Landscape CSS Class Mismatch & Auto-Fit Layout
- **Files**: `public/style.css`, `public/index.html`
- **Changes**:
  - Reconcile `#bombSidebar` and `.bomb-sidebar-desktop` / `.bomb-landscape-sidebar` in CSS so that `#bomb3dSection` cleanly splits into a fixed-width compact HUD sidebar (e.g. `240px`–`270px`) and an auto-filling 3D canvas on mobile landscape (`@media (orientation: landscape) and (max-height: 520px)`).
  - Ensure zero vertical scroll overflow (`height: 100dvh; overflow: hidden;`) on mobile landscape.
  - Keep touch targets $\ge 44\text{px}$ for toolbar buttons and HUD items.

### Step 2: Implement Camera Sensitivity Slider & Front View Reset
- **Files**: `public/index.html`, `public/bomb3d.js`, `public/app.js`, `public/style.css`
- **Changes**:
  - Add camera sensitivity slider control (`<input type="range" id="cameraSensitivity" min="0.5" max="2.0" step="0.1" value="1.0">`) to the 3D bomb toolbar.
  - Wire sensitivity into `Bomb3DScene.setSensitivity(val)` to scale drag delta multipliers (`dx * 0.008 * sensitivity`).
  - Wire up Front View Reset button (`#btnViewFront` / `#btnResetView`) to smoothly interpolate camera back to front facing angle ($x=0, y=0$) and adaptive distance.

### Step 3: Implement Rich Tactile & Visual Glow Feedback for Blind Interactions
- **Files**: `public/bomb3d.js`, `public/modules/button.js`, `public/modules/wires.js`, `public/modules/keypad.js`, `public/audio.js`
- **Changes**:
  - Add visual glow ring effect when touching interactive elements (subtle emissive material highlight or animated canvas ring).
  - Trigger subtle vibration patterns (`navigator.vibrate([30])` on button press, `[25, 25]` on wire cut, `[20]` on keypad hit) via a centralized `triggerTactileFeedback(type)` helper.
  - Play immediate responsive tick/click audio for the Blind player on pointerdown and cut/release actions.

### Step 4: Verification & Test Suite
- Run automated test suite (`npm test`).
- Verify responsive unit tests in `tests/responsive-interaction.test.js`.
- Build and verify applet compilation (`compile_applet`).
- Validate dev server HTTP status and WebSocket connection.

---

## 3. Verification Plan

### Automated Tests
- `npm test`: Run all 41 test cases (modules, session lifecycle, responsive interactions, action floods).
- Verify camera distance adaptation, coordinate translation, and role authorization.

### Manual / Browser Verification
- **Desktop**: Verify rotation with mouse drag, mouse wheel zoom, keyboard shortcuts (`R`, `B`, arrow keys, Space, 1-4).
- **Mobile Landscape Simulation**: Verify sidebar displays timer and role instructions cleanly beside 3D canvas without clipping.
- **Tablet / Portrait**: Verify orientation hint, quick camera buttons, and responsiveness to resize events.
- **Tactile Feedback**: Verify haptics call safety check (`if (navigator.vibrate)`) and procedural audio synthesizer triggers.
