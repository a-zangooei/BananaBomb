import * as THREE from 'three';
import { clientModules } from './modules/index.js';
import { createCanvas2D, prefersReducedMotion } from './modules/canvas-utils.js';
import { BombInteractionController, INTERACTION_DEFAULTS } from './interaction-controller.js';

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

function isOperatorRole(role) {
  return role === 'blind' || role === 'operator';
}

function isObserverRole(role) {
  return role === 'deaf' || role === 'observer';
}

/**
 * Procedural Serial Number Plate Texture
 */
function createSerialPlateTexture(serialNumber, isMonochrome) {
  const canvas = createCanvas2D(512, 128);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = isMonochrome ? '#27272a' : '#1e293b';
  ctx.fillRect(0, 0, 512, 128);

  ctx.strokeStyle = isMonochrome ? '#52525b' : '#f59e0b';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 116);

  if (!isMonochrome && serialNumber) {
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('BANANABOMB REAR SERIAL PLATE', 24, 38);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 44px monospace';
    ctx.fillText(`SERIAL: ${serialNumber}`, 24, 88);

    ctx.fillStyle = '#94a3b8';
    for (let x = 400; x < 480; x += 8) {
      ctx.fillRect(x, 24, (x % 3 === 0 ? 5 : 2), 70);
    }
  } else {
    ctx.fillStyle = '#71717a';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('[OBSERVER VISUAL ACCESS ONLY]', 256, 70);
  }

  return canvas;
}

/**
 * Standalone Responsive 3D Bomb Scene Manager
 */
export class Bomb3DScene {
  constructor(containerEl, role, onActionSend, getTimerRemaining, options = {}) {
    this.container = containerEl;
    this.role = role;
    this.send = onActionSend;
    this.getTimerRemaining = getTimerRemaining || (() => 300);
    this.onInteractionStatus = options.onInteractionStatus || (() => {});

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.bombGroup = null;
    this.moduleViews = new Map();
    this.animFrameId = null;
    this.resizeObserver = null;

    // Camera Framing & Distance Adaptation
    this.baseCameraDist = 3.55;
    this.cameraDist = 3.55;
    this.targetCameraDist = 3.55;

    // Rotation state
    this.targetRotX = 0;
    this.targetRotY = 0;
    this.currentRotX = 0;
    this.currentRotY = 0;
    this.sensitivity = 1.0;

    this.raycaster = new THREE.Raycaster();
    this.mouseVec = new THREE.Vector2();

    this.serialPlateMesh = null;
    this.serialPlateCanvas = null;
    this.serialPlateTexture = null;
    this.currentState = null;

    // Production Interaction State Machine
    this.interaction = new BombInteractionController({
      getRole: () => this.role,
      getState: () => this.currentState,
      getTimerRemaining: () => this.getTimerRemaining(),
      raycastAt: (cx, cy) => this.raycast(cx, cy),
      resolveHitModule: (obj) => this.findHitModule(obj),
      holdThresholdMs: options.holdThresholdMs ?? INTERACTION_DEFAULTS.buttonHoldThresholdMs,
      onSendAction: (actionPayload) => {
        if (this.send) {
          this.send('action', actionPayload);
        }
      },
      onCameraRotate: (dx, dy) => {
        const sens = this.sensitivity || 1.0;
        this.targetRotY += dx * 0.008 * sens;
        this.targetRotX = Math.max(-1.4, Math.min(1.4, this.targetRotX + dy * 0.008 * sens));
      },
      onCameraZoom: (delta) => {
        this.targetCameraDist = Math.max(2.2, Math.min(6.5, this.targetCameraDist + delta * 0.008));
      },
      onStatusChange: (status) => {
        this.onInteractionStatus(status);
      },
      onFeedback: (feedbackType, descriptor) => {
        this.handleTactileAndAudioFeedback(feedbackType, descriptor);
      }
    });

    // Bound event handlers for clean disposal
    this.boundPointerDown = null;
    this.boundPointerMove = null;
    this.boundPointerUp = null;
    this.boundPointerCancel = null;
    this.boundWheel = null;
    this.boundLostCapture = null;
    this.boundWindowBlur = null;
    this.boundVisibilityChange = null;
    this.boundOrientationChange = null;
    this.boundContextMenu = null;

    this.init();
  }

