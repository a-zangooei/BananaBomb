/**
 * Seated Role Camera Rig & Layer Isolation Architecture for BananaBomb.
 *
 * Enforces physically grounded, fixed-origin seated viewpoints around the shared van table:
 * - Operator ('blind' / 'operator'): South (+Z) bench at (0.000, 1.180, +0.460) facing North (-Z).
 * - Observer ('deaf' / 'observer'): East (+X) lateral bench at (+0.640, 1.160, +0.060) facing West (-X).
 * - Manual-holder ('mute' / 'manual'): North (-Z) bench at (0.000, 1.160, -0.640) facing South (+Z).
 *
 * Security & Occlusion Invariants:
 * 1. Camera world position is strictly locked to the role's seated eye point (zero translation).
 * 2. Pointer drag performs bounded head-look (clamped yaw & pitch in 'YXZ' order).
 * 3. Pinch / wheel zoom is strictly optical (camera.fov clamped to [26°, 58°]) so zooming
 *    can never move the ray origin past physical occluders such as the raised briefcase lid.
 */
import * as THREE from 'three';
import { toFunctionalRoleKey } from '../shared/roles.js';

export const WORLD_LAYERS = Object.freeze({
  SHARED: 0,
  OPERATOR_BODY: 1,
  OBSERVER_BODY: 2,
  MANUAL_BODY: 3,
  OPERATOR_RETICLE: 4
});

export const CAMERA_FOV_LIMITS = Object.freeze({
  minFov: 26,
  maxFov: 58
});

export function normalizeWorldRole(role) {
  return toFunctionalRoleKey(role);
}

export function setSubtreeLayer(rootObj, layerIndex) {
  if (!rootObj) return;
  rootObj.traverse((node) => {
    if (node.layers) {
      node.layers.set(layerIndex);
    }
  });
}

export const SEATED_CAMERA_CONFIGS = Object.freeze({
  operator: {
    eyePosition: Object.freeze({ x: 0.0, y: 1.18, z: 0.46 }),
    yawClampDeg: Object.freeze([-22, 22]),
    pitchClampDeg: Object.freeze([-18, 26]),
    visibleLayers: Object.freeze([
      WORLD_LAYERS.SHARED,
      WORLD_LAYERS.OBSERVER_BODY,
      WORLD_LAYERS.MANUAL_BODY,
      WORLD_LAYERS.OPERATOR_RETICLE
    ]),
    defaultPreset: 'modules',
    secondaryPreset: 'overview',
    tertiaryPreset: 'lamp',
    presets: Object.freeze({
      modules: Object.freeze({
        id: 'modules',
        lookAt: Object.freeze({ x: 0.0, y: 0.832, z: 0.02 }),
        baseFov: 46,
        minTanHalfHFov: 0.318
      }),
      overview: Object.freeze({
        id: 'overview',
        lookAt: Object.freeze({ x: 0.06, y: 0.99, z: -0.14 }),
        baseFov: 52,
        minTanHalfHFov: 0.318
      }),
      lamp: Object.freeze({
        id: 'lamp',
        lookAt: Object.freeze({ x: -0.308, y: 0.832, z: 0.176 }),
        baseFov: 32,
        minTanHalfHFov: 0.2
      })
    })
  },

  observer: {
    eyePosition: Object.freeze({ x: 0.64, y: 1.16, z: 0.06 }),
    yawClampDeg: Object.freeze([-34, 34]),
    pitchClampDeg: Object.freeze([-22, 20]),
    visibleLayers: Object.freeze([
      WORLD_LAYERS.SHARED,
      WORLD_LAYERS.OPERATOR_BODY,
      WORLD_LAYERS.MANUAL_BODY
    ]),
    defaultPreset: 'clues',
    secondaryPreset: 'serial',
    tertiaryPreset: 'bridge',
    presets: Object.freeze({
      clues: Object.freeze({
        id: 'clues',
        lookAt: Object.freeze({ x: -0.01, y: 0.848, z: -0.015 }),
        baseFov: 46,
        minTanHalfHFov: 0.345
      }),
      serial: Object.freeze({
        id: 'serial',
        lookAt: Object.freeze({ x: 0.2815, y: 0.782, z: 0.04 }),
        baseFov: 26,
        minTanHalfHFov: 0.165
      }),
      bridge: Object.freeze({
        id: 'bridge',
        lookAt: Object.freeze({ x: -0.08, y: 0.98, z: -0.08 }),
        baseFov: 54,
        minTanHalfHFov: 0.31
      })
    })
  },

  manual: {
    eyePosition: Object.freeze({ x: 0.0, y: 1.16, z: -0.64 }),
    yawClampDeg: Object.freeze([-28, 28]),
    pitchClampDeg: Object.freeze([-22, 16]),
    visibleLayers: Object.freeze([
      WORLD_LAYERS.SHARED,
      WORLD_LAYERS.OPERATOR_BODY,
      WORLD_LAYERS.OBSERVER_BODY
    ]),
    defaultPreset: 'bridge',
    secondaryPreset: 'observer_focus',
    presets: Object.freeze({
      bridge: Object.freeze({
        id: 'bridge',
        lookAt: Object.freeze({ x: 0.04, y: 0.96, z: 0.04 }),
        baseFov: 48,
        minTanHalfHFov: 0.29
      }),
      observer_focus: Object.freeze({
        id: 'observer_focus',
        lookAt: Object.freeze({ x: 0.48, y: 0.98, z: 0.02 }),
        baseFov: 38,
        minTanHalfHFov: 0.25
      })
    })
  }
});

