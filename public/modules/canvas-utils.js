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
