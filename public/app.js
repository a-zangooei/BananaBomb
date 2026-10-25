import { GameTransport } from './transport.js';
import { sound } from './audio.js';
import { Bomb3DScene, isWebGLAvailable } from './bomb3d.js';
import { INTERACTION_DEFAULTS } from './interaction-controller.js';
import { renderQrSvg } from './qr-svg.js';
import { createHybridSessionManager } from './session-store.js';

// Expose sound engine for tactile audio feedback across modules
window.soundEngine = sound;

// --- Hybrid Mobile Session & Tab-Safe Identity ---
const sessionManager = createHybridSessionManager();
let playerId = sessionManager.playerId;
let myRole = sessionManager.getRole();
let currentGameState = null;
let lastGameStatus = null;
let lastTickSecond = null;
let lastCountdownBeepStep = null;
let lastUrgencyLevel = 'normal';
let bombScene = null;
let manualWorldScene = null;
let manualDockMode = 'split';
let selectedPermTabRole = 'operator';
let activeRefTab = 'checklist';
let lastRefTriggerEl = null;
let isCustomDifficultyOpen = false;
let isSeedPanelOpen = false;
let audioUnlocked = false;
let toastTimeoutId = null;

// Initialize Transport Abstraction
const transport = new GameTransport();

// --- Core Shell & Phase Elements ---
const appViewport = document.querySelector('.app-viewport');
const lobbyTopBar = document.getElementById('lobbyTopBar');
const activeRoundHud = document.getElementById('activeRoundHud');
const pingDot = document.getElementById('pingDot');
const connStatus = document.getElementById('connStatus');
const appToastBanner = document.getElementById('appToastBanner');
const webglErrorBanner = document.getElementById('webglErrorBanner');

// Active Round HUD Elements
const hudTimerCluster = document.getElementById('hudTimerCluster');
const timerUrgencyIcon = document.getElementById('timerUrgencyIcon');
const timerDisplay = document.getElementById('timerDisplay');
const timerPenaltyBadge = document.getElementById('timerPenaltyBadge');
const hudStrikeRatio = document.getElementById('hudStrikeRatio');
const strikeBoxesContainer = document.getElementById('strikeBoxes');
const hudDefusedRatio = document.getElementById('hudDefusedRatio');
const serialTag = document.getElementById('serialTag');
const serialValue = document.getElementById('serialValue');
const btnInRoundHelp = document.getElementById('btnInRoundHelp');

// Views, Countdown Curtain & Debrief Overlays
const lobbySection = document.getElementById('lobbySection');
const bomb3dSection = document.getElementById('bomb3dSection');
const muteSection = document.getElementById('muteSection');
const overlayCountdown = document.getElementById('overlayCountdown');
const countdownDigitDisplay = document.getElementById('countdownDigitDisplay');
const countdownProgressFill = document.getElementById('countdownProgressFill');
const countdownRoleTitle = document.getElementById('countdownRoleTitle');
const countdownRoleInstructions = document.getElementById('countdownRoleInstructions');
const btnCancelCountdown = document.getElementById('btnCancelCountdown');
const overlayExploded = document.getElementById('overlayExploded');
const overlayDefused = document.getElementById('overlayDefused');
const explodeReason = document.getElementById('explodeReason');
const defusedStats = document.getElementById('defusedStats');
const explodedTimeStat = document.getElementById('explodedTimeStat');
const explodedStrikesStat = document.getElementById('explodedStrikesStat');
const explodedModulesStat = document.getElementById('explodedModulesStat');
const defusedTimeStat = document.getElementById('defusedTimeStat');
const defusedStrikesStat = document.getElementById('defusedStrikesStat');
const defusedModulesStat = document.getElementById('defusedModulesStat');

// Reference, QR Invite Modal & Fullscreen Elements
const btnOpenQrModal = document.getElementById('btnOpenQrModal');
const qrInviteModal = document.getElementById('qrInviteModal');
const btnCloseQrModal = document.getElementById('btnCloseQrModal');
const qrSvgContainer = document.getElementById('qrSvgContainer');
const qrActiveUrlText = document.getElementById('qrActiveUrlText');
const btnCopyLanUrl = document.getElementById('btnCopyLanUrl');
const qrLocalhostNotice = document.getElementById('qrLocalhostNotice');
const qrInterfaceSelectorWrap = document.getElementById('qrInterfaceSelectorWrap');
const qrInterfaceButtons = document.getElementById('qrInterfaceButtons');
const inputManualLanHost = document.getElementById('inputManualLanHost');
const btnApplyManualLanHost = document.getElementById('btnApplyManualLanHost');
const btnLobbyFullscreen = document.getElementById('btnLobbyFullscreen');
const btnHudFullscreen = document.getElementById('btnHudFullscreen');

const btnOpenReferenceSheet = document.getElementById('btnOpenReferenceSheet');
const headerChecklistCount = document.getElementById('headerChecklistCount');
const lobbyReferenceSheet = document.getElementById('lobbyReferenceSheet');
const btnCloseReferenceSheet = document.getElementById('btnCloseReferenceSheet');
const sheetTabCheckCount = document.getElementById('sheetTabCheckCount');
const refTabButtons = Array.from(document.querySelectorAll('[data-ref-tab]'));
const refTabPanes = Array.from(document.querySelectorAll('[data-ref-pane]'));

// 3D Viewport & Legacy Hidden Sync Hooks
const bomb3dContainer = document.getElementById('bomb3dContainer');
const bomb3dRoleBanner = document.getElementById('bomb3dRoleBanner');
const blindTactileHelper = document.getElementById('blindTactileHelper');
const deafVisualHelper = document.getElementById('deafVisualHelper');
const bombInRoundPermissions = document.getElementById('bombInRoundPermissions');
const manualInRoundPermissions = document.getElementById('manualInRoundPermissions');
const observerGestureDrawer = document.getElementById('observerGestureDrawer');

// Easy-mode Communication Aid Widgets (Observer <-> Manual-holder bridge only)
const observerCommAidWidget = document.getElementById('observerCommAidWidget');
const observerCommAidBudget = document.getElementById('observerCommAidBudget');
const observerCommAidFeedback = document.getElementById('observerCommAidFeedback');
const manualCommAidWidget = document.getElementById('manualCommAidWidget');
const manualCommAidBudget = document.getElementById('manualCommAidBudget');
const manualCommAidFeedback = document.getElementById('manualCommAidFeedback');

// INTERNAL IDENTIFIER MAPPING:
// Legacy DOM/wire keys ('blind', 'deaf', 'mute') map directly to canonical functional roles:
//   - 'blind' <-> 'operator' (اپراتور / Operator)
//   - 'deaf'  <-> 'observer' (ناظر / Observer)
//   - 'mute'  <-> 'manual'   (دفترچه راهنما / Manual-holder)
const cardBlindEl = document.getElementById('cardBlind');
const cardDeafEl = document.getElementById('cardDeaf');
const cardMuteEl = document.getElementById('cardMute');

const badgeBlindEl = document.getElementById('badgeBlind');
const badgeDeafEl = document.getElementById('badgeDeaf');
const badgeMuteEl = document.getElementById('badgeMute');

const slotIndBlind = document.getElementById('slotIndBlind');
const slotIndDeaf = document.getElementById('slotIndDeaf');
const slotIndMute = document.getElementById('slotIndMute');
const squadReadyRatio = document.getElementById('squadReadyRatio');

const roleCards = {
  blind: cardBlindEl,
  deaf: cardDeafEl,
  mute: cardMuteEl,
  operator: cardBlindEl,
  observer: cardDeafEl,
  manual: cardMuteEl
};

const roleBadges = {
  blind: badgeBlindEl,
  deaf: badgeDeafEl,
  mute: badgeMuteEl,
  operator: badgeBlindEl,
  observer: badgeDeafEl,
  manual: badgeMuteEl
};

const slotIndicators = {
  blind: { el: slotIndBlind, shortTitle: 'اپراتور' },
  deaf: { el: slotIndDeaf, shortTitle: 'ناظر' },
  mute: { el: slotIndMute, shortTitle: 'راهنما' }
};

const releaseRoleButtons = {
  blind: document.getElementById('btnReleaseBlind'),
  deaf: document.getElementById('btnReleaseDeaf'),
  mute: document.getElementById('btnReleaseMute')
};

// Functional Role Normalizers
const isOperator = (r) => r === 'operator' || r === 'blind';
const isObserver = (r) => r === 'observer' || r === 'deaf';
const isManual = (r) => r === 'manual' || r === 'mute';

function toFunctionalRoleKey(r) {
  if (isOperator(r)) return 'operator';
  if (isObserver(r)) return 'observer';
  if (isManual(r)) return 'manual';
  return 'operator';
}

// Canonical Role-Specific "You Can / You Cannot" Specification
const ROLE_PERMISSIONS_SPEC = {
  operator: {
    title: 'اپراتور (Operator)',
    can: [
      'مشاهده نمای سه‌بعدی مونوکروم بمب روی گوشی خود و شنیدن صدای بازی که از گوشی شما پخش می‌شود.',
      'لمس و تعامل مستقیم با بمب (بریدن سیم‌ها، فشردن/نگه‌داشتن دکمه، زدن کلیدهای ۱ تا ۴، چرخاندن سلکتور و ارسال TX).',
      'استفاده از عینک آفتابی یا محدودیت دید راحت، ایمن و توافقی پیش از شروع راند.',
      'دریافت دستورات کلامی از ناظر و انتقال بی‌کلام ریتم بوق فانوس (با ضربه روی میز) به ناظر.'
    ],
    cannot: [
      'صحبت کردن یا تولید هرگونه کلام در طول راند.',
      'دیدن بازیکن دارنده دفترچه راهنما یا نگاه کردن به صفحه گوشی دفترچه راهنما یا ناظر.',
      'ارتباط مستقیم (کلامی یا اشاره‌ای) با دارنده دفترچه راهنما.',
      'نشان دادن صفحه گوشی خود به سایر بازیکنان یا درخواست دیدن مستقیم صفحات آن‌ها.'
    ]
  },
  observer: {
    title: 'ناظر (Observer) — پل ارتباطی تیم',
    can: [
      'مشاهده رنگ و شکل اجزای داخل کیف، نمادهای کیپد، نوار کناری دکمه و پلاک شماره سریال از زاویه جانبی ۳D.',
      'صحبت کردن شفاهی با اپراتور (شما تنها بازیکنی هستید که اجازه صحبت کردن دارد).',
      'برقراری ارتباط دوطرفه با دارنده دفترچه راهنما از طریق اشاره‌های توافقی دست (و کمک‌ارتباطی ۳ نمادی در حالت آسان).',
      'نگاه به اطراف و زوم اپتیکال از صندلی کناری میز بدون لمس عملیاتی ماژول‌های بمب.'
    ],
    cannot: [
      'لمس، بریدن سیم یا تعامل عملیاتی با هیچ‌یک از ماژول‌های بمب.',
      'تکیه بر شنیدن صدای بازی در اتاق یا کسب اطلاعات از صدای گوشی اپراتور (هدفون ایمن یا جایگزین توافقی الزامی است).',
      'نشان دادن صفحه رنگی گوشی خود به اپراتور یا دارنده دفترچه راهنما، یا نگاه کردن به صفحه گوشی آن‌ها.',
      'استفاده از موسیقی یا صدای بلند و آسیب‌زا در هدفون.'
    ]
  },
  manual: {
    title: 'دفترچه راهنما (Manual-holder)',
    can: [
      'مطالعه دفترچه قوانین ۲D راند جاری در کنار نمای سه‌بعدی نشسته پشت میز ون (که درب باز کیف دید داخل بمب را پوشانده است).',
      'برقراری ارتباط دوطرفه فقط با ناظر از طریق اشاره‌های توافقی دست (و کمک‌ارتباطی ۳ نمادی در حالت آسان).',
      'تحلیل سرنخ‌های اعلامی ناظر و انتقال شماره سیم، ضربه/نگه‌داشتن، رقم ثانیه یا شماره کانال با اشاره به ناظر.'
    ],
    cannot: [
      'صحبت کردن یا زمزمه کردن با هیچ‌یک از بازیکنان.',
      'دیدن صفحه گوشی اپراتور یا برقراری هرگونه ارتباط مستقیم با اپراتور.',
      'لمس یا تعامل با بمب، یا نشان دادن صفحه دفترچه راهنما به ناظر یا اپراتور.',
      'وابسته کردن حل ماژول به شنیدن مستقیم صدای گوشی اپراتور در اتاق به جای جدول دیداری و هماهنگی با ناظر.'
    ]
  }
};

function buildPermissionsHtml(roleKey) {
  const spec = ROLE_PERMISSIONS_SPEC[toFunctionalRoleKey(roleKey)] || ROLE_PERMISSIONS_SPEC.operator;
  const canItems = spec.can.map((item) => `<li>${item}</li>`).join('');
  const cannotItems = spec.cannot.map((item) => `<li>${item}</li>`).join('');
  return `
    <div class="perm-col perm-col-can">
      <h4>✓ مجاز هستید (${spec.title}):</h4>
      <ul class="perm-list">${canItems}</ul>
    </div>
    <div class="perm-col perm-col-cannot">
      <h4>✕ مجاز نیستید (${spec.title}):</h4>
      <ul class="perm-list">${cannotItems}</ul>
    </div>
  `;
}

