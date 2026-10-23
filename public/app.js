import { GameTransport } from './transport.js';
import { sound } from './audio.js';
import { Bomb3DScene, isWebGLAvailable } from './bomb3d.js';

// Expose sound engine for tactile audio feedback across modules
window.soundEngine = sound;

// --- Client Session & State ---
let playerId = sessionStorage.getItem('defusal_player_id');
if (!playerId) {
  playerId = 'p_' + Math.random().toString(36).substring(2, 10);
  sessionStorage.setItem('defusal_player_id', playerId);
}

let myRole = sessionStorage.getItem('defusal_role') || null;
let currentGameState = null;
let lastGameStatus = null;
let lastTickSecond = null;
let bombScene = null;
let selectedPermTabRole = 'operator';
let toastTimeoutId = null;

// Initialize Transport Abstraction
const transport = new GameTransport();

// DOM Element References
const pingDot = document.getElementById('pingDot');
const connStatus = document.getElementById('connStatus');
const pingVal = document.getElementById('pingVal');
const syncStatus = document.getElementById('syncStatus');
const appToastBanner = document.getElementById('appToastBanner');
const serialTag = document.getElementById('serialTag');
const timerDisplay = document.getElementById('timerDisplay');
const timerPenaltyBadge = document.getElementById('timerPenaltyBadge');
const webglErrorBanner = document.getElementById('webglErrorBanner');
const strikeBoxesContainer = document.getElementById('strikeBoxes');

// Views
const lobbySection = document.getElementById('lobbySection');
const bomb3dSection = document.getElementById('bomb3dSection');
const muteSection = document.getElementById('muteSection');
const overlayExploded = document.getElementById('overlayExploded');
const overlayDefused = document.getElementById('overlayDefused');
const explodeReason = document.getElementById('explodeReason');
const defusedStats = document.getElementById('defusedStats');

// 3D Viewport Controls & Banners
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
      'مشاهده سرنخ‌های رنگی، نمادهای کیپد، نوار کناری دکمه و پلاک شماره سریال پشت بمب در نمای ۳D.',
      'صحبت کردن شفاهی با اپراتور (شما تنها بازیکنی هستید که اجازه صحبت کردن دارد).',
      'برقراری ارتباط دوطرفه با دارنده دفترچه راهنما از طریق اشاره‌های توافقی دست (و کمک‌ارتباطی ۳ نمادی در حالت آسان).',
      'چرخاندن و زوم کردن دوربین ۳D بدون لمس عملیاتی ماژول‌های بمب.'
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
      'مطالعه دفترچه قوانین اختصاصی راند جاری و ماتریس وضعیت ماژول‌ها روی گوشی خود.',
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

// Lobby Permissions Panel Tabs
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

// Non-blocking Toast Helper (replaces window.alert)
function showToast(message, variant = 'info', durationMs = 3600) {
  if (!appToastBanner || !message) return;
  appToastBanner.textContent = message;
  appToastBanner.className = 'app-toast-banner' + (variant === 'error' ? ' toast-error' : (variant === 'success' ? ' toast-success' : ''));
  appToastBanner.style.display = 'block';
  if (toastTimeoutId) clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    if (appToastBanner) appToastBanner.style.display = 'none';
  }, durationMs);
}

