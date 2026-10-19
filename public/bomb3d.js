import * as THREE from 'three';
import { clientModules, clientModulesById } from './modules/index.js';

/**
 * Checks if WebGL is available in the current browser environment.
 */
export function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}

/**
 * Procedural Serial Number Plate Texture
 */
function createSerialPlateTexture(serialNumber, isBlind) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = isBlind ? '#27272a' : '#1e293b';
  ctx.fillRect(0, 0, 512, 128);

  ctx.strokeStyle = isBlind ? '#52525b' : '#f59e0b';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);

  if (!isBlind && serialNumber) {
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('ORDNANCE DISPOSAL UNIT // DEFENSE TECH', 24, 38);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 44px monospace';
    ctx.fillText(`SERIAL: ${serialNumber}`, 24, 88);

    // Fake barcode stripes on right
    ctx.fillStyle = '#94a3b8';
    for (let x = 400; x < 480; x += 8) {
      ctx.fillRect(x, 24, (x % 3 === 0 ? 5 : 2), 70);
    }
  } else {
    ctx.fillStyle = '#71717a';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('[CLASSIFIED // SERIAL SCRATCHED]', 256, 70);
  }

  return canvas;
}

/**
 * Standalone Responsive 3D Bomb Scene Manager
 */
export class Bomb3DScene {
  constructor(containerEl, role, onActionSend, getTimerRemaining) {
    this.container = containerEl;
    this.role = role;
    this.send = onActionSend;
    this.getTimerRemaining = getTimerRemaining || (() => 300);

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.bombGroup = null;
    this.moduleViews = new Map();
    this.animFrameId = null;
    this.resizeObserver = null;

    // Camera Framing & Distance Adaptation
    this.baseCameraDist = 3.6;
    this.cameraDist = 3.6;
    this.targetCameraDist = 3.6;

    // Rotation state
    this.targetRotX = 0;
    this.targetRotY = 0;
    this.currentRotX = 0;
    this.currentRotY = 0;

    // Pointer & Multi-touch Gesture tracking
    this.pointers = new Map();
    this.isDragging = false;
    this.dragStartPos = { x: 0, y: 0 };
    this.lastPointerPos = { x: 0, y: 0 };
    this.pinchStartDist = 0;
    this.hasMovedSignificantly = false;
    this.candidateModule = null;

    this.raycaster = new THREE.Raycaster();
    this.mouseVec = new THREE.Vector2();

    this.serialPlateMesh = null;
    this.serialPlateCanvas = null;
    this.serialPlateTexture = null;
    this.currentState = null;

    // Bound event handlers for clean disposal
    this.boundPointerDown = null;
    this.boundPointerMove = null;
    this.boundPointerUp = null;
    this.boundPointerCancel = null;
    this.boundWheel = null;
    this.boundLostCapture = null;
    this.boundWindowBlur = null;

    this.init();
  }

  init() {
    const width = Math.max(100, this.container.clientWidth || 360);
    const height = Math.max(100, this.container.clientHeight || 420);
    const aspect = width / height;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070b12);

