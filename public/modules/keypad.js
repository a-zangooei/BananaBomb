/**
 * Client 3D Cipher Keypad Module
 * Large 2x2 numbered targets (1-4 mapped deterministically to slotIndex 0-3),
 * non-color checkmarks on entered keys, double-submission protection,
 * strict Operator monochrome canvas/LED rendering, and Observer-only symbol gating.
 */
import { createCanvas2D } from './canvas-utils.js';

const NOOP_RAYCAST = () => {};

function drawKeyLabelCanvas(canvas, text, isEntered, isOperator, isPressed = false) {
  const ctx = canvas.getContext('2d');
  if (canvas._texts) canvas._texts.length = 0;

  ctx.clearRect(0, 0, 128, 128);

  if (isOperator) {
    ctx.fillStyle = isEntered ? '#18181b' : (isPressed ? '#27272a' : '#09090b');
    ctx.fillRect(0, 0, 128, 128);

    ctx.strokeStyle = isEntered ? '#f8fafc' : (isPressed ? '#ffffff' : '#a1a1aa');
    ctx.lineWidth = isEntered || isPressed ? 8 : 6;
    ctx.strokeRect(4, 4, 120, 120);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f8fafc';

    if (isEntered) {
      ctx.font = 'bold 24px monospace';
      ctx.fillText('✓ ثبت', 64, 30);
      ctx.font = 'bold 46px monospace';
      ctx.fillText(text, 64, 82);
    } else {
      ctx.font = 'bold 56px monospace';
      ctx.fillText(text, 64, 66);
    }
    return;
  }

  ctx.fillStyle = isEntered
    ? '#14532d'
    : isPressed
      ? '#1e3a8a'
      : '#0f172a';
  ctx.fillRect(0, 0, 128, 128);

  ctx.strokeStyle = isEntered
    ? '#22c55e'
    : '#38bdf8';
  ctx.lineWidth = isEntered || isPressed ? 8 : 6;
  ctx.strokeRect(4, 4, 120, 120);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isEntered ? '#dcfce7' : '#38bdf8';

  if (isEntered) {
    ctx.font = 'bold 24px monospace';
    ctx.fillText('✓ ثبت', 64, 30);
    ctx.font = 'bold 48px sans-serif';
    ctx.fillText(text, 64, 82);
  } else {
    ctx.font = 'bold 58px sans-serif';
    ctx.fillText(text, 64, 66);
  }
}