// Pre-Round Checklist Management
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
  if (checklistProgressBadge) {
    checklistProgressBadge.textContent = `${checkedCount} از ${totalCount} تایید شد`;
    checklistProgressBadge.classList.toggle('complete', checkedCount === totalCount);
  }
  if (btnCheckAllReady) {
    btnCheckAllReady.textContent = checkedCount === totalCount ? 'بازنشانی چک‌لیست' : 'تایید همه';
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

// Buttons
const btnUnlockAudio = document.getElementById('btnUnlockAudio');
const audioBanner = document.getElementById('audioBanner');
const btnStartGame = document.getElementById('btnStartGame');
const btnLeaveRole = document.getElementById('btnLeaveRole');
const btnRestartExploded = document.getElementById('btnRestartExploded');
const btnRestartDefused = document.getElementById('btnRestartDefused');

// Lobby Seed Controls & Dynamic Manual
const lobbySeedDisplay = document.getElementById('lobbySeedDisplay');
const hostSeedControls = document.getElementById('hostSeedControls');
const inputCustomSeed = document.getElementById('inputCustomSeed');
const btnApplySeed = document.getElementById('btnApplySeed');
const muteManualContainer = document.getElementById('muteManualContainer');

// Authoritative Difficulty Preset Elements
const btnPresetEasy = document.getElementById('btnPresetEasy');
const btnPresetNormal = document.getElementById('btnPresetNormal');
const btnPresetHard = document.getElementById('btnPresetHard');
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

function renderStrikeBoxes(currentStrikes, maxStrikes = 3) {
  if (!strikeBoxesContainer) return;
  strikeBoxesContainer.innerHTML = '';
  for (let i = 0; i < maxStrikes; i++) {
    const box = document.createElement('div');
    box.className = 'strike-box' + (i < currentStrikes ? ' active' : '');
    box.id = `strike${i + 1}`;
    box.textContent = 'X';
    strikeBoxesContainer.appendChild(box);
  }
}

// Quick Camera Views & Sensitivity Toolbar
const btnViewFront = document.getElementById('btnViewFront');
const btnViewBack = document.getElementById('btnViewBack');
const btnResetView = document.getElementById('btnResetView');
const cameraSensitivity = document.getElementById('cameraSensitivity');
const sensitivityValue = document.getElementById('sensitivityValue');
const orientationHint = document.getElementById('orientationHint');
const btnCloseOrientationHint = document.getElementById('btnCloseOrientationHint');

if (btnViewFront) {
  btnViewFront.addEventListener('click', () => {
    if (bombScene) bombScene.viewFront();
  });
}
if (btnViewBack) {
  btnViewBack.addEventListener('click', () => {
    if (bombScene) bombScene.viewBack();
  });
}
if (btnResetView) {
  btnResetView.addEventListener('click', () => {
    if (bombScene) bombScene.resetView();
  });
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
  });
}

// Host Custom Seed Input Handling
if (btnApplySeed && inputCustomSeed) {
  const submitCustomSeed = () => {
    const raw = inputCustomSeed.value.trim();
    if (raw) {
      transport.send('set_seed', { seed: raw });
      inputCustomSeed.value = '';
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
function unlockAudio() {
  sound.init();
  if (isOperator(myRole)) {
    sound.setEnabled(true);
    sound.playClick();
  }
  if (audioBanner) {
    audioBanner.style.display = 'none';
  }
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
    ? 'سهمیه کمک‌ارتباطی این راند تمام شد؛ ادامه ارتباط را با اشاره‌های توافقی انجام دهید.'
    : 'ارسال فقط در پل ناظر ↔ دفترچه راهنما؛ هر نماد ۱ سهمیه مصرف می‌کند.';

  if (commAid.lastSignal) {
    const sig = commAid.lastSignal;
    feedbackText = `آخرین نماد (${sig.senderTitle}): «${sig.symbol} ${sig.label}» • ۱ سهمیه مصرف شد (باقی‌مانده: ${remaining} از ${total})`;
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
      pingDot.classList.remove('disconnected');
      connStatus.textContent = 'آنلاین';
      if (myRole && playerId) {
        transport.send('join', { role: myRole, playerId });
      }
    } else {
      pingDot.classList.add('disconnected');
      connStatus.textContent = 'قطع اتصال...';
    }
    return;
  }

  if (eventType === '_time_synced') {
    pingVal.textContent = `(${data.latency} ms)`;
    syncStatus.textContent = `همگام‌سازی: ${Math.abs(data.serverOffset)}ms`;
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
      if (myRole) {
        sessionStorage.setItem('defusal_role', myRole);
        renderLobbyPermissionsPanel(toFunctionalRoleKey(myRole));
      } else {
        sessionStorage.removeItem('defusal_role');
      }
      if (btnLeaveRole) btnLeaveRole.style.display = myRole ? 'block' : 'none';
      if (bombScene) bombScene.setRole(myRole);
    }

    // Device audio output is active only on the Operator's device
    sound.setEnabled(isOperator(myRole));

    // Trigger one-time explosion or defusal sounds upon state change
    if (prevState?.status !== 'exploded' && currentGameState.status === 'exploded') {
      if (isOperator(myRole)) sound.playExplosion();
    } else if (prevState?.status !== 'defused' && currentGameState.status === 'defused') {
      if (isOperator(myRole)) sound.playDefused();
    }

    lastGameStatus = currentGameState.status;
    renderState(currentGameState);
    return;
  }

  if (eventType === 'role_assigned') {
    myRole = data.role;
    sessionStorage.setItem('defusal_role', myRole);
    sound.setEnabled(isOperator(myRole));
    if (isOperator(myRole)) {
      sound.playClick();
    }
    if (btnLeaveRole) btnLeaveRole.style.display = 'block';
    renderLobbyPermissionsPanel(toFunctionalRoleKey(myRole));
    syncChecklistUI();
    if (bombScene) {
      bombScene.setRole(myRole);
    }
    return;
  }

  if (eventType === 'role_released') {
    myRole = null;
    sessionStorage.removeItem('defusal_role');
    sound.setEnabled(false);
    if (btnLeaveRole) btnLeaveRole.style.display = 'none';
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
      }, 1800);
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
        sessionStorage.removeItem('defusal_role');
        if (btnLeaveRole) btnLeaveRole.style.display = 'none';
      }
    }
    showToast(data.message || 'خطا در عملیات بازی', 'error');
    return;
  }
});

