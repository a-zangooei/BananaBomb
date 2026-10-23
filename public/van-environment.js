/**
 * Stylized Low-Poly Compact Van Interior, Green-Top Table & Curated Background Props.
 *
 * Coordinate System (Right-Handed, 1.000 unit = 1.000 meter):
 * - Wooden plank floor at y = 0.000m (x ∈ [-1.05, +1.05], z ∈ [-1.35, +1.35]).
 * - Light-blue interior van walls (#93c5fd) with bright West/East/Rear window cutouts.
 * - Warm wooden benches + West side shelf (#b45309 / #92400e).
 * - Central wooden table with #15803d green baize top at exact world y = 0.740m
 *   (x ∈ [-0.525, +0.525], z ∈ [-0.380, +0.380]).
 * - Curated low-poly props on West shelf & floor (small retro radio, two bottles,
 *   banana snack box, and orange basketball) kept strictly outside all gameplay sightlines.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCanvas2D } from './modules/canvas-utils.js';

const NOOP_RAYCAST = () => {};

function boxAt(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  return g;
}

function cylAt(rTop, rBot, h, segs, x, y, z, rotX = 0, rotZ = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, segs).toNonIndexed();
  if (rotX) g.rotateX(rotX);
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  return g;
}

function createSoftShadowTexture() {
  const canvas = createCanvas2D(128, 128);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  const grad = typeof ctx.createRadialGradient === 'function'
    ? ctx.createRadialGradient(64, 64, 10, 64, 64, 62)
    : null;
  if (grad && typeof grad.addColorStop === 'function') {
    grad.addColorStop(0, 'rgba(2, 6, 23, 0.42)');
    grad.addColorStop(0.65, 'rgba(2, 6, 23, 0.18)');
    grad.addColorStop(1, 'rgba(2, 6, 23, 0)');
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = 'rgba(2, 6, 23, 0.24)';
  }
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export function buildVanEnvironment({ styleManager = null } = {}) {
  const root = new THREE.Group();
  root.name = 'VanEnvironmentRoot';

  // --- 1. Central Table (Warm Wood Frame + #15803d Green Baize Top at exact y = 0.740m) ---
  const tableGroup = new THREE.Group();
  tableGroup.name = 'CentralTableGroup';

  const tableTopGeo = boxAt(1.05, 0.026, 0.76, 0, 0.74 - 0.013, 0);
  const tableTopMat = new THREE.MeshStandardMaterial({
    color: 0x15803d,
    roughness: 0.84,
    metalness: 0.04
  });
  const tableTopMesh = new THREE.Mesh(tableTopGeo, tableTopMat);
  tableTopMesh.name = 'TableGreenTopMesh';
  tableTopMesh.userData.occluderId = 'van_table';
  tableTopMesh.userData.surfaceRole = 'table_top';
  tableGroup.add(tableTopMesh);

  const tableWoodParts = [
    // Wooden rim & apron directly beneath green top (y: 0.680 .. 0.727)
    boxAt(1.09, 0.036, 0.022, 0, 0.718, -0.386),
    boxAt(1.09, 0.036, 0.022, 0, 0.718, 0.386),
    boxAt(0.022, 0.036, 0.75, -0.534, 0.718, 0),
    boxAt(0.022, 0.036, 0.75, 0.534, 0.718, 0),
    boxAt(0.96, 0.045, 0.68, 0, 0.692, 0),
    // Four sturdy wooden table legs (y: 0.000 .. 0.690)
    boxAt(0.055, 0.69, 0.055, -0.45, 0.345, -0.31),
    boxAt(0.055, 0.69, 0.055, 0.45, 0.345, -0.31),
    boxAt(0.055, 0.69, 0.055, -0.45, 0.345, 0.31),
    boxAt(0.055, 0.69, 0.055, 0.45, 0.345, 0.31)
  ];
  const tableWoodGeo = mergeGeometries(tableWoodParts, false);
  tableWoodParts.forEach((g) => g.dispose());

  const warmWoodMat = new THREE.MeshStandardMaterial({
    color: 0xb45309,
    roughness: 0.76,
    metalness: 0.06
  });
  const tableWoodMesh = new THREE.Mesh(tableWoodGeo, warmWoodMat);
  tableWoodMesh.name = 'TableWoodFrameMesh';
  tableWoodMesh.userData.occluderId = 'van_table';
  tableWoodMesh.userData.surfaceRole = 'table_frame';
  tableGroup.add(tableWoodMesh);

  root.add(tableGroup);

  // --- 2. Compact Van Cabin Shell (Light-Blue Interior Panels #93c5fd) ---
  const vanPanelParts = [
    // Roof ceiling panel (y = 1.72 .. 1.77)
    boxAt(2.14, 0.05, 2.74, 0, 1.745, 0),
    // West (-X) wall with two large daylight windows (z ∈ [-0.88, -0.14] and [+0.14, +0.88], y ∈ [0.88, 1.48])
    boxAt(0.05, 0.88, 2.7, -1.05, 0.44, 0),
    boxAt(0.05, 0.24, 2.7, -1.05, 1.6, 0),
    boxAt(0.05, 0.6, 0.47, -1.05, 1.18, -1.115),
    boxAt(0.05, 0.6, 0.28, -1.05, 1.18, 0),
    boxAt(0.05, 0.6, 0.47, -1.05, 1.18, 1.115),
    // East (+X) wall behind Observer with upper window band (y ∈ [1.18, 1.50], z ∈ [-0.75, +0.75])
    boxAt(0.05, 1.18, 2.7, 1.05, 0.59, 0),
    boxAt(0.05, 0.22, 2.7, 1.05, 1.61, 0),
    boxAt(0.05, 0.32, 0.6, 1.05, 1.34, -1.05),
    boxAt(0.05, 0.32, 0.6, 1.05, 1.34, 1.05),
    // North (-Z) bulkhead wall behind Manual-holder with upper cab window (y ∈ [1.05, 1.48], x ∈ [-0.58, +0.58])
    boxAt(2.05, 1.05, 0.05, 0, 0.525, -1.35),
    boxAt(2.05, 0.24, 0.05, 0, 1.6, -1.35),
    boxAt(0.44, 0.43, 0.05, -0.8, 1.265, -1.35),
    boxAt(0.44, 0.43, 0.05, 0.8, 1.265, -1.35),
    // South (+Z) rear double-door wall behind Operator with twin rear windows
    boxAt(2.05, 1.04, 0.05, 0, 0.52, 1.35),
    boxAt(2.05, 0.24, 0.05, 0, 1.6, 1.35),
    boxAt(0.36, 0.44, 0.05, -0.84, 1.26, 1.35),
    boxAt(0.14, 0.44, 0.05, 0, 1.26, 1.35),
    boxAt(0.36, 0.44, 0.05, 0.84, 1.26, 1.35)
  ];
  const vanPanelsGeo = mergeGeometries(vanPanelParts, false);
  vanPanelParts.forEach((g) => g.dispose());

  const vanPanelMat = new THREE.MeshStandardMaterial({
    color: 0x93c5fd,
    roughness: 0.72,
    metalness: 0.08
  });
  const vanPanelsMesh = new THREE.Mesh(vanPanelsGeo, vanPanelMat);
  vanPanelsMesh.name = 'VanCabinPanelsMesh';
  vanPanelsMesh.userData.occluderId = 'van_wall';
  root.add(vanPanelsMesh);

  // Window rubber gaskets & ceiling structural ribs
  const trimParts = [
    boxAt(0.06, 0.025, 0.76, -1.035, 0.88, -0.51),
    boxAt(0.06, 0.025, 0.76, -1.035, 1.48, -0.51),
    boxAt(0.06, 0.025, 0.76, -1.035, 0.88, 0.51),
    boxAt(0.06, 0.025, 0.76, -1.035, 1.48, 0.51),
    boxAt(2.02, 0.035, 0.045, 0, 1.705, -0.55),
    boxAt(2.02, 0.035, 0.045, 0, 1.705, 0.55)
  ];
  const trimGeo = mergeGeometries(trimParts, false);
  trimParts.forEach((g) => g.dispose());

  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.65,
    metalness: 0.25
  });
  const trimMesh = new THREE.Mesh(trimGeo, trimMat);
  trimMesh.name = 'VanTrimMesh';
  trimMesh.userData.occluderId = 'van_wall';
  root.add(trimMesh);

  // --- 3. Wooden Floor, Benches & West Storage Shelf ---
  const floorAndBenchParts = [
    // Floor planks (top at y = 0.000m)
    boxAt(2.14, 0.04, 2.74, 0, -0.02, 0),
    // South bench (Operator)
    boxAt(1.12, 0.05, 0.36, 0, 0.44, 0.66),
    boxAt(1.04, 0.42, 0.3, 0, 0.21, 0.68),
    // North bench (Manual-holder)
    boxAt(1.12, 0.05, 0.36, 0, 0.44, -0.74),
    boxAt(1.04, 0.42, 0.3, 0, 0.21, -0.76),
    // East lateral bench (Observer)
    boxAt(0.34, 0.05, 0.74, 0.76, 0.44, 0.06),
    boxAt(0.28, 0.42, 0.66, 0.78, 0.21, 0.06),
    // West side shelf & cabinet counter (x ∈ [-1.02, -0.74], top at y = 0.72m)
    boxAt(0.28, 0.036, 1.68, -0.88, 0.702, -0.04),
    boxAt(0.25, 0.68, 1.62, -0.895, 0.34, -0.04)
  ];
  const floorAndBenchGeo = mergeGeometries(floorAndBenchParts, false);
  floorAndBenchParts.forEach((g) => g.dispose());

  const floorWoodMat = new THREE.MeshStandardMaterial({
    color: 0x92400e,
    roughness: 0.82,
    metalness: 0.04
  });
  const floorAndBenchMesh = new THREE.Mesh(floorAndBenchGeo, floorWoodMat);
  floorAndBenchMesh.name = 'VanWoodenBenchesAndFloorMesh';
  floorAndBenchMesh.userData.occluderId = 'van_furniture';
  root.add(floorAndBenchMesh);

  // --- 4. Curated Low-Poly Background Props (Strictly on West Shelf & Floor) ---
  const curatedPropsGroup = new THREE.Group();
  curatedPropsGroup.name = 'CuratedVanPropsGroup';

  // Prop A: Small retro radio on West shelf (x = -0.86, y = 0.72..0.84, z = -0.54)
  const radioBodyGeo = mergeGeometries(
    [
      boxAt(0.11, 0.11, 0.21, -0.86, 0.775, -0.54),
      boxAt(0.02, 0.03, 0.13, -0.86, 0.845, -0.54),
      cylAt(0.005, 0.005, 0.16, 6, -0.86, 0.89, -0.61, -0.25, 0)
    ],
    false
  );
  const radioMat = new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.55, metalness: 0.18 });
  const radioMesh = new THREE.Mesh(radioBodyGeo, radioMat);
  radioMesh.userData.occluderId = 'van_prop';
  curatedPropsGroup.add(radioMesh);

  // Prop B: Two water/soda bottles on West shelf (z = +0.36 and +0.48)
  const bottlesGeo = mergeGeometries(
    [
      cylAt(0.032, 0.035, 0.15, 10, -0.85, 0.795, 0.36),
      cylAt(0.015, 0.022, 0.05, 8, -0.85, 0.895, 0.36),
      cylAt(0.03, 0.032, 0.13, 10, -0.89, 0.785, 0.48),
      cylAt(0.014, 0.02, 0.045, 8, -0.89, 0.87, 0.48)
    ],
    false
  );
  const bottlesMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.32, metalness: 0.12 });
  const bottlesMesh = new THREE.Mesh(bottlesGeo, bottlesMat);
  bottlesMesh.userData.occluderId = 'van_prop';
  curatedPropsGroup.add(bottlesMesh);

  // Prop C: Yellow Banana Snack Box on West shelf (x = -0.85, y = 0.72..0.83, z = -0.06)
  const snackGeo = boxAt(0.14, 0.11, 0.2, -0.85, 0.775, -0.06);
  const snackMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.68, metalness: 0.05 });
  const snackMesh = new THREE.Mesh(snackGeo, snackMat);
  snackMesh.userData.occluderId = 'van_prop';
  curatedPropsGroup.add(snackMesh);

  // Prop D: Low-poly Basketball on floor near West shelf (x = -0.66, y = 0.11, z = +0.52)
  const ballGeo = new THREE.IcosahedronGeometry(0.11, 1);
  ballGeo.translate(-0.66, 0.11, 0.52);
  const ballMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.74, metalness: 0.04 });
  const ballMesh = new THREE.Mesh(ballGeo, ballMat);
  ballMesh.userData.occluderId = 'van_prop';
  curatedPropsGroup.add(ballMesh);

  root.add(curatedPropsGroup);

  // --- 5. Bright Daytime Sky Backdrop Outside Windows (Daylight Only) ---
  const skyBackdropGroup = new THREE.Group();
  skyBackdropGroup.name = 'DaylightSkyBackdropGroup';

  const skyMat = new THREE.MeshBasicMaterial({
    color: 0xe0f2fe,
    side: THREE.DoubleSide,
    toneMapped: false
  });
  const horizonMat = new THREE.MeshBasicMaterial({
    color: 0xfef3c7,
    side: THREE.DoubleSide,
    toneMapped: false
  });

  const westSkyGeo = new THREE.PlaneGeometry(3.2, 1.5);
  westSkyGeo.rotateY(Math.PI * 0.5);
  const westSkyMesh = new THREE.Mesh(westSkyGeo, skyMat);
  westSkyMesh.position.set(-1.35, 1.25, 0);
  westSkyMesh.raycast = NOOP_RAYCAST;
  westSkyMesh.userData.skipTactile = true;
  skyBackdropGroup.add(westSkyMesh);

  const westHorizonGeo = new THREE.PlaneGeometry(3.2, 0.45);
  westHorizonGeo.rotateY(Math.PI * 0.5);
  const westHorizonMesh = new THREE.Mesh(westHorizonGeo, horizonMat);
  westHorizonMesh.position.set(-1.33, 0.85, 0);
  westHorizonMesh.raycast = NOOP_RAYCAST;
  westHorizonMesh.userData.skipTactile = true;
  skyBackdropGroup.add(westHorizonMesh);

  root.add(skyBackdropGroup);

  // --- 6. Cheap Baked-Style Radial Contact Shadow Decals (Daylight Only) ---
  const contactShadowsGroup = new THREE.Group();
  contactShadowsGroup.name = 'ContactShadowsGroup';

  const shadowTex = createSoftShadowTexture();
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    toneMapped: false
  });

  // Briefcase contact shadow on y = 0.740m green tabletop
  const caseShadowGeo = new THREE.PlaneGeometry(0.68, 0.52);
  caseShadowGeo.rotateX(-Math.PI * 0.5);
  const caseShadowMesh = new THREE.Mesh(caseShadowGeo, shadowMat);
  caseShadowMesh.position.set(0, 0.7408, 0.04);
  caseShadowMesh.renderOrder = 1;
  caseShadowMesh.raycast = NOOP_RAYCAST;
  caseShadowMesh.userData.skipTactile = true;
  contactShadowsGroup.add(caseShadowMesh);

  // Table footprint contact shadow on y = 0.000m floor
  const tableShadowGeo = new THREE.PlaneGeometry(1.24, 0.94);
  tableShadowGeo.rotateX(-Math.PI * 0.5);
  const tableShadowMesh = new THREE.Mesh(tableShadowGeo, shadowMat);
  tableShadowMesh.position.set(0, 0.002, 0);
  tableShadowMesh.renderOrder = 1;
  tableShadowMesh.raycast = NOOP_RAYCAST;
  tableShadowMesh.userData.skipTactile = true;
  contactShadowsGroup.add(tableShadowMesh);

  root.add(contactShadowsGroup);

  if (styleManager) {
    styleManager.trackGeometry(tableTopGeo);
    styleManager.trackMaterial(tableTopMat);
    styleManager.registerMesh(tableTopMesh, { tier: 'secondary', edgeAngle: 20 });

    styleManager.trackGeometry(tableWoodGeo);
    styleManager.trackMaterial(warmWoodMat);
    styleManager.registerMesh(tableWoodMesh, { tier: 'secondary', edgeAngle: 25 });

    styleManager.trackGeometry(vanPanelsGeo);
    styleManager.trackMaterial(vanPanelMat);
    styleManager.registerMesh(vanPanelsMesh, {
      tier: 'context',
      edgeAngle: 28,
      hideEdgesInLowSpec: true
    });

    styleManager.trackGeometry(trimGeo);
    styleManager.trackMaterial(trimMat);
    styleManager.registerMesh(trimMesh, {
      tier: 'context',
      edgeAngle: 28,
      hideEdgesInLowSpec: true
    });

    styleManager.trackGeometry(floorAndBenchGeo);
    styleManager.trackMaterial(floorWoodMat);
    styleManager.registerMesh(floorAndBenchMesh, {
      tier: 'context',
      edgeAngle: 28,
      hideEdgesInLowSpec: true
    });

    for (const [geo, mat, mesh] of [
      [radioBodyGeo, radioMat, radioMesh],
      [bottlesGeo, bottlesMat, bottlesMesh],
      [snackGeo, snackMat, snackMesh],
      [ballGeo, ballMat, ballMesh]
    ]) {
      styleManager.trackGeometry(geo);
      styleManager.trackMaterial(mat);
      styleManager.registerMesh(mesh, {
        tier: 'context',
        edgeAngle: 28,
        hideEdgesInLowSpec: true
      });
    }

    styleManager.trackGeometry(westSkyGeo);
    styleManager.trackGeometry(westHorizonGeo);
    styleManager.trackMaterial(skyMat);
    styleManager.trackMaterial(horizonMat);

    styleManager.trackGeometry(caseShadowGeo);
    styleManager.trackGeometry(tableShadowGeo);
    styleManager.trackMaterial(shadowMat);
    styleManager.trackTexture(shadowTex);
  }

  return {
    root,
    tableGroup,
    tableTopMesh,
    tableWoodMesh,
    vanPanelsMesh,
    curatedPropsGroup,
    skyBackdropGroup,
    contactShadowsGroup
  };
}
