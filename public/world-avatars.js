/**
 * Stylized Cartoon Monkey Teammates, Role Accessories, Floating Wrist-Only Gloved Hands & 3D Manual Prop.
 *
 * Visual Character Spec:
 * - Warm orange fur (#ea580c), cream belly & muzzle (#fef3c7), armless stylized torsos,
 *   clean wrist-only floating white gloves (#f8fafc) with sealed dark wrist caps (#27272a),
 *   and bold, immediately readable role accessories:
 *   1. Operator (+Z South seat): Dark wrap-around sunglasses (#09090b) + foreground floating gloved hands.
 *   2. Observer (+X East seat): Over-ear cobalt headphones (#1d4ed8) + expressive floating bridge hands.
 *   3. Manual-holder (-Z North seat): Field neckerchief/badge (#7e22ce) + HandheldManualProp3D
 *      whose opaque back cover ('manual_cover') blocks 100% of Observer sightlines to the inner page.
 *
 * Chirality & Occlusion Invariants:
 * - Left and right gloved hands are built with explicit geometric chirality (`side: 'left' | 'right'`)
 *   and positive scale (1, 1, 1) so `matrixWorld.determinant() > 0` on every mesh (zero inverted normals).
 * - Zero forearm fur sleeves (`sleeveGeo`) and zero torso upper-arm stumps exist in the scene.
 * - Each character's head/torso/accessories live on its dedicated body layer (1, 2, or 3) so
 *   the local seated camera never clips inside its own head/accessory, while foreground floating hands
 *   live on WORLD_LAYERS.SHARED (0).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD_LAYERS, setSubtreeLayer } from './camera-rig.js';

function partSphere(r, wSeg, hSeg, sx, sy, sz, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.SphereGeometry(r, wSeg, hSeg).toNonIndexed();
  g.scale(sx, sy, sz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function partBox(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function partCyl(rt, rb, h, segs, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, segs).toNonIndexed();
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

function buildMonkeyUpperBody({ roleType, furMat, creamMat, darkMat, accessoryMat, styleManager }) {
  const group = new THREE.Group();
  group.name = `MonkeyBody_${roleType}`;
  group.userData.isArmlessTorso = true;

  // Local space: monkey sits at local (0, 0, 0) = waist height (world y = 0.72m), facing +Z in local space.
  // Intentionally armless stylized torso so floating gloved hands read as a clean, cohesive character design.
  const furParts = [
    // Smooth armless torso & rounded chest/shoulder cap
    partCyl(0.112, 0.132, 0.3, 12, 0, 0.15, 0),
    partSphere(0.118, 12, 10, 0.96, 0.72, 0.88, 0, 0.275, 0),
    // Head & round monkey ears
    partSphere(0.125, 14, 12, 1.04, 1.0, 0.98, 0, 0.44, 0.01),
    partSphere(0.048, 10, 8, 0.55, 1.0, 0.85, -0.132, 0.44, 0.0),
    partSphere(0.048, 10, 8, 0.55, 1.0, 0.85, 0.132, 0.44, 0.0),
    // Stylized head fur tuft
    partBox(0.045, 0.05, 0.05, 0, 0.565, 0.01, -0.2, 0, 0.15)
  ];
  const furGeo = mergeGeometries(furParts, false);
  furParts.forEach((g) => g.dispose());

  const furMesh = new THREE.Mesh(furGeo, furMat);
  furMesh.name = `MonkeyFurTorsoHead_${roleType}`;
  furMesh.userData.isAvatar = true;
  group.add(furMesh);

  // Cream belly, facial mask, muzzle, and inner ears
  const creamParts = [
    partSphere(0.095, 10, 8, 0.92, 1.18, 0.52, 0, 0.155, 0.088),
    partSphere(0.092, 12, 10, 1.04, 0.88, 0.58, 0, 0.445, 0.088),
    partSphere(0.068, 10, 8, 1.12, 0.76, 0.78, 0, 0.402, 0.118),
    partSphere(0.03, 8, 6, 0.4, 0.8, 0.6, -0.134, 0.44, 0.012),
    partSphere(0.03, 8, 6, 0.4, 0.8, 0.6, 0.134, 0.44, 0.012)
  ];
  const creamGeo = mergeGeometries(creamParts, false);
  creamParts.forEach((g) => g.dispose());

  const creamMesh = new THREE.Mesh(creamGeo, creamMat);
  creamMesh.name = `MonkeyCreamMask_${roleType}`;
  creamMesh.userData.isAvatar = true;
  group.add(creamMesh);

  // Eyes & nose
  const faceParts = [
    partSphere(0.015, 8, 6, 1, 1.15, 0.6, -0.042, 0.462, 0.136),
    partSphere(0.015, 8, 6, 1, 1.15, 0.6, 0.042, 0.462, 0.136),
    partSphere(0.014, 8, 6, 1.2, 0.8, 0.8, 0, 0.422, 0.168)
  ];
  const faceGeo = mergeGeometries(faceParts, false);
  faceParts.forEach((g) => g.dispose());

  const faceMesh = new THREE.Mesh(faceGeo, darkMat);
  faceMesh.name = `MonkeyFaceFeatures_${roleType}`;
  faceMesh.userData.isAvatar = true;
  group.add(faceMesh);

  // Distinct Role-Accurate Accessory
  let accParts = [];
  if (roleType === 'operator') {
    // Dark wrap-around sunglasses + side temples
    accParts = [
      partBox(0.19, 0.052, 0.032, 0, 0.465, 0.136),
      partBox(0.095, 0.044, 0.024, -0.052, 0.465, 0.148),
      partBox(0.095, 0.044, 0.024, 0.052, 0.465, 0.148),
      partBox(0.016, 0.018, 0.13, -0.118, 0.465, 0.075),
      partBox(0.016, 0.018, 0.13, 0.118, 0.465, 0.075)
    ];
  } else if (roleType === 'observer') {
    // Over-ear safety headphones (headband + thick earcups)
    accParts = [
      partBox(0.27, 0.026, 0.038, 0, 0.578, 0.0),
      partBox(0.026, 0.13, 0.036, -0.138, 0.515, 0.0),
      partBox(0.026, 0.13, 0.036, 0.138, 0.515, 0.0),
      partCyl(0.058, 0.058, 0.048, 12, -0.148, 0.445, 0.0, 0, 0, Math.PI * 0.5),
      partCyl(0.058, 0.058, 0.048, 12, 0.148, 0.445, 0.0, 0, 0, Math.PI * 0.5)
    ];
  } else {
    // Manual-holder field neckerchief & silent collar badge
    accParts = [
      partCyl(0.118, 0.132, 0.055, 12, 0, 0.305, 0.01),
      partBox(0.09, 0.075, 0.028, 0, 0.255, 0.118, 0.25, 0, 0)
    ];
  }

  const accGeo = mergeGeometries(accParts, false);
  accParts.forEach((g) => g.dispose());
  const accMesh = new THREE.Mesh(accGeo, accessoryMat);
  accMesh.name = `MonkeyRoleAccessory_${roleType}`;
  accMesh.userData.isAvatar = true;
  group.add(accMesh);

  if (styleManager) {
    for (const [geo, mesh] of [
      [furGeo, furMesh],
      [creamGeo, creamMesh],
      [faceGeo, faceMesh],
      [accGeo, accMesh]
    ]) {
      styleManager.trackGeometry(geo);
      styleManager.registerMesh(mesh, { tier: 'secondary', edgeAngle: 24 });
    }
  }

  return group;
}

/**
 * Builds a clean, wrist-only floating gloved hand with explicit left/right chirality
 * and a sealed recessed wrist cap (zero forearm sleeve cylinders and zero negative scaling).
 */