  init() {
    const width = Math.max(100, this.container.clientWidth || 360);
    const height = Math.max(100, this.container.clientHeight || 420);
    const aspect = width / height;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070b12);

    // 2. Camera with Adaptive Framing across Portrait & Landscape
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.96);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff5eb, 1.4);
    dirLight.position.set(3, 5, 4);
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.65);
    fillLight.position.set(-3, -3, 2);
    this.scene.add(fillLight);

    // 5. Build Bomb Model
    this.buildBombModel();

    // 6. Bind Native Pointer / Touch / Lifecycle Events
    this.setupTouchControls();

    // 7. Setup Container-Driven ResizeObserver
    this.setupResizeObserver();

    // 8. Start Render Loop
    this.animate = this.animate.bind(this);
    this.animate();
  }

  /**
   * Calculates ideal camera distance based on viewport width & height so all
   * active controls fit cleanly in both narrow portrait and short landscape screens
   * without forcing the Operator to manually zoom just to reach a module.
   */
  calcOptimalCameraDist(width, height) {
    const w = Math.max(120, width || 360);
    const h = Math.max(120, height || 420);
    const aspect = w / h;

    // Bomb physical bounding box ~2.55w x 2.75h
    const vFovRad = THREE.MathUtils.degToRad(45);
    const tanHalfVFov = Math.tan(vHalf(vFovRad));
    const tanHalfHFov = tanHalfVFov * aspect;

    const halfBombW = 1.42;
    const halfBombH = 1.54;

    const distForHeight = halfBombH / tanHalfVFov;
    const distForWidth = halfBombW / Math.max(0.28, tanHalfHFov);

    return Math.max(this.baseCameraDist, distForHeight, distForWidth);
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

    const idealDist = this.calcOptimalCameraDist(w, h);
    if (Math.abs(this.targetCameraDist - this.cameraDist) < 0.45) {
      this.targetCameraDist = idealDist;
      if (prefersReducedMotion()) {
        this.cameraDist = idealDist;
      }
    }
  }

  resize() {
    this.handleResize();
  }

  clearBeaconIntervals() {
    for (const modInfo of this.moduleViews.values()) {
      if (modInfo.group?.userData?.soundLoopInterval) {
        clearInterval(modInfo.group.userData.soundLoopInterval);
        modInfo.group.userData.soundLoopInterval = null;
      }
    }
  }

  buildBombModel() {
    this.clearBeaconIntervals();
    if (this.bombGroup) {
      this.scene.remove(this.bombGroup);
    }

    this.bombGroup = new THREE.Group();
    const isBlind = isOperatorRole(this.role);
    const numModules = clientModules.length;

    const cols = numModules <= 3 ? numModules : (numModules <= 4 ? 2 : 3);
    const rows = Math.ceil(numModules / cols);

    const slotW = 1.08;
    const slotH = 1.08;
    const spacing = 0.13;

    const bodyWidth = cols * slotW + (cols + 1) * spacing;
    const bodyHeight = rows * slotH + (rows + 1) * spacing + 0.18;
    const bodyDepth = 0.5;

    const bodyGeo = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyDepth);
    const bodyMat = new THREE.MeshLambertMaterial({
      color: isBlind ? 0x27272a : 0x0f172a
    });
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    this.bombGroup.add(bodyMesh);

    const rimGeo = new THREE.BoxGeometry(bodyWidth + 0.08, bodyHeight + 0.08, 0.1);
    const rimMat = new THREE.MeshLambertMaterial({
      color: isBlind ? 0x3f3f46 : 0x1e293b
    });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.z = bodyDepth / 2 - 0.05;
    this.bombGroup.add(rimMesh);

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

    const plateW = Math.min(bodyWidth * 0.8, 2.2);
    const plateH = 0.45;
    const plateGeo = new THREE.PlaneGeometry(plateW, plateH);
    plateGeo.rotateY(Math.PI);

    this.serialPlateCanvas = createSerialPlateTexture(null, isBlind);
    this.serialPlateTexture = new THREE.CanvasTexture(this.serialPlateCanvas);
    const plateMat = new THREE.MeshBasicMaterial({
      map: this.serialPlateTexture,
      transparent: true
    });
    this.serialPlateMesh = new THREE.Mesh(plateGeo, plateMat);
    this.serialPlateMesh.position.set(0, 0, -bodyDepth / 2 - 0.005);
    this.bombGroup.add(this.serialPlateMesh);

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
      // Only ignore non-primary mouse clicks (e.g. right-click)
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.cancelable) e.preventDefault();
      try {
        dom.setPointerCapture(e.pointerId);
      } catch (err) {}

      this.interaction.onPointerDown(e);
    };

    this.boundPointerMove = (e) => {
      if (e.cancelable) e.preventDefault();
      this.interaction.onPointerMove(e);
    };

    this.boundPointerUp = (e) => {
      if (e.cancelable) e.preventDefault();
      this.interaction.onPointerUp(e);
      try {
        if (dom.hasPointerCapture?.(e.pointerId)) {
          dom.releasePointerCapture(e.pointerId);
        }
      } catch (err) {}
    };

    this.boundPointerCancel = (e) => {
      this.interaction.onPointerCancel(e);
    };

    this.boundLostCapture = (e) => {
      this.interaction.onLostPointerCapture(e);
    };

    this.boundWindowBlur = () => {
      this.interaction.onBlur();
    };

    this.boundVisibilityChange = () => {
      this.interaction.onVisibilityChange(Boolean(document.hidden));
    };

    this.boundOrientationChange = () => {
      this.interaction.onOrientationChange();
      setTimeout(() => {
        if (this.container) {
          const w = this.container.clientWidth;
          const h = this.container.clientHeight;
          if (w > 0 && h > 0) {
            this.targetCameraDist = this.calcOptimalCameraDist(w, h);
            this.handleResize(w, h);
          }
        }
      }, 80);
    };

    this.boundWheel = (e) => {
      e.preventDefault();
      this.targetCameraDist = Math.max(2.2, Math.min(6.5, this.targetCameraDist + e.deltaY * 0.003));
    };

    this.boundContextMenu = (e) => {
      // Prevent Android long-press context menu from interrupting 400ms wire cut or button hold!
      e.preventDefault();
    };

    dom.addEventListener('pointerdown', this.boundPointerDown);
    dom.addEventListener('pointermove', this.boundPointerMove);
    dom.addEventListener('pointerup', this.boundPointerUp);
    dom.addEventListener('pointercancel', this.boundPointerCancel);
    dom.addEventListener('lostpointercapture', this.boundLostCapture);
    dom.addEventListener('wheel', this.boundWheel, { passive: false });
    dom.addEventListener('contextmenu', this.boundContextMenu);

    window.addEventListener('blur', this.boundWindowBlur);
    window.addEventListener('orientationchange', this.boundOrientationChange);
    document.addEventListener('visibilitychange', this.boundVisibilityChange);
  }

  handleTactileAndAudioFeedback(type, descriptor) {
    if (type === 'press_start') {
      this.triggerTactileFeedback('tap');
      if (typeof window !== 'undefined' && window.soundEngine?.playTactileTick) {
        window.soundEngine.playTactileTick();
      }
      return;
    }

    if (type === 'hold_start') {
      this.triggerTactileFeedback('hold');
      if (typeof window !== 'undefined' && window.soundEngine?.playTactileTick) {
        window.soundEngine.playTactileTick();
      }
      return;
    }

    if (type === 'commit' || type === 'tap_commit' || type === 'hold_release') {
      if (descriptor?.moduleId === 'wires') {
        this.triggerTactileFeedback('cut');
        if (typeof window !== 'undefined' && window.soundEngine?.playWireCut) {
          window.soundEngine.playWireCut();
        } else if (typeof window !== 'undefined' && window.soundEngine?.playClick) {
          window.soundEngine.playClick();
        }
      } else {
        this.triggerTactileFeedback(type === 'hold_release' ? 'hold' : 'key');
        if (typeof window !== 'undefined' && window.soundEngine?.playClick) {
          window.soundEngine.playClick();
        }
      }
    }
  }

  setHoldThreshold(ms) {
    return this.interaction.setHoldThreshold(ms);
  }

  getHoldThreshold() {
    return this.interaction.getHoldThreshold();
  }

  cancelActiveInteraction(reason = 'manual_cancel') {
    return this.interaction.cancelActiveGesture(reason);
  }

  /**
   * Fast Programmatic Camera Views
   */
  viewFront() {
    this.targetRotX = 0;
    this.targetRotY = 0;
    if (prefersReducedMotion()) {
      this.currentRotX = 0;
      this.currentRotY = 0;
    }
  }

  viewBack() {
    this.targetRotX = 0;
    this.targetRotY = Math.PI;
    if (prefersReducedMotion()) {
      this.currentRotX = 0;
      this.currentRotY = Math.PI;
    }
  }

  resetView() {
    this.targetRotX = 0;
    this.targetRotY = 0;
    const w = this.container ? this.container.clientWidth : 360;
    const h = this.container ? this.container.clientHeight : 420;
    this.targetCameraDist = this.calcOptimalCameraDist(w, h);
    if (prefersReducedMotion()) {
      this.currentRotX = 0;
      this.currentRotY = 0;
      this.cameraDist = this.targetCameraDist;
    }
  }

  setSensitivity(val) {
    const num = parseFloat(val);
    if (!isNaN(num) && num >= 0.1 && num <= 3.0) {
      this.sensitivity = num;
    }
  }

  triggerTactileFeedback(type = 'tap') {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      try {
        if (type === 'hold') {
          navigator.vibrate([40, 30, 40]);
        } else if (type === 'cut') {
          navigator.vibrate([45, 25]);
        } else if (type === 'key') {
          navigator.vibrate(25);
        } else {
          navigator.vibrate(20);
        }
      } catch (e) {}
    }
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
      this.interaction.cancelActiveGesture('role_change');
      this.role = newRole;
      this.buildBombModel();
      if (this.currentState) {
        this.updateState(this.currentState);
      }
    }
  }

  updateState(state) {
    const prevStatus = this.currentState?.status;
    this.currentState = state;
    if (!state) return;

    if (prevStatus === 'running' && state.status !== 'running') {
      this.interaction.cancelActiveGesture('round_ended');
    }

    const isBlind = isOperatorRole(this.role);

    if (this.serialPlateCanvas && this.serialPlateTexture) {
      const plateText = (isObserverRole(this.role) && state.serialNumber) ? state.serialNumber : null;
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
        ctx.fillText('BANANABOMB REAR SERIAL PLATE', 24, 38);

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
        ctx.fillText('[OBSERVER VISUAL ACCESS ONLY]', 256, 70);
      }
      this.serialPlateTexture.needsUpdate = true;
    }

    if (state.modules) {
      for (const [modId, modInfo] of this.moduleViews.entries()) {
        const modState = state.modules[modId];
        if (modState) {
          modInfo.group.visible = true;
          modInfo.moduleDef.update(modInfo.group, this.role, modState);
        } else {
          modInfo.group.visible = false;
        }
      }
    }
  }

  animate() {
    this.animFrameId = requestAnimationFrame(this.animate);

    // Advance active touch/hold progress indicators every frame
    this.interaction.tick();

    const damping = prefersReducedMotion() ? 1.0 : 0.16;
    this.currentRotX += (this.targetRotX - this.currentRotX) * damping;
    this.currentRotY += (this.targetRotY - this.currentRotY) * damping;
    this.cameraDist += (this.targetCameraDist - this.cameraDist) * damping;

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
    this.interaction.cancelActiveGesture('dispose');
    this.clearBeaconIntervals();

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
        if (this.boundContextMenu) dom.removeEventListener('contextmenu', this.boundContextMenu);
      }
      window.removeEventListener('blur', this.boundWindowBlur);
      window.removeEventListener('orientationchange', this.boundOrientationChange);
      document.removeEventListener('visibilitychange', this.boundVisibilityChange);

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

function vHalf(fovRad) {
  return fovRad * 0.5;
}
