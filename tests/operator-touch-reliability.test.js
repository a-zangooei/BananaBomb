process.env.NODE_ENV = 'test';
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import * as THREE from 'three';

import {
  BombInteractionController,
  INTERACTION_DEFAULTS
} from '../public/interaction-controller.js';
import { clientModules } from '../public/modules/index.js';
import {
  server,
  gameState,
  roles,
  sessions,
  activeSockets,
  ROLES,
  resetGame,
  validateBombActionPayload
} from '../server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

/**
 * Builds an authentic Three.js 3D Bomb Scene Graph & PerspectiveCamera using the
 * exact production `clientModules` (`button`, `wires`, `keypad`, `beacon`) so tests
 * raycast against real 3D meshes and execute the production interaction controller.
 */
function createProduction3DTestRig({
  role = 'operator',
  viewportWidth = 390,
  viewportHeight = 680,
  initialState = null
} = {}) {
  const scene = new THREE.Scene();
  const aspect = viewportWidth / viewportHeight;
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 50);

  // Match Bomb3DScene.calcOptimalCameraDist
  const vFovRad = THREE.MathUtils.degToRad(45);
  const tanHalfVFov = Math.tan(vFovRad * 0.5);
  const tanHalfHFov = tanHalfVFov * aspect;
  const cameraDist = Math.max(3.55, 1.54 / tanHalfVFov, 1.42 / Math.max(0.28, tanHalfHFov));
  camera.position.set(0, 0, cameraDist);
  camera.updateMatrixWorld();

  const bombGroup = new THREE.Group();
  const cols = 2;
  const rows = 2;
  const slotW = 1.08;
  const slotH = 1.08;
  const spacing = 0.13;
  const bodyDepth = 0.5;

  // Bomb casing body so empty-space drags hit casing outside modules
  const bodyMesh = new THREE.Mesh(
    new THREE.BoxGeometry(cols * slotW + 3 * spacing, rows * slotH + 3 * spacing + 0.18, bodyDepth),
    new THREE.MeshBasicMaterial()
  );
  bombGroup.add(bodyMesh);

  const moduleViews = new Map();
  clientModules.forEach((mod, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const startX = -((cols - 1) * (slotW + spacing)) / 2;
    const startY = ((rows - 1) * (slotH + spacing)) / 2;
    const posX = startX + col * (slotW + spacing);
    const posY = startY - row * (slotH + spacing);

    const slot = {
      width: slotW,
      height: slotH,
      depth: 0.1,
      position: { x: posX, y: posY, z: bodyDepth / 2 }
    };

    const group = mod.build(THREE, slot, role);
    group.position.set(posX, posY, bodyDepth / 2);
    group.userData.moduleId = mod.id;
    bombGroup.add(group);
    moduleViews.set(mod.id, { moduleDef: mod, group });
  });

  scene.add(bombGroup);
  scene.updateMatrixWorld(true);

  let currentTimeMs = 1000;
  let timerRemainingSec = 247; // last digit = 7
  let currentRole = role;
  let state = initialState || {
    status: 'running',
    modules: {
      button: { solved: false },
      wires: { solved: false, cutWires: [] },
      keypad: { solved: false, enteredSlots: [] },
      beacon: { solved: false, tunedChannel: 1 } // Note: no `beats` array here so beacon audio setInterval isn't started in headless tests
    }
  };

  for (const [modId, modInfo] of moduleViews.entries()) {
    if (state.modules[modId]) {
      modInfo.moduleDef.update(modInfo.group, currentRole, state.modules[modId]);
    }
  }
  scene.updateMatrixWorld(true);

  const raycaster = new THREE.Raycaster();
  const mouseVec = new THREE.Vector2();

  function raycastAt(clientX, clientY) {
    scene.updateMatrixWorld(true);
    mouseVec.x = (clientX / viewportWidth) * 2 - 1;
    mouseVec.y = -(clientY / viewportHeight) * 2 + 1;
    raycaster.setFromCamera(mouseVec, camera);
    const hits = raycaster.intersectObjects(bombGroup.children, true);
    return hits.length > 0 ? hits[0] : null;
  }

  function resolveHitModule(obj) {
    let curr = obj;
    while (curr && curr !== bombGroup) {
      if (curr.userData?.moduleId) {
        return moduleViews.get(curr.userData.moduleId);
      }
      curr = curr.parent;
    }
    return null;
  }

  // Projects any 3D object's world center into screen pixel coordinates (clientX, clientY)
  function projectObjectToClientCoords(object3d) {
    scene.updateMatrixWorld(true);
    const worldPos = new THREE.Vector3();
    object3d.getWorldPosition(worldPos);
    worldPos.project(camera);
    return {
      x: ((worldPos.x + 1) * 0.5) * viewportWidth,
      y: ((-worldPos.y + 1) * 0.5) * viewportHeight
    };
  }

  const sentActions = [];
  const statusHistory = [];
  const feedbackEvents = [];
  let cameraRotX = 0;
  let cameraRotY = 0;
  let cameraZoomDelta = 0;

  const controller = new BombInteractionController({
    getRole: () => currentRole,
    getState: () => state,
    getTimerRemaining: () => timerRemainingSec,
    raycastAt,
    resolveHitModule,
    now: () => currentTimeMs,
    onSendAction: (payload) => sentActions.push(payload),
    onCameraRotate: (dx, dy) => {
      cameraRotY += dx * 0.008;
      cameraRotX += dy * 0.008;
    },
    onCameraZoom: (delta) => {
      cameraZoomDelta += delta;
    },
    onStatusChange: (st) => statusHistory.push({ ...st }),
    onFeedback: (type, desc) => feedbackEvents.push({ type, controlId: desc?.controlId })
  });

  return {
    scene,
    camera,
    bombGroup,
    moduleViews,
    controller,
    sentActions,
    statusHistory,
    feedbackEvents,
    getCameraRotation: () => ({ rotX: cameraRotX, rotY: cameraRotY, zoomDelta: cameraZoomDelta }),
    advanceTime(ms) {
      currentTimeMs += ms;
      controller.tick(currentTimeMs);
      return currentTimeMs;
    },
    setTimerRemaining(sec) {
      timerRemainingSec = sec;
    },
    setRole(nextRole) {
      currentRole = nextRole;
    },
    setState(nextState) {
      state = nextState;
    },
    projectObjectToClientCoords,
    raycastAt
  };
}

