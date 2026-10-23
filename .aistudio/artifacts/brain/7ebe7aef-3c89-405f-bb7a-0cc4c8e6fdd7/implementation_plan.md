# BananaBomb — Shared 3D Van World, Physical Occlusion & Role-Specific Viewpoints (Revised Implementation-Ready Plan)

Implementation-ready architectural specification transforming BananaBomb from an isolated floating 3D bomb box into a unified, low-poly daytime van environment with mathematically verified briefcase hinge occlusion, fixed-origin seated role cameras, deterministic Operator monochrome wireframe rendering, and preserved touch/server security guarantees.

---

## Confirmed Baseline Decisions (Preserved Without Re-Asking)

- **Physical Table Seating & Sightlines**:
  - **Operator (`blind` / `operator`)** sits at the South (`+Z`) side of the table facing North (`-Z`) directly into the open briefcase.
  - **Manual-holder (`mute` / `manual`)** sits across the table at the North (`-Z`) side facing South (`+Z`); the briefcase lid hinges along the North (`-Z`) edge and opens upward so **the raised lid physically blocks the Manual-holder's direct sightline into the bomb's interior module bay**.
  - **Observer (`deaf` / `observer`)** sits at the **East (`+X`) lateral side** of the table facing West (`-X`), looking directly into the laterally open briefcase interior to read visual clues while seeing both teammates for spoken/gesture coordination.
- **Manual-Holder UX**: Live 3D seated van viewpoint paired with a dockable/collapsible crisp 2D Persian RTL rulebook sheet.
- **Operator Visual Style**: Monochrome white/light-gray structural outlines over matte-black depth-occluding surfaces on a black background (`#050507`), with a single crisp **red target reticle (`#ef4444`)** on the active/targeted control.
- **Camera Control Model**: Bounded seated head-look (yaw/pitch) plus quick focus presets.

---

## 1. Verified Repository Baseline & Unresolved Unknowns

### Empirically Verified Codebase Facts
- **Runtime & Installed Packages (`/package.json`, `/node_modules/three/package.json`)**:
  - Node ESM (`"type": "module"`), vanilla JavaScript frontend in `/public` (no bundler or transpiler).
  - Installed dependencies: `express` (`^4.21.2`), `three` (verified exact installed version **`0.186.1`**), `ws` (`^8.22.0`).
- **Local Three.js Serving (`/server.js:23–34`, `/public/index.html:13–21`)**:
  - `/vendor/three` serves `node_modules/three/build` (`three.module.js`), with `/vendor/three/three.module.min.js` aliased to `three.module.js`.
  - `/vendor/three-addons` serves `node_modules/three/examples/jsm`.
  - Verified local addons present on disk in `0.186.1`:
    - `three/addons/utils/BufferGeometryUtils.js` (`mergeGeometries`)
    - `three/addons/lines/LineSegments2.js`, `LineSegmentsGeometry.js`, `LineMaterial.js`
    - `three/addons/loaders/GLTFLoader.js`
- **Current Scene & DOM Routing (`/public/bomb3d.js`, `/public/app.js`, `/public/index.html`)**:
  - `Bomb3DScene` mounts into `#bomb3dContainer` inside `#bomb3dSection` **only** when `state.status === 'running'` and role is Operator or Observer (`public/app.js:930–982`).
  - Manual-holder currently activates `#muteSection` (`public/app.js:983–986`), which renders `#muteManualContainer` (`renderDynamicManual`), `#manualCommAidWidget`, and in-round reference drawers with no 3D canvas.
  - Current `Bomb3DScene` builds a flat box (`~2.55 × 2.60 × 0.50` units) at `(0, 0, 0)` with 4 modules (`public/modules/button.js`, `wires.js`, `keypad.js`, `beacon.js`) on `z = +0.25` and `serialPlateMesh` on `z = -0.255` (`rotateY(Math.PI)`), rotating `this.bombGroup` directly on pointer drag.
- **Headless Test Capability (`/public/modules/canvas-utils.js`, `/tests/operator-touch-reliability.test.js`)**:
  - `createCanvas2D()` already provides a deterministic mock 2D context (`_texts` array) when `document` is absent, enabling real `THREE.Scene`, `THREE.PerspectiveCamera`, `THREE.Raycaster`, `BombInteractionController`, and `clientModules` to run natively inside Node's test runner without a browser!
- **Static Audit Constraints (`/tests/onboarding-communication-audit.test.js:136–196`)**:
  - Automated tests read `public/index.html`, `public/app.js`, and `modules/rules-config.js` as UTF-8 text and assert:
    - Zero occurrences of `'نقش نابینا'`, `'نقش ناشنوا'`, `'نقش لال'`, `'alert('`, `'window.open('`, or false exclusive-audio strings (`'تنها اپراتور ریتم'`).
    - Presence of `id="onboardingTutorialPanel"`, `id="rolePermissionsPanel"`, `ROLE_PERMISSIONS_SPEC`, exact count of **9** `class="gesture-item"` elements, and exact count of **7** `data-check-key="` inputs.

### Documented Unresolved Unknowns & Mitigations
1. **Real-Hardware Mobile GPU Fill-Rate Variance**: Node.js `node:test` validates scene math, raycasts, draw-call structure, and state flows, but cannot execute actual hardware WebGL rasterization on budget Android GPUs (e.g., Mali-G52 / Adreno 610). *Mitigation*: Instrument `Bomb3DScene.getPerformanceMetrics()` using `performance.now()` and `renderer.info`, and include an automatic runtime frame-time degradation tier (Section 6).
2. **`npm run lint` File Glob Scope (`/package.json:10`)**: Currently `node --check server.js modules/*.js public/*.js public/modules/*.js` only checks top-level `public/*.js` and `public/modules/*.js`. *Mitigation*: Either place new 3D world modules directly in `public/` (e.g., `public/world-scene.js`, `public/camera-rig.js`, `public/tactile-styler.js`, `public/world-avatars.js`) so the existing `"lint"` script checks every file automatically, or update `"lint"` if a subdirectory is introduced. Keeping flat modules in `public/*.js` avoids touching `package.json` unless needed.

---

## 2. Precise World, Briefcase & Hinge Coordinate Specification

### World-Space Convention (`1.000 unit = 1.000 meter`, Right-Handed)
- **Axes**: `+X` = East (Observer lateral bench), `-X` = West (daylight side window), `+Y` = Up, `+Z` = South (Operator bench), `-Z` = North (Manual-holder bench).
- **Reference Planes**:
  - Van interior floor plane: `world y = 0.000m`.
  - Green wooden tabletop upper contact plane: **`world y = 0.740m`** (tabletop footprint `x ∈ [-0.525, +0.525]`, `z ∈ [-0.380, +0.380]`).

