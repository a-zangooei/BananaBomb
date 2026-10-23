/**
 * Deterministic Role Visual Style Manager & Operator Tactile Wireframe Pipeline.
 *
 * Implements the 4-pass depth-occluded monochrome wireframe architecture for Operator
 * while supporting zero-leak, atomic role transitions to/from Daylight color mode:
 * - Pass 0 (renderOrder 0): Matte-black depth-writing occluders with polygonOffset(2, 2)
 *   so background lines never bleed through foreground briefcase, module, or table faces.
 * - Pass 1 (renderOrder 1): Crisp white (#f8fafc), zinc (#a1a1aa), and dark-zinc (#52525b)
 *   EdgesGeometry + curved silhouette LineSegments (depthTest: true, depthWrite: false).
 * - Pass 2 (renderOrder 2): Monochrome 2D canvas glyph & hold-progress overlays offset
 *   +2mm..+4mm along surface normals (depthTest: true, depthWrite: false).
 * - Pass 3 (renderOrder 3, LAYER_OPERATOR_RETICLE): Geometric red target reticle (#ef4444)
 *   rendered strictly on the Operator's active/targeted control.
 */
import * as THREE from 'three';
import { WORLD_LAYERS, normalizeWorldRole, setSubtreeLayer } from './camera-rig.js';

export const TACTILE_PALETTE = Object.freeze({
  backgroundHex: 0x050507,
  daylightSkyHex: 0xbae6fd,
  occluderPrimaryHex: 0x09090b,
  occluderContextHex: 0x070709,
  linePrimaryHex: 0xf8fafc,
  lineSecondaryHex: 0xa1a1aa,
  lineContextHex: 0x52525b,
  reticleRedHex: 0xef4444
});

const NOOP_RAYCAST = () => {};

/**
 * Builds an explicit circular wireframe loop (`LineSegments`) for smooth cylinders/knobs
 * whose curved sides have crease angles below EdgesGeometry's threshold.
 */
