/**
 * Shared 3D Van World, Briefcase Occlusion Rig, Role Viewpoints & Scene Manager.
 *
 * Unifies:
 * - Compact daytime 3D Van interior + green-top table (`van-environment.js`)
 * - Hard-shell briefcase bomb with North-hinge physical lid occlusion (`briefcase-rig.js`)
 * - Stylized orange-furred monkey teammates with role accessories & hands (`world-avatars.js`)
 * - Fixed-origin seated role cameras with bounded head-look & optical FOV zoom (`camera-rig.js`)
 * - Deterministic 4-pass Operator monochrome tactile wireframe + red reticle (`tactile-styler.js`)
 * - Headless `buildSharedWorldGraph` + whole-scene fail-closed sightline evaluator for tests.
 */
import * as THREE from 'three';
import { clientModules } from './modules/index.js';
import { prefersReducedMotion } from './modules/canvas-utils.js';
import { BombInteractionController, INTERACTION_DEFAULTS } from './interaction-controller.js';
import { SeatedCameraRig, normalizeWorldRole } from './camera-rig.js';
import { WorldVisualStyleManager } from './tactile-styler.js';
import {
  BRIEFCASE_SPEC,
  buildBriefcaseBombRig,
  computeOpticalMorseLampState
} from './briefcase-rig.js';
import { buildVanEnvironment } from './van-environment.js';
import { buildWorldAvatars } from './world-avatars.js';

export { BRIEFCASE_SPEC, computeOpticalMorseLampState };

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

export function isOperatorRole(role) {
  return role === 'blind' || role === 'operator';
}

export function isObserverRole(role) {
  return role === 'deaf' || role === 'observer';
}

