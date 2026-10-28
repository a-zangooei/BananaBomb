/**
 * Headless Shared 3D Van World Graph & Sightline Occlusion Evaluator.
 *
 * Builds the complete, deterministic Shared 3D Van World scene graph without requiring
 * a browser DOM or WebGL context, enabling both live WebGL rendering (`bomb3d.js`) and
 * mathematical Node.js occlusion & sightline verification tests.
 */
import * as THREE from 'three';
import { clientModules } from './modules/index.js';
import { prefersReducedMotion } from './modules/canvas-utils.js';
import { SeatedCameraRig } from './camera-rig.js';
import { WorldVisualStyleManager } from './tactile-styler.js';
import {
  BRIEFCASE_SPEC,
  buildBriefcaseBombRig,
  computeOpticalMorseLampState,
  computeStrikeDisplayModel,
  drawLidTimerCanvas
} from './briefcase-rig.js';
import { buildVanEnvironment } from './van-environment.js';
import { buildWorldAvatars } from './world-avatars.js';
import {
  isOperatorRole,
  isObserverRole,
  isManualRole
} from '../shared/roles.js';

export {
  BRIEFCASE_SPEC,
  computeOpticalMorseLampState,
  computeStrikeDisplayModel,
  drawLidTimerCanvas,
  isOperatorRole,
  isObserverRole,
  isManualRole
};

/**
 * Checks if WebGL is available in the current browser environment.
 */
export function isWebGLAvailable() {
  try {
    if (typeof window === 'undefined' || typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    );
  } catch (e) {
    return false;
  }
}

function isHierarchyVisible(obj) {
  let curr = obj;
  while (curr) {
    if (curr.visible === false) return false;
    curr = curr.parent;
  }
  return true;
}

function resolveDescriptorTargetObject(moduleViews, descriptor) {
  if (!descriptor || !moduleViews) return null;
  const modInfo = moduleViews.get(descriptor.moduleId);
  if (!modInfo?.group?.userData) return null;
  const ud = modInfo.group.userData;

  if (descriptor.moduleId === 'button') {
    return ud.capMesh || ud.btnMesh || null;
  }
  if (descriptor.moduleId === 'wires') {
    const w = ud.wireMeshes?.[descriptor.wireIndex];
    return w?.intactMesh || null;
  }
  if (descriptor.moduleId === 'keypad') {
    const k = ud.keyData?.[descriptor.slotIndex];
    return k?.faceMesh || k?.keyMesh || null;
  }
  if (descriptor.moduleId === 'beacon') {
    if (descriptor.targetType === 'tx') return ud.txFaceMesh || ud.txBaseMesh || null;
    if (descriptor.targetType === 'knob') return ud.knobMesh || ud.knobGroup || null;
    if (descriptor.targetType === 'channel') {
      const ch = ud.channelItems?.find((c) => c.channel === descriptor.channel);
      return ch?.notchMesh || null;
    }
  }
  return null;
}

/**
 * Computes 5 representative local-space sample points on a clue or control surface
 * so sightline tests prove real surface visibility rather than single-center luck.
 */
