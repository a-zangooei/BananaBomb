/**
 * Live Responsive WebGL 3D Van & Briefcase Bomb Scene Manager.
 *
 * Delegates headless scene-graph construction and mathematical sightline evaluation to
 * `world-graph.js`, focusing exclusively on WebGLRenderer lifecycle, pointer/touch/context-loss
 * event binding, rolling frame-budget monitoring, and tactile/audio feedback.
 */
import * as THREE from 'three';
import { prefersReducedMotion } from './modules/canvas-utils.js';
import { BombInteractionController, INTERACTION_DEFAULTS } from './interaction-controller.js';
import { normalizeWorldRole } from './camera-rig.js';
import {
  BRIEFCASE_SPEC,
  buildSharedWorldGraph,
  computeOpticalMorseLampState,
  computeStrikeDisplayModel,
  drawLidTimerCanvas,
  isManualRole,
  isObserverRole,
  isOperatorRole,
  isWebGLAvailable
} from './world-graph.js';

export {
  BRIEFCASE_SPEC,
  buildSharedWorldGraph,
  computeOpticalMorseLampState,
  computeStrikeDisplayModel,
  drawLidTimerCanvas,
  isManualRole,
  isObserverRole,
  isOperatorRole,
  isWebGLAvailable
};

/**
 * Live Responsive WebGL 3D Van & Briefcase Bomb Scene Manager.
 */
export class Bomb3DScene {
  constructor(containerEl, role, onActionSend, getTimerRemaining, options = {}) {
    this.container = containerEl;
    this.role = role;
    this.send = onActionSend;
    this.getTimerRemaining = getTimerRemaining || (() => 300);
    this.onInteractionStatus = options.onInteractionStatus || (() => {});
    this.soundEngine =
      options.soundEngine ?? (typeof window !== 'undefined' ? window.soundEngine : null);

    this.world = null;
    this.scene = null;
    this.camera = null;
    this.cameraRig = null;
    this.styleManager = null;
    this.briefcaseRig = null;
    this.vanEnv = null;
    this.avatars = null;
    this.moduleViews = new Map();

    this.renderer = null;
    this.animFrameId = null;
    this.animTimeoutId = null;
    this.resizeObserver = null;
    this.contextLost = false;
    this.isSoftwareGl = false;
    this.lowSpecMode = Boolean(options.lowSpecMode);
    this.sensitivity = 1.0;
    this.currentState = null;

    // Rolling 30-frame timing monitor for automatic low-spec fallback
    this._lastFrameTime = 0;
    this._frameDeltas = [];
    this._avgFrameMs = 16.6;
    this._keyboardReticleActive = false;
    this._penaltyFlashSeconds = 0;
    this._penaltyFlashUntilMs = 0;

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
        if (!this.cameraRig) return;
        const sens = this.sensitivity || 1.0;
        this.cameraRig.rotateHeadByRadians(dx * 0.0042 * sens, dy * 0.0042 * sens, {
          immediate: prefersReducedMotion()
        });
      },
      onCameraZoom: (delta) => {
        if (!this.cameraRig) return;
        this.cameraRig.zoomByFovDelta(delta * 0.085, {
          immediate: prefersReducedMotion()
        });
      },
      onStatusChange: (status) => {
        this.syncReticleWithInteraction();
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
    this.boundWebglContextLost = null;
    this.boundWebglContextRestored = null;

    this.init();
  }

  get targetRotY() {
    return this.cameraRig ? this.cameraRig.targetYawOffset : 0;
  }

  set targetRotY(val) {
    if (!this.cameraRig) return;
    this.cameraRig.targetYawOffset = Number(val) || 0;
    this.cameraRig.clampOffsets();
    if (prefersReducedMotion()) this.cameraRig.snapToTargets();
  }

  get targetRotX() {
    return this.cameraRig ? this.cameraRig.targetPitchOffset : 0;
  }

  set targetRotX(val) {
    if (!this.cameraRig) return;
    this.cameraRig.targetPitchOffset = Number(val) || 0;
    this.cameraRig.clampOffsets();
    if (prefersReducedMotion()) this.cameraRig.snapToTargets();
  }

  detectSoftwareRenderer(renderer) {
    try {
      const gl = renderer.getContext();
      if (!gl) return false;
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const rendererStr = String(
        dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      ).toLowerCase();
      return (
        rendererStr.includes('swiftshader') ||
        rendererStr.includes('llvmpipe') ||
        rendererStr.includes('software') ||
        rendererStr.includes('basic render driver')
      );
    } catch (e) {
      return false;
    }
  }

