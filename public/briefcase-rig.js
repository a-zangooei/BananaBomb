/**
 * Hard-Shell Briefcase Bomb Rig & Exact North-Hinge Occlusion Geometry.
 *
 * Coordinate Specification (1.000 unit = 1.000 meter, Right-Handed):
 * - BriefcaseBombRig world origin: (0.000, 0.740, +0.040), resting flush on the y = 0.740m green tabletop.
 * - Rig origin (0, 0, 0) = center of the bottom outer footprint on the tabletop contact plane.
 * - LowerCaseShell local AABB: x ∈ [-0.280, +0.280], y ∈ [0.000, +0.080], z ∈ [-0.210, +0.210]
 *   (world y ∈ [0.740, 0.820], world z ∈ [-0.170, +0.250]).
 * - HingePivotGroup: child of BriefcaseBombRig at rig-local (0.000, +0.080, -0.210)
 *   = world (0.000, 0.820, -0.170), rotating strictly around +X.
 * - UpperCaseLidShell: constructed FLAT horizontally in HingePivotGroup local space:
 *   hinge-local x ∈ [-0.280, +0.280], y ∈ [0.000, +0.055], z ∈ [0.000, +0.420].
 *   * Closed (θ = 0°): lies flat on world y ∈ [0.820, 0.875], z ∈ [-0.170, +0.250].
 *   * Open (θ = -95° = -1.65806 rad): rotates upward around North hinge to world AABB
 *     x ∈ [-0.280, +0.280], y ∈ [0.815, 1.238], z ∈ [-0.261, -0.170], physically blocking
 *     100% of Manual-holder (-Z) sightlines into ModuleBayRoot while leaving Operator (+Z)
 *     and Observer (+X lateral) 100% unobstructed.
 * - ModuleBayRoot & ExteriorSerialPlate are siblings of HingePivotGroup under BriefcaseBombRig
 *   so lid rotation never perturbs module world transforms or raycast hitboxes.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCanvas2D } from './modules/canvas-utils.js';

export const BRIEFCASE_SPEC = Object.freeze({
  worldOrigin: Object.freeze({ x: 0.0, y: 0.74, z: 0.04 }),
  width: 0.56,
  depth: 0.42,
  lowerHeight: 0.08,
  wallThickness: 0.02,
  innerDeckY: 0.032,
  lidThickness: 0.055,
  hingeLocalPos: Object.freeze({ x: 0.0, y: 0.08, z: -0.21 }),
  closedAngleRad: 0,
  openAngleDeg: -95,
  openAngleRad: (-95 * Math.PI) / 180,
  moduleBayLocalPos: Object.freeze({ x: 0.0, y: 0.058, z: 0.005 }),
  moduleBayTiltDeg: -82,
  moduleBayScale: 0.144,
  serialPlateLocalPos: Object.freeze({ x: 0.2815, y: 0.042, z: 0.0 }),
  morseLampLocalPos: Object.freeze({ x: -0.308, y: 0.092, z: 0.136 })
});

const MORSE_DOT_MS = 240;
const MORSE_DASH_MS = 720;
const MORSE_INTRA_GAP_MS = 240;
const MORSE_WORD_PAUSE_MS = 1200;
const MORSE_RAMP_MS = 36;

/**
 * Pure, silent time-based Optical Morse pulse evaluator.
 * Maps an ITU Morse beat array (`1` = dot ·, `3` = dash —) and `elapsedMs` into deterministic
 * lamp state without timers or audio side effects.
 */