describe('Operator 3D Bomb Touch Reliability, Lifecycle & Server Validation', () => {
  describe('1. Responsive Framing & Reachability Across Portrait and Landscape Layouts', () => {
    for (const layout of [
      { name: 'Android Portrait (360x640)', width: 360, height: 640 },
      { name: 'Mobile Landscape (844x390)', width: 844, height: 390 },
      { name: 'Tablet / Desktop (1024x768)', width: 1024, height: 768 }
    ]) {
      test(`All interactive 3D controls are unclipped and directly raycastable without zooming in ${layout.name}`, () => {
        const rig = createProduction3DTestRig({
          viewportWidth: layout.width,
          viewportHeight: layout.height
        });

        // 1. Button plunger
        const btnMesh = rig.moduleViews.get('button').group.userData.btnMesh;
        const btnPt = rig.projectObjectToClientCoords(btnMesh);
        assert.ok(btnPt.x > 16 && btnPt.x < layout.width - 16, 'Button X inside viewport');
        assert.ok(btnPt.y > 16 && btnPt.y < layout.height - 16, 'Button Y inside viewport');
        assert.equal(rig.controller.inspectHit(btnPt.x, btnPt.y)?.descriptor?.controlId, 'plunger');

        // 2. All 4 Wires have distinct, non-overlapping hitboxes and Operator 1-4 badges
        const wireMeshes = rig.moduleViews.get('wires').group.userData.wireMeshes;
        assert.equal(wireMeshes.length, 4);
        wireMeshes.forEach((w, idx) => {
          assert.equal(w.labelMesh.visible, true, `Operator non-color badge ${idx + 1} visible`);
          const pt = rig.projectObjectToClientCoords(w.intactMesh);
          const inspected = rig.controller.inspectHit(pt.x, pt.y);
          assert.equal(inspected?.descriptor?.wireIndex, idx, `Wire ${idx + 1} hit cleanly without overlap`);
        });

        // 3. All 4 Keypad numbered keys (1..4 <-> slotIndex 0..3)
        const keyData = rig.moduleViews.get('keypad').group.userData.keyData;
        assert.equal(keyData.length, 4);
        keyData.forEach((k, idx) => {
          assert.equal(k.displayNumber, idx + 1);
          const pt = rig.projectObjectToClientCoords(k.keyMesh);
          const inspected = rig.controller.inspectHit(pt.x, pt.y);
          assert.equal(inspected?.descriptor?.slotIndex, idx);
          assert.equal(inspected?.descriptor?.displayNumber, idx + 1);
        });

        // 4. Beacon Knob, Channels 1-3, and TX button
        const beaconUD = rig.moduleViews.get('beacon').group.userData;
        const knobPt = rig.projectObjectToClientCoords(beaconUD.knobGroup);
        assert.equal(rig.controller.inspectHit(knobPt.x, knobPt.y)?.descriptor?.controlId, 'knob');

        beaconUD.channelItems.forEach((chItem) => {
          const chPt = rig.projectObjectToClientCoords(chItem.notchMesh);
          assert.equal(
            rig.controller.inspectHit(chPt.x, chPt.y)?.descriptor?.controlId,
            `channel-${chItem.channel}`
          );
        });

        const txPt = rig.projectObjectToClientCoords(beaconUD.txBaseMesh);
        assert.equal(rig.controller.inspectHit(txPt.x, txPt.y)?.descriptor?.controlId, 'tx');
      });
    }
  });

  describe('2. Full Pointer Lifecycle Interruptions Leave Valid State & Zero False Actions', () => {
    test('pointercancel mid-press on Button, Wire, and Keypad emits zero actions and restores 3D meshes', () => {
      const rig = createProduction3DTestRig();
      const btnUD = rig.moduleViews.get('button').group.userData;
      const btnPt = rig.projectObjectToClientCoords(btnUD.btnMesh);

      rig.controller.onPointerDown({ pointerId: 11, clientX: btnPt.x, clientY: btnPt.y });
      assert.ok(btnUD.btnMesh.position.z < btnUD.defaultBtnZ, 'Button visually depresses on pointerdown');
      assert.equal(btnUD.progressRing.visible, true, 'Progress arc visible during press');

      rig.advanceTime(450); // Even after crossing Hold threshold!
      assert.equal(rig.controller.currentStatus.mode, 'hold');

      rig.controller.onPointerCancel({ pointerId: 11 });
      assert.equal(rig.sentActions.length, 0, 'Cancelled hold must NEVER emit press or release');
      assert.equal(btnUD.btnMesh.position.z, btnUD.defaultBtnZ, 'Plunger restored to resting Z');
      assert.equal(btnUD.progressRing.visible, false, 'Progress ring hidden on cancel');
      assert.equal(rig.controller.currentStatus.mode, 'cancelled');

      // Subsequent stray pointerup for cancelled pointerId is a no-op
      rig.controller.onPointerUp({ pointerId: 11, clientX: btnPt.x, clientY: btnPt.y });
      assert.equal(rig.sentActions.length, 0);
    });

    test('lostpointercapture mid-hold cancels safely, while normal post-pointerup lostpointercapture preserves commit', () => {
      const rig = createProduction3DTestRig();
      const wire0 = rig.moduleViews.get('wires').group.userData.wireMeshes[0];
      const wirePt = rig.projectObjectToClientCoords(wire0.intactMesh);

      // Case A: Unexpected lostpointercapture at 250ms while holding wire
      rig.controller.onPointerDown({ pointerId: 21, clientX: wirePt.x, clientY: wirePt.y });
      rig.advanceTime(250);
      assert.equal(wire0.progressMesh.visible, true);

      rig.controller.onLostPointerCapture({ pointerId: 21 });
      assert.equal(rig.sentActions.length, 0, 'Lost capture cancelled wire hold safely');
      assert.equal(wire0.progressMesh.visible, false);

      // Case B: Normal tap on Keypad Key 1 followed by browser synthetic lostpointercapture
      const key0 = rig.moduleViews.get('keypad').group.userData.keyData[0];
      const keyPt = rig.projectObjectToClientCoords(key0.keyMesh);
      rig.controller.onPointerDown({ pointerId: 22, clientX: keyPt.x, clientY: keyPt.y });
      rig.advanceTime(60);
      rig.controller.onPointerUp({ pointerId: 22, clientX: keyPt.x, clientY: keyPt.y });
      rig.controller.onLostPointerCapture({ pointerId: 22 });

      assert.equal(rig.sentActions.length, 1, 'Valid tap committed once');
      assert.deepEqual(rig.sentActions[0], {
        moduleId: 'keypad',
        action: 'press',
        data: { slotIndex: 0 }
      });
      assert.equal(rig.controller.currentStatus.mode, 'committed', 'Committed HUD status preserved');
    });

    test('window blur, document visibilitychange, orientationchange, and 2-finger pinch interrupt cancel active holds safely', () => {
      const rig = createProduction3DTestRig();
      const btnPt = rig.projectObjectToClientCoords(rig.moduleViews.get('button').group.userData.btnMesh);

      // 1. Blur
      rig.controller.onPointerDown({ pointerId: 31, clientX: btnPt.x, clientY: btnPt.y });
      rig.advanceTime(200);
      rig.controller.onBlur();
      assert.equal(rig.sentActions.length, 0);
      assert.equal(rig.controller.activeGesture, null);

      // 2. Visibility hidden
      rig.controller.onPointerDown({ pointerId: 32, clientX: btnPt.x, clientY: btnPt.y });
      rig.advanceTime(500);
      rig.controller.onVisibilityChange(true);
      assert.equal(rig.sentActions.length, 0);
      assert.equal(rig.controller.activeGesture, null);

      // 3. Orientation change
      rig.controller.onPointerDown({ pointerId: 33, clientX: btnPt.x, clientY: btnPt.y });
      rig.advanceTime(150);
      rig.controller.onOrientationChange();
      assert.equal(rig.sentActions.length, 0);
      assert.equal(rig.controller.activeGesture, null);

      // 4. Second finger touches screen (pinch-to-zoom) while first finger is on a wire
      const wire2 = rig.moduleViews.get('wires').group.userData.wireMeshes[2];
      const wirePt = rig.projectObjectToClientCoords(wire2.intactMesh);
      rig.controller.onPointerDown({ pointerId: 40, clientX: wirePt.x, clientY: wirePt.y });
      rig.advanceTime(220);
      assert.equal(wire2.progressMesh.visible, true);

      rig.controller.onPointerDown({ pointerId: 41, clientX: wirePt.x + 80, clientY: wirePt.y + 80 });
      assert.equal(wire2.progressMesh.visible, false, '2nd finger immediately cancels wire cut');
      rig.advanceTime(400);
      assert.equal(rig.sentActions.length, 0, 'Pinch gesture never cuts wire');
    });
  });

  describe('3. Button Tap vs Hold Threshold Boundaries, Adjustable Threshold & Slide-Off Cancel', () => {
    test('Default 380ms threshold: 379ms commits press (Tap), 380ms enters HOLD and commits release with timer digit', () => {
      const rig = createProduction3DTestRig();
      rig.setTimerRemaining(184); // Last digit = 4
      const btnPt = rig.projectObjectToClientCoords(rig.moduleViews.get('button').group.userData.btnMesh);

      assert.equal(INTERACTION_DEFAULTS.buttonHoldThresholdMs, 380);

      // 379ms -> Tap ('press')
      rig.controller.onPointerDown({ pointerId: 1, clientX: btnPt.x, clientY: btnPt.y });
      assert.equal(rig.controller.currentStatus.mode, 'tap');
      rig.advanceTime(379);
      assert.equal(rig.controller.currentStatus.mode, 'tap', 'At 379ms still in explicit TAP state');
      rig.controller.onPointerUp({ pointerId: 1, clientX: btnPt.x, clientY: btnPt.y });

      assert.equal(rig.sentActions.length, 1);
      assert.deepEqual(rig.sentActions[0], { moduleId: 'button', action: 'press' });

      // 380ms -> Hold ('release' with digit 4)
      rig.advanceTime(50);
      rig.controller.onPointerDown({ pointerId: 2, clientX: btnPt.x, clientY: btnPt.y });
      rig.advanceTime(380);
      assert.equal(rig.controller.currentStatus.mode, 'hold', 'At 380ms transitions to explicit HOLD state');
      assert.ok(rig.feedbackEvents.some((f) => f.type === 'hold_start'), 'Fires hold_start feedback');

      rig.setTimerRemaining(189); // Operator waits until timer shows 9
      rig.advanceTime(100);
      rig.controller.onPointerUp({ pointerId: 2, clientX: btnPt.x, clientY: btnPt.y });

      assert.equal(rig.sentActions.length, 2);
      assert.deepEqual(rig.sentActions[1], {
        moduleId: 'button',
        action: 'release',
        data: { releaseDigit: 9 }
      });
    });

    test('Adjustable hold threshold (e.g. 540ms) shifts Tap/Hold boundary accurately', () => {
      const rig = createProduction3DTestRig();
      rig.controller.setHoldThreshold(540);
      assert.equal(rig.controller.getHoldThreshold(), 540);

      const btnPt = rig.projectObjectToClientCoords(rig.moduleViews.get('button').group.userData.btnMesh);

      // 460ms is now < 540ms -> Tap
      rig.controller.onPointerDown({ pointerId: 5, clientX: btnPt.x, clientY: btnPt.y });
      rig.advanceTime(460);
      rig.controller.onPointerUp({ pointerId: 5, clientX: btnPt.x, clientY: btnPt.y });
      assert.equal(rig.sentActions[0].action, 'press');

      // 540ms -> Hold release
      rig.advanceTime(50);
      rig.controller.onPointerDown({ pointerId: 6, clientX: btnPt.x, clientY: btnPt.y });
      rig.advanceTime(540);
      rig.controller.onPointerUp({ pointerId: 6, clientX: btnPt.x, clientY: btnPt.y });
      assert.equal(rig.sentActions[1].action, 'release');
    });

    test('Sliding pointer outside valid button region after Hold begins cancels safely without action', () => {
      const rig = createProduction3DTestRig();
      const btnPt = rig.projectObjectToClientCoords(rig.moduleViews.get('button').group.userData.btnMesh);

      rig.controller.onPointerDown({ pointerId: 8, clientX: btnPt.x, clientY: btnPt.y });
      rig.advanceTime(450); // Hold active
      assert.equal(rig.controller.currentStatus.mode, 'hold');

      // Slide finger far off button onto empty corner (clientX = 5, clientY = 5)
      rig.controller.onPointerMove({ pointerId: 8, clientX: 5, clientY: 5 });
      rig.controller.onPointerUp({ pointerId: 8, clientX: 5, clientY: 5 });

      assert.equal(rig.sentActions.length, 0, 'Sliding off button cancelled Hold safely');
    });
  });

  describe('4. Wire Cutting Intentional ~400ms Hold, Early Release Cancel & Camera Drag Separation', () => {
    test('Short tap (< 400ms) on wire cancels safely; holding >= 400ms cuts wire once with progress ring', () => {
      const rig = createProduction3DTestRig();
      const wire1 = rig.moduleViews.get('wires').group.userData.wireMeshes[1];
      const wirePt = rig.projectObjectToClientCoords(wire1.intactMesh);

      // 1. Short accidental tap (180ms) -> cancelled, 0 cuts!
      rig.controller.onPointerDown({ pointerId: 50, clientX: wirePt.x, clientY: wirePt.y });
      rig.advanceTime(180);
      assert.equal(wire1.progressMesh.visible, true, 'Progress ring shown during hold');
      rig.controller.onPointerUp({ pointerId: 50, clientX: wirePt.x, clientY: wirePt.y });

      assert.equal(rig.sentActions.length, 0, 'Accidental short tap on wire must NOT cut');
      assert.equal(wire1.progressMesh.visible, false);

      // 2. Boundary early release at 399ms -> still cancelled!
      rig.advanceTime(50);
      rig.controller.onPointerDown({ pointerId: 51, clientX: wirePt.x, clientY: wirePt.y });
      rig.advanceTime(399);
      rig.controller.onPointerUp({ pointerId: 51, clientX: wirePt.x, clientY: wirePt.y });
      assert.equal(rig.sentActions.length, 0, 'Release at 399ms (< 400ms) safely cancels');

      // 3. Intentional 400ms hold -> cuts wire 1 once, subsequent pointerup does not double-send
      rig.advanceTime(50);
      rig.controller.onPointerDown({ pointerId: 52, clientX: wirePt.x, clientY: wirePt.y });
      rig.advanceTime(400);
      assert.equal(rig.sentActions.length, 1);
      assert.deepEqual(rig.sentActions[0], {
        moduleId: 'wires',
        action: 'cut',
        data: { wireIndex: 1 }
      });

      rig.controller.onPointerUp({ pointerId: 52, clientX: wirePt.x, clientY: wirePt.y });
      assert.equal(rig.sentActions.length, 1, 'PointerUp after hold-commit does not duplicate cut');
    });

    test('Camera drag starting on a wire (> 12px movement) rotates camera and never cuts the wire', () => {
      const rig = createProduction3DTestRig();
      const wire2 = rig.moduleViews.get('wires').group.userData.wireMeshes[2];
      const wirePt = rig.projectObjectToClientCoords(wire2.intactMesh);

      rig.controller.onPointerDown({ pointerId: 60, clientX: wirePt.x, clientY: wirePt.y });
      rig.advanceTime(80);
      // Drag horizontally 30px (> 12px dragSlopPx) to rotate camera
      rig.controller.onPointerMove({ pointerId: 60, clientX: wirePt.x + 30, clientY: wirePt.y });
      rig.controller.onPointerMove({ pointerId: 60, clientX: wirePt.x + 70, clientY: wirePt.y });
      rig.advanceTime(500);
      rig.controller.onPointerUp({ pointerId: 60, clientX: wirePt.x + 70, clientY: wirePt.y });

      assert.equal(rig.sentActions.length, 0, 'Camera drag must never cut wire');
      assert.ok(Math.abs(rig.getCameraRotation().rotY) > 0.1, 'Camera rotated smoothly');
    });
  });

  describe('5. Keypad Double-Submission Prevention & Single-Pointer Multi-Key Protection', () => {
    test('Double-tap bounce within 320ms on same key submits once; distinct keys submit immediately', () => {
      const rig = createProduction3DTestRig();
      const keys = rig.moduleViews.get('keypad').group.userData.keyData;
      const ptKey1 = rig.projectObjectToClientCoords(keys[0].keyMesh);
      const ptKey2 = rig.projectObjectToClientCoords(keys[1].keyMesh);

      // First press on Key 1 (slotIndex: 0)
      rig.controller.onPointerDown({ pointerId: 70, clientX: ptKey1.x, clientY: ptKey1.y });
      rig.advanceTime(40);
      rig.controller.onPointerUp({ pointerId: 70, clientX: ptKey1.x, clientY: ptKey1.y });
      assert.equal(rig.sentActions.length, 1);

      // Accidental immediate bounce on Key 1 80ms later (before state_update returns) -> blocked!
      rig.advanceTime(80);
      rig.controller.onPointerDown({ pointerId: 71, clientX: ptKey1.x, clientY: ptKey1.y });
      rig.advanceTime(30);
      rig.controller.onPointerUp({ pointerId: 71, clientX: ptKey1.x, clientY: ptKey1.y });
      assert.equal(rig.sentActions.length, 1, 'Accidental double-tap on same keypad button suppressed');

      // Immediate intentional press on Key 2 (slotIndex: 1) 40ms later -> allowed!
      rig.advanceTime(40);
      rig.controller.onPointerDown({ pointerId: 72, clientX: ptKey2.x, clientY: ptKey2.y });
      rig.advanceTime(35);
      rig.controller.onPointerUp({ pointerId: 72, clientX: ptKey2.x, clientY: ptKey2.y });
      assert.equal(rig.sentActions.length, 2, 'Distinct keypad button allowed without artificial delay');
      assert.equal(rig.sentActions[1].data.slotIndex, 1);
    });

    test('Sweeping one pointer from Key 1 onto Key 2 cancels safely and triggers zero keypad actions', () => {
      const rig = createProduction3DTestRig();
      const keys = rig.moduleViews.get('keypad').group.userData.keyData;
      const ptKey1 = rig.projectObjectToClientCoords(keys[0].keyMesh);
      const ptKey2 = rig.projectObjectToClientCoords(keys[1].keyMesh);

      rig.controller.onPointerDown({ pointerId: 80, clientX: ptKey1.x, clientY: ptKey1.y });
      rig.advanceTime(40);
      rig.controller.onPointerMove({ pointerId: 80, clientX: ptKey2.x, clientY: ptKey2.y });
      rig.controller.onPointerUp({ pointerId: 80, clientX: ptKey2.x, clientY: ptKey2.y });

      assert.equal(rig.sentActions.length, 0, 'Sweeping across keys must not trigger either key');
    });

    test('Observer role touching any 3D control rotates camera and never dispatches Operator actions', () => {
      const rig = createProduction3DTestRig({ role: 'observer' });
      const btnPt = rig.projectObjectToClientCoords(rig.moduleViews.get('button').group.userData.btnMesh);

      rig.controller.onPointerDown({ pointerId: 90, clientX: btnPt.x, clientY: btnPt.y });
      rig.controller.onPointerMove({ pointerId: 90, clientX: btnPt.x + 25, clientY: btnPt.y });
      rig.controller.onPointerUp({ pointerId: 90, clientX: btnPt.x + 25, clientY: btnPt.y });

      assert.equal(rig.sentActions.length, 0);
      assert.ok(rig.getCameraRotation().rotY > 0);
    });
  });

  describe('6. Mobile Viewport, Scoped Touch-Action & Accessibility Audit', () => {
    test('HTML & CSS preserve accessibility zoom outside 3D surface, focus indicators, and live status ARIA', () => {
      const html = fs.readFileSync(path.join(ROOT_DIR, 'public/index.html'), 'utf8');
      const css = fs.readFileSync(path.join(ROOT_DIR, 'public/style.css'), 'utf8');

      // 1. Viewport does not lock out accessibility pinch-zoom on Manual/Lobby pages
      assert.ok(!html.includes('user-scalable=no'), 'Viewport meta must not disable user-scalable globally');
      assert.ok(!html.includes('maximum-scale=1.0'), 'Viewport meta must not lock maximum-scale=1.0');

      // 2. Live Operator HUD has ARIA status + Hold threshold control exists
      assert.ok(html.includes('id="operatorInteractionHud"') && html.includes('aria-live="polite"'));
      assert.ok(html.includes('id="holdThresholdSlider"'));

      // 3. CSS scopes touch-action: none to 3D container, preserves focus-visible & reduced-motion
      assert.ok(css.includes('touch-action: none;'), 'Active 3D surface disables browser scroll/zoom');
      assert.ok(css.includes(':focus-visible'), 'Visible keyboard focus outlines defined');
      assert.ok(css.includes('prefers-reduced-motion: reduce'), 'Reduced-motion media query supported');

      // Global * selector must not block text selection on rulebook/seed
      const starRuleMatch = css.match(/\*\s*\{([^}]*)\}/);
      assert.ok(starRuleMatch && !starRuleMatch[1].includes('user-select: none'), 'Global * must not disable user-select');
    });
  });

  describe('7. Server-Side Action Validation, Stale/Malformed Rejection & Two-Tier Rate Limiting', () => {
    let baseUrl;
    const openClients = [];

    function cleanRoom() {
      for (const c of openClients) {
        try {
          c.ws.terminate();
        } catch (e) {}
      }
      openClients.length = 0;
      sessions.clear();
      activeSockets.clear();
      for (const r of ROLES) {
        roles[r].playerId = null;
        roles[r].connected = false;
        roles[r].joinedAt = null;
      }
      resetGame(true);
    }

    before(async () => {
      cleanRoom();
      if (!server.listening) {
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      }
      const addr = server.address();
      baseUrl = `ws://127.0.0.1:${addr.port}`;
    });

    after(async () => {
      cleanRoom();
      server.unref();
    });

    function connectTestClient() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(baseUrl);
        const queue = [];
        const waiters = [];

        ws.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          const idx = waiters.findIndex((w) => w.pred(msg));
          if (idx !== -1) {
            const w = waiters.splice(idx, 1)[0];
            clearTimeout(w.timer);
            w.resolve(msg);
          } else {
            queue.push(msg);
          }
        });

        ws.on('open', () => {
          const client = {
            ws,
            send(obj) {
              ws.send(JSON.stringify(obj));
            },
            waitFor(pred, timeoutMs = 2000) {
              const foundIdx = queue.findIndex(pred);
              if (foundIdx !== -1) {
                return Promise.resolve(queue.splice(foundIdx, 1)[0]);
              }
              return new Promise((res, rej) => {
                const timer = setTimeout(() => rej(new Error('Timeout waiting for WS message')), timeoutMs);
                waiters.push({ pred, resolve: res, timer });
              });
            }
          };
          openClients.push(client);
          resolve(client);
        });
        ws.on('error', reject);
      });
    }

    test('validateBombActionPayload rejects out-of-range parameters and strips client correctness claims', () => {
      assert.equal(validateBombActionPayload('wires', 'cut', { wireIndex: -1 }).ok, false);
      assert.equal(validateBombActionPayload('wires', 'cut', { wireIndex: 4 }).ok, false);
      assert.equal(validateBombActionPayload('wires', 'cut', { wireIndex: '1' }).ok, false);
      assert.equal(validateBombActionPayload('keypad', 'press', { slotIndex: 4 }).ok, false);
      assert.equal(validateBombActionPayload('beacon', 'tune', { channel: 0 }).ok, false);
      assert.equal(validateBombActionPayload('beacon', 'tune', { channel: 4 }).ok, false);
      assert.equal(validateBombActionPayload('button', 'release', { releaseDigit: 10 }).ok, false);
      assert.equal(validateBombActionPayload('button', 'release', { releaseDigit: '5' }).ok, false);

      const clean = validateBombActionPayload('wires', 'cut', {
        wireIndex: 2,
        solved: true,
        correct: true,
        strike: false
      });
      assert.equal(clean.ok, true);
      assert.deepEqual(clean.sanitizedData, { wireIndex: 2 }, 'Client correctness claims stripped');
    });

    test('Server enforces Operator-only authority, valid phase, stale roundSeed rejection, malformed param rejection, and untrusted claim stripping', async () => {
      cleanRoom();
      const op = await connectTestClient();
      const obs = await connectTestClient();
      const man = await connectTestClient();

      op.send({ type: 'join', payload: { role: 'operator', playerId: 'srv_op_1' } });
      await op.waitFor((m) => m.type === 'role_assigned');
      obs.send({ type: 'join', payload: { role: 'observer', playerId: 'srv_obs_1' } });
      await obs.waitFor((m) => m.type === 'role_assigned');
      man.send({ type: 'join', payload: { role: 'manual', playerId: 'srv_man_1' } });
      await man.waitFor((m) => m.type === 'role_assigned');

      // 1. Action before start ('ready' phase) -> INVALID_PHASE, 0 strikes
      op.send({ type: 'action', payload: { moduleId: 'button', action: 'press' } });
      const phaseErr = await op.waitFor((m) => m.type === 'error');
      assert.equal(phaseErr.code, 'INVALID_PHASE');
      assert.equal(gameState.strikes, 0);

      // Start game in Easy mode (2 active modules: wires & button; keypad & beacon inactive)
      op.send({ type: 'set_difficulty', payload: { presetId: 'easy' } });
      await op.waitFor((m) => m.type === 'difficulty_changed');

      op.send({ type: 'start', payload: { seed: 'TOUCH_VERIFY_1' } });
      await op.waitFor((m) => m.type === 'game_started');

      // 2. Observer & Manual-holder unauthorized action attempts -> UNAUTHORIZED_ACTION
      obs.send({ type: 'action', payload: { moduleId: 'button', action: 'press' } });
      const obsErr = await obs.waitFor((m) => m.type === 'error');
      assert.equal(obsErr.code, 'UNAUTHORIZED_ACTION');

      man.send({ type: 'action', payload: { moduleId: 'wires', action: 'cut', data: { wireIndex: 0 } } });
      const manErr = await man.waitFor((m) => m.type === 'error');
      assert.equal(manErr.code, 'UNAUTHORIZED_ACTION');

      // 3. Stale roundSeed from a previous round -> STALE_ACTION, 0 strikes
      op.send({
        type: 'action',
        payload: {
          roundSeed: 'OLD_ROUND_SEED',
          moduleId: 'wires',
          action: 'cut',
          data: { wireIndex: 0 }
        }
      });
      const staleErr = await op.waitFor((m) => m.type === 'error');
      assert.equal(staleErr.code, 'STALE_ACTION');
      assert.equal(gameState.strikes, 0);

      // 4. Inactive module ('keypad' in 2-module Easy mode) & malformed wireIndex -> MALFORMED_ACTION, 0 strikes
      op.send({
        type: 'action',
        payload: { moduleId: 'keypad', action: 'press', data: { slotIndex: 0 } }
      });
      const inactiveErr = await op.waitFor((m) => m.type === 'error');
      assert.equal(inactiveErr.code, 'MALFORMED_ACTION');

      op.send({
        type: 'action',
        payload: { moduleId: 'wires', action: 'cut', data: { wireIndex: 99 } }
      });
      const paramErr = await op.waitFor((m) => m.type === 'error');
      assert.equal(paramErr.code, 'MALFORMED_ACTION');
      assert.equal(gameState.strikes, 0, 'Malformed actions never cause gameplay strikes');

      // 5. Client spoofing `{ solved: true, strike: false }` on a wrong wire -> Server ignores claim and records a real strike!
      const wrongWire = [0, 1, 2, 3].find((i) => i !== gameState.modules.wires.correctWireIndex);
      op.send({
        type: 'action',
        payload: {
          moduleId: 'wires',
          action: 'cut',
          data: { wireIndex: wrongWire, solved: true, strike: false, correct: true }
        }
      });
      await op.waitFor((m) => m.type === 'strike');
      assert.equal(gameState.strikes, 1, 'Server ignored client correctness claim and enforced authoritative rule');
      assert.equal(gameState.modules.wires.solved, false);
    });

    test('Two-tier rate limiter allows legitimate rapid distinct keypad presses while blocking abusive floods', async () => {
      cleanRoom();
      const op = await connectTestClient();
      const obs = await connectTestClient();
      const man = await connectTestClient();

      op.send({ type: 'join', payload: { role: 'operator', playerId: 'flood_op_1' } });
      await op.waitFor((m) => m.type === 'role_assigned');
      obs.send({ type: 'join', payload: { role: 'observer', playerId: 'flood_obs_1' } });
      await obs.waitFor((m) => m.type === 'role_assigned');
      man.send({ type: 'join', payload: { role: 'manual', playerId: 'flood_man_1' } });
      await man.waitFor((m) => m.type === 'role_assigned');

      // Normal mode includes keypad
      op.send({ type: 'set_difficulty', payload: { presetId: 'normal' } });
      await op.waitFor((m) => m.type === 'difficulty_changed');

      op.send({ type: 'start', payload: { seed: 'RAPID_KEYPAD_1' } });
      await op.waitFor((m) => m.type === 'game_started');

      // Determine exact 4-key correct order on server
      const kp = gameState.modules.keypad;
      const orderedSlots = kp.correctOrder.map((sym) => kp.symbols.indexOf(sym));

      // Legitimate rapid distinct keypad presses (20ms apart — faster than 70ms per-key bounce window!)
      for (const slotIdx of orderedSlots) {
        op.send({
          type: 'action',
          payload: { moduleId: 'keypad', action: 'press', data: { slotIndex: slotIdx } }
        });
        await new Promise((r) => setTimeout(r, 20));
      }

      await op.waitFor((m) => m.type === 'module_solved' && m.moduleId === 'keypad');
      assert.equal(gameState.modules.keypad.solved, true, 'Legitimate rapid 4-key sequence succeeded without suppression');

      // Now send an abusive flood of 12 actions in immediate succession -> rate-limited!
      for (let i = 0; i < 12; i++) {
        op.send({
          type: 'action',
          payload: {
            moduleId: 'button',
            action: i % 2 === 0 ? 'press' : 'release',
            data: i % 2 === 0 ? {} : { releaseDigit: i % 10 }
          }
        });
      }

      const rateErr = await op.waitFor((m) => m.type === 'error' && m.code === 'RATE_LIMITED');
      assert.equal(rateErr.code, 'RATE_LIMITED');
    });
  });
});