    // 2. Camera with Adaptive Framing
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 50);
    this.targetCameraDist = this.calcOptimalCameraDist(width, height);
    this.cameraDist = this.targetCameraDist;
    this.camera.position.set(0, 0, this.cameraDist);

    // 3. Renderer with Mobile Optimizations
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // capped at 2 for mobile efficiency
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff5eb, 1.4);
    dirLight.position.set(3, 5, 4);
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.65);
    fillLight.position.set(-3, -3, 2);
    this.scene.add(fillLight);

    // 5. Build Bomb Model
    this.buildBombModel();

    // 6. Bind Native Pointer / Touch Events
    this.setupTouchControls();

    // 7. Setup Container-Driven ResizeObserver
    this.setupResizeObserver();

    // 8. Start Render Loop
    this.animate = this.animate.bind(this);
    this.animate();
  }

  /**
   * Calculates ideal camera distance based on viewport width & height.
   * On tall/narrow aspect ratios (portrait mobile), scales distance inversely
   * with aspect ratio so the horizontal edges of the bomb are never clipped.
   */
  calcOptimalCameraDist(width, height) {
    const aspect = (width && height) ? (width / height) : 1;
    if (aspect < 1.0) {
      // In portrait: bomb width requires more distance to fit in narrower horizontal FOV
      return this.baseCameraDist / Math.max(0.62, aspect);
    }
    return this.baseCameraDist;
  }

  setupResizeObserver() {
    if (typeof ResizeObserver !== 'undefined' && this.container) {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            this.handleResize(width, height);
          }
        }
      });
      this.resizeObserver.observe(this.container);
    }
  }

  handleResize(width, height) {
    if (!this.container || !this.renderer || !this.camera) return;
    const w = width || this.container.clientWidth;
    const h = height || this.container.clientHeight;
    if (w === 0 || h === 0) return;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);

    // Adapt camera framing smoothly if user hasn't zoomed manually far away
    const idealDist = this.calcOptimalCameraDist(w, h);
    if (Math.abs(this.targetCameraDist - this.cameraDist) < 0.3) {
      this.targetCameraDist = idealDist;
    }
  }

  resize() {
    this.handleResize();
  }

  buildBombModel() {
    if (this.bombGroup) {
      this.scene.remove(this.bombGroup);
    }

    this.bombGroup = new THREE.Group();
    const isBlind = this.role === 'blind';
    const numModules = clientModules.length;

    // Calculate slots layout (supports up to 6 modules)
    let cols = numModules <= 3 ? numModules : (numModules <= 4 ? 2 : 3);
    let rows = Math.ceil(numModules / cols);

    const slotW = 1.05;
    const slotH = 1.05;
    const spacing = 0.12;

    const bodyWidth = cols * slotW + (cols + 1) * spacing;
    const bodyHeight = rows * slotH + (rows + 1) * spacing + 0.2;
    const bodyDepth = 0.5;

    // Main Bomb Body Box
    const bodyGeo = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth);
    const bodyMat = new THREE.MeshLambertMaterial({
      color: isBlind ? 0x27272a : 0x0f172a
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.bombGroup.add(bodyMesh);

    // Outer Beveled Edge Frame / Rim
    const rimGeo = new THREE.BoxGeometry(bodyWidth + 0.08, bodyHeight + 0.08, 0.1);
    const rimMat = new THREE.MeshLambertMaterial({
      color: isBlind ? 0x3f3f46 : 0x1e293b
    });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.z = bodyDepth / 2 - 0.05;
    this.bombGroup.add(rimMesh);

    // Corner Screws
    const screwGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.02, 10);
    screwGeo.rotateX(Math.PI / 2);
    const screwMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });
    const cornerOffsets = [
      [-bodyWidth / 2 + 0.08, bodyHeight / 2 - 0.08],
      [bodyWidth / 2 - 0.08, bodyHeight / 2 - 0.08],
      [-bodyWidth / 2 + 0.08, -bodyHeight / 2 + 0.08],
      [bodyWidth / 2 - 0.08, -bodyHeight / 2 + 0.08]
    ];
    cornerOffsets.forEach(([cx, cy]) => {
      const screw = new THREE.Mesh(screwGeo, screwMat);
      screw.position.set(cx, cy, bodyDepth / 2 + 0.01);
      this.bombGroup.add(screw);
    });

    // Serial Number Plate on the Back Face
    const plateW = Math.min(bodyWidth * 0.8, 2.2);
    const plateH = 0.45;
    const plateGeo = new THREE.PlaneGeometry(plateW, plateH);
    plateGeo.rotateY(Math.PI); // facing back

    this.serialPlateCanvas = createSerialPlateTexture(null, isBlind);
    this.serialPlateTexture = new THREE.CanvasTexture(this.serialPlateCanvas);
    const plateMat = new THREE.MeshBasicMaterial({
      map: this.serialPlateTexture,
      transparent: true
    });
    this.serialPlateMesh = new THREE.Mesh(plateGeo, plateMat);
    this.serialPlateMesh.position.set(0, 0, -bodyDepth / 2 - 0.005);
    this.bombGroup.add(this.serialPlateMesh);

    // Mount Module Slots onto Front Face
    this.moduleViews.clear();
    clientModules.forEach((mod, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);

      const startX = -((cols - 1) * (slotW + spacing)) / 2;
      const startY = ((rows - 1) * (slotH + spacing)) / 2;

      const posX = startX + col * (slotW + spacing);
      const posY = startY - row * (slotH + spacing);

      const slot = {
        width: slotW,
        height: slotH,
        depth: 0.1,
        position: { x: posX, y: posY, z: bodyDepth / 2 }
      };

      const moduleGroup = mod.build(THREE, slot, this.role);
      moduleGroup.position.set(posX, posY, bodyDepth / 2);
      moduleGroup.userData.moduleId = mod.id;

      this.bombGroup.add(moduleGroup);
      this.moduleViews.set(mod.id, {
        moduleDef: mod,
        group: moduleGroup
      });
    });

    this.scene.add(this.bombGroup);
  }

  setupTouchControls() {
    const dom = this.renderer.domElement;

    this.boundPointerDown = (e) => {
      e.preventDefault();
      try {
        dom.setPointerCapture(e.pointerId);
      } catch (err) {}

      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 1) {
        this.isDragging = true;
        this.hasMovedSignificantly = false;
        this.dragStartPos = { x: e.clientX, y: e.clientY };
        this.lastPointerPos = { x: e.clientX, y: e.clientY };
        this.candidateModule = null;

        // Interactive raycast check for Blind role
        if (this.role === 'blind') {
          const hit = this.raycast(e.clientX, e.clientY);
          if (hit) {
            const modInfo = this.findHitModule(hit.object);
            if (modInfo) {
              this.candidateModule = modInfo;
              this.candidateHit = hit;
              const lastDigit = Math.floor(Math.max(0, this.getTimerRemaining())) % 10;
              // Notify module of pointerdown (e.g. for button visual depression)
              modInfo.moduleDef.onPointer(
                hit,
                { type: 'pointerdown', lastTimerDigit: lastDigit },
                this.send,
                modInfo.group,
                this.role,
                this.currentState?.modules?.[modInfo.moduleDef.id]
              );
            }
          }
        }
      } else if (this.pointers.size === 2) {
        // Multi-touch pinch zoom start: cancel any pending single-finger module candidate
        this.cancelCandidateModule();
        const pts = Array.from(this.pointers.values());
        this.pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
    };

    this.boundPointerMove = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.pointers.size === 1 && this.isDragging) {
        const dx = e.clientX - this.lastPointerPos.x;
        const dy = e.clientY - this.lastPointerPos.y;
        this.lastPointerPos = { x: e.clientX, y: e.clientY };

        const moveDist = Math.hypot(e.clientX - this.dragStartPos.x, e.clientY - this.dragStartPos.y);
        if (moveDist > 10) {
          this.hasMovedSignificantly = true;
          // Crucial fix: user is rotating camera, cancel any accidental module tap/press!
          this.cancelCandidateModule();
        }

        // Smooth drag-rotate
        this.targetRotY += dx * 0.008;
        this.targetRotX = Math.max(-1.4, Math.min(1.4, this.targetRotX + dy * 0.008));
      } else if (this.pointers.size === 2) {
        // Pinch zoom
        const pts = Array.from(this.pointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this.pinchStartDist > 0) {
          const scaleDelta = (this.pinchStartDist - dist) * 0.008;
          this.targetCameraDist = Math.max(2.2, Math.min(6.5, this.targetCameraDist + scaleDelta));
          this.pinchStartDist = dist;
        }
      }
    };

    const handlePointerEnd = (e, isCancel = false) => {
      if (this.pointers.has(e.pointerId)) {
        this.pointers.delete(e.pointerId);
      }

      if (this.pointers.size === 0) {
        this.isDragging = false;

        if (isCancel) {
          this.cancelCandidateModule();
        } else if (this.role === 'blind' && this.candidateModule) {
          // If the pointer didn't move significantly, it is a deliberate tap / release!
          if (!this.hasMovedSignificantly) {
            const hit = this.raycast(e.clientX, e.clientY);
            const lastDigit = Math.floor(Math.max(0, this.getTimerRemaining())) % 10;
            this.candidateModule.moduleDef.onPointer(
              hit || this.candidateHit || { object: null },
              { type: 'pointerup', lastTimerDigit: lastDigit },
              this.send,
              this.candidateModule.group,
              this.role,
              this.currentState?.modules?.[this.candidateModule.moduleDef.id]
            );
          } else {
            this.cancelCandidateModule();
          }
          this.candidateModule = null;
        }
      }
    };

    this.boundPointerUp = (e) => handlePointerEnd(e, false);
    this.boundPointerCancel = (e) => handlePointerEnd(e, true);

    this.boundLostCapture = (e) => {
      handlePointerEnd(e, true);
    };

    this.boundWindowBlur = () => {
      this.cancelCandidateModule();
      this.pointers.clear();
      this.isDragging = false;
    };

    this.boundWheel = (e) => {
      e.preventDefault();
      this.targetCameraDist = Math.max(2.2, Math.min(6.5, this.targetCameraDist + e.deltaY * 0.003));
    };

    dom.addEventListener('pointerdown', this.boundPointerDown);
    dom.addEventListener('pointermove', this.boundPointerMove);
    dom.addEventListener('pointerup', this.boundPointerUp);
    dom.addEventListener('pointercancel', this.boundPointerCancel);
    dom.addEventListener('lostpointercapture', this.boundLostCapture);
    dom.addEventListener('wheel', this.boundWheel, { passive: false });
    window.addEventListener('blur', this.boundWindowBlur);
  }

  cancelCandidateModule() {
    if (this.candidateModule) {
      try {
        this.candidateModule.moduleDef.onPointer(
          { object: null },
          { type: 'pointercancel' },
          this.send,
          this.candidateModule.group,
          this.role,
          this.currentState?.modules?.[this.candidateModule.moduleDef.id]
        );
      } catch (err) {}
      this.candidateModule = null;
    }
  }

  /**
   * Fast Programmatic Camera Views
   */
  viewFront() {
    this.targetRotX = 0;
    this.targetRotY = 0;
  }

  viewBack() {
    this.targetRotX = 0;
    this.targetRotY = Math.PI; // Flip 180 degrees to back plate
  }

  resetView() {
    this.targetRotX = 0;
    this.targetRotY = 0;
    const w = this.container ? this.container.clientWidth : 360;
    const h = this.container ? this.container.clientHeight : 420;
    this.targetCameraDist = this.calcOptimalCameraDist(w, h);
  }

  raycast(clientX, clientY) {
    if (!this.renderer || !this.camera || !this.bombGroup) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    this.mouseVec.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseVec.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouseVec, this.camera);
    const intersects = this.raycaster.intersectObjects(this.bombGroup.children, true);
    return intersects.length > 0 ? intersects[0] : null;
  }

  findHitModule(obj) {
    let curr = obj;
    while (curr && curr !== this.bombGroup) {
      if (curr.userData?.moduleId) {
        return this.moduleViews.get(curr.userData.moduleId);
      }
      curr = curr.parent;
    }
    return null;
  }

  setRole(newRole) {
    if (this.role !== newRole) {
      this.role = newRole;
      this.buildBombModel();
      if (this.currentState) {
        this.updateState(this.currentState);
      }
    }
  }

  updateState(state) {
    this.currentState = state;
    if (!state) return;

    const isBlind = this.role === 'blind';

    // Update Serial Number Plate
    if (this.serialPlateCanvas && this.serialPlateTexture) {
      const plateText = (this.role === 'deaf' && state.serialNumber) ? state.serialNumber : null;
      const ctx = this.serialPlateCanvas.getContext('2d');
      ctx.clearRect(0, 0, 512, 128);

      ctx.fillStyle = isBlind ? '#27272a' : '#1e293b';
      ctx.fillRect(0, 0, 512, 128);

      ctx.strokeStyle = isBlind ? '#52525b' : '#f59e0b';
      ctx.lineWidth = 6;
      ctx.strokeRect(6, 6, 500, 116);

      if (plateText) {
        ctx.fillStyle = '#f59e0b';
        ctx.font = 'bold 22px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('ORDNANCE DISPOSAL UNIT // DEFENSE TECH', 24, 38);

        ctx.fillStyle = '#ffffff';
        ctx.font = '900 42px monospace';
        ctx.fillText(`SERIAL: ${plateText}`, 24, 88);

        ctx.fillStyle = '#94a3b8';
        for (let x = 400; x < 480; x += 8) {
          ctx.fillRect(x, 24, (x % 3 === 0 ? 5 : 2), 70);
        }
      } else {
        ctx.fillStyle = '#71717a';
        ctx.font = 'bold 24px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('[CLASSIFIED // SERIAL SCRATCHED]', 256, 70);
      }
      this.serialPlateTexture.needsUpdate = true;
    }

    // Update individual active modules
    if (state.modules) {
      for (const [modId, modInfo] of this.moduleViews.entries()) {
        const modState = state.modules[modId];
        if (modState) {
          modInfo.moduleDef.update(modInfo.group, this.role, modState);
        }
      }
    }
  }

  animate() {
    this.animFrameId = requestAnimationFrame(this.animate);

    // Smooth exponential damping on rotation & zoom
    this.currentRotX += (this.targetRotX - this.currentRotX) * 0.14;
    this.currentRotY += (this.targetRotY - this.currentRotY) * 0.14;
    this.cameraDist += (this.targetCameraDist - this.cameraDist) * 0.14;

    if (this.bombGroup) {
      this.bombGroup.rotation.x = this.currentRotX;
      this.bombGroup.rotation.y = this.currentRotY;
    }

    if (this.camera) {
      this.camera.position.z = this.cameraDist;
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.renderer) {
      const dom = this.renderer.domElement;
      if (dom) {
        if (this.boundPointerDown) dom.removeEventListener('pointerdown', this.boundPointerDown);
        if (this.boundPointerMove) dom.removeEventListener('pointermove', this.boundPointerMove);
        if (this.boundPointerUp) dom.removeEventListener('pointerup', this.boundPointerUp);
        if (this.boundPointerCancel) dom.removeEventListener('pointercancel', this.boundPointerCancel);
        if (this.boundLostCapture) dom.removeEventListener('lostpointercapture', this.boundLostCapture);
        if (this.boundWheel) dom.removeEventListener('wheel', this.boundWheel);
      }
      window.removeEventListener('blur', this.boundWindowBlur);

      // Deep dispose scene objects
      if (this.scene) {
        this.scene.traverse((obj) => {
          if (obj.geometry) {
            try { obj.geometry.dispose(); } catch (e) {}
          }
          if (obj.material) {
            if (Array.isArray(obj.material)) {
              obj.material.forEach((m) => {
                try { if (m.map) m.map.dispose(); m.dispose(); } catch (e) {}
              });
            } else {
              try { if (obj.material.map) obj.material.map.dispose(); obj.material.dispose(); } catch (e) {}
            }
          }
        });
      }

      this.renderer.dispose();
      if (dom && dom.parentNode) {
        dom.parentNode.removeChild(dom);
      }
    }

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.bombGroup = null;
    this.moduleViews.clear();
  }
}
