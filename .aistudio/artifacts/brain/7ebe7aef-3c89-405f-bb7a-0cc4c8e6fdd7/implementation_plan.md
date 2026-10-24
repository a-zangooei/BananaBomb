# BananaBomb — Professional Game UI/UX & 3D Floating Hands Overhaul

Transform BananaBomb from a utilitarian web dashboard into a cohesive, tactile commercial cooperative game—unifying menus, lobby, active HUD, and the Persian field manual under a warm charcoal-and-amber tactical briefcase identity while replacing detached forearm cylinders with clean, wrist-only floating 3D monkey hands.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> All four core design and gameplay questions from Phase 1 have been confirmed and integrated as hard design constraints across the entire overhaul:

- **Confirmed Decision 1 — Tactical Briefcase Visual Identity (Warm Charcoal & Amber)**: Replace cool-slate SaaS cards, pill chips, decorative emojis, and frosted glass panels with matte charcoal (`#121110` / `#1c1917`), brushed gunmetal (`#292524`), warm amber/brass hardware accents (`#f59e0b` / `#d97706`), crisp `4px–8px` tactical corners, and custom SVG iconography.
- **Confirmed Decision 2 — Armless Teammate Torsos & Floating Wrist-Only Gloved Hands**: Remove all forearm fur sleeves from gloved hands and remove upper-arm stumps from seated monkey avatars across the table so every hand in the 3D van world is an intentional, cleanly capped wrist-only floating glove with true left/right geometry (no negative-scale inside-out normals).
- **Confirmed Decision 3 — Pure Color & 3D Shape Clues for Observer**: Per explicit requirement, the Observer perceives clues strictly through physical 3D shapes and vivid material colors inside the laterally open briefcase—no extra 3D stripe patterns or HUD clue-summary cheat strips will be added.
- **Confirmed Decision 4 — Dedicated Reference & Pre-Round Checklist Sheet**: Keep the main lobby focused strictly on Role Selection, Team Readiness, Difficulty Configuration, and Start/Ready, while housing the 7-item Pre-Round Checklist, 9-Gesture Guide, Role Permissions Matrix, and Physical Seating/Audio Rules inside a tabbed Reference & Checklist sheet launched from a dedicated header button.

---

## 1. Overview & Core Concept

- **What It Does**: Overhauls every player-facing 2D surface (Lobby, Header, Reference & Checklist Sheet, Active Gameplay HUD, Operator tactile feedback, Observer viewport controls, Manual-holder field rulebook, and Endgame debrief) alongside the 3D monkey avatar/hand rig so the entire 3-player cooperative experience reads and plays like a polished commercial release on phones and desktops.
- **Target Audience / Persona**: Three co-located friends playing together in Persian (RTL) primarily on smartphones (`360×640` portrait to `844×390` landscape) or desktop browsers around a shared physical table, relying on asymmetric spoken and gesture communication under time pressure.
- **Key Value**:
  - **Immediate Lobby Clarity**: New and returning players can pick a role, verify 3/3 team readiness, choose difficulty, and start a round within seconds on a compact phone screen without scrolling past walls of instructional cards.
  - **Maximized Unobstructed 3D Viewport**: Slimmed active HUD chrome (`≤ 15%` sticky vertical footprint on mobile, zero `backdrop-filter` over active WebGL) keeps the bomb briefcase, controls, and teammates front and center.
  - **Clean Stylized 3D Character Craft**: Floating gloved monkey hands with sealed wrist cuffs eliminate awkward detached forearm tubes and inverted mesh normals while keeping sightlines 100% unobstructed.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Streamlined Pre-Game Lobby Flow**:
   - **Header Bar (Single-Row, 3-Zone Contract)**: Displays the clean **بمب موز** wordmark, concise connection status indicator (with explicit text state, never a pulsing dot alone), and the single-line **راهنما و چک‌لیست** (Reference & Checklist) trigger button. The in-round bomb timer/serial/strike strip and raw network ping/clock-offset telemetry are completely absent in the lobby.
   - **Step 1 — Role Deck (Primary Visual Anchor)**: Three tactile role plates (**اپراتور · میمون نابینا**, **ناظر · میمون ناشنوا**, **راهنما · میمون لال**) with custom SVG role insignias (sunglasses, studio headphones, field manual), a crisp 1-line role summary, and unmistakable states (*Available*, *Selected by You*, *Occupied*, *Ready*, *Disconnected*) communicated via explicit text + icon + border treatment rather than color alone.
   - **Step 2 — Team Readiness Strip**: Compact 3-slot squad bar (`بازیکنان آماده: ۲ از ۳`) showing live slot occupancy and readiness checkmarks at a glance.
   - **Step 3 — Compact Mission Configuration**: Segmented preset selector (**آسان**, **معمولی**, **سخت**, **سفارشی**) displaying an inline effective summary (`زمان: ۰۵:۰۰ · خطای مجاز: ۳ · ماژول‌ها: ۴`), with custom round sliders tucked cleanly inside an expandable advanced drawer only when **سفارشی** is chosen.
   - **Step 4 — Dominant Action Bar**: Prominent thumb-friendly **آماده‌ام / لغو آمادگی** toggle paired with the Host's **شروع عملیات** primary amber CTA, accompanied by a plain-Persian readiness blocker reason whenever start conditions are not yet met (e.g., waiting for missing role or unready teammate).

