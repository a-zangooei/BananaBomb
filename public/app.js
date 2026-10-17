import { GameTransport } from './transport.js';
import { sound } from './audio.js';
import { Bomb3DScene, isWebGLAvailable } from './bomb3d.js';

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

// Role Cards
const roleCards = {
  blind: document.getElementById('cardBlind'),
  deaf: document.getElementById('cardDeaf'),
  mute: document.getElementById('cardMute')
};
const roleBadges = {
  blind: document.getElementById('badgeBlind'),
  deaf: document.getElementById('badgeDeaf'),
  mute: document.getElementById('badgeMute')
};

// Buttons
const btnUnlockAudio = document.getElementById('btnUnlockAudio');
const audioBanner = document.getElementById('audioBanner');
const btnStartGame = document.getElementById('btnStartGame');
const btnLeaveRole = document.getElementById('btnLeaveRole');
const btnRestartExploded = document.getElementById('btnRestartExploded');
const btnRestartDefused = document.getElementById('btnRestartDefused');

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

  if (eventType === 'state_update') {
    const prevState = currentGameState;
    currentGameState = data.state;

    // Strictly gate audio: Only Blind role hears any audio
    sound.setEnabled(myRole === 'blind');

    // Trigger one-time explosion or defusal sounds upon state change
    if (prevState?.status !== 'exploded' && currentGameState.status === 'exploded') {
      if (myRole === 'blind') sound.playExplosion();
    } else if (prevState?.status !== 'defused' && currentGameState.status === 'defused') {
      if (myRole === 'blind') sound.playDefused();
    }

    lastGameStatus = currentGameState.status;
    renderState(currentGameState);
    return;
  }

  if (eventType === 'role_assigned') {
    myRole = data.role;
    sessionStorage.setItem('defusal_role', myRole);
    sound.setEnabled(myRole === 'blind');
    if (myRole === 'blind') {
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
    if (myRole === 'blind') {
      sound.playStrike();
    }
    triggerHaptic([120, 60, 120]);
    flashRedAlert();
    return;
  }

  if (eventType === 'module_solved') {
    if (myRole === 'blind') {
      sound.playDefused();
    }
    return;
  }

  if (eventType === 'error') {
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

  // 1. Serial Number Tag
  if (myRole === 'deaf' && state.serialNumber) {
    serialTag.textContent = `SERIAL: ${state.serialNumber} (پلاک پشت بمب را بخوانید)`;
  } else if (state.status === 'running') {
    serialTag.textContent = 'SERIAL: [پلاک محرمانه / فقط در دسترس ناشنوا]';
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

  // 3. Role Badges in Lobby
  if (state.roles) {
    Object.keys(state.roles).forEach((rKey) => {
      const rInfo = state.roles[rKey];
      const card = roleCards[rKey];
      const badge = roleBadges[rKey];
      if (!card || !badge) return;

      const isMine = rInfo.playerId === playerId;
      card.classList.toggle('selected', isMine);

      if (rInfo.connected) {
        card.classList.add('taken');
        badge.className = 'role-status-badge ready';
        badge.textContent = isMine ? 'شما (متصل)' : 'بازیکن متصل';
      } else if (rInfo.playerId) {
        card.classList.add('taken');
        badge.className = 'role-status-badge offline';
        badge.textContent = isMine ? 'شما (قطع شده)' : 'قطع ارتباط';
      } else {
        card.classList.remove('taken');
        badge.className = 'role-status-badge';
        badge.textContent = 'خالی';
      }
    });
  }

  // 4. Start Button Readiness Guard
  if (btnStartGame) {
    const isReady = state.status === 'ready';
    btnStartGame.disabled = !isReady;
    if (isReady) {
      btnStartGame.textContent = '💣 شروع عملیات خنثی‌سازی (تیم آماده است)';
    } else if (state.status === 'waiting') {
      btnStartGame.textContent = '💣 شروع عملیات خنثی‌سازی (منتظر ۳ بازیکن)';
    } else {
      btnStartGame.textContent = 'عملیات در جریان است...';
    }
  }

  // 5. Overlays Management
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
    return;
  }

  if (state.status === 'defused') {
    overlayDefused.classList.add('active');
    defusedStats.textContent = `تبریک به تیم! بمب با ${state.strikes} خطا و در زمان ${formatTime(state.remainingSeconds)} با موفقیت خنثی شد.`;
    return;
  }

  // 6. Section Router
  [lobbySection, bomb3dSection, muteSection].forEach((sec) => sec.classList.remove('active'));

  if (state.status === 'running') {
    if (myRole === 'blind' || myRole === 'deaf') {
      bomb3dSection.classList.add('active');

      // Lazy initialize or update Three.js scene
      if (!bombScene && bomb3dContainer && isWebGLAvailable()) {
        bombScene = new Bomb3DScene(
          bomb3dContainer,
          myRole,
          (event, payload) => transport.send(event, payload),
          () => getCurrentRemainingSeconds()
        );
      }

      if (bombScene) {
        bombScene.setRole(myRole);
        bombScene.updateState(state);
        bombScene.resize();
      }

      // Banner & Helper text adjustments
      if (myRole === 'blind') {
        bomb3dRoleBanner.className = 'role-roleplay-banner blind-banner';
        bomb3dRoleBanner.innerHTML = '👁️ <strong>نقش نابینا (صدا فعال):</strong> تنها شما دستان بمب هستید! با لمس اجزای ۳ بعدی ماژول‌ها را خنثی کنید.';
        blindTactileHelper.style.display = 'block';
        deafVisualHelper.style.display = 'none';
      } else {
        bomb3dRoleBanner.className = 'role-roleplay-banner deaf-banner';
        bomb3dRoleBanner.innerHTML = '👂 <strong>نقش ناشنوا (صدا قطع):</strong> بمب را بچرخانید. پلاک سریال در پشت بمب است؛ رنگ‌ها و نمادها را گزارش دهید.';
        blindTactileHelper.style.display = 'none';
        deafVisualHelper.style.display = 'block';
      }
    } else if (myRole === 'mute') {
      muteSection.classList.add('active');
    } else {
      lobbySection.classList.add('active');
    }
  } else {
    lobbySection.classList.add('active');
  }
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

    // Audio ticking strictly for Blind player
    const currentSec = Math.floor(remaining);
    if (currentSec !== lastTickSecond) {
      lastTickSecond = currentSec;
      if (myRole === 'blind') {
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