// --- Reference & Checklist Modal Sheet Wiring ---
const rolePermissionsBody = document.getElementById('rolePermissionsBody');
const permTabButtons = document.querySelectorAll('[data-perm-role]');

function renderLobbyPermissionsPanel(roleKey = selectedPermTabRole) {
  selectedPermTabRole = toFunctionalRoleKey(roleKey);
  permTabButtons.forEach((btn) => {
    const isActive = btn.getAttribute('data-perm-role') === selectedPermTabRole;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  if (rolePermissionsBody) {
    rolePermissionsBody.innerHTML = buildPermissionsHtml(selectedPermTabRole);
  }
}

permTabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const r = btn.getAttribute('data-perm-role') || 'operator';
    renderLobbyPermissionsPanel(r);
  });
});

renderLobbyPermissionsPanel(myRole ? toFunctionalRoleKey(myRole) : 'operator');

function setActiveReferenceTab(tabId) {
  activeRefTab = tabId || 'checklist';
  refTabButtons.forEach((btn) => {
    const isMatch = btn.getAttribute('data-ref-tab') === activeRefTab;
    btn.classList.toggle('active', isMatch);
    btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
  });
  refTabPanes.forEach((pane) => {
    pane.classList.toggle('active', pane.getAttribute('data-ref-pane') === activeRefTab);
  });
}

function isReferenceSheetOpen() {
  return Boolean(lobbyReferenceSheet && lobbyReferenceSheet.style.display !== 'none');
}

function openReferenceSheet(tabId = activeRefTab, permRole = null, triggerEl = null) {
  if (!lobbyReferenceSheet) return;
  if (triggerEl) {
    lastRefTriggerEl = triggerEl;
  }
  if (permRole) {
    renderLobbyPermissionsPanel(permRole);
  }
  setActiveReferenceTab(tabId);
  lobbyReferenceSheet.style.display = 'flex';
  btnCloseReferenceSheet?.focus();
}

function closeReferenceSheet() {
  if (!lobbyReferenceSheet || lobbyReferenceSheet.style.display === 'none') return;
  lobbyReferenceSheet.style.display = 'none';
  if (lastRefTriggerEl && typeof lastRefTriggerEl.focus === 'function') {
    lastRefTriggerEl.focus();
  }
}

refTabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    setActiveReferenceTab(btn.getAttribute('data-ref-tab') || 'checklist');
  });
});

if (btnOpenReferenceSheet) {
  btnOpenReferenceSheet.addEventListener('click', () => {
    openReferenceSheet(activeRefTab || 'checklist', myRole ? toFunctionalRoleKey(myRole) : null, btnOpenReferenceSheet);
  });
}

if (btnInRoundHelp) {
  btnInRoundHelp.addEventListener('click', () => {
    const targetTab = isOperator(myRole) ? 'permissions' : 'gestures';
    openReferenceSheet(targetTab, myRole ? toFunctionalRoleKey(myRole) : 'operator', btnInRoundHelp);
  });
}

if (btnCloseReferenceSheet) {
  btnCloseReferenceSheet.addEventListener('click', closeReferenceSheet);
}

if (lobbyReferenceSheet) {
  lobbyReferenceSheet.addEventListener('click', (e) => {
    if (e.target === lobbyReferenceSheet) {
      closeReferenceSheet();
    }
  });
}

document.querySelectorAll('[data-open-perm]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const roleTarget = btn.getAttribute('data-open-perm') || 'operator';
    openReferenceSheet('permissions', roleTarget, btn);
  });
});

// Non-blocking Toast Helper
function showToast(message, variant = 'info', durationMs = 3600) {
  if (!appToastBanner || !message) return;
  appToastBanner.textContent = message;
  appToastBanner.className =
    'app-toast-banner' +
    (variant === 'error' ? ' toast-error' : variant === 'success' ? ' toast-success' : '');
  appToastBanner.style.display = 'block';
  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    if (appToastBanner) appToastBanner.style.display = 'none';
  }, durationMs);
}

// --- Offline Vector QR Code LAN Invite Modal ---
let detectedLanInterfaces = [];
let detectedServerPort = Number(window.location.port) || 3000;
let activeQrUrl = window.location.origin;
let lastQrTriggerEl = null;

function isLoopbackHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

function normalizeManualLanUrl(rawInput, fallbackPort = detectedServerPort) {
  let val = String(rawInput || '').trim();
  if (!val) return '';
  if (!/^https?:\/\//i.test(val)) {
    val = `http://${val}`;
  }
  try {
    const parsed = new URL(val);
    if (!parsed.port && fallbackPort && parsed.protocol === 'http:') {
      parsed.port = String(fallbackPort);
    }
    return parsed.origin;
  } catch (e) {
    return '';
  }
}

function renderQrModalUrl(targetUrl) {
  if (!targetUrl) return;
  activeQrUrl = targetUrl;
  if (qrActiveUrlText) {
    qrActiveUrlText.textContent = activeQrUrl;
  }
  if (qrSvgContainer) {
    try {
      qrSvgContainer.innerHTML = renderQrSvg(activeQrUrl, {
        ariaLabel: `QR Code ${activeQrUrl}`
      });
    } catch (e) {
      qrSvgContainer.textContent = activeQrUrl;
    }
  }

  let isCurrentQrLoopback = false;
  try {
    isCurrentQrLoopback = isLoopbackHost(new URL(activeQrUrl).hostname);
  } catch (e) {}

  if (qrLocalhostNotice) {
    qrLocalhostNotice.style.display = isCurrentQrLoopback ? 'block' : 'none';
  }

  if (qrInterfaceButtons) {
    qrInterfaceButtons.querySelectorAll('.qr-iface-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-lan-url') === activeQrUrl);
    });
  }
}

function renderDetectedInterfaceButtons() {
  if (!qrInterfaceSelectorWrap || !qrInterfaceButtons) return;
  if (!Array.isArray(detectedLanInterfaces) || detectedLanInterfaces.length === 0) {
    qrInterfaceSelectorWrap.style.display = 'none';
    qrInterfaceButtons.innerHTML = '';
    return;
  }

  qrInterfaceSelectorWrap.style.display = 'flex';
  qrInterfaceButtons.innerHTML = '';
  detectedLanInterfaces.forEach((iface) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qr-iface-btn tabular-num' + (iface.url === activeQrUrl ? ' active' : '');
    btn.setAttribute('dir', 'ltr');
    btn.setAttribute('data-lan-url', iface.url);
    btn.textContent = `${iface.address}:${detectedServerPort} (${iface.name})`;
    btn.addEventListener('click', () => {
      try {
        localStorage.removeItem('defusal_manual_lan_url');
      } catch (e) {}
      renderQrModalUrl(iface.url);
    });
    qrInterfaceButtons.appendChild(btn);
  });
}

async function refreshLanQrEndpoints() {
  let savedManualUrl = '';
  try {
    savedManualUrl = localStorage.getItem('defusal_manual_lan_url') || '';
  } catch (e) {}

  try {
    const resp = await fetch('/api/lan-info', { cache: 'no-store' });
    if (resp.ok) {
      const info = await resp.json();
      if (info?.port) detectedServerPort = Number(info.port) || detectedServerPort;
      if (Array.isArray(info?.interfaces)) {
        detectedLanInterfaces = info.interfaces;
      }
    }
  } catch (e) {
    // Offline fallback if server route unreachable
  }

  if (inputManualLanHost && !inputManualLanHost.value) {
    inputManualLanHost.placeholder = `192.168.43.1:${detectedServerPort}`;
  }

  let preferredUrl = window.location.origin;
  if (savedManualUrl) {
    preferredUrl = savedManualUrl;
  } else if (isLoopbackHost(window.location.hostname) && detectedLanInterfaces.length > 0) {
    preferredUrl = detectedLanInterfaces[0].url;
  }

  renderDetectedInterfaceButtons();
  renderQrModalUrl(preferredUrl);
}

function isQrModalOpen() {
  return Boolean(qrInviteModal && qrInviteModal.style.display !== 'none');
}

function openQrModal(triggerEl = null) {
  if (!qrInviteModal) return;
  if (triggerEl) lastQrTriggerEl = triggerEl;
  qrInviteModal.style.display = 'flex';
  renderQrModalUrl(activeQrUrl || window.location.origin);
  refreshLanQrEndpoints();
  btnCloseQrModal?.focus();
}

function closeQrModal() {
  if (!qrInviteModal || qrInviteModal.style.display === 'none') return;
  qrInviteModal.style.display = 'none';
  if (lastQrTriggerEl && typeof lastQrTriggerEl.focus === 'function') {
    lastQrTriggerEl.focus();
  }
}

if (btnOpenQrModal) {
  btnOpenQrModal.addEventListener('click', () => openQrModal(btnOpenQrModal));
}
if (btnCloseQrModal) {
  btnCloseQrModal.addEventListener('click', closeQrModal);
}
if (qrInviteModal) {
  qrInviteModal.addEventListener('click', (e) => {
    if (e.target === qrInviteModal) closeQrModal();
  });
}

if (btnApplyManualLanHost && inputManualLanHost) {
  const applyManualHost = () => {
    const raw = inputManualLanHost.value.trim();
    if (!raw) {
      try {
        localStorage.removeItem('defusal_manual_lan_url');
      } catch (e) {}
      refreshLanQrEndpoints();
      return;
    }
    const normalized = normalizeManualLanUrl(raw, detectedServerPort);
    if (!normalized) {
      showToast('قالب آدرس واردشده معتبر نیست (مثال: 192.168.43.1:3000).', 'error', 2800);
      return;
    }
    try {
      localStorage.setItem('defusal_manual_lan_url', normalized);
    } catch (e) {}
    renderQrModalUrl(normalized);
    showToast('کد QR بر اساس آدرس جدید به‌روز شد.', 'success', 2200);
  };

  btnApplyManualLanHost.addEventListener('click', applyManualHost);
  inputManualLanHost.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyManualHost();
    }
  });
}

if (btnCopyLanUrl) {
  btnCopyLanUrl.addEventListener('click', async () => {
    const textToCopy = activeQrUrl || window.location.origin;
    let copied = false;
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(textToCopy);
        copied = true;
      } catch (e) {}
    }
    if (!copied) {
      try {
        const tempArea = document.createElement('textarea');
        tempArea.value = textToCopy;
        tempArea.setAttribute('readonly', '');
        tempArea.style.position = 'fixed';
        tempArea.style.opacity = '0';
        document.body.appendChild(tempArea);
        tempArea.select();
        copied = document.execCommand('copy');
        document.body.removeChild(tempArea);
      } catch (e) {}
    }
    if (copied) {
      showToast('آدرس اتصال کپی شد.', 'success', 2000);
    } else {
      showToast('امکان کپی خودکار نبود؛ آدرس را از کادر بالا بخوانید.', 'info', 2800);
    }
  });
}

// --- Screen Wake Lock & Fullscreen Ergonomics ---
let wakeLockSentinel = null;

function shouldHoldScreenWakeLock(status = currentGameState?.status) {
  return status === 'countdown' || status === 'running';
}

async function acquireScreenWakeLock() {
  if (!('wakeLock' in navigator) || !navigator.wakeLock?.request) return;
  if (document.visibilityState !== 'visible') return;
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

function syncScreenWakeLock(status = currentGameState?.status) {
  if (shouldHoldScreenWakeLock(status)) {
    acquireScreenWakeLock();
  } else {
    releaseScreenWakeLock();
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && shouldHoldScreenWakeLock()) {
    acquireScreenWakeLock();
  }
});

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function syncFullscreenButtonsUI() {
  const active = Boolean(getFullscreenElement());
  [btnLobbyFullscreen, btnHudFullscreen].forEach((btn) => {
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
      showToast('مرورگر فعلی از حالت تمام‌صفحه مستقیم پشتیبانی نمی‌کند؛ گزینه افزودن به صفحه اصلی (Add to Home Screen) پیشنهاد می‌شود.', 'info', 3800);
      return;
    }
  } catch (e) {
    showToast('تغییر وضعیت تمام‌صفحه توسط مرورگر محدود شد.', 'info', 2500);
  }
  syncFullscreenButtonsUI();
}

[btnLobbyFullscreen, btnHudFullscreen].forEach((btn) => {
  if (btn) {
    btn.addEventListener('click', toggleAppFullscreen);
  }
});
document.addEventListener('fullscreenchange', syncFullscreenButtonsUI);
document.addEventListener('webkitfullscreenchange', syncFullscreenButtonsUI);
syncFullscreenButtonsUI();

