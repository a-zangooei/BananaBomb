/**
 * BananaBomb Client Application Coordinator.
 *
 * Orchestrates WebSocket session state, role selection & readiness, difficulty/seed lobby controls,
 * 3D viewport lifecycle (`Bomb3DScene`), Operator-exclusive accelerating timer audio, and modular
 * UI controllers (`./ui/*`).
 */
import { GameTransport } from './transport.js';
import { sound, computeTimerTickSchedule } from './audio.js';
import { Bomb3DScene, isWebGLAvailable } from './bomb3d.js';
import { INTERACTION_DEFAULTS } from './interaction-controller.js';
import { createHybridSessionManager } from './session-store.js';
import { isOperator, isObserver, isManual, toFunctionalRoleKey } from '../shared/roles.js';
import { hasCustomDifficultyOverrides } from '../shared/difficulty.js';
import {
  createToastController,
  createWakeLockController,
  initFullscreenControls,
  initOrientationHint,
  triggerHaptic
} from './ui/viewport-ergonomics.js';
import { createQrModalController } from './ui/qr-modal.js';
import {
  buildPermissionsHtml,
  createReferenceSheetController
} from './ui/reference-sheet.js';
import { createCommAidController } from './ui/comm-aid-ui.js';
import { createManualRenderer } from './ui/manual-renderer.js';
import { initKeyboardControls } from './ui/keyboard-controls.js';

// Retain global reference for backward-compatible debugging while passing `soundEngine` explicitly to Bomb3DScene
window.soundEngine = sound;

// --- Hybrid Mobile Session & Tab-Safe Identity ---
const sessionManager = createHybridSessionManager();
const playerId = sessionManager.playerId;
let myRole = sessionManager.getRole();
let currentGameState = null;
let nextTimerAudioAtMs = 0;
let lastCountdownBeepStep = null;
let bombScene = null;
let manualWorldScene = null;
let manualDockMode = 'split';
let isCustomDifficultyOpen = false;
let isSeedPanelOpen = false;
let audioUnlocked = false;

const transport = new GameTransport();

// --- Core Shell, HUD & Debrief Elements ---
const appViewport = document.querySelector('.app-viewport');
const lobbyTopBar = document.getElementById('lobbyTopBar');
const activeRoundHud = document.getElementById('activeRoundHud');
const pingDot = document.getElementById('pingDot');
const connStatus = document.getElementById('connStatus');
const appToastBanner = document.getElementById('appToastBanner');
const webglErrorBanner = document.getElementById('webglErrorBanner');

const hudActiveRoleTitle = document.getElementById('hudActiveRoleTitle');
const hudDefusedRatio = document.getElementById('hudDefusedRatio');
const btnInRoundHelp = document.getElementById('btnInRoundHelp');

const lobbySection = document.getElementById('lobbySection');
const bomb3dSection = document.getElementById('bomb3dSection');
const muteSection = document.getElementById('muteSection');
const overlayCountdown = document.getElementById('overlayCountdown');
const countdownDigitDisplay = document.getElementById('countdownDigitDisplay');
const countdownProgressFill = document.getElementById('countdownProgressFill');
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

const bomb3dContainer = document.getElementById('bomb3dContainer');
const bomb3dRoleBanner = document.getElementById('bomb3dRoleBanner');
const bombInRoundPermissions = document.getElementById('bombInRoundPermissions');
const manualInRoundPermissions = document.getElementById('manualInRoundPermissions');

// --- Lobby Role Cards & Readiness Controls ---
const cardBlindEl = document.getElementById('cardBlind');
const cardDeafEl = document.getElementById('cardDeaf');
const cardMuteEl = document.getElementById('cardMute');
const badgeBlindEl = document.getElementById('badgeBlind');
const badgeDeafEl = document.getElementById('badgeDeaf');
const badgeMuteEl = document.getElementById('badgeMute');
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
  blind: { el: document.getElementById('slotIndBlind'), shortTitle: 'اپراتور' },
  deaf: { el: document.getElementById('slotIndDeaf'), shortTitle: 'ناظر' },
  mute: { el: document.getElementById('slotIndMute'), shortTitle: 'راهنما' }
};

const releaseRoleButtons = {
  blind: document.getElementById('btnReleaseBlind'),
  deaf: document.getElementById('btnReleaseDeaf'),
  mute: document.getElementById('btnReleaseMute')
};

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

