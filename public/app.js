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

// Initialize Transport Abstraction
const transport = new GameTransport();

// DOM Element References
const pingDot = document.getElementById('pingDot');
const connStatus = document.getElementById('connStatus');
const pingVal = document.getElementById('pingVal');
const syncStatus = document.getElementById('syncStatus');
const serialTag = document.getElementById('serialTag');
const timerDisplay = document.getElementById('timerDisplay');
const webglErrorBanner = document.getElementById('webglErrorBanner');
const strikeBoxes = [
  document.getElementById('strike1'),
  document.getElementById('strike2'),
  document.getElementById('strike3')
];

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

// Role Cards (supports both modern tactical and legacy role IDs)
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

// Tactical Role Normalizers
const isOperator = (r) => r === 'operator' || r === 'blind';
const isObserver = (r) => r === 'observer' || r === 'deaf';
const isManual = (r) => r === 'manual' || r === 'mute';

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

// Quick Camera Views & Sensitivity Toolbar
const btnViewFront = document.getElementById('btnViewFront');
const btnViewBack = document.getElementById('btnViewBack');
const btnResetView = document.getElementById('btnResetView');
const cameraSensitivity = document.getElementById('cameraSensitivity');
const sensitivityValue = document.getElementById('sensitivityValue');
const orientationHint = document.getElementById('orientationHint');
const btnCloseOrientationHint = document.getElementById('btnCloseOrientationHint');
const desktopKeyboardHint = document.getElementById('desktopKeyboardHint');

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

// Audio activation
function unlockAudio() {
  sound.init();
  if (myRole === 'blind') {
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
    alert(data.message || 'نشست شما در دستگاه یا تب دیگری فعال شد.');
    return;
  }

  if (eventType === 'state_update') {
    const prevState = currentGameState;
    currentGameState = data.state;

    // Synchronize local role state with server authoritative role ownership
    let serverAssignedRole = null;
    if (currentGameState.roles) {
      for (const [rKey, rInfo] of Object.entries(currentGameState.roles)) {
        if (rInfo.playerId === playerId) {
          serverAssignedRole = rKey;
          break;
        }
      }
    }

    if (serverAssignedRole !== myRole) {
      myRole = serverAssignedRole;
      if (myRole) {
        sessionStorage.setItem('defusal_role', myRole);
      } else {
        sessionStorage.removeItem('defusal_role');
      }
      if (btnLeaveRole) btnLeaveRole.style.display = myRole ? 'block' : 'none';
      if (bombScene) bombScene.setRole(myRole);
    }

    // Strictly gate audio: Only Operator role hears any audio
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
    return;
  }

  if (eventType === 'strike') {
    if (isOperator(myRole)) {
      sound.playStrike();
    }
    triggerHaptic([120, 60, 120]);
    flashRedAlert();
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
      // Revert local role choice if server rejected it
      if (myRole && currentGameState?.roles?.[myRole]?.playerId !== playerId) {
        myRole = null;
        sessionStorage.removeItem('defusal_role');
        if (btnLeaveRole) btnLeaveRole.style.display = 'none';
      }
    }
    alert(data.message || 'خطا در عملیات بازی');
    return;
  }
});