// --- Pre-Start 3s Readiness Role Reminders ---
const COUNTDOWN_ROLE_PREP = {
  operator: {
    title: 'آماده‌باش نقش شما: اپراتور (Operator)',
    items: [
      'عینک آفتابی یا محدودیت دید توافقی خود را همین الان بزنید.',
      'در طول راند مطلقاً صحبت نکنید؛ صدای بازی از گوشی شما پخش می‌شود.',
      'گوشی را طوری بگیرید که هم‌تیمی‌ها صفحه شما را نبینند.'
    ]
  },
  observer: {
    title: 'آماده‌باش نقش شما: ناظر (Observer)',
    items: [
      'هدفون ایمن را روی گوش بگذارید تا از صدای بازی استفاده نکنید.',
      'در ضلع کناری میز مستقر شوید؛ شما تنها گوینده تیم هستید.',
      'صفحه رنگی گوشی خود را از دید سایر بازیکنان محرمانه نگه دارید.'
    ]
  },
  manual: {
    title: 'آماده‌باش نقش شما: دفترچه راهنما (Manual-holder)',
    items: [
      'پشت درب کیف (روبه‌روی اپراتور) بنشینید و مطلقاً صحبت نکنید.',
      'صفحه قوانین را فقط در زاویه دید خود نگه دارید.',
      'فقط از طریق اشاره‌های توافقی دست با ناظر ارتباط برقرار کنید.'
    ]
  }
};

function renderCountdownCurtainRolePrep(roleKey) {
  const prep = COUNTDOWN_ROLE_PREP[toFunctionalRoleKey(roleKey)] || COUNTDOWN_ROLE_PREP.operator;
  if (countdownRoleTitle) {
    countdownRoleTitle.textContent = myRole ? prep.title : 'آماده‌باش عملیات · تماشاگر';
  }
  if (countdownRoleInstructions) {
    countdownRoleInstructions.innerHTML = prep.items.map((item) => `<li>${item}</li>`).join('');
  }
}

// --- Pre-Round Checklist Management ---
const checklistInputs = Array.from(document.querySelectorAll('#preRoundChecklistItems input[type="checkbox"]'));
const checklistProgressBadge = document.getElementById('checklistProgressBadge');
const btnCheckAllReady = document.getElementById('btnCheckAllReady');
const chkLiveRoleHint = document.getElementById('chkLiveRoleHint');
const chkLiveConnHint = document.getElementById('chkLiveConnHint');