  computeTargetPixelRatio() {
    if (this.isSoftwareGl || this.lowSpecMode) return 1.0;
    const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
    return Math.min(dpr, 1.75);
  }

  init() {
    const width = Math.max(120, this.container.clientWidth || 360);
    const height = Math.max(120, this.container.clientHeight || 420);

    // 1. Build Shared 3D Van World Graph
    this.world = buildSharedWorldGraph({
      role: this.role,
      width,
      height,
      lowSpecMode: this.lowSpecMode
    });

    this.scene = this.world.scene;
    this.camera = this.world.camera;
    this.cameraRig = this.world.cameraRig;
    this.styleManager = this.world.styleManager;
    this.briefcaseRig = this.world.briefcaseRig;
    this.vanEnv = this.world.vanEnv;
    this.avatars = this.world.avatars;
    this.moduleViews = this.world.moduleViews;
    this.bombGroup = this.briefcaseRig.moduleBayRoot;

    // 2. Initialize WebGLRenderer with Mobile & Software-GL Protections
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.lowSpecMode,
      powerPreference: 'high-performance'
    });
    this.isSoftwareGl = this.detectSoftwareRenderer(this.renderer);
    if (this.isSoftwareGl) {
      this.lowSpecMode = true;
      this.world.setLowSpecMode(true);
    }

    this.renderer.setPixelRatio(this.computeTargetPixelRatio());
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;

    const maxAniso = this.renderer.capabilities?.getMaxAnisotropy?.() || 1;
    if (this.briefcaseRig) {
      for (const tex of [
        this.briefcaseRig.lidTimerTexture,
        this.briefcaseRig.serialTexture,
        this.briefcaseRig.morseLampTexture
      ]) {
        if (tex) tex.anisotropy = maxAniso;
      }
    }

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    // 3. Bind Pointer / Touch / Context-Loss Lifecycle Events
    this.setupTouchControls();

    // 4. Container ResizeObserver
    this.setupResizeObserver();

    // 5. Start Render Loop (scheduled afterDraw)
    this.animate = this.animate.bind(this);
    this._lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.animate();
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
    if (!this.container || !this.renderer || !this.cameraRig) return;
    const w = width || this.container.clientWidth;
    const h = height || this.container.clientHeight;
    if (w <= 0 || h <= 0) return;

    this.cameraRig.handleViewportResize(w, h, { immediate: prefersReducedMotion() });
    this.renderer.setPixelRatio(this.computeTargetPixelRatio());
    this.renderer.setSize(w, h);
  }

  resize() {
    this.handleResize();
  }

  setupTouchControls() {
    const dom = this.renderer.domElement;

    this.boundPointerDown = (e) => {
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
            this.handleResize(w, h);
          }
        }
      }, 80);
    };

    this.boundWheel = (e) => {
      e.preventDefault();
      if (this.cameraRig) {
        this.cameraRig.zoomByFovDelta(e.deltaY * 0.025, {
          immediate: prefersReducedMotion()
        });
      }
    };

    this.boundContextMenu = (e) => {
      e.preventDefault();
    };

    this.boundWebglContextLost = (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.interaction.cancelActiveGesture('webgl_context_lost');
      if (this.animFrameId) {
        cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }
      if (this.animTimeoutId) {
        clearTimeout(this.animTimeoutId);
        this.animTimeoutId = null;
      }
    };

    this.boundWebglContextRestored = () => {
      this.contextLost = false;
      if (this.world) {
        this.world.setRole(this.role, { immediate: true });
        if (this.currentState) {
          this.world.updateState(this.currentState);
        }
      }
      if (!this.animFrameId) {
        this._lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
        this.animate();
      }
    };

    dom.addEventListener('pointerdown', this.boundPointerDown);
    dom.addEventListener('pointermove', this.boundPointerMove);
    dom.addEventListener('pointerup', this.boundPointerUp);
    dom.addEventListener('pointercancel', this.boundPointerCancel);
    dom.addEventListener('lostpointercapture', this.boundLostCapture);
    dom.addEventListener('wheel', this.boundWheel, { passive: false });
    dom.addEventListener('contextmenu', this.boundContextMenu);
    dom.addEventListener('webglcontextlost', this.boundWebglContextLost, false);
    dom.addEventListener('webglcontextrestored', this.boundWebglContextRestored, false);

    window.addEventListener('blur', this.boundWindowBlur);
    window.addEventListener('orientationchange', this.boundOrientationChange);
    document.addEventListener('visibilitychange', this.boundVisibilityChange);
  }

  syncReticleWithInteraction() {
    if (!this.world) return;
    const g = this.interaction.activeGesture;
    if (g && g.kind === 'control' && g.descriptor && isOperatorRole(this.role)) {
      this._keyboardReticleActive = false;
      this.world.showReticleForDescriptor(g.descriptor, Boolean(g.holdTriggered));
    } else if (!this._keyboardReticleActive) {
      this.world.hideReticle();
    }
  }

  /**
   * Allows keyboard Space accessibility hold to display the exact Operator red target reticle.
   */
  setKeyboardButtonReticle(active, isHoldLocked = false) {
    if (!this.world) return;
    if (active && isOperatorRole(this.role)) {
      this._keyboardReticleActive = true;
      this.world.showReticleForDescriptor(
        { moduleId: 'button', controlId: 'plunger' },
        isHoldLocked
      );
    } else {
      this._keyboardReticleActive = false;
      this.syncReticleWithInteraction();
    }
  }

  getActiveSoundEngine() {
    return this.soundEngine || (typeof window !== 'undefined' ? window.soundEngine : null);
  }

  handleTactileAndAudioFeedback(type, descriptor) {
    const sfx = this.getActiveSoundEngine();
    if (type === 'press_start') {
      this.triggerTactileFeedback('tap');
      if (sfx?.playTactileTick) {
        sfx.playTactileTick();
      }
      return;
    }

    if (type === 'hold_start') {
      this.triggerTactileFeedback('hold');
      if (sfx?.playTactileTick) {
        sfx.playTactileTick();
      }
      return;
    }

    if (type === 'commit' || type === 'tap_commit' || type === 'hold_release') {
      if (descriptor?.moduleId === 'wires') {
        this.triggerTactileFeedback('cut');
        if (sfx?.playWireCut) {
          sfx.playWireCut();
        } else if (sfx?.playClick) {
          sfx.playClick();
        }
      } else {
        this.triggerTactileFeedback(type === 'hold_release' ? 'hold' : 'key');
        if (sfx?.playClick) {
          sfx.playClick();
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
    this._keyboardReticleActive = false;
    return this.interaction.cancelActiveGesture(reason);
  }

  /**
   * Role-Specific Seated Camera Quick Focus Presets
   */
  setCameraPreset(presetName) {
    if (!this.cameraRig) return;
    this.cameraRig.setPreset(presetName, { immediate: prefersReducedMotion() });
  }

  viewFront() {
    this.setCameraPreset('primary');
  }

  viewBack() {
    this.setCameraPreset('secondary');
  }

  viewTertiary() {
    this.setCameraPreset('tertiary');
  }

  resetView() {
    if (!this.cameraRig) return;
    this.cameraRig.resetView({ immediate: prefersReducedMotion() });
  }

  setSensitivity(val) {
    const num = parseFloat(val);
    if (!isNaN(num) && num >= 0.1 && num <= 3.0) {
      this.sensitivity = num;
    }
  }

  setLowSpecMode(enabled) {
    this.lowSpecMode = Boolean(enabled);
    if (this.world) {
      this.world.setLowSpecMode(this.lowSpecMode);
    }
    if (this.renderer) {
      this.renderer.setPixelRatio(this.computeTargetPixelRatio());
    }
  }

  getPerformanceMetrics() {
    const renderInfo = this.renderer?.info?.render || {};
    const memoryInfo = this.renderer?.info?.memory || {};
    return {
      role: normalizeWorldRole(this.role),
      drawCalls: renderInfo.calls ?? 0,
      triangles: renderInfo.triangles ?? 0,
      lines: renderInfo.lines ?? 0,
      geometries: memoryInfo.geometries ?? 0,
      textures: memoryInfo.textures ?? 0,
      lowSpecMode: this.lowSpecMode,
      isSoftwareGl: this.isSoftwareGl,
      avgFrameMs: Math.round(this._avgFrameMs * 10) / 10
    };
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
    if (!this.renderer || !this.world) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    return this.world.raycastFromNdc(ndcX, ndcY);
  }

  findHitModule(obj) {
    if (!this.briefcaseRig || !obj) return null;
    let curr = obj;
    while (curr && curr !== this.briefcaseRig.moduleBayRoot && curr !== this.scene) {
      if (curr.userData?.moduleId) {
        return this.moduleViews.get(curr.userData.moduleId) || null;
      }
      curr = curr.parent;
    }
    return null;
  }

  setRole(newRole) {
    if (this.role !== newRole) {
      this._keyboardReticleActive = false;
      this.interaction.cancelActiveGesture('role_change');
      this.role = newRole;
      if (this.world) {
        this.world.setRole(newRole, { immediate: true });
      }
      if (this.currentState) {
        this.updateState(this.currentState);
      }
    }
  }

  updateState(state) {
    const prevStatus = this.currentState?.status;
    this.currentState = state;
    if (!state || !this.world) return;

    if (prevStatus === 'running' && state.status !== 'running') {
      this._keyboardReticleActive = false;
      this.interaction.cancelActiveGesture('round_ended');
    }

    this.world.updateState(state);
  }

  triggerStrikePenaltyFlash(penaltySeconds = 30, durationMs = 1600) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this._penaltyFlashSeconds = Math.max(0, Number(penaltySeconds) || 0);
    this._penaltyFlashUntilMs = now + Math.max(200, durationMs);
  }

  animate() {
    if (!this.renderer || !this.scene || !this.camera || this.contextLost) return;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = now - (this._lastFrameTime || now);
    this._lastFrameTime = now;

    if (dt > 2 && dt < 250) {
      this._frameDeltas.push(dt);
      if (this._frameDeltas.length > 30) this._frameDeltas.shift();
      if (this._frameDeltas.length === 30) {
        const sum = this._frameDeltas.reduce((a, b) => a + b, 0);
        this._avgFrameMs = sum / 30;
        if (!this.lowSpecMode && !this.isSoftwareGl && this._avgFrameMs > 28) {
          this.setLowSpecMode(true);
        }
      }
    }

    // Advance active touch/hold progress indicators, inner-lid timer & silent Optical Morse side-lamp
    this.interaction.tick();
    this.syncReticleWithInteraction();
    if (this.world) {
      this.world.syncMorseLamp(now);
      const activePenalty = now < this._penaltyFlashUntilMs ? this._penaltyFlashSeconds : 0;
      this.world.syncLidTimer(this.getTimerRemaining(), activePenalty);
    }

    const damping = prefersReducedMotion() ? 1.0 : 0.18;
    if (this.cameraRig) {
      this.cameraRig.update(damping);
    }

    this.renderer.render(this.scene, this.camera);

    // Schedule next frame strictly AFTER draw (using GPU fenceSync on software GL)
    if (this.isSoftwareGl && typeof window !== 'undefined') {
      const gl = this.renderer.getContext();
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          if (!this.renderer || this.contextLost) return;
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            this.animTimeoutId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            this.animTimeoutId = window.setTimeout(() => {
              this.animTimeoutId = null;
              this.animate();
            }, 80);
          }
        };
        this.animTimeoutId = window.setTimeout(poll, 5);
        return;
      }
    }

    this.animFrameId = requestAnimationFrame(this.animate);
  }

  dispose() {
    this._keyboardReticleActive = false;
    this.interaction.cancelActiveGesture('dispose');

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.animTimeoutId) {
      clearTimeout(this.animTimeoutId);
      this.animTimeoutId = null;
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
        if (this.boundWebglContextLost) dom.removeEventListener('webglcontextlost', this.boundWebglContextLost);
        if (this.boundWebglContextRestored) dom.removeEventListener('webglcontextrestored', this.boundWebglContextRestored);
      }

      if (typeof window !== 'undefined') {
        window.removeEventListener('blur', this.boundWindowBlur);
        window.removeEventListener('orientationchange', this.boundOrientationChange);
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.boundVisibilityChange);
      }

      if (this.world) {
        this.world.dispose();
        this.world = null;
      }

      this.renderer.dispose();
      if (dom && dom.parentNode) {
        dom.parentNode.removeChild(dom);
      }
    } else if (this.world) {
      this.world.dispose();
      this.world = null;
    }

    this.scene = null;
    this.camera = null;
    this.cameraRig = null;
    this.styleManager = null;
    this.briefcaseRig = null;
    this.vanEnv = null;
    this.avatars = null;
    this.renderer = null;
    this.bombGroup = null;
    this.moduleViews.clear();
  }
}