### `BriefcaseBombRig` Origin & Local Bounds
- **World Placement**: `BriefcaseBombRig.position.set(0.000, 0.740, +0.040)`, `rotation.set(0, 0, 0)`, `scale.set(1, 1, 1)`.
- **Exact Meaning of `BriefcaseBombRig` Origin `(0, 0, 0)`**: The geometric center of the briefcase's bottom outer footprint resting directly on the `world y = 0.740m` tabletop contact plane (`rig local y = 0.000m` $\iff$ `world y = 0.740m`).
- **`LowerCaseShell` Bounds**:
  - Outer shell dimensions: width $W = 0.560\text{m}$, depth $D = 0.420\text{m}$, height $H_{\text{base}} = 0.080\text{m}$.
  - **Rig-local AABB**: `x ∈ [-0.280, +0.280]`, `y ∈ [0.000, +0.080]`, `z ∈ [-0.210, +0.210]`.
  - **World-space AABB**: `x ∈ [-0.280, +0.280]`, `y ∈ [0.740, 0.820]`, `z ∈ [-0.170, +0.250]`.
  - Recessed interior bay well: perimeter wall thickness `0.020m` (`inner x ∈ [-0.260, +0.260]`, `inner z ∈ [-0.190, +0.190]`), inner mounting deck at `rig local y = +0.048m` (`world y = 0.788m`), outer rim lip at `rig local y = +0.080m` (`world y = 0.820m`).

### Hinge Axis, Pivot, Closed Geometry & Open Rotation Math
```
   SIDE PROFILE (Looking West -X from Observer's +X Seat)

                      UpperCaseLidShell (θ_open = -95° around +X)
                      World Z: [-0.261 .. -0.170], World Y: [0.815 .. 1.238]
                           ╔══╗
                           ║  ║  <-- Blocks ALL rays from Manual-holder (-Z)
   Manual-holder           ║  ║      to ModuleBayRoot!
   Eye (z = -0.640) ───X───╢  ║
   (Blocked!)              ║  ║      Closed Lid Ghost (θ_closed = 0°):
                           ║  ║      Local Z: [0 .. +0.420], Local Y: [0 .. +0.055]
             Hinge Pivot ──●═══════════════════════════════╗ (lies flat on rim!)
     World (0, 0.820, -0.170)  ┌───────────────────────┐   ║
                           ┌───┴───────────────────────┴───╨┐
                           │   ModuleBayRoot (tilted +8°)   │  <-- Operator (+Z) &
                           │      LowerCaseShell Base       │      Observer (+X) see
   ════════════════════════╧════════════════════════════════╧════  directly inside!
   Green Tabletop Contact Plane (World Y = 0.740m)
```

- **`HingePivotGroup` Transform**:
  - Child of `BriefcaseBombRig` at **rig-local `(0.000, +0.080, -0.210)`** $\implies$ **world `(0.000, 0.820, -0.170)`** (the exact North-top rear edge of `LowerCaseShell`).
  - Hinge rotation axis: **Rig/World `+X` axis `(1, 0, 0)`**, controlled solely by `HingePivotGroup.rotation.x = θ`.
- **`UpperCaseLidShell` Local Geometry (Constructed Flat in Closed State)**:
  - Rather than building pre-upright geometry, `UpperCaseLidShell` is constructed **lying flat horizontally** in `HingePivotGroup` local space:
    - `hinge-local x ∈ [-0.280, +0.280]` ($W = 0.560\text{m}$)
    - `hinge-local y ∈ [0.000, +0.055]` (lid shell thickness $T = 0.055\text{m}$)
    - `hinge-local z ∈ [0.000, +0.420]` (extends `0.420m` from the `-Z` hinge forward to the `+Z` front latch edge)
- **Closed vs. Open Rotation Convention (Right-Hand Rule about `+X`)**:
  - Under Three.js right-handed rotation about `+X`: $y' = y\cos\theta - z\sin\theta$, $z' = y\sin\theta + z\cos\theta$.
  - **Closed State ($\theta_{\text{closed}} = 0\text{ rad} = 0^\circ$)**:
    - Rig-local lid AABB: `x ∈ [-0.280, +0.280]`, `y ∈ [0.080, 0.135]`, `z ∈ [-0.210, +0.210]`.
    - World lid AABB: `x ∈ [-0.280, +0.280]`, `y ∈ [0.820, 0.875]`, `z ∈ [-0.170, +0.250]` — lies 100% flat and flush atop `LowerCaseShell`.
  - **Target Open State ($\theta_{\text{open}} = -\frac{95\pi}{180} \approx -1.6581\text{ rad} = -95^\circ$)**:
    - Rotating negatively around `+X` lifts the `+Z` latch edge `(0, 0, +0.420)` **upward** (`+Y`) to `hinge-local (0, +0.4184, -0.0366)` (`5°` past vertical toward North `-Z`, resting against the mechanical hinge stop).
    - **Exact Open Lid World-Space AABB**:
      - `world x ∈ [-0.280m, +0.280m]`
      - `world y ∈ [0.815m, 1.238m]` (top edge stands `41.8cm` above the `0.820m` lower-case rim)
      - `world z ∈ [-0.261m, -0.170m]`

### Transform Invariance of Modules, Serial Plate & Hitboxes
- **`ModuleBayRoot` Placement**: Child of `BriefcaseBombRig` (**sibling** of `HingePivotGroup`, never parented to the lid) at:
  - `position`: rig-local `(0.000, +0.052, +0.005)` $\implies$ world `(0.000, 0.792, +0.045)`.
  - `rotation`: `Euler(-82° in rad, 0, 0)` (`-1.4312 rad`), rotating legacy vertical XY module planes to lie horizontally in the recessed well with a gentle `+8°` ergonomic tilt toward the Operator (`+Z`), mapping legacy module top (`+Y`) to North (`-Z`) and module outward normal (`+Z`) to Up-South `(0, +0.990, +0.139)`.
  - `scale`: uniform `scale.setScalar(0.150)`, mapping the legacy `2.55 × 2.42` 2×2 grid cleanly into `0.383m × 0.363m` (`world x ∈ [-0.191, +0.191]`, `world z ∈ [-0.136, +0.226]`, control tops `world y ∈ [0.795, 0.830]`). Uniform scaling preserves orthogonal normals and exact `THREE.Raycaster` hitboxes across all 4 existing modules without rewriting internal module coordinates.