function computeSurfaceSamplePointsWorld(targetMesh, eyeWorldPos) {
  targetMesh.updateWorldMatrix(true, false);
  const geo = targetMesh.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox;

  const cx = (bb.min.x + bb.max.x) * 0.5;
  const cy = (bb.min.y + bb.max.y) * 0.5;
  const cz = (bb.min.z + bb.max.z) * 0.5;
  const dx = bb.max.x - bb.min.x;
  const dy = bb.max.y - bb.min.y;
  const dz = bb.max.z - bb.min.z;

  const localPts = [];
  const clueId = targetMesh.userData?.clueId || '';

  if (clueId === 'button_body') {
    // Exposed front perimeter ring of cylindrical button plunger outside the central square cap label
    const zFront = bb.max.z;
    localPts.push(
      new THREE.Vector3(0.305, 0, zFront),
      new THREE.Vector3(-0.305, 0, zFront),
      new THREE.Vector3(0, 0.305, zFront),
      new THREE.Vector3(0, -0.305, zFront),
      new THREE.Vector3(0.295, -0.09, zFront)
    );
  } else if (clueId.startsWith('wire_') && !clueId.includes('cut')) {
    // Horizontal cylindrical wire along local X: sample 5 points along the outer skin facing the eye
    const invWorld = new THREE.Matrix4().copy(targetMesh.matrixWorld).invert();
    const localEye = eyeWorldPos.clone().applyMatrix4(invWorld);
    const yzLen = Math.hypot(localEye.y, localEye.z) || 1;
    const r = Math.max(dy, dz) * 0.49;
    const ny = (localEye.y / yzLen) * r;
    const nz = (localEye.z / yzLen) * r;

    for (const frac of [-0.36, -0.18, 0.0, 0.18, 0.36]) {
      localPts.push(new THREE.Vector3(cx + dx * frac, ny, nz));
    }
  } else if (dx < 1e-4) {
    // YZ-plane mesh (e.g. rotated ExteriorSerialPlate)
    const u = dy * 0.34;
    const v = dz * 0.34;
    localPts.push(
      new THREE.Vector3(cx, cy, cz),
      new THREE.Vector3(cx, cy + u, cz + v),
      new THREE.Vector3(cx, cy - u, cz + v),
      new THREE.Vector3(cx, cy + u, cz - v),
      new THREE.Vector3(cx, cy - u, cz - v)
    );
  } else if (dz < 1e-4) {
    // XY-plane mesh (e.g. capMesh, faceMesh, notchMesh, txFaceMesh, manualInnerPageMesh)
    const u = dx * 0.34;
    const v = dy * 0.34;
    localPts.push(
      new THREE.Vector3(cx, cy, cz),
      new THREE.Vector3(cx + u, cy + v, cz),
      new THREE.Vector3(cx - u, cy + v, cz),
      new THREE.Vector3(cx + u, cy - v, cz),
      new THREE.Vector3(cx - u, cy - v, cz)
    );
  } else {
    // 3D Box / Cylinder clue mesh (e.g. stripMesh, keyMesh, txBaseMesh): sample front (+Z) face
    const u = dx * 0.34;
    const v = dy * 0.3;
    const zFace = bb.max.z;
    localPts.push(
      new THREE.Vector3(cx, cy, zFace),
      new THREE.Vector3(cx + u, cy + v, zFace),
      new THREE.Vector3(cx - u, cy + v, zFace),
      new THREE.Vector3(cx + u, cy - v, zFace),
      new THREE.Vector3(cx - u, cy - v, zFace)
    );
  }

  return localPts.map((p) => p.applyMatrix4(targetMesh.matrixWorld));
}

function disposeObjectSubtree(rootObj) {
  if (!rootObj) return;
  rootObj.traverse((obj) => {
    if (obj.geometry) {
      try {
        obj.geometry.dispose();
      } catch (e) {}
    }
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        try {
          if (m.map) m.map.dispose();
          m.dispose();
        } catch (e) {}
      }
    }
  });
}

/**
 * Builds the complete, deterministic Shared 3D Van World scene graph without requiring
 * a browser DOM or WebGL context.
 */