// --- Role Selection Cards (Click & Keyboard Accessible) ---
['blind', 'deaf', 'mute'].forEach((roleKey) => {
  const card = roleCards[roleKey];
  if (!card) return;

  const selectCardRole = () => {
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
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectCardRole();
    }
  });
});

if (btnLeaveRole) {
  btnLeaveRole.addEventListener('click', () => {
    transport.send('leave');
  });
}

if (btnStartGame) {
  btnStartGame.addEventListener('click', () => {
    unlockAudio();
    transport.send('start');
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

  const isHost = (state.hostPlayerId === playerId);

  // 1. Serial Number Tag
  if (isObserver(myRole) && state.serialNumber) {
    serialTag.textContent = `SERIAL: ${state.serialNumber} (پلاک پشت بمب — ویژه ناظر)`;
  } else if (state.status === 'running') {
    serialTag.textContent = 'SERIAL: [فقط در دید ناظر / Observer]';
  } else {
    serialTag.textContent = 'SERIAL: STANDBY';
  }

  // 2. Dynamic Strikes Rendering
  renderStrikeBoxes(state.strikes, state.maxStrikes || 3);

  // 2b. Difficulty Preset & Host Controls
  if (state.difficulty) {
    if (btnPresetEasy) btnPresetEasy.classList.toggle('active', state.difficulty.preset === 'easy');
    if (btnPresetNormal) btnPresetNormal.classList.toggle('active', state.difficulty.preset === 'normal');
    if (btnPresetHard) btnPresetHard.classList.toggle('active', state.difficulty.preset === 'hard');

    const canChangeDifficulty = isHost && (state.status === 'waiting' || state.status === 'ready');
    if (btnPresetEasy) btnPresetEasy.disabled = !canChangeDifficulty;
    if (btnPresetNormal) btnPresetNormal.disabled = !canChangeDifficulty;
    if (btnPresetHard) btnPresetHard.disabled = !canChangeDifficulty;
    if (customOverridesBox) customOverridesBox.style.display = canChangeDifficulty ? 'block' : 'none';

    if (difficultyHostNotice) {
      difficultyHostNotice.textContent = isHost ? 'شما میزبان هستید (تنظیمات فعال)' : 'تنها میزبان مجاز به تغییر است';
    }

    if (diffChipName) diffChipName.textContent = state.difficulty.name || 'متوسط';
    if (diffChipTime) {
      const durMins = Math.floor((state.difficulty.duration || 300) / 60);
      const grace = state.difficulty.features?.timerGraceSeconds;
      diffChipTime.textContent = `${durMins} دقیقه${grace ? ` (+${grace}ثانیه)` : ''}`;
    }
    if (diffChipStrikes) diffChipStrikes.textContent = `${state.difficulty.maxStrikes || 3} خطا`;
    if (diffChipModules) diffChipModules.textContent = `${state.difficulty.moduleCount || 3} ماژول`;
    if (diffChipPenalty) diffChipPenalty.textContent = `${state.difficulty.timePenaltySeconds ?? 30}- ثانیه`;

    const aidEnabled = Boolean(state.difficulty.features?.commAidEnabled);
    const aidBudget = state.difficulty.features?.commAidBudget || 0;
    if (diffChipCommAid) {
      diffChipCommAid.textContent = aidEnabled && aidBudget > 0 ? `فعال (${aidBudget} بار • ۳ نماد)` : 'غیرفعال';
    }

    // Sync custom override form fields when not actively focused
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

  // 3. Lobby Seed Display & Host Controls
  if (lobbySeedDisplay) {
    lobbySeedDisplay.textContent = state.roundSeed || '------';
  }
  if (hostSeedControls) {
    hostSeedControls.style.display = (isHost && (state.status === 'waiting' || state.status === 'ready')) ? 'flex' : 'none';
  }

  // 4. Role Badges in Lobby
  if (state.roles) {
    ['blind', 'deaf', 'mute'].forEach((rKey) => {
      const rInfo = state.roles[rKey];
      const card = roleCards[rKey];
      const badge = roleBadges[rKey];
      if (!card || !badge || !rInfo) return;

      const isMine = rInfo.playerId === playerId;
      const isRoleHost = (rInfo.playerId && rInfo.playerId === state.hostPlayerId);
      const hostIcon = isRoleHost ? ' 👑' : '';

      card.classList.toggle('selected', isMine);

      if (rInfo.connected) {
        card.classList.add('taken');
        badge.className = 'role-status-badge ready';
        badge.textContent = isMine ? `شما (متصل)${hostIcon}` : `متصل${hostIcon}`;
      } else if (rInfo.playerId) {
        card.classList.add('taken');
        badge.className = 'role-status-badge offline';
        badge.textContent = isMine ? `شما (قطع شده)${hostIcon}` : `قطع ارتباط${hostIcon}`;
      } else {
        card.classList.remove('taken');
        badge.className = 'role-status-badge';
        badge.textContent = 'خالی';
      }
    });
  }

  syncChecklistUI(state);
  renderCommAidWidgets(state);

  // 5. Start Button Readiness & Host Authority Guard
  if (btnStartGame) {
    const isReady = state.status === 'ready';

    if (isReady) {
      if (isHost) {
        btnStartGame.disabled = false;
        btnStartGame.textContent = '💣 شروع عملیات خنثی‌سازی (شما میزبان هستید)';
      } else {
        btnStartGame.disabled = true;
        btnStartGame.textContent = '💣 تیم آماده است (منتظر شروع توسط میزبان...)';
      }
    } else if (state.status === 'waiting') {
      btnStartGame.disabled = true;
      btnStartGame.textContent = '💣 شروع عملیات خنثی‌سازی (منتظر ۳ بازیکن)';
    } else {
      btnStartGame.disabled = true;
      btnStartGame.textContent = 'عملیات در جریان است...';
    }
  }

  // 6. Overlays Management (Reset Button with Host Guard)
  overlayExploded.classList.remove('active');
  overlayDefused.classList.remove('active');

  if (state.status === 'exploded') {
    overlayExploded.classList.add('active');
    if (state.endReason === 'time_out') {
      explodeReason.textContent = '⏰ زمان بمب به اتمام رسید!';
    } else if (state.endReason === 'max_strikes') {
      explodeReason.textContent = `💥 تعداد خطاها (Strikes) به ${state.maxStrikes || 3} رسید و بمب منفجر شد!`;
    } else {
      explodeReason.textContent = 'بمب منفجر شد!';
    }

    if (btnRestartExploded) {
      btnRestartExploded.disabled = !isHost;
      btnRestartExploded.textContent = isHost ? '🔄 تلاش دوباره (میزبان)' : 'منتظر ریست توسط میزبان...';
    }
    return;
  }

  if (state.status === 'defused') {
    overlayDefused.classList.add('active');
    defusedStats.textContent = `تبریک به تیم! بمب با ${state.strikes} خطا و در زمان ${formatTime(state.remainingSeconds)} با موفقیت خنثی شد.`;

    if (btnRestartDefused) {
      btnRestartDefused.disabled = !isHost;
      btnRestartDefused.textContent = isHost ? '⭐ بازی جدید (میزبان)' : 'منتظر بازی جدید توسط میزبان...';
    }
    return;
  }

  // 7. Section Router
  [lobbySection, bomb3dSection, muteSection].forEach((sec) => sec.classList.remove('active'));

  if (state.status === 'running') {
    if (isOperator(myRole) || isObserver(myRole)) {
      bomb3dSection.classList.add('active');

      // Lazy initialize or update Three.js scene
      if (!bombScene && bomb3dContainer && isWebGLAvailable()) {
        bombScene = new Bomb3DScene(
          bomb3dContainer,
          myRole,
          (event, payload) => {
            if (event === 'action' && payload && typeof payload === 'object') {
              if (!payload.actionId) {
                payload.actionId = `${playerId || 'p'}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
              }
            }
            transport.send(event, payload);
          },
          () => getCurrentRemainingSeconds()
        );
        const savedSens = localStorage.getItem('bomb_camera_sensitivity') || '1.0';
        bombScene.setSensitivity(savedSens);
      }

      if (bombScene) {
        bombScene.setRole(myRole);
        bombScene.updateState(state);
        bombScene.resize();
      }

      // Banner, helper instructions, and in-round "You can / You cannot" reference
      if (isOperator(myRole)) {
        bomb3dRoleBanner.className = 'role-roleplay-banner blind-banner';
        bomb3dRoleBanner.innerHTML = '⚡ <strong>اپراتور (Operator — بدون کلام):</strong> تنها فرد مجاز به لمس بمب ۳D! با عینک آفتابی و بدون دید به دفترچه راهنما؛ صدای بازی از گوشی شما پخش می‌شود. فرامین را فقط شفاهاً از ناظر بشنوید.';
        blindTactileHelper.style.display = 'block';
        deafVisualHelper.style.display = 'none';
        if (observerGestureDrawer) observerGestureDrawer.style.display = 'none';
        if (bombInRoundPermissions) bombInRoundPermissions.innerHTML = buildPermissionsHtml('operator');
      } else {
        bomb3dRoleBanner.className = 'role-roleplay-banner deaf-banner';
        bomb3dRoleBanner.innerHTML = '👁️ <strong>ناظر (Observer — تنها گوینده و پل ارتباطی):</strong> هدفون ایمن در گوش (عدم استفاده از صدای بازی) و بدون لمس بمب. سرنخ‌های رنگی و پلاک سریال را ببینید، با دفترچه راهنما با اشاره تبادل کنید و به اپراتور شفاهاً فرمان دهید.';
        blindTactileHelper.style.display = 'none';
        deafVisualHelper.style.display = 'block';
        if (observerGestureDrawer) observerGestureDrawer.style.display = 'block';
        if (bombInRoundPermissions) bombInRoundPermissions.innerHTML = buildPermissionsHtml('observer');
      }
    } else if (isManual(myRole)) {
      muteSection.classList.add('active');
      if (manualInRoundPermissions) manualInRoundPermissions.innerHTML = buildPermissionsHtml('manual');
      renderDynamicManual(state.roundManual, state);
    } else {
      lobbySection.classList.add('active');
    }
  } else {
    lobbySection.classList.add('active');
  }

  updateOrientationHint();
}

// Window resize handler for 3D canvas
window.addEventListener('resize', () => {
  if (bombScene) {
    bombScene.resize();
  }
});

// --- Synchronized Timer Calculation ---
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

// Timer Render Loop (runs smoothly every 100ms)
setInterval(() => {
  if (!currentGameState) return;

  const remaining = getCurrentRemainingSeconds();
  timerDisplay.textContent = formatTime(remaining);

  if (currentGameState.status === 'running') {
    if (remaining <= 60) {
      timerDisplay.classList.add('urgent');
    } else {
      timerDisplay.classList.remove('urgent');
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
    timerDisplay.classList.remove('urgent');
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

// Helper: Visual screen flash on strike
function flashRedAlert() {
  const panel = document.querySelector('.timer-panel');
  if (panel) {
    panel.style.boxShadow = '0 0 30px rgba(239, 68, 68, 0.9)';
    setTimeout(() => {
      panel.style.boxShadow = 'inset 0 2px 10px rgba(0, 0, 0, 0.9)';
    }, 400);
  }
}

// --- Keyboard Navigation & Accessibility Controls ---
let isSpacePressed = false;
let spacePressStartTime = 0;
let isWKeyActive = false;

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (currentGameState?.status === 'running') {
    // Arrow keys: Rotate 3D bomb
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
        bombScene.viewFront();
      } else if (e.key === 'b' || e.key === 'B') {
        bombScene.viewBack();
      }
    }

    // Operator physical interactions via keyboard
    if (isOperator(myRole)) {
      if (e.key === 'w' || e.key === 'W') {
        isWKeyActive = true;
      }

      if (['1', '2', '3', '4'].includes(e.key)) {
        const index = parseInt(e.key, 10) - 1;
        if (isWKeyActive) {
          triggerHaptic([35, 25]);
          sound.playWireCut();
          transport.send('action', {
            moduleId: 'wires',
            action: 'cut',
            data: { wireIndex: index }
          });
        } else {
          triggerHaptic(25);
          sound.playClick();
          transport.send('action', {
            moduleId: 'keypad',
            action: 'press',
            data: { slotIndex: index }
          });
        }
      }

      if (e.key === 'c' || e.key === 'C') {
        const beaconState = currentGameState?.modules?.beacon;
        const curr = beaconState?.tunedChannel || 1;
        const nextChannel = (curr % 3) + 1;
        triggerHaptic(25);
        sound.playClick();
        transport.send('action', {
          moduleId: 'beacon',
          action: 'tune',
          data: { channel: nextChannel }
        });
      }

      if (e.key === 't' || e.key === 'T') {
        triggerHaptic([30, 20]);
        sound.playClick();
        transport.send('action', {
          moduleId: 'beacon',
          action: 'transmit'
        });
      }

      if (e.code === 'Space' && !isSpacePressed) {
        e.preventDefault();
        isSpacePressed = true;
        spacePressStartTime = Date.now();
        triggerHaptic(30);
        sound.playClick();

        const btnView = bombScene?.moduleViews?.get('button');
        if (btnView) {
          const { btnMesh, capMesh, defaultBtnZ, stripMesh, glowRing } = btnView.group.userData;
          btnMesh.position.z = defaultBtnZ - 0.04;
          capMesh.position.z = defaultBtnZ - 0.04 + 0.075;
          stripMesh.material.color.setHex(0xa1a1aa);
          if (glowRing) {
            glowRing.visible = true;
            glowRing.material.opacity = 0.85;
          }
        }
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
    const duration = Date.now() - spacePressStartTime;
    const lastDigit = Math.floor(Math.max(0, getCurrentRemainingSeconds())) % 10;

    const btnView = bombScene?.moduleViews?.get('button');
    if (btnView) {
      const { btnMesh, capMesh, defaultBtnZ, stripMesh, glowRing } = btnView.group.userData;
      btnMesh.position.z = defaultBtnZ;
      capMesh.position.z = defaultBtnZ + 0.075;
      stripMesh.material.color.setHex(0x3f3f46);
      if (glowRing) {
        glowRing.visible = false;
        glowRing.material.opacity = 0;
      }
    }

    if (duration < 350) {
      triggerHaptic(35);
      sound.playClick();
      transport.send('action', {
        moduleId: 'button',
        action: 'press'
      });
    } else {
      triggerHaptic([40, 30, 40]);
      sound.playClick();
      transport.send('action', {
        moduleId: 'button',
        action: 'release',
        data: { releaseDigit: lastDigit }
      });
    }
  }
});

window.addEventListener('blur', () => {
  isSpacePressed = false;
  isWKeyActive = false;
});

// --- Dynamic Round Manual & Status Matrix Renderer for Manual-holder Role ---
let currentManualFilter = 'all';
let currentBeaconParity = 'even';

function renderDynamicManual(manual, state) {
  if (!muteManualContainer) return;
  if (!manual) {
    muteManualContainer.innerHTML = `
      <div class="manual-section manual-loading-placeholder">
        ⏳ در انتظار دریافت قوانین عملیات از مرکز فرماندهی...
      </div>
    `;
    return;
  }

  const { seed, button, wires, keypad, beacon } = manual;

  // 1. Live Threat Level & Dynamic Status Matrix
  const modulesDefused = state?.modulesDefusedCount ?? Object.values(state?.modules || {}).filter(m => m?.solved).length;
  const totalModules = state?.totalModulesCount || 4;
  const remainingModules = Math.max(0, totalModules - modulesDefused);

  let threatPhaseText = `⚠️ فاز عملیاتی: ${remainingModules} از ${totalModules} ماژول مسلح است`;
  if (remainingModules === 0) {
    threatPhaseText = '🏆 خنثی‌سازی کامل: تمام سامانه‌ها ایمن شدند!';
  } else if (remainingModules === 1) {
    threatPhaseText = '🎯 مرحله آخر: تنها ۱ ماژول مسلح باقی مانده است!';
  }

  const activeModuleIds = state?.moduleIds || ['wires', 'button', 'keypad', 'beacon'];
  const moduleMetaList = [
    { id: 'button', label: '🔘 کاتالیزور', solved: Boolean(state?.modules?.button?.solved) },
    { id: 'wires', label: '✂️ فیوزها', solved: Boolean(state?.modules?.wires?.solved) },
    { id: 'keypad', label: '🔣 کیپد', solved: Boolean(state?.modules?.keypad?.solved) },
    { id: 'beacon', label: '📡 فانوس صوتی', solved: Boolean(state?.modules?.beacon?.solved) }
  ].filter((m) => activeModuleIds.includes(m.id));

  const stepsHtml = Array.from({ length: totalModules }, (_, i) => `
    <div class="threat-step ${i < modulesDefused ? 'defused' : ''}"></div>
  `).join('');

  const pillsHtml = moduleMetaList.map((m) => `
    <div class="module-status-pill ${m.solved ? 'secured' : 'armed'}">
      <span>${m.label}</span>
      <span>${m.solved ? '🟢 خنثی' : '🔴 مسلح'}</span>
    </div>
  `).join('');

  const matrixHtml = `
    <div class="threat-matrix-card" id="manual-matrix">
      <div class="threat-matrix-header">
        <span class="threat-phase-title">📊 ماتریس پویای وضعیت بمب (ارتباط شما فقط با ناظر است)</span>
        <span style="font-size: 0.75rem; color: #f59e0b; font-family: monospace;">SEED: ${seed || ''}</span>
      </div>
      <div style="font-size: 0.8rem; color: #e2e8f0; margin-bottom: 8px; font-weight: 500;">
        ${threatPhaseText}
      </div>
      <div class="threat-progress-bar">
        ${stepsHtml}
      </div>
      <div class="manual-modules-grid">
        ${pillsHtml}
      </div>
    </div>
  `;

  // 2. Navigation Tabs
  const navTabsHtml = `
    <div class="manual-nav-tabs">
      <button type="button" class="manual-tab-btn ${currentManualFilter === 'all' ? 'active' : ''}" data-filter="all">همه پروتکل‌ها</button>
      <button type="button" class="manual-tab-btn ${currentManualFilter === 'button' ? 'active' : ''}" data-filter="button">🔘 دکمه</button>
      <button type="button" class="manual-tab-btn ${currentManualFilter === 'wires' ? 'active' : ''}" data-filter="wires">✂️ سیم‌ها</button>
      <button type="button" class="manual-tab-btn ${currentManualFilter === 'keypad' ? 'active' : ''}" data-filter="keypad">🔣 کیپد</button>
      <button type="button" class="manual-tab-btn ${currentManualFilter === 'beacon' ? 'active' : ''}" data-filter="beacon">📡 فانوس صوتی</button>
    </div>
  `;

  // 3. Button Module Section
  let buttonHtml = '';
  if (button && (currentManualFilter === 'all' || currentManualFilter === 'button')) {
    const tapRows = (button.tapRows || []).map(r => `
      <tr>
        <td>${r.condition}</td>
        <td>${r.action}</td>
      </tr>
    `).join('');

    const stripRows = (button.stripRows || []).map(r => `
      <li>نوار <strong>${r.colorName}</strong>: وقتی رقم یکان ثانیه‌شمار <strong>${r.digit}</strong> شد رها شود (رقم را با اشاره به ناظر نشان دهید).</li>
    `).join('');

    buttonHtml = `
      <div class="manual-section" id="manual-button" style="margin-bottom: 12px;">
        <h4>🔘 ماژول دکمه کاتالیزور — <span style="font-size: 0.8rem; color: #38bdf8;">${button.protocolName || ''}</span></h4>
        <table class="rule-table">
          <thead>
            <tr>
              <th>شرط رنگ دکمه و سریال (گزارش ناظر)</th>
              <th>اقدام لازم (اعلام با اشاره به ناظر جهت فرمان کلامی به اپراتور)</th>
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

        <div style="margin-top: 10px; background: rgba(15, 23, 42, 0.6); padding: 8px 10px; border-radius: 8px; border: 1px solid #334155;">
          <strong style="font-size: 0.8rem; color: #38bdf8;">رقم ثانیه رهاسازی در صورت نگه‌داشتن دکمه (بر اساس رنگ نوار کناری):</strong>
          <ul style="font-size: 0.76rem; color: #cbd5e1; margin: 4px 0 0 16px; line-height: 1.6;">
            ${stripRows}
          </ul>
        </div>
        <p style="font-size: 0.74rem; color: #cbd5e1; margin-top: 8px;">
          📌 <em>${button.note || ''}</em>
        </p>
      </div>
    `;
  }

  // 4. Wires Module Section
  let wiresHtml = '';
  if (wires && (currentManualFilter === 'all' || currentManualFilter === 'wires')) {
    const steps = (wires.checklist || []).map(item => `
      <li>${item.condition} <strong>${item.action}</strong> بریده شود (با اشاره به ناظر اعلام کنید).</li>
    `).join('');

    wiresHtml = `
      <div class="manual-section" id="manual-wires" style="margin-bottom: 12px;">
        <h4>✂️ ماژول فیوزهای سیم‌کشی — <span style="font-size: 0.8rem; color: #38bdf8;">${wires.protocolName || ''}</span></h4>
        <ul class="manual-checklist">
          ${steps}
        </ul>
        <p style="font-size: 0.74rem; color: #cbd5e1; margin-top: 8px;">
          📌 <em>${wires.note || ''}</em>
        </p>
      </div>
    `;
  }

  // 5. Keypad Module Section
  let keypadHtml = '';
  if (keypad && (currentManualFilter === 'all' || currentManualFilter === 'keypad')) {
    keypadHtml = `
      <div class="manual-section" id="manual-keypad" style="margin-bottom: 12px;">
        <h4>🔣 ماژول نمادهای رمزی صفحه‌کلید — <span style="font-size: 0.8rem; color: #38bdf8;">${keypad.protocolName || ''}</span></h4>
        <p style="font-size: 0.78rem; color: #cbd5e1; margin-bottom: 8px;">
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
  if (beacon && (currentManualFilter === 'all' || currentManualFilter === 'beacon')) {
    const isEven = currentBeaconParity === 'even';
    const rows = isEven ? (beacon.evenRows || []) : (beacon.oddRows || []);

    const tableRows = rows.map(r => `
      <tr>
        <td><strong>${r.name}</strong></td>
        <td style="text-align: center;"><span class="rhythm-badge">${r.pattern}</span></td>
        <td style="color: #38bdf8; font-weight: bold; text-align: center;">${r.channel}</td>
      </tr>
    `).join('');

    beaconHtml = `
      <div class="manual-section" id="manual-beacon" style="margin-bottom: 12px;">
        <h4>📡 ماژول فانوس صوتی (Acoustic Beacon) — <span style="font-size: 0.8rem; color: #38bdf8;">${beacon.protocolName || ''}</span></h4>
        
        <div style="font-size: 0.76rem; color: #cbd5e1; margin-bottom: 8px; line-height: 1.6;">
          صدای پالس از گوشی <strong>اپراتور</strong> پخش می‌شود (در فضای اتاق ممکن است به گوش شما هم برسد، اما حل شما متکی به شنیدن صدا نیست و <strong>ناظر</strong> نیز نباید از صدای بازی استفاده کند). اپراتور ریتم را با <strong>ضربه روی میز</strong> به ناظر منتقل می‌کند؛ ناظر زوج یا فرد بودن پلاک و ریتم را با اشاره به شما می‌گوید تا شماره کانال هدف (۱ تا ۳) را با اشاره به ناظر اعلام کنید:
        </div>

        <div class="parity-toggle-group">
          <button type="button" class="parity-toggle-btn ${isEven ? 'active' : ''}" data-parity="even">
            🔢 پلاک سریال زوج (Even Serial)
          </button>
          <button type="button" class="parity-toggle-btn ${!isEven ? 'active' : ''}" data-parity="odd">
            🔢 پلاک سریال فرد (Odd Serial)
          </button>
        </div>

        <table class="rule-table">
          <thead>
            <tr>
              <th>نوع پالس</th>
              <th style="text-align: center;">ریتم ضربه (جدول دیداری)</th>
              <th style="text-align: center;">کانال هدف (اعلام با اشاره به ناظر)</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>

        <div style="margin-top: 10px; background: rgba(15, 23, 42, 0.6); padding: 8px 10px; border-radius: 8px; border: 1px solid #334155; font-size: 0.74rem; color: #cbd5e1;">
          <strong style="color: #f59e0b;">راهنمای تطبیق دیداری ریتم ضربات میز:</strong>
          <ul style="margin: 4px 0 0 16px; line-height: 1.6;">
            <li><strong>·· — · (وکتور):</strong> دو ضربه تند، مکث، یک ضربه بلند، یک ضربه کوتاه</li>
            <li><strong>— · — · (سیگما):</strong> یک ضربه بلند، یک کوتاه، یک بلند، یک کوتاه</li>
            <li><strong>· — — · (دلتا):</strong> یک ضربه کوتاه، دو ضربه بلند، یک ضربه کوتاه</li>
            <li><strong>— — · · (امگا):</strong> دو ضربه بلند، دو ضربه تند و کوتاه</li>
          </ul>
        </div>

        <p style="font-size: 0.74rem; color: #cbd5e1; margin-top: 8px;">
          📌 <em>${beacon.note || ''}</em>
        </p>
      </div>
    `;
  }

  muteManualContainer.innerHTML = matrixHtml + navTabsHtml + buttonHtml + wiresHtml + keypadHtml + beaconHtml;

  // Attach event handlers for interactive tabs
  muteManualContainer.querySelectorAll('.manual-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      currentManualFilter = e.currentTarget.getAttribute('data-filter') || 'all';
      renderDynamicManual(manual, state);
    });
  });

  // Attach event handlers for parity toggles
  muteManualContainer.querySelectorAll('.parity-toggle-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      currentBeaconParity = e.currentTarget.getAttribute('data-parity') || 'even';
      renderDynamicManual(manual, state);
    });
  });
}

// --- Difficulty Selection Host Event Listeners ---
[btnPresetEasy, btnPresetNormal, btnPresetHard].forEach((btn) => {
  if (!btn) return;
  btn.addEventListener('click', () => {
    const presetId = btn.getAttribute('data-preset');
    transport.send('set_difficulty', { presetId });
  });
});

if (btnApplyCustomDifficulty) {
  btnApplyCustomDifficulty.addEventListener('click', () => {
    const duration = parseInt(overrideDuration.value, 10);
    const maxStrikes = parseInt(overrideStrikes.value, 10);
    const moduleCount = parseInt(overrideModules.value, 10);
    const timePenaltySeconds = parseInt(overridePenalty.value, 10);
    const wireIndexLabels = overrideWireIndexLabels ? overrideWireIndexLabels.checked : false;
    const commAidEnabled = overrideCommAidEnabled ? overrideCommAidEnabled.checked : false;
    const commAidBudget = overrideCommAidBudget ? parseInt(overrideCommAidBudget.value, 10) : 5;

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
  });
}
