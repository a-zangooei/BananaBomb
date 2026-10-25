/**
 * Client 3D Optical Morse & Tactile Braille Module (Silent Replacement for Acoustic Beacon)
 *
 * Role-Split Clues & Controls:
 * - Operator (monochrome): Reads randomized 6-dot tactile Braille numerals (1='⠁', 2='⠃', 3='⠉')
 *   around the 3-slot frequency dial, watches the silent West-side Optical Morse Lamp on the
 *   briefcase exterior, and physically operates the dial + HOLD TX switch.
 * - Observer (full color): Sees the colored Spectrum Indicator window (Red / Blue / Yellow)
 *   and physical dial slot orientation, without Braille digits or Optical Morse lamp sightlines.
 * - Zero audio puzzle clues are emitted anywhere in the room.
 */
import { createCanvas2D } from './canvas-utils.js';
import { createCircleOutlineGeometry, TACTILE_PALETTE } from '../tactile-styler.js';

const NOOP_RAYCAST = () => {};

const SPECTRUM_COLOR_HEX = Object.freeze({
  red: 0xef4444,
  blue: 0x3b82f6,
  yellow: 0xfacc15
});

// Standard 6-dot Braille active dot indices (1-based: 1=top-left, 2=mid-left, 3=bot-left, 4=top-right, 5=mid-right, 6=bot-right)
const BRAILLE_DOT_MAP = Object.freeze({
  1: [1],
  2: [1, 2],
  3: [1, 4]
});

const SLOT_POSITION_NAMES = Object.freeze({
  1: 'چپ',
  2: 'وسط',
  3: 'راست'
});