2. **On-Demand Reference & Pre-Round Checklist Sheet**:
   - Tapping **راهنما و چک‌لیست** in the header opens a structured, fast-scanning modal/bottom sheet organized into four clean tabs:
     1. **چک‌لیست پیش از شروع**: Interactive 7-item physical setup checklist with live completion counter (`۰/۷` to `۷/۷`).
     2. **چیدمان و قوانین صدا**: Physical table seating layout (Operator South, Manual-holder North behind raised lid, Observer East lateral side), physical room audio reality, and safety/accessibility notes.
     3. **زبان اشاره (۹ حرکت)**: Scannable 9-card gesture dictionary for Observer ↔ Manual-holder silent visual coordination.
     4. **جدول مجوزهای نقش**: Clear matrix of allowed vs. forbidden senses and actions per role.

3. **Active Gameplay HUD & Role-Specific Flows**:
   - **Compact Tactical Top Strip**: Replaces bulky multi-row status cards with a single slim, high-contrast tactical bar displaying:
     - Tabular countdown readout (`04:32`) with non-color urgency Escalation (amber border + warning icon under `60s`, crimson border + critical icon under `20s`).
     - Explicit numeric + visual strike readout (`خطاها: ۱ / ۳` alongside sharp geometric strike markers).
     - Module defusal progress (`خنثی‌شده: ۲ / ۴`) and Observer-only Serial readout (`سریال: K4-82-M6` shown strictly for Observer; hidden cleanly rather than showing `---` placeholders for Operator and Manual-holder).
   - **Operator Experience (`blind` / `operator`)**:
     - Uncluttered monochrome tactile 3D viewport (`#050507` canvas, matte-black depth occluders, crisp white structural edges, `#ef4444` target reticle on active control).
     - Unified bottom tactical dock combining camera focus switches (**نمای ماژول‌ها** / **نمای کلی میز** / **بازنشانی دید**) and an unmistakable live gesture readout bar showing **ضربه (Tap)** vs. **نگه‌داشتن (Hold)** fill progress and explicit **لغو ایمن (Safe Cancel)** confirmation if the finger slides off target.
     - Operator settings (hold threshold `250–700ms`, look sensitivity, sound toggle) sit inside a compact collapsible popover from the bottom dock so sliders never crowd the 3D bomb view.
   - **Observer Experience (`deaf` / `observer`)**:
     - Maximized daylight 3D van viewport from the East (`+X`) seat looking directly into the open briefcase bay to inspect pure 3D shapes and vivid colors (wire colors, button color, side hold-strip color, keypad symbols, beacon dial, and East-rim serial plate).
     - Bottom camera preset dock (**نمای سرنخ‌ها** · **پلاک سریال** · **دید هم‌تیمی‌ها** · **بازنشانی**) plus the optional Easy-mode 3-symbol communication bridge tucked neatly without obstructing the briefcase.
   - **Manual-Holder Experience (`mute` / `manual`)**:
     - Seamless 3-mode layout switcher (**نمای ترکیبی** split · **دفترچه کامل** full-sheet · **نمای میز ۳D** world) pairing the live North-seat 3D van view (where the `-95°` open briefcase lid physically blocks 100% of interior clues) with a redesigned **Tactical Field Manual**.
     - Field Manual uses crisp section tabs (**دکمه** · **سیم‌ها** · **صفحه‌کلید** · **چراغ مورس**), interactive serial-parity filter buttons (**همه** · **زوج** · **فرد**), high-contrast tabular rule rows, and live solved badges synced from authorized module status.