function loadChecklistState() {
  try {
    const raw = sessionStorage.getItem('defusal_checklist_state');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveChecklistState(mapObj) {
  try {
    sessionStorage.setItem('defusal_checklist_state', JSON.stringify(mapObj));
  } catch (e) {}
}

function syncChecklistUI(state = currentGameState) {
  const checkedCount = checklistInputs.filter((el) => el.checked).length;
  const totalCount = checklistInputs.length || 7;
  const isComplete = checkedCount === totalCount;

  if (checklistProgressBadge) {
    checklistProgressBadge.textContent = `${checkedCount} از ${totalCount} تایید شد`;
    checklistProgressBadge.classList.toggle('complete', isComplete);
  }
  if (headerChecklistCount) {
    headerChecklistCount.textContent = `${checkedCount}/${totalCount}`;
    headerChecklistCount.classList.toggle('complete', isComplete);
  }
  if (sheetTabCheckCount) {
    sheetTabCheckCount.textContent = `${checkedCount}/${totalCount}`;
  }
  if (btnCheckAllReady) {
    btnCheckAllReady.textContent = isComplete ? 'بازنشانی چک‌لیست' : 'تایید همه';
  }
  if (chkLiveRoleHint) {
    if (myRole) {
      const title = ROLE_PERMISSIONS_SPEC[toFunctionalRoleKey(myRole)]?.title || '';
      chkLiveRoleHint.textContent = `(نقش فعلی شما: ${title})`;
    } else {
      chkLiveRoleHint.textContent = '(هنوز نقشی انتخاب نکرده‌اید)';
    }
  }
  if (chkLiveConnHint && state?.roles) {
    const connectedCount = ['blind', 'deaf', 'mute'].filter((k) => state.roles[k]?.connected).length;
    chkLiveConnHint.textContent = `(وضعیت شبکه: ${connectedCount} از ۳ بازیکن متصل)`;
  }
}

const initialChecklistMap = loadChecklistState();
checklistInputs.forEach((input) => {
  const key = input.getAttribute('data-check-key');
  if (key && initialChecklistMap[key]) {
    input.checked = true;
  }
  input.addEventListener('change', () => {
    const nextMap = {};
    checklistInputs.forEach((chk) => {
      const k = chk.getAttribute('data-check-key');
      if (k) nextMap[k] = chk.checked;
    });
    saveChecklistState(nextMap);
    syncChecklistUI();
  });
});

if (btnCheckAllReady) {
  btnCheckAllReady.addEventListener('click', () => {
    const allChecked = checklistInputs.every((el) => el.checked);
    const nextVal = !allChecked;
    const nextMap = {};
    checklistInputs.forEach((chk) => {
      chk.checked = nextVal;
      const k = chk.getAttribute('data-check-key');
      if (k) nextMap[k] = nextVal;
    });
    saveChecklistState(nextMap);
    syncChecklistUI();
  });
}

syncChecklistUI();

// --- Lobby Action & Configuration Elements ---
const btnUnlockAudio = document.getElementById('btnUnlockAudio');
const audioBanner = document.getElementById('audioBanner');
const myRoleActionRow = document.getElementById('myRoleActionRow');
const btnToggleReady = document.getElementById('btnToggleReady');
const btnToggleReadyText = document.getElementById('btnToggleReadyText');
const btnLeaveRole = document.getElementById('btnLeaveRole');
const btnStartGame = document.getElementById('btnStartGame');
const btnStartGameLabel = document.getElementById('btnStartGameLabel');
const startBlockerReason = document.getElementById('startBlockerReason');
const btnRestartExploded = document.getElementById('btnRestartExploded');
const btnRestartDefused = document.getElementById('btnRestartDefused');

// Lobby Seed Controls & Dynamic Manual
const lobbySeedDisplay = document.getElementById('lobbySeedDisplay');
const btnToggleSeedForm = document.getElementById('btnToggleSeedForm');
const lobbySeedContainer = document.getElementById('lobbySeedContainer');
const hostSeedControls = document.getElementById('hostSeedControls');
const inputCustomSeed = document.getElementById('inputCustomSeed');
const btnApplySeed = document.getElementById('btnApplySeed');
const muteManualContainer = document.getElementById('muteManualContainer');

// Authoritative Difficulty Preset Elements
const btnPresetEasy = document.getElementById('btnPresetEasy');
const btnPresetNormal = document.getElementById('btnPresetNormal');
const btnPresetHard = document.getElementById('btnPresetHard');
const btnPresetCustom = document.getElementById('btnPresetCustom');
const difficultyHostNotice = document.getElementById('difficultyHostNotice');
const diffChipName = document.getElementById('diffChipName');
const diffChipTime = document.getElementById('diffChipTime');
const diffChipStrikes = document.getElementById('diffChipStrikes');
const diffChipModules = document.getElementById('diffChipModules');
const diffChipPenalty = document.getElementById('diffChipPenalty');
const diffChipCommAid = document.getElementById('diffChipCommAid');
const customOverridesBox = document.getElementById('customOverridesBox');
const overrideDuration = document.getElementById('overrideDuration');
const overrideStrikes = document.getElementById('overrideStrikes');
const overrideModules = document.getElementById('overrideModules');
const overridePenalty = document.getElementById('overridePenalty');
const overrideWireIndexLabels = document.getElementById('overrideWireIndexLabels');
const overrideCommAidEnabled = document.getElementById('overrideCommAidEnabled');
const overrideCommAidBudget = document.getElementById('overrideCommAidBudget');
const btnApplyCustomDifficulty = document.getElementById('btnApplyCustomDifficulty');

const CANONICAL_PRESET_BASELINES = {
  easy: { duration: 330, maxStrikes: 4, moduleCount: 2, timePenaltySeconds: 15, wireIndexLabels: true, commAidEnabled: true, commAidBudget: 5 },
  normal: { duration: 300, maxStrikes: 3, moduleCount: 3, timePenaltySeconds: 30, wireIndexLabels: false, commAidEnabled: false, commAidBudget: 0 },
  hard: { duration: 240, maxStrikes: 2, moduleCount: 4, timePenaltySeconds: 45, wireIndexLabels: false, commAidEnabled: false, commAidBudget: 0 }
};

function hasCustomDifficultyOverrides(diff) {
  if (!diff || !diff.preset) return false;
  const base = CANONICAL_PRESET_BASELINES[diff.preset];
  if (!base) return true;
  return (
    diff.duration !== base.duration ||
    diff.maxStrikes !== base.maxStrikes ||
    diff.moduleCount !== base.moduleCount ||
    diff.timePenaltySeconds !== base.timePenaltySeconds ||
    Boolean(diff.features?.wireIndexLabels) !== base.wireIndexLabels ||
    Boolean(diff.features?.commAidEnabled) !== base.commAidEnabled ||
    (diff.features?.commAidEnabled && Number(diff.features?.commAidBudget || 0) !== base.commAidBudget)
  );
}

function renderStrikeBoxes(currentStrikes = 0, maxStrikes = 3) {
  if (hudStrikeRatio) {
    hudStrikeRatio.textContent = `${currentStrikes} / ${maxStrikes}`;
  }
  if (!strikeBoxesContainer) return;
  strikeBoxesContainer.innerHTML = '';
  for (let i = 0; i < maxStrikes; i++) {
    const box = document.createElement('div');
    box.className = 'strike-box' + (i < currentStrikes ? ' active' : '');
    box.id = `strike${i + 1}`;
    box.textContent = '✕';
    strikeBoxesContainer.appendChild(box);
  }
}

// --- Quick Camera Views, Tuning Popover & Operator HUD ---
const btnViewFront = document.getElementById('btnViewFront');
const btnViewBack = document.getElementById('btnViewBack');
const btnViewBridge = document.getElementById('btnViewBridge');
const btnResetView = document.getElementById('btnResetView');
const btnToggleTuningPopover = document.getElementById('btnToggleTuningPopover');
const operatorTuningPopover = document.getElementById('operatorTuningPopover');
const btnCloseTuningPopover = document.getElementById('btnCloseTuningPopover');

const manualHybridWorkspace = document.getElementById('manualHybridWorkspace');
const manualDockControls = document.getElementById('manualDockControls');
const manual3dContainer = document.getElementById('manual3dContainer');
const btnManualViewBridge = document.getElementById('btnManualViewBridge');
const btnManualViewObserver = document.getElementById('btnManualViewObserver');
const cameraSensitivity = document.getElementById('cameraSensitivity');
const sensitivityValue = document.getElementById('sensitivityValue');
const holdThresholdControl = document.getElementById('holdThresholdControl');
const holdThresholdSlider = document.getElementById('holdThresholdSlider');
const holdThresholdValue = document.getElementById('holdThresholdValue');
const operatorInteractionHud = document.getElementById('operatorInteractionHud');
const operatorHudModeTag = document.getElementById('operatorHudModeTag');
const operatorHudLabel = document.getElementById('operatorHudLabel');
const operatorHudDetail = document.getElementById('operatorHudDetail');
const operatorHudProgressFill = document.getElementById('operatorHudProgressFill');
const orientationHint = document.getElementById('orientationHint');
const btnCloseOrientationHint = document.getElementById('btnCloseOrientationHint');

let operatorHoldThresholdMs =
  Number(localStorage.getItem('bomb_hold_threshold_ms')) || INTERACTION_DEFAULTS.buttonHoldThresholdMs;
operatorHoldThresholdMs = Math.max(
  INTERACTION_DEFAULTS.minHoldThresholdMs,
  Math.min(INTERACTION_DEFAULTS.maxHoldThresholdMs, operatorHoldThresholdMs)
);

function setTuningPopoverOpen(open) {
  if (!operatorTuningPopover) return;
  operatorTuningPopover.style.display = open ? 'flex' : 'none';
  if (btnToggleTuningPopover) {
    btnToggleTuningPopover.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

if (btnToggleTuningPopover) {
  btnToggleTuningPopover.addEventListener('click', () => {
    const currentlyOpen = operatorTuningPopover?.style.display !== 'none';
    setTuningPopoverOpen(!currentlyOpen);
  });
}

if (btnCloseTuningPopover) {
  btnCloseTuningPopover.addEventListener('click', () => setTuningPopoverOpen(false));
}

if (bomb3dContainer) {
  bomb3dContainer.addEventListener('pointerdown', () => {
    if (operatorTuningPopover && operatorTuningPopover.style.display !== 'none') {
      setTuningPopoverOpen(false);
    }
  });
}

function setActiveBombViewButton(targetBtn) {
  [btnViewFront, btnViewBack, btnViewBridge].forEach((btn) => {
    if (btn) btn.classList.toggle('active', btn === targetBtn);
  });
}

function setActiveManualViewButton(targetBtn) {
  [btnManualViewBridge, btnManualViewObserver].forEach((btn) => {
    if (btn) btn.classList.toggle('active', btn === targetBtn);
  });
}

function renderOperatorHudStatus(status) {
  if (!operatorInteractionHud || !status) return;
  if (operatorHudLabel) operatorHudLabel.textContent = status.label || 'آماده تعامل لمسی';
  if (operatorHudDetail) operatorHudDetail.textContent = status.detail || '';
  if (operatorHudModeTag) {
    const modeMap = {
      hold: 'HOLD فعال',
      tap: 'ضربه TAP',
      wire_hold: 'برش سیم',
      committed: 'ثبت شد',
      cancelled: 'لغو ایمن'
    };
    operatorHudModeTag.textContent = modeMap[status.mode] || 'آماده';
  }
  if (operatorHudProgressFill) {
    const pct = Math.max(0, Math.min(100, Math.round((status.progress || 0) * 100)));
    operatorHudProgressFill.style.width = `${pct}%`;
  }
  operatorInteractionHud.setAttribute('data-variant', status.variant || 'neutral');
}

function sendOperatorBombAction(actionPayload) {
  if (!actionPayload || typeof actionPayload !== 'object') return;
  const enriched = {
    ...actionPayload,
    actionId:
      actionPayload.actionId ||
      `${playerId || 'p'}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    roundSeed: currentGameState?.roundSeed || null,
    clientTimestamp: Date.now()
  };
  transport.send('action', enriched);
}

if (btnViewFront) {
  btnViewFront.addEventListener('click', () => {
    setActiveBombViewButton(btnViewFront);
    if (bombScene) bombScene.viewFront();
  });
}
if (btnViewBack) {
  btnViewBack.addEventListener('click', () => {
    setActiveBombViewButton(btnViewBack);
    if (bombScene) bombScene.viewBack();
  });
}
if (btnViewBridge) {
  btnViewBridge.addEventListener('click', () => {
    setActiveBombViewButton(btnViewBridge);
    if (bombScene) bombScene.viewTertiary();
  });
}
if (btnResetView) {
  btnResetView.addEventListener('click', () => {
    setActiveBombViewButton(btnViewFront);
    if (bombScene) bombScene.resetView();
  });
}

function setManualDockMode(mode) {
  const webglReady = isWebGLAvailable();
  manualDockMode = webglReady ? mode || 'split' : 'sheet';
  if (manualHybridWorkspace) {
    manualHybridWorkspace.setAttribute('data-dock-mode', manualDockMode);
  }
  if (manualDockControls) {
    manualDockControls.style.display = webglReady ? 'flex' : 'none';
    manualDockControls.querySelectorAll('[data-manual-dock]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-manual-dock') === manualDockMode);
    });
  }
  if (manualWorldScene && manualDockMode !== 'sheet') {
    setTimeout(() => manualWorldScene?.resize(), 30);
  }
}

document.querySelectorAll('[data-manual-dock]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const targetMode = btn.getAttribute('data-manual-dock') || 'split';
    setManualDockMode(targetMode);
    if (currentGameState?.status === 'running' && isManual(myRole) && targetMode !== 'sheet') {
      ensureManualWorldScene(currentGameState);
    }
  });
});

if (btnManualViewBridge) {
  btnManualViewBridge.addEventListener('click', () => {
    setActiveManualViewButton(btnManualViewBridge);
    manualWorldScene?.viewFront();
  });
}
if (btnManualViewObserver) {
  btnManualViewObserver.addEventListener('click', () => {
    setActiveManualViewButton(btnManualViewObserver);
    manualWorldScene?.viewBack();
  });
}

function ensureManualWorldScene(state) {
  if (!manual3dContainer || !isWebGLAvailable() || manualDockMode === 'sheet') return;
  if (!manualWorldScene) {
    manualWorldScene = new Bomb3DScene(
      manual3dContainer,
      myRole || 'manual',
      null,
      () => getCurrentRemainingSeconds()
    );
    const savedSens = localStorage.getItem('bomb_camera_sensitivity') || '1.0';
    manualWorldScene.setSensitivity(savedSens);
  }
  manualWorldScene.setRole(myRole || 'manual');
  if (state) {
    manualWorldScene.updateState(state);
  }
  manualWorldScene.resize();
}

if (cameraSensitivity) {
  const savedSens = localStorage.getItem('bomb_camera_sensitivity') || '1.0';
  cameraSensitivity.value = savedSens;
  if (sensitivityValue) sensitivityValue.textContent = `${parseFloat(savedSens).toFixed(1)}x`;

  cameraSensitivity.addEventListener('input', (e) => {
    const val = e.target.value;
    if (sensitivityValue) sensitivityValue.textContent = `${parseFloat(val).toFixed(1)}x`;
    localStorage.setItem('bomb_camera_sensitivity', val);
    if (bombScene) {
      bombScene.setSensitivity(val);
    }
    if (manualWorldScene) {
      manualWorldScene.setSensitivity(val);
    }
  });
}

if (holdThresholdSlider) {
  holdThresholdSlider.value = String(operatorHoldThresholdMs);
  if (holdThresholdValue) holdThresholdValue.textContent = `${operatorHoldThresholdMs}ms`;

  holdThresholdSlider.addEventListener('input', (e) => {
    const nextMs = Math.max(
      INTERACTION_DEFAULTS.minHoldThresholdMs,
      Math.min(
        INTERACTION_DEFAULTS.maxHoldThresholdMs,
        Number(e.target.value) || INTERACTION_DEFAULTS.buttonHoldThresholdMs
      )
    );
    operatorHoldThresholdMs = nextMs;
    if (holdThresholdValue) holdThresholdValue.textContent = `${nextMs}ms`;
    localStorage.setItem('bomb_hold_threshold_ms', String(nextMs));
    if (bombScene) {
      bombScene.setHoldThreshold(nextMs);
    }
  });
}

// Host Custom Seed Toggle & Input Handling
if (btnToggleSeedForm && lobbySeedContainer) {
  btnToggleSeedForm.addEventListener('click', () => {
    isSeedPanelOpen = !isSeedPanelOpen;
    lobbySeedContainer.style.display = isSeedPanelOpen ? 'flex' : 'none';
    if (isSeedPanelOpen) {
      inputCustomSeed?.focus();
    }
  });
}

if (btnApplySeed && inputCustomSeed) {
  const submitCustomSeed = () => {
    const raw = inputCustomSeed.value.trim();
    if (raw) {
      transport.send('set_seed', { seed: raw });
      inputCustomSeed.value = '';
      isSeedPanelOpen = false;
      if (lobbySeedContainer) lobbySeedContainer.style.display = 'none';
    }
  };

  btnApplySeed.addEventListener('click', submitCustomSeed);
  inputCustomSeed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      submitCustomSeed();
    }
  });
}

if (btnCloseOrientationHint) {
  btnCloseOrientationHint.addEventListener('click', () => {
    if (orientationHint) orientationHint.style.display = 'none';
    sessionStorage.setItem('dismissed_orientation_hint', 'true');
  });
}

function updateOrientationHint() {
  if (!orientationHint) return;
  const isPortraitPhone = window.innerHeight > window.innerWidth && window.innerWidth <= 600;
  const dismissed = sessionStorage.getItem('dismissed_orientation_hint') === 'true';
  if (isPortraitPhone && !dismissed && currentGameState?.status === 'running') {
    orientationHint.style.display = 'flex';
  } else {
    orientationHint.style.display = 'none';
  }
}
window.addEventListener('resize', updateOrientationHint);
window.addEventListener('orientationchange', updateOrientationHint);

// Check WebGL availability
if (!isWebGLAvailable()) {
  if (webglErrorBanner) webglErrorBanner.style.display = 'block';
}

// Audio activation (played from Operator's device)
function syncAudioBannerVisibility() {
  if (!audioBanner) return;
  const showForRole = !myRole || isOperator(myRole);
  audioBanner.style.display = !audioUnlocked && showForRole ? 'flex' : 'none';
}

function unlockAudio() {
  audioUnlocked = true;
  sound.init();
  if (isOperator(myRole)) {
    sound.setEnabled(true);
    sound.playClick();
  }
  syncAudioBannerVisibility();
}

if (btnUnlockAudio) {
  btnUnlockAudio.addEventListener('click', unlockAudio);
}
document.addEventListener('touchstart', () => sound.init(), { once: true });
document.addEventListener('mousedown', () => sound.init(), { once: true });

// Easy-Mode 3-Symbol Communication Aid Wiring (Observer <-> Manual-holder bridge)
function sendCommAidSignal(symbolId) {
  if (!symbolId) return;
  const actionId = `${playerId || 'p'}-comm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  transport.send('comm_signal', { symbolId, actionId });
}

document.querySelectorAll('[data-comm-symbol]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const symbolId = btn.getAttribute('data-comm-symbol');
    sendCommAidSignal(symbolId);
  });
});

function flashCommAidWidget(widgetEl) {
  if (!widgetEl) return;
  widgetEl.classList.add('comm-flash');
  setTimeout(() => {
    widgetEl.classList.remove('comm-flash');
  }, 900);
}

function renderCommAidWidgets(state) {
  const commAid = state?.commAid;
  const isRunning = state?.status === 'running';
  const showForObserver = isRunning && isObserver(myRole) && Boolean(commAid?.enabled);
  const showForManual = isRunning && isManual(myRole) && Boolean(commAid?.enabled);

  if (observerCommAidWidget) {
    observerCommAidWidget.style.display = showForObserver ? 'flex' : 'none';
  }
  if (manualCommAidWidget) {
    manualCommAidWidget.style.display = showForManual ? 'flex' : 'none';
  }

  if (!commAid || (!showForObserver && !showForManual)) return;

  const remaining = commAid.remainingUses ?? 0;
  const total = commAid.totalBudget ?? 0;
  const budgetStr = `${remaining} / ${total}`;
  const isExhausted = remaining <= 0;

  let feedbackText = isExhausted
    ? 'سهمیه کمک‌ارتباطی تمام شد؛ با اشاره‌های توافقی ادامه دهید.'
    : 'ارسال فقط در پل ناظر ↔ دفترچه راهنما · هر ارسال ۱ سهمیه';

  if (commAid.lastSignal) {
    const sig = commAid.lastSignal;
    feedbackText = `آخرین پیام (${sig.senderTitle}): «${sig.symbol} ${sig.label}» · باقی‌مانده: ${remaining} از ${total}`;
  }

  [
    { widget: observerCommAidWidget, budgetEl: observerCommAidBudget, fbEl: observerCommAidFeedback },
    { widget: manualCommAidWidget, budgetEl: manualCommAidBudget, fbEl: manualCommAidFeedback }
  ].forEach(({ widget, budgetEl, fbEl }) => {
    if (!widget) return;
    if (budgetEl) {
      budgetEl.textContent = budgetStr;
      budgetEl.classList.toggle('exhausted', isExhausted);
    }
    if (fbEl) {
      fbEl.textContent = feedbackText;
    }
    widget.querySelectorAll('[data-comm-symbol]').forEach((btn) => {
      btn.disabled = isExhausted;
    });
  });
}

// --- Transport Event Listeners ---
transport.onEvent((eventType, data) => {
  if (eventType === '_connection_change') {
    if (data.connected) {
      if (pingDot) pingDot.classList.remove('disconnected');
      if (connStatus) connStatus.textContent = 'متصل به اتاق';
      if (myRole && playerId) {
        transport.send('join', { role: myRole, playerId });
      }
    } else {
      if (pingDot) pingDot.classList.add('disconnected');
      if (connStatus) connStatus.textContent = 'در حال اتصال مجدد...';
    }
    return;
  }

  if (eventType === '_time_synced') {
    // Clock offset is maintained internally by transport.getServerTime() without exposing raw telemetry in UI
    return;
  }

  if (eventType === 'session_replaced') {
    showToast(data.message || 'نشست شما در دستگاه یا تب دیگری فعال شد.', 'error', 5000);
    return;
  }

  if (eventType === 'comm_signal_sent') {
    triggerHaptic([35, 25]);
    if (isObserver(myRole)) flashCommAidWidget(observerCommAidWidget);
    if (isManual(myRole)) flashCommAidWidget(manualCommAidWidget);
    if (data?.signal) {
      showToast(
        `${data.signal.senderTitle}: «${data.signal.symbol} ${data.signal.label}» (باقی‌مانده: ${data.remainingUses} از ${data.totalBudget})`,
        'success',
        2600
      );
    }
    return;
  }

  if (eventType === 'countdown_cancelled') {
    lastCountdownBeepStep = null;
    triggerHaptic([40, 30]);
    showToast(data?.message || 'شمارش معکوس شروع عملیات لغو شد.', 'info', 3000);
    return;
  }

  if (eventType === 'disconnected_role_released') {
    showToast(`نقش «${data?.roleTitle || 'قطع‌شده'}» توسط میزبان آزاد شد.`, 'info', 2600);
    return;
  }

  if (eventType === 'state_update') {
    const prevState = currentGameState;
    currentGameState = data.state;

    // Synchronize local role state with server authoritative role ownership
    let serverAssignedRole = null;
    if (currentGameState.roles) {
      for (const rKey of ['blind', 'deaf', 'mute']) {
        const rInfo = currentGameState.roles[rKey];
        if (rInfo && rInfo.playerId === playerId) {
          serverAssignedRole = rKey;
          break;
        }
      }
    }

    if (serverAssignedRole !== myRole) {
      myRole = serverAssignedRole;
      sessionManager.setRole(myRole);
      if (myRole) {
        renderLobbyPermissionsPanel(toFunctionalRoleKey(myRole));
      }
      if (bombScene) bombScene.setRole(myRole);
    }

    syncAudioBannerVisibility();
    syncScreenWakeLock(currentGameState.status);

    // Device audio output is active only on the Operator's device
    sound.setEnabled(isOperator(myRole));

    // Trigger one-time explosion, defusal, or round-start sounds upon state change
    if (prevState?.status !== 'exploded' && currentGameState.status === 'exploded') {
      if (isOperator(myRole)) sound.playExplosion();
    } else if (prevState?.status !== 'defused' && currentGameState.status === 'defused') {
      if (isOperator(myRole)) sound.playDefused();
    } else if (prevState?.status === 'countdown' && currentGameState.status === 'running') {
      lastCountdownBeepStep = null;
      triggerHaptic([50, 30, 50]);
      if (isOperator(myRole)) sound.playRoundStartTone();
    }

    if (prevState?.status !== 'countdown' && currentGameState.status === 'countdown') {
      lastCountdownBeepStep = null;
      closeQrModal();
      closeReferenceSheet();
      setTuningPopoverOpen(false);
    }

    // Automatically close overlays/sheets when transitioning into an active round
    if (prevState?.status !== 'running' && currentGameState.status === 'running') {
      closeQrModal();
      closeReferenceSheet();
      setTuningPopoverOpen(false);
    }

    lastGameStatus = currentGameState.status;
    renderState(currentGameState);
    return;
  }

  if (eventType === 'role_assigned') {
    myRole = data.role;
    sessionManager.setRole(myRole);
    sound.setEnabled(isOperator(myRole));
    if (isOperator(myRole)) {
      sound.playClick();
    }
    renderLobbyPermissionsPanel(toFunctionalRoleKey(myRole));
    syncAudioBannerVisibility();
    syncChecklistUI();
    if (bombScene) {
      bombScene.setRole(myRole);
    }
    return;
  }

  if (eventType === 'role_released') {
    myRole = null;
    sessionManager.setRole(null);
    sound.setEnabled(false);
    syncAudioBannerVisibility();
    syncChecklistUI();
    return;
  }

  if (eventType === 'strike') {
    if (isOperator(myRole)) {
      sound.playStrike();
    }
    triggerHaptic([120, 60, 120]);
    flashRedAlert();

    const penaltySec = data?.penaltySeconds || 30;
    if (timerPenaltyBadge && penaltySec > 0) {
      timerPenaltyBadge.textContent = `-${penaltySec}s`;
      timerPenaltyBadge.style.display = 'block';
      timerPenaltyBadge.style.animation = 'none';
      void timerPenaltyBadge.offsetHeight;
      timerPenaltyBadge.style.animation = null;
      setTimeout(() => {
        if (timerPenaltyBadge) timerPenaltyBadge.style.display = 'none';
      }, 1600);
    }
    return;
  }

  if (eventType === 'module_solved') {
    if (isOperator(myRole)) {
      sound.playDefused();
    }
    return;
  }

  if (eventType === 'error') {
    if (data.code === 'ROLE_TAKEN') {
      if (myRole && currentGameState?.roles?.[myRole]?.playerId !== playerId) {
        myRole = null;
        sessionManager.setRole(null);
      }
    }
    showToast(data.message || 'خطا در عملیات بازی', 'error');
    return;
  }
});

// --- Role Selection Cards, Offline Slot Release, Ready Toggle & Start Controls ---
['blind', 'deaf', 'mute'].forEach((roleKey) => {
  const card = roleCards[roleKey];
  if (!card) return;

  const selectCardRole = (e) => {
    if (e?.target?.closest?.('[data-open-perm], [data-release-role]')) return;
    sound.init();
    renderLobbyPermissionsPanel(toFunctionalRoleKey(roleKey));
    if (myRole === roleKey) return;

    transport.send('join', {
      role: roleKey,
      playerId
    });
  };

  card.addEventListener('click', selectCardRole);
  card.addEventListener('keydown', (e) => {
    if (e.target?.closest?.('[data-open-perm], [data-release-role]')) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectCardRole(e);
    }
  });

  const releaseBtn = releaseRoleButtons[roleKey];
  if (releaseBtn) {
    releaseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      transport.send('release_disconnected_role', { role: roleKey });
    });
  }
});

