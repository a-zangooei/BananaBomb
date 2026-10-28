/**
 * Viewport Ergonomics, Non-Blocking Toast Banner, Screen Wake Lock, Fullscreen & Haptics.
 */

export function triggerHaptic(pattern) {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {}
  }
}

export function createToastController(bannerEl) {
  let toastTimeoutId = null;

  function showToast(message, variant = 'info', durationMs = 3600) {
    if (!bannerEl || !message) return;
    bannerEl.textContent = message;
    bannerEl.className =
      'app-toast-banner' +
      (variant === 'error' ? ' toast-error' : variant === 'success' ? ' toast-success' : '');
    bannerEl.style.display = 'block';
    if (toastTimeoutId) clearTimeout(toastTimeoutId);
    toastTimeoutId = setTimeout(() => {
      if (bannerEl) bannerEl.style.display = 'none';
    }, durationMs);
  }

  return { showToast };
}

export function createWakeLockController({ getGameStatus }) {
  let wakeLockSentinel = null;

  function shouldHoldScreenWakeLock(status = getGameStatus?.()) {
    return status === 'countdown' || status === 'running';
  }

  async function acquireScreenWakeLock() {
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || !navigator.wakeLock?.request) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (wakeLockSentinel) return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel = sentinel;
      sentinel.addEventListener?.('release', () => {
        if (wakeLockSentinel === sentinel) {
          wakeLockSentinel = null;
        }
      });
    } catch (e) {
      // Gracefully ignore when battery saver or browser policy blocks wakeLock
    }
  }

  async function releaseScreenWakeLock() {
    if (!wakeLockSentinel) return;
    const sentinel = wakeLockSentinel;
    wakeLockSentinel = null;
    try {
      await sentinel.release();
    } catch (e) {}
  }

  function syncScreenWakeLock(status = getGameStatus?.()) {
    if (shouldHoldScreenWakeLock(status)) {
      acquireScreenWakeLock();
    } else {
      releaseScreenWakeLock();
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && shouldHoldScreenWakeLock()) {
        acquireScreenWakeLock();
      }
    });
  }

  return { syncScreenWakeLock };
}

export function initFullscreenControls({ buttons = [], showToast }) {
  function getFullscreenElement() {
    if (typeof document === 'undefined') return null;
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function syncFullscreenButtonsUI() {
    const active = Boolean(getFullscreenElement());
    buttons.forEach((btn) => {
      if (!btn) return;
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.setAttribute('aria-label', active ? 'خروج از حالت تمام‌صفحه' : 'ورود به حالت تمام‌صفحه');
      btn.setAttribute('title', active ? 'خروج از حالت تمام‌صفحه' : 'حالت تمام‌صفحه');
      const enterIcon = btn.querySelector('.fs-icon-enter');
      const exitIcon = btn.querySelector('.fs-icon-exit');
      if (enterIcon) enterIcon.style.display = active ? 'none' : 'block';
      if (exitIcon) exitIcon.style.display = active ? 'block' : 'none';
    });
  }

  async function toggleAppFullscreen() {
    if (typeof document === 'undefined') return;
    const rootEl = document.documentElement;
    const currentFs = getFullscreenElement();
    try {
      if (currentFs) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      } else if (rootEl.requestFullscreen) {
        await rootEl.requestFullscreen();
      } else if (rootEl.webkitRequestFullscreen) {
        rootEl.webkitRequestFullscreen();
      } else {
        showToast?.(
          'مرورگر فعلی از حالت تمام‌صفحه مستقیم پشتیبانی نمی‌کند؛ گزینه افزودن به صفحه اصلی (Add to Home Screen) پیشنهاد می‌شود.',
          'info',
          3800
        );
        return;
      }
    } catch (e) {
      showToast?.('تغییر وضعیت تمام‌صفحه توسط مرورگر محدود شد.', 'info', 2500);
    }
    syncFullscreenButtonsUI();
  }

  buttons.forEach((btn) => {
    if (btn) {
      btn.addEventListener('click', toggleAppFullscreen);
    }
  });

  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', syncFullscreenButtonsUI);
    document.addEventListener('webkitfullscreenchange', syncFullscreenButtonsUI);
    syncFullscreenButtonsUI();
  }

  return { toggleAppFullscreen, syncFullscreenButtonsUI };
}

export function initOrientationHint({ hintEl, closeBtn, getGameStatus }) {
  function updateOrientationHint() {
    if (!hintEl || typeof window === 'undefined') return;
    const isPortraitPhone = window.innerHeight > window.innerWidth && window.innerWidth <= 600;
    let dismissed = false;
    try {
      dismissed = sessionStorage.getItem('dismissed_orientation_hint') === 'true';
    } catch (e) {}
    if (isPortraitPhone && !dismissed && getGameStatus?.() === 'running') {
      hintEl.style.display = 'flex';
    } else {
      hintEl.style.display = 'none';
    }
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (hintEl) hintEl.style.display = 'none';
      try {
        sessionStorage.setItem('dismissed_orientation_hint', 'true');
      } catch (e) {}
    });
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updateOrientationHint);
    window.addEventListener('orientationchange', updateOrientationHint);
  }

  return { updateOrientationHint };
}