4. **Endgame Debrief Overlay (Defused / Exploded)**:
   - Replaces generic centered alert boxes with a dramatic tactical mission debrief panel (**عملیات موفق · بمب خنثی شد** in emerald/amber vs. **انفجار بمب · پایان عملیات** in crimson), clear round summary metrics (remaining time, strikes recorded, modules defused), and an immediate **بازگشت به لابی / دور جدید** CTA.

### Visual Identity & Theme

- **Aesthetic Direction**: *Tactical Hardware Briefcase*—grounded, physical, anodized dark metal, brass latches, crisp stenciled dividers, and high-legibility field-manual typography that bridges the 2D interface directly to the physical briefcase bomb on the van table.
- **Color Palette & 60-30-10 Discipline**:
  - **60% Dominant Neutral Canvas (`--bg-canvas: #121110`, `--bg-elevated: #1c1917`)**: Deep matte warm charcoal (< 5% warm tint) avoiding generic blue-slate SaaS tones.
  - **30% Structural Surfaces (`--surface-panel: #24211e`, `--border-subtle: #38332e`, `--text-primary: #fafaf9`, `--text-muted: #a8a29e`)**: Machined gunmetal plates with `1px` solid bevel borders (`border-radius: 6px`; nested inner elements `4px`).
  - **10% High-Intent Tactical Accents**:
    - Primary Action / Hardware Brass: `--accent-amber: #f59e0b` (hover `#fbbf24`, active `#d97706`, dark ink `#121110` for `> 10:1` WCAG AAA contrast).
    - Defused / Ready Signal: `--signal-ready: #10b981` paired with checkmark icon & label.
    - Strike / Detonation Danger: `--signal-danger: #ef4444` paired with triangle/cross icon & numeric count.
- **Typography & RTL Hierarchy**:
  - Primary UI & Field Manual prose: **Vazirmatn** (`400` Regular for body at `15px–16px`, `700` Bold for headings and tactical controls, `text-wrap: balance` on titles).
  - Countdown Timer, Serial Number, Strike Ratios, and Morse Timings: Monospace / `font-variant-numeric: tabular-nums` (`dir="ltr"` inside isolated numeric spans so digits never jitter or flip RTL punctuation).
- **Anti-Slop & Mobile Viewport Governance**:
  - **Zero Pills**: Static metadata uses clean unboxed typography separated by `·`; interactive tabs and presets use crisp `4px–6px` segmented tactical buttons.
  - **Zero Emojis in UI Chrome**: All role icons, status markers, audio indicators, and navigation triggers use crisp inline SVG vectors (retaining audited gesture symbols inside the gesture dictionary where required).
  - **Zero `backdrop-filter` Over WebGL**: HUD bars above the 3D canvas use solid/high-opacity matte charcoal (`rgba(18, 17, 16, 0.94)`) with crisp `1px` gunmetal borders so mobile and software WebGL frame pacing never stalls.
  - **15% Mobile Sticky Cap & `≥ 44×44px` Touch Targets**: Top HUD bar (`48px`) and collapsible bottom control dock keep the central 3D viewport unobstructed, and every interactive button, preset, tab, and checkbox meets `≥ 44×44px` touch ergonomics.