if (btnToggleReady) {
  btnToggleReady.addEventListener('click', () => {
    if (!myRole || !currentGameState?.roles) return;
    const myInfo = currentGameState.roles[myRole];
    const currentlyReady = myInfo ? myInfo.ready !== false : true;
    transport.send('set_ready', { ready: !currentlyReady });
  });
}

if (btnLeaveRole) {
  btnLeaveRole.addEventListener('click', () => {
    transport.send('leave');
  });
}

if (btnStartGame) {
  btnStartGame.addEventListener('click', () => {
    unlockAudio();
    transport.send('start_countdown', { countdownSeconds: 3 });
  });
}

if (btnCancelCountdown) {
  btnCancelCountdown.addEventListener('click', () => {
    transport.send('cancel_countdown');
  });
}

if (btnRestartExploded) {
  btnRestartExploded.addEventListener('click', () => {
    transport.send('reset');
  });
}

if (btnRestartDefused) {
  btnRestartDefused.addEventListener('click', () => {
    transport.send('reset');
  });
}

// --- Render State Function ---
function renderState(state) {
  if (!state) return;

  const isHost = state.hostPlayerId === playerId;
  const isLobbyPhase = state.status === 'waiting' || state.status === 'ready';
  const isCountdownPhase = state.status === 'countdown';

  // 1. Viewport Phase & Top Bar vs Active Round HUD
  if (appViewport) {
    appViewport.setAttribute('data-phase', isLobbyPhase || isCountdownPhase ? 'lobby' : 'active');
  }
  if (lobbyTopBar) {
    lobbyTopBar.style.display = isLobbyPhase || isCountdownPhase ? 'flex' : 'none';
  }
  if (activeRoundHud) {
    activeRoundHud.style.display = isLobbyPhase || isCountdownPhase ? 'none' : 'flex';
  }

  // 2. Active Round HUD Metrics & Strict Observer-Only Serial Visibility
  const maxStrikes = state.maxStrikes || 3;
  const defusedCount =
    state.modulesDefusedCount ??
    Object.values(state.modules || {}).filter((m) => m?.solved).length;
  const totalModules = state.totalModulesCount || state.difficulty?.moduleCount || 3;

  renderStrikeBoxes(state.strikes || 0, maxStrikes);
  if (hudDefusedRatio) {
    hudDefusedRatio.textContent = `${defusedCount} / ${totalModules}`;
  }

  if (serialTag && serialValue) {
    if (isObserver(myRole) && state.serialNumber) {
      serialTag.style.display = 'inline-flex';
      serialValue.textContent = state.serialNumber;
    } else {
      serialTag.style.display = 'none';
      serialValue.textContent = '------';
    }
  }

  // 3. Difficulty Preset & Host Controls
  if (state.difficulty) {
    const canChangeDifficulty = isHost && isLobbyPhase;
    const isCustomActive = isCustomDifficultyOpen || hasCustomDifficultyOverrides(state.difficulty);

    if (btnPresetEasy) btnPresetEasy.classList.toggle('active', !isCustomActive && state.difficulty.preset === 'easy');
    if (btnPresetNormal) btnPresetNormal.classList.toggle('active', !isCustomActive && state.difficulty.preset === 'normal');
    if (btnPresetHard) btnPresetHard.classList.toggle('active', !isCustomActive && state.difficulty.preset === 'hard');
    if (btnPresetCustom) btnPresetCustom.classList.toggle('active', isCustomActive);

    [btnPresetEasy, btnPresetNormal, btnPresetHard, btnPresetCustom].forEach((btn) => {
      if (btn) btn.disabled = !canChangeDifficulty;
    });

    if (customOverridesBox) {
      customOverridesBox.style.display = canChangeDifficulty && isCustomActive ? 'flex' : 'none';
    }

    if (difficultyHostNotice) {
      difficultyHostNotice.textContent = isHost
        ? 'شما میزبان هستید · تنظیمات فعال'
        : 'تنظیمات در اختیار میزبان تیم است';
      difficultyHostNotice.classList.toggle('is-host', isHost);
    }

    if (diffChipName) {
      diffChipName.textContent = hasCustomDifficultyOverrides(state.difficulty)
        ? `${state.difficulty.name || 'متوسط'} (سفارشی)`
        : state.difficulty.name || 'متوسط';
    }
    if (diffChipTime) {
      const totalSecs = (state.difficulty.duration || 300) + (state.difficulty.features?.timerGraceSeconds || 0);
      const mins = Math.floor(totalSecs / 60);
      const remSecs = totalSecs % 60;
      diffChipTime.textContent = remSecs > 0 ? `${mins} دقیقه و ${remSecs} ثانیه` : `${mins} دقیقه`;
    }
    if (diffChipStrikes) diffChipStrikes.textContent = `${state.difficulty.maxStrikes || 3} خطا`;
    if (diffChipModules) diffChipModules.textContent = `${state.difficulty.moduleCount || 3} ماژول`;
    if (diffChipPenalty) diffChipPenalty.textContent = `${state.difficulty.timePenaltySeconds ?? 30}- ثانیه`;

    const aidEnabled = Boolean(state.difficulty.features?.commAidEnabled);
    const aidBudget = state.difficulty.features?.commAidBudget || 0;
    if (diffChipCommAid) {
      diffChipCommAid.textContent = aidEnabled && aidBudget > 0 ? `فعال (${aidBudget} سهمیه)` : 'غیرفعال';
    }

    if (overrideDuration && document.activeElement !== overrideDuration) {
      overrideDuration.value = state.difficulty.duration || 300;
    }
    if (overrideStrikes && document.activeElement !== overrideStrikes) {
      overrideStrikes.value = state.difficulty.maxStrikes || 3;
    }
    if (overrideModules && document.activeElement !== overrideModules) {
      overrideModules.value = state.difficulty.moduleCount || 3;
    }
    if (overridePenalty && document.activeElement !== overridePenalty) {
      overridePenalty.value = state.difficulty.timePenaltySeconds ?? 30;
    }
    if (overrideWireIndexLabels) {
      overrideWireIndexLabels.checked = Boolean(state.difficulty.features?.wireIndexLabels);
    }
    if (overrideCommAidEnabled) {
      overrideCommAidEnabled.checked = aidEnabled;
    }
    if (overrideCommAidBudget && document.activeElement !== overrideCommAidBudget) {
      overrideCommAidBudget.value = aidBudget > 0 ? aidBudget : 5;
    }
  }

  // 4. Lobby Seed Display & Host Seed Form Toggle
  if (lobbySeedDisplay) {
    lobbySeedDisplay.textContent = state.roundSeed || '------';
  }
  const canEditSeed = isHost && isLobbyPhase;
  if (btnToggleSeedForm) {
    btnToggleSeedForm.style.display = canEditSeed ? 'inline-flex' : 'none';
  }
  if (!canEditSeed) {
    isSeedPanelOpen = false;
  }
  if (lobbySeedContainer) {
    lobbySeedContainer.style.display = canEditSeed && isSeedPanelOpen ? 'flex' : 'none';
  }
  if (hostSeedControls) {
    hostSeedControls.style.display = canEditSeed ? 'flex' : 'none';
  }

  // 5. Role Selection Cards & Squad Readiness Strip
  const missingRoleTitles = [];
  const disconnectedRoleTitles = [];
  const unreadyRoleTitles = [];
  let readyPlayersCount = 0;

  if (state.roles) {
    ['blind', 'deaf', 'mute'].forEach((rKey) => {
      const rInfo = state.roles[rKey];
      const card = roleCards[rKey];
      const badge = roleBadges[rKey];
      const slotMeta = slotIndicators[rKey];
      if (!card || !badge || !rInfo) return;

      const isMine = rInfo.playerId === playerId;
      const isRoleHost = Boolean(rInfo.playerId && rInfo.playerId === state.hostPlayerId);
      const hostSuffix = isRoleHost ? ' · میزبان' : '';
      const isPlayerReady = Boolean(rInfo.connected && rInfo.ready !== false);

      if (isPlayerReady) {
        readyPlayersCount += 1;
      }

      card.classList.toggle('selected', isMine);

      const releaseBtn = releaseRoleButtons[rKey];
      const canHostReleaseOffline = Boolean(isLobbyPhase && isHost && rInfo.playerId && !rInfo.connected && !isMine);
      if (releaseBtn) {
        releaseBtn.style.display = canHostReleaseOffline ? 'inline-flex' : 'none';
      }

      if (rInfo.connected) {
        card.classList.add('taken');
        if (isPlayerReady) {
          card.setAttribute('data-slot-state', isMine ? 'selected' : 'occupied-ready');
          badge.className = 'role-status-badge ready';
          badge.textContent = isMine ? `شما · آماده${hostSuffix}` : `آماده${hostSuffix}`;
          if (slotMeta?.el) {
            slotMeta.el.textContent = `${slotMeta.shortTitle}: آماده`;
            slotMeta.el.setAttribute('data-ready', 'true');
          }
        } else {
          unreadyRoleTitles.push(slotMeta.shortTitle);
          card.setAttribute('data-slot-state', isMine ? 'selected' : 'occupied-waiting');
          badge.className = 'role-status-badge waiting';
          badge.textContent = isMine ? `شما · در انتظار تایید${hostSuffix}` : `متصل · منتظر تایید${hostSuffix}`;
          if (slotMeta?.el) {
            slotMeta.el.textContent = `${slotMeta.shortTitle}: منتظر تایید`;
            slotMeta.el.setAttribute('data-ready', 'waiting');
          }
        }
      } else if (rInfo.playerId) {
        disconnectedRoleTitles.push(slotMeta.shortTitle);
        card.classList.add('taken');
        card.setAttribute('data-slot-state', isMine ? 'selected' : 'offline');
        badge.className = 'role-status-badge offline';
        badge.textContent = isMine ? `شما · قطع ارتباط${hostSuffix}` : `قطع ارتباط${hostSuffix}`;
        if (slotMeta?.el) {
          slotMeta.el.textContent = `${slotMeta.shortTitle}: قطع ارتباط`;
          slotMeta.el.setAttribute('data-ready', 'offline');
        }
      } else {
        missingRoleTitles.push(slotMeta.shortTitle);
        card.classList.remove('taken');
        card.setAttribute('data-slot-state', 'available');
        badge.className = 'role-status-badge';
        badge.textContent = 'آزاد — انتخاب کنید';
        if (slotMeta?.el) {
          slotMeta.el.textContent = `${slotMeta.shortTitle}: خالی`;
          slotMeta.el.setAttribute('data-ready', 'false');
        }
      }
    });
  }

  if (squadReadyRatio) {
    squadReadyRatio.textContent = `${readyPlayersCount} / 3`;
  }

  // Secondary Role Actions (Ready Toggle + Leave Role)
  if (myRoleActionRow) {
    myRoleActionRow.style.display = myRole && isLobbyPhase ? 'flex' : 'none';
  }
  if (myRole && state.roles?.[myRole] && btnToggleReady && btnToggleReadyText) {
    const amIReady = state.roles[myRole].ready !== false;
    btnToggleReady.classList.toggle('ready-active', amIReady);
    btnToggleReadyText.textContent = amIReady ? 'آماده‌ام ✓' : 'اعلام آمادگی برای شروع';
  }

  syncChecklistUI(state);
  syncAudioBannerVisibility();
  renderCommAidWidgets(state);

  // 6. Start Button Readiness & Clear Blocker Reason
  if (btnStartGame) {
    const isTeamReady = state.status === 'ready';
    const labelTarget = btnStartGameLabel || btnStartGame;

    if (isTeamReady) {
      if (isHost) {
        btnStartGame.disabled = false;
        labelTarget.textContent = 'شروع عملیات خنثی‌سازی';
        if (startBlockerReason) {
          startBlockerReason.textContent = 'هر ۳ بازیکن آماده هستند. با زدن شروع، شمارش معکوس ۳ ثانیه‌ای آماده‌باش آغاز می‌شود.';
          startBlockerReason.classList.add('ready-ok');
        }
      } else {
        btnStartGame.disabled = true;
        labelTarget.textContent = 'منتظر شروع عملیات توسط میزبان';
        if (startBlockerReason) {
          startBlockerReason.textContent = 'هر ۳ بازیکن آماده هستند؛ منتظر فرمان شروع میزبان باشید.';
          startBlockerReason.classList.add('ready-ok');
        }
      }
    } else if (state.status === 'waiting') {
      btnStartGame.disabled = true;
      labelTarget.textContent = 'شروع عملیات خنثی‌سازی';
      if (startBlockerReason) {
        startBlockerReason.classList.remove('ready-ok');
        if (missingRoleTitles.length > 0) {
          startBlockerReason.textContent = `برای شروع عملیات، انتخاب نقش‌های خالی الزامی است: ${missingRoleTitles.join('، ')}.`;
        } else if (disconnectedRoleTitles.length > 0) {
          startBlockerReason.textContent = isHost
            ? `ارتباط نقش «${disconnectedRoleTitles.join('، ')}» قطع شده است؛ منتظر بازگشت بمانید یا دکمه «آزادسازی نقش» را روی کارت بزنید.`
            : `ارتباط بازیکن نقش «${disconnectedRoleTitles.join('، ')}» قطع شده است؛ منتظر اتصال مجدد باشید.`;
        } else if (unreadyRoleTitles.length > 0) {
          startBlockerReason.textContent = `منتظر تایید آمادگی بازیکن نقش «${unreadyRoleTitles.join('، ')}» هستیم.`;
        } else {
          startBlockerReason.textContent = 'برای شروع عملیات، هر ۳ بازیکن باید متصل و آماده باشند.';
        }
      }
    } else if (state.status === 'countdown') {
      btnStartGame.disabled = true;
      labelTarget.textContent = 'شمارش معکوس آماده‌باش...';
    } else {
      btnStartGame.disabled = true;
      labelTarget.textContent = 'عملیات در جریان است';
    }
  }

  // 7. Pre-Start Countdown Curtain & Endgame Debrief Overlays Management
  if (overlayCountdown) {
    overlayCountdown.classList.toggle('active', state.status === 'countdown');
  }
  overlayExploded.classList.remove('active');
  overlayDefused.classList.remove('active');

  if (state.status === 'countdown') {
    renderCountdownCurtainRolePrep(myRole);
    if (btnCancelCountdown) {
      const canCancel = Boolean(myRole || isHost);
      btnCancelCountdown.style.display = canCancel ? 'inline-flex' : 'none';
    }
    [lobbySection, bomb3dSection, muteSection].forEach((sec) => sec.classList.remove('active'));
    lobbySection.classList.add('active');
    return;
  }

  const formattedRemaining = formatTime(Math.max(0, state.remainingSeconds ?? 0));
  const strikeSummary = `${state.strikes || 0} / ${maxStrikes}`;
  const moduleSummary = `${defusedCount} / ${totalModules}`;

  if (state.status === 'exploded') {
    overlayExploded.classList.add('active');
    if (state.endReason === 'time_out') {
      explodeReason.textContent = 'زمان شمارش معکوس بمب به پایان رسید.';
    } else if (state.endReason === 'max_strikes') {
      explodeReason.textContent = `تعداد خطاهای تیم به سقف مجاز (${maxStrikes}) رسید و چاشنی فعال شد.`;
    } else {
      explodeReason.textContent = 'عملیات خنثی‌سازی ناموفق بود و بمب منفجر شد.';
    }
    if (explodedTimeStat) explodedTimeStat.textContent = formattedRemaining;
    if (explodedStrikesStat) explodedStrikesStat.textContent = strikeSummary;
    if (explodedModulesStat) explodedModulesStat.textContent = moduleSummary;

    if (btnRestartExploded) {
      btnRestartExploded.disabled = !isHost;
      btnRestartExploded.textContent = isHost
        ? 'بازگشت به لابی و تلاش دوباره'
        : 'منتظر بازگشت به لابی توسط میزبان...';
    }
    return;
  }

  if (state.status === 'defused') {
    overlayDefused.classList.add('active');
    defusedStats.textContent = `همه ماژول‌ها با ${state.strikes || 0} خطا و با ${formattedRemaining} زمان ذخیره خنثی شدند.`;
    if (defusedTimeStat) defusedTimeStat.textContent = formattedRemaining;
    if (defusedStrikesStat) defusedStrikesStat.textContent = strikeSummary;
    if (defusedModulesStat) defusedModulesStat.textContent = moduleSummary;

    if (btnRestartDefused) {
      btnRestartDefused.disabled = !isHost;
      btnRestartDefused.textContent = isHost
        ? 'بازگشت به لابی · دور جدید'
        : 'منتظر شروع دور جدید توسط میزبان...';
    }
    return;
  }

  // 8. Active View Router
  [lobbySection, bomb3dSection, muteSection].forEach((sec) => sec.classList.remove('active'));

  if (state.status === 'running') {
    if (isOperator(myRole) || isObserver(myRole)) {
      bomb3dSection.classList.add('active');

      if (!bombScene && bomb3dContainer && isWebGLAvailable()) {
        bombScene = new Bomb3DScene(
          bomb3dContainer,
          myRole,
          (event, payload) => {
            if (event === 'action') {
              sendOperatorBombAction(payload);
            } else {
              transport.send(event, payload);
            }
          },
          () => getCurrentRemainingSeconds(),
          {
            holdThresholdMs: operatorHoldThresholdMs,
            onInteractionStatus: (status) => renderOperatorHudStatus(status)
          }
        );
        const savedSens = localStorage.getItem('bomb_camera_sensitivity') || '1.0';
        bombScene.setSensitivity(savedSens);
      }

      if (bombScene) {
        bombScene.setRole(myRole);
        bombScene.setHoldThreshold(operatorHoldThresholdMs);
        bombScene.updateState(state);
        bombScene.resize();
      }

      if (isOperator(myRole)) {
        if (bomb3dRoleBanner) {
          bomb3dRoleBanner.textContent = 'اپراتور: تنها لمس‌کننده بمب سه‌بعدی مونوکروم · بدون کلام · فرامین را شفاهاً از ناظر دریافت کنید.';
        }
        if (btnViewFront) btnViewFront.textContent = 'پنل ماژول‌ها';
        if (btnViewBack) btnViewBack.textContent = 'نمای کلی میز';
        if (btnViewBridge) btnViewBridge.style.display = 'none';
        if (holdThresholdControl) holdThresholdControl.style.display = 'flex';
        if (operatorInteractionHud) operatorInteractionHud.style.display = 'flex';
        if (bombInRoundPermissions) bombInRoundPermissions.innerHTML = buildPermissionsHtml('operator');
      } else {
        if (bomb3dRoleBanner) {
          bomb3dRoleBanner.textContent = 'ناظر: مشاهده رنگ و شکل داخل کیف و پلاک سریال · بدون لمس بمب · تنها گوینده تیم و پل اشاره با راهنما.';
        }
        if (btnViewFront) btnViewFront.textContent = 'سرنخ‌های کیف';
        if (btnViewBack) btnViewBack.textContent = 'پلاک سریال';
        if (btnViewBridge) btnViewBridge.style.display = 'inline-flex';
        if (holdThresholdControl) holdThresholdControl.style.display = 'none';
        if (operatorInteractionHud) operatorInteractionHud.style.display = 'none';
        if (bombInRoundPermissions) bombInRoundPermissions.innerHTML = buildPermissionsHtml('observer');
      }
    } else if (isManual(myRole)) {
      muteSection.classList.add('active');
      if (manualInRoundPermissions) manualInRoundPermissions.innerHTML = buildPermissionsHtml('manual');
      setManualDockMode(manualDockMode);
      ensureManualWorldScene(state);
      renderDynamicManual(state.roundManual, state);
    } else {
      lobbySection.classList.add('active');
    }
  } else {
    lobbySection.classList.add('active');
  }

  updateOrientationHint();
}

