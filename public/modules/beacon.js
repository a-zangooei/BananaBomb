/**
 * Client 3D Acoustic Beacon Module
 * Operator perceives audio pattern and tunes channel dial;
 * Observer reads physical dial and relays serial number;
 * Manual-holder decrypts target channel from the rhythm matrix.
 */
function createDialTexture(label, isMonochrome) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = isMonochrome ? '#27272a' : '#0f172a';
  ctx.fillRect(0, 0, 128, 128);

  ctx.strokeStyle = isMonochrome ? '#71717a' : '#38bdf8';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 120, 120);

  ctx.font = 'bold 36px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 64, 64);

  return canvas;
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
      color: isMonochrome ? 0x27272a : 0x1e293b
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    group.add(baseMesh);

    // 2. Status LED (Top-Right)
    const ledGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16);
    ledGeo.rotateX(Math.PI / 2);
    const ledMat = new THREE.MeshBasicMaterial({
      color: isMonochrome ? 0x71717a : 0xef4444
    });
    const ledMesh = new THREE.Mesh(ledGeo, ledMat);
    ledMesh.position.set(slot.width * 0.35, slot.height * 0.35, 0.035);
    group.add(ledMesh);

    // 3. Speaker / Beacon Perforated Grill (Top-Left)
    const speakerGroup = new THREE.Group();
    speakerGroup.position.set(-slot.width * 0.22, slot.height * 0.25, 0.03);
    for (let r = 0.04; r <= 0.14; r += 0.05) {
      const ringGeo = new THREE.RingGeometry(r, r + 0.015, 20);
      const ringMat = new THREE.MeshBasicMaterial({
        color: isMonochrome ? 0x52525b : 0x38bdf8,
        side: THREE.DoubleSide
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      speakerGroup.add(ringMesh);
    }
    group.add(speakerGroup);

    // 4. Frequency Dial Base Ring
    const dialRingGeo = new THREE.RingGeometry(0.24, 0.28, 24);
    const dialRingMat = new THREE.MeshBasicMaterial({
      color: isMonochrome ? 0x52525b : 0x475569,
      side: THREE.DoubleSide
    });
    const dialRingMesh = new THREE.Mesh(dialRingGeo, dialRingMat);
    dialRingMesh.position.set(0, -0.02, 0.03);
    group.add(dialRingMesh);

    // 5. Dial Knob (Interactive)
    const knobGroup = new THREE.Group();
    knobGroup.position.set(0, -0.02, 0.03);

    const knobBodyGeo = new THREE.CylinderGeometry(0.18, 0.21, 0.06, 24);
    knobBodyGeo.rotateX(Math.PI / 2);
    const knobBodyMat = new THREE.MeshLambertMaterial({
      color: isMonochrome ? 0x3f3f46 : 0x334155
    });
    const knobMesh = new THREE.Mesh(knobBodyGeo, knobBodyMat);
    knobMesh.userData.isKnob = true;
    knobGroup.add(knobMesh);

    // Pointer indicator on knob
    const needleGeo = new THREE.BoxGeometry(0.025, 0.14, 0.02);
    const needleMat = new THREE.MeshBasicMaterial({
      color: isMonochrome ? 0xe4e4e7 : 0xf59e0b
    });
    const needleMesh = new THREE.Mesh(needleGeo, needleMat);
    needleMesh.position.set(0, 0.07, 0.035);
    knobGroup.add(needleMesh);

    // Glow Ring for Knob when pressed
    const knobGlowGeo = new THREE.RingGeometry(0.2, 0.26, 24);
    const knobGlowMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide
    });
    const knobGlowMesh = new THREE.Mesh(knobGlowGeo, knobGlowMat);
    knobGlowMesh.position.z = 0.036;
    knobGlowMesh.visible = false;
    knobGroup.add(knobGlowMesh);

    group.add(knobGroup);

    // 6. Channel Notch Labels (1, 2, 3) around Dial
    const channelMeshes = [];
    const channelAngles = [-0.75, 0, 0.75]; // radians for 1, 2, 3
    const channelLabels = ['1', '2', '3'];

    channelAngles.forEach((ang, idx) => {
      const radius = 0.36;
      const lx = -Math.sin(ang) * radius;
      const ly = Math.cos(ang) * radius - 0.02;

      const canvas = createDialTexture(channelLabels[idx], isMonochrome);
      const tex = new THREE.CanvasTexture(canvas);
      const notchGeo = new THREE.PlaneGeometry(0.12, 0.12);
      const notchMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
      const notchMesh = new THREE.Mesh(notchGeo, notchMat);
      notchMesh.position.set(lx, ly, 0.032);
      notchMesh.userData.channelIndex = idx + 1;
      group.add(notchMesh);
      channelMeshes.push(notchMesh);
    });

    // 7. Transmit Switch Button (TX) at Bottom
    const txGroup = new THREE.Group();
    txGroup.position.set(0, -slot.height * 0.36, 0.03);

    const txBaseGeo = new THREE.BoxGeometry(0.42, 0.16, 0.04);
    const txBaseMat = new THREE.MeshLambertMaterial({
      color: isMonochrome ? 0x27272a : 0x0284c7
    });
    const txBaseMesh = new THREE.Mesh(txBaseGeo, txBaseMat);
    txBaseMesh.userData.isTxButton = true;
    txGroup.add(txBaseMesh);

    const txCanvas = createDialTexture('TX', isMonochrome);
    const txTex = new THREE.CanvasTexture(txCanvas);
    const txFaceGeo = new THREE.PlaneGeometry(0.38, 0.13);
    const txFaceMat = new THREE.MeshBasicMaterial({ map: txTex, transparent: true });
    const txFaceMesh = new THREE.Mesh(txFaceGeo, txFaceMat);
    txFaceMesh.position.z = 0.022;
    txFaceMesh.userData.isTxButton = true;
    txGroup.add(txFaceMesh);

    // Glow outline for TX button
    const txGlowGeo = new THREE.PlaneGeometry(0.44, 0.18);
    const txGlowMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0
    });
    const txGlowMesh = new THREE.Mesh(txGlowGeo, txGlowMat);
    txGlowMesh.position.z = 0.023;
    txGlowMesh.visible = false;
    txGroup.add(txGlowMesh);

    group.add(txGroup);

    group.userData = {
      baseMesh,
      ledMesh,
      knobGroup,
      knobGlowMesh,
      txGroup,
      txBaseMesh,
      txGlowMesh,
      channelMeshes,
      currentChannel: 1,
      lastBeepTime: 0,
      soundLoopInterval: null
    };

    return group;
  },

  update(moduleGroup, role, state) {
    if (!state || !moduleGroup) return;
    const { ledMesh, knobGroup, txBaseMesh, txGroup } = moduleGroup.userData;
    const isMonochrome = role === 'blind' || role === 'operator';

    // Update Channel Dial Position (-0.75, 0, +0.75)
    const channel = state.tunedChannel || 1;
    moduleGroup.userData.currentChannel = channel;
    const angles = { 1: 0.75, 2: 0, 3: -0.75 };
    if (knobGroup) {
      knobGroup.rotation.z = angles[channel] ?? 0;
    }

    // Update Solved Status
    if (state.solved) {
      if (ledMesh) {
        ledMesh.material.color.setHex(0x10b981); // Bright green
      }
      if (txBaseMesh) {
        txBaseMesh.material.color.setHex(0x059669);
      }
      // Stop looping sound if solved
      if (moduleGroup.userData.soundLoopInterval) {
        clearInterval(moduleGroup.userData.soundLoopInterval);
        moduleGroup.userData.soundLoopInterval = null;
      }
      return;
    }

    // Unsolved state
    if (ledMesh) {
      ledMesh.material.color.setHex(isMonochrome ? 0x71717a : 0xef4444);
    }

    // Looping audio telemetry for Operator / Blind role
    if ((role === 'blind' || role === 'operator') && state.beats && !state.solved) {
      if (!moduleGroup.userData.soundLoopInterval) {
        const playLoop = () => {
          if (typeof window !== 'undefined' && window.soundEngine?.playBeaconPattern) {
            window.soundEngine.playBeaconPattern(state.beats);
          }
        };
        // Initial play and loop every 4.2 seconds
        playLoop();
        moduleGroup.userData.soundLoopInterval = setInterval(playLoop, 4200);
      }
    }
  },

  onPointer(hit, event, send, moduleView, role, state) {
    const isOperator = role === 'blind' || role === 'operator';
    if (!isOperator || state?.solved) return false;

    const { knobGlowMesh, txGlowMesh, txGroup } = moduleView.userData;

    // Detect what was touched: knob vs TX button vs notch mark
    let targetObj = hit.object;
    let isKnob = targetObj?.userData?.isKnob;
    let isTx = targetObj?.userData?.isTxButton;
    let hitChannel = targetObj?.userData?.channelIndex;

    // Trace parent if clicked child
    while (targetObj && targetObj !== moduleView && !isKnob && !isTx && hitChannel === undefined) {
      targetObj = targetObj.parent;
      if (targetObj) {
        if (targetObj.userData?.isKnob) isKnob = true;
        if (targetObj.userData?.isTxButton) isTx = true;
        if (targetObj.userData?.channelIndex !== undefined) hitChannel = targetObj.userData.channelIndex;
      }
    }

    if (event.type === 'pointerdown') {
      if (isKnob || hitChannel !== undefined) {
        if (knobGlowMesh) {
          knobGlowMesh.visible = true;
          knobGlowMesh.material.opacity = 0.85;
        }
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(20); } catch (e) {}
        }
        if (typeof window !== 'undefined' && window.soundEngine?.playTactileTick) {
          window.soundEngine.playTactileTick();
        }
        return true;
      }

      if (isTx) {
        if (txGlowMesh) {
          txGlowMesh.visible = true;
          txGlowMesh.material.opacity = 0.85;
        }
        if (txGroup) {
          txGroup.position.z = 0.015; // depressed button
        }
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(25); } catch (e) {}
        }
        if (typeof window !== 'undefined' && window.soundEngine?.playTactileTick) {
          window.soundEngine.playTactileTick();
        }
        return true;
      }

      return false;
    }

    if (event.type === 'pointercancel') {
      if (knobGlowMesh) {
        knobGlowMesh.visible = false;
        knobGlowMesh.material.opacity = 0;
      }
      if (txGlowMesh) {
        txGlowMesh.visible = false;
        txGlowMesh.material.opacity = 0;
      }
      if (txGroup) {
        txGroup.position.z = 0.03;
      }
      return true;
    }

    if (event.type === 'pointerup' || event.type === 'click') {
      if (knobGlowMesh) {
        knobGlowMesh.visible = false;
        knobGlowMesh.material.opacity = 0;
      }
      if (txGlowMesh) {
        txGlowMesh.visible = false;
        txGlowMesh.material.opacity = 0;
      }
      if (txGroup) {
        txGroup.position.z = 0.03;
      }

      if (isKnob || hitChannel !== undefined) {
        const curr = moduleView.userData.currentChannel || 1;
        const nextChannel = hitChannel !== undefined ? hitChannel : ((curr % 3) + 1);
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(25); } catch (e) {}
        }
        if (typeof window !== 'undefined' && window.soundEngine?.playClick) {
          window.soundEngine.playClick();
        }
        send('action', {
          moduleId: 'beacon',
          action: 'tune',
          data: { channel: nextChannel }
        });
        return true;
      }

      if (isTx) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate([30, 20]); } catch (e) {}
        }
        if (typeof window !== 'undefined' && window.soundEngine?.playClick) {
          window.soundEngine.playClick();
        }
        send('action', {
          moduleId: 'beacon',
          action: 'transmit'
        });
        return true;
      }
    }

    return false;
  }
};