export function computeOpticalMorseLampState(
  beats,
  elapsedMs = 0,
  { reducedMotion = false, solved = false } = {}
) {
  if (solved) {
    return {
      active: true,
      lit: true,
      beatIndex: -1,
      beatType: 'solved',
      intensity: 1
    };
  }

  if (!Array.isArray(beats) || beats.length === 0) {
    return {
      active: false,
      lit: false,
      beatIndex: -1,
      beatType: 'idle',
      intensity: 0
    };
  }

  let cycleDurationMs = MORSE_WORD_PAUSE_MS;
  for (let i = 0; i < beats.length; i++) {
    const isDash = Number(beats[i]) >= 2;
    cycleDurationMs += (isDash ? MORSE_DASH_MS : MORSE_DOT_MS) + MORSE_INTRA_GAP_MS;
  }

  const safeElapsed = Math.max(0, Number(elapsedMs) || 0);
  const t = safeElapsed % cycleDurationMs;

  let cursor = 0;
  for (let i = 0; i < beats.length; i++) {
    const isDash = Number(beats[i]) >= 2;
    const onDuration = isDash ? MORSE_DASH_MS : MORSE_DOT_MS;

    if (t >= cursor && t < cursor + onDuration) {
      const localT = t - cursor;
      let intensity = 1;
      if (!reducedMotion) {
        if (localT < MORSE_RAMP_MS) {
          intensity = Math.max(0.25, localT / MORSE_RAMP_MS);
        } else if (localT > onDuration - MORSE_RAMP_MS) {
          intensity = Math.max(0.25, (onDuration - localT) / MORSE_RAMP_MS);
        }
      }
      return {
        active: true,
        lit: true,
        beatIndex: i,
        beatType: isDash ? 'dash' : 'dot',
        intensity
      };
    }

    cursor += onDuration;
    if (t >= cursor && t < cursor + MORSE_INTRA_GAP_MS) {
      return {
        active: true,
        lit: false,
        beatIndex: i,
        beatType: 'gap',
        intensity: 0
      };
    }
    cursor += MORSE_INTRA_GAP_MS;
  }

  return {
    active: true,
    lit: false,
    beatIndex: -1,
    beatType: 'pause',
    intensity: 0
  };
}

export function drawMorseLampCanvas(
  canvas,
  { isOperatorView = false, lit = false, intensity = 0, beatType = 'idle', isSolved = false } = {}
) {
  const ctx = canvas.getContext('2d');
  if (canvas._texts) canvas._texts.length = 0;

  ctx.clearRect(0, 0, 256, 192);
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, 256, 192);

  ctx.strokeStyle = isOperatorView ? '#d4d4d8' : '#52525b';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 244, 180);

  if (!isOperatorView) {
    ctx.fillStyle = '#71717a';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('[OPTICAL SHROUD]', 128, 96);
    return;
  }

  if (isSolved) {
    ctx.fillStyle = '#e4e4e7';
    ctx.fillRect(22, 22, 212, 148);
    ctx.fillStyle = '#09090b';
    ctx.font = '900 32px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✓ MORSE', 128, 96);
    return;
  }

  // Outer optical Fresnel ring (always visible so Operator keeps alignment during dark gaps)
  ctx.strokeStyle = lit ? '#ffffff' : '#71717a';
  ctx.lineWidth = lit ? 6 : 3;
  ctx.beginPath();
  ctx.arc(128, 96, 62, 0, Math.PI * 2);
  ctx.stroke();

  if (lit && intensity > 0.05) {
    const shade = Math.round(180 + Math.min(1, intensity) * 75);
    const hexByte = shade.toString(16).padStart(2, '0');
    ctx.fillStyle = `#${hexByte}${hexByte}${hexByte}`;
    ctx.fillRect(20, 20, 216, 152);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(128, 96, 48, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#09090b';
    ctx.lineWidth = 5;
    ctx.beginPath();
    if (beatType === 'dash') {
      ctx.moveTo(86, 96);
      ctx.lineTo(170, 96);
    } else {
      ctx.arc(128, 96, 12, 0, Math.PI * 2);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = '#18181b';
    ctx.beginPath();
    ctx.arc(128, 96, 46, 0, Math.PI * 2);
    ctx.fill();

    // Subtle dark-state alignment crosshair
    ctx.strokeStyle = '#52525b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(106, 96);
    ctx.lineTo(150, 96);
    ctx.moveTo(128, 74);
    ctx.lineTo(128, 118);
    ctx.stroke();
  }
}

export function drawSerialPlateCanvas(canvas, serialNumber, isObserverView) {
  const ctx = canvas.getContext('2d');
  if (canvas._texts) canvas._texts.length = 0;

  ctx.clearRect(0, 0, 512, 128);
  ctx.fillStyle = isObserverView ? '#1e293b' : '#09090b';
  ctx.fillRect(0, 0, 512, 128);

  ctx.strokeStyle = isObserverView ? '#f59e0b' : '#a1a1aa';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);

  if (isObserverView && serialNumber) {
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 21px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('BANANABOMB CASE SERIAL PLATE', 22, 38);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 43px monospace';
    ctx.fillText(`SERIAL: ${serialNumber}`, 22, 90);

    ctx.fillStyle = '#94a3b8';
    for (let x = 408; x < 486; x += 8) {
      ctx.fillRect(x, 24, x % 3 === 0 ? 5 : 2, 72);
    }
  } else {
    ctx.fillStyle = '#a1a1aa';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('[OBSERVER VISUAL ACCESS ONLY]', 256, 70);
  }
}