// --- Lobby Seed & Difficulty Elements ---
const lobbySeedDisplay = document.getElementById('lobbySeedDisplay');
const btnToggleSeedForm = document.getElementById('btnToggleSeedForm');
const lobbySeedContainer = document.getElementById('lobbySeedContainer');
const hostSeedControls = document.getElementById('hostSeedControls');
const inputCustomSeed = document.getElementById('inputCustomSeed');
const btnApplySeed = document.getElementById('btnApplySeed');

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

// --- Camera Presets, Tuning Popover & Operator HUD Elements ---
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

// --- Instantiate Cohesive UI Sub-Controllers ---
const { showToast } = createToastController(appToastBanner);

const { syncScreenWakeLock } = createWakeLockController({
  getGameStatus: () => currentGameState?.status
});

initFullscreenControls({
  buttons: [
    document.getElementById('btnLobbyFullscreen'),
    document.getElementById('btnHudFullscreen')
  ],
  showToast
});

const { updateOrientationHint } = initOrientationHint({
  hintEl: document.getElementById('orientationHint'),
  closeBtn: document.getElementById('btnCloseOrientationHint'),
  getGameStatus: () => currentGameState?.status
});

const { closeQrModal, isQrModalOpen } = createQrModalController({
  elements: {
    btnOpenQrModal: document.getElementById('btnOpenQrModal'),
    qrInviteModal: document.getElementById('qrInviteModal'),
    btnCloseQrModal: document.getElementById('btnCloseQrModal'),
    qrSvgContainer: document.getElementById('qrSvgContainer'),
    qrActiveUrlText: document.getElementById('qrActiveUrlText'),
    btnCopyLanUrl: document.getElementById('btnCopyLanUrl'),
    qrLocalhostNotice: document.getElementById('qrLocalhostNotice'),
    qrInterfaceSelectorWrap: document.getElementById('qrInterfaceSelectorWrap'),
    qrInterfaceButtons: document.getElementById('qrInterfaceButtons'),
    inputManualLanHost: document.getElementById('inputManualLanHost'),
    btnApplyManualLanHost: document.getElementById('btnApplyManualLanHost')
  },
  showToast
});

const {
  closeReferenceSheet,
  isReferenceSheetOpen,
  renderLobbyPermissionsPanel,
  renderCountdownCurtainRolePrep,
  syncChecklistUI
} = createReferenceSheetController({
  elements: {
    btnOpenReferenceSheet: document.getElementById('btnOpenReferenceSheet'),
    btnInRoundHelp,
    lobbyReferenceSheet: document.getElementById('lobbyReferenceSheet'),
    btnCloseReferenceSheet: document.getElementById('btnCloseReferenceSheet'),
    headerChecklistCount: document.getElementById('headerChecklistCount'),
    sheetTabCheckCount: document.getElementById('sheetTabCheckCount'),
    refTabButtons: Array.from(document.querySelectorAll('[data-ref-tab]')),
    refTabPanes: Array.from(document.querySelectorAll('[data-ref-pane]')),
    rolePermissionsBody: document.getElementById('rolePermissionsBody'),
    permTabButtons: Array.from(document.querySelectorAll('[data-perm-role]')),
    openPermButtons: Array.from(document.querySelectorAll('[data-open-perm]')),
    checklistInputs: Array.from(document.querySelectorAll('#preRoundChecklistItems input[type="checkbox"]')),
    checklistProgressBadge: document.getElementById('checklistProgressBadge'),
    btnCheckAllReady: document.getElementById('btnCheckAllReady'),
    chkLiveRoleHint: document.getElementById('chkLiveRoleHint'),
    chkLiveConnHint: document.getElementById('chkLiveConnHint'),
    countdownRoleTitle: document.getElementById('countdownRoleTitle'),
    countdownRoleInstructions: document.getElementById('countdownRoleInstructions')
  },
  getMyRole: () => myRole,
  getGameState: () => currentGameState
});

const { renderCommAidWidgets, flashForCurrentRole: flashCommAidForRole } = createCommAidController({
  elements: {
    observerCommAidWidget: document.getElementById('observerCommAidWidget'),
    observerCommAidBudget: document.getElementById('observerCommAidBudget'),
    observerCommAidFeedback: document.getElementById('observerCommAidFeedback'),
    manualCommAidWidget: document.getElementById('manualCommAidWidget'),
    manualCommAidBudget: document.getElementById('manualCommAidBudget'),
    manualCommAidFeedback: document.getElementById('manualCommAidFeedback'),
    symbolButtons: Array.from(document.querySelectorAll('[data-comm-symbol]'))
  },
  getMyRole: () => myRole,
  getPlayerId: () => playerId,
  sendSignal: (payload) => transport.send('comm_signal', payload)
});