### 3D Monkey Avatars & Floating Wrist-Only Hands

- **Clean Wrist-Only Floating Hands**:
  - Every gloved hand (`Operator` foreground left/right hands, `Observer` East-table gesture hands, and `Manual-holder` North-seat rulebook hands) consists strictly of a sculpted white glove palm, four articulated finger groups, a correctly oriented thumb, and a **closed, sealed wrist cuff cap** (`cuffRing` + recessed inner wrist seal cap).
  - All protruding orange fur forearm cylinders (`sleeveGeo`) are completely removed so hands float cleanly and intentionally in 3D space without severed arm tubes sticking out toward the camera edge.
- **Armless Seated Teammate Torsos**:
  - Seated monkey avatars across the table retain their expressive orange-fur heads, ears, cream bellies, and role-identifying accessories (Operator dark sunglasses, Observer over-ear headphones, Manual-holder green neckerchief & 3D rulebook), while the two upper-arm stump cylinders on the torso are removed so floating gloved hands read as a consistent, intentional Rayman/VR-inspired character style.
- **True Left/Right Chirality (Zero Negative Scale)**:
  - Left and right gloved hands are constructed via explicit handedness (`side: 'left' | 'right'`) that mirrors thumb X placement and rotation mathematically while keeping `scale` strictly positive `(1, 1, 1)`, guaranteeing outward-facing vertex normals and consistent lighting/outlines in both Daylight and Operator monochrome modes.

### Interactive Feedback & Motion

- **Fast Settling Micro-Interactions (`≤ 180ms`)**: Button presses, role card selections, and sheet drawers animate exclusively via GPU compositor properties (`transform`, `opacity`) with `cubic-bezier(0.16, 1, 0.3, 1)` easing and full `prefers-reduced-motion: reduce` instant-snap compliance.
- **Tactile Hold & Cancel Clarity**: Holding the 3D Button, a Wire (`400ms`), or Beacon TX (`340ms`) drives both the in-scene 3D progress ring and a crisp linear progress bar in the Operator's bottom dock; sliding off target (`> 12px` drag slop) flashes a clear non-punitive **لغو ایمن** confirmation before transitioning smoothly into bounded seated head-look.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Lobby Prioritization + Header-Triggered Reference Sheet**
  - *Chosen Approach*: Keep only Role Selection, Squad Readiness, Compact Difficulty Selector, and Ready/Start CTA on the primary lobby canvas, while moving the 7-item Pre-Round Checklist, 9-Gesture Vocabulary, Role Permissions Matrix, and Physical Setup Tutorial into a dedicated tabbed sheet opened from the header.
  - *Why*: Eliminates ~70% of vertical scroll clutter on `360×640` mobile screens so players can join and start immediately, while preserving 100% of instructional depth and automated onboarding-audit guarantees one tap away.
  - *Alternatives Considered*: Deleting instructional panels (rejected—harms new players and breaks communication safety onboarding) or leaving them inline as collapsed accordions at the bottom of the lobby (rejected—still creates visual dashboard noise below the CTA).

- **Decision 2 — Explicit Left/Right Hand Geometry Over `scale.x = -1` Mirroring**
  - *Chosen Approach*: Parameterize the procedural 3D hand builder with `side: 'left' | 'right'`, remove both forearm sleeves and torso upper-arm cylinders, and seal the back of every glove cuff with a closed cap mesh.
  - *Why*: Negative X-scaling in Three.js inverts triangle winding (`matrixWorld.determinant() < 0`), causing subtle shading artifacts and fragile normal behavior; explicit chirality + closed wrist caps ensures clean silhouettes from every seated camera angle and zero occlusion of bomb controls.
  - *Alternatives Considered*: Inverse-kinematic full arms connecting shoulders to hands (rejected—joint stretching and elbow clipping look broken in low-poly procedural rigs and risk occluding lateral Observer sightlines).