// Pre-allocated math scratch objects (zero per-frame GC)
const _lookMat = new THREE.Matrix4();
const _eyeVec = new THREE.Vector3();
const _targetVec = new THREE.Vector3();
const _upVec = new THREE.Vector3(0, 1, 0);
const _baseEuler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * Computes aspect-adapted vertical FOV strictly clamped to [26°, 58°] so narrow mobile
 * portrait viewports widen vertical FOV up to 58° to preserve horizontal framing without
 * ever translating the seated camera position.
 */
export function computeAdaptivePresetFov(presetSpec, width, height) {
  const baseFov = presetSpec?.baseFov || 45;
  const w = Math.max(120, Number(width) || 390);
  const h = Math.max(120, Number(height) || 640);
  const aspect = w / h;

  let adapted = baseFov;
  const minTanH = presetSpec?.minTanHalfHFov || 0.29;
  if (aspect < 1.0) {
    const safeAspect = Math.max(0.54, aspect);
    const neededTanHalfV = minTanH / safeAspect;
    const neededFovDeg = THREE.MathUtils.radToDeg(2 * Math.atan(neededTanHalfV));
    adapted = Math.max(baseFov, neededFovDeg);
  }

  return THREE.MathUtils.clamp(adapted, CAMERA_FOV_LIMITS.minFov, CAMERA_FOV_LIMITS.maxFov);
}

function computeBaseYawPitch(eye, lookAt) {
  _eyeVec.set(eye.x, eye.y, eye.z);
  _targetVec.set(lookAt.x, lookAt.y, lookAt.z);
  _lookMat.lookAt(_eyeVec, _targetVec, _upVec);
  _baseEuler.setFromRotationMatrix(_lookMat, 'YXZ');
  return {
    baseYaw: _baseEuler.y,
    basePitch: _baseEuler.x
  };
}

export class SeatedCameraRig {
  constructor(camera, role = 'operator', viewportWidth = 390, viewportHeight = 640) {
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';
    this.camera.near = 0.08;
    this.camera.far = 8.0;

    this.viewportWidth = Math.max(120, viewportWidth || 390);
    this.viewportHeight = Math.max(120, viewportHeight || 640);
    this.roleKey = normalizeWorldRole(role);
    this.activePresetId = null;

    this.baseYaw = 0;
    this.basePitch = 0;
    this.currentBaseYaw = 0;
    this.currentBasePitch = 0;

    // Relative head-look offsets (radians) around the active preset's base look direction
    this.targetYawOffset = 0;
    this.targetPitchOffset = 0;
    this.currentYawOffset = 0;
    this.currentPitchOffset = 0;

    this.targetFov = 45;
    this.currentFov = 45;
    this.userZoomActive = false;

    this.applyRoleConfig(role, { immediate: true });
  }

  getConfig() {
    return SEATED_CAMERA_CONFIGS[this.roleKey] || SEATED_CAMERA_CONFIGS.operator;
  }

  applyCameraLayers() {
    const cfg = this.getConfig();
    this.camera.layers.disableAll();
    for (const layerIdx of cfg.visibleLayers) {
      this.camera.layers.enable(layerIdx);
    }
  }

  applyRoleConfig(role, { immediate = true } = {}) {
    this.roleKey = normalizeWorldRole(role);
    const cfg = this.getConfig();

    // Lock world position strictly to seated eye origin
    this.camera.position.set(cfg.eyePosition.x, cfg.eyePosition.y, cfg.eyePosition.z);
    this.applyCameraLayers();

    this.setPreset(cfg.defaultPreset, { immediate });
  }

  setPreset(presetName, { immediate = false } = {}) {
    const cfg = this.getConfig();
    let resolvedKey = presetName;
    if (presetName === 'primary') resolvedKey = cfg.defaultPreset;
    else if (presetName === 'secondary') resolvedKey = cfg.secondaryPreset;
    else if (presetName === 'tertiary') resolvedKey = cfg.tertiaryPreset || cfg.defaultPreset;

    const preset = cfg.presets[resolvedKey] || cfg.presets[cfg.defaultPreset];
    this.activePresetId = preset.id;

    const { baseYaw, basePitch } = computeBaseYawPitch(cfg.eyePosition, preset.lookAt);
    this.baseYaw = baseYaw;
    this.basePitch = basePitch;

    this.targetYawOffset = 0;
    this.targetPitchOffset = 0;
    this.userZoomActive = false;
    this.targetFov = computeAdaptivePresetFov(preset, this.viewportWidth, this.viewportHeight);

    if (immediate) {
      this.snapToTargets();
    }
  }