const { renderDynamicManual } = createManualRenderer({
  containerEl: document.getElementById('muteManualContainer')
});

// --- Operator Tuning, Camera Presets & Hybrid Manual Dock ---
let operatorHoldThresholdMs =
  Number(localStorage.getItem('bomb_hold_threshold_ms')) || INTERACTION_DEFAULTS.buttonHoldThresholdMs;
operatorHoldThresholdMs = Math.max(
  INTERACTION_DEFAULTS.minHoldThresholdMs,
  Math.min(INTERACTION_DEFAULTS.maxHoldThresholdMs, operatorHoldThresholdMs)
);

function isTuningPopoverOpen() {
  return Boolean(operatorTuningPopover && operatorTuningPopover.style.display !== 'none');
}

function setTuningPopoverOpen(open) {
  if (!operatorTuningPopover) return;
  operatorTuningPopover.style.display = open ? 'flex' : 'none';
  if (btnToggleTuningPopover) {
    btnToggleTuningPopover.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
}

if (btnToggleTuningPopover) {
  btnToggleTuningPopover.addEventListener('click', () => {
    setTuningPopoverOpen(!isTuningPopoverOpen());
  });
}
if (btnCloseTuningPopover) {
  btnCloseTuningPopover.addEventListener('click', () => setTuningPopoverOpen(false));
}
if (bomb3dContainer) {
  bomb3dContainer.addEventListener('pointerdown', () => {
    if (isTuningPopoverOpen()) {
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
      () => getCurrentRemainingSeconds(),
      { soundEngine: sound }
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
    if (bombScene) bombScene.setSensitivity(val);
    if (manualWorldScene) manualWorldScene.setSensitivity(val);
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
    if (bombScene) bombScene.setHoldThreshold(nextMs);
  });
}

// --- Host Custom Seed & Difficulty Controls ---
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
    if (e.key === 'Enter') submitCustomSeed();
  });
}

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
    if (currentGameState) renderState(currentGameState);
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

// --- WebGL Banner & Audio Activation ---
if (!isWebGLAvailable()) {
  if (webglErrorBanner) webglErrorBanner.style.display = 'block';
}

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

