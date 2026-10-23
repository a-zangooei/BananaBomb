/**
 * Client 3D Wires Sequencer Module
 * Requires an intentional ~400ms press-and-hold with a visible 3D progress ring
 * before cutting, large non-overlapping hitboxes, and monochrome 1–4 slot tags
 * for the Operator so wire slots never depend exclusively on color.
 */
import { createCanvas2D } from './canvas-utils.js';

function createWireBadgeCanvas(indexNumber, isMonochrome) {
  const canvas = createCanvas2D(64, 64);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);

  ctx.fillStyle = isMonochrome ? '#27272a' : '#1e293b';
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineWidth = 4;
  ctx.strokeStyle = isMonochrome ? '#a1a1aa' : '#38bdf8';
  ctx.stroke();

  ctx.fillStyle = isMonochrome ? '#f4f4f5' : '#38bdf8';
  ctx.font = 'bold 34px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(indexNumber), 32, 34);
  return canvas;
}

function drawWireCutProgress(canvas, progress) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  if (progress <= 0) return;

  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
  ctx.stroke();

  const start = -Math.PI / 2;
  const end = start + Math.min(1, progress) * Math.PI * 2;
  ctx.beginPath();
  ctx.arc(64, 64, 48, start, end);
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#f59e0b';
  ctx.stroke();

  ctx.fillStyle = '#fef3c7';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✂', 64, 66);
}