  resetView({ immediate = false } = {}) {
    const cfg = this.getConfig();
    this.setPreset(cfg.defaultPreset, { immediate });
  }

  clampOffsets() {
    const cfg = this.getConfig();
    const minYaw = THREE.MathUtils.degToRad(cfg.yawClampDeg[0]);
    const maxYaw = THREE.MathUtils.degToRad(cfg.yawClampDeg[1]);
    const minPitch = THREE.MathUtils.degToRad(cfg.pitchClampDeg[0]);
    const maxPitch = THREE.MathUtils.degToRad(cfg.pitchClampDeg[1]);

    this.targetYawOffset = THREE.MathUtils.clamp(this.targetYawOffset, minYaw, maxYaw);
    this.targetPitchOffset = THREE.MathUtils.clamp(this.targetPitchOffset, minPitch, maxPitch);
  }

  /**
   * Applies pointer head-look deltas (pixels * sensitivityScale) without moving camera.position.
   */
  rotateHeadByRadians(deltaYawRad, deltaPitchRad, { immediate = false } = {}) {
    this.targetYawOffset += deltaYawRad;
    this.targetPitchOffset += deltaPitchRad;
    this.clampOffsets();
    if (immediate) {
      this.snapToTargets();
    }
  }

  /**
   * Optical FOV-only zoom: positive delta zooms out (wider FOV), negative delta zooms in (narrower FOV).
   * Camera world position remains 100% invariant.
   */
  zoomByFovDelta(deltaFovDeg, { immediate = false } = {}) {
    this.userZoomActive = true;
    this.targetFov = THREE.MathUtils.clamp(
      this.targetFov + deltaFovDeg,
      CAMERA_FOV_LIMITS.minFov,
      CAMERA_FOV_LIMITS.maxFov
    );
    if (immediate) {
      this.snapToTargets();
    }
  }

  handleViewportResize(width, height, { immediate = false } = {}) {
    const w = Math.max(120, Number(width) || this.viewportWidth);
    const h = Math.max(120, Number(height) || this.viewportHeight);
    this.viewportWidth = w;
    this.viewportHeight = h;

    this.camera.aspect = w / h;
    if (!this.userZoomActive) {
      const cfg = this.getConfig();
      const preset = cfg.presets[this.activePresetId] || cfg.presets[cfg.defaultPreset];
      this.targetFov = computeAdaptivePresetFov(preset, w, h);
    } else {
      this.targetFov = THREE.MathUtils.clamp(
        this.targetFov,
        CAMERA_FOV_LIMITS.minFov,
        CAMERA_FOV_LIMITS.maxFov
      );
    }

    if (immediate) {
      this.snapToTargets();
    } else {
      this.camera.updateProjectionMatrix();
    }
  }

  snapToTargets() {
    const cfg = this.getConfig();
    this.clampOffsets();
    this.targetFov = THREE.MathUtils.clamp(
      this.targetFov,
      CAMERA_FOV_LIMITS.minFov,
      CAMERA_FOV_LIMITS.maxFov
    );

    this.currentBaseYaw = this.baseYaw;
    this.currentBasePitch = this.basePitch;
    this.currentYawOffset = this.targetYawOffset;
    this.currentPitchOffset = this.targetPitchOffset;
    this.currentFov = this.targetFov;

    // Enforce locked eye origin invariant
    this.camera.position.set(cfg.eyePosition.x, cfg.eyePosition.y, cfg.eyePosition.z);
    this.camera.rotation.set(
      this.currentBasePitch + this.currentPitchOffset,
      this.currentBaseYaw + this.currentYawOffset,
      0,
      'YXZ'
    );
    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }

  update(dampingAlpha = 0.18) {
    const cfg = this.getConfig();
    this.clampOffsets();

    //Shortest-angle wrap for baseYaw transitions
    let yawDiff = this.baseYaw - this.currentBaseYaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;

    const alpha = THREE.MathUtils.clamp(dampingAlpha, 0.01, 1.0);
    this.currentBaseYaw += yawDiff * alpha;
    this.currentBasePitch += (this.basePitch - this.currentBasePitch) * alpha;
    this.currentYawOffset += (this.targetYawOffset - this.currentYawOffset) * alpha;
    this.currentPitchOffset += (this.targetPitchOffset - this.currentPitchOffset) * alpha;

    const prevFov = this.currentFov;
    this.currentFov += (this.targetFov - this.currentFov) * alpha;

    // Re-anchor camera position every frame so external code can never drift it
    this.camera.position.set(cfg.eyePosition.x, cfg.eyePosition.y, cfg.eyePosition.z);
    this.camera.rotation.set(
      this.currentBasePitch + this.currentPitchOffset,
      this.currentBaseYaw + this.currentYawOffset,
      0,
      'YXZ'
    );

    if (Math.abs(this.camera.fov - this.currentFov) > 1e-4 || Math.abs(prevFov - this.currentFov) > 1e-4) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }
}
