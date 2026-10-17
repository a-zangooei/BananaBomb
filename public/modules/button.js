/**
 * Client 3D Reactor Button Module
 */
function createButtonLabelTexture(text, isMonochrome) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = isMonochrome ? '#3f3f46' : '#1e293b';
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = isMonochrome ? '#71717a' : '#475569';
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, 240, 240);

  ctx.font = 'bold 36px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text || 'دکمه', 128, 128);

  return canvas;
}

export const buttonClientModule = {
  id: 'button',
  title: 'دکمه کاتالیزور',

  build(THREE, slot, role) {
    const group = new THREE.Group();
    group.name = 'module_button';

    const isBlind = role === 'blind';

    // 1. Module Base Plate
    const baseGeo = new THREE.BoxGeometry(slot.width * 0.94, slot.height * 0.94, 0.05);
    const baseMat = new THREE.MeshLambertMaterial({
      color: isBlind ? 0x27272a : 0x1e293b
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.z = 0.025;
    group.add(baseMesh);

    // 2. Button Collar / Socket Ring
    const collarGeo = new THREE.CylinderGeometry(0.38, 0.42, 0.1, 24);
    collarGeo.rotateX(Math.PI / 2);
    const collarMat = new THREE.MeshLambertMaterial({
      color: isBlind ? 0x3f3f46 : 0x334155
    });
    const collarMesh = new THREE.Mesh(collarGeo, collarMat);
    collarMesh.position.set(0, -0.05, 0.07);
    group.add(collarMesh);

    // 3. Reactor Button Mesh
    const btnRadius = 0.32;
    const btnHeight = 0.14;
    const btnGeo = new THREE.CylinderGeometry(btnRadius, btnRadius, btnHeight, 24);
    btnGeo.rotateX(Math.PI / 2);

    const btnMat = new THREE.MeshLambertMaterial({
      color: isBlind ? 0x52525b : 0xdc2626
    });

    const btnMesh = new THREE.Mesh(btnGeo, btnMat);
    btnMesh.position.set(0, -0.05, 0.14);
    btnMesh.userData = { isButton: true };
    group.add(btnMesh);

    // 4. Button Cap Label (Canvas Texture)
    const labelCanvas = createButtonLabelTexture('دکمه', isBlind);
    const labelTexture = new THREE.CanvasTexture(labelCanvas);
    const capGeo = new THREE.PlaneGeometry(btnRadius * 1.5, btnRadius * 1.5);
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
    const stripGeo = new THREE.BoxGeometry(0.5, 0.08, 0.04);
    const stripMat = new THREE.MeshBasicMaterial({
      color: isBlind ? 0x3f3f46 : 0x1e293b
    });
    const stripMesh = new THREE.Mesh(stripGeo, stripMat);
    stripMesh.position.set(0, 0.32, 0.06);
    group.add(stripMesh);

    // Keep references on group for easy visual updates
    group.userData = {
      btnMesh,
      capMesh,
      ledMesh,
      stripMesh,
      labelCanvas,
      labelTexture,
      defaultBtnZ: 0.14,
      pressStartTime: null,
      holdTimer: null
    };

    return group;
  },

  update(moduleView, role, state) {
    if (!moduleView || !state) return;
    const { btnMesh, capMesh, ledMesh, stripMesh, labelCanvas, labelTexture } = moduleView.userData;
    const isBlind = role === 'blind';

    // 1. Solved Status LED
    if (state.solved) {
      ledMesh.material.color.setHex(0x10b981);
    } else {
      ledMesh.material.color.setHex(0x475569);
    }

    // 2. Button Colors & Labels
    if (isBlind) {
      btnMesh.material.color.setHex(0x52525b);
      const ctx = labelCanvas.getContext('2d');
      ctx.fillStyle = '#3f3f46';
      ctx.fillRect(0, 0, 256, 256);
      ctx.font = 'bold 34px sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.solved ? 'خنثی شد' : 'دکمه', 128, 128);
      labelTexture.needsUpdate = true;
    } else {
      // Deaf sees actual color and label
      const colorMap = {
        red: 0xdc2626,
        blue: 0x2563eb,
        yellow: 0xeab308,
        white: 0xf1f5f9
      };
      btnMesh.material.color.setHex(colorMap[state.color] || 0xdc2626);

      const ctx = labelCanvas.getContext('2d');
      ctx.fillStyle = state.color === 'white' ? '#e2e8f0' : '#1e293b';
      ctx.fillRect(0, 0, 256, 256);
      ctx.font = 'bold 32px sans-serif';
      ctx.fillStyle = state.color === 'white' ? '#0f172a' : '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.solved ? 'خنثی شد' : (state.label || 'خنثی‌سازی'), 128, 128);
      labelTexture.needsUpdate = true;

      // Side strip color for Deaf
      if (state.holdStripColor) {
        const stripMap = { yellow: 0xfacc15, blue: 0x3b82f6, white: 0xffffff };
        stripMesh.material.color.setHex(stripMap[state.holdStripColor] || 0x1e293b);
      }
    }
  },

  onPointer(hit, event, send, moduleView, role, state) {
    if (role !== 'blind' || state?.solved) return;
    const { btnMesh, capMesh, stripMesh, defaultBtnZ } = moduleView.userData;

    if (event.type === 'pointerdown') {
      moduleView.userData.pressStartTime = Date.now();
      btnMesh.position.z = defaultBtnZ - 0.04;
      capMesh.position.z = defaultBtnZ - 0.04 + 0.075;
      stripMesh.material.color.setHex(0xa1a1aa); // Monochrome active strip
      return true;
    }

    if (event.type === 'pointerup') {
      const startTime = moduleView.userData.pressStartTime;
      btnMesh.position.z = defaultBtnZ;
      capMesh.position.z = defaultBtnZ + 0.075;
      stripMesh.material.color.setHex(0x3f3f46);

      if (!startTime) return false;
      const duration = Date.now() - startTime;
      moduleView.userData.pressStartTime = null;

      if (duration < 350) {
        send('action', {
          moduleId: 'button',
          action: 'press'
        });
      } else {
        send('action', {
          moduleId: 'button',
          action: 'release',
          data: { releaseDigit: event.lastTimerDigit }
        });
      }
      return true;
    }

    return false;
  }
};
