process.env.NODE_ENV = 'test';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { buildSharedWorldGraph, disposeObjectSubtree } from '../public/world-graph.js';
import { SeatedCameraRig, computeFrameIndependentAlpha } from '../public/camera-rig.js';
import { applyAnisotropyToSubtree } from '../public/modules/canvas-utils.js';

describe('Three.js Engineering Guidelines — Color Space, Geometry Sharing, Ownership & Damping', () => {
  test('1. All procedural color CanvasTextures enforce SRGBColorSpace and dynamic canvases disable mipmap churn', () => {
    for (const role of ['operator', 'observer', 'manual']) {
      const world = buildSharedWorldGraph({ role, width: 390, height: 680 });
      try {
        const inspectedTextures = new Set();
        world.scene.traverse((obj) => {
          if (!obj.material) return;
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const mat of mats) {
            if (mat?.map?.isTexture) {
              inspectedTextures.add(mat.map);
              assert.equal(
                mat.map.colorSpace,
                THREE.SRGBColorSpace,
                `Role "${role}" mesh "${obj.name || obj.type}" map must use SRGBColorSpace`
              );
            }
          }
        });

        assert.ok(inspectedTextures.size >= 14, `Expected >= 14 procedural textures, found ${inspectedTextures.size}`);

        // Frequently redrawn canvases skip mipmap chain regeneration on mobile GPUs
        assert.equal(world.briefcaseRig.lidTimerTexture.generateMipmaps, false);
        assert.equal(world.briefcaseRig.lidTimerTexture.minFilter, THREE.LinearFilter);
        assert.equal(world.briefcaseRig.morseLampTexture.generateMipmaps, false);
        assert.equal(world.briefcaseRig.morseLampTexture.minFilter, THREE.LinearFilter);

        const btnUD = world.moduleViews.get('button').group.userData;
        assert.equal(btnUD.progressTexture.generateMipmaps, false);
        assert.equal(btnUD.labelTexture.generateMipmaps, true);

        const beaconUD = world.moduleViews.get('beacon').group.userData;
        assert.equal(beaconUD.txTex.generateMipmaps, false);
        for (const ch of beaconUD.channelItems) {
          assert.equal(ch.tex.generateMipmaps, true);
        }

        // Anisotropy propagation updates static/stateful mipmapped textures while leaving dynamic non-mipmapped textures untouched
        applyAnisotropyToSubtree(world.scene, 8);
        assert.equal(world.briefcaseRig.serialTexture.anisotropy, 8);
        assert.equal(btnUD.labelTexture.anisotropy, 8);
        assert.equal(world.briefcaseRig.lidTimerTexture.anisotropy, 1);
      } finally {
        world.dispose();
      }
    }
  });

  test('2. Repeated bomb module parts share immutable BufferGeometry and zero-fill-cost hitbox materials', () => {
    const world = buildSharedWorldGraph({ role: 'observer', width: 390, height: 680 });
    try {
      // Wires: all 4 intact wires, cut wire halves, and hitboxes share geometries; per-wire clue materials remain distinct
      const wiresUD = world.moduleViews.get('wires').group.userData;
      assert.equal(wiresUD.wireMeshes.length, 4);
      const firstWire = wiresUD.wireMeshes[0];
      for (let i = 1; i < wiresUD.wireMeshes.length; i++) {
        const w = wiresUD.wireMeshes[i];
        assert.equal(w.intactMesh.geometry, firstWire.intactMesh.geometry, 'Intact wire BufferGeometry is shared');
        assert.equal(w.leftCutMesh.geometry, firstWire.leftCutMesh.geometry, 'Left cut wire BufferGeometry is shared');
        assert.equal(w.rightCutMesh.geometry, firstWire.rightCutMesh.geometry, 'Right cut wire BufferGeometry is shared');
        assert.equal(w.hitBoxMesh.geometry, firstWire.hitBoxMesh.geometry, 'Wire hitbox BufferGeometry is shared');
        assert.equal(w.hitBoxMesh.material, firstWire.hitBoxMesh.material, 'Wire hitbox Material is shared');
        assert.notEqual(w.wireMat, firstWire.wireMat, 'Wire clue material remains independent per wire');
      }
      assert.equal(firstWire.hitBoxMesh.material.colorWrite, false);
      assert.equal(firstWire.hitBoxMesh.material.depthWrite, false);

      // Keypad: all 4 keys share keyBoxGeo, keyBoxMat, faceGeo, hitGeo, hitMat, and glowGeo
      const keypadUD = world.moduleViews.get('keypad').group.userData;
      assert.equal(keypadUD.keyData.length, 4);
      const firstKey = keypadUD.keyData[0];
      for (let i = 1; i < keypadUD.keyData.length; i++) {
        const k = keypadUD.keyData[i];
        assert.equal(k.keyMesh.geometry, firstKey.keyMesh.geometry, 'Keypad key box BufferGeometry is shared');
        assert.equal(k.keyMesh.material, firstKey.keyMesh.material, 'Keypad key box Material is shared');
        assert.equal(k.faceMesh.geometry, firstKey.faceMesh.geometry, 'Keypad face PlaneGeometry is shared');
        assert.equal(k.hitMesh.geometry, firstKey.hitMesh.geometry, 'Keypad hitbox BufferGeometry is shared');
        assert.equal(k.hitMesh.material, firstKey.hitMesh.material, 'Keypad hitbox Material is shared');
        assert.equal(k.glowMesh.geometry, firstKey.glowMesh.geometry, 'Keypad glow PlaneGeometry is shared');
        assert.notEqual(k.faceMesh.material, firstKey.faceMesh.material, 'Keypad face material remains independent per key');
      }

      // Beacon: all 3 Braille/notch slots share notchGeo, notchHitGeo, and sharedHitMat across knob/notches/TX
      const beaconUD = world.moduleViews.get('beacon').group.userData;
      assert.equal(beaconUD.channelItems.length, 3);
      const firstSlot = beaconUD.channelItems[0];
      for (let i = 1; i < beaconUD.channelItems.length; i++) {
        const slot = beaconUD.channelItems[i];
        assert.equal(slot.notchMesh.geometry, firstSlot.notchMesh.geometry, 'Beacon notch PlaneGeometry is shared');
        assert.equal(slot.notchHitMesh.geometry, firstSlot.notchHitMesh.geometry, 'Beacon notch hitbox BufferGeometry is shared');
        assert.equal(slot.notchHitMesh.material, beaconUD.knobHitMesh.material, 'Beacon hitboxes share one material');
      }
      assert.equal(beaconUD.txHitMesh.material, beaconUD.knobHitMesh.material);

      // Avatars: all 3 left hands share leftGloveGeo, all 3 right hands share rightGloveGeo, and all 6 share cuffCapGeo
      const leftHands = world.avatars.hands.filter((h) => h.userData.handSide === 'left');
      const rightHands = world.avatars.hands.filter((h) => h.userData.handSide === 'right');
      assert.equal(leftHands[0].userData.gloveMesh.geometry, leftHands[1].userData.gloveMesh.geometry);
      assert.equal(leftHands[0].userData.gloveMesh.geometry, leftHands[2].userData.gloveMesh.geometry);
      assert.equal(rightHands[0].userData.gloveMesh.geometry, rightHands[1].userData.gloveMesh.geometry);
      assert.equal(rightHands[0].userData.gloveMesh.geometry, rightHands[2].userData.gloveMesh.geometry);
      assert.equal(
        leftHands[0].userData.cuffCapMesh.geometry,
        rightHands[0].userData.cuffCapMesh.geometry,
        'All 6 wrist seal caps share one CylinderGeometry'
      );

      // Verify total unique scene BufferGeometry count (including prebuilt tactile EdgesGeometry) stays well within mobile budget (<= 200)
      const uniqueGeos = new Set();
      world.scene.traverse((obj) => {
        if (obj.geometry) uniqueGeos.add(obj.geometry);
      });
      assert.ok(uniqueGeos.size <= 140, `Expected compact unique BufferGeometry count <= 140 (mobile ceiling 200), got ${uniqueGeos.size}`);
    } finally {
      world.dispose();
    }
  });

  test('3. Shared styleManager materials survive rebuildModules()/setRole() without premature disposal while owned textures dispose cleanly', () => {
    const world = buildSharedWorldGraph({ role: 'operator', width: 390, height: 680 });
    const sharedLineMat = world.styleManager.linePrimaryMat;
    let sharedLineDisposeCount = 0;
    const origSharedDispose = sharedLineMat.dispose.bind(sharedLineMat);
    sharedLineMat.dispose = () => {
      sharedLineDisposeCount++;
      origSharedDispose();
    };

    // Role transitions trigger clearModules() -> disposeObjectSubtree() on Operator edge LineSegments
    world.setRole('observer', { immediate: true });
    world.setRole('operator', { immediate: true });
    world.rebuildModules('operator');

    assert.equal(
      sharedLineDisposeCount,
      0,
      'Shared WorldVisualStyleManager.linePrimaryMat must NOT be disposed during module rebuilds'
    );

    // Secondary texture maps (e.g. emissiveMap, alphaMap) on unshared subtree materials are disposed properly
    const customTexA = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    const customTexB = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    let disposedA = 0;
    let disposedB = 0;
    customTexA.dispose = () => { disposedA++; };
    customTexB.dispose = () => { disposedB++; };

    const customMat = new THREE.MeshStandardMaterial({ map: customTexA, alphaMap: customTexB });
    const customMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), customMat);
    disposeObjectSubtree(customMesh, world.styleManager.disposables);
    assert.equal(disposedA, 1, 'Primary map disposed');
    assert.equal(disposedB, 1, 'Secondary alphaMap disposed');

    // Full world teardown disposes shared materials exactly once
    world.dispose();
    assert.equal(sharedLineDisposeCount, 1, 'Shared linePrimaryMat is disposed on full world.dispose()');
  });

  test('4. SeatedCameraRig exponential damping converges identically across 30Hz, 60Hz, and 120Hz frame rates', () => {
    const runSimulation = (hz, totalSeconds = 0.2) => {
      const cam = new THREE.PerspectiveCamera(45, 390 / 680, 0.08, 8.0);
      const rig = new SeatedCameraRig(cam, 'operator', 390, 680);
      rig.rotateHeadByRadians(0.28, -0.18, { immediate: false });
      rig.zoomByFovDelta(-12, { immediate: false });

      const steps = Math.round(hz * totalSeconds);
      const dt = 1 / hz;
      for (let i = 0; i < steps; i++) {
        rig.update(0.18, dt);
      }
      return {
        yaw: rig.currentYawOffset,
        pitch: rig.currentPitchOffset,
        fov: rig.currentFov
      };
    };

    const at30Hz = runSimulation(30);
    const at60Hz = runSimulation(60);
    const at120Hz = runSimulation(120);

    assert.ok(Math.abs(at30Hz.yaw - at60Hz.yaw) < 1e-6, `30Hz vs 60Hz yaw mismatch: ${at30Hz.yaw} vs ${at60Hz.yaw}`);
    assert.ok(Math.abs(at120Hz.yaw - at60Hz.yaw) < 1e-6, `120Hz vs 60Hz yaw mismatch: ${at120Hz.yaw} vs ${at60Hz.yaw}`);
    assert.ok(Math.abs(at30Hz.pitch - at60Hz.pitch) < 1e-6, '30Hz vs 60Hz pitch matches');
    assert.ok(Math.abs(at120Hz.fov - at60Hz.fov) < 1e-5, '120Hz vs 60Hz optical FOV matches');

    // Large tab-resume delta (e.g. 4.5s) clamps safely to <= 0.1s without overshooting
    const clampedAlpha = computeFrameIndependentAlpha(0.18, 4.5);
    const maxExpectedAlpha = computeFrameIndependentAlpha(0.18, 0.1);
    assert.ok(Math.abs(clampedAlpha - maxExpectedAlpha) < 1e-9);
  });
});