export function buildSharedWorldGraph({
  role = 'operator',
  width = 390,
  height = 640,
  lowSpecMode = false
} = {}) {
  const scene = new THREE.Scene();
  const aspect = Math.max(120, width) / Math.max(120, height);
  const camera = new THREE.PerspectiveCamera(45, aspect, 0.08, 8.0);

  const styleManager = new WorldVisualStyleManager();
  scene.add(styleManager.reticleGroup);

  // Daylight Lighting Group (Hemisphere + warm window directional + cool cabin bounce; 0 shadow maps)
  const lightingGroup = new THREE.Group();
  lightingGroup.name = 'DaylightLightingGroup';

  const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x92400e, 1.15);
  hemiLight.position.set(0, 1.7, 0);
  lightingGroup.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfffbeb, 1.55);
  sunLight.position.set(-2.4, 2.6, 0.65);
  lightingGroup.add(sunLight);

  const bounceLight = new THREE.DirectionalLight(0xbae6fd, 0.55);
  bounceLight.position.set(1.6, 1.5, 1.1);
  lightingGroup.add(bounceLight);

  scene.add(lightingGroup);

  // Build Shared Van, Briefcase Rig, and Stylized Monkey Teammates
  const vanEnv = buildVanEnvironment({ styleManager });
  scene.add(vanEnv.root);

  const briefcaseRig = buildBriefcaseBombRig({
    styleManager,
    initialLidAngleRad: BRIEFCASE_SPEC.openAngleRad
  });
  scene.add(briefcaseRig.rig);

  const avatars = buildWorldAvatars({ styleManager });
  scene.add(avatars.root);

  const cameraRig = new SeatedCameraRig(camera, role, width, height);
  const moduleViews = new Map();
  let currentRole = role;
  let currentLowSpec = Boolean(lowSpecMode);
  let latestState = null;

  function syncMorseLamp(elapsedMs = 0) {
    const beaconState = latestState?.modules?.beacon;
    if (isOperatorRole(currentRole) && beaconState) {
      const lampState = computeOpticalMorseLampState(beaconState.beats, elapsedMs, {
        reducedMotion: prefersReducedMotion(),
        solved: Boolean(beaconState.solved)
      });
      briefcaseRig.updateMorseLamp({
        isOperatorView: true,
        lit: lampState.lit,
        intensity: lampState.intensity,
        beatType: lampState.beatType,
        isSolved: Boolean(beaconState.solved)
      });
    } else {
      briefcaseRig.updateMorseLamp({
        isOperatorView: false,
        lit: false,
        intensity: 0,
        beatType: 'idle',
        isSolved: false
      });
    }
  }

  function syncLidTimer(remainingSecondsOverride = null, penaltySeconds = 0) {
    const rem =
      remainingSecondsOverride !== null && remainingSecondsOverride !== undefined
        ? remainingSecondsOverride
        : (latestState?.remainingSeconds ?? latestState?.duration ?? 300);
    briefcaseRig.updateLidTimer({
      remainingSeconds: rem,
      strikes: latestState?.strikes || 0,
      maxStrikes: latestState?.maxStrikes || latestState?.difficulty?.maxStrikes || 3,
      penaltySeconds,
      isObserverView: isObserverRole(currentRole)
    });
  }

  function clearModules() {
    styleManager.clearModuleEdgeDisposables();
    for (const modInfo of moduleViews.values()) {
      if (modInfo.group) {
        briefcaseRig.moduleBayRoot.remove(modInfo.group);
        disposeObjectSubtree(modInfo.group);
      }
    }
    moduleViews.clear();
  }

  function rebuildModules(forRole = currentRole) {
    clearModules();

    const numModules = clientModules.length;
    const cols = numModules <= 3 ? numModules : (numModules <= 4 ? 2 : 3);
    const rows = Math.ceil(numModules / cols);
    const slotW = 1.08;
    const slotH = 1.08;
    const spacing = 0.13;

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
        position: { x: posX, y: posY, z: 0 }
      };

      const moduleGroup = mod.build(THREE, slot, forRole);
      moduleGroup.position.set(posX, posY, 0);
      moduleGroup.userData.moduleId = mod.id;

      if (isOperatorRole(forRole)) {
        styleManager.decorateOperatorModuleSubtree(moduleGroup);
      }

      briefcaseRig.moduleBayRoot.add(moduleGroup);
      moduleViews.set(mod.id, {
        moduleDef: mod,
        group: moduleGroup
      });
    });
  }

  function applyCurrentStyleProfile() {
    styleManager.applyRoleProfile(currentRole, {
      scene,
      lightingGroup,
      contactShadowsGroup: vanEnv.contactShadowsGroup,
      skyBackdropGroup: vanEnv.skyBackdropGroup,
      lowSpecMode: currentLowSpec
    });
  }

  function updateState(state) {
    latestState = state;
    if (!state) return;

    const showSerial = isObserverRole(currentRole) && Boolean(state.serialNumber);
    briefcaseRig.updateSerialPlate(showSerial ? state.serialNumber : null, isObserverRole(currentRole));

    if (state.modules) {
      for (const [modId, modInfo] of moduleViews.entries()) {
        const modState = state.modules[modId];
        if (modState) {
          modInfo.group.visible = true;
          modInfo.moduleDef.update(modInfo.group, currentRole, modState);
        } else {
          modInfo.group.visible = false;
        }
      }
    }

    const nowMs = typeof performance !== 'undefined' ? performance.now() : 0;
    syncMorseLamp(nowMs);
    syncLidTimer(state.remainingSeconds, 0);
  }

  function setRole(nextRole, { immediate = true } = {}) {
    currentRole = nextRole;
    avatars.setActiveReachTarget(null);
    styleManager.hideReticle();
    cameraRig.applyRoleConfig(nextRole, { immediate });
    rebuildModules(nextRole);
    applyCurrentStyleProfile();
    if (latestState) {
      updateState(latestState);
    } else {
      syncLidTimer(300, 0);
    }
    scene.updateMatrixWorld(true);
  }

  function setLowSpecMode(enabled) {
    currentLowSpec = Boolean(enabled);
    applyCurrentStyleProfile();
  }

  function showReticleForDescriptor(descriptor, isHoldLocked = false) {
    if (!isOperatorRole(currentRole) || !descriptor) {
      styleManager.hideReticle();
      avatars.setActiveReachTarget(null);
      return;
    }
    const targetObj = resolveDescriptorTargetObject(moduleViews, descriptor);
    if (targetObj) {
      styleManager.showReticleOnObject(targetObj, briefcaseRig.moduleBayRoot, isHoldLocked);
      avatars.setActiveReachTarget(styleManager.reticleGroup.position);
    } else {
      styleManager.hideReticle();
      avatars.setActiveReachTarget(null);
    }
  }

  function hideReticle() {
    styleManager.hideReticle();
    avatars.setActiveReachTarget(null);
  }

  // Whole-scene touch raycast (checks real occluders like the briefcase lid before controls)
  const _raycaster = new THREE.Raycaster();
  const _ndcVec = new THREE.Vector2();

  function raycastFromNdc(ndcX, ndcY) {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    _ndcVec.set(ndcX, ndcY);
    _raycaster.setFromCamera(_ndcVec, camera);
    _raycaster.layers.mask = camera.layers.mask;

    const rawHits = _raycaster.intersectObjects(scene.children, true);
    for (const hit of rawHits) {
      const obj = hit.object;
      if (!obj || !obj.isMesh) continue;
      if (!isHierarchyVisible(obj)) continue;
      if (obj.userData?.isAvatar) continue;
      if (obj.userData?.skipTactile && !obj.userData?.isTouchHitbox && !obj.userData?.clueId) continue;
      return hit;
    }
    return null;
  }

  /**
   * Fail-closed whole-scene line-of-sight evaluator across 5 points on `targetMesh`.
   * Proves whether the nearest visible scene surface along each ray is `targetMesh` itself
   * (with valid front-facing incidence <= 85°) or an intervening occluder (e.g. `briefcase_lid`).
   */
  const _sightRaycaster = new THREE.Raycaster();
  const _eyePos = new THREE.Vector3();
  const _rayDir = new THREE.Vector3();
  const _toEye = new THREE.Vector3();
  const _worldNorm = new THREE.Vector3();
  const _projVec = new THREE.Vector3();

  function evaluateSurfaceSightline(
    targetMesh,
    { eyeOverride = null, requireInFrustum = false } = {}
  ) {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);

    if (!targetMesh || !isHierarchyVisible(targetMesh)) {
      return {
        totalSamples: 0,
        visibleCount: 0,
        occludedCount: 0,
        visibleRatio: 0,
        samples: [],
        blockers: ['target_hidden']
      };
    }

    if (eyeOverride) {
      _eyePos.set(eyeOverride.x, eyeOverride.y, eyeOverride.z);
    } else {
      camera.getWorldPosition(_eyePos);
    }

    const samplePoints = computeSurfaceSamplePointsWorld(targetMesh, _eyePos);
    _sightRaycaster.layers.mask = camera.layers.mask;

    let visibleCount = 0;
    let occludedCount = 0;
    const blockers = new Set();
    const samples = [];

    for (const pt of samplePoints) {
      _rayDir.copy(pt).sub(_eyePos);
      const targetDist = _rayDir.length();
      if (targetDist < 1e-5) continue;
      _rayDir.divideScalar(targetDist);

      _sightRaycaster.set(_eyePos, _rayDir);
      _sightRaycaster.near = 0.02;
      _sightRaycaster.far = targetDist + 0.25;

      const rawHits = _sightRaycaster.intersectObjects(scene.children, true);
      let firstHit = null;

      for (const h of rawHits) {
        const o = h.object;
        if (!o || !o.isMesh) continue;
        if (!isHierarchyVisible(o)) continue;
        if (o.userData?.isTouchHitbox) continue;
        if (o.userData?.skipTactile && !o.userData?.clueId) continue;
        firstHit = h;
        break;
      }

      if (!firstHit) {
        occludedCount++;
        blockers.add('no_intersection');
        samples.push({ visible: false, blocker: 'no_intersection' });
        continue;
      }

      if (firstHit.object !== targetMesh) {
        occludedCount++;
        const blockerId =
          firstHit.object.userData?.occluderId ||
          firstHit.object.userData?.clueId ||
          firstHit.object.name ||
          'other_mesh';
        blockers.add(blockerId);
        samples.push({
          visible: false,
          blocker: blockerId,
          blockerDistance: firstHit.distance,
          targetDistance: targetDist
        });
        continue;
      }

      // Verify front-facing surface orientation (cos(85°) = 0.087155)
      let cosIncidence = 1.0;
      if (firstHit.face) {
        _worldNorm.copy(firstHit.face.normal).transformDirection(targetMesh.matrixWorld).normalize();
        _toEye.copy(_eyePos).sub(firstHit.point).normalize();
        cosIncidence = _worldNorm.dot(_toEye);
      }

      if (cosIncidence < 0.087155) {
        occludedCount++;
        blockers.add('backface_or_grazing');
        samples.push({ visible: false, blocker: 'backface_or_grazing', cosIncidence });
        continue;
      }

      if (requireInFrustum) {
        _projVec.copy(firstHit.point).project(camera);
        const inFrustum =
          Math.abs(_projVec.x) <= 0.97 &&
          Math.abs(_projVec.y) <= 0.97 &&
          _projVec.z >= -1.0 &&
          _projVec.z <= 1.0;
        if (!inFrustum) {
          occludedCount++;
          blockers.add('outside_frustum');
          samples.push({ visible: false, blocker: 'outside_frustum', ndc: { x: _projVec.x, y: _projVec.y } });
          continue;
        }
      }

      visibleCount++;
      samples.push({
        visible: true,
        blocker: null,
        distance: firstHit.distance,
        cosIncidence
      });
    }

    const totalSamples = samples.length;
    return {
      totalSamples,
      visibleCount,
      occludedCount,
      visibleRatio: totalSamples > 0 ? visibleCount / totalSamples : 0,
      samples,
      blockers: Array.from(blockers)
    };
  }

  function dispose() {
    clearModules();
    styleManager.dispose();
    disposeObjectSubtree(scene);
  }

  // Initialize initial role profile & modules
  rebuildModules(currentRole);
  applyCurrentStyleProfile();
  cameraRig.snapToTargets();
  scene.updateMatrixWorld(true);

  return {
    scene,
    camera,
    cameraRig,
    styleManager,
    lightingGroup,
    vanEnv,
    briefcaseRig,
    avatars,
    moduleViews,
    rebuildModules,
    updateState,
    syncMorseLamp,
    syncLidTimer,
    setRole,
    setLowSpecMode,
    showReticleForDescriptor,
    hideReticle,
    raycastFromNdc,
    evaluateSurfaceSightline,
    dispose,
    getRole: () => currentRole,
    isLowSpecMode: () => currentLowSpec
  };
}
