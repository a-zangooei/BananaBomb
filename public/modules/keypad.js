/**
 * Client 3D Cipher Keypad Module
 */
function createKeyLabelTexture(text, isEntered, isBlind) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = isEntered ? '#14532d' : isBlind ? '#27272a' : '#0f172a';
  ctx.fillRect(0, 0, 128, 128);

  ctx.strokeStyle = isEntered ? '#22c55e' : isBlind ? '#52525b' : '#38bdf8';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, 120, 120);

  ctx.font = isBlind ? 'bold 50px monospace' : 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isEntered ? '#86efac' : isBlind ? '#f4f4f5' : '#38bdf8';
  ctx.fillText(text, 64, 64);

  return canvas;
}

export const keypadClientModule = {
  id: 'keypad',
  title: 'نمادهای رمزی',

  build(THREE, slot, role) {
    const group = new THREE.Group();
    group.name = 'module_keypad';
    const isBlind = role === 'blind';

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

    // 3. 2x2 Keypad Buttons
    const keyData = [];
    const positions = [
      { x: -0.22, y: 0.12 },
      { x: 0.22, y: 0.12 },
      { x: -0.22, y: -0.22 },
      { x: 0.22, y: -0.22 }
    ];

    positions.forEach((pos, idx) => {
      const keyBoxGeo = new THREE.BoxGeometry(0.32, 0.28, 0.07);
      const keyBoxMat = new THREE.MeshLambertMaterial({
        color: isBlind ? 0x3f3f46 : 0x1e293b
      });
      const keyMesh = new THREE.Mesh(keyBoxGeo, keyBoxMat);
      keyMesh.position.set(pos.x, pos.y, 0.07);
      keyMesh.userData = { slotIndex: idx, isKey: true };

      const defaultText = isBlind ? `${idx + 1}` : '■';
      const labelCanvas = createKeyLabelTexture(defaultText, false, isBlind);
      const labelTexture = new THREE.CanvasTexture(labelCanvas);

      const faceGeo = new THREE.PlaneGeometry(0.3, 0.26);
      const faceMat = new THREE.MeshBasicMaterial({
        map: labelTexture,
        transparent: true
      });
      const faceMesh = new THREE.Mesh(faceGeo, faceMat);
      faceMesh.position.set(0, 0, 0.036);
      faceMesh.userData = { slotIndex: idx, isKey: true };
      keyMesh.add(faceMesh);

      // Tactile Glow frame around key
      const glowGeo = new THREE.PlaneGeometry(0.35, 0.31);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide
      });
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.position.set(pos.x, pos.y, 0.04);
      glowMesh.visible = false;
      group.add(glowMesh);

      group.add(keyMesh);

      keyData.push({
        slotIndex: idx,
        keyMesh,
        faceMesh,
        glowMesh,
        labelCanvas,
        labelTexture,
        defaultZ: 0.07
      });
    });

    group.userData = {
      keyData,
      ledMesh
    };

    return group;
  },

  update(moduleView, role, state) {
    if (!moduleView || !state) return;
    const { keyData, ledMesh } = moduleView.userData;
    const isBlind = role === 'blind';

    // Status LED
    ledMesh.material.color.setHex(state.solved ? 0x10b981 : 0x475569);

    keyData.forEach((k) => {
      const idx = k.slotIndex;
      const isEntered = state.enteredSlots?.includes(idx) ?? (idx < (state.enteredCount || 0));

      // Label text: Blind sees "1", "2", "3", "4"; Deaf sees actual symbols
      let symbolText = isBlind ? `${idx + 1}` : (state.symbols?.[idx] || '■');

      const ctx = k.labelCanvas.getContext('2d');
      ctx.fillStyle = isEntered ? '#14532d' : isBlind ? '#27272a' : '#0f172a';
      ctx.fillRect(0, 0, 128, 128);

      ctx.strokeStyle = isEntered ? '#22c55e' : isBlind ? '#52525b' : '#38bdf8';
      ctx.lineWidth = 6;
      ctx.strokeRect(4, 4, 120, 120);

      ctx.font = isBlind ? 'bold 50px monospace' : 'bold 56px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isEntered ? '#86efac' : isBlind ? '#f4f4f5' : '#38bdf8';
      ctx.fillText(symbolText, 64, 64);

      k.labelTexture.needsUpdate = true;

      // Depress key slightly if already entered
      k.keyMesh.position.z = isEntered ? k.defaultZ - 0.025 : k.defaultZ;
    });
  },

  onPointer(hit, event, send, moduleView, role, state) {
    if (role !== 'blind' || state?.solved) return false;
    const { keyData } = moduleView.userData;

    let targetMesh = hit.object;
    while (targetMesh && targetMesh.userData?.slotIndex === undefined && targetMesh.parent) {
      targetMesh = targetMesh.parent;
    }

    const slotIndex = targetMesh?.userData?.slotIndex ?? hit.object?.userData?.slotIndex;
    if (slotIndex === undefined) return false;

    const keyItem = keyData.find((k) => k.slotIndex === slotIndex);

    if (event.type === 'pointerdown') {
      if (keyItem && !state.enteredSlots?.includes(slotIndex)) {
        keyItem.keyMesh.position.z = keyItem.defaultZ - 0.03;
        if (keyItem.glowMesh) {
          keyItem.glowMesh.visible = true;
          keyItem.glowMesh.material.opacity = 0.85;
        }
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(25); } catch (e) {}
        }
      }
      return true;
    }

    if (event.type === 'pointercancel') {
      if (keyItem) {
        const isEntered = state.enteredSlots?.includes(slotIndex);
        keyItem.keyMesh.position.z = isEntered ? keyItem.defaultZ - 0.025 : keyItem.defaultZ;
        if (keyItem.glowMesh) {
          keyItem.glowMesh.visible = false;
          keyItem.glowMesh.material.opacity = 0;
        }
      }
      return true;
    }

    if (event.type === 'pointerup' || event.type === 'click') {
      if (keyItem) {
        const isEntered = state.enteredSlots?.includes(slotIndex);
        keyItem.keyMesh.position.z = isEntered ? keyItem.defaultZ - 0.025 : keyItem.defaultZ;
        if (keyItem.glowMesh) {
          keyItem.glowMesh.visible = false;
          keyItem.glowMesh.material.opacity = 0;
        }
      }

      if (!state.enteredSlots?.includes(slotIndex)) {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          try { navigator.vibrate(20); } catch (e) {}
        }
        send('action', {
          moduleId: 'keypad',
          action: 'press',
          data: { slotIndex }
        });
        return true;
      }
    }

    return false;
  }
};