function makeTranslatedBox(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

export function buildBriefcaseBombRig({ styleManager = null, initialLidAngleRad = BRIEFCASE_SPEC.openAngleRad } = {}) {
  const rig = new THREE.Group();
  rig.name = 'BriefcaseBombRig';
  rig.position.set(
    BRIEFCASE_SPEC.worldOrigin.x,
    BRIEFCASE_SPEC.worldOrigin.y,
    BRIEFCASE_SPEC.worldOrigin.z
  );

  const halfW = BRIEFCASE_SPEC.width * 0.5; // 0.280
  const halfD = BRIEFCASE_SPEC.depth * 0.5; // 0.210
  const wallT = BRIEFCASE_SPEC.wallThickness; // 0.020
  const deckH = BRIEFCASE_SPEC.innerDeckY; // 0.048
  const wallH = BRIEFCASE_SPEC.lowerHeight - deckH; // 0.032 (y: 0.048 .. 0.080)

  // --- 1. LowerCaseShell (Recessed Hard-Shell Base) ---
  const lowerGroup = new THREE.Group();
  lowerGroup.name = 'LowerCaseShell';

  const baseShellParts = [
    // Solid floor & mounting deck slab: x ∈ [-0.280, +0.280], y ∈ [0.000, 0.048], z ∈ [-0.210, +0.210]
    makeTranslatedBox(BRIEFCASE_SPEC.width, deckH, BRIEFCASE_SPEC.depth, 0, deckH * 0.5, 0),
    // North (-Z) perimeter wall: z ∈ [-0.210, -0.190], y ∈ [0.048, 0.080]
    makeTranslatedBox(BRIEFCASE_SPEC.width, wallH, wallT, 0, deckH + wallH * 0.5, -halfD + wallT * 0.5),
    // South (+Z) perimeter wall: z ∈ [+0.190, +0.210], y ∈ [0.048, 0.080]
    makeTranslatedBox(BRIEFCASE_SPEC.width, wallH, wallT, 0, deckH + wallH * 0.5, halfD - wallT * 0.5),
    // West (-X) perimeter wall: x ∈ [-0.280, -0.260], y ∈ [0.048, 0.080]
    makeTranslatedBox(wallT, wallH, BRIEFCASE_SPEC.depth - wallT * 2, -halfW + wallT * 0.5, deckH + wallH * 0.5, 0),
    // East (+X) perimeter wall: x ∈ [+0.260, +0.280], y ∈ [0.048, 0.080]
    makeTranslatedBox(wallT, wallH, BRIEFCASE_SPEC.depth - wallT * 2, halfW - wallT * 0.5, deckH + wallH * 0.5, 0)
  ];

  const lowerShellGeo = mergeGeometries(baseShellParts, false);
  baseShellParts.forEach((g) => g.dispose());

  const lowerShellMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.68,
    metalness: 0.18
  });

  const lowerShellMesh = new THREE.Mesh(lowerShellGeo, lowerShellMat);
  lowerShellMesh.name = 'LowerCaseBodyMesh';
  lowerShellMesh.userData.occluderId = 'briefcase_base';
  lowerShellMesh.userData.surfaceRole = 'briefcase_shell';
  lowerGroup.add(lowerShellMesh);

  // Brushed aluminum rim gasket, twin South latches & front carry handle (strictly inside outer bounds or South front)
  const hardwareParts = [
    // Front Left & Right latches on South (+Z) face
    makeTranslatedBox(0.052, 0.034, 0.012, -0.155, 0.056, halfD + 0.005),
    makeTranslatedBox(0.052, 0.034, 0.012, 0.155, 0.056, halfD + 0.005),
    // Front Carry Handle bracket posts + grip bar on South (+Z) face (below y = 0.068 so never clips view)
    makeTranslatedBox(0.022, 0.018, 0.028, -0.065, 0.038, halfD + 0.014),
    makeTranslatedBox(0.022, 0.018, 0.028, 0.065, 0.038, halfD + 0.014),
    makeTranslatedBox(0.152, 0.018, 0.018, 0, 0.038, halfD + 0.028),
    // Inner bay divider cross-ribs on deck
    makeTranslatedBox(0.49, 0.006, 0.012, 0, deckH + 0.003, 0.005),
    makeTranslatedBox(0.012, 0.006, 0.35, 0, deckH + 0.003, 0.005)
  ];
  const hardwareGeo = mergeGeometries(hardwareParts, false);
  hardwareParts.forEach((g) => g.dispose());

  const hardwareMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.36,
    metalness: 0.65
  });
  const hardwareMesh = new THREE.Mesh(hardwareGeo, hardwareMat);
  hardwareMesh.name = 'LowerCaseHardwareMesh';
  hardwareMesh.userData.occluderId = 'briefcase_base';
  hardwareMesh.userData.surfaceRole = 'briefcase_hardware';
  lowerGroup.add(hardwareMesh);

  if (styleManager) {
    styleManager.trackGeometry(lowerShellGeo);
    styleManager.trackMaterial(lowerShellMat);
    styleManager.registerMesh(lowerShellMesh, { tier: 'primary', edgeAngle: 20 });

    styleManager.trackGeometry(hardwareGeo);
    styleManager.trackMaterial(hardwareMat);
    styleManager.registerMesh(hardwareMesh, { tier: 'primary', edgeAngle: 25 });
  }

  rig.add(lowerGroup);

  // --- 2. ModuleBayRoot (Sibling of HingePivotGroup — invariant under lid animation) ---
  const moduleBayRoot = new THREE.Group();
  moduleBayRoot.name = 'ModuleBayRoot';
  moduleBayRoot.position.set(
    BRIEFCASE_SPEC.moduleBayLocalPos.x,
    BRIEFCASE_SPEC.moduleBayLocalPos.y,
    BRIEFCASE_SPEC.moduleBayLocalPos.z
  );
  moduleBayRoot.rotation.set(THREE.MathUtils.degToRad(BRIEFCASE_SPEC.moduleBayTiltDeg), 0, 0);
  moduleBayRoot.scale.setScalar(BRIEFCASE_SPEC.moduleBayScale);
  rig.add(moduleBayRoot);

  // --- 3. ExteriorSerialPlate on East (+X) Vertical Rim Wall facing Observer ---
  const serialCanvas = createCanvas2D(512, 128);
  drawSerialPlateCanvas(serialCanvas, null, false);
  const serialTexture = new THREE.CanvasTexture(serialCanvas);
  serialTexture.colorSpace = THREE.SRGBColorSpace;

  const serialBackingGeo = new THREE.BoxGeometry(0.003, 0.058, 0.236);
  const serialBackingMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.45,
    metalness: 0.55
  });
  const serialBackingMesh = new THREE.Mesh(serialBackingGeo, serialBackingMat);
  serialBackingMesh.position.set(
    BRIEFCASE_SPEC.serialPlateLocalPos.x - 0.001,
    BRIEFCASE_SPEC.serialPlateLocalPos.y,
    BRIEFCASE_SPEC.serialPlateLocalPos.z
  );
  serialBackingMesh.userData.occluderId = 'briefcase_base';
  rig.add(serialBackingMesh);

  const serialGeo = new THREE.PlaneGeometry(0.228, 0.052);
  serialGeo.rotateY(Math.PI * 0.5); // Outward normal strictly +X toward Observer
  const serialMat = new THREE.MeshBasicMaterial({
    map: serialTexture,
    transparent: false,
    toneMapped: false
  });
  const serialPlateMesh = new THREE.Mesh(serialGeo, serialMat);
  serialPlateMesh.name = 'ExteriorSerialPlate';
  serialPlateMesh.position.set(
    BRIEFCASE_SPEC.serialPlateLocalPos.x + 0.0015,
    BRIEFCASE_SPEC.serialPlateLocalPos.y,
    BRIEFCASE_SPEC.serialPlateLocalPos.z
  );
  serialPlateMesh.renderOrder = 2;
  serialPlateMesh.userData.skipTactile = true;
  serialPlateMesh.userData.clueId = 'serial_plate';
  serialPlateMesh.userData.surfaceRole = 'serial_plate';
  rig.add(serialPlateMesh);

  if (styleManager) {
    styleManager.trackGeometry(serialBackingGeo);
    styleManager.trackMaterial(serialBackingMat);
    styleManager.registerMesh(serialBackingMesh, { tier: 'primary', edgeAngle: 20 });

    styleManager.trackGeometry(serialGeo);
    styleManager.trackMaterial(serialMat);
    styleManager.trackTexture(serialTexture);
  }

  // --- 3B. Exterior Optical Morse Lamp Pod on West (-X) Rim (Shrouded exclusively toward Operator) ---
  const morseLampGroup = new THREE.Group();
  morseLampGroup.name = 'ExteriorMorseLampGroup';

  // Mounting bracket anchored to West (-X) outer wall (x ∈ [-0.306, -0.280])
  const morseBracketParts = [
    makeTranslatedBox(0.03, 0.022, 0.034, -halfW - 0.015, 0.052, 0.122),
    makeTranslatedBox(0.016, 0.034, 0.018, -halfW - 0.026, 0.074, 0.116)
  ];
  const morseBracketGeo = mergeGeometries(morseBracketParts, false);
  morseBracketParts.forEach((g) => g.dispose());

  const morseShroudMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.48,
    metalness: 0.52
  });

  const morseLampBracketMesh = new THREE.Mesh(morseBracketGeo, morseShroudMat);
  morseLampBracketMesh.name = 'MorseLampBracketMesh';
  morseLampBracketMesh.userData.occluderId = 'morse_lamp_shroud';
  morseLampBracketMesh.userData.surfaceRole = 'briefcase_hardware';
  morseLampGroup.add(morseLampBracketMesh);

  // Angled directional hood oriented so local +Z points strictly at Operator's seated eye (0, 1.18, +0.46)
  const morseLampHoodGroup = new THREE.Group();
  morseLampHoodGroup.name = 'MorseLampHoodGroup';
  const hoodLocalPos = new THREE.Vector3(
    BRIEFCASE_SPEC.morseLampLocalPos.x,
    BRIEFCASE_SPEC.morseLampLocalPos.y,
    BRIEFCASE_SPEC.morseLampLocalPos.z
  );
  const operatorEyeLocalPos = new THREE.Vector3(
    0.0 - BRIEFCASE_SPEC.worldOrigin.x,
    1.18 - BRIEFCASE_SPEC.worldOrigin.y,
    0.46 - BRIEFCASE_SPEC.worldOrigin.z
  );
  const hoodBasisMat = new THREE.Matrix4().lookAt(
    operatorEyeLocalPos,
    hoodLocalPos,
    new THREE.Vector3(0, 1, 0)
  );
  morseLampHoodGroup.position.copy(hoodLocalPos);
  morseLampHoodGroup.quaternion.setFromRotationMatrix(hoodBasisMat);

  // 5-sided deep optical blinder tunnel around the 0.044 × 0.032 lens plane:
  // Blocks 100% of Observer (+X) and Manual-holder (-Z) rays while leaving Operator (+Z local) 5/5 clear.
  const shroudParts = [
    // Opaque rear housing plate (z ∈ [-0.015, -0.002])
    makeTranslatedBox(0.06, 0.048, 0.013, 0, 0, -0.0085),
    // Left (-X) & Right (+X) deep lateral blinder fins (z ∈ [-0.015, +0.052])
    makeTranslatedBox(0.007, 0.048, 0.067, -0.0265, 0, 0.0185),
    makeTranslatedBox(0.007, 0.048, 0.067, 0.0265, 0, 0.0185),
    // Top (+Y) & Bottom (-Y) hood visors (z ∈ [-0.015, +0.052])
    makeTranslatedBox(0.046, 0.007, 0.067, 0, 0.0205, 0.0185),
    makeTranslatedBox(0.046, 0.007, 0.067, 0, -0.0205, 0.0185)
  ];
  const morseShroudGeo = mergeGeometries(shroudParts, false);
  shroudParts.forEach((g) => g.dispose());

  const morseLampShroudMesh = new THREE.Mesh(morseShroudGeo, morseShroudMat);
  morseLampShroudMesh.name = 'MorseLampShroudMesh';
  morseLampShroudMesh.userData.occluderId = 'morse_lamp_shroud';
  morseLampShroudMesh.userData.surfaceRole = 'briefcase_hardware';
  morseLampHoodGroup.add(morseLampShroudMesh);

  const morseLampCanvas = createCanvas2D(256, 192);
  drawMorseLampCanvas(morseLampCanvas, { isOperatorView: false, lit: false, intensity: 0 });
  const morseLampTexture = new THREE.CanvasTexture(morseLampCanvas);
  morseLampTexture.colorSpace = THREE.SRGBColorSpace;

  const morseLensGeo = new THREE.PlaneGeometry(0.044, 0.032);
  const morseLensMat = new THREE.MeshBasicMaterial({
    map: morseLampTexture,
    color: 0xffffff,
    transparent: false,
    toneMapped: false
  });
  const morseLampLensMesh = new THREE.Mesh(morseLensGeo, morseLensMat);
  morseLampLensMesh.name = 'ExteriorMorseLampLens';
  morseLampLensMesh.renderOrder = 2;
  morseLampLensMesh.userData.skipTactile = true;
  morseLampLensMesh.userData.clueId = 'morse_lamp';
  morseLampLensMesh.userData.surfaceRole = 'morse_lamp';
  morseLampHoodGroup.add(morseLampLensMesh);

  morseLampGroup.add(morseLampHoodGroup);
  rig.add(morseLampGroup);

  if (styleManager) {
    styleManager.trackGeometry(morseBracketGeo);
    styleManager.trackGeometry(morseShroudGeo);
    styleManager.trackMaterial(morseShroudMat);
    styleManager.registerMesh(morseLampBracketMesh, { tier: 'primary', edgeAngle: 20 });
    styleManager.registerMesh(morseLampShroudMesh, { tier: 'primary', edgeAngle: 20 });

    styleManager.trackGeometry(morseLensGeo);
    styleManager.trackMaterial(morseLensMat);
    styleManager.trackTexture(morseLampTexture);
  }

  // --- 4. HingePivotGroup & Flat-Constructed UpperCaseLidShell ---
  const hingePivotGroup = new THREE.Group();
  hingePivotGroup.name = 'HingePivotGroup';
  hingePivotGroup.position.set(
    BRIEFCASE_SPEC.hingeLocalPos.x,
    BRIEFCASE_SPEC.hingeLocalPos.y,
    BRIEFCASE_SPEC.hingeLocalPos.z
  );

  // Constructed FLAT in closed state:
  // hinge-local x ∈ [-0.280, +0.280], y ∈ [0.000, +0.055], z ∈ [0.000, +0.420]
  const lidT = BRIEFCASE_SPEC.lidThickness; // 0.055
  const lidD = BRIEFCASE_SPEC.depth; // 0.420

  const lidShellParts = [
    // Main solid upper hard-shell roof & perimeter (100% opaque occluder across full 0.560 × 0.420 area)
    makeTranslatedBox(BRIEFCASE_SPEC.width, lidT - 0.015, lidD, 0, 0.015 + (lidT - 0.015) * 0.5, lidD * 0.5),
    // Lid perimeter lip (y ∈ [0.000, 0.015]) so exact closed AABB spans y ∈ [0.000, +0.055], z ∈ [0.000, +0.420]
    makeTranslatedBox(BRIEFCASE_SPEC.width, 0.015, wallT, 0, 0.0075, wallT * 0.5),
    makeTranslatedBox(BRIEFCASE_SPEC.width, 0.015, wallT, 0, 0.0075, lidD - wallT * 0.5),
    makeTranslatedBox(wallT, 0.015, lidD - wallT * 2, -halfW + wallT * 0.5, 0.0075, lidD * 0.5),
    makeTranslatedBox(wallT, 0.015, lidD - wallT * 2, halfW - wallT * 0.5, 0.0075, lidD * 0.5),
    // Exterior molded structural ribs on top of lid (kept strictly within y <= 0.055 so closed AABB is exact)
    makeTranslatedBox(0.026, 0.004, lidD - 0.06, -0.16, lidT - 0.002, lidD * 0.5),
    makeTranslatedBox(0.026, 0.004, lidD - 0.06, 0.0, lidT - 0.002, lidD * 0.5),
    makeTranslatedBox(0.026, 0.004, lidD - 0.06, 0.16, lidT - 0.002, lidD * 0.5)
  ];

  const lidShellGeo = mergeGeometries(lidShellParts, false);
  lidShellParts.forEach((g) => g.dispose());

  const lidShellMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.64,
    metalness: 0.2
  });

  const upperLidMesh = new THREE.Mesh(lidShellGeo, lidShellMat);
  upperLidMesh.name = 'UpperCaseLidShell';
  upperLidMesh.userData.occluderId = 'briefcase_lid';
  upperLidMesh.userData.surfaceRole = 'briefcase_lid';
  hingePivotGroup.add(upperLidMesh);

  // Recessed acoustic foam baffle inside the lid (faces Operator when lid is open)
  const foamParts = [
    makeTranslatedBox(BRIEFCASE_SPEC.width - 0.056, 0.008, lidD - 0.056, 0, 0.012, lidD * 0.5),
    makeTranslatedBox(BRIEFCASE_SPEC.width - 0.08, 0.006, 0.028, 0, 0.007, lidD * 0.26),
    makeTranslatedBox(BRIEFCASE_SPEC.width - 0.08, 0.006, 0.028, 0, 0.007, lidD * 0.5),
    makeTranslatedBox(BRIEFCASE_SPEC.width - 0.08, 0.006, 0.028, 0, 0.007, lidD * 0.74)
  ];
  const foamGeo = mergeGeometries(foamParts, false);
  foamParts.forEach((g) => g.dispose());

  const foamMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.92,
    metalness: 0.04
  });
  const foamMesh = new THREE.Mesh(foamGeo, foamMat);
  foamMesh.name = 'UpperCaseLidFoamMesh';
  foamMesh.userData.occluderId = 'briefcase_lid';
  foamMesh.userData.surfaceRole = 'briefcase_lid';
  hingePivotGroup.add(foamMesh);

  if (styleManager) {
    styleManager.trackGeometry(lidShellGeo);
    styleManager.trackMaterial(lidShellMat);
    styleManager.registerMesh(upperLidMesh, { tier: 'primary', edgeAngle: 20 });

    styleManager.trackGeometry(foamGeo);
    styleManager.trackMaterial(foamMat);
    styleManager.registerMesh(foamMesh, { tier: 'secondary', edgeAngle: 25 });
  }

  rig.add(hingePivotGroup);

  let lastLampSignature = '';

  function setLidAngle(angleRad) {
    hingePivotGroup.rotation.set(angleRad, 0, 0);
  }

  function updateSerialPlate(serialNumber, isObserverView) {
    drawSerialPlateCanvas(serialCanvas, serialNumber, isObserverView);
    serialTexture.needsUpdate = true;
  }

  function updateMorseLamp({
    isOperatorView = false,
    lit = false,
    intensity = 0,
    beatType = 'idle',
    isSolved = false
  } = {}) {
    const quantizedIntensity = lit ? Math.round(Math.min(1, Math.max(0, intensity)) * 12) : 0;
    const sig = `${isOperatorView ? 1 : 0}:${isSolved ? 1 : 0}:${lit ? 1 : 0}:${beatType}:${quantizedIntensity}`;
    if (sig === lastLampSignature) return;
    lastLampSignature = sig;

    drawMorseLampCanvas(morseLampCanvas, {
      isOperatorView,
      lit,
      intensity: quantizedIntensity / 12,
      beatType,
      isSolved
    });
    morseLampTexture.needsUpdate = true;
  }

  setLidAngle(initialLidAngleRad);

  return {
    rig,
    lowerGroup,
    lowerShellMesh,
    moduleBayRoot,
    hingePivotGroup,
    upperLidMesh,
    foamMesh,
    serialPlateMesh,
    serialCanvas,
    serialTexture,
    morseLampGroup,
    morseLampHoodGroup,
    morseLampBracketMesh,
    morseLampShroudMesh,
    morseLampLensMesh,
    morseLampCanvas,
    morseLampTexture,
    setLidAngle,
    updateSerialPlate,
    updateMorseLamp
  };
}