- **`ExteriorSerialPlate` Placement**: Child of `BriefcaseBombRig` (sibling of `HingePivotGroup`) mounted on the East (`+X`) outer vertical wall of `LowerCaseShell` at rig-local `(+0.281, +0.042, 0.000)` $\implies$ world `(+0.281, 0.782, +0.040)` with `rotation.y = +Math.PI / 2` (outward normal `+X` facing the Observer).
- **Mandatory Geometry Validation Test**: A dedicated unit test (`tests/briefcase-hinge-and-sightlines.test.js`) computes `new THREE.Box3().setFromObject(lidMesh)` at `θ = 0°`, `θ = -45°`, and `θ = -95°`, asserting flat horizontal closure at `0°`, monotonic upward `+Y` travel at `-45°`, exact open world AABB at `-95°`, and `0.000000m` world-matrix drift on all 4 modules and `serialPlateMesh` across lid animations.

---

## 3. Seated Camera Rig & Whole-Scene Occlusion Proof Strategy

### Fixed-Origin Seated Cameras & Optical FOV Zoom
- **Fixed Eye Origin Rule**: Each role's camera world position $\mathbf{P}_{\text{cam}}$ is **locked** to that role's seated eye point. Pointer drag ("head-look") modifies only clamped `yaw` and `pitch` (`Euler` order `'YXZ'`) relative to the role's base forward look direction—never camera position.
- **Zoom Behavior (FOV-Only, Zero Position Dolly)**: Pinch-zoom and mouse-wheel zoom adjust `camera.fov` within `[26°, 58°]` (followed by `camera.updateProjectionMatrix()`) while keeping `camera.position` **strictly invariant**. Because optical FOV zoom scales screen projection without moving the ray origin, zooming can **never** move a camera past the briefcase lid, clip the near plane (`near = 0.08m`, `far = 8.0m`), or alter physical sightlines.

| Role | Fixed Camera World Position $\mathbf{P}_{\text{cam}}$ | Default Look-At Target | Base Yaw / Pitch Clamp Bounds | Focus Presets (`(yaw, pitch, fov)` only — fixed $\mathbf{P}_{\text{cam}}$) |
| :--- | :--- | :--- | :--- | :--- |
| **Operator** | `(0.000, 1.180, +0.460)` (South seat) | `(0.000, 0.805, +0.045)` | `Δyaw ∈ [-22°, +22°]`, `Δpitch ∈ [-18°, +26°]` | `modules` (default framing) · `overview` (look up `+20°` at lid/Observer/van) |
| **Observer** | `(+0.640, 1.160, +0.060)` (East lateral seat) | `(0.000, 0.805, +0.045)` | `Δyaw ∈ [-34°, +34°]`, `Δpitch ∈ [-22°, +20°]` | `clues` (lateral bay view) · `serial` (aim at `(+0.281, 0.782, +0.040)`, `fov = 26°`) · `bridge` (aim across at Manual-holder & Operator) |
| **Manual-holder** | `(0.000, 1.160, -0.640)` (North seat) | `(0.000, 0.960, +0.040)` | `Δyaw ∈ [-28°, +28°]`, `Δpitch ∈ [-22°, +16°]` | `bridge` (table, lid back, Operator head & Observer hands) · `observer_focus` (aim toward `+X` Observer gesture zone) |

### Whole-Scene Multi-Point Sightline Verification Algorithm
Sightline tests **never** raycast against an isolated module group. Every test instantiates the complete `SharedVanWorld` scene (`scene.updateMatrixWorld(true)`) and casts rays against `scene.children` (`recursive: true`):

1. **Multi-Point Surface Sampling (`≥ 5` Points per Clue/Control Surface)**:
   - Each clue or control mesh defines 5 local sample points (`center` + 4 inset corners/extremities at `75%` half-extent, lifted `+0.0015m` along local outward normal):
     - `button`: `capMesh` (5 pts) + `stripMesh` (5 pts).
     - `wires`: each of the 4 `intactMesh[0..3]` (center + 2 quarter-span + 2 upper/lower ridge pts = 5 pts × 4 = 20 pts) + Easy-mode `labelMesh[0..3]` (5 pts × 4).
     - `keypad`: each of the 4 `faceMesh[0..3]` symbol plates (5 pts × 4 = 20 pts).
     - `beacon`: `knobMesh` (5 pts), `notchMesh[0..2]` (5 pts × 3), `txFaceMesh` (5 pts).
     - `serial`: `serialPlateMesh` (5 pts).
2. **Strict Ray Validation (Fail-Closed on Ambiguity)**:
   - Any ray with `direction.lengthSq() < 1e-8`, `NaN` components, `intersects.length === 0`, or hitting an untagged mystery mesh **immediately throws an assertion error** (`AMBIGUOUS_OR_INVALID_SIGHTLINE_RAY`).
   - Invisible touch-expansion hitboxes (`opacity === 0`) carry `userData.isTouchHitbox = true`:
     - **Visual Sightline Pass** filters out `isTouchHitbox === true` so only visible physical geometry (`LowerCaseShell`, `UpperCaseLidShell`, visible module meshes, van, table, avatars, 3D manual prop) participates.
     - **Operator Touch Raycast Pass** uses the exact production `Bomb3DScene.raycast()` (including `isTouchHitbox` meshes and excluding non-raycastable avatar hands) to prove every control resolves cleanly via `BombInteractionController.inspectHit()`.
3. **Role-Specific Proofs**:
   - **Operator**: All 4 module interactive hitboxes resolve as nearest hit (`hits[0]`) from the default preset in both `360×640` portrait and `640×360` landscape viewports; all projected touch boxes measure `≥ 44×44 CSS px` where layout permits (`button`, `keypad` keys, `wires` strip) without manual zoom.
   - **Observer**: From `clues` preset, 100% of clue sample points (`wires[0..3]`, `button.capMesh`, `button.stripMesh`, `keypad.faceMesh[0..3]`, `beacon.knobMesh`) are (a) inside camera frustum (`|ndcX| ≤ 0.92, |ndcY| ≤ 0.92`), (b) the **nearest scene intersection (`hits[0]`)** with zero obstruction by `UpperCaseLidShell` or `LowerCaseShell` East wall, and (c) viewed at a readable non-grazing angle ($\mathbf{n}_{\text{world}} \cdot (-\hat{\mathbf{d}}) \ge \cos(75^\circ)$). From `serial` preset, all 5 `serialPlateMesh` sample points pass the same 3 checks. Meanwhile, rays from Observer to the Manual-holder's angled 3D rulebook inner page hit `manualBackCoverMesh` first (`occluded`).
   - **Manual-holder**: Sweeping a `5 × 5` grid of `(yaw, pitch)` across the Manual-holder's clamped bounds **plus** a `3 × 3` head-position tolerance perturbation (`±0.04m` in X/Y around `(0, 1.160, -0.640)`), **100% of rays** to all module bay sample points hit `UpperCaseLidShell` (`hits[0].object.userData.occluderId === 'briefcase_lid'`) at `hits[0].distance < targetDistance - 0.03m`!

