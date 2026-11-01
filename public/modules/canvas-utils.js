/**
 * Shared 2D Canvas & Accessibility Helpers for Client 3D Modules.
 * Works natively in browsers and provides a deterministic offscreen 2D context
 * fallback in headless Node.js automated test environments.
 */

export function createCanvas2D(width = 256, height = 256) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  // Headless Node.js fallback for testing actual production 3D module code
  const texts = [];
  const ctx = {
    fillStyle: '#000000',
    strokeStyle: '#ffffff',
    lineWidth: 1,
    lineCap: 'butt',
    font: '16px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    fillText(str, x, y) {
      texts.push({ text: String(str), x, y });
    }
  };

  return {
    width,
    height,
    _texts: texts,
    getContext(type) {
      return type === '2d' ? ctx : null;
    }
  };
}

export function prefersReducedMotion() {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }
  return false;
}

/**
 * Creates a color-accurate sRGB `THREE.CanvasTexture` for 2D canvas labels and HUD overlays.
 * Dynamic textures that redraw frequently (timers, Morse pulses, hold progress arcs) disable
 * per-upload mipmap chain regeneration (`generateMipmaps = false`, `LinearFilter`) to avoid
 * mobile GPU upload stalls while preserving smooth bilinear sampling.
 */
export function createColorCanvasTexture(THREE, canvas, { dynamic = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (dynamic) {
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
  }
  return tex;
}

/**
 * Creates a shared, zero-fill-cost invisible proxy material for `THREE.Raycaster` touch hitboxes.
 * Disables both `colorWrite` and `depthWrite` so mobile GPUs skip fragment blending while
 * keeping full raycast intersection behavior.
 */
export function createTouchHitboxMaterial(THREE) {
  return new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
    toneMapped: false
  });
}

/**
 * Applies hardware max anisotropic filtering to all mipmapped textures in a 3D subtree
 * so oblique bomb-bay labels, keypad glyphs, and Braille cells remain sharp.
 */
export function applyAnisotropyToSubtree(rootObj, maxAnisotropy = 1) {
  if (!rootObj || !(maxAnisotropy > 1)) return;
  rootObj.traverse((obj) => {
    if (!obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) {
      if (mat && mat.map && mat.map.isTexture && mat.map.generateMipmaps !== false) {
        if (mat.map.anisotropy !== maxAnisotropy) {
          mat.map.anisotropy = maxAnisotropy;
          mat.map.needsUpdate = true;
        }
      }
    }
  });
}

