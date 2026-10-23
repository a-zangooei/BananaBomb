/**
 * Client 3D Acoustic Beacon Module
 * Enlarged dial knob, channel 1-3 touch targets, intentional hold-to-transmit (TX)
 * confirmation ring, curved tactile knob outlines, and strict Operator monochrome rendering.
 */
import { createCanvas2D } from './canvas-utils.js';
import { createCircleOutlineGeometry, TACTILE_PALETTE } from '../tactile-styler.js';

const NOOP_RAYCAST = () => {};

function drawDialCanvas(canvas, label, isMonochrome, isHighlighted = false) {
  const ctx = canvas.getContext('2d');
  if (canvas._texts) canvas._texts.length = 0;

  ctx.clearRect(0, 0, 128, 128);
  if (isMonochrome) {
    ctx.fillStyle = isHighlighted ? '#27272a' : '#09090b';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = isHighlighted ? '#f8fafc' : '#71717a';
    ctx.lineWidth = isHighlighted ? 8 : 6;
    ctx.strokeRect(4, 4, 120, 120);
  } else {
    ctx.fillStyle = isHighlighted ? '#1e3a8a' : '#0f172a';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = isHighlighted ? '#fbbf24' : '#38bdf8';
    ctx.lineWidth = isHighlighted ? 8 : 6;
    ctx.strokeRect(4, 4, 120, 120);
  }

  ctx.font = 'bold 38px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f8fafc';
  ctx.fillText(label, 64, 64);
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
  title: 'فانوس صوتی (Acoustic Beacon)',

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

    // 3. Speaker / Beacon Perforated Grill (Top-Left)
    const speakerGroup = new THREE.Group();
    speakerGroup.position.set(-slot.width * 0.25, slot.height * 0.28, 0.031);
    for (let r = 0.035; r <= 0.12; r += 0.042) {
      const ringGeo = new THREE.RingGeometry(r, r + 0.014, 20);
      const ringMat = new THREE.MeshBasicMaterial({
        color: isMonochrome ? 0xa1a1aa : 0x38bdf8,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.renderOrder = 2;
      ringMesh.userData = { isOverlayPlane: true, skipTactile: true };
      speakerGroup.add(ringMesh);
    }
    group.add(speakerGroup);

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

    // 6. Enlarged Channel Notch Labels (1, 2, 3) around Dial with Dedicated Hitboxes
    const channelItems = [];
    const channelAngles = [-0.78, 0, 0.78];
    const channelLabels = ['1', '2', '3'];

    channelAngles.forEach((ang, idx) => {
      const radius = 0.37;
      const lx = -Math.sin(ang) * radius;
      const ly = Math.cos(ang) * radius - 0.01;

      const canvas = createCanvas2D(128, 128);
      drawDialCanvas(canvas, channelLabels[idx], isMonochrome, idx === 0);
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
        channelIndex: idx + 1,
        isOverlayPlane: true,
        controlId: `channel-${idx + 1}`,
        clueId: `beacon_channel_${idx + 1}`
      };
      group.add(notchMesh);

      const notchHitGeo = new THREE.BoxGeometry(0.21, 0.21, 0.09);
      const notchHitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const notchHitMesh = new THREE.Mesh(notchHitGeo, notchHitMat);
      notchHitMesh.position.set(lx, ly, 0.045);
      notchHitMesh.userData = {
        channelIndex: idx + 1,
        isTouchHitbox: true,
        skipTactile: true,
        controlId: `channel-${idx + 1}`
      };
      group.add(notchHitMesh);

      channelItems.push({ channel: idx + 1, notchMesh, notchHitMesh, canvas, tex });
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
      currentChannel: 1,
      soundLoopInterval: null
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
    const currChannel = state?.tunedChannel || 1;

    if (hitChannel !== undefined) {
      return {
        moduleId: 'beacon',
        controlId: `channel-${hitChannel}`,
        targetType: 'channel',
        channel: hitChannel,
        interactionMode: 'tap',
        label: `کانال ${hitChannel} فانوس`,
        commitLabel: `فانوس روی کانال ${hitChannel} تنظیم شد`,
        commitDetail: `سلکتور فرکانس روی کانال ${hitChannel} قرار گرفت.`,
        buildAction() {
          return {
            moduleId: 'beacon',
            action: 'tune',
            data: { channel: hitChannel }
          };
        }
      };
    }

    if (isKnob) {
      const nextChannel = (currChannel % 3) + 1;
      return {
        moduleId: 'beacon',
        controlId: 'knob',
        targetType: 'knob',
        channel: nextChannel,
        interactionMode: 'tap',
        label: 'سلکتور کانال فانوس',
        commitLabel: `فانوس به کانال ${nextChannel} چرخید`,
        commitDetail: `سلکتور به کانال بعدی (${nextChannel}) تغییر یافت.`,
        buildAction() {
          return {
            moduleId: 'beacon',
            action: 'tune',
            data: { channel: nextChannel }
          };
        }
      };
    }

    if (isTx) {
      return {
        moduleId: 'beacon',
        controlId: 'tx',
        targetType: 'tx',
        interactionMode: 'hold_commit',
        holdDurationMs: config.beaconTxHoldMs || 340,
        dedupeLockMs: 400,
        label: 'کلید ارسال فرکانس (TX)',
        commitLabel: `ارسال فرکانس (TX) روی کانال ${currChannel}`,
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
    const { ledMesh, knobGroup, txBaseMesh, txCanvas, txTex, channelItems } = moduleGroup.userData;
    const isMonochrome = role === 'blind' || role === 'operator';

    const channel = state.tunedChannel || 1;
    moduleGroup.userData.currentChannel = channel;
    const angles = { 1: 0.78, 2: 0, 3: -0.78 };
    if (knobGroup) {
      knobGroup.rotation.z = angles[channel] ?? 0;
    }

    if (channelItems) {
      channelItems.forEach((item) => {
        drawDialCanvas(item.canvas, String(item.channel), isMonochrome, item.channel === channel);
        item.tex.needsUpdate = true;
      });
    }

    if (state.solved) {
      if (ledMesh) ledMesh.material.color.setHex(isMonochrome ? 0xf8fafc : 0x10b981);
      if (txBaseMesh) txBaseMesh.material.color.setHex(isMonochrome ? 0x18181b : 0x059669);
      if (txCanvas && txTex) {
        drawTxCanvas(txCanvas, '✓ TX', 1, isMonochrome, true);
        txTex.needsUpdate = true;
      }
      if (moduleGroup.userData.soundLoopInterval) {
        clearInterval(moduleGroup.userData.soundLoopInterval);
        moduleGroup.userData.soundLoopInterval = null;
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

    if ((role === 'blind' || role === 'operator') && state.beats && !state.solved) {
      if (!moduleGroup.userData.soundLoopInterval) {
        const playLoop = () => {
          if (typeof window !== 'undefined' && window.soundEngine?.playBeaconPattern) {
            window.soundEngine.playBeaconPattern(state.beats);
          }
        };
        playLoop();
        moduleGroup.userData.soundLoopInterval = setInterval(playLoop, 4200);
      }
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