// --- Role Selection Buttons ---
Object.keys(roleCards).forEach((roleKey) => {
  const card = roleCards[roleKey];
  if (!card) return;

  card.addEventListener('click', () => {
    sound.init();
    if (myRole === roleKey) return;

    transport.send('join', {
      role: roleKey,
      playerId
    });
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
    serialTag.textContent = `SERIAL: ${state.serialNumber} (پلاک پشت بمب را بخوانید)`;
  } else if (state.status === 'running') {
    serialTag.textContent = 'SERIAL: [پلاک محرمانه / فقط در دسترس ناظر]';
  } else {
    serialTag.textContent = 'SERIAL: STANDBY';
  }

  // 2. Strikes Rendering
  strikeBoxes.forEach((box, idx) => {
    if (idx < state.strikes) {
      box.classList.add('active');
    } else {
      box.classList.remove('active');
    }
  });

  // 3. Lobby Seed Display & Host Controls
  if (lobbySeedDisplay) {
    lobbySeedDisplay.textContent = state.roundSeed || '------';
  }
  if (hostSeedControls) {
    hostSeedControls.style.display = (isHost && (state.status === 'waiting' || state.status === 'ready')) ? 'flex' : 'none';
  }

  // 4. Role Badges in Lobby
  if (state.roles) {
    Object.keys(state.roles).forEach((rKey) => {
      const rInfo = state.roles[rKey];
      const card = roleCards[rKey];
      const badge = roleBadges[rKey];
      if (!card || !badge) return;

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
      explodeReason.textContent = '⏰ زمان ۵ دقیقه‌ای بمب به اتمام رسید!';
    } else if (state.endReason === 'max_strikes') {
      explodeReason.textContent = '💥 تعداد خطاها (Strikes) به ۳ رسید و بمب منفجر شد!';
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
          (event, payload) => transport.send(event, payload),
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

      // Banner & Helper text adjustments
      if (isOperator(myRole)) {
        bomb3dRoleBanner.className = 'role-roleplay-banner blind-banner';
        bomb3dRoleBanner.innerHTML = '⚡ <strong>اپراتور (Operator — صدا فعال):</strong> دستان عملیاتی بمب! اجزای ۳D را لمس کنید و ریتم صوتی فانوس را با ضربه روی میز به ناظر انتقال دهید.';
        blindTactileHelper.style.display = 'block';
        deafVisualHelper.style.display = 'none';
      } else {
        bomb3dRoleBanner.className = 'role-roleplay-banner deaf-banner';
        bomb3dRoleBanner.innerHTML = '👁️ <strong>ناظر (Observer — صدا قطع):</strong> بمب را بچرخانید. پلاک سریال در پشت بمب است؛ رنگ‌ها و ریتم ضربات میز اپراتور را تحلیل و اعلام کنید.';
        blindTactileHelper.style.display = 'none';
        deafVisualHelper.style.display = 'block';
      }
    } else if (isManual(myRole)) {
      muteSection.classList.add('active');
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

    // Audio ticking strictly for Operator player
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

    // Role Operator physical interactions via keyboard
    if (isOperator(myRole)) {
      if (e.key === 'w' || e.key === 'W') {
        isWKeyActive = true;
      }

      // Keys 1..4:
      // If W is held/active: cut wire 0..3
      // Else: press keypad 0..3
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

      // Key C: Tune Beacon Channel (cycle 1 -> 2 -> 3 -> 1)
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

      // Key T: Transmit on active Beacon Channel
      if (e.key === 't' || e.key === 'T') {
        triggerHaptic([30, 20]);
        sound.playClick();
        transport.send('action', {
          moduleId: 'beacon',
          action: 'transmit'
        });
      }

      // Spacebar: Button press / hold
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

  if (e.code === 'Space' && isSpacePressed && myRole === 'blind') {
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
      <div class="manual-section" style="text-align: center; color: #94a3b8; padding: 24px;">
        ⏳ در انتظار دریافت قوانین عملیات از مرکز فرماندهی...
      </div>
    `;
    return;
  }

  const { seed, button, wires, keypad, beacon } = manual;

  // 1. Live Threat Level & Dynamic Status Matrix
  const modulesDefused = state?.modulesDefusedCount ?? Object.values(state?.modules || {}).filter(m => m?.solved).length;
  const totalModules = state?.totalModulesCount || 4;

  let threatPhaseText = '⚠️ فاز ۱: تسلیح کامل — هر ۴ ماژول فعال (تهدید حداکثری)';
  if (modulesDefused === 1) threatPhaseText = '⚡ فاز ۲: زنجیره بحران — ۳ ماژول فعال (پایداری متوسط)';
  else if (modulesDefused === 2) threatPhaseText = '⚡ فاز ۳: آستانه بحرانی — ۲ ماژول فعال (تشدید فرکانس)';
  else if (modulesDefused === 3) threatPhaseText = '🎯 فاز ۴: مرحله آخر — تنها ۱ ماژول باقی‌مانده (حساسیت بالا)';
  else if (modulesDefused >= 4) threatPhaseText = '🏆 خنثی‌سازی کامل: تمام سامانه‌ها ایمن شدند!';

  const isBtnSecured = Boolean(state?.modules?.button?.solved);
  const isWiresSecured = Boolean(state?.modules?.wires?.solved);
  const isKeypadSecured = Boolean(state?.modules?.keypad?.solved);
  const isBeaconSecured = Boolean(state?.modules?.beacon?.solved);

  const stepsHtml = Array.from({ length: totalModules }, (_, i) => `
    <div class="threat-step ${i < modulesDefused ? 'defused' : ''}"></div>
  `).join('');

  const matrixHtml = `
    <div class="threat-matrix-card" id="manual-matrix">
      <div class="threat-matrix-header">
        <span class="threat-phase-title">📊 ماتریس پویای وضعیت بمب</span>
        <span style="font-size: 0.75rem; color: #f59e0b; font-family: monospace;">SEED: ${seed || ''}</span>
      </div>
      <div style="font-size: 0.8rem; color: #e2e8f0; margin-bottom: 8px; font-weight: 500;">
        ${threatPhaseText}
      </div>
      <div class="threat-progress-bar">
        ${stepsHtml}
      </div>
      <div class="manual-modules-grid">
        <div class="module-status-pill ${isBtnSecured ? 'secured' : 'armed'}">
          <span>🔘 ۱. کاتالیزور</span>
          <span>${isBtnSecured ? '🟢 خنثی' : '🔴 مسلح'}</span>
        </div>
        <div class="module-status-pill ${isWiresSecured ? 'secured' : 'armed'}">
          <span>✂️ ۲. فیوزها</span>
          <span>${isWiresSecured ? '🟢 خنثی' : '🔴 مسلح'}</span>
        </div>
        <div class="module-status-pill ${isKeypadSecured ? 'secured' : 'armed'}">
          <span>🔣 ۳. کیپد</span>
          <span>${isKeypadSecured ? '🟢 خنثی' : '🔴 مسلح'}</span>
        </div>
        <div class="module-status-pill ${isBeaconSecured ? 'secured' : 'armed'}">
          <span>📡 ۴. فانوس صوتی</span>
          <span>${isBeaconSecured ? '🟢 خنثی' : '🔴 مسلح'}</span>
        </div>
      </div>
    </div>
  `;

  // 2. Navigation Tabs
  const navTabsHtml = `
    <div class="manual-nav-tabs">
      <button class="manual-tab-btn ${currentManualFilter === 'all' ? 'active' : ''}" data-filter="all">همه پروتکل‌ها</button>
      <button class="manual-tab-btn ${currentManualFilter === 'button' ? 'active' : ''}" data-filter="button">🔘 دکمه</button>
      <button class="manual-tab-btn ${currentManualFilter === 'wires' ? 'active' : ''}" data-filter="wires">✂️ سیم‌ها</button>
      <button class="manual-tab-btn ${currentManualFilter === 'keypad' ? 'active' : ''}" data-filter="keypad">🔣 کیپد</button>
      <button class="manual-tab-btn ${currentManualFilter === 'beacon' ? 'active' : ''}" data-filter="beacon">📡 فانوس صوتی</button>
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
      <li>نوار <strong>${r.colorName}</strong>: وقتی رقم یکان ثانیه‌شمار <strong>${r.digit}</strong> شد رها کن.</li>
    `).join('');

    buttonHtml = `
      <div class="manual-section" id="manual-button" style="margin-bottom: 12px;">
        <h4>🔘 ماژول ۱: دکمه کاتالیزور — <span style="font-size: 0.8rem; color: #38bdf8;">${button.protocolName || ''}</span></h4>
        <table class="rule-table">
          <thead>
            <tr>
              <th>شرط رنگ دکمه و سریال</th>
              <th>دستور اقدام به اپراتور</th>
            </tr>
          </thead>
          <tbody>
            ${tapRows}
            <tr>
              <td>${button.otherRow?.condition || 'سایر حالات دکمه'}</td>
              <td><strong>${button.otherRow?.action || 'دکمه را نگه‌دار و نوار رنگی کناری را بخوان'}</strong></td>
            </tr>
          </tbody>
        </table>

        <div style="margin-top: 10px; background: rgba(15, 23, 42, 0.6); padding: 8px 10px; border-radius: 8px; border: 1px solid #334155;">
          <strong style="font-size: 0.8rem; color: #38bdf8;">دستورالعمل رهاسازی در صورت نگه‌داشتن دکمه (بر اساس نوار رنگی کناری):</strong>
          <ul style="font-size: 0.76rem; color: #cbd5e1; margin: 4px 0 0 16px; line-height: 1.6;">
            ${stripRows}
          </ul>
        </div>
        <p style="font-size: 0.72rem; color: #94a3b8; margin-top: 8px;">
          📌 <em>${button.note || ''}</em>
        </p>
      </div>
    `;
  }

  // 4. Wires Module Section
  let wiresHtml = '';
  if (wires && (currentManualFilter === 'all' || currentManualFilter === 'wires')) {
    const steps = (wires.checklist || []).map(item => `
      <li>${item.condition} <strong>${item.action}</strong> را قطع کن.</li>
    `).join('');

    wiresHtml = `
      <div class="manual-section" id="manual-wires" style="margin-bottom: 12px;">
        <h4>✂️ ماژول ۲: فیوزهای سیم‌کشی — <span style="font-size: 0.8rem; color: #38bdf8;">${wires.protocolName || ''}</span></h4>
        <ul class="manual-checklist">
          ${steps}
        </ul>
        <p style="font-size: 0.72rem; color: #94a3b8; margin-top: 8px;">
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
        <h4>🔣 ماژول ۳: نمادهای رمزی صفحه‌کلید — <span style="font-size: 0.8rem; color: #38bdf8;">${keypad.protocolName || ''}</span></h4>
        <p style="font-size: 0.78rem; color: #94a3b8; margin-bottom: 8px;">
          ${keypad.note || 'از بین ۴ نمادی که ناظر گزارش می‌دهد، اپراتور باید نمادها را از چپ به راست طبق روبان اولویت زیر لمس کند:'}
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
        <h4>📡 ماژول ۴: فانوس صوتی (Acoustic Beacon) — <span style="font-size: 0.8rem; color: #38bdf8;">${beacon.protocolName || ''}</span></h4>
        
        <div style="font-size: 0.76rem; color: #cbd5e1; margin-bottom: 8px; line-height: 1.5;">
          تنها <strong>اپراتور</strong> ریتم صوتی بوق‌ها را می‌شنود و با <strong>ضربه روی میز</strong> به ناظر منتقل می‌کند.
          ناظر پلاک پشت بمب را بررسی می‌کند؛ سپس بر اساس <strong>زوج یا فرد بودن رقم آخر سریال</strong> کانال هدف را تعیین کنید:
        </div>

        <div class="parity-toggle-group">
          <button class="parity-toggle-btn ${isEven ? 'active' : ''}" data-parity="even">
            🔢 پلاک سریال زوج (Even Serial)
          </button>
          <button class="parity-toggle-btn ${!isEven ? 'active' : ''}" data-parity="odd">
            🔢 پلاک سریال فرد (Odd Serial)
          </button>
        </div>

        <table class="rule-table">
          <thead>
            <tr>
              <th>نوع پالس</th>
              <th style="text-align: center;">ریتم ضربه روی میز</th>
              <th style="text-align: center;">کانال سلکتور هدف</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>

        <div style="margin-top: 10px; background: rgba(15, 23, 42, 0.6); padding: 8px 10px; border-radius: 8px; border: 1px solid #334155; font-size: 0.74rem; color: #cbd5e1;">
          <strong style="color: #f59e0b;">راهنمای ریتم ضربات میز:</strong>
          <ul style="margin: 4px 0 0 16px; line-height: 1.6;">
            <li><strong>·· — · (وکتور):</strong> دو ضربه تند، مکث، یک ضربه بلند، یک ضربه کوتاه</li>
            <li><strong>— · — · (سیگما):</strong> یک ضربه بلند، یک کوتاه، یک بلند، یک کوتاه</li>
            <li><strong>· — — · (دلتا):</strong> یک ضربه کوتاه، دو ضربه بلند، یک ضربه کوتاه</li>
            <li><strong>— — · · (امگا):</strong> دو ضربه بلند، دو ضربه تند و کوتاه</li>
          </ul>
        </div>

        <p style="font-size: 0.72rem; color: #94a3b8; margin-top: 8px;">
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