export const keypadClientModule = {
  id: 'keypad',
  title: 'نمادهای رمزی',

  build(THREE, slot, role) {
    const group = new THREE.Group();
    group.name = 'module_keypad';
    const isOperator = role === 'blind' || role === 'operator';

    // 1. Module Base Plate
    const baseGeo = new THREE.BoxGeometry(slot.width * 0.94, slot.height * 0.94, 0.05);
    const baseMat = new THREE.MeshLambertMaterial({
      color: isOperator ? 0x09090b : 0x1e293b
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.z = 0.025;
    baseMesh.userData = { surfaceRole: 'module_base' };
    group.add(baseMesh);

    // 2. Status LED
    const ledGeo = new THREE.SphereGeometry(0.06, 16, 16);
    const ledMat = new THREE.MeshBasicMaterial({
      color: isOperator ? 0x27272a : 0x475569,
      toneMapped: false
    });
    const ledMesh = new THREE.Mesh(ledGeo, ledMat);
    ledMesh.position.set(slot.width * 0.36, slot.height * 0.37, 0.07);
    group.add(ledMesh);

    // 3. Large 2x2 Keypad Targets (1 -> slotIndex 0, 2 -> slotIndex 1, 3 -> slotIndex 2, 4 -> slotIndex 3)
    const keyData = [];
    const positions = [
      { x: -0.225, y: 0.135 },
      { x: 0.225, y: 0.135 },
      { x: -0.225, y: -0.225 },
      { x: 0.225, y: -0.225 }
    ];

    positions.forEach((pos, idx) => {
      const keyBoxGeo = new THREE.BoxGeometry(0.39, 0.31, 0.075);
      const keyBoxMat = new THREE.MeshLambertMaterial({
        color: isOperator ? 0x09090b : 0x1e293b
      });
      const keyMesh = new THREE.Mesh(keyBoxGeo, keyBoxMat);
      keyMesh.position.set(pos.x, pos.y, 0.072);
      keyMesh.userData = {
        slotIndex: idx,
        displayNumber: idx + 1,
        isKey: true,
        clueId: `keypad_key_${idx}`,
        controlId: `slot-${idx}`
      };

      const defaultText = isOperator ? `${idx + 1}` : '■';
      const labelCanvas = createCanvas2D(128, 128);
      drawKeyLabelCanvas(labelCanvas, defaultText, false, isOperator, false);
      const labelTexture = new THREE.CanvasTexture(labelCanvas);

      const faceGeo = new THREE.PlaneGeometry(0.365, 0.285);
      const faceMat = new THREE.MeshBasicMaterial({
        map: labelTexture,
        transparent: true,
        depthWrite: false,
        toneMapped: false
      });
      const faceMesh = new THREE.Mesh(faceGeo, faceMat);
      faceMesh.position.set(0, 0, 0.041);
      faceMesh.renderOrder = 2;
      faceMesh.userData = {
        slotIndex: idx,
        displayNumber: idx + 1,
        isKey: true,
        isOverlayPlane: true,
        clueId: `keypad_slot_${idx}`,
        controlId: `slot-${idx}`
      };
      keyMesh.add(faceMesh);

      // Dedicated non-overlapping touch hitbox per key (0.42 x 0.335 inside 0.45 x 0.36 grid)
      const hitGeo = new THREE.BoxGeometry(0.42, 0.335, 0.12);
      const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const hitMesh = new THREE.Mesh(hitGeo, hitMat);
      hitMesh.position.set(pos.x, pos.y, 0.08);
      hitMesh.userData = {
        slotIndex: idx,
        displayNumber: idx + 1,
        isKey: true,
        isTouchHitbox: true,
        skipTactile: true,
        controlId: `slot-${idx}`
      };
      group.add(hitMesh);

      // Tactile Glow frame around key (strictly monochrome for Operator)
      const glowGeo = new THREE.PlaneGeometry(0.42, 0.34);
      const glowMat = new THREE.MeshBasicMaterial({
        color: isOperator ? 0xf8fafc : 0x38bdf8,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide
      });
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.position.set(pos.x, pos.y, 0.042);
      glowMesh.renderOrder = 2;
      glowMesh.visible = false;
      glowMesh.raycast = NOOP_RAYCAST;
      glowMesh.userData = { isOverlayPlane: true, skipTactile: true };
      group.add(glowMesh);

      group.add(keyMesh);

      keyData.push({
        slotIndex: idx,
        displayNumber: idx + 1,
        keyMesh,
        faceMesh,
        hitMesh,
        glowMesh,
        labelCanvas,
        labelTexture,
        defaultZ: 0.072
      });
    });

    group.userData = {
      keyData,
      ledMesh,
      localPendingSlots: new Set()
    };

    return group;
  },

  findSlotIndexFromHit(hit) {
    let targetMesh = hit?.object;
    while (targetMesh && targetMesh.userData?.slotIndex === undefined && targetMesh.parent) {
      targetMesh = targetMesh.parent;
    }
    return targetMesh?.userData?.slotIndex ?? hit?.object?.userData?.slotIndex;
  },

  resolveControl(hit, state, role, config = {}) {
    if ((role !== 'blind' && role !== 'operator') || state?.solved) return null;
    const slotIndex = this.findSlotIndexFromHit(hit);
    if (slotIndex === undefined || slotIndex < 0 || slotIndex > 3) return null;
    if (state?.enteredSlots?.includes(slotIndex)) return null;

    const displayNum = slotIndex + 1;
    return {
      moduleId: 'keypad',
      controlId: `slot-${slotIndex}`,
      slotIndex,
      displayNumber: displayNum,
      interactionMode: 'tap',
      dedupeLockMs: config.keypadDedupeLockMs || 320,
      label: `کلید کیپد ${displayNum}`,
      commitLabel: `کلید ${displayNum} ثبت شد`,
      commitDetail: `فشردن کلید شماره ${displayNum} (جایگاه ${slotIndex + 1}) ارسال گردید.`,
      buildAction() {
        return {
          moduleId: 'keypad',
          action: 'press',
          data: { slotIndex }
        };
      }
    };
  },

  onVisualState(moduleView, visualEvent, role, state, descriptor) {
    if (!moduleView?.userData?.keyData) return;
    const isOperator = role === 'blind' || role === 'operator';
    const isObserver = role === 'deaf' || role === 'observer';
    const targetIdx = descriptor?.slotIndex;
    const st = visualEvent?.state;

    moduleView.userData.keyData.forEach((k) => {
      const isEntered = Boolean(state?.enteredSlots?.includes(k.slotIndex));
      const symbolText = isOperator
        ? `${k.displayNumber}`
        : (isObserver ? (state?.symbols?.[k.slotIndex] || '■') : '■');

      if (k.slotIndex === targetIdx && st === 'press_start' && !isEntered) {
        k.keyMesh.position.z = k.defaultZ - 0.032;
        k.glowMesh.visible = true;
        k.glowMesh.material.opacity = 0.88;
        drawKeyLabelCanvas(k.labelCanvas, symbolText, false, isOperator, true);
        k.labelTexture.needsUpdate = true;
      } else {
        k.keyMesh.position.z = isEntered ? k.defaultZ - 0.025 : k.defaultZ;
        k.glowMesh.visible = false;
        k.glowMesh.material.opacity = 0;
        drawKeyLabelCanvas(k.labelCanvas, symbolText, isEntered, isOperator, false);
        k.labelTexture.needsUpdate = true;
      }
    });
  },

  update(moduleView, role, state) {
    if (!moduleView || !state) return;
    const { keyData, ledMesh } = moduleView.userData;
    const isOperator = role === 'blind' || role === 'operator';
    const isObserver = role === 'deaf' || role === 'observer';

    if (isOperator) {
      ledMesh.material.color.setHex(state.solved ? 0xf8fafc : 0x27272a);
    } else {
      ledMesh.material.color.setHex(state.solved ? 0x10b981 : 0x475569);
    }

    keyData.forEach((k) => {
      const idx = k.slotIndex;
      const isEntered = state.enteredSlots?.includes(idx) ?? (idx < (state.enteredCount || 0));
      const symbolText = isOperator
        ? `${k.displayNumber}`
        : (isObserver ? (state.symbols?.[idx] || '■') : '■');

      drawKeyLabelCanvas(k.labelCanvas, symbolText, isEntered, isOperator, false);
      k.labelTexture.needsUpdate = true;
      k.keyMesh.position.z = isEntered ? k.defaultZ - 0.025 : k.defaultZ;
      k.glowMesh.visible = false;
    });
  },

  onPointer(hit, event, send, moduleView, role, state) {
    const desc = this.resolveControl(hit, state, role);
    if (event.type === 'pointercancel') {
      moduleView.userData.downSlotIndex = null;
      this.onVisualState(moduleView, { state: 'cancelled' }, role, state, desc);
      return true;
    }
    if (!desc) return false;

    if (event.type === 'pointerdown') {
      moduleView.userData.downSlotIndex = desc.slotIndex;
      this.onVisualState(moduleView, { state: 'press_start' }, role, state, desc);
      return true;
    }

    if (event.type === 'pointerup') {
      const downSlot = moduleView.userData.downSlotIndex;
      moduleView.userData.downSlotIndex = null;
      this.onVisualState(moduleView, { state: 'idle' }, role, state, desc);

      // Prevent sliding from one key to another from firing a keypad press
      if (downSlot !== desc.slotIndex) return false;
      send('action', desc.buildAction());
      return true;
    }

    return false;
  }
};
