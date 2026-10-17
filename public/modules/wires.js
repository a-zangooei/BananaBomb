/**
 * Client 3D Wires Sequencer Module
 */
export const wiresClientModule = {
  id: 'wires',
  title: 'فیوزهای چهارگانه',

  build(THREE, slot, role) {
    const group = new THREE.Group();
    group.name = 'module_wires';
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

    // 3. Four Wire Mounts & Cables
    const wireMeshes = [];
    const wireYPositions = [0.22, 0.07, -0.08, -0.23];
    const wireSpan = slot.width * 0.72;

    wireYPositions.forEach((y, idx) => {
      const wireGroup = new THREE.Group();
      wireGroup.position.set(0, y, 0.07);

      // Left & Right Terminal Blocks
      const termGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.06, 12);
      termGeo.rotateX(Math.PI / 2);
      const termMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });

      const leftTerm = new THREE.Mesh(termGeo, termMat);
      leftTerm.position.x = -wireSpan / 2;
      wireGroup.add(leftTerm);

      const rightTerm = new THREE.Mesh(termGeo, termMat);
      rightTerm.position.x = wireSpan / 2;
      wireGroup.add(rightTerm);

      // Intact Wire (Single Cylinder)
      const wireRadius = 0.032;
      const intactGeo = new THREE.CylinderGeometry(wireRadius, wireRadius, wireSpan, 12);
      intactGeo.rotateZ(Math.PI / 2);
      const wireMat = new THREE.MeshLambertMaterial({
        color: isBlind ? 0x71717a : 0xdc2626
      });
      const intactMesh = new THREE.Mesh(intactGeo, wireMat);
      intactMesh.userData = { wireIndex: idx, isWire: true };
      wireGroup.add(intactMesh);

      // Cut Wire Halves (Initially hidden)
      const halfSpan = wireSpan * 0.38;
      const leftCutGeo = new THREE.CylinderGeometry(wireRadius, wireRadius, halfSpan, 12);
      leftCutGeo.rotateZ(Math.PI / 2 + 0.15);
      const leftCutMesh = new THREE.Mesh(leftCutGeo, wireMat);
      leftCutMesh.position.set(-wireSpan * 0.28, -0.02, 0);
      leftCutMesh.visible = false;
      wireGroup.add(leftCutMesh);

      const rightCutGeo = new THREE.CylinderGeometry(wireRadius, wireRadius, halfSpan, 12);
      rightCutGeo.rotateZ(Math.PI / 2 - 0.15);
      const rightCutMesh = new THREE.Mesh(rightCutGeo, wireMat);
      rightCutMesh.position.set(wireSpan * 0.28, -0.02, 0);
      rightCutMesh.visible = false;
      wireGroup.add(rightCutMesh);

      group.add(wireGroup);

      wireMeshes.push({
        wireGroup,
        intactMesh,
        leftCutMesh,
        rightCutMesh,
        wireMat,
        wireIndex: idx
      });
    });

    group.userData = {
      wireMeshes,
      ledMesh
    };

    return group;
  },

  update(moduleView, role, state) {
    if (!moduleView || !state) return;
    const { wireMeshes, ledMesh } = moduleView.userData;
    const isBlind = role === 'blind';

    // LED
    ledMesh.material.color.setHex(state.solved ? 0x10b981 : 0x475569);

    const colorHexMap = {
      red: 0xef4444,
      blue: 0x3b82f6,
      yellow: 0xeab308,
      green: 0x22c55e
    };

    wireMeshes.forEach((w) => {
      const idx = w.wireIndex;
      const isCut = state.cutWires?.includes(idx);

      // Update color: gray for blind, real colors for deaf
      if (isBlind) {
        w.wireMat.color.setHex(0x71717a);
      } else if (state.wires && state.wires[idx]) {
        const hex = colorHexMap[state.wires[idx]] || 0xef4444;
        w.wireMat.color.setHex(hex);
      }

      // Cut state representation
      if (isCut) {
        w.intactMesh.visible = false;
        w.leftCutMesh.visible = true;
        w.rightCutMesh.visible = true;
      } else {
        w.intactMesh.visible = true;
        w.leftCutMesh.visible = false;
        w.rightCutMesh.visible = false;
      }
    });
  },

  onPointer(hit, event, send, moduleView, role, state) {
    if (role !== 'blind' || state?.solved) return false;
    if (event.type !== 'pointerdown' && event.type !== 'click') return false;

    // Identify which wire was hit
    let targetMesh = hit.object;
    while (targetMesh && targetMesh.userData?.wireIndex === undefined && targetMesh.parent) {
      targetMesh = targetMesh.parent;
    }

    const wireIndex = targetMesh?.userData?.wireIndex ?? hit.object?.userData?.wireIndex;
    if (wireIndex !== undefined && !state.cutWires?.includes(wireIndex)) {
      send('action', {
        moduleId: 'wires',
        action: 'cut',
        data: { wireIndex }
      });
      return true;
    }

    return false;
  }
};