// Window resize handler for 3D canvases
window.addEventListener('resize', () => {
  if (bombScene) {
    bombScene.resize();
  }
  if (manualWorldScene) {
    manualWorldScene.resize();
  }
});

// --- Synchronized Timer Calculation & Progressive Urgency ---
function getCurrentRemainingSeconds() {
  if (!currentGameState || currentGameState.status !== 'running') {
    return currentGameState?.remainingSeconds ?? 300;
  }
  const serverNow = transport.getServerTime();
  const elapsed = (serverNow - currentGameState.startTime) / 1000;
  return Math.max(0, currentGameState.duration - elapsed);
}

function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const URGENCY_ICONS = {
  normal: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="13" r="8"></circle><polyline points="12 9 12 13 14.5 14.5"></polyline><line x1="9" y1="2" x2="15" y2="2"></line></svg>`,
  warn: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
  critical: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`
};

function updateTimerUrgencyUI(level) {
  if (level === lastUrgencyLevel) return;
  lastUrgencyLevel = level;
  if (hudTimerCluster) {
    hudTimerCluster.setAttribute('data-urgency', level);
  }
  if (timerUrgencyIcon && URGENCY_ICONS[level]) {
    timerUrgencyIcon.innerHTML = URGENCY_ICONS[level];
  }
}

setInterval(() => {
  if (!currentGameState) return;

  // Synchronized 3-second pre-start readiness countdown loop
  if (currentGameState.status === 'countdown' && currentGameState.countdownEndsAt) {
    const serverNow = transport.getServerTime();
    const totalMs = currentGameState.countdownDurationMs || 3000;
    const remMs = Math.max(0, currentGameState.countdownEndsAt - serverNow);
    const step = Math.max(1, Math.min(9, Math.ceil(remMs / 1000)));
    const pct = Math.max(0, Math.min(100, (remMs / totalMs) * 100));

    if (countdownDigitDisplay) {
      countdownDigitDisplay.textContent = String(step);
    }
    if (countdownProgressFill) {
      countdownProgressFill.style.width = `${pct.toFixed(1)}%`;
    }

    if (remMs > 0 && step !== lastCountdownBeepStep) {
      lastCountdownBeepStep = step;
      triggerHaptic(25);
      if (isOperator(myRole)) {
        sound.playCountdownBeep(step);
      }
    }
    return;
  }

  const remaining = getCurrentRemainingSeconds();
  if (timerDisplay) {
    timerDisplay.textContent = formatTime(remaining);
  }

  if (currentGameState.status === 'running') {
    if (remaining <= 20) {
      timerDisplay?.classList.add('urgent');
      updateTimerUrgencyUI('critical');
    } else if (remaining <= 60) {
      timerDisplay?.classList.remove('urgent');
      updateTimerUrgencyUI('warn');
    } else {
      timerDisplay?.classList.remove('urgent');
      updateTimerUrgencyUI('normal');
    }

    // Audio ticking played on Operator's device
    const currentSec = Math.floor(remaining);
    if (currentSec !== lastTickSecond) {
      lastTickSecond = currentSec;
      if (isOperator(myRole)) {
        if (remaining <= 30) {
          sound.playUrgentBeep();
        } else {
          sound.playTick(remaining <= 60 ? 1200 : 900);
        }
      }
    }
  } else {
    timerDisplay?.classList.remove('urgent');
    updateTimerUrgencyUI('normal');
  }
}, 100);