export function createCircleOutlineGeometry(radius, segments = 24, plane = 'xy', zOffset = 0) {
  const positions = new Float32Array(segments * 2 * 3);
  let ptr = 0;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(a0) * radius;
    const s0 = Math.sin(a0) * radius;
    const c1 = Math.cos(a1) * radius;
    const s1 = Math.sin(a1) * radius;

    if (plane === 'xz') {
      positions[ptr++] = c0;
      positions[ptr++] = zOffset;
      positions[ptr++] = s0;
      positions[ptr++] = c1;
      positions[ptr++] = zOffset;
      positions[ptr++] = s1;
    } else {
      positions[ptr++] = c0;
      positions[ptr++] = s0;
      positions[ptr++] = zOffset;
      positions[ptr++] = c1;
      positions[ptr++] = s1;
      positions[ptr++] = zOffset;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

/**
 * Builds axial + end-cap tactile lines for a horizontal cylinder along X (such as a wire).
 */
export function createHorizontalWireOutlineGeometry(radius, length, radialCount = 4) {
  const halfL = length * 0.5;
  const ringSegs = 12;
  const totalSegments = radialCount + ringSegs * 2;
  const positions = new Float32Array(totalSegments * 2 * 3);
  let ptr = 0;

  // Axial silhouette generators along X
  for (let i = 0; i < radialCount; i++) {
    const ang = (i / radialCount) * Math.PI * 2 + Math.PI * 0.25;
    const ry = Math.cos(ang) * radius;
    const rz = Math.sin(ang) * radius;
    positions[ptr++] = -halfL;
    positions[ptr++] = ry;
    positions[ptr++] = rz;
    positions[ptr++] = halfL;
    positions[ptr++] = ry;
    positions[ptr++] = rz;
  }

  // Left and right end-cap rings in YZ plane
  for (const endX of [-halfL, halfL]) {
    for (let s = 0; s < ringSegs; s++) {
      const a0 = (s / ringSegs) * Math.PI * 2;
      const a1 = ((s + 1) / ringSegs) * Math.PI * 2;
      positions[ptr++] = endX;
      positions[ptr++] = Math.cos(a0) * radius;
      positions[ptr++] = Math.sin(a0) * radius;
      positions[ptr++] = endX;
      positions[ptr++] = Math.cos(a1) * radius;
      positions[ptr++] = Math.sin(a1) * radius;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

export class WorldVisualStyleManager {
  constructor() {
    this.disposables = new Set();
    this.registeredEntries = [];
    this.moduleEdgeDisposables = new Set();
    this.currentRoleKey = 'operator';

    // Shared Pass-0 solid matte-black depth occluder materials
    this.occluderPrimaryMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: TACTILE_PALETTE.occluderPrimaryHex,
        depthTest: true,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2,
        toneMapped: false
      })
    );

    this.occluderContextMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: TACTILE_PALETTE.occluderContextHex,
        depthTest: true,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: 2,
        polygonOffsetUnits: 2,
        toneMapped: false
      })
    );

    // Shared Pass-1 structural outline materials (1px hardware-safe + geometric rings)
    this.linePrimaryMat = this.trackMaterial(
      new THREE.LineBasicMaterial({
        color: TACTILE_PALETTE.linePrimaryHex,
        depthTest: true,
        depthWrite: false,
        toneMapped: false
      })
    );

    this.lineSecondaryMat = this.trackMaterial(
      new THREE.LineBasicMaterial({
        color: TACTILE_PALETTE.lineSecondaryHex,
        depthTest: true,
        depthWrite: false,
        toneMapped: false
      })
    );

    this.lineContextMat = this.trackMaterial(
      new THREE.LineBasicMaterial({
        color: TACTILE_PALETTE.lineContextHex,
        depthTest: true,
        depthWrite: false,
        toneMapped: false
      })
    );

    this.reticleGroup = this.buildOperatorReticle();
    this._scratchWorldPos = new THREE.Vector3();
    this._scratchWorldQuat = new THREE.Quaternion();
  }

  trackGeometry(geo) {
    if (geo) this.disposables.add(geo);
    return geo;
  }

  trackMaterial(mat) {
    if (mat) this.disposables.add(mat);
    return mat;
  }

  trackTexture(tex) {
    if (tex) this.disposables.add(tex);
    return tex;
  }

  getLineMaterialForTier(tier) {
    if (tier === 'context') return this.lineContextMat;
    if (tier === 'secondary') return this.lineSecondaryMat;
    return this.linePrimaryMat;
  }

  /**
   * Registers a static world mesh so it switches atomically between Daylight PBR/Lambert
   * materials and Operator Pass-0 black occluder + Pass-1 structural outlines.
   */
  registerMesh(mesh, options = {}) {
    if (!mesh || !mesh.isMesh || mesh.userData?.skipTactile || mesh.userData?.isTouchHitbox) {
      return mesh;
    }

    const tier = options.tier || 'primary';
    const edgeAngle = options.edgeAngle ?? 20;
    const occluderMat = tier === 'context' ? this.occluderContextMat : this.occluderPrimaryMat;
    const lineMat = this.getLineMaterialForTier(tier);

    mesh.userData.daylightMaterial = mesh.material;
    mesh.userData.tactileOccluderMaterial = occluderMat;

    const edgeGeo = this.trackGeometry(new THREE.EdgesGeometry(mesh.geometry, edgeAngle));
    const edgeLines = new THREE.LineSegments(edgeGeo, lineMat);
    edgeLines.renderOrder = 1;
    edgeLines.raycast = NOOP_RAYCAST;
    edgeLines.userData.isTactileOutline = true;
    edgeLines.layers.mask = mesh.layers.mask;
    mesh.add(edgeLines);

    const extraLines = [];
    if (Array.isArray(options.extraOutlineGeometries)) {
      for (const extraGeo of options.extraOutlineGeometries) {
        this.trackGeometry(extraGeo);
        const extraSeg = new THREE.LineSegments(extraGeo, lineMat);
        extraSeg.renderOrder = 1;
        extraSeg.raycast = NOOP_RAYCAST;
        extraSeg.userData.isTactileOutline = true;
        extraSeg.layers.mask = mesh.layers.mask;
        mesh.add(extraSeg);
        extraLines.push(extraSeg);
      }
    }

    const entry = {
      mesh,
      daylightMaterial: mesh.material,
      occluderMaterial: occluderMat,
      edgeLines,
      extraLines,
      tier,
      hideEdgesInLowSpec: Boolean(options.hideEdgesInLowSpec)
    };
    this.registeredEntries.push(entry);
    return mesh;
  }

  /**
   * Attaches tactile EdgeSegments & polygonOffset depth protection to dynamically rebuilt
   * Operator bomb modules without polluting shared static disposables.
   */
  decorateOperatorModuleSubtree(moduleRoot) {
    if (!moduleRoot) return;
    moduleRoot.traverse((obj) => {
      if (!obj.isMesh) return;
      if (obj.userData?.isTouchHitbox || obj.userData?.skipTactile || obj.userData?.isOverlayPlane) {
        return;
      }

      if (obj.material && !Array.isArray(obj.material)) {
        obj.material.polygonOffset = true;
        obj.material.polygonOffsetFactor = 2;
        obj.material.polygonOffsetUnits = 2;
        obj.renderOrder = 0;
      }

      const edgeGeo = new THREE.EdgesGeometry(obj.geometry, 22);
      this.moduleEdgeDisposables.add(edgeGeo);
      const edgeSeg = new THREE.LineSegments(edgeGeo, this.linePrimaryMat);
      edgeSeg.renderOrder = 1;
      edgeSeg.raycast = NOOP_RAYCAST;
      edgeSeg.userData.isTactileOutline = true;
      obj.add(edgeSeg);
    });
  }

  clearModuleEdgeDisposables() {
    for (const geo of this.moduleEdgeDisposables) {
      try {
        geo.dispose();
      } catch (e) {}
    }
    this.moduleEdgeDisposables.clear();
  }

  /**
   * Builds the hardware-independent geometric Red Target Reticle (#ef4444) on Layer 4.
   * Uses RingGeometry + 4 crosshair tick planes so mobile WebGL 1px line limits never affect it.
   */
  buildOperatorReticle() {
    const group = new THREE.Group();
    group.name = 'OperatorTargetReticle';
    group.visible = false;
    group.renderOrder = 3;
    group.raycast = NOOP_RAYCAST;

    const reticleMat = this.trackMaterial(
      new THREE.MeshBasicMaterial({
        color: TACTILE_PALETTE.reticleRedHex,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
        toneMapped: false
      })
    );

    const ringGeo = this.trackGeometry(new THREE.RingGeometry(0.025, 0.031, 32));
    const ringMesh = new THREE.Mesh(ringGeo, reticleMat);
    ringMesh.renderOrder = 3;
    ringMesh.raycast = NOOP_RAYCAST;
    group.add(ringMesh);

    const innerDotGeo = this.trackGeometry(new THREE.RingGeometry(0.004, 0.0075, 16));
    const innerDotMesh = new THREE.Mesh(innerDotGeo, reticleMat);
    innerDotMesh.renderOrder = 3;
    innerDotMesh.raycast = NOOP_RAYCAST;
    group.add(innerDotMesh);

    const tickHorizGeo = this.trackGeometry(new THREE.PlaneGeometry(0.013, 0.0042));
    const tickVertGeo = this.trackGeometry(new THREE.PlaneGeometry(0.0042, 0.013));

    const offsets = [
      { geo: tickHorizGeo, x: -0.035, y: 0 },
      { geo: tickHorizGeo, x: 0.035, y: 0 },
      { geo: tickVertGeo, x: 0, y: 0.035 },
      { geo: tickVertGeo, x: 0, y: -0.035 }
    ];

    for (const item of offsets) {
      const tick = new THREE.Mesh(item.geo, reticleMat);
      tick.position.set(item.x, item.y, 0);
      tick.renderOrder = 3;
      tick.raycast = NOOP_RAYCAST;
      group.add(tick);
    }

    setSubtreeLayer(group, WORLD_LAYERS.OPERATOR_RETICLE);
    return group;
  }

  /**
   * Positions and displays the Operator red target reticle over a 3D control object.
   */
  showReticleOnObject(targetObj, orientationRefObj = null, isHoldLocked = false) {
    if (!targetObj || this.currentRoleKey !== 'operator') {
      this.hideReticle();
      return;
    }

    targetObj.updateWorldMatrix(true, false);
    targetObj.getWorldPosition(this._scratchWorldPos);

    if (orientationRefObj) {
      orientationRefObj.updateWorldMatrix(true, false);
      orientationRefObj.getWorldQuaternion(this._scratchWorldQuat);
    } else {
      targetObj.getWorldQuaternion(this._scratchWorldQuat);
    }

    this.reticleGroup.position.copy(this._scratchWorldPos);
    this.reticleGroup.quaternion.copy(this._scratchWorldQuat);
    // Lift 6mm along surface outward normal (+Z of ModuleBayRoot)
    this.reticleGroup.translateZ(0.006);
    const scale = isHoldLocked ? 1.14 : 1.0;
    this.reticleGroup.scale.setScalar(scale);
    this.reticleGroup.visible = true;
  }

  hideReticle() {
    this.reticleGroup.visible = false;
  }

  /**
   * Atomically switches the entire world between Operator Tactile Wireframe and Daylight modes.
   */
  applyRoleProfile(role, { scene, lightingGroup, contactShadowsGroup, skyBackdropGroup, lowSpecMode = false } = {}) {
    this.currentRoleKey = normalizeWorldRole(role);
    const isOperator = this.currentRoleKey === 'operator';

    if (scene) {
      if (!scene.background || !scene.background.isColor) {
        scene.background = new THREE.Color(
          isOperator ? TACTILE_PALETTE.backgroundHex : TACTILE_PALETTE.daylightSkyHex
        );
      } else {
        scene.background.setHex(
          isOperator ? TACTILE_PALETTE.backgroundHex : TACTILE_PALETTE.daylightSkyHex
        );
      }
    }

    if (lightingGroup) {
      lightingGroup.visible = !isOperator;
    }
    if (contactShadowsGroup) {
      contactShadowsGroup.visible = !isOperator && !lowSpecMode;
    }
    if (skyBackdropGroup) {
      skyBackdropGroup.visible = !isOperator;
    }

    if (!isOperator) {
      this.hideReticle();
    }

    for (const entry of this.registeredEntries) {
      const { mesh, daylightMaterial, occluderMaterial, edgeLines, extraLines, hideEdgesInLowSpec } = entry;
      // Sync edge line layer masks in case avatar layers were assigned after registration
      edgeLines.layers.mask = mesh.layers.mask;
      mesh.material = isOperator ? occluderMaterial : daylightMaterial;
      mesh.renderOrder = 0;

      const showEdges = isOperator && !(lowSpecMode && hideEdgesInLowSpec);
      edgeLines.visible = showEdges;
      for (const ex of extraLines) {
        ex.layers.mask = mesh.layers.mask;
        ex.visible = showEdges;
      }
    }
  }

  dispose() {
    this.clearModuleEdgeDisposables();
    for (const item of this.disposables) {
      try {
        if (item.map) item.map.dispose();
        item.dispose();
      } catch (e) {}
    }
    this.disposables.clear();
    this.registeredEntries.length = 0;
  }
}