- **Decision 3 — Pure Visual Color & Shape Fidelity for Observer**
  - *Chosen Approach*: Keep Observer clues strictly inside the 3D briefcase geometry (calibrated vivid wire colors, button cap color, side hold-strip color, 3D keypad plates, beacon dial, and East-rim serial plate) with zero synthetic 2D HUD clue readouts or added stripe textures.
  - *Why*: Directly honors the user's gameplay design requirement that the Observer relies on direct visual inspection of colors and shapes inside the open briefcase from their lateral seat.

- **Decision 4 — Collapsible Bottom Control Dock & Zero WebGL Blur**
  - *Chosen Approach*: Consolidate camera presets, gesture feedback, and Operator tuning popover into a compact bottom dock with opaque matte charcoal surfaces rather than floating side cards or `backdrop-filter: blur(...)` panels.
  - *Why*: Keeps the central 3D briefcase 100% unobstructed in both portrait and landscape mobile viewports and avoids costly GPU readback stalls over WebGL canvases.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     WebSocket Game Server (Authoritative)                    │
│   Session & Role Lock ──► Seeded Bomb Rules ──► Role-Filtered State Push     │
└──────────────┬─────────────────────────┬─────────────────────────┬───────────┘
               │                         │                         │
               ▼ (Operator Payload)      ▼ (Observer Payload)      ▼ (Manual Payload)
┌──────────────────────────────────────────────────────────────────────────────┐
│                     Client State & Tactical UI Controller                    │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Top Tactical Bar                                                       │  │
│  │  • Lobby Mode: Brand Wordmark · Connection Text · [Reference & Check]  │  │
│  │  • Active Mode: Tabular Timer · Strikes (X / Max) · Progress · Serial* │  │
│  └───────────────────────────────────┬────────────────────────────────────┘  │
│                                      │                                       │
│        ┌─────────────────────────────┴─────────────────────────────┐         │
│        ▼ (status === 'lobby')                                      ▼ (running)│
│  ┌───────────────────────────────────┐   ┌────────────────────────────────┐  │
│  │ Focused Game Lobby                │   │ Role-Tailored Active Workspace │  │
│  │  1. 3-Role Selection Deck (SVGs)  │   │                                │  │
│  │  2. 3/3 Squad Readiness Bar       │   │  ┌──────────────────────────┐  │  │
│  │  3. Preset & Effective Summary    │   │  │ Shared 3D Van World      │  │  │
│  │     └─ Custom Sliders (on-demand) │   │  │ • Seated Fixed-Eye Rig   │  │  │
│  │  4. Ready Toggle + Host Start CTA │   │  │ • Hinged Briefcase (-95°)│  │  │
│  └─────────────────┬─────────────────┘   │  │ • Armless Monkey Torsos  │  │  │
│                    │                     │  │ • Wrist-Only Sealed Hands│  │  │
│                    ▼ (Header Trigger)    │  └────────────┬─────────────┘  │  │
│  ┌───────────────────────────────────┐   │               │                │  │
│  │ Reference & Checklist Sheet       │   │  ┌────────────┴─────────────┐  │  │
│  │  • Tab 1: 7-Item Setup Checklist  │   │  │ Role Dock / Field Sheet  │  │  │
│  │  • Tab 2: Seating & Audio Rules   │   │  │ • Op: Tap/Hold + Presets │  │  │
│  │  • Tab 3: 9-Gesture Dictionary    │   │  │ • Obs: Clues/Serial Cam  │  │  │
│  │  • Tab 4: Role Permissions Matrix │   │  │ • Man: Tabbed RTL Manual │  │  │
│  └───────────────────────────────────┘   └────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & State