// Helper: Visual HUD alert on strike
function flashRedAlert() {
  if (activeRoundHud) {
    activeRoundHud.classList.add('strike-alert-flash');
    setTimeout(() => {
      activeRoundHud.classList.remove('strike-alert-flash');
    }, 420);
  }
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
    return;
  }

  if (eventType === 'session_replaced') {
    showToast(data.message || 'نشست شما در دستگاه یا تب دیگری فعال شد.', 'error', 5000);
    return;
  }

  if (eventType === 'comm_signal_sent') {
    triggerHaptic([35, 25]);
    flashCommAidForRole();
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

  if (eventType === 'difficulty_changed') {
    if (data?.difficulty && !hasCustomDifficultyOverrides(data.difficulty)) {
      isCustomDifficultyOpen = false;
    }
    return;
  }

  if (eventType === 'state_update') {
    const prevState = currentGameState;
    currentGameState = data.state;

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
    sound.setEnabled(isOperator(myRole));

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

    if (prevState?.status !== 'running' && currentGameState.status === 'running') {
      closeQrModal();
      closeReferenceSheet();
      setTuningPopoverOpen(false);
      const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();
      nextTimerAudioAtMs = nowPerf + 260;
    } else if (currentGameState.status !== 'running') {
      nextTimerAudioAtMs = 0;
    }

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
    if (bombScene && penaltySec > 0) {
      bombScene.triggerStrikePenaltyFlash(penaltySec);
    }

    if (isOperator(myRole) && currentGameState?.status === 'running') {
      const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const sched = computeTimerTickSchedule(
        getCurrentRemainingSeconds(),
        currentGameState.duration || 300
      );
      if (nextTimerAudioAtMs > nowPerf + sched.intervalMs) {
        nextTimerAudioAtMs = nowPerf + sched.intervalMs;
      }
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

  if (appViewport) {
    appViewport.setAttribute('data-phase', isLobbyPhase || isCountdownPhase ? 'lobby' : 'active');
  }
  if (lobbyTopBar) {
    lobbyTopBar.style.display = isLobbyPhase || isCountdownPhase ? 'flex' : 'none';
  }
  if (activeRoundHud) {
    activeRoundHud.style.display = isLobbyPhase || isCountdownPhase ? 'none' : 'flex';
  }

  const maxStrikes = state.maxStrikes || 3;
  const defusedCount =
    state.modulesDefusedCount ??
    Object.values(state.modules || {}).filter((m) => m?.solved).length;
  const totalModules = state.totalModulesCount || state.difficulty?.moduleCount || 3;

  if (hudDefusedRatio) {
    hudDefusedRatio.textContent = `${defusedCount} / ${totalModules}`;
  }
  if (hudActiveRoleTitle) {
    const roleLabel = isOperator(myRole)
      ? 'اپراتور'
      : isObserver(myRole)
        ? 'ناظر'
        : isManual(myRole)
          ? 'دفترچه راهنما'
          : 'تماشاگر';
    hudActiveRoleTitle.textContent = `عملیات خنثی‌سازی · ${roleLabel}`;
  }

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
      const rawName = state.difficulty.name || 'متوسط';
      diffChipName.textContent =
        hasCustomDifficultyOverrides(state.difficulty) && !rawName.includes('سفارشی')
          ? `${rawName} (سفارشی)`
          : rawName;
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
            soundEngine: sound,
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
          bomb3dRoleBanner.textContent = 'اپراتور: تنها لمس‌کننده بمب مونوکروم · پخش صدای تندشونده تایمر از این گوشی · مشاهده لامپ مورس دیواره چپ و اعداد بریل.';
        }
        if (btnViewFront) btnViewFront.textContent = 'پنل ماژول‌ها';
        if (btnViewBack) btnViewBack.textContent = 'نمای کلی میز';
        if (btnViewBridge) {
          btnViewBridge.textContent = 'لامپ مورس';
          btnViewBridge.style.display = 'inline-flex';
        }
        if (holdThresholdControl) holdThresholdControl.style.display = 'flex';
        if (operatorInteractionHud) operatorInteractionHud.style.display = 'flex';
        if (bombInRoundPermissions) bombInRoundPermissions.innerHTML = buildPermissionsHtml('operator');
      } else {
        if (bomb3dRoleBanner) {
          bomb3dRoleBanner.textContent = 'ناظر: تنها بیننده تایمر و خانه‌های خطا روی درب باز کیف، رنگ ماژول‌ها و پلاک سریال · تنها گوینده تیم.';
        }
        if (btnViewFront) btnViewFront.textContent = 'سرنخ‌ها و تایمر';
        if (btnViewBack) btnViewBack.textContent = 'پلاک سریال';
        if (btnViewBridge) {
          btnViewBridge.textContent = 'دید هم‌تیمی‌ها';
          btnViewBridge.style.display = 'inline-flex';
        }
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

window.addEventListener('resize', () => {
  if (bombScene) bombScene.resize();
  if (manualWorldScene) manualWorldScene.resize();
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

// Continuous Pre-Start Readiness & Accelerating Operator Bomb Timer Audio Loop
setInterval(() => {
  if (!currentGameState) return;

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

  // Moment-by-moment accelerating timer audio exclusively on Operator's phone speaker
  if (currentGameState.status === 'running') {
    if (!isOperator(myRole)) {
      nextTimerAudioAtMs = 0;
      return;
    }

    const remaining = getCurrentRemainingSeconds();
    if (remaining <= 0) return;

    const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nextTimerAudioAtMs <= 0) {
      nextTimerAudioAtMs = nowPerf;
    }

    if (nowPerf >= nextTimerAudioAtMs) {
      const totalDuration = currentGameState.duration || 300;
      const sched = computeTimerTickSchedule(remaining, totalDuration);
      sound.playTimerPulse(sched);
      nextTimerAudioAtMs = nowPerf + sched.intervalMs;
    }
  } else {
    nextTimerAudioAtMs = 0;
  }
}, 30);

// --- Initialize Keyboard & Accessibility Controls ---
initKeyboardControls({
  getMyRole: () => myRole,
  getGameState: () => currentGameState,
  getBombScene: () => bombScene,
  getHoldThresholdMs: () => operatorHoldThresholdMs,
  getCurrentRemainingSeconds,
  isQrModalOpen,
  closeQrModal,
  isReferenceSheetOpen,
  closeReferenceSheet,
  isTuningPopoverOpen,
  setTuningPopoverOpen,
  onCancelCountdown: () => transport.send('cancel_countdown'),
  onSelectBombViewButton: setActiveBombViewButton,
  viewButtons: {
    front: btnViewFront,
    back: btnViewBack,
    bridge: btnViewBridge
  },
  sendOperatorBombAction,
  renderOperatorHudStatus,
  sound,
  triggerHaptic
});
