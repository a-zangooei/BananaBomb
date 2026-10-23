/**
 * Client 3D Reactor Button Module
 * Explicit Tap vs Hold distinction, radial 3D hold-progress arc,
 * live timer digit preview during Hold, and non-color solved badge.
 */
import { createCanvas2D } from './canvas-utils.js';

function drawButtonCapCanvas(canvas, mainText, subText, bgHex, borderHex, textHex) {
  const ctx = canvas.getContext('2d');
  if (canvas._texts) canvas._texts.length = 0;

  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = bgHex;
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = borderHex;
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 240, 240);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = textHex;

  if (subText) {
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(mainText || 'دکمه', 128, 102);
    ctx.font = 'bold 26px monospace';
    ctx.fillText(subText, 128, 158);
  } else {
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText(mainText || 'دکمه', 128, 128);
  }
}

function drawProgressArcCanvas(canvas, progress, isHoldLocked) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 256);
  if (progress <= 0) return;

  // Background track
  ctx.beginPath();
  ctx.arc(128, 128, 108, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.lineWidth = 18;
  ctx.stroke();

  // Active radial progress arc
  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + Math.min(1, progress) * Math.PI * 2;
  ctx.beginPath();
  ctx.arc(128, 128, 108, startAngle, endAngle);
  ctx.strokeStyle = isHoldLocked ? '#f59e0b' : '#38bdf8';
  ctx.lineWidth = 20;
  ctx.lineCap = 'round';
  ctx.stroke();
}