export const wiresClientModule = {
  id: 'wires',
  title: 'فیوزهای چهارگانه',

  build(THREE, slot, role) {
    const group = new THREE.Group();
    group.name = 'module_wires';
    const isBlind = role === 'blind' || role === 'operator';

    // 1. Module Base Plate
    const baseGeo = new THREE.BoxGeometry(slot.width * 0.94, slot.height * 0.94, 0.05);
    const baseMat = new THREE.MeshLambertMaterial({
      color: isBlind ? 0x27272a : 0x1e293b
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.z = 0.025;
    group.add(baseMesh);

    // 2. Status LED
    const ledGeo = new THREE.SphereGeometry(0.06, 16, 16);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x475569 });
    const ledMesh = new THREE.Mesh(ledGeo, ledMat);
    ledMesh.position.set(slot.width * 0.35, slot.height * 0.35, 0.07);
    group.add(ledMesh);

    // 3. Four Well-Spaced Wire Mounts & Cables (17cm scene spacing, 15.5cm hitboxes -> zero overlap)
    const wireMeshes = [];
    const wireYPositions = [0.24, 0.075, -0.09, -0.255];
    const wireSpan = slot.width * 0.72;

    wireYPositions.forEach((y, idx) => {
      const wireGroup = new THREE.Group();
      wireGroup.position.set(0.03, y, 0.07);

      // Left & Right Terminal Blocks
      const termGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.06, 12);
      termGeo.rotateX(Math.PI / 2);
      const termMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });

      const leftTerm = new THREE.Mesh(termGeo, termMat);
      leftTerm.position.x = -wireSpan / 2;
      wireGroup.add(leftTerm);

      const rightTerm = new THREE.Mesh(termGeo, termMat);
      rightTerm.position.x = wireSpan / 2;
      wireGroup.add(rightTerm);

      // Intact Wire
      const wireRadius = 0.036;
      const intactGeo = new THREE.CylinderGeometry(wireRadius, wireRadius, wireSpan, 14);
      intactGeo.rotateZ(Math.PI / 2);
      const wireMat = new THREE.MeshLambertMaterial({
        color: isBlind ? 0x71717a : 0xdc2626
      });
      const intactMesh = new THREE.Mesh(intactGeo, wireMat);
      intactMesh.userData = { wireIndex: idx, isWire: true };
      wireGroup.add(intactMesh);

      // Cut Wire Halves (Initially hidden)
      const halfSpan = wireSpan * 0.37;
      const leftCutGeo = new THREE.CylinderGeometry(wireRadius, wireRadius, halfSpan, 12);
      leftCutGeo.rotateZ(Math.PI / 2 + 0.16);
      const leftCutMesh = new THREE.Mesh(leftCutGeo, wireMat);
      leftCutMesh.position.set(-wireSpan * 0.28, -0.02, 0);
      leftCutMesh.visible = false;
      wireGroup.add(leftCutMesh);

      const rightCutGeo = new THREE.CylinderGeometry(wireRadius, wireRadius, halfSpan, 12);
      rightCutGeo.rotateZ(Math.PI / 2 - 0.16);
      const rightCutMesh = new THREE.Mesh(rightCutGeo, wireMat);
      rightCutMesh.position.set(wireSpan * 0.28, -0.02, 0);
      rightCutMesh.visible = false;
      wireGroup.add(rightCutMesh);

      // Non-color spatial slot badge (1..4): always visible in monochrome for Operator,
      // and visible for Observer when Easy-mode wireIndexLabels is enabled.
      const badgeCanvas = createWireBadgeCanvas(idx + 1, isBlind);
      const badgeTex = new THREE.CanvasTexture(badgeCanvas);
      const lblMat = new THREE.MeshBasicMaterial({ map: badgeTex, transparent: true });
      const lblGeo = new THREE.PlaneGeometry(0.13, 0.13);
      const labelMesh = new THREE.Mesh(lblGeo, lblMat);
      labelMesh.position.set(-wireSpan / 2 - 0.085, 0, 0.045);
      labelMesh.visible = isBlind;
      labelMesh.userData = { wireIndex: idx, isWire: true };
      wireGroup.add(labelMesh);

      // 3D Hold-to-Cut Progress Ring centered on the wire
      const progCanvas = createCanvas2D(128, 128);
      const progTex = new THREE.CanvasTexture(progCanvas);
      const progGeo = new THREE.PlaneGeometry(0.22, 0.22);
      const progMat = new THREE.MeshBasicMaterial({
        map: progTex,
        transparent: true,
        depthWrite: false
      });
      const progressMesh = new THREE.Mesh(progGeo, progMat);
      progressMesh.position.set(0, 0, 0.065);
      progressMesh.visible = false;
      wireGroup.add(progressMesh);

      // Generous non-overlapping touch hitbox (height 0.152 inside 0.165 pitch)
      const hitBoxGeo = new THREE.BoxGeometry(wireSpan * 1.04, 0.152, 0.15);
      const hitBoxMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
      const hitBoxMesh = new THREE.Mesh(hitBoxGeo, hitBoxMat);
      hitBoxMesh.userData = { wireIndex: idx, isWire: true };
      wireGroup.add(hitBoxMesh);

      group.add(wireGroup);

      wireMeshes.push({
        wireGroup,
        intactMesh,
        leftCutMesh,
        rightCutMesh,
        wireMat,
        labelMesh,
        progressMesh,
        progCanvas,
        progTex,
        wireIndex: idx
      });
    });

    group.userData = {
      wireMeshes,
      ledMesh
    };

    return group;
  },

  findWireIndexFromHit(hit) {
    let targetMesh = hit?.object;
    while (targetMesh && targetMesh.userData?.wireIndex === undefined && targetMesh.parent) {
      targetMesh = targetMesh.parent;
    }
    return targetMesh?.userData?.wireIndex ?? hit?.object?.userData?.wireIndex;
  },

  resolveControl(hit, state, role, config = {}) {
    if ((role !== 'blind' && role !== 'operator') || state?.solved) return null;
    const wireIndex = this.findWireIndexFromHit(hit);
    if (wireIndex === undefined || state?.cutWires?.includes(wireIndex)) return null;

    return {
      moduleId: 'wires',
      controlId: `wire-${wireIndex}`,
      wireIndex,
      interactionMode: 'hold_commit',
      holdDurationMs: config.wireCutHoldMs || 400,
      dedupeLockMs: 350,
      label: `سیم ${wireIndex + 1}`,
      commitLabel: `سیم ${wireIndex + 1} قطع شد`,
      commitDetail: `قطع عمدی سیم شماره ${wireIndex + 1} ثبت گردید.`,
      buildAction() {
        return {
          moduleId: 'wires',
          action: 'cut',
          data: { wireIndex }
        };
      }
    };
  },

  onVisualState(moduleView, visualEvent, role, state, descriptor) {
    if (!moduleView?.userData?.wireMeshes) return;
    const targetIdx = descriptor?.wireIndex;
    const st = visualEvent?.state;

    moduleView.userData.wireMeshes.forEach((w) => {
      if (w.wireIndex !== targetIdx) {
        w.progressMesh.visible = false;
        return;
      }

      if (st === 'press_start' || st === 'holding_to_commit') {
        w.wireMat.color.setHex(0xd4d4d8); // Brighten selected wire in monochrome
        drawWireCutProgress(w.progCanvas, Math.max(0.08, visualEvent.progress || 0));
        w.progTex.needsUpdate = true;
        w.progressMesh.visible = true;
      } else {
        w.progressMesh.visible = false;
        if (role === 'blind' || role === 'operator') {
          w.wireMat.color.setHex(0x71717a);
        }
      }
    });
  },

  update(moduleView, role, state) {
    if (!moduleView || !state) return;
    const { wireMeshes, ledMesh } = moduleView.userData;
    const isBlind = role === 'blind' || role === 'operator';

    ledMesh.material.color.setHex(state.solved ? 0x10b981 : 0x475569);

    const colorHexMap = {
      red: 0xef4444,
      blue: 0x3b82f6,
      yellow: 0xeab308,
      green: 0x22c55e
    };

    wireMeshes.forEach((w) => {
      const idx = w.wireIndex;
      const isCut = Boolean(state.cutWires?.includes(idx));

      if (w.labelMesh) {
        // Operator always gets monochrome 1..4 index badges; Observer gets them when wireIndexLabels is active
        w.labelMesh.visible = isBlind ? true : Boolean(state.wireIndexLabels);
      }

      if (isBlind) {
        w.wireMat.color.setHex(0x71717a);
      } else if (state.wires && state.wires[idx]) {
        const hex = colorHexMap[state.wires[idx]] || 0xef4444;
        w.wireMat.color.setHex(hex);
      }

      if (isCut) {
        w.intactMesh.visible = false;
        w.leftCutMesh.visible = true;
        w.rightCutMesh.visible = true;
        w.progressMesh.visible = false;
      } else {
        w.intactMesh.visible = true;
        w.leftCutMesh.visible = false;
        w.rightCutMesh.visible = false;
      }
    });
  },

  onPointer(hit, event, send, moduleView, role, state) {
    const desc = this.resolveControl(hit, state, role, { wireCutHoldMs: event?.wireCutHoldMs || 400 });
    if (event.type === 'pointercancel') {
      moduleView.userData.wireHoldStart = null;
      moduleView.userData.wireHoldIndex = null;
      this.onVisualState(moduleView, { state: 'cancelled' }, role, state, desc);
      return true;
    }
    if (!desc) return false;

    if (event.type === 'pointerdown') {
      moduleView.userData.wireHoldStart = Date.now();
      moduleView.userData.wireHoldIndex = desc.wireIndex;
      this.onVisualState(moduleView, { state: 'press_start', progress: 0.1 }, role, state, desc);
      return true;
    }

    if (event.type === 'pointerup') {
      const start = moduleView.userData.wireHoldStart;
      const startIdx = moduleView.userData.wireHoldIndex;
      moduleView.userData.wireHoldStart = null;
      moduleView.userData.wireHoldIndex = null;
      this.onVisualState(moduleView, { state: 'idle' }, role, state, desc);

      if (!start || startIdx !== desc.wireIndex) return false;
      if (Date.now() - start < desc.holdDurationMs) {
        return false; // Released before intentional hold duration -> safe cancel!
      }
      send('action', desc.buildAction());
      return true;
    }

    return false;
  }
};