function drawDialCanvas(canvas, { channelNumber = null, isMonochrome = true, isHighlighted = false } = {}) {
  const ctx = canvas.getContext('2d');
  if (canvas._texts) canvas._texts.length = 0;

  ctx.clearRect(0, 0, 128, 128);
  if (isMonochrome) {
    ctx.fillStyle = isHighlighted ? '#27272a' : '#09090b';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = isHighlighted ? '#f8fafc' : '#71717a';
    ctx.lineWidth = isHighlighted ? 8 : 5;
    ctx.strokeRect(4, 4, 120, 120);

    // Render crisp 2×3 6-dot tactile Braille numeral cell for Operator
    const raisedDots = BRAILLE_DOT_MAP[channelNumber] || [1];
    const colX = [44, 84];
    const rowY = [34, 64, 94];

    for (let c = 0; c < 2; c++) {
      for (let r = 0; r < 3; r++) {
        const dotIdx = c * 3 + r + 1;
        const x = colX[c];
        const y = rowY[r];
        const isRaised = raisedDots.includes(dotIdx);

        ctx.beginPath();
        ctx.arc(x, y, isRaised ? 11 : 5, 0, Math.PI * 2);
        if (isRaised) {
          ctx.fillStyle = '#f8fafc';
          ctx.fill();
        } else {
          ctx.strokeStyle = '#52525b';
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
      }
    }
  } else {
    // Observer sees unnumbered calibration notch plate (no channel number / no Braille leak)
    ctx.fillStyle = isHighlighted ? '#1e3a8a' : '#0f172a';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = isHighlighted ? '#fbbf24' : '#38bdf8';
    ctx.lineWidth = isHighlighted ? 8 : 6;
    ctx.strokeRect(4, 4, 120, 120);

    ctx.fillStyle = isHighlighted ? '#fbbf24' : '#94a3b8';
    ctx.beginPath();
    ctx.arc(64, 64, isHighlighted ? 16 : 11, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTxCanvas(canvas, text, progress, isMonochrome, isSolved = false) {
  const ctx = canvas.getContext('2d');
  if (canvas._texts) canvas._texts.length = 0;

  ctx.clearRect(0, 0, 256, 96);

  if (isMonochrome) {
    ctx.fillStyle = isSolved ? '#18181b' : '#09090b';
    ctx.fillRect(0, 0, 256, 96);

    if (progress > 0 && !isSolved) {
      ctx.fillStyle = 'rgba(248, 250, 252, 0.30)';
      ctx.fillRect(6, 6, Math.round(244 * Math.min(1, progress)), 84);
    }

    ctx.strokeStyle = isSolved ? '#f8fafc' : (progress > 0 ? '#ffffff' : '#a1a1aa');
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 248, 88);
  } else {
    ctx.fillStyle = isSolved ? '#14532d' : '#0369a1';
    ctx.fillRect(0, 0, 256, 96);

    if (progress > 0 && !isSolved) {
      ctx.fillStyle = 'rgba(245, 158, 11, 0.45)';
      ctx.fillRect(6, 6, Math.round(244 * Math.min(1, progress)), 84);
    }

    ctx.strokeStyle = isSolved ? '#22c55e' : (progress > 0 ? '#f59e0b' : '#38bdf8');
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 248, 88);
  }

  ctx.font = 'bold 34px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(text, 128, 48);
}

export const beaconClientModule = {
  id: 'beacon',
  title: 'فانوس مورس نوری (Optical Morse)',

  build(THREE, slot, role) {
    const group = new THREE.Group();
    group.name = 'module_beacon';

    const isMonochrome = role === 'blind' || role === 'operator';

    // 1. Base Plate
    const baseGeo = new THREE.BoxGeometry(slot.width * 0.94, slot.height * 0.94, 0.05);
    const baseMat = new THREE.MeshLambertMaterial({
      color: isMonochrome ? 0x09090b : 0x1e293b
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.userData = { surfaceRole: 'module_base' };
    group.add(baseMesh);

    // 2. Status LED (Top-Right)
    const ledGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.025, 16);
    ledGeo.rotateX(Math.PI / 2);
    const ledMat = new THREE.MeshBasicMaterial({
      color: isMonochrome ? 0x27272a : 0xef4444,
      toneMapped: false
    });
    const ledMesh = new THREE.Mesh(ledGeo, ledMat);
    ledMesh.position.set(slot.width * 0.35, slot.height * 0.35, 0.035);
    group.add(ledMesh);

    // 3. Spectrum Color Indicator Window (Top-Left — Colored for Observer, Monochrome for Operator)
    const spectrumGroup = new THREE.Group();
    spectrumGroup.position.set(-0.3, 0.33, 0.025);

    const spectrumBezelGeo = new THREE.BoxGeometry(0.24, 0.15, 0.044);
    const spectrumBezelMat = new THREE.MeshLambertMaterial({
      color: isMonochrome ? 0x09090b : 0x334155
    });
    const spectrumBezelMesh = new THREE.Mesh(spectrumBezelGeo, spectrumBezelMat);
    spectrumBezelMesh.position.z = 0.002;
    spectrumGroup.add(spectrumBezelMesh);

    const spectrumGeo = new THREE.PlaneGeometry(0.19, 0.105);
    const spectrumMat = new THREE.MeshBasicMaterial({
      color: isMonochrome ? 0x18181b : SPECTRUM_COLOR_HEX.red,
      toneMapped: false
    });
    const spectrumMesh = new THREE.Mesh(spectrumGeo, spectrumMat);
    spectrumMesh.name = 'BeaconSpectrumLens';
    spectrumMesh.position.z = 0.026;
    spectrumMesh.renderOrder = 2;
    spectrumMesh.userData = {
      clueId: 'beacon_spectrum',
      surfaceRole: 'beacon_spectrum',
      skipTactile: true
    };
    spectrumGroup.add(spectrumMesh);
    group.add(spectrumGroup);

    // 4. Frequency Dial Base Ring
    const dialRingGeo = new THREE.RingGeometry(0.24, 0.28, 24);
    const dialRingMat = new THREE.MeshBasicMaterial({
      color: isMonochrome ? 0xa1a1aa : 0x475569,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    const dialRingMesh = new THREE.Mesh(dialRingGeo, dialRingMat);
    dialRingMesh.position.set(0, -0.01, 0.031);
    dialRingMesh.renderOrder = 2;
    dialRingMesh.userData = { isOverlayPlane: true, skipTactile: true };
    group.add(dialRingMesh);

    // 5. Dial Knob (Interactive)
    const knobGroup = new THREE.Group();
    knobGroup.position.set(0, -0.01, 0.03);

    const knobBodyGeo = new THREE.CylinderGeometry(0.2, 0.22, 0.065, 24);
    knobBodyGeo.rotateX(Math.PI / 2);
    const knobBodyMat = new THREE.MeshLambertMaterial({
      color: isMonochrome ? 0x09090b : 0x334155
    });
    const knobMesh = new THREE.Mesh(knobBodyGeo, knobBodyMat);
    knobMesh.userData = { isKnob: true, controlId: 'knob', clueId: 'beacon_knob' };
    knobGroup.add(knobMesh);

    if (isMonochrome) {
      const knobLineMat = new THREE.LineBasicMaterial({
        color: TACTILE_PALETTE.linePrimaryHex,
        depthTest: true,
        depthWrite: false,
        toneMapped: false
      });
      const knobRimGeo = createCircleOutlineGeometry(0.203, 24, 'xy', 0.034);
      const knobRim = new THREE.LineSegments(knobRimGeo, knobLineMat);
      knobRim.renderOrder = 1;
      knobRim.raycast = NOOP_RAYCAST;
      knobRim.userData = { isTactileOutline: true };
      knobMesh.add(knobRim);
    }

    // Invisible Knob Touch Hitbox
    const knobHitGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.1, 20);
    knobHitGeo.rotateX(Math.PI / 2);
    const knobHitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const knobHitMesh = new THREE.Mesh(knobHitGeo, knobHitMat);
    knobHitMesh.userData = {
      isKnob: true,
      isTouchHitbox: true,
      skipTactile: true,
      controlId: 'knob'
    };
    knobGroup.add(knobHitMesh);

    // Pointer indicator on knob
    const needleGeo = new THREE.BoxGeometry(0.028, 0.15, 0.022);
    const needleMat = new THREE.MeshBasicMaterial({
      color: isMonochrome ? 0xf8fafc : 0xf59e0b,
      toneMapped: false
    });
    const needleMesh = new THREE.Mesh(needleGeo, needleMat);
    needleMesh.position.set(0, 0.075, 0.036);
    knobGroup.add(needleMesh);

    // Glow Ring for Knob
    const knobGlowGeo = new THREE.RingGeometry(0.21, 0.27, 24);
    const knobGlowMat = new THREE.MeshBasicMaterial({
      color: isMonochrome ? 0xf8fafc : 0x38bdf8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide
    });
    const knobGlowMesh = new THREE.Mesh(knobGlowGeo, knobGlowMat);
    knobGlowMesh.position.z = 0.038;
    knobGlowMesh.renderOrder = 2;
    knobGlowMesh.visible = false;
    knobGlowMesh.raycast = NOOP_RAYCAST;
    knobGlowMesh.userData = { isOverlayPlane: true, skipTactile: true };
    knobGroup.add(knobGlowMesh);

    group.add(knobGroup);

    // 6. Enlarged Tactile Braille Slot Plates (Slots 1, 2, 3) around Dial with Dedicated Hitboxes
    const channelItems = [];
    const slotAngles = [0.78, 0, -0.78]; // Slot 1 = Left (+0.78 rad), Slot 2 = Center (0), Slot 3 = Right (-0.78 rad)

    slotAngles.forEach((ang, idx) => {
      const slotNum = idx + 1;
      const radius = 0.37;
      const lx = -Math.sin(ang) * radius;
      const ly = Math.cos(ang) * radius - 0.01;

      const canvas = createCanvas2D(128, 128);
      drawDialCanvas(canvas, {
        channelNumber: slotNum,
        isMonochrome,
        isHighlighted: idx === 0
      });
      const tex = new THREE.CanvasTexture(canvas);
      const notchGeo = new THREE.PlaneGeometry(0.16, 0.16);
      const notchMat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        toneMapped: false
      });
      const notchMesh = new THREE.Mesh(notchGeo, notchMat);
      notchMesh.position.set(lx, ly, 0.035);
      notchMesh.renderOrder = 2;
      notchMesh.userData = {
        channelIndex: slotNum,
        slotIndex: slotNum,
        isOverlayPlane: true,
        controlId: `channel-${slotNum}`,
        clueId: `beacon_channel_${slotNum}`
      };
      group.add(notchMesh);

      const notchHitGeo = new THREE.BoxGeometry(0.21, 0.21, 0.09);
      const notchHitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const notchHitMesh = new THREE.Mesh(notchHitGeo, notchHitMat);
      notchHitMesh.position.set(lx, ly, 0.045);
      notchHitMesh.userData = {
        channelIndex: slotNum,
        slotIndex: slotNum,
        isTouchHitbox: true,
        skipTactile: true,
        controlId: `channel-${slotNum}`
      };
      group.add(notchHitMesh);

      channelItems.push({ channel: slotNum, slot: slotNum, notchMesh, notchHitMesh, canvas, tex });
    });

    // 7. Enlarged Transmit Switch Button (TX) at Bottom (Requires Intentional Hold)
    const txGroup = new THREE.Group();
    txGroup.position.set(0, -slot.height * 0.35, 0.035);

    const txBaseGeo = new THREE.BoxGeometry(0.56, 0.2, 0.05);
    const txBaseMat = new THREE.MeshLambertMaterial({
      color: isMonochrome ? 0x09090b : 0x0284c7
    });
    const txBaseMesh = new THREE.Mesh(txBaseGeo, txBaseMat);
    txBaseMesh.userData = { isTxButton: true, controlId: 'tx', clueId: 'beacon_tx' };
    txGroup.add(txBaseMesh);

    const txCanvas = createCanvas2D(256, 96);
    drawTxCanvas(txCanvas, 'HOLD TX', 0, isMonochrome, false);
    const txTex = new THREE.CanvasTexture(txCanvas);
    const txFaceGeo = new THREE.PlaneGeometry(0.52, 0.17);
    const txFaceMat = new THREE.MeshBasicMaterial({
      map: txTex,
      transparent: true,
      depthWrite: false,
      toneMapped: false
    });
    const txFaceMesh = new THREE.Mesh(txFaceGeo, txFaceMat);
    txFaceMesh.position.z = 0.028;
    txFaceMesh.renderOrder = 2;
    txFaceMesh.userData = {
      isTxButton: true,
      isOverlayPlane: true,
      controlId: 'tx',
      clueId: 'beacon_tx_face'
    };
    txGroup.add(txFaceMesh);

    const txHitGeo = new THREE.BoxGeometry(0.62, 0.25, 0.11);
    const txHitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const txHitMesh = new THREE.Mesh(txHitGeo, txHitMat);
    txHitMesh.position.z = 0.03;
    txHitMesh.userData = {
      isTxButton: true,
      isTouchHitbox: true,
      skipTactile: true,
      controlId: 'tx'
    };
    txGroup.add(txHitMesh);

    const txGlowGeo = new THREE.PlaneGeometry(0.59, 0.23);
    const txGlowMat = new THREE.MeshBasicMaterial({
      color: isMonochrome ? 0xf8fafc : 0xf59e0b,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false
    });
    const txGlowMesh = new THREE.Mesh(txGlowGeo, txGlowMat);
    txGlowMesh.position.z = 0.029;
    txGlowMesh.renderOrder = 2;
    txGlowMesh.visible = false;
    txGlowMesh.raycast = NOOP_RAYCAST;
    txGlowMesh.userData = { isOverlayPlane: true, skipTactile: true };
    txGroup.add(txGlowMesh);

    group.add(txGroup);

    group.userData = {
      baseMesh,
      ledMesh,
      spectrumGroup,
      spectrumBezelMesh,
      spectrumMesh,
      knobGroup,
      knobMesh,
      knobHitMesh,
      knobGlowMesh,
      txGroup,
      txBaseMesh,
      txFaceMesh,
      txHitMesh,
      txCanvas,
      txTex,
      txGlowMesh,
      channelItems,
      currentSlot: 1,
      currentChannel: 1
    };

    return group;
  },

  inspectBeaconTarget(hit) {
    let targetObj = hit?.object;
    let isKnob = Boolean(targetObj?.userData?.isKnob);
    let isTx = Boolean(targetObj?.userData?.isTxButton);
    let hitChannel = targetObj?.userData?.channelIndex;

    while (targetObj && !isKnob && !isTx && hitChannel === undefined && targetObj.parent) {
      targetObj = targetObj.parent;
      if (targetObj) {
        if (targetObj.userData?.isKnob) isKnob = true;
        if (targetObj.userData?.isTxButton) isTx = true;
        if (targetObj.userData?.channelIndex !== undefined) hitChannel = targetObj.userData.channelIndex;
      }
    }
    return { isKnob, isTx, hitChannel };
  },

  resolveControl(hit, state, role, config = {}) {
    if ((role !== 'blind' && role !== 'operator') || state?.solved) return null;
    const { isKnob, isTx, hitChannel } = this.inspectBeaconTarget(hit);
    const currSlot = state?.tunedSlot || state?.tunedChannel || 1;
    const slotChannels = Array.isArray(state?.slotChannels) ? state.slotChannels : [1, 2, 3];

    if (hitChannel !== undefined) {
      const slotPosName = SLOT_POSITION_NAMES[hitChannel] || String(hitChannel);
      const mappedCh = slotChannels[hitChannel - 1] || hitChannel;
      return {
        moduleId: 'beacon',
        controlId: `channel-${hitChannel}`,
        targetType: 'channel',
        channel: hitChannel,
        slot: hitChannel,
        interactionMode: 'tap',
        label: `خانه ${slotPosName} سلکتور (بریل کانال ${mappedCh})`,
        commitLabel: `سلکتور مورس روی خانه ${slotPosName} (کانال ${mappedCh}) قرار گرفت`,
        commitDetail: 'تنظیم خانه سلکتور بریل ثبت شد.',
        buildAction() {
          return {
            moduleId: 'beacon',
            action: 'tune',
            data: { slot: hitChannel }
          };
        }
      };
    }

    if (isKnob) {
      const nextSlot = (currSlot % 3) + 1;
      const slotPosName = SLOT_POSITION_NAMES[nextSlot] || String(nextSlot);
      const mappedCh = slotChannels[nextSlot - 1] || nextSlot;
      return {
        moduleId: 'beacon',
        controlId: 'knob',
        targetType: 'knob',
        channel: nextSlot,
        slot: nextSlot,
        interactionMode: 'tap',
        label: 'سلکتور بریل فانوس مورس',
        commitLabel: `سلکتور به خانه ${slotPosName} (کانال ${mappedCh}) چرخید`,
        commitDetail: 'سلکتور به خانه بعدی تغییر یافت.',
        buildAction() {
          return {
            moduleId: 'beacon',
            action: 'tune',
            data: { slot: nextSlot }
          };
        }
      };
    }

    if (isTx) {
      const activeCh = slotChannels[currSlot - 1] || state?.tunedChannel || currSlot;
      return {
        moduleId: 'beacon',
        controlId: 'tx',
        targetType: 'tx',
        interactionMode: 'hold_commit',
        holdDurationMs: config.beaconTxHoldMs || 340,
        dedupeLockMs: 400,
        label: 'کلید ارسال فرکانس نوری (TX)',
        commitLabel: `ارسال فرکانس (TX) روی کانال ${activeCh}`,
        commitDetail: 'پالس فرکانسی برای بررسی به سرور ارسال شد.',
        buildAction() {
          return {
            moduleId: 'beacon',
            action: 'transmit'
          };
        }
      };
    }

    return null;
  },

  onVisualState(moduleView, visualEvent, role, state, descriptor) {
    if (!moduleView?.userData) return;
    const { knobGlowMesh, txGlowMesh, txGroup, txCanvas, txTex } = moduleView.userData;
    const isMonochrome = role === 'blind' || role === 'operator';
    const st = visualEvent?.state;

    if (descriptor?.targetType === 'tx') {
      if (st === 'press_start' || st === 'holding_to_commit') {
        const p = Math.max(0.08, visualEvent.progress || 0);
        txGroup.position.z = 0.018;
        txGlowMesh.visible = true;
        txGlowMesh.material.opacity = 0.85;
        drawTxCanvas(txCanvas, `TX ${Math.round(p * 100)}%`, p, isMonochrome, false);
        txTex.needsUpdate = true;
      } else {
        txGroup.position.z = 0.035;
        txGlowMesh.visible = false;
        txGlowMesh.material.opacity = 0;
        drawTxCanvas(txCanvas, state?.solved ? '✓ TX' : 'HOLD TX', 0, isMonochrome, Boolean(state?.solved));
        txTex.needsUpdate = true;
      }
      return;
    }

    if (st === 'press_start') {
      knobGlowMesh.visible = true;
      knobGlowMesh.material.opacity = 0.85;
    } else {
      knobGlowMesh.visible = false;
      knobGlowMesh.material.opacity = 0;
    }
  },

  update(moduleGroup, role, state) {
    if (!state || !moduleGroup) return;
    const { ledMesh, spectrumMesh, knobGroup, txBaseMesh, txCanvas, txTex, channelItems } =
      moduleGroup.userData;
    const isMonochrome = role === 'blind' || role === 'operator';

    const tunedSlot = state.tunedSlot || state.tunedChannel || 1;
    const slotChannels = Array.isArray(state.slotChannels) ? state.slotChannels : [1, 2, 3];
    moduleGroup.userData.currentSlot = tunedSlot;
    moduleGroup.userData.currentChannel = state.tunedChannel || slotChannels[tunedSlot - 1] || tunedSlot;

    const angles = { 1: 0.78, 2: 0, 3: -0.78 };
    if (knobGroup) {
      knobGroup.rotation.z = angles[tunedSlot] ?? 0;
    }

    if (channelItems) {
      channelItems.forEach((item, idx) => {
        const slotNum = idx + 1;
        const assignedCh = slotChannels[idx] || slotNum;
        drawDialCanvas(item.canvas, {
          channelNumber: assignedCh,
          isMonochrome,
          isHighlighted: slotNum === tunedSlot
        });
        item.tex.needsUpdate = true;
      });
    }

    if (spectrumMesh) {
      if (isMonochrome) {
        spectrumMesh.material.color.setHex(state.solved ? 0xe4e4e7 : 0x18181b);
      } else if (state.solved) {
        spectrumMesh.material.color.setHex(0x10b981);
      } else {
        const specHex = SPECTRUM_COLOR_HEX[state.spectrumColor] || SPECTRUM_COLOR_HEX.red;
        spectrumMesh.material.color.setHex(specHex);
      }
    }

    if (state.solved) {
      if (ledMesh) ledMesh.material.color.setHex(isMonochrome ? 0xf8fafc : 0x10b981);
      if (txBaseMesh) txBaseMesh.material.color.setHex(isMonochrome ? 0x18181b : 0x059669);
      if (txCanvas && txTex) {
        drawTxCanvas(txCanvas, '✓ TX', 1, isMonochrome, true);
        txTex.needsUpdate = true;
      }
      return;
    }

    if (ledMesh) {
      ledMesh.material.color.setHex(isMonochrome ? 0x27272a : 0xef4444);
    }
    if (txBaseMesh) {
      txBaseMesh.material.color.setHex(isMonochrome ? 0x09090b : 0x0284c7);
    }
    if (txCanvas && txTex) {
      drawTxCanvas(txCanvas, 'HOLD TX', 0, isMonochrome, false);
      txTex.needsUpdate = true;
    }
  },

  onPointer(hit, event, send, moduleView, role, state) {
    const desc = this.resolveControl(hit, state, role, { beaconTxHoldMs: event?.beaconTxHoldMs || 340 });
    if (event.type === 'pointercancel') {
      moduleView.userData.downControlId = null;
      moduleView.userData.txHoldStart = null;
      this.onVisualState(moduleView, { state: 'cancelled' }, role, state, desc);
      return true;
    }
    if (!desc) return false;

    if (event.type === 'pointerdown') {
      moduleView.userData.downControlId = desc.controlId;
      moduleView.userData.txHoldStart = desc.interactionMode === 'hold_commit' ? Date.now() : null;
      this.onVisualState(moduleView, { state: 'press_start', progress: 0.1 }, role, state, desc);
      return true;
    }

    if (event.type === 'pointerup') {
      const downId = moduleView.userData.downControlId;
      const holdStart = moduleView.userData.txHoldStart;
      moduleView.userData.downControlId = null;
      moduleView.userData.txHoldStart = null;
      this.onVisualState(moduleView, { state: 'idle' }, role, state, desc);

      if (downId !== desc.controlId) return false;
      if (desc.interactionMode === 'hold_commit' && (!holdStart || Date.now() - holdStart < desc.holdDurationMs)) {
        return false;
      }
      send('action', desc.buildAction());
      return true;
    }

    return false;
  }
};