export const buttonClientModule = {
  id: 'button',
  title: 'دکمه کاتالیزور',

  build(THREE, slot, role) {
    const group = new THREE.Group();
    group.name = 'module_button';

    const isBlind = role === 'blind' || role === 'operator';

    // 1. Module Base Plate
    const baseGeo = new THREE.BoxGeometry(slot.width * 0.94, slot.height * 0.94, 0.05);
    const baseMat = new THREE.MeshLambertMaterial({
      color: isBlind ? 0x27272a : 0x1e293b
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.z = 0.025;
    group.add(baseMesh);

    // 2. Button Collar / Socket Ring
    const collarGeo = new THREE.CylinderGeometry(0.4, 0.44, 0.1, 28);
    collarGeo.rotateX(Math.PI / 2);
    const collarMat = new THREE.MeshLambertMaterial({
      color: isBlind ? 0x3f3f46 : 0x334155
    });
    const collarMesh = new THREE.Mesh(collarGeo, collarMat);
    collarMesh.position.set(0, -0.05, 0.07);
    collarMesh.userData = { isButton: true };
    group.add(collarMesh);

    // 2b. Generous Invisible Touch Hitbox (radius 0.46) for reliable thumb presses
    const hitGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.24, 24);
    hitGeo.rotateX(Math.PI / 2);
    const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    const hitMesh = new THREE.Mesh(hitGeo, hitMat);
    hitMesh.position.set(0, -0.05, 0.13);
    hitMesh.userData = { isButton: true };
    group.add(hitMesh);

    // 2c. Radial Hold-Progress Arc Overlay around Collar
    const progressCanvas = createCanvas2D(256, 256);
    const progressTexture = new THREE.CanvasTexture(progressCanvas);
    const progressGeo = new THREE.PlaneGeometry(0.92, 0.92);
    const progressMat = new THREE.MeshBasicMaterial({
      map: progressTexture,
      transparent: true,
      depthWrite: false
    });
    const progressRing = new THREE.Mesh(progressGeo, progressMat);
    progressRing.position.set(0, -0.05, 0.085);
    progressRing.visible = false;
    group.add(progressRing);

    // 3. Reactor Button Plunger Mesh
    const btnRadius = 0.34;
    const btnHeight = 0.14;
    const btnGeo = new THREE.CylinderGeometry(btnRadius, btnRadius, btnHeight, 28);
    btnGeo.rotateX(Math.PI / 2);

    const btnMat = new THREE.MeshLambertMaterial({
      color: isBlind ? 0x52525b : 0xdc2626
    });

    const btnMesh = new THREE.Mesh(btnGeo, btnMat);
    btnMesh.position.set(0, -0.05, 0.14);
    btnMesh.userData = { isButton: true };
    group.add(btnMesh);

    // 4. Button Cap Label (Canvas Texture)
    const labelCanvas = createCanvas2D(256, 256);
    drawButtonCapCanvas(
      labelCanvas,
      'دکمه',
      isBlind ? 'TAP / HOLD' : '',
      isBlind ? '#3f3f46' : '#1e293b',
      isBlind ? '#71717a' : '#475569',
      '#ffffff'
    );
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const capGeo = new THREE.PlaneGeometry(btnRadius * 1.52, btnRadius * 1.52);
    const capMat = new THREE.MeshBasicMaterial({
      map: labelTexture,
      transparent: true
    });
    const capMesh = new THREE.Mesh(capGeo, capMat);
    capMesh.position.set(0, -0.05, 0.14 + btnHeight / 2 + 0.005);
    capMesh.userData = { isButton: true };
    group.add(capMesh);

    // 5. Status LED Light
    const ledGeo = new THREE.SphereGeometry(0.06, 16, 16);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x475569 });
    const ledMesh = new THREE.Mesh(ledGeo, ledMat);
    ledMesh.position.set(slot.width * 0.35, slot.height * 0.35, 0.07);
    group.add(ledMesh);

    // 6. Side Indicator Strip
    const stripGeo = new THREE.BoxGeometry(0.52, 0.085, 0.04);
    const stripMat = new THREE.MeshBasicMaterial({
      color: isBlind ? 0x3f3f46 : 0x1e293b
    });
    const stripMesh = new THREE.Mesh(stripGeo, stripMat);
    stripMesh.position.set(0, 0.33, 0.06);
    group.add(stripMesh);

    group.userData = {
      btnMesh,
      capMesh,
      hitMesh,
      progressRing,
      progressCanvas,
      progressTexture,
      ledMesh,
      stripMesh,
      labelCanvas,
      labelTexture,
      defaultBtnZ: 0.14,
      isActivelyInteracting: false,
      pressStartTime: null
    };

    return group;
  },

  resolveControl(hit, state, role, config = {}) {
    if ((role !== 'blind' && role !== 'operator') || state?.solved) return null;
    let obj = hit?.object;
    while (obj && !obj.userData?.isButton && obj.parent) {
      obj = obj.parent;
    }
    if (!obj?.userData?.isButton) return null;

    return {
      moduleId: 'button',
      controlId: 'plunger',
      interactionMode: 'tap_or_hold',
      holdDurationMs: config.holdThresholdMs || 380,
      label: 'دکمه کاتالیزور',
      buildAction({ isHold, lastTimerDigit }) {
        if (isHold) {
          return {
            moduleId: 'button',
            action: 'release',
            data: { releaseDigit: lastTimerDigit }
          };
        }
        return {
          moduleId: 'button',
          action: 'press'
        };
      }
    };
  },

  onVisualState(moduleView, visualEvent, role, state) {
    if (!moduleView?.userData) return;
    const {
      btnMesh,
      capMesh,
      stripMesh,
      progressRing,
      progressCanvas,
      progressTexture,
      labelCanvas,
      labelTexture,
      defaultBtnZ
    } = moduleView.userData;

    const st = visualEvent?.state;

    if (st === 'press_start' || st === 'pressing') {
      moduleView.userData.isActivelyInteracting = true;
      btnMesh.position.z = defaultBtnZ - 0.04;
      capMesh.position.z = defaultBtnZ - 0.04 + 0.075;
      stripMesh.material.color.setHex(0xa1a1aa);

      drawButtonCapCanvas(labelCanvas, 'ضربه کوتاه', 'TAP...', '#27272a', '#38bdf8', '#e0f2fe');
      labelTexture.needsUpdate = true;

      drawProgressArcCanvas(progressCanvas, visualEvent.progress ?? 0.08, false);
      progressTexture.needsUpdate = true;
      progressRing.visible = true;
      return;
    }

    if (st === 'holding') {
      moduleView.userData.isActivelyInteracting = true;
      btnMesh.position.z = defaultBtnZ - 0.045;
      capMesh.position.z = defaultBtnZ - 0.045 + 0.075;
      stripMesh.material.color.setHex(0xe4e4e7);

      const digitTxt = visualEvent.lastTimerDigit !== undefined ? `رقم: ${visualEvent.lastTimerDigit}` : 'HOLD';
      drawButtonCapCanvas(labelCanvas, 'نگه‌دار (HOLD)', digitTxt, '#451a03', '#f59e0b', '#fef3c7');
      labelTexture.needsUpdate = true;

      drawProgressArcCanvas(progressCanvas, 1, true);
      progressTexture.needsUpdate = true;
      progressRing.visible = true;
      return;
    }

    // Idle / Cancelled / Committed -> restore resting plunger & re-apply state label
    moduleView.userData.isActivelyInteracting = false;
    btnMesh.position.z = defaultBtnZ;
    capMesh.position.z = defaultBtnZ + 0.075;
    progressRing.visible = false;
    stripMesh.material.color.setHex(0x3f3f46);

    if (st === 'committed') {
      const doneSub = visualEvent.mode === 'hold_release' ? `✓ رقم ${visualEvent.lastTimerDigit}` : '✓ TAP';
      drawButtonCapCanvas(labelCanvas, 'ارسال شد', doneSub, '#14532d', '#22c55e', '#dcfce7');
      labelTexture.needsUpdate = true;
    } else {
      this.update(moduleView, role, state || { solved: false });
    }
  },

  update(moduleView, role, state) {
    if (!moduleView || !state) return;
    const { btnMesh, ledMesh, stripMesh, labelCanvas, labelTexture, isActivelyInteracting } = moduleView.userData;
    const isBlind = role === 'blind' || role === 'operator';

    // 1. Solved Status LED
    ledMesh.material.color.setHex(state.solved ? 0x10b981 : 0x475569);

    // Do not overwrite live TAP/HOLD cap feedback mid-press unless solved
    if (isActivelyInteracting && !state.solved) {
      return;
    }

    if (isBlind) {
      btnMesh.material.color.setHex(state.solved ? 0x14532d : 0x52525b);
      drawButtonCapCanvas(
        labelCanvas,
        state.solved ? '✓ خنثی شد' : 'دکمه',
        state.solved ? 'SOLVED' : 'TAP / HOLD',
        state.solved ? '#14532d' : '#3f3f46',
        state.solved ? '#22c55e' : '#71717a',
        '#ffffff'
      );
      labelTexture.needsUpdate = true;
    } else {
      const colorMap = {
        red: 0xdc2626,
        blue: 0x2563eb,
        yellow: 0xeab308,
        white: 0xf1f5f9
      };
      btnMesh.material.color.setHex(colorMap[state.color] || 0xdc2626);

      const isWhite = state.color === 'white' && !state.solved;
      drawButtonCapCanvas(
        labelCanvas,
        state.solved ? '✓ خنثی شد' : (state.label || 'کاتالیزور'),
        '',
        state.solved ? '#14532d' : (isWhite ? '#e2e8f0' : '#1e293b'),
        state.solved ? '#22c55e' : '#475569',
        isWhite ? '#0f172a' : '#ffffff'
      );
      labelTexture.needsUpdate = true;

      if (state.holdStripColor) {
        const stripMap = {
          yellow: 0xfacc15,
          blue: 0x3b82f6,
          white: 0xffffff,
          red: 0xef4444
        };
        stripMesh.material.color.setHex(stripMap[state.holdStripColor] || 0x1e293b);
      }
    }
  },

  onPointer(hit, event, send, moduleView, role, state) {
    const desc = this.resolveControl(hit, state, role, { holdThresholdMs: event?.holdThresholdMs || 380 });
    if (event.type === 'pointercancel') {
      moduleView.userData.pressStartTime = null;
      this.onVisualState(moduleView, { state: 'cancelled' }, role, state);
      return true;
    }
    if (!desc) return false;

    if (event.type === 'pointerdown') {
      moduleView.userData.pressStartTime = Date.now();
      this.onVisualState(moduleView, { state: 'press_start', progress: 0 }, role, state);
      return true;
    }

    if (event.type === 'pointerup') {
      const startTime = moduleView.userData.pressStartTime;
      moduleView.userData.pressStartTime = null;
      if (!startTime) {
        this.onVisualState(moduleView, { state: 'cancelled' }, role, state);
        return false;
      }
      const duration = Date.now() - startTime;
      const isHold = duration >= desc.holdDurationMs;
      this.onVisualState(
        moduleView,
        { state: 'committed', mode: isHold ? 'hold_release' : 'tap', lastTimerDigit: event.lastTimerDigit },
        role,
        state
      );
      send('action', desc.buildAction({ isHold, lastTimerDigit: event.lastTimerDigit }));
      return true;
    }
    return false;
  }
};