// Helper: Device Vibration
function triggerHaptic(pattern) {
  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {}
  }
}

// Helper: Visual HUD alert on strike
function flashRedAlert() {
  if (activeRoundHud) {
    activeRoundHud.classList.add('strike-alert-flash');
    setTimeout(() => {
      activeRoundHud.classList.remove('strike-alert-flash');
    }, 420);
  }
}

// --- Keyboard Navigation & Accessibility Controls ---
let isSpacePressed = false;
let spacePressStartTime = 0;
let spaceHoldReached = false;
let spaceProgressTimer = null;
let isWKeyActive = false;
const keyboardSlotLockMap = new Map();

function cancelKeyboardSpaceHold(reasonText = 'نگه‌داشتن کلید Space بدون ثبت خطا لغو شد.') {
  if (!isSpacePressed) return;
  isSpacePressed = false;
  spaceHoldReached = false;
  if (spaceProgressTimer) {
    clearInterval(spaceProgressTimer);
    spaceProgressTimer = null;
  }
  bombScene?.setKeyboardButtonReticle?.(false, false);
  const btnView = bombScene?.moduleViews?.get('button');
  if (btnView?.moduleDef?.onVisualState) {
    btnView.moduleDef.onVisualState(
      btnView.group,
      { state: 'cancelled', progress: 0 },
      myRole,
      currentGameState?.modules?.button
    );
  }
  renderOperatorHudStatus({
    active: false,
    mode: 'cancelled',
    label: 'لغو ایمن دکمه (Space)',
    detail: reasonText,
    progress: 0,
    variant: 'neutral'
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isQrModalOpen()) {
      e.preventDefault();
      closeQrModal();
      return;
    }
    if (isReferenceSheetOpen()) {
      e.preventDefault();
      closeReferenceSheet();
      return;
    }
    if (currentGameState?.status === 'countdown') {
      e.preventDefault();
      transport.send('cancel_countdown');
      return;
    }
    if (operatorTuningPopover && operatorTuningPopover.style.display !== 'none') {
      e.preventDefault();
      setTuningPopoverOpen(false);
      return;
    }
    cancelKeyboardSpaceHold('لغو دستی با کلید Escape — هیچ خطایی ثبت نشد.');
    bombScene?.cancelActiveInteraction('escape_key');
    return;
  }

  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (isQrModalOpen() || isReferenceSheetOpen() || currentGameState?.status === 'countdown') return;

  if (currentGameState?.status === 'running') {
    if (bombScene) {
      if (e.key === 'ArrowLeft') {
        bombScene.targetRotY += 0.25;
        e.preventDefault();
      } else if (e.key === 'ArrowRight') {
        bombScene.targetRotY -= 0.25;
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        bombScene.targetRotX = Math.min(1.4, bombScene.targetRotX + 0.18);
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        bombScene.targetRotX = Math.max(-1.4, bombScene.targetRotX - 0.18);
        e.preventDefault();
      } else if (e.key === 'r' || e.key === 'R') {
        setActiveBombViewButton(btnViewFront);
        bombScene.viewFront();
      } else if (e.key === 'b' || e.key === 'B') {
        setActiveBombViewButton(btnViewBack);
        bombScene.viewBack();
      }
    }

    // Operator physical interactions via keyboard (ignore key auto-repeat)
    if (isOperator(myRole)) {
      if (e.key === 'w' || e.key === 'W') {
        isWKeyActive = true;
      }

      if (['1', '2', '3', '4'].includes(e.key) && !e.repeat) {
        const index = parseInt(e.key, 10) - 1;
        const now = Date.now();
        const lockKey = isWKeyActive ? `wire:${index}` : `keypad:${index}`;
        const lockedUntil = keyboardSlotLockMap.get(lockKey) || 0;
        if (now < lockedUntil) return;
        keyboardSlotLockMap.set(lockKey, now + INTERACTION_DEFAULTS.keypadDedupeLockMs);

        if (isWKeyActive) {
          if (
            currentGameState?.modules?.wires &&
            !currentGameState.modules.wires.solved &&
            !currentGameState.modules.wires.cutWires?.includes(index)
          ) {
            triggerHaptic([35, 25]);
            sound.playWireCut();
            sendOperatorBombAction({
              moduleId: 'wires',
              action: 'cut',
              data: { wireIndex: index }
            });
            renderOperatorHudStatus({
              active: false,
              mode: 'committed',
              label: `سیم ${index + 1} قطع شد (کیبورد)`,
              detail: 'فرمان قطع سیم به سرور ارسال شد.',
              progress: 1,
              variant: 'success'
            });
          }
        } else if (
          currentGameState?.modules?.keypad &&
          !currentGameState.modules.keypad.solved &&
          !currentGameState.modules.keypad.enteredSlots?.includes(index)
        ) {
          triggerHaptic(25);
          sound.playClick();
          sendOperatorBombAction({
            moduleId: 'keypad',
            action: 'press',
            data: { slotIndex: index }
          });
          renderOperatorHudStatus({
            active: false,
            mode: 'committed',
            label: `کلید کیپد ${index + 1} ثبت شد`,
            detail: `فشردن کلید شماره ${index + 1} ارسال شد.`,
            progress: 1,
            variant: 'success'
          });
        }
      }

      if ((e.key === 'c' || e.key === 'C') && !e.repeat) {
        const beaconState = currentGameState?.modules?.beacon;
        if (beaconState && !beaconState.solved) {
          const curr = beaconState.tunedChannel || 1;
          const nextChannel = (curr % 3) + 1;
          triggerHaptic(25);
          sound.playClick();
          sendOperatorBombAction({
            moduleId: 'beacon',
            action: 'tune',
            data: { channel: nextChannel }
          });
          renderOperatorHudStatus({
            active: false,
            mode: 'committed',
            label: `فانوس روی کانال ${nextChannel} تنظیم شد`,
            detail: 'تغییر کانال سلکتور ثبت گردید.',
            progress: 1,
            variant: 'success'
          });
        }
      }

      if ((e.key === 't' || e.key === 'T') && !e.repeat) {
        const beaconState = currentGameState?.modules?.beacon;
        if (beaconState && !beaconState.solved) {
          triggerHaptic([30, 20]);
          sound.playClick();
          sendOperatorBombAction({
            moduleId: 'beacon',
            action: 'transmit'
          });
          renderOperatorHudStatus({
            active: false,
            mode: 'committed',
            label: 'ارسال فرکانس (TX) ثبت شد',
            detail: 'پالس فرکانسی به سرور ارسال شد.',
            progress: 1,
            variant: 'success'
          });
        }
      }

      if (e.code === 'Space' && !isSpacePressed && !e.repeat) {
        e.preventDefault();
        if (currentGameState?.modules?.button?.solved) return;

        isSpacePressed = true;
        spaceHoldReached = false;
        spacePressStartTime = Date.now();
        triggerHaptic(25);
        sound.playTactileTick();

        const btnView = bombScene?.moduleViews?.get('button');
        const updateSpaceVisuals = () => {
          if (!isSpacePressed) return;
          const elapsed = Date.now() - spacePressStartTime;
          const progress = Math.min(1, elapsed / operatorHoldThresholdMs);
          const digit = Math.floor(Math.max(0, getCurrentRemainingSeconds())) % 10;

          if (elapsed >= operatorHoldThresholdMs) {
            if (!spaceHoldReached) {
              spaceHoldReached = true;
              triggerHaptic([40, 30, 40]);
              sound.playTactileTick();
            }
            bombScene?.setKeyboardButtonReticle?.(true, true);
            btnView?.moduleDef?.onVisualState?.(
              btnView.group,
              { state: 'holding', mode: 'hold', progress: 1, lastTimerDigit: digit },
              myRole,
              currentGameState?.modules?.button
            );
            renderOperatorHudStatus({
              active: true,
              mode: 'hold',
              label: `نگه‌داشتن فعال شد (HOLD) · رقم فعلی ثانیه: ${digit}`,
              detail: 'روی رقم ثانیه اعلامی ناظر کلید Space را رها کنید (Esc = لغو ایمن).',
              progress: 1,
              variant: 'hold'
            });
          } else {
            bombScene?.setKeyboardButtonReticle?.(true, false);
            btnView?.moduleDef?.onVisualState?.(
              btnView.group,
              { state: 'pressing', mode: 'tap', progress, lastTimerDigit: digit },
              myRole,
              currentGameState?.modules?.button
            );
            renderOperatorHudStatus({
              active: true,
              mode: 'tap',
              label: `حالت ضربه کوتاه (TAP) — ${Math.round(progress * 100)}% تا HOLD`,
              detail: `رهاسازی الان = ضربه کوتاه | ادامه نگه‌داشتن (${operatorHoldThresholdMs}ms) = حالت HOLD`,
              progress,
              variant: 'info'
            });
          }
        };

        updateSpaceVisuals();
        spaceProgressTimer = setInterval(updateSpaceVisuals, 45);
      }
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'w' || e.key === 'W') {
    isWKeyActive = false;
  }

  if (e.code === 'Space' && isSpacePressed && isOperator(myRole)) {
    e.preventDefault();
    isSpacePressed = false;
    if (spaceProgressTimer) {
      clearInterval(spaceProgressTimer);
      spaceProgressTimer = null;
    }
    bombScene?.setKeyboardButtonReticle?.(false, false);

    const duration = Date.now() - spacePressStartTime;
    const isHold = spaceHoldReached || duration >= operatorHoldThresholdMs;
    spaceHoldReached = false;
    const lastDigit = Math.floor(Math.max(0, getCurrentRemainingSeconds())) % 10;

    const btnView = bombScene?.moduleViews?.get('button');
    btnView?.moduleDef?.onVisualState?.(
      btnView.group,
      { state: 'committed', mode: isHold ? 'hold_release' : 'tap', progress: 1, lastTimerDigit: lastDigit },
      myRole,
      currentGameState?.modules?.button
    );

    if (!isHold) {
      triggerHaptic(35);
      sound.playClick();
      sendOperatorBombAction({
        moduleId: 'button',
        action: 'press'
      });
      renderOperatorHudStatus({
        active: false,
        mode: 'committed',
        label: 'ضربه کوتاه (TAP) روی دکمه ثبت شد',
        detail: `مدت فشردن: ${duration}ms (کمتر از آستانه ${operatorHoldThresholdMs}ms)`,
        progress: 1,
        variant: 'success'
      });
    } else {
      triggerHaptic([40, 30, 40]);
      sound.playClick();
      sendOperatorBombAction({
        moduleId: 'button',
        action: 'release',
        data: { releaseDigit: lastDigit }
      });
      renderOperatorHudStatus({
        active: false,
        mode: 'committed',
        label: `رهاسازی دکمه (HOLD) روی رقم ${lastDigit} ثبت شد`,
        detail: `مدت نگه‌داشتن: ${duration}ms · رقم ثانیه ارسالی: ${lastDigit}`,
        progress: 1,
        variant: 'success'
      });
    }
  }
});

window.addEventListener('blur', () => {
  cancelKeyboardSpaceHold('خروج تمرکز از پنجره — نگه‌داشتن Space بدون خطا لغو شد.');
  isWKeyActive = false;
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelKeyboardSpaceHold('تغییر تب مرورگر — نگه‌داشتن Space بدون خطا لغو شد.');
    isWKeyActive = false;
  }
});

// --- Dynamic Tactical Field Manual Renderer for Manual-holder Role ---
let currentManualFilter = 'all';
let currentBeaconParity = 'all';