export function buildGlovedHandUnit({ side = 'right', gloveMat, cuffSealMat, styleManager }) {
  const resolvedSide = side === 'left' ? 'left' : 'right';
  // In local space, fingers extend toward -Z and palm faces -Y.
  // Medial (thumb) side is +X for the left hand and -X for the right hand.
  const thumbSign = resolvedSide === 'left' ? 1 : -1;

  const handGroup = new THREE.Group();
  handGroup.name = `FloatingGlovedHand_${resolvedSide}`;
  handGroup.userData.isFloatingGlovedHand = true;
  handGroup.userData.handSide = resolvedSide;

  const gloveParts = [
    // Rolled cartoon wrist cuff collar (closed cylinder + rounded roll)
    partCyl(0.034, 0.032, 0.024, 12, 0, 0.004, 0.018, Math.PI * 0.48, 0, 0),
    partSphere(0.033, 10, 8, 1.04, 0.88, 0.56, 0, 0.004, 0.018),
    // Sculpted rounded palm
    partSphere(0.035, 12, 10, 1.06, 0.64, 1.12, 0, 0, -0.016),
    // Chirality-accurate inward thumb (base + tip)
    partSphere(0.015, 8, 6, 1.0, 0.82, 1.25, thumbSign * 0.031, -0.003, -0.011, 0, thumbSign * -0.38, 0),
    partSphere(0.013, 8, 6, 0.95, 0.82, 1.18, thumbSign * 0.04, -0.004, -0.025, 0, thumbSign * -0.22, 0),
    // Four articulated cartoon fingers ordered anatomically from index to pinky
    partBox(0.013, 0.014, 0.035, thumbSign * 0.021, -0.002, -0.052, 0.08, 0, 0),
    partBox(0.0135, 0.0145, 0.039, thumbSign * 0.007, -0.001, -0.055, 0.08, 0, 0),
    partBox(0.013, 0.014, 0.036, thumbSign * -0.007, -0.002, -0.053, 0.08, 0, 0),
    partBox(0.012, 0.013, 0.031, thumbSign * -0.021, -0.003, -0.049, 0.08, 0, 0)
  ];
  const gloveGeo = mergeGeometries(gloveParts, false);
  gloveParts.forEach((g) => g.dispose());

  const gloveMesh = new THREE.Mesh(gloveGeo, gloveMat);
  gloveMesh.name = `GloveBody_${resolvedSide}`;
  gloveMesh.userData.isAvatar = true;
  gloveMesh.userData.isGloveBody = true;
  handGroup.add(gloveMesh);

  // Recessed closed wrist seal cap closing the back of the cuff cleanly from every angle
  const cuffCapGeo = partCyl(0.026, 0.026, 0.006, 12, 0, 0.005, 0.029, Math.PI * 0.48, 0, 0);
  const cuffCapMesh = new THREE.Mesh(cuffCapGeo, cuffSealMat);
  cuffCapMesh.name = `GloveWristSealCap_${resolvedSide}`;
  cuffCapMesh.userData.isAvatar = true;
  cuffCapMesh.userData.isWristCap = true;
  handGroup.add(cuffCapMesh);

  handGroup.userData.gloveMesh = gloveMesh;
  handGroup.userData.cuffCapMesh = cuffCapMesh;

  if (styleManager) {
    styleManager.trackGeometry(gloveGeo);
    styleManager.trackGeometry(cuffCapGeo);
    styleManager.registerMesh(gloveMesh, { tier: 'secondary', edgeAngle: 24 });
    styleManager.registerMesh(cuffCapMesh, { tier: 'secondary', edgeAngle: 24 });
  }

  return handGroup;
}