- **Server-Filtered Role State (Unchanged Security Boundary)**:
  - Server continues to strip unauthorized clues before WebSocket transmission (`serialNumber`, wire colors, button colors, and keypad symbols sent strictly to Observer; `roundManual` rule schemas sent strictly to Manual-holder; `canInteract`, monochrome tactile state, and Morse beat schedule sent strictly to Operator).
- **Local UI View State**:
  - `lobbySheetState`: `{ open: boolean, activeTab: 'checklist' | 'tutorial' | 'gestures' | 'permissions' }` governing the header-triggered Reference & Checklist sheet (with Escape key, backdrop click, and focus restoration).
  - `checklistState`: Persists the 7 pre-round readiness checkboxes and updates a live badge (`۷/۷`) on the header Reference button so squads can verify physical readiness at a glance.
  - `hudDockState`: `{ settingsOpen: boolean, collapsed: boolean, manualViewMode: 'split' | 'sheet' | 'world', activeManualModuleTab: 'all' | 'button' | 'wires' | 'keypad' | 'beacon' }`.
- **3D Avatar & Floating Hand Rig State**:
  - Each hand unit is constructed with `{ side: 'left' | 'right', furMat, gloveMat, cuffSealMat, styleManager }`:
    - `palmMesh`, `fingerGroups[0..3]`, `thumbGroup` (mirrored on `+X` vs `-X` by `side`), `cuffRingMesh`, and `cuffCapMesh` (closing the wrist opening cleanly at local `z = +0.018m`).
    - Zero `sleeveGeo` forearm cylinders and zero upper-arm cylinders on `buildMonkeyUpperBody`.
    - All hand groups maintain `matrixWorld.determinant() > 0`, `userData.isAvatar = true` (excluded from interactive bomb touch raycasts), and deterministic registration with `WorldVisualStyleManager` for zero-leak role switching and monochrome Operator compliance.

### Interactive Component & State Mapping

- **Lobby Role & Readiness Transitions**:
  - Clicking an available role card dispatches `select_role`, highlights the card with an amber tactical frame + `"نقش شما"` badge, and enables the **آماده‌ام** button.
  - Selecting **سفارشی** expands custom round sliders smoothly; selecting **آسان**, **معمولی**, or **سخت** collapses custom sliders while updating the single-line effective configuration summary immediately.
  - Host **شروع عملیات** button dynamically computes its enabled state and renders a clear inline status message underneath whenever fewer than 3 roles are filled or any player has not marked Ready.
- **Phase Transition (`lobby` ↔ `running` ↔ `defused` / `exploded`)**:
  - Entering `running` automatically closes any open Reference sheet, hides the lobby view, reveals the active compact HUD top strip, mounts/updates the role-specific 3D view and bottom dock, and resets strike/progress counters (`۰ / ۳`).
  - Returning to `lobby` cleanly hides the round timer/strike HUD strip and restores squad role selection state.
- **Verification & Automated Test Coverage**:
  - Extend automated Node tests to assert:
    1. **Floating Hand Geometry Invariants**: Zero forearm sleeve or upper-arm meshes in the avatar hierarchy, closed wrist-cap presence on all 6 gloved hands, `matrixWorld.determinant() > 0` on every mesh (no negative-scale mirroring), strict monochrome compliance in Operator mode, and zero interference with Operator module touch raycasts.
    2. **Sightline & Occlusion Preservation**: 100% pass across 5-point-per-surface Operator reachability (`360×640` & `844×390`), Observer pure visual clue + East-rim serial visibility, and Manual-holder 100% briefcase-lid occlusion.
    3. **Onboarding, Accessibility & Clean UI Audit**: Preservation of all 7 checklist items, 9 gesture items, role permissions matrix, Persian terminology rules, and zero `alert()` / `window.open()` / raw network telemetry leakage.