function renderDynamicManual(manual, state) {
  if (!muteManualContainer) return;
  if (!manual) {
    muteManualContainer.innerHTML = `
      <div class="manual-section manual-loading-placeholder">
        در انتظار دریافت پروتکل‌های اختصاصی این راند...
      </div>
    `;
    return;
  }

  const { seed, button, wires, keypad, beacon } = manual;

  // 1. Live Operational Threat Matrix (Unboxed Metadata — Zero Pills)
  const modulesDefused =
    state?.modulesDefusedCount ??
    Object.values(state?.modules || {}).filter((m) => m?.solved).length;
  const totalModules = state?.totalModulesCount || 4;
  const remainingModules = Math.max(0, totalModules - modulesDefused);

  let threatPhaseText = `وضعیت عملیات: ${remainingModules} از ${totalModules} ماژول مسلح است`;
  if (remainingModules === 0) {
    threatPhaseText = 'تمام ماژول‌های این راند خنثی شدند';
  } else if (remainingModules === 1) {
    threatPhaseText = 'مرحله پایانی: تنها ۱ ماژول مسلح باقی مانده است';
  }

  const activeModuleIds = state?.moduleIds || ['wires', 'button', 'keypad', 'beacon'];
  const moduleMetaList = [
    { id: 'button', label: 'دکمه کاتالیزور', solved: Boolean(state?.modules?.button?.solved) },
    { id: 'wires', label: 'فیوزهای سیم‌کشی', solved: Boolean(state?.modules?.wires?.solved) },
    { id: 'keypad', label: 'صفحه‌کلید رمزی', solved: Boolean(state?.modules?.keypad?.solved) },
    { id: 'beacon', label: 'فانوس صوتی', solved: Boolean(state?.modules?.beacon?.solved) }
  ].filter((m) => activeModuleIds.includes(m.id));

  const stepsHtml = Array.from(
    { length: totalModules },
    (_, i) => `<div class="threat-step ${i < modulesDefused ? 'defused' : ''}"></div>`
  ).join('');

  const statusLineHtml = moduleMetaList
    .map(
      (m) => `
      <span class="manual-mod-stat ${m.solved ? 'is-solved' : 'is-armed'}">
        ${m.solved ? '✓' : '●'} ${m.label}: <strong>${m.solved ? 'خنثی' : 'مسلح'}</strong>
      </span>
    `
    )
    .join('<span class="meta-sep" aria-hidden="true">·</span>');

  const matrixHtml = `
    <div class="threat-matrix-card" id="manual-matrix">
      <div class="threat-matrix-header">
        <span class="threat-phase-title">${threatPhaseText}</span>
        <span class="manual-seed-tag" dir="ltr">CODE: ${seed || '------'}</span>
      </div>
      <div class="threat-progress-bar">
        ${stepsHtml}
      </div>
      <div class="manual-modules-strip">
        ${statusLineHtml}
      </div>
    </div>
  `;

  // 2. Segmented Module Filter Bar
  const tabDefs = [
    { id: 'all', label: 'همه پروتکل‌ها', show: true },
    { id: 'button', label: 'دکمه', show: activeModuleIds.includes('button'), solved: Boolean(state?.modules?.button?.solved) },
    { id: 'wires', label: 'سیم‌ها', show: activeModuleIds.includes('wires'), solved: Boolean(state?.modules?.wires?.solved) },
    { id: 'keypad', label: 'کیپد', show: activeModuleIds.includes('keypad'), solved: Boolean(state?.modules?.keypad?.solved) },
    { id: 'beacon', label: 'فانوس صوتی', show: activeModuleIds.includes('beacon'), solved: Boolean(state?.modules?.beacon?.solved) }
  ].filter((t) => t.show);

  if (!tabDefs.some((t) => t.id === currentManualFilter)) {
    currentManualFilter = 'all';
  }

  const navTabsHtml = `
    <div class="manual-nav-tabs" role="tablist" aria-label="فیلتر بخش‌های دفترچه">
      ${tabDefs
        .map(
          (t) => `
        <button type="button" class="manual-tab-btn ${currentManualFilter === t.id ? 'active' : ''}" data-filter="${t.id}">
          ${t.solved ? '✓ ' : ''}${t.label}
        </button>
      `
        )
        .join('')}
    </div>
  `;

  // 3. Button Module Section
  let buttonHtml = '';
  if (button && activeModuleIds.includes('button') && (currentManualFilter === 'all' || currentManualFilter === 'button')) {
    const tapRows = (button.tapRows || [])
      .map(
        (r) => `
      <tr>
        <td>${r.condition}</td>
        <td><strong>${r.action}</strong></td>
      </tr>
    `
      )
      .join('');

    const stripRows = (button.stripRows || [])
      .map(
        (r) => `
      <li>نوار کناری <strong>${r.colorName}</strong>: رهاسازی وقتی رقم یکان ثانیه برابر <strong class="tabular-num" dir="ltr">${r.digit}</strong> است (با اشاره به ناظر اعلام کنید).</li>
    `
      )
      .join('');

    buttonHtml = `
      <div class="manual-section" id="manual-button">
        <div class="manual-section-head">
          <h4>۰۱. ماژول دکمه کاتالیزور</h4>
          <span class="manual-protocol-code">${button.protocolName || ''}</span>
        </div>
        <table class="rule-table">
          <thead>
            <tr>
              <th>شرط رنگ و شکل دکمه / سریال (گزارش ناظر)</th>
              <th>اقدام لازم (اعلام با اشاره به ناظر)</th>
            </tr>
          </thead>
          <tbody>
            ${tapRows}
            <tr>
              <td>${button.otherRow?.condition || 'سایر حالات دکمه'}</td>
              <td><strong>${button.otherRow?.action || 'دکمه را نگه‌دار تا ناظر رنگ نوار کناری را ببیند'}</strong></td>
            </tr>
          </tbody>
        </table>

        <div class="manual-sub-box">
          <strong>جدول رقم ثانیه رهاسازی در حالت نگه‌داشتن (HOLD):</strong>
          <ul class="manual-checklist" style="margin-top: 6px;">
            ${stripRows}
          </ul>
        </div>
        <p class="manual-note">${button.note || ''}</p>
      </div>
    `;
  }

  // 4. Wires Module Section
  let wiresHtml = '';
  if (wires && activeModuleIds.includes('wires') && (currentManualFilter === 'all' || currentManualFilter === 'wires')) {
    const steps = (wires.checklist || [])
      .map(
        (item) => `
      <li>${item.condition} <strong>${item.action}</strong> بریده شود (شماره سیم را با اشاره به ناظر نشان دهید).</li>
    `
      )
      .join('');

    wiresHtml = `
      <div class="manual-section" id="manual-wires">
        <div class="manual-section-head">
          <h4>۰۲. ماژول فیوزهای سیم‌کشی</h4>
          <span class="manual-protocol-code">${wires.protocolName || ''}</span>
        </div>
        <ol class="manual-checklist">
          ${steps}
        </ol>
        <p class="manual-note">${wires.note || ''}</p>
      </div>
    `;
  }

  // 5. Keypad Module Section
  let keypadHtml = '';
  if (keypad && activeModuleIds.includes('keypad') && (currentManualFilter === 'all' || currentManualFilter === 'keypad')) {
    keypadHtml = `
      <div class="manual-section" id="manual-keypad">
        <div class="manual-section-head">
          <h4>۰۳. ماژول نمادهای صفحه‌کلید</h4>
          <span class="manual-protocol-code">${keypad.protocolName || ''}</span>
        </div>
        <p style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 10px;">
          ${keypad.note || ''}
        </p>
        <div class="symbol-priority-ribbon">
          ${keypad.priorityRibbon}
        </div>
      </div>
    `;
  }

  // 6. Acoustic Beacon Module Section
  let beaconHtml = '';
  if (beacon && activeModuleIds.includes('beacon') && (currentManualFilter === 'all' || currentManualFilter === 'beacon')) {
    const buildBeaconTable = (rows, headingLabel) => {
      const trs = (rows || [])
        .map(
          (r) => `
        <tr>
          <td><strong>${r.name}</strong></td>
          <td style="text-align: center;"><span class="rhythm-badge">${r.pattern}</span></td>
          <td class="tabular-num" style="text-align: center; font-weight: 700; color: var(--accent-amber);">${r.channel}</td>
        </tr>
      `
        )
        .join('');
      return `
        <div style="margin-top: 8px;">
          <div style="font-size: 0.78rem; font-weight: 700; color: var(--text-secondary); margin-bottom: 4px;">${headingLabel}</div>
          <table class="rule-table">
            <thead>
              <tr>
                <th>کد پالس</th>
                <th style="text-align: center;">الگوی ضربه میز</th>
                <th style="text-align: center;">کانال هدف</th>
              </tr>
            </thead>
            <tbody>${trs}</tbody>
          </table>
        </div>
      `;
    };

    let tablesMarkup = '';
    if (currentBeaconParity === 'even') {
      tablesMarkup = buildBeaconTable(beacon.evenRows, 'جدول رقم آخر سریال زوج (Even):');
    } else if (currentBeaconParity === 'odd') {
      tablesMarkup = buildBeaconTable(beacon.oddRows, 'جدول رقم آخر سریال فرد (Odd):');
    } else {
      tablesMarkup =
        buildBeaconTable(beacon.evenRows, 'الف) رقم آخر پلاک سریال زوج (Even):') +
        buildBeaconTable(beacon.oddRows, 'ب) رقم آخر پلاک سریال فرد (Odd):');
    }

    beaconHtml = `
      <div class="manual-section" id="manual-beacon">
        <div class="manual-section-head">
          <h4>۰۴. ماژول فانوس صوتی (Acoustic Beacon)</h4>
          <span class="manual-protocol-code">${beacon.protocolName || ''}</span>
        </div>

        <p style="font-size: 0.79rem; color: var(--text-secondary); line-height: 1.65;">
          صدای پالس از گوشی <strong>اپراتور</strong> پخش می‌شود (در فضای اتاق ممکن است به گوش شما هم برسد، اما حل شما متکی به جدول دیداری و هماهنگی با ناظر است و <strong>ناظر</strong> نیز نباید از صدای بازی استفاده کند). اپراتور ریتم را با <strong>ضربه روی میز</strong> نشان می‌دهد و ناظر زوج/فرد بودن سریال و ریتم را با اشاره به شما منتقل می‌کند:
        </p>

        <div class="parity-toggle-group" role="group" aria-label="فیلتر زوج یا فرد بودن شماره سریال">
          <button type="button" class="parity-toggle-btn ${currentBeaconParity === 'all' ? 'active' : ''}" data-parity="all">
            نمایش هر دو حالت (زوج و فرد)
          </button>
          <button type="button" class="parity-toggle-btn ${currentBeaconParity === 'even' ? 'active' : ''}" data-parity="even">
            فقط سریال زوج (Even)
          </button>
          <button type="button" class="parity-toggle-btn ${currentBeaconParity === 'odd' ? 'active' : ''}" data-parity="odd">
            فقط سریال فرد (Odd)
          </button>
        </div>

        ${tablesMarkup}

        <div class="manual-sub-box">
          <strong>راهنمای تطبیق ریتم ضربات میز:</strong>
          <ul class="manual-checklist" style="margin-top: 6px;">
            <li><span class="tabular-num" dir="ltr">·· — ·</span> <strong>(وکتور):</strong> دو ضربه کوتاه، مکث، یک ضربه بلند، یک ضربه کوتاه</li>
            <li><span class="tabular-num" dir="ltr">— · — ·</span> <strong>(سیگما):</strong> یک بلند، یک کوتاه، یک بلند، یک کوتاه</li>
            <li><span class="tabular-num" dir="ltr">· — — ·</span> <strong>(دلتا):</strong> یک کوتاه، دو بلند، یک کوتاه</li>
            <li><span class="tabular-num" dir="ltr">— — · ·</span> <strong>(امگا):</strong> دو ضربه بلند، دو ضربه کوتاه</li>
          </ul>
        </div>

        <p class="manual-note">${beacon.note || ''}</p>
      </div>
    `;
  }

  muteManualContainer.innerHTML =
    matrixHtml + navTabsHtml + buttonHtml + wiresHtml + keypadHtml + beaconHtml;

  muteManualContainer.querySelectorAll('.manual-tab-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      currentManualFilter = e.currentTarget.getAttribute('data-filter') || 'all';
      renderDynamicManual(manual, state);
    });
  });

  muteManualContainer.querySelectorAll('.parity-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      currentBeaconParity = e.currentTarget.getAttribute('data-parity') || 'all';
      renderDynamicManual(manual, state);
    });
  });
}

// --- Difficulty Selection Host Event Listeners ---
[btnPresetEasy, btnPresetNormal, btnPresetHard].forEach((btn) => {
  if (!btn) return;
  btn.addEventListener('click', () => {
    isCustomDifficultyOpen = false;
    const presetId = btn.getAttribute('data-preset');
    transport.send('set_difficulty', { presetId });
  });
});

if (btnPresetCustom) {
  btnPresetCustom.addEventListener('click', () => {
    isCustomDifficultyOpen = !isCustomDifficultyOpen;
    if (currentGameState) {
      renderState(currentGameState);
    }
  });
}

if (btnApplyCustomDifficulty) {
  btnApplyCustomDifficulty.addEventListener('click', () => {
    const duration = parseInt(overrideDuration.value, 10);
    const maxStrikes = parseInt(overrideStrikes.value, 10);
    const moduleCount = parseInt(overrideModules.value, 10);
    const timePenaltySeconds = parseInt(overridePenalty.value, 10);
    const wireIndexLabels = overrideWireIndexLabels ? overrideWireIndexLabels.checked : false;
    const commAidEnabled = overrideCommAidEnabled ? overrideCommAidEnabled.checked : false;
    const commAidBudget = overrideCommAidBudget ? parseInt(overrideCommAidBudget.value, 10) : 5;

    isCustomDifficultyOpen = true;
    transport.send('set_difficulty', {
      presetId: currentGameState?.difficulty?.preset || 'normal',
      customOverrides: {
        duration,
        maxStrikes,
        moduleCount,
        timePenaltySeconds,
        features: {
          wireIndexLabels,
          commAidEnabled,
          commAidBudget
        }
      }
    });
    showToast('تنظیمات سفارشی راند ثبت شد.', 'success', 2200);
  });
}