---

## 4. Separation of Server Authorization vs. Role-Rendering Architecture

### Verified Server-Side Data Filtering Contract (Preserved Intact)
Inspection of `getFilteredStateForRole` (`/server.js:295–404`) and `filterForRole` (`/modules/button.js`, `wires.js`, `keypad.js`, `beacon.js`) establishes the exact server data boundary. **Visual 3D occlusion is purely diegetic; server payload filtering remains the sole security boundary:**

| State Field / Secret | Operator (`blind` / `operator`) | Observer (`deaf` / `observer`) | Manual-holder (`mute` / `manual`) |
| :--- | :--- | :--- | :--- |
| `serialNumber` | `null` (omitted) | `string` (e.g. `'K4-82-M6'`) | `null` (omitted) |
| `roundManual` | `null` (omitted) | `null` (omitted) | `object` (`rulebook` schemas) |
| `canInteract` / `hasAudio` / `isMonochrome` | `true` / `true` / `true` | `false` / `false` / `false` | `false` / `false` / `undefined` |
| `commAid.lastSignal` | `null` (bridge hidden from Operator) | `{ id, symbol, label, senderRole, seq }` | `{ id, symbol, label, senderRole, seq }` |
| `modules.button` | `{ id, solved, label: 'دکمه', color: 'monochrome', holdStripColor: 'monochrome' \| null }` | `{ id, solved, label, color, holdStripColor }` | `{ id, solved }` |
| `modules.wires` | `{ id, count, cutWires, solved }` | `{ id, wires, colors, cutWires, solved, wireIndexLabels }` | `{ id, solved }` |
| `modules.keypad` | `{ id, slotCount, enteredCount, enteredSlots, solved }` | `{ id, symbols, enteredCount, enteredSlots, solved }` | `{ id, solved }` |
| `modules.beacon` | `{ id, solved, tunedChannel, patternId, patternName, patternStr, beats }` | `{ id, solved, tunedChannel }` | `{ id, solved }` |
| Server-Only Secrets (**Never Sent to Any Client**) | `seed`, `roundRules.*Schema.evaluate`, `button.actionType`, `button.targetReleaseDigit`, `wires.correctWireIndex`, `keypad.correctOrder`, `beacon.targetChannel` | Same — never serialized | Same — never serialized |

> [!IMPORTANT]
> **Client Module Neutrality Fix for Manual-Holder (`mute` / `manual`)**: Currently in `public/modules/button.js:278` and `wires.js:252`, `const isBlind = role === 'blind' || role === 'operator'` causes `role === 'mute'` to enter the `else` (Observer) branch and apply fallback `0xdc2626` red when `state.color` / `state.wires` are `undefined`. In the revised implementation, all 4 client modules will gate clue coloring strictly on `isObserverRole(role)` (`role === 'deaf' || role === 'observer'`), rendering neutral non-clue materials whenever `!isObserverRole(role)`!

### Safe Role-Rendering Architecture & Depth/Outline Engineering
To guarantee **zero partial or stale material states** across `setRole()` or round resets:

1. **Deterministic Profile Switching (`WorldVisualStyleManager`)**:
   - Every static world mesh stores an immutable reference to its `daylightMaterial` and its `tactileOccluderMaterial` + child `tactileEdgeLines` (`THREE.LineSegments`) at construction time.
   - Dynamic `ModuleBayRoot` subtrees are cleanly disposed and rebuilt whenever `setRole(newRole)` changes between roles, then hydrated via `updateState(this.currentState)`.
   - `applyVisualProfile(role)` atomically updates:
     - `scene.background`: `#050507` (Operator) vs. `#bae6fd` (Observer / Manual-holder).
     - `lightingGroup.visible` & `contactShadowsGroup.visible`: `false` (Operator) vs. `true` (Observer / Manual-holder).
     - Mesh `.material` (`tactileOccluderMaterial` vs. `daylightMaterial`) and `tactileEdgeLines.visible` (`true` vs. `false`).
     - Camera `layers.mask` (`LAYER_SHARED = 0`, culling each role's own head mesh on Layers `1/2/3`, and enabling `LAYER_OPERATOR_RETICLE = 4` strictly for Operator).

2. **Depth-Occluder, Outline & Draw-Order Pipeline (Preventing Z-Fighting & Bleed-Through)**:
   - **Tight Frustum Ratio**: `near = 0.08m`, `far = 8.0m` (`far/near = 100`), maximizing 24-bit depth buffer precision across `0.35m–2.50m` viewing distances (avoiding depth collapse that `polygonOffset` alone cannot cure when `far = 1000`).
   - **Pass 0 — Solid Matte-Black Depth Occluders (`renderOrder = 0`)**:
     - `MeshBasicMaterial({ color: 0x09090b, depthTest: true, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2, toneMapped: false })`.
     - Pushes solid triangle depth values slightly away from the camera in clip space while writing solid black pixels, cleanly occluding all rear briefcase, table, and van lines behind foreground geometry.
   - **Pass 1 — Structural & Curved Tactile Outlines (`renderOrder = 1`)**:
     - Hard creases: `EdgesGeometry(geometry, 20)` rendered with `LineBasicMaterial({ color: 0xf8fafc /* primary */ or 0x52525b /* van/table context */, depthTest: true, depthWrite: false, toneMapped: false })`.
     - Smooth curved controls (wires, button plunger rim, beacon knob): explicit procedural `RingGeometry` / axial silhouette `LineSegments` because `EdgesGeometry` threshold angles omit smooth cylinder sides and `GL_LINES` `linewidth > 1` is ignored by mobile ANGLE drivers.
   - **Pass 2 — Monochrome Tactile Glyphs & Progress Overlays (`renderOrder = 2`)**:
     - `capMesh`, `faceMesh`, `labelMesh`, `notchMesh`, `txFaceMesh`, and `progressRing` are physically displaced `+0.002m` to `+0.004m` along their parent surface outward normal with `depthTest: true`, `depthWrite: false`, `transparent: true`, eliminating coplanar z-fighting with both black occluders and white crease lines.
     - In Operator mode, **all** module canvas helpers (`drawButtonCapCanvas`, `drawProgressArcCanvas`, `drawWireCutProgress`, `drawKeyLabelCanvas`, `drawDialCanvas`, `drawTxCanvas`) use a strictly monochrome white/zinc palette (`#f8fafc`, `#d4d4d8`, `#71717a`, `#18181b`)—replacing existing `#38bdf8` cyan, `#f59e0b` amber, and `#22c55e` green strokes in Operator mode so **only** the targeting reticle uses red!
   - **Pass 3 — Operator Red Target Reticle (`renderOrder = 3`, `LAYER_OPERATOR_RETICLE`)**:
     - Built with `RingGeometry` + 4 crosshair ticks (`MeshBasicMaterial({ color: 0xef4444, side: THREE.DoubleSide, depthTest: false, depthWrite: false, transparent: true, opacity: 0.92 })`) so stroke width is hardware-independent on mobile GPUs and never confused with a gameplay clue (Operator never receives wire/button colors). Positioned dynamically on the active/pressed control center and hidden when idle/cancelled.

---

## 5. Preserved Interaction Contract & Public Scene API

Every timing constant, cancellation path, keyboard shortcut, and public method inspected in `/public/interaction-controller.js`, `/public/bomb3d.js`, and `/public/app.js` is preserved:

- **Unchanged `BombInteractionController` Mechanics (`/public/interaction-controller.js`)**:
  - `buttonHoldThresholdMs = 380ms` (adjustable `250–700ms` via `#holdThresholdSlider` and `setHoldThreshold(ms)` / `getHoldThreshold()`).
  - `wireCutHoldMs = 400ms` (`hold_commit` auto-commits in `tick()` at `≥ 400ms`; early release cancels with `0` errors).
  - `beaconTxHoldMs = 340ms` (`hold_commit` auto-commits in `tick()` at `≥ 340ms`).
  - `dragSlopPx = 12px` (movement `> 12px` prior to hold lock cancels pending module press with `'camera_drag'` and transitions cleanly into seated camera head-look!).
  - `keypadDedupeLockMs = 320ms` (`wires` `350ms`, `beacon:tx` `400ms`).
  - Slide-off-target (`moveDist > 4` re-checks `inspectHit(x, y)`), multi-touch pinch (`pointers.size >= 2` cancels active module gesture with `'multi_touch'` and routes pinch delta to `onCameraZoom(delta)` $\rightarrow$ clamped `camera.fov`), `pointercancel`, `lostpointercapture`, `blur`, `visibilitychange`, `orientationchange`, and `contextmenu` suppression.
- **Pointer Capture & Touch Scrolling**:
  - `dom.setPointerCapture(e.pointerId)` / `releasePointerCapture(e.pointerId)` retained on primary pointer events.
  - `touch-action: none` applies strictly to `.bomb-3d-canvas-container` (and Manual-holder's `.manual-3d-canvas-container`), while `.manual-dockable-sheet` and `#lobbySection` retain native vertical touch scrolling (`touch-action: pan-y`).
- **Backward-Compatible `Bomb3DScene` API & Adapters (`/public/bomb3d.js`, `/public/app.js`)**:
  - `viewFront()` $\rightarrow$ Adapter calling `setCameraPreset('primary')` (Operator: *Modules*, Observer: *Interior Clues*, Manual-holder: *Table & Bridge*).
  - `viewBack()` $\rightarrow$ Adapter calling `setCameraPreset('secondary')` (Observer: *Serial Plate*, Operator: *Van/Table Overview*, Manual-holder: *Observer Gesture Focus*).
  - `resetView()` $\rightarrow$ Restores active preset `(yaw = 0, pitch = 0)` and optimal aspect-adapted `fov`.
  - `targetRotX` / `targetRotY` getters & setters $\rightarrow$ Adapter forwarding keyboard `ArrowUp/Down/Left/Right` deltas from `public/app.js:1118–1129` into clamped `cameraRig.targetPitch` / `cameraRig.targetYaw` so keyboard navigation works seamlessly without breaking callers!
  - All Operator keyboard shortcuts (`Space`, `1–4`, `W + 1–4`, `C`, `T`, `Escape`) in `public/app.js:1109–1352` remain 100% intact.

---

## 6. Measurable Performance Budgets, Instrumentation & Fallback Plan

### Complexity Targets (Initial Engineering Goals)
- **Draw Calls (`renderer.info.render.calls`)**: Goal `≤ 65` in Daylight mode, `≤ 75` in Operator Tactile mode (achieved by merging static material-grouped van/table/prop geometry via `BufferGeometryUtils.mergeGeometries`).
- **Triangles (`renderer.info.render.triangles`)**: Goal `≤ 18,000` triangles total across van, furniture, 4 low-poly props, hinged briefcase, 4 modules, and 3 low-poly avatars.
- **Lighting**: `0` dynamic lights for Operator; `1 HemisphereLight + 1 DirectionalLight` + static radial-gradient canvas contact-shadow quads (`0` shadow-map passes by default) for Observer & Manual-holder.

### Concrete Measurement Protocol (`bombScene.getPerformanceMetrics()`)
`Bomb3DScene` records and exposes a structured metrics object using `performance.now()` and `THREE.WebGLRenderer.info`:
1. **`sceneConstructMs`**: Synchronous elapsed duration of `buildSharedWorld()` (`t1 - t0`). Target on desktop/Node: `< 25ms`; budget Android phone: `< 90ms`.
2. **`controlsInteractiveMs`**: Elapsed time from `new Bomb3DScene(...)` until pointer listeners are bound and `scene.updateMatrixWorld(true)` completes so `raycast()` resolves module hits. Target: `< 100ms` (Frame 0 synchronous readiness).
3. **`firstUsableFrameMs`**: Elapsed time from `new Bomb3DScene(...)` to completion of the first `renderer.render(scene, camera)` call inside `animate()`. Target: `< 150ms` on budget Android.
4. **Live GPU Counters**: `{ drawCalls, triangles, lines, points, geometries, textures }` snapshotted directly from `renderer.info.render` and `renderer.info.memory` immediately after `renderer.render()`.
5. **Resource Leak Delta Verification**: Automated test runs `10` cycles of `setRole('operator') -> setRole('observer') -> setRole('manual')` followed by `dispose()`, verifying `geometries` and `textures` counts do not grow monotonically across role switches and all scene buffers/listeners/intervals (`soundLoopInterval`, `ResizeObserver`, `requestAnimationFrame`) clean up deterministically.

### Target Devices & Automatic Runtime Fallback
- **Representative Devices**:
  - *Low/Mid-End Android*: Cortex-A55 / Mali-G52 or Adreno 610 (`360×640` portrait, `640×360` landscape, Chrome Android, `DPR` capped at `1.5` when `hardwareConcurrency <= 4`, else `1.75`).
  - *Mid-Range Smartphone*: `390×844` / `412×915` portrait & landscape (`DPR` capped at `1.75`).
  - *Desktop*: `1280×720+` (`DPR` capped at `2.0`).
- **Automatic Quality Fallback (`lowSpecMode`)**:
  - Monitored via a rolling 30-frame window (ignoring backgrounded tab spikes `dt > 250ms`). If average frame time exceeds `25ms` (`< 40 FPS`) or `sceneConstructMs > 120ms`:
    1. Reduce `renderer.setPixelRatio(1.0)`.
    2. Hide non-essential background props (`curatedPropsGroup.visible = false`) and decorative van wall rib outlines while keeping the table, hinged briefcase, modules, serial plate, and role avatars 100% intact.

---

## 7. Revised Implementation Sequence (Spatial Correctness First)

### Stage 1 — Shared Coordinates & Bounded Seated Cameras
- **Dependencies**: None.
- **Files / Modules to Inspect & Change**:
  - *Create*: `public/camera-rig.js` (`SeatedCameraRig` with fixed role eye origins, clamped `YXZ` head-look, FOV-only zoom `[26°, 58°]`, aspect-aware base FOV, and role presets).
  - *Modify*: `public/bomb3d.js` (integrate `SeatedCameraRig`, preserve `viewFront`, `viewBack`, `resetView`, `targetRotX`/`targetRotY` adapters, `setSensitivity`).
- **Implementation Tasks**: Establish metric world space (`y = 0.740m` tabletop plane); anchor Operator `(0, 1.180, +0.460)`, Observer `(+0.640, 1.160, +0.060)`, and Manual-holder `(0, 1.160, -0.640)` cameras; wire drag deltas to bounded yaw/pitch and pinch/wheel deltas to clamped `camera.fov`.
- **Acceptance Criteria**: Camera world position never translates during drag or zoom; yaw/pitch/FOV strictly obey per-role clamps; `prefersReducedMotion()` snaps camera transitions immediately.
- **Regression Risks**: Inverted touch-look feel or broken `Arrow*` keyboard nudges; mitigated by `targetRotX`/`targetRotY` adapter properties and unit tests.
- **Smallest Meaningful Test**: Headless Node test in `tests/briefcase-hinge-and-sightlines.test.js` testing extreme drag/zoom inputs on all 3 role rigs and asserting zero camera origin drift and exact yaw/pitch/FOV clamping.

### Stage 2 — Briefcase Geometry, Hinge Behavior & Raycast Occlusion Proof
- **Dependencies**: Stage 1.
- **Files / Modules to Inspect & Change**:
  - *Create*: `public/briefcase-rig.js` (`buildBriefcaseBombRig` constructing `LowerCaseShell`, `ModuleBayRoot` at `-82°` X-tilt and `0.150` uniform scale, East-wall `ExteriorSerialPlate`, and `HingePivotGroup` at `(0, +0.080, -0.210)` with flat-built `UpperCaseLidShell`).
  - *Modify*: `public/bomb3d.js` (mount `clientModules` into `ModuleBayRoot` as sibling of `HingePivotGroup`).
- **Implementation Tasks**: Build closed-flat lid geometry (`hinge-local z ∈ [0, +0.420], y ∈ [0, +0.055]`); set open angle `θ = -95°`; tag `UpperCaseLidShell` with `userData.occluderId = 'briefcase_lid'`; mount `serialPlateMesh` on East `+X` wall.
- **Acceptance Criteria**: Closed lid (`0°`) lies flush on `[0.820, 0.875]` world Y; open lid (`-95°`) spans `world y ∈ [0.815, 1.238], z ∈ [-0.261, -0.170]`; module world matrices remain invariant across lid rotation; `BombInteractionController` resolves all 4 modules without modification.
- **Regression Risks**: `LowerCaseShell` rim clipping peripheral raycasts; prevented by testing all 4 module slots right away.
- **Smallest Meaningful Test**: Geometry & `Box3` bounds test at `0°`, `-45°`, and `-95°`, plus Operator hitbox raycast verification across all 4 modules.

### Stage 3 — Observer Clue Visibility & Manual-Holder Sightline Verification
- **Dependencies**: Stage 1, Stage 2.
- **Files / Modules to Inspect & Change**:
  - *Modify*: `public/modules/button.js`, `public/modules/wires.js`, `public/modules/keypad.js`, `public/modules/beacon.js` (gate color clues strictly on `isObserverRole(role)` so Manual-holder `'mute'` also renders neutral non-clue materials; expose deterministic clue mesh refs in `group.userData` for multi-point sightline tests).
  - *Modify*: `public/index.html`, `public/app.js` (update camera preset button labels dynamically per role while keeping `#btnViewFront`, `#btnViewBack`, `#btnResetView` IDs intact).
- **Implementation Tasks**: Calibrate Observer `clues`, `serial`, and `bridge` presets from `(+0.640, 1.160, +0.060)`; implement the whole-scene 5-point-per-surface sightline verifier.
- **Acceptance Criteria**: 100% of Observer clue sample points (`wires[0..3]`, `button.capMesh`, `button.stripMesh`, `keypad.faceMesh[0..3]`, `beacon.knobMesh`, and `serialPlateMesh` in `serial` preset) are nearest visible scene hits within frustum at non-grazing angles; **100% of Manual-holder rays** across `5×5` yaw/pitch sweep + `±0.04m` eye perturbation hit `UpperCaseLidShell` before any module mesh; invalid/zero-hit rays fail the test.
- **Regression Risks**: `button.stripMesh` or East-most keypad column foreshortened from `+X`; verified mathematically via incidence angle check `≤ 75°`.
- **Smallest Meaningful Test**: Full multi-point whole-scene sightline &server `getFilteredStateForRole` test suite verifying both 3D occlusion and role payload contracts.

### Stage 4 — Operator Monochrome Tactile Rendering & Depth/Outline Validation
- **Dependencies**: Stage 2, Stage 3.
- **Files / Modules to Inspect & Change**:
  - *Create*: `public/tactile-styler.js` (`WorldVisualStyleManager` managing matte-black `polygonOffset` depth occluders, `EdgesGeometry` + curved silhouette rings, `LAYER_OPERATOR_RETICLE` red reticle `#ef4444`, and atomic role-profile switching).
  - *Modify*: `public/modules/button.js`, `public/modules/wires.js`, `public/modules/keypad.js`, `public/modules/beacon.js`, `public/bomb3d.js` (ensure Operator 2D canvas strokes are strictly monochrome white/zinc, lift overlay planes `+2mm..+4mm` with `renderOrder = 2, depthWrite = false`, and drive the 3D red reticle from active gesture events).
- **Implementation Tasks**: Wire Pass 0 (black occluders), Pass 1 (white/zinc outlines), Pass 2 (monochrome overlays), and Pass 3 (red target reticle); enforce atomic rebuild/material reset on `setRole()`.
- **Acceptance Criteria**: In Operator mode, `scene.background` is `#050507`, active lights = `0`, zero clue colors (`blue`, `yellow`, `green`, or clue-`red`) exist on any mesh or canvas stroke, rear edges are hidden by depth occluders, and pressing/holding any control activates the `#ef4444` reticle; switching `operator <-> observer` leaves zero stale materials.
- **Regression Risks**: Coplanar z-fighting on keypad/button caps; eliminated via explicit normal offset + `renderOrder` separation.
- **Smallest Meaningful Test**: Automated Operator scene inspection test asserting `0` active lights, `polygonOffset` occluders enabled, zero non-monochrome module materials, red reticle visibility on press/hold, and clean round-trip `setRole('operator') -> setRole('observer') -> setRole('operator')`.

### Stage 5 — Manual-Holder Hybrid 3D Van Viewpoint & Dockable 2D Persian Manual
- **Dependencies**: Stage 1, Stage 2, Stage 3.
- **Files / Modules to Inspect & Change**:
  - *Modify*: `public/index.html`, `public/style.css`, `public/app.js` (add `#manual3dWrapper` / `#manual3dContainer` and dockable sheet toggle controls inside `#muteSection` while keeping `#muteManualContainer`, `#manualCommAidWidget`, and `#manualInRoundPermissions` intact).
- **Implementation Tasks**: Instantiate or attach `Bomb3DScene` in `'mute'`/`'manual'` mode inside `#muteSection` when WebGL is available; build a dockable 2D Persian RTL rulebook sheet (`نمای ترکیبی` / `تمام‌صفحه دفترچه` / `نمای میز ۳D`) with isolated `touch-action: pan-y` scrolling; preserve 100% 2D fallback if WebGL is unavailable.
- **Acceptance Criteria**: Manual-holder views the shared 3D table from `-Z` (with interior bomb modules occluded by the raised lid) while reading and filtering the crisp 2D Persian rulebook without scroll/drag conflicts on `360px` mobile screens; all existing `#muteSection` audit and comm-aid tests remain green.
- **Regression Risks**: Accidental modification of audited DOM IDs or gesture item counts in `public/index.html`; prevented by keeping all existing IDs and running `tests/onboarding-communication-audit.test.js`.
- **Smallest Meaningful Test**: Run `node --test tests/onboarding-communication-audit.test.js` plus Manual-holder hybrid state/occlusion unit checks.

### Stage 6 — Van Environment, Wooden Furniture, Daylight Rig & Restrained Props
- **Dependencies**: Stages 1–5.
- **Files / Modules to Inspect & Change**:
  - *Create*: `public/van-environment.js` (procedural low-poly compact van shell with light-blue interior panels `#93c5fd`, window cutouts with sky backdrop `#bae6fd`, warm wooden benches/shelf `#b45309`, green-topped wooden table `#15803d` at `y = 0.740m`, radial canvas contact-shadow quads, and 4 static merged props: small radio, bottles, basketball, snack box).
  - *Modify*: `public/bomb3d.js`, `public/tactile-styler.js` (register environment meshes for Daylight vs. Operator subtle zinc wireframe context).
- **Implementation Tasks**: Merge static environment geometry by material via `BufferGeometryUtils.mergeGeometries`; set `raycast = () => {}` on background props/walls or verify zero interference with `BriefcaseBombRig` and sightlines.
- **Acceptance Criteria**: Re-running Stage 3's whole-scene multi-point sightline suite with the full van + furniture + props active produces **identical** visibility/occlusion pass results (`0` prop obstructions) while keeping static environment draw calls `< 20`.
- **Regression Risks**: Table or bench geometry intersecting camera near-plane or blocking Observer lateral sightlines; caught immediately by Stage 3's whole-scene raycast suite.
- **Smallest Meaningful Test**: Re-run `tests/briefcase-hinge-and-sightlines.test.js` with full `VanEnvironmentGroup` mounted and assert draw-call/mesh-count budget.

### Stage 7 — Stylized Characters, Role Accessories, Foreground Hands & Animation
- **Dependencies**: Stages 4–6.
- **Files / Modules to Inspect & Change**:
  - *Create*: `public/world-avatars.js` (procedural low-poly cartoon monkeys: orange fur `#ea580c`, cream bellies `#fef3c7`, white gloves `#f8fafc`; Operator dark sunglasses at `+Z` + foreground gloved hands; Observer over-ear headphones at `+X` + tabletop gesture hands; Manual-holder neckerchief/silent badge at `-Z` + gloved hands holding `-Z`-tilted 3D rulebook prop with `userData.occluderId = 'manual_cover'`).
  - *Modify*: `public/bomb3d.js`, `public/tactile-styler.js` (configure `LAYER_OPERATOR_BODY`, `LAYER_OBSERVER_BODY`, `LAYER_MANUAL_BODY` camera masks so each role culls its own head while seeing own foreground hands and both teammates; drive subtle Operator hand reach toward active module; disable `prefersReducedMotion()` idle bobbing).
- **Implementation Tasks**: Mark all avatar and foreground hand meshes non-interactive for bomb control raycasts (`userData.isAvatar = true` ignored by `Bomb3DScene.raycast`), while keeping `HandheldManualProp3D` cover active in visual sightline tests so Observer cannot see the 3D manual's inner page.
- **Acceptance Criteria**: Each role camera sees the other two teammates at their exact physical seats with accurate accessories; Operator hands render in monochrome wireframe for Operator and full color for Observer without ever blocking Operator touch raycasts; Observer sightline rays to Manual-holder's 3D rulebook inner page are 100% occluded by `manual_cover`.
- **Regression Risks**: Operator foreground hands intercepting module touch raycasts; prevented by excluding `isAvatar` from interactive raycast targets and running `tests/operator-touch-reliability.test.js`.
- **Smallest Meaningful Test**: Layer-mask, non-raycastable hand verification, and `manual_cover` sightline occlusion test.

### Stage 8 — Performance Instrumentation, Context-Loss Recovery, Disposal & Full Regression
- **Dependencies**: Stages 1–7.
- **Files / Modules to Inspect & Change**:
  - *Modify*: `public/bomb3d.js` (implement `getPerformanceMetrics()`, rolling FPS `lowSpecMode` auto-fallback, `webglcontextlost` / `webglcontextrestored` listeners, and exhaustive geometry/material/texture/listener disposal).
  - *Create / Finalize*: `tests/shared-world-occlusion-and-roles.test.js` (or consolidated world verification suite).
- **Implementation Tasks**: Add context-loss event prevention and scene restoration; verify `0` leaked geometries/textures/intervals across repeated `setRole()` and `dispose()` cycles; run full repository lint, build, and test verification.
- **Acceptance Criteria**: `sceneConstructMs < 90ms`, zero resource growth over 10 role-switch cycles, clean recovery on simulated `webglcontextlost`/`webglcontextrestored`, and 100% pass across all existing and new test suites.
- **Regression Risks**: Untracked `EdgesGeometry` or `CanvasTexture` instances surviving `dispose()`; prevented by tracking all created disposables in a `DisposableRegistry` set.
- **Smallest Meaningful Test**: Full `npm run lint`, `npm test`, and `npm run build` execution.

---

## 8. Verified Repository Commands & Test Suite Matrix

### Exact Verified CLI Commands (`/package.json`)
- **Run Full Test Suite (Sequential)**: `npm test` *(executes `node --test --test-concurrency=1 tests/*.test.js`)*
- **Run Single Test File**: `node --test tests/<file>.test.js`
- **Syntax Validation / Lint**: `npm run lint` *(executes `node --check server.js modules/*.js public/*.js public/modules/*.js`)*
- **Build Check**: `npm run build` *(executes `node -e "console.log('Build OK')"`)*

### Existing Test Files That Must Remain 100% Green
1. `tests/operator-touch-reliability.test.js` — Tap/hold threshold boundaries, `400ms` wire cut, `340ms` beacon TX, `12px` drag-slop cancellation, `pointercancel`, `lostpointercapture`, `blur`, `visibilitychange`, `orientationchange`, `320ms` keypad dedupe, server action validation, and rate limiting.
2. `tests/onboarding-communication-audit.test.js` — Role terminology audit, 9-gesture vocabulary, 7-item pre-round checklist, physical audio copy rules, and Easy-mode 5-use 3-symbol `comm_signal` bridge.
3. `tests/role-dependency-redesign.test.js` — 3-client WebSocket state isolation and Acoustic Beacon solve/strike flow.
4. `tests/gameplay-rules.test.js` — Deterministic Button, Wires, and Keypad rule evaluation and `filterForRole` unit checks.
5. `tests/difficulty-presets.test.js` — Easy/Normal/Hard presets, custom overrides, strike penalties, idempotency, and Monte Carlo solvability.
6. `tests/responsive-interaction.test.js` — Viewport framing math, NDC pointer mapping, and unauthorized action rejection.
7. `tests/seed-rule-generation.test.js` — Deterministic PRNG and dynamic round manual schemas.
8. `tests/session-lifecycle.test.js` — Role assignment, duplicate rejection, reconnects, and host transfer.

### New Automated Tests to Add (`tests/shared-world-occlusion-and-roles.test.js`)
1. **Briefcase Hinge & Transform Invariance**: Asserts closed (`0°`) flat AABB, open (`-95°`) upright world AABB, and `0` drift on module/serial transforms during lid rotation.
2. **Fixed Camera Origin & Clamped Head-Look / FOV Zoom**: Asserts `camera.position` invariance under extreme drag and zoom inputs for all 3 roles.
3. **Whole-Scene Multi-Point Sightline Proofs**: 5-point-per-surface full-scene raycasts proving Operator control reachability, Observer lateral clue & serial plate visibility (plus `manual_cover` occlusion), and 100% `UpperCaseLidShell` occlusion of all interior modules across Manual-holder's entire yaw/pitch/perturbation envelope (failing closed on `0`-hit/degenerate rays).
4. **Role Data Authorization & Non-Secret Preservation**: Verifies `getFilteredStateForRole` omits all unauthorized clues while preserving `solved`, `cutWires`, `enteredSlots`, `tunedChannel`, and `modulesDefusedCount` for their respective roles.
5. **Operator Tactile Style & Role-Switch Cleanup**: Verifies `0` active lights, `#050507` background, `polygonOffset` black occluders, zero clue-color leakage, red reticle activation, and `0` leaked disposables across 10 `setRole()` cycles + `dispose()`.

---

## 9. Open Decisions Requiring Your Input

Only the following three narrow implementation details remain open and genuinely benefit from your preference before coding begins:

1. **Lobby Tutorial Seating Text Alignment (`public/index.html:202`)**: The lobby's 1-sentence seating card currently describes the Observer sitting "in the center facing the Manual-holder" (`در مرکز روبه‌روی دفترچه راهنما`). Should we update that sentence so the physical lobby seating diagram also explicitly describes the **Manual-holder sitting across the table behind the briefcase lid and the Observer sitting at the side of the table** (matching the 3D van layout while keeping all audited IDs green), or leave existing lobby copy untouched?
2. **Round-Start Briefcase Lid Motion**: Should the briefcase begin each round **already open at `-95°` on Frame 1** (fastest `0ms` path to interactive controls), or play a **short `400ms` lid-opening flip** from `0°` to `-95°` at round start (automatically skipped when `prefers-reduced-motion` is active)?
3. **Manual-Holder Default Portrait Split (`360×640` Phones)**: On narrow portrait phones, should the Manual-holder's hybrid screen default to **60% dockable 2D rulebook / 40% 3D van view** (prioritizing immediate rule table legibility without an extra tap) or **50% / 50%**?
