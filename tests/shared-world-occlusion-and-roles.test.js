process.env.NODE_ENV = 'test';
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  BRIEFCASE_SPEC,
  buildSharedWorldGraph
} from '../public/bomb3d.js';
import {
  WORLD_LAYERS,
  CAMERA_FOV_LIMITS,
  SEATED_CAMERA_CONFIGS
} from '../public/camera-rig.js';
import { TACTILE_PALETTE } from '../public/tactile-styler.js';
import { BombInteractionController } from '../public/interaction-controller.js';
import {
  server,
  gameState,
  roles,
  ROLES,
  startGame,
  resetGame,
  getFilteredStateForRole,
  sanitizeDifficultyConfig
} from '../server.js';

function approxEqual(actual, expected, tol = 0.004, msg = '') {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${msg ? msg + ': ' : ''}expected ${actual.toFixed(5)} to be within ±${tol} of ${expected.toFixed(5)}`
  );
}

function isMonochromeHex(hex) {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  // Neutral grayscale / zinc tones have max RGB channel spread <= 14
  return Math.max(r, g, b) - Math.min(r, g, b) <= 14;
}

describe('Shared 3D Van World, Physical Occlusion, Seated Viewpoints & Tactile Style', () => {
  after(() => {
    gameState.difficulty = sanitizeDifficultyConfig('normal');
    resetGame(true);
    try {
      server.unref();
    } catch (e) {}
  });

  describe('1. Briefcase Coordinate System, Lid Hinge Geometry & Transform Invariance', () => {
    test('Briefcase rests flush on y=0.740m green tabletop and lid closed/mid/open world bounds match spec', () => {
      const world = buildSharedWorldGraph({ role: 'observer', width: 844, height: 390 });
      try {
        world.scene.updateMatrixWorld(true);

        // 1. Tabletop contact plane exact world y = 0.740m
        const tableBox = new THREE.Box3().setFromObject(world.vanEnv.tableTopMesh);
        approxEqual(tableBox.max.y, 0.74, 0.001, 'Tabletop contact plane y');
        approxEqual(world.briefcaseRig.rig.position.y, 0.74, 0.0005, 'Briefcase rig world y');

        // 2. LowerCaseBodyMesh world AABB: x ∈ [-0.280, +0.280], y ∈ [0.740, 0.820], z ∈ [-0.170, +0.250]
        const lowerBox = new THREE.Box3().setFromObject(world.briefcaseRig.lowerShellMesh);
        approxEqual(lowerBox.min.x, -0.28, 0.002, 'LowerCase min.x');
        approxEqual(lowerBox.max.x, 0.28, 0.002, 'LowerCase max.x');
        approxEqual(lowerBox.min.y, 0.74, 0.002, 'LowerCase min.y');
        approxEqual(lowerBox.max.y, 0.82, 0.002, 'LowerCase max.y');
        approxEqual(lowerBox.min.z, -0.17, 0.002, 'LowerCase min.z');
        approxEqual(lowerBox.max.z, 0.25, 0.002, 'LowerCase max.z');

        // Snapshot module & serial plate world matrices BEFORE lid rotation
        const snapshotMatrices = new Map();
        snapshotMatrices.set('moduleBayRoot', world.briefcaseRig.moduleBayRoot.matrixWorld.clone());
        snapshotMatrices.set('serialPlate', world.briefcaseRig.serialPlateMesh.matrixWorld.clone());
        for (const [modId, modInfo] of world.moduleViews.entries()) {
          snapshotMatrices.set(`mod_${modId}`, modInfo.group.matrixWorld.clone());
        }

        // 3. Closed lid (θ = 0°): lies flat on world y ∈ [0.820, 0.875], z ∈ [-0.170, +0.250]
        world.briefcaseRig.setLidAngle(0);
        world.scene.updateMatrixWorld(true);
        const closedLidBox = new THREE.Box3().setFromObject(world.briefcaseRig.upperLidMesh);
        approxEqual(closedLidBox.min.x, -0.28, 0.002, 'Closed lid min.x');
        approxEqual(closedLidBox.max.x, 0.28, 0.002, 'Closed lid max.x');
        approxEqual(closedLidBox.min.y, 0.82, 0.002, 'Closed lid min.y');
        approxEqual(closedLidBox.max.y, 0.875, 0.002, 'Closed lid max.y');
        approxEqual(closedLidBox.min.z, -0.17, 0.002, 'Closed lid min.z');
        approxEqual(closedLidBox.max.z, 0.25, 0.002, 'Closed lid max.z');

        // 4. Mid-open lid (θ = -45°): rises cleanly upward from the North (-Z) hinge
        world.briefcaseRig.setLidAngle(THREE.MathUtils.degToRad(-45));
        world.scene.updateMatrixWorld(true);
        const midLidBox = new THREE.Box3().setFromObject(world.briefcaseRig.upperLidMesh);
        assert.ok(midLidBox.max.y > 1.11 && midLidBox.max.y < 1.17, 'Mid-open lid rises above 1.11m');
        approxEqual(midLidBox.min.z, -0.209, 0.003, 'Mid-open lid hinge backswing z');

        // 5. Target open lid (θ = -95°): world AABB x ∈ [-0.280, +0.280], y ∈ [0.815, 1.238], z ∈ [-0.261, -0.170]
        world.briefcaseRig.setLidAngle(BRIEFCASE_SPEC.openAngleRad);
        world.scene.updateMatrixWorld(true);
        const openLidBox = new THREE.Box3().setFromObject(world.briefcaseRig.upperLidMesh);
        approxEqual(openLidBox.min.x, -0.28, 0.002, 'Open lid min.x');
        approxEqual(openLidBox.max.x, 0.28, 0.002, 'Open lid max.x');
        approxEqual(openLidBox.min.y, 0.8152, 0.003, 'Open lid min.y');
        approxEqual(openLidBox.max.y, 1.2384, 0.003, 'Open lid max.y');
        approxEqual(openLidBox.min.z, -0.2614, 0.003, 'Open lid min.z');
        approxEqual(openLidBox.max.z, -0.17, 0.003, 'Open lid max.z');

        // 6. Zero drift on ModuleBayRoot, all 4 modules, and ExteriorSerialPlate across lid animation
        const checkUnchanged = (key, currentMat) => {
          const ref = snapshotMatrices.get(key);
          for (let i = 0; i < 16; i++) {
            assert.equal(currentMat.elements[i], ref.elements[i], `${key} matrix element ${i} must be 100% invariant`);
          }
        };
        checkUnchanged('moduleBayRoot', world.briefcaseRig.moduleBayRoot.matrixWorld);
        checkUnchanged('serialPlate', world.briefcaseRig.serialPlateMesh.matrixWorld);
        for (const [modId, modInfo] of world.moduleViews.entries()) {
          checkUnchanged(`mod_${modId}`, modInfo.group.matrixWorld);
        }
      } finally {
        world.dispose();
      }
    });
  });

  describe('2. Seated Camera Fixed-Origin Lock, Head-Look Clamps, Optical FOV Zoom & Layer Isolation', () => {
    test('Camera position never translates under drag, zoom, resize, or presets across all 3 roles', () => {
      for (const roleKey of ['operator', 'observer', 'manual']) {
        const world = buildSharedWorldGraph({ role: roleKey, width: 390, height: 680 });
        try {
          const cfg = SEATED_CAMERA_CONFIGS[roleKey];
          const assertEyeLocked = (context) => {
            approxEqual(world.camera.position.x, cfg.eyePosition.x, 1e-6, `${roleKey} eye.x (${context})`);
            approxEqual(world.camera.position.y, cfg.eyePosition.y, 1e-6, `${roleKey} eye.y (${context})`);
            approxEqual(world.camera.position.z, cfg.eyePosition.z, 1e-6, `${roleKey} eye.z (${context})`);
          };

          assertEyeLocked('initial');

          // Extreme head-look attempts clamp strictly to yawClampDeg / pitchClampDeg
          world.cameraRig.rotateHeadByRadians(9.0, -9.0, { immediate: true });
          assertEyeLocked('max positive yaw / min pitch');
          approxEqual(
            THREE.MathUtils.radToDeg(world.cameraRig.currentYawOffset),
            cfg.yawClampDeg[1],
            1e-4,
            `${roleKey} max yaw clamp`
          );
          approxEqual(
            THREE.MathUtils.radToDeg(world.cameraRig.currentPitchOffset),
            cfg.pitchClampDeg[0],
            1e-4,
            `${roleKey} min pitch clamp`
          );

          world.cameraRig.rotateHeadByRadians(-18.0, 18.0, { immediate: true });
          assertEyeLocked('min yaw / max pitch');
          approxEqual(
            THREE.MathUtils.radToDeg(world.cameraRig.currentYawOffset),
            cfg.yawClampDeg[0],
            1e-4,
            `${roleKey} min yaw clamp`
          );
          approxEqual(
            THREE.MathUtils.radToDeg(world.cameraRig.currentPitchOffset),
            cfg.pitchClampDeg[1],
            1e-4,
            `${roleKey} max pitch clamp`
          );

          // Extreme zoom attempts clamp strictly to optical FOV [26°, 58°] with zero camera translation
          world.cameraRig.zoomByFovDelta(-500, { immediate: true });
          assert.equal(world.camera.fov, CAMERA_FOV_LIMITS.minFov);
          assertEyeLocked('min FOV zoom');

          world.cameraRig.zoomByFovDelta(500, { immediate: true });
          assert.equal(world.camera.fov, CAMERA_FOV_LIMITS.maxFov);
          assertEyeLocked('max FOV zoom');

          // Preset switches & viewport resizes preserve eye lock
          world.cameraRig.setPreset('secondary', { immediate: true });
          assertEyeLocked('secondary preset');
          world.cameraRig.handleViewportResize(360, 640, { immediate: true });
          assertEyeLocked('portrait resize');
          world.cameraRig.resetView({ immediate: true });
          assertEyeLocked('resetView');

          // Layer isolation: local role hides own body layer and sees the other two teammates' body layers
          const ownLayer =
            roleKey === 'operator'
              ? WORLD_LAYERS.OPERATOR_BODY
              : roleKey === 'observer'
                ? WORLD_LAYERS.OBSERVER_BODY
                : WORLD_LAYERS.MANUAL_BODY;
          const testLayerObj = new THREE.Object3D();
          testLayerObj.layers.set(ownLayer);
          assert.equal(world.camera.layers.test(testLayerObj.layers), false, `${roleKey} hides own avatar body`);

          testLayerObj.layers.set(WORLD_LAYERS.OPERATOR_RETICLE);
          assert.equal(
            world.camera.layers.test(testLayerObj.layers),
            roleKey === 'operator',
            'Only Operator camera sees Layer 4 target reticle'
          );
        } finally {
          world.dispose();
        }
      }
    });
  });

  describe('3. Whole-Scene Multi-Point Sightline & Physical Occlusion Proofs', () => {
    const fullActiveState = {
      status: 'running',
      serialNumber: 'BN7X42',
      modules: {
        button: { solved: false, color: 'blue', label: 'نگه‌دار', holdStripColor: 'yellow' },
        wires: { solved: false, wires: ['red', 'blue', 'yellow', 'green'], cutWires: [] },
        keypad: { solved: false, symbols: ['Ω', '★', 'Ψ', 'Δ'], enteredSlots: [] },
        beacon: { solved: false, tunedChannel: 2 }
      }
    };

    test('Operator reaches and sees all 4 modules unclipped in 360x640 portrait and 844x390 landscape, and cannot see East serial plate', () => {
      for (const vp of [
        { w: 360, h: 640, label: '360x640 Portrait' },
        { w: 844, h: 390, label: '844x390 Landscape' }
      ]) {
        const world = buildSharedWorldGraph({ role: 'operator', width: vp.w, height: vp.h });
        try {
          world.updateState(fullActiveState);
          world.scene.updateMatrixWorld(true);

          // 1. ExteriorSerialPlate on East (+X) rim is 0% visible to Operator
          const serialSight = world.evaluateSurfaceSightline(world.briefcaseRig.serialPlateMesh, {
            requireInFrustum: true
          });
          assert.equal(serialSight.visibleCount, 0, `Operator must not see East serial plate in ${vp.label}`);

          // 2. All 4 modules have clear 5-point sightlines inside camera frustum
          const btnUD = world.moduleViews.get('button').group.userData;
          assert.equal(
            world.evaluateSurfaceSightline(btnUD.capMesh, { requireInFrustum: true }).visibleCount,
            5,
            `Button cap 5/5 visible in ${vp.label}`
          );

          const wiresUD = world.moduleViews.get('wires').group.userData;
          wiresUD.wireMeshes.forEach((w, idx) => {
            const res = world.evaluateSurfaceSightline(w.intactMesh, { requireInFrustum: true });
            assert.equal(res.visibleCount, 5, `Wire ${idx + 1} 5/5 visible in ${vp.label}`);
          });

          const keypadUD = world.moduleViews.get('keypad').group.userData;
          keypadUD.keyData.forEach((k, idx) => {
            const res = world.evaluateSurfaceSightline(k.faceMesh, { requireInFrustum: true });
            assert.equal(res.visibleCount, 5, `Keypad key ${idx + 1} 5/5 visible in ${vp.label}`);
          });

          const beaconUD = world.moduleViews.get('beacon').group.userData;
          assert.equal(
            world.evaluateSurfaceSightline(beaconUD.txFaceMesh, { requireInFrustum: true }).visibleCount,
            5,
            `Beacon TX 5/5 visible in ${vp.label}`
          );

          // 3. Verify touch raycast reachability through BombInteractionController on every control without zooming
          const controller = new BombInteractionController({
            getRole: () => 'operator',
            getState: () => fullActiveState,
            getTimerRemaining: () => 240,
            raycastAt: (cx, cy) => {
              const ndcX = (cx / vp.w) * 2 - 1;
              const ndcY = -(cy / vp.h) * 2 + 1;
              return world.raycastFromNdc(ndcX, ndcY);
            },
            resolveHitModule: (obj) => {
              let curr = obj;
              while (curr && curr !== world.briefcaseRig.moduleBayRoot) {
                if (curr.userData?.moduleId) return world.moduleViews.get(curr.userData.moduleId);
                curr = curr.parent;
              }
              return null;
            }
          });

          const projectToScreen = (obj) => {
            const p = new THREE.Vector3();
            obj.getWorldPosition(p);
            p.project(world.camera);
            return { x: ((p.x + 1) * 0.5) * vp.w, y: ((-p.y + 1) * 0.5) * vp.h };
          };

          const btnPt = projectToScreen(btnUD.capMesh);
          assert.equal(controller.inspectHit(btnPt.x, btnPt.y)?.descriptor?.controlId, 'plunger');

          wiresUD.wireMeshes.forEach((w, idx) => {
            const pt = projectToScreen(w.intactMesh);
            assert.equal(controller.inspectHit(pt.x, pt.y)?.descriptor?.wireIndex, idx);
          });

          keypadUD.keyData.forEach((k, idx) => {
            const pt = projectToScreen(k.faceMesh);
            assert.equal(controller.inspectHit(pt.x, pt.y)?.descriptor?.slotIndex, idx);
          });

          const knobPt = projectToScreen(beaconUD.knobMesh);
          assert.equal(controller.inspectHit(knobPt.x, knobPt.y)?.descriptor?.controlId, 'knob');

          const txPt = projectToScreen(beaconUD.txFaceMesh);
          assert.equal(controller.inspectHit(txPt.x, txPt.y)?.descriptor?.controlId, 'tx');
        } finally {
          world.dispose();
        }
      }
    });

    test('Observer clearly sees lateral interior clues & East-rim serial plate, and is 100% blocked from Manual-holder 3D rulebook page', () => {
      const world = buildSharedWorldGraph({ role: 'observer', width: 390, height: 680 });
      try {
        world.updateState(fullActiveState);
        world.cameraRig.setPreset('clues', { immediate: true });
        world.scene.updateMatrixWorld(true);

        // 1. Lateral clue surfaces in default 'clues' preset
        const btnUD = world.moduleViews.get('button').group.userData;
        const capSight = world.evaluateSurfaceSightline(btnUD.capMesh, { requireInFrustum: true });
        const bodySight = world.evaluateSurfaceSightline(btnUD.btnMesh, { requireInFrustum: true });
        const stripSight = world.evaluateSurfaceSightline(btnUD.stripMesh, { requireInFrustum: true });

        assert.equal(capSight.visibleCount, 5, 'Observer sees 5/5 button cap points');
        assert.ok(bodySight.visibleCount >= 4, 'Observer sees button colored body perimeter');
        assert.equal(
          stripSight.visibleCount,
          5,
          `Observer sees 5/5 button strip points without plunger self-occlusion (blockers: ${stripSight.blockers})`
        );

        const wiresUD = world.moduleViews.get('wires').group.userData;
        wiresUD.wireMeshes.forEach((w, idx) => {
          const wSight = world.evaluateSurfaceSightline(w.intactMesh, { requireInFrustum: true });
          assert.equal(wSight.visibleCount, 5, `Observer sees 5/5 points on wire ${idx + 1}`);
        });

        const keypadUD = world.moduleViews.get('keypad').group.userData;
        keypadUD.keyData.forEach((k, idx) => {
          const kSight = world.evaluateSurfaceSightline(k.faceMesh, { requireInFrustum: true });
          assert.equal(kSight.visibleCount, 5, `Observer sees 5/5 points on keypad symbol ${idx + 1}`);
        });

        // 2. Switch to 'serial' preset -> ExteriorSerialPlate is 5/5 visible and centered in frustum
        world.cameraRig.setPreset('serial', { immediate: true });
        const serialSight = world.evaluateSurfaceSightline(world.briefcaseRig.serialPlateMesh, {
          requireInFrustum: true
        });
        assert.equal(serialSight.visibleCount, 5, 'Observer sees 5/5 points on East-rim ExteriorSerialPlate');

        // 3. Manual-holder's 3D rulebook inner page is 0% visible to Observer across presets & head-look extremes
        for (const preset of ['clues', 'serial', 'bridge']) {
          world.cameraRig.setPreset(preset, { immediate: true });
          for (const yawDeg of [-34, 0, 34]) {
            world.cameraRig.targetYawOffset = THREE.MathUtils.degToRad(yawDeg);
            world.cameraRig.snapToTargets();
            const manualPageSight = world.evaluateSurfaceSightline(world.avatars.manualInnerPageMesh);
            assert.equal(
              manualPageSight.visibleCount,
              0,
              `Observer must see 0/5 points of ManualPropInnerPage in ${preset} yaw=${yawDeg}`
            );
            assert.ok(
              manualPageSight.blockers.includes('manual_cover'),
              `ManualPropBackCover ('manual_cover') must physically block Observer's ray (got ${manualPageSight.blockers})`
            );
          }
        }
      } finally {
        world.dispose();
      }
    });

    test('Manual-holder is 100% physically occluded by briefcase_lid across full 5x5 head-look grid AND ±0.04m eye perturbations', () => {
      const world = buildSharedWorldGraph({ role: 'manual', width: 390, height: 680 });
      try {
        world.updateState(fullActiveState);
        world.scene.updateMatrixWorld(true);

        // Manual-holder CAN see their own 3D manual prop inner page
        const ownManualSight = world.evaluateSurfaceSightline(world.avatars.manualInnerPageMesh);
        assert.equal(ownManualSight.visibleCount, 5, 'Manual-holder sees their own 3D manual inner page');

        // Collect every interior bomb clue/control surface + exterior serial plate
        const btnUD = world.moduleViews.get('button').group.userData;
        const wiresUD = world.moduleViews.get('wires').group.userData;
        const keypadUD = world.moduleViews.get('keypad').group.userData;
        const beaconUD = world.moduleViews.get('beacon').group.userData;

        const interiorSurfaces = [
          { name: 'button_cap', mesh: btnUD.capMesh },
          { name: 'button_body', mesh: btnUD.btnMesh },
          { name: 'button_strip', mesh: btnUD.stripMesh },
          ...wiresUD.wireMeshes.map((w, i) => ({ name: `wire_${i}`, mesh: w.intactMesh })),
          ...keypadUD.keyData.map((k, i) => ({ name: `keypad_${i}`, mesh: k.faceMesh })),
          { name: 'beacon_knob', mesh: beaconUD.knobMesh },
          { name: 'beacon_tx', mesh: beaconUD.txFaceMesh },
          ...beaconUD.channelItems.map((c) => ({ name: `beacon_ch_${c.channel}`, mesh: c.notchMesh }))
        ];

        // A. 5x5 Head-Look Yaw/Pitch Sweep across full [-28°..+28°] × [-22°..+16°] bounds
        const yawSteps = [-28, -14, 0, 14, 28];
        const pitchSteps = [-22, -12.5, -3, 6.5, 16];

        for (const yawDeg of yawSteps) {
          for (const pitchDeg of pitchSteps) {
            world.cameraRig.targetYawOffset = THREE.MathUtils.degToRad(yawDeg);
            world.cameraRig.targetPitchOffset = THREE.MathUtils.degToRad(pitchDeg);
            world.cameraRig.snapToTargets();

            for (const surf of interiorSurfaces) {
              const res = world.evaluateSurfaceSightline(surf.mesh);
              assert.equal(
                res.visibleCount,
                0,
                `Manual-holder must see 0 points on ${surf.name} at yaw=${yawDeg}, pitch=${pitchDeg}`
              );
              assert.ok(
                res.blockers.includes('briefcase_lid'),
                `briefcase_lid must occlude ${surf.name} for Manual-holder (got ${res.blockers})`
              );
            }

            const serialRes = world.evaluateSurfaceSightline(world.briefcaseRig.serialPlateMesh);
            assert.equal(serialRes.visibleCount, 0, 'Manual-holder must see 0 points on ExteriorSerialPlate');
          }
        }

        // B. 3x3 Eye-Origin Perturbation Grid (±0.04m X and Y) around (0.000, 1.160, -0.640)
        const baseEye = SEATED_CAMERA_CONFIGS.manual.eyePosition;
        for (const dx of [-0.04, 0, 0.04]) {
          for (const dy of [-0.04, 0, 0.04]) {
            const perturbedEye = new THREE.Vector3(baseEye.x + dx, baseEye.y + dy, baseEye.z);
            for (const surf of interiorSurfaces) {
              const res = world.evaluateSurfaceSightline(surf.mesh, { eyeOverride: perturbedEye });
              assert.equal(
                res.visibleCount,
                0,
                `Perturbed Manual-holder eye (${dx}, ${dy}) must still have 0 visibility on ${surf.name}`
              );
              assert.ok(res.blockers.includes('briefcase_lid'));
            }
          }
        }
      } finally {
        world.dispose();
      }
    });
  });

  describe('4. Role-Filtered Server Payloads Preserve Non-Secret Physical State Without Leaking Clues', () => {
    test('getFilteredStateForRole strips forbidden clues/secrets per role while preserving cutWires, enteredSlots & tunedChannel', () => {
      gameState.difficulty = sanitizeDifficultyConfig('hard');
      roles.blind.playerId = 'op_test';
      roles.blind.connected = true;
      roles.deaf.playerId = 'obs_test';
      roles.deaf.connected = true;
      roles.mute.playerId = 'man_test';
      roles.mute.connected = true;

      startGame('WORLD_SEC_SEED');
      // Simulate non-secret physical progress mid-round
      gameState.modules.wires.cutWires = [1];
      gameState.modules.keypad.enteredSlots = [2];
      gameState.modules.beacon.tunedChannel = 3;

      const opState = getFilteredStateForRole('blind');
      const obsState = getFilteredStateForRole('deaf');
      const manState = getFilteredStateForRole('mute');

      // 1. Operator: zero visual clues, serialNumber, or manual, but full physical state + audio beats
      assert.equal(opState.serialNumber, null);
      assert.equal(opState.roundManual ?? null, null);
      assert.equal(opState.modules.button.color, 'monochrome');
      assert.equal(opState.modules.button.label, 'دکمه');
      assert.equal(opState.modules.button.holdStripColor, 'monochrome');
      assert.equal(opState.modules.button.actionType, undefined);
      assert.equal(opState.modules.button.targetReleaseDigit, undefined);
      assert.equal(opState.modules.wires.wires, undefined);
      assert.equal(opState.modules.wires.correctWireIndex, undefined);
      assert.deepEqual(opState.modules.wires.cutWires, [1]);
      assert.equal(opState.modules.keypad.symbols, undefined);
      assert.equal(opState.modules.keypad.correctOrder, undefined);
      assert.deepEqual(opState.modules.keypad.enteredSlots, [2]);
      assert.equal(opState.modules.beacon.tunedChannel, 3);
      assert.ok(Array.isArray(opState.modules.beacon.beats));
      assert.equal(opState.modules.beacon.targetChannel, undefined);

      // 2. Observer: visual clues + serialNumber + physical state, zero audio beats, zero manual, zero server answers
      assert.ok(typeof obsState.serialNumber === 'string' && obsState.serialNumber.length > 0);
      assert.equal(obsState.roundManual ?? null, null);
      assert.ok(obsState.modules.button.color);
      assert.ok(Array.isArray(obsState.modules.wires.wires));
      assert.equal(obsState.modules.wires.correctWireIndex, undefined);
      assert.deepEqual(obsState.modules.wires.cutWires, [1]);
      assert.ok(Array.isArray(obsState.modules.keypad.symbols));
      assert.equal(obsState.modules.keypad.correctOrder, undefined);
      assert.deepEqual(obsState.modules.keypad.enteredSlots, [2]);
      assert.equal(obsState.modules.beacon.tunedChannel, 3);
      assert.equal(obsState.modules.beacon.beats, undefined);
      assert.equal(obsState.modules.beacon.targetChannel, undefined);

      // 3. Manual-holder: roundManual + solved flags only; zero serialNumber, zero clues, zero beats
      assert.equal(manState.serialNumber, null);
      assert.ok(manState.roundManual && manState.roundManual.wires);
      assert.equal(manState.modules.button.color, undefined);
      assert.equal(manState.modules.wires.wires, undefined);
      assert.equal(manState.modules.keypad.symbols, undefined);
      assert.equal(manState.modules.beacon.beats, undefined);

      for (const r of ROLES) {
        roles[r].playerId = null;
        roles[r].connected = false;
      }
      resetGame(true);
    });
  });

  describe('5. Operator Tactile Monochrome Pipeline, Red Target Reticle & Disposable Leak Prevention', () => {
    test('Operator mode enforces #050507 background, 0 active lights, strictly monochrome world/modules, and #ef4444 Layer-4 reticle', () => {
      const world = buildSharedWorldGraph({ role: 'operator', width: 390, height: 680 });
      try {
        world.updateState({
          status: 'running',
          serialNumber: null,
          modules: {
            button: { solved: false },
            wires: { solved: false, cutWires: [0] },
            keypad: { solved: false, enteredSlots: [1] },
            beacon: { solved: false, tunedChannel: 2 } // omit beats in headless test so audio timer doesn't start
          }
        });

        assert.equal(world.scene.background.getHex(), TACTILE_PALETTE.backgroundHex);
        assert.equal(world.lightingGroup.visible, false, 'Daylight lighting group disabled in Operator mode');
        assert.equal(world.vanEnv.skyBackdropGroup.visible, false, 'Sky backdrop hidden in Operator mode');
        assert.equal(world.vanEnv.contactShadowsGroup.visible, false, 'Contact shadows hidden in Operator mode');

        // Verify Pass-0 polygonOffset(2, 2) on registered world meshes & every visible mesh outside reticle is monochrome
        assert.equal(world.briefcaseRig.upperLidMesh.material.polygonOffset, true);
        assert.equal(world.briefcaseRig.upperLidMesh.material.polygonOffsetFactor, 2);

        world.scene.traverse((obj) => {
          if (!obj.visible) return;
          // Skip objects inside hidden ancestor groups (e.g. DaylightLightingGroup / SkyBackdrop)
          let anc = obj.parent;
          while (anc) {
            if (!anc.visible) return;
            anc = anc.parent;
          }
          if (obj.name === 'OperatorTargetReticle' || obj.parent?.name === 'OperatorTargetReticle') {
            return;
          }
          if ((obj.isMesh || obj.isLineSegments) && obj.material?.color && !obj.userData?.isTouchHitbox) {
            const hex = obj.material.color.getHex();
            // Textured meshes have white (0xffffff) base tint, which is monochrome
            assert.ok(
              isMonochromeHex(hex),
              `Operator visible object "${obj.name || obj.type}" must be strictly monochrome, got #${hex.toString(16).padStart(6, '0')}`
            );
          }
        });

        // Activate Operator Red Target Reticle on button plunger
        assert.equal(world.styleManager.reticleGroup.visible, false);
        world.showReticleForDescriptor({ moduleId: 'button', controlId: 'plunger' }, true);
        assert.equal(world.styleManager.reticleGroup.visible, true);

        const reticleChild = world.styleManager.reticleGroup.children[0];
        assert.equal(reticleChild.material.color.getHex(), TACTILE_PALETTE.reticleRedHex);

        const layerProbe = new THREE.Object3D();
        layerProbe.layers.set(WORLD_LAYERS.OPERATOR_RETICLE);
        assert.ok(reticleChild.layers.test(layerProbe.layers), 'Reticle lives on Layer 4');

        world.hideReticle();
        assert.equal(world.styleManager.reticleGroup.visible, false);
      } finally {
        world.dispose();
      }
    });

    test('10 rapid setRole() transitions accumulate zero leaked module geometries and dispose() cleans up deterministically', () => {
      const world = buildSharedWorldGraph({ role: 'operator', width: 390, height: 680 });
      const baselineDisposables = world.styleManager.disposables.size;
      const baselineModuleEdges = world.styleManager.moduleEdgeDisposables.size;
      assert.ok(baselineDisposables > 0);
      assert.ok(baselineModuleEdges > 0);

      const sequence = ['observer', 'manual', 'operator'];
      for (let cycle = 0; cycle < 10; cycle++) {
        for (const r of sequence) {
          world.setRole(r, { immediate: true });
        }
      }

      assert.equal(
        world.styleManager.disposables.size,
        baselineDisposables,
        'Shared static world disposables must not grow across role switches'
      );
      assert.equal(
        world.styleManager.moduleEdgeDisposables.size,
        baselineModuleEdges,
        'Operator module edge geometries must be disposed and recreated cleanly without accumulation'
      );
      assert.equal(world.moduleViews.size, 4);

      world.dispose();
      assert.equal(world.styleManager.disposables.size, 0);
      assert.equal(world.styleManager.moduleEdgeDisposables.size, 0);
      assert.equal(world.moduleViews.size, 0);
    });
  });
});