export function isManualRole(role) {
  return role === 'mute' || role === 'manual';
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
 * a browser DOM or WebGL context, enabling both live WebGL rendering and mathematical
 * Node.js occlusion & sightline verification tests.
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
        // Invisible touch hitboxes do not visually block or reveal clues
        if (o.userData?.isTouchHitbox) continue;
        // Sky backdrop & contact shadow decals are non-occluding
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

/**
 * Live Responsive WebGL 3D Van & Briefcase Bomb Scene Manager.
 */
export class Bomb3DScene {
  constructor(containerEl, role, onActionSend, getTimerRemaining, options = {}) {
    this.container = containerEl;
    this.role = role;
    this.send = onActionSend;
    this.getTimerRemaining = getTimerRemaining || (() => 300);
    this.onInteractionStatus = options.onInteractionStatus || (() => {});

    this.world = null;
    this.scene = null;
    this.camera = null;
    this.cameraRig = null;
    this.styleManager = null;
    this.briefcaseRig = null;
    this.vanEnv = null;
    this.avatars = null;
    this.moduleViews = new Map();

    this.renderer = null;
    this.animFrameId = null;
    this.animTimeoutId = null;
    this.resizeObserver = null;
    this.contextLost = false;
    this.isSoftwareGl = false;
    this.lowSpecMode = Boolean(options.lowSpecMode);
    this.sensitivity = 1.0;
    this.currentState = null;

    // Rolling 30-frame timing monitor for automatic low-spec fallback
    this._lastFrameTime = 0;
    this._frameDeltas = [];
    this._avgFrameMs = 16.6;
    this._keyboardReticleActive = false;

    // Production Interaction State Machine
    this.interaction = new BombInteractionController({
      getRole: () => this.role,
      getState: () => this.currentState,
      getTimerRemaining: () => this.getTimerRemaining(),
      raycastAt: (cx, cy) => this.raycast(cx, cy),
      resolveHitModule: (obj) => this.findHitModule(obj),
      holdThresholdMs: options.holdThresholdMs ?? INTERACTION_DEFAULTS.buttonHoldThresholdMs,
      onSendAction: (actionPayload) => {
        if (this.send) {
          this.send('action', actionPayload);
        }
      },
      onCameraRotate: (dx, dy) => {
        if (!this.cameraRig) return;
        const sens = this.sensitivity || 1.0;
        this.cameraRig.rotateHeadByRadians(dx * 0.0042 * sens, dy * 0.0042 * sens, {
          immediate: prefersReducedMotion()
        });
      },
      onCameraZoom: (delta) => {
        if (!this.cameraRig) return;
        this.cameraRig.zoomByFovDelta(delta * 0.085, {
          immediate: prefersReducedMotion()
        });
      },
      onStatusChange: (status) => {
        this.syncReticleWithInteraction();
        this.onInteractionStatus(status);
      },
      onFeedback: (feedbackType, descriptor) => {
        this.handleTactileAndAudioFeedback(feedbackType, descriptor);
      }
    });

    // Bound event handlers for clean disposal
    this.boundPointerDown = null;
    this.boundPointerMove = null;
    this.boundPointerUp = null;
    this.boundPointerCancel = null;
    this.boundWheel = null;
    this.boundLostCapture = null;
    this.boundWindowBlur = null;
    this.boundVisibilityChange = null;
    this.boundOrientationChange = null;
    this.boundContextMenu = null;
    this.boundWebglContextLost = null;
    this.boundWebglContextRestored = null;

    this.init();
  }

  get targetRotY() {
    return this.cameraRig ? this.cameraRig.targetYawOffset : 0;
  }

  set targetRotY(val) {
    if (!this.cameraRig) return;
    this.cameraRig.targetYawOffset = Number(val) || 0;
    this.cameraRig.clampOffsets();
    if (prefersReducedMotion()) this.cameraRig.snapToTargets();
  }

  get targetRotX() {
    return this.cameraRig ? this.cameraRig.targetPitchOffset : 0;
  }

  set targetRotX(val) {
    if (!this.cameraRig) return;
    this.cameraRig.targetPitchOffset = Number(val) || 0;
    this.cameraRig.clampOffsets();
    if (prefersReducedMotion()) this.cameraRig.snapToTargets();
  }

  detectSoftwareRenderer(renderer) {
    try {
      const gl = renderer.getContext();
      if (!gl) return false;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const rendererStr = String(
        dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      ).toLowerCase();
      return (
        rendererStr.includes('swiftshader') ||
        rendererStr.includes('llvmpipe') ||
        rendererStr.includes('software') ||
        rendererStr.includes('basic render driver')
      );
    } catch (e) {
      return false;
    }
  }

  computeTargetPixelRatio() {
    if (this.isSoftwareGl || this.lowSpecMode) return 1.0;
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    return Math.min(dpr, 1.75);
  }

  init() {
    const width = Math.max(120, this.container.clientWidth || 360);
    const height = Math.max(120, this.container.clientHeight || 420);

    // 1. Build Shared 3D Van World Graph
    this.world = buildSharedWorldGraph({
      role: this.role,
      width,
      height,
      lowSpecMode: this.lowSpecMode
    });

    this.scene = this.world.scene;
    this.camera = this.world.camera;
    this.cameraRig = this.world.cameraRig;
    this.styleManager = this.world.styleManager;
    this.briefcaseRig = this.world.briefcaseRig;
    this.vanEnv = this.world.vanEnv;
    this.avatars = this.world.avatars;
    this.moduleViews = this.world.moduleViews;
    this.bombGroup = this.briefcaseRig.moduleBayRoot;

    // 2. Initialize WebGLRenderer with Mobile & Software-GL Protections
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.lowSpecMode,
      powerPreference: 'high-performance'
    });
    this.isSoftwareGl = this.detectSoftwareRenderer(this.renderer);
    if (this.isSoftwareGl) {
      this.lowSpecMode = true;
      this.world.setLowSpecMode(true);
    }

    this.renderer.setPixelRatio(this.computeTargetPixelRatio());
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    // 3. Bind Pointer / Touch / Context-Loss Lifecycle Events
    this.setupTouchControls();

    // 4. Container ResizeObserver
    this.setupResizeObserver();

    // 5. Start Render Loop (scheduled afterDraw)
    this.animate = this.animate.bind(this);
    this._lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.animate();
  }

  setupResizeObserver() {
    if (typeof ResizeObserver !== 'undefined' && this.container) {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            this.handleResize(width, height);
          }
        }
      });
      this.resizeObserver.observe(this.container);
    }
  }

  handleResize(width, height) {
    if (!this.container || !this.renderer || !this.cameraRig) return;
    const w = width || this.container.clientWidth;
    const h = height || this.container.clientHeight;
    if (w <= 0 || h <= 0) return;

    this.cameraRig.handleViewportResize(w, h, { immediate: prefersReducedMotion() });
    this.renderer.setPixelRatio(this.computeTargetPixelRatio());
    this.renderer.setSize(w, h);
  }

  resize() {
    this.handleResize();
  }

  setupTouchControls() {
    const dom = this.renderer.domElement;

    this.boundPointerDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.cancelable) e.preventDefault();
      try {
        dom.setPointerCapture(e.pointerId);
      } catch (err) {}
      this.interaction.onPointerDown(e);
    };

    this.boundPointerMove = (e) => {
      if (e.cancelable) e.preventDefault();
      this.interaction.onPointerMove(e);
    };

    this.boundPointerUp = (e) => {
      if (e.cancelable) e.preventDefault();
      this.interaction.onPointerUp(e);
      try {
        if (dom.hasPointerCapture?.(e.pointerId)) {
          dom.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}
    };

    this.boundPointerCancel = (e) => {
      this.interaction.onPointerCancel(e);
    };

    this.boundLostCapture = (e) => {
      this.interaction.onLostPointerCapture(e);
    };

    this.boundWindowBlur = () => {
      this.interaction.onBlur();
    };

    this.boundVisibilityChange = () => {
      this.interaction.onVisibilityChange(Boolean(document.hidden));
    };

    this.boundOrientationChange = () => {
      this.interaction.onOrientationChange();
      setTimeout(() => {
        if (this.container) {
          const w = this.container.clientWidth;
          const h = this.container.clientHeight;
          if (w > 0 && h > 0) {
            this.handleResize(w, h);
          }
        }
      }, 80);
    };

    this.boundWheel = (e) => {
      e.preventDefault();
      if (this.cameraRig) {
        this.cameraRig.zoomByFovDelta(e.deltaY * 0.025, {
          immediate: prefersReducedMotion()
        });
      }
    };

    this.boundContextMenu = (e) => {
      e.preventDefault();
    };

    this.boundWebglContextLost = (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.interaction.cancelActiveGesture('webgl_context_lost');
      if (this.animFrameId) {
        cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }
      if (this.animTimeoutId) {
        clearTimeout(this.animTimeoutId);
        this.animTimeoutId = null;
      }
    };

    this.boundWebglContextRestored = () => {
      this.contextLost = false;
      if (this.world) {
        this.world.setRole(this.role, { immediate: true });
        if (this.currentState) {
          this.world.updateState(this.currentState);
        }
      }
      if (!this.animFrameId) {
        this._lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.animate();
      }
    };

    dom.addEventListener('pointerdown', this.boundPointerDown);
    dom.addEventListener('pointermove', this.boundPointerMove);
    dom.addEventListener('pointerup', this.boundPointerUp);
    dom.addEventListener('pointercancel', this.boundPointerCancel);
    dom.addEventListener('lostpointercapture', this.boundLostCapture);
    dom.addEventListener('wheel', this.boundWheel, { passive: false });
    dom.addEventListener('contextmenu', this.boundContextMenu);
    dom.addEventListener('webglcontextlost', this.boundWebglContextLost, false);
    dom.addEventListener('webglcontextrestored', this.boundWebglContextRestored, false);

    window.addEventListener('blur', this.boundWindowBlur);
    window.addEventListener('orientationchange', this.boundOrientationChange);
    document.addEventListener('visibilitychange', this.boundVisibilityChange);
  }

  syncReticleWithInteraction() {
    if (!this.world) return;
    const g = this.interaction.activeGesture;
    if (g && g.kind === 'control' && g.descriptor && isOperatorRole(this.role)) {
      this._keyboardReticleActive = false;
      this.world.showReticleForDescriptor(g.descriptor, Boolean(g.holdTriggered));
    } else if (!this._keyboardReticleActive) {
      this.world.hideReticle();
    }
  }

  /**
   * Allows keyboard Space accessibility hold to display the exact Operator red target reticle.
   */
  setKeyboardButtonReticle(active, isHoldLocked = false) {
    if (!this.world) return;
    if (active && isOperatorRole(this.role)) {
      this._keyboardReticleActive = true;
      this.world.showReticleForDescriptor(
        { moduleId: 'button', controlId: 'plunger' },
        isHoldLocked
      );
    } else {
      this._keyboardReticleActive = false;
      this.syncReticleWithInteraction();
    }
  }

  handleTactileAndAudioFeedback(type, descriptor) {
    if (type === 'press_start') {
      this.triggerTactileFeedback('tap');
      if (typeof window !== 'undefined' && window.soundEngine?.playTactileTick) {
        window.soundEngine.playTactileTick();
      }
      return;
    }

    if (type === 'hold_start') {
      this.triggerTactileFeedback('hold');
      if (typeof window !== 'undefined' && window.soundEngine?.playTactileTick) {
        window.soundEngine.playTactileTick();
      }
      return;
    }

    if (type === 'commit' || type === 'tap_commit' || type === 'hold_release') {
      if (descriptor?.moduleId === 'wires') {
        this.triggerTactileFeedback('cut');
        if (typeof window !== 'undefined' && window.soundEngine?.playWireCut) {
          window.soundEngine.playWireCut();
        } else if (typeof window !== 'undefined' && window.soundEngine?.playClick) {
          window.soundEngine.playClick();
        }
      } else {
        this.triggerTactileFeedback(type === 'hold_release' ? 'hold' : 'key');
        if (typeof window !== 'undefined' && window.soundEngine?.playClick) {
          window.soundEngine.playClick();
        }
      }
    }
  }

  setHoldThreshold(ms) {
    return this.interaction.setHoldThreshold(ms);
  }

  getHoldThreshold() {
    return this.interaction.getHoldThreshold();
  }

  cancelActiveInteraction(reason = 'manual_cancel') {
    this._keyboardReticleActive = false;
    return this.interaction.cancelActiveGesture(reason);
  }

  /**
   * Role-Specific Seated Camera Quick Focus Presets
   */
  setCameraPreset(presetName) {
    if (!this.cameraRig) return;
    this.cameraRig.setPreset(presetName, { immediate: prefersReducedMotion() });
  }

  viewFront() {
    this.setCameraPreset('primary');
  }

  viewBack() {
    this.setCameraPreset('secondary');
  }

  viewTertiary() {
    this.setCameraPreset('tertiary');
  }

  resetView() {
    if (!this.cameraRig) return;
    this.cameraRig.resetView({ immediate: prefersReducedMotion() });
  }

  setSensitivity(val) {
    const num = parseFloat(val);
    if (!isNaN(num) && num >= 0.1 && num <= 3.0) {
      this.sensitivity = num;
    }
  }

  setLowSpecMode(enabled) {
    this.lowSpecMode = Boolean(enabled);
    if (this.world) {
      this.world.setLowSpecMode(this.lowSpecMode);
    }
    if (this.renderer) {
      this.renderer.setPixelRatio(this.computeTargetPixelRatio());
    }
  }

  getPerformanceMetrics() {
    const renderInfo = this.renderer?.info?.render || {};
    const memoryInfo = this.renderer?.info?.memory || {};
    return {
      role: normalizeWorldRole(this.role),
      drawCalls: renderInfo.calls ?? 0,
      triangles: renderInfo.triangles ?? 0,
      lines: renderInfo.lines ?? 0,
      geometries: memoryInfo.geometries ?? 0,
      textures: memoryInfo.textures ?? 0,
      lowSpecMode: this.lowSpecMode,
      isSoftwareGl: this.isSoftwareGl,
      avgFrameMs: Math.round(this._avgFrameMs * 10) / 10
    };
  }

  triggerTactileFeedback(type = 'tap') {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        if (type === 'hold') {
          navigator.vibrate([40, 30, 40]);
        } else if (type === 'cut') {
          navigator.vibrate([45, 25]);
        } else if (type === 'key') {
          navigator.vibrate(25);
        } else {
          navigator.vibrate(20);
        }
      } catch (e) {}
    }
  }

  raycast(clientX, clientY) {
    if (!this.renderer || !this.world) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    return this.world.raycastFromNdc(ndcX, ndcY);
  }

  findHitModule(obj) {
    if (!this.briefcaseRig || !obj) return null;
    let curr = obj;
    while (curr && curr !== this.briefcaseRig.moduleBayRoot && curr !== this.scene) {
      if (curr.userData?.moduleId) {
        return this.moduleViews.get(curr.userData.moduleId) || null;
      }
      curr = curr.parent;
    }
    return null;
  }

  setRole(newRole) {
    if (this.role !== newRole) {
      this._keyboardReticleActive = false;
      this.interaction.cancelActiveGesture('role_change');
      this.role = newRole;
      if (this.world) {
        this.world.setRole(newRole, { immediate: true });
      }
      if (this.currentState) {
        this.updateState(this.currentState);
      }
    }
  }

  updateState(state) {
    const prevStatus = this.currentState?.status;
    this.currentState = state;
    if (!state || !this.world) return;

    if (prevStatus === 'running' && state.status !== 'running') {
      this._keyboardReticleActive = false;
      this.interaction.cancelActiveGesture('round_ended');
    }

    this.world.updateState(state);
  }

  animate() {
    if (!this.renderer || !this.scene || !this.camera || this.contextLost) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = now - (this._lastFrameTime || now);
    this._lastFrameTime = now;

    if (dt > 2 && dt < 250) {
      this._frameDeltas.push(dt);
      if (this._frameDeltas.length > 30) this._frameDeltas.shift();
      if (this._frameDeltas.length === 30) {
        const sum = this._frameDeltas.reduce((a, b) => a + b, 0);
        this._avgFrameMs = sum / 30;
        if (!this.lowSpecMode && !this.isSoftwareGl && this._avgFrameMs > 28) {
          this.setLowSpecMode(true);
        }
      }
    }

    // Advance active touch/hold progress indicators & silent Optical Morse side-lamp
    this.interaction.tick();
    this.syncReticleWithInteraction();
    if (this.world) {
      this.world.syncMorseLamp(now);
    }

    const damping = prefersReducedMotion() ? 1.0 : 0.18;
    if (this.cameraRig) {
      this.cameraRig.update(damping);
    }

    this.renderer.render(this.scene, this.camera);

    // Schedule next frame strictly AFTER draw (using GPU fenceSync on software GL)
    if (this.isSoftwareGl && typeof window !== 'undefined') {
      const gl = this.renderer.getContext();
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (!this.renderer || this.contextLost) return;
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            this.animTimeoutId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            this.animTimeoutId = window.setTimeout(() => {
              this.animTimeoutId = null;
              this.animate();
            }, 80);
          }
        };
        this.animTimeoutId = window.setTimeout(poll, 5);
        return;
      }
    }

    this.animFrameId = requestAnimationFrame(this.animate);
  }

  dispose() {
    this._keyboardReticleActive = false;
    this.interaction.cancelActiveGesture('dispose');

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.animTimeoutId) {
      clearTimeout(this.animTimeoutId);
      this.animTimeoutId = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.renderer) {
      const dom = this.renderer.domElement;
      if (dom) {
        if (this.boundPointerDown) dom.removeEventListener('pointerdown', this.boundPointerDown);
        if (this.boundPointerMove) dom.removeEventListener('pointermove', this.boundPointerMove);
        if (this.boundPointerUp) dom.removeEventListener('pointerup', this.boundPointerUp);
        if (this.boundPointerCancel) dom.removeEventListener('pointercancel', this.boundPointerCancel);
        if (this.boundLostCapture) dom.removeEventListener('lostpointercapture', this.boundLostCapture);
        if (this.boundWheel) dom.removeEventListener('wheel', this.boundWheel);
        if (this.boundContextMenu) dom.removeEventListener('contextmenu', this.boundContextMenu);
        if (this.boundWebglContextLost) dom.removeEventListener('webglcontextlost', this.boundWebglContextLost);
        if (this.boundWebglContextRestored) dom.removeEventListener('webglcontextrestored', this.boundWebglContextRestored);
      }

      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', this.boundWindowBlur);
        window.removeEventListener('orientationchange', this.boundOrientationChange);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.boundVisibilityChange);
      }

      if (this.world) {
        this.world.dispose();
        this.world = null;
      }

      this.renderer.dispose();
      if (dom && dom.parentNode) {
        dom.parentNode.removeChild(dom);
      }
    } else if (this.world) {
      this.world.dispose();
      this.world = null;
    }

    this.scene = null;
    this.camera = null;
    this.cameraRig = null;
    this.styleManager = null;
    this.briefcaseRig = null;
    this.vanEnv = null;
    this.avatars = null;
    this.renderer = null;
    this.bombGroup = null;
    this.moduleViews.clear();
  }
}