export function buildWorldAvatars({ styleManager = null } = {}) {
  const root = new THREE.Group();
  root.name = 'WorldAvatarsRoot';

  const furMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.78, metalness: 0.04 });
  const creamMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.75, metalness: 0.03 });
  const gloveMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.56, metalness: 0.05 });
  const cuffSealMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.72, metalness: 0.12 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.28, metalness: 0.35 });
  const headphoneMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.42, metalness: 0.22 });
  const manualScarfMat = new THREE.MeshStandardMaterial({ color: 0x7e22ce, roughness: 0.65, metalness: 0.08 });

  if (styleManager) {
    for (const m of [furMat, creamMat, gloveMat, cuffSealMat, darkMat, headphoneMat, manualScarfMat]) {
      styleManager.trackMaterial(m);
    }
  }

  // --- 1. Operator Monkey (South +Z bench facing North -Z) ---
  const operatorBody = buildMonkeyUpperBody({
    roleType: 'operator',
    furMat,
    creamMat,
    darkMat,
    accessoryMat: darkMat,
    styleManager
  });
  operatorBody.position.set(0.0, 0.73, 0.58);
  operatorBody.rotation.y = Math.PI; // Faces North (-Z)
  setSubtreeLayer(operatorBody, WORLD_LAYERS.OPERATOR_BODY);
  root.add(operatorBody);

  // Operator Foreground Floating Hands on SHARED layer 0 (South edge of table, clear of briefcase)
  const operatorHandsGroup = new THREE.Group();
  operatorHandsGroup.name = 'OperatorForegroundHands';

  const opLeftRest = new THREE.Vector3(-0.205, 0.768, 0.315);
  const opRightRest = new THREE.Vector3(0.205, 0.768, 0.315);

  const opLeftHand = buildGlovedHandUnit({ side: 'left', gloveMat, cuffSealMat, styleManager });
  opLeftHand.name = 'OperatorLeftHand';
  opLeftHand.position.copy(opLeftRest);
  operatorHandsGroup.add(opLeftHand);

  const opRightHand = buildGlovedHandUnit({ side: 'right', gloveMat, cuffSealMat, styleManager });
  opRightHand.name = 'OperatorRightHand';
  opRightHand.position.copy(opRightRest);
  operatorHandsGroup.add(opRightHand);

  setSubtreeLayer(operatorHandsGroup, WORLD_LAYERS.SHARED);
  root.add(operatorHandsGroup);

  // --- 2. Observer Monkey (East +X lateral seat facing West -X) ---
  const observerBody = buildMonkeyUpperBody({
    roleType: 'observer',
    furMat,
    creamMat,
    darkMat,
    accessoryMat: headphoneMat,
    styleManager
  });
  observerBody.position.set(0.75, 0.72, 0.06);
  observerBody.rotation.y = -Math.PI * 0.5; // Faces West (-X)
  setSubtreeLayer(observerBody, WORLD_LAYERS.OBSERVER_BODY);
  root.add(observerBody);

  // Observer Foreground Floating Hands on SHARED layer 0 (wide Z spacing so 0% lateral clue occlusion)
  const observerHandsGroup = new THREE.Group();
  observerHandsGroup.name = 'ObserverForegroundHands';

  const obsNorthHand = buildGlovedHandUnit({ side: 'right', gloveMat, cuffSealMat, styleManager });
  obsNorthHand.name = 'ObserverRightHand';
  obsNorthHand.position.set(0.465, 0.768, -0.235);
  obsNorthHand.rotation.y = Math.PI * 0.5;
  observerHandsGroup.add(obsNorthHand);

  const obsSouthHand = buildGlovedHandUnit({ side: 'left', gloveMat, cuffSealMat, styleManager });
  obsSouthHand.name = 'ObserverLeftHand';
  obsSouthHand.position.set(0.465, 0.768, 0.295);
  obsSouthHand.rotation.y = Math.PI * 0.5;
  observerHandsGroup.add(obsSouthHand);

  setSubtreeLayer(observerHandsGroup, WORLD_LAYERS.SHARED);
  root.add(observerHandsGroup);

  // --- 3. Manual-holder Monkey (North -Z bench facing South +Z) ---
  const manualBody = buildMonkeyUpperBody({
    roleType: 'manual',
    furMat,
    creamMat,
    darkMat,
    accessoryMat: manualScarfMat,
    styleManager
  });
  manualBody.position.set(0.0, 0.72, -0.75);
  manualBody.rotation.y = 0; // Faces South (+Z)
  setSubtreeLayer(manualBody, WORLD_LAYERS.MANUAL_BODY);
  root.add(manualBody);

  // --- 4. Manual-holder Floating Hands & HandheldManualProp3D ---
  // Positioned at North-East table zone (+0.17, 0.845, -0.46), angled toward Manual-holder
  // at (0, 1.16, -0.64) so Manual-holder sees 5/5 of the inner page while the opaque back cover
  // + side privacy wings ('manual_cover') directly block 100% of Observer (+0.64, 1.16, +0.06) rays!
  const manualPropGroup = new THREE.Group();
  manualPropGroup.name = 'HandheldManualProp3D';
  manualPropGroup.position.set(0.17, 0.845, -0.46);
  manualPropGroup.rotation.set(
    THREE.MathUtils.degToRad(34),
    THREE.MathUtils.degToRad(-14),
    0
  );

  const coverParts = [
    // Solid outer binder back cover (local z ∈ [+0.002, +0.018], oversized 0.28m × 0.19m)
    partBox(0.28, 0.19, 0.016, 0, 0, 0.01),
    // Side & top privacy wings extending toward -Z so lateral Observer rays hit 'manual_cover'
    partBox(0.016, 0.19, 0.044, 0.132, 0, -0.012),
    partBox(0.016, 0.19, 0.044, -0.132, 0, -0.012),
    partBox(0.28, 0.016, 0.044, 0, 0.087, -0.012)
  ];
  const coverGeo = mergeGeometries(coverParts, false);
  coverParts.forEach((g) => g.dispose());

  const coverMat = new THREE.MeshStandardMaterial({
    color: 0x4c1d95,
    roughness: 0.68,
    metalness: 0.12
  });
  const manualBackCoverMesh = new THREE.Mesh(coverGeo, coverMat);
  manualBackCoverMesh.name = 'ManualPropBackCover';
  manualBackCoverMesh.userData.isAvatar = true;
  manualBackCoverMesh.userData.occluderId = 'manual_cover';
  manualBackCoverMesh.userData.surfaceRole = 'manual_cover';
  manualPropGroup.add(manualBackCoverMesh);

  // Inner rulebook page facing -Z (strictly toward Manual-holder)
  const pageGeo = new THREE.PlaneGeometry(0.18, 0.125);
  pageGeo.rotateY(Math.PI); // Outward normal points along binder local -Z toward Manual-holder
  const pageMat = new THREE.MeshStandardMaterial({
    color: 0xfef3c7,
    roughness: 0.88,
    metalness: 0.02
  });
  const manualInnerPageMesh = new THREE.Mesh(pageGeo, pageMat);
  manualInnerPageMesh.name = 'ManualPropInnerPage';
  manualInnerPageMesh.position.set(0, -0.004, 0.0);
  manualInnerPageMesh.userData.isAvatar = true;
  manualInnerPageMesh.userData.clueId = 'manual_inner_page';
  manualInnerPageMesh.userData.surfaceRole = 'manual_inner_page';
  manualPropGroup.add(manualInnerPageMesh);

  // Manual-holder's floating gloved hands holding the binder & resting for gestures
  const manRightHand = buildGlovedHandUnit({ side: 'right', gloveMat, cuffSealMat, styleManager });
  manRightHand.name = 'ManualRightHand';
  manRightHand.position.set(-0.18, 0.772, -0.34);
  manRightHand.rotation.y = Math.PI;
  root.add(manRightHand);

  const manLeftHand = buildGlovedHandUnit({ side: 'left', gloveMat, cuffSealMat, styleManager });
  manLeftHand.name = 'ManualLeftHand';
  manLeftHand.position.set(0.295, 0.818, -0.465);
  manLeftHand.rotation.y = Math.PI;
  root.add(manLeftHand);

  if (styleManager) {
    styleManager.trackGeometry(coverGeo);
    styleManager.trackMaterial(coverMat);
    styleManager.registerMesh(manualBackCoverMesh, { tier: 'secondary', edgeAngle: 22 });

    styleManager.trackGeometry(pageGeo);
    styleManager.trackMaterial(pageMat);
    styleManager.registerMesh(manualInnerPageMesh, { tier: 'secondary', edgeAngle: 22 });
  }

  setSubtreeLayer(manualPropGroup, WORLD_LAYERS.SHARED);
  setSubtreeLayer(manRightHand, WORLD_LAYERS.SHARED);
  setSubtreeLayer(manLeftHand, WORLD_LAYERS.SHARED);
  root.add(manualPropGroup);

  const hands = [
    opLeftHand,
    opRightHand,
    obsNorthHand,
    obsSouthHand,
    manRightHand,
    manLeftHand
  ];

  /**
   * Subtle reach offset for Operator's nearer foreground floating gloved hand during active press/hold,
   * staying South/below the active control so it never occludes progress rings or labels.
   */
  function setActiveReachTarget(worldTargetPos) {
    if (!worldTargetPos) {
      opLeftHand.position.copy(opLeftRest);
      opRightHand.position.copy(opRightRest);
      return;
    }
    const useLeft = worldTargetPos.x < 0;
    const activeHand = useLeft ? opLeftHand : opRightHand;
    const idleHand = useLeft ? opRightHand : opLeftHand;
    const activeRest = useLeft ? opLeftRest : opRightRest;
    const idleRest = useLeft ? opRightRest : opLeftRest;

    idleHand.position.copy(idleRest);
    activeHand.position.set(
      THREE.MathUtils.lerp(activeRest.x, worldTargetPos.x, 0.35),
      activeRest.y + 0.014,
      THREE.MathUtils.lerp(activeRest.z, Math.max(0.245, worldTargetPos.z + 0.14), 0.45)
    );
  }

  return {
    root,
    operatorBody,
    observerBody,
    manualBody,
    operatorHandsGroup,
    observerHandsGroup,
    manualPropGroup,
    manualBackCoverMesh,
    manualInnerPageMesh,
    hands,
    setActiveReachTarget
  };
}
