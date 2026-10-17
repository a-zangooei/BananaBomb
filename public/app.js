import { GameTransport } from './transport.js';
import { sound } from './audio.js';

// --- Client Session & State ---
let playerId = sessionStorage.getItem('defusal_player_id');
if (!playerId) {
  playerId = 'p_' + Math.random().toString(36).substring(2, 10);
  sessionStorage.setItem('defusal_player_id', playerId);
}

let myRole = sessionStorage.getItem('defusal_role') || null;
let currentGameState = null;
let lastTickSecond = null;
let buttonPressStartTime = null;
let buttonPressTimer = null;

// Initialize Transport Abstraction
const transport = new GameTransport();

// DOM Element References
const pingDot = document.getElementById('pingDot');
const connStatus = document.getElementById('connStatus');
const pingVal = document.getElementById('pingVal');
const syncStatus = document.getElementById('syncStatus');
const serialTag = document.getElementById('serialTag');
const timerDisplay = document.getElementById('timerDisplay');
const strikeBoxes = [
  document.getElementById('strike1'),
  document.getElementById('strike2'),
  document.getElementById('strike3')
];

// Views
const lobbySection = document.getElementById('lobbySection');
const blindSection = document.getElementById('blindSection');
const deafSection = document.getElementById('deafSection');
const muteSection = document.getElementById('muteSection');
const overlayExploded = document.getElementById('overlayExploded');
const overlayDefused = document.getElementById('overlayDefused');
const explodeReason = document.getElementById('explodeReason');
const defusedStats = document.getElementById('defusedStats');

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

// Controls
const btnUnlockAudio = document.getElementById('btnUnlockAudio');
const audioBanner = document.getElementById('audioBanner');
const btnStartGame = document.getElementById('btnStartGame');
const btnLeaveRole = document.getElementById('btnLeaveRole');
const btnRestartExploded = document.getElementById('btnRestartExploded');
const btnRestartDefused = document.getElementById('btnRestartDefused');

// Mute Cockpit Elements
const bombReactorBtn = document.getElementById('bombReactorBtn');
const btnSideStrip = document.getElementById('btnSideStrip');
const wiresContainer = document.getElementById('wiresContainer');
const keypadContainer = document.getElementById('keypadContainer');
const ledButton = document.getElementById('ledButton');
const ledWires = document.getElementById('ledWires');
const ledKeypad = document.getElementById('ledKeypad');
const btnMuteBell = document.getElementById('btnMuteBell');
const btnBlindListen = document.getElementById('btnBlindListen');

// --- User Interaction & Audio Initialization ---
function unlockAudio() {
  sound.init();
  sound.playClick();
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
      // Attempt auto-reconnect with stored role and playerId
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
    syncStatus.textContent = `اختلاف ساعت: ${Math.abs(data.serverOffset)}ms`;
    return;
  }

  if (eventType === 'state_update') {
    currentGameState = data.state;
    renderState(currentGameState);
    return;
  }

  if (eventType === 'role_assigned') {
    myRole = data.role;
    sessionStorage.setItem('defusal_role', myRole);
    sound.playClick();
    if (btnLeaveRole) btnLeaveRole.style.display = 'block';
    return;
  }

  if (eventType === 'role_released') {
    myRole = null;
    sessionStorage.removeItem('defusal_role');
    if (btnLeaveRole) btnLeaveRole.style.display = 'none';
    return;
  }

  if (eventType === 'strike') {
    sound.playStrike();
    triggerHaptic([100, 50, 100]);
    flashRedAlert();
    return;
  }

  if (eventType === 'module_solved') {
    sound.playDefused();
    return;
  }

  if (eventType === 'error') {
    alert(data.message || 'خطا در بازی');
    return;
  }
});

// --- Role Selection Interaction ---
Object.keys(roleCards).forEach((roleKey) => {
  const card = roleCards[roleKey];
  if (!card) return;

  card.addEventListener('click', () => {
    sound.init();
    sound.playClick();

    if (myRole === roleKey) return; // Already in this role

    transport.send('join', {
      role: roleKey,
      playerId
    });
  });
});

if (btnLeaveRole) {
  btnLeaveRole.addEventListener('click', () => {
    sound.playClick();
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
    sound.playClick();
    transport.send('reset');
  });
}

if (btnRestartDefused) {
  btnRestartDefused.addEventListener('click', () => {
    sound.playClick();
    transport.send('reset');
  });
}

// --- Render State Function ---
function renderState(state) {
  if (!state) return;

  // 1. Serial Number Tag
  if (state.serialNumber) {
    serialTag.textContent = `SERIAL: ${state.serialNumber} | SEED: ${state.seed || '---'}`;
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

  // 4. Overlays & Active Section Router
  overlayExploded.classList.remove('active');
  overlayDefused.classList.remove('active');

  if (state.status === 'exploded') {
    overlayExploded.classList.add('active');
    if (state.endReason === 'time_out') {
      explodeReason.textContent = '⏰ زمان ۵ دقیقه‌ای بمب به اتمام رسید!';
    } else if (state.endReason === 'max_strikes') {
      explodeReason.textContent = '💥 تعداد خطاها (Strikes) به سقف مجاز رسید!';
    } else {
      explodeReason.textContent = 'بمب منفجر شد!';
    }
    sound.playExplosion();
    return;
  }

  if (state.status === 'defused') {
    overlayDefused.classList.add('active');
    defusedStats.textContent = `تبریک! بمب با ${state.strikes} خطا و در زمان باقی‌مانده ${formatTime(state.remainingSeconds)} خنثی شد.`;
    sound.playDefused();
    return;
  }

  // View Sections Management
  [lobbySection, blindSection, deafSection, muteSection].forEach((sec) => sec.classList.remove('active'));

  if (state.status === 'running') {
    if (myRole === 'blind') {
      blindSection.classList.add('active');
    } else if (myRole === 'deaf') {
      deafSection.classList.add('active');
    } else if (myRole === 'mute') {
      muteSection.classList.add('active');
      renderMuteCockpit(state.modules);
    } else {
      // Spectator or player not yet picked role
      lobbySection.classList.add('active');
    }
  } else {
    // Waiting or Ready state
    lobbySection.classList.add('active');
  }
}

// --- Mute Technician Cockpit Rendering ---
function renderMuteCockpit(modules) {
  if (!modules) return;

  // Module 1: Reactor Button
  const btn = modules.button;
  if (btn) {
    bombReactorBtn.textContent = btn.label;
    bombReactorBtn.className = `reactor-button ${btn.color}`;
    ledButton.classList.toggle('on', btn.solved);
    bombReactorBtn.disabled = btn.solved;

    if (btn.solved) {
      bombReactorBtn.textContent = 'خنثی شد ✓';
    }
  }

  // Module 2: Wires
  const w = modules.wires;
  if (w && wiresContainer) {
    ledWires.classList.toggle('on', w.solved);
    wiresContainer.innerHTML = '';
    w.wires.forEach((color, idx) => {
      const isCut = w.cutWires.includes(idx);
      const row = document.createElement('div');
      row.className = 'wire-row';
      row.innerHTML = `
        <span style="font-size: 0.8rem; font-family: monospace; color: #94a3b8;">سیم #${idx + 1}</span>
        <div class="wire-cable ${color} ${isCut ? 'cut' : ''}"></div>
        <button class="snip-btn" data-index="${idx}" ${isCut || w.solved ? 'disabled' : ''}>
          ${isCut ? 'قطع شد ✗' : 'قیچی ✂'}
        </button>
      `;

      const snipBtn = row.querySelector('.snip-btn');
      snipBtn.addEventListener('click', () => {
        sound.playWireCut();
        triggerHaptic([60]);
        transport.send('action', {
          moduleId: 'wires',
          action: 'cut',
          data: { wireIndex: idx }
        });
      });

      wiresContainer.appendChild(row);
    });
  }

  // Module 3: Keypad
  const kp = modules.keypad;
  if (kp && keypadContainer) {
    ledKeypad.classList.toggle('on', kp.solved);
    keypadContainer.innerHTML = '';
    kp.symbols.forEach((sym) => {
      const isEntered = kp.enteredOrder.includes(sym);
      const keyBtn = document.createElement('button');
      keyBtn.className = `keypad-btn ${isEntered ? 'entered' : ''}`;
      keyBtn.textContent = sym;
      keyBtn.disabled = isEntered || kp.solved;

      keyBtn.addEventListener('click', () => {
        sound.playClick();
        triggerHaptic([40]);
        transport.send('action', {
          moduleId: 'keypad',
          action: 'press',
          data: { symbol: sym }
        });
      });

      keypadContainer.appendChild(keyBtn);
    });
  }
}

// --- Reactor Button Hold & Release Logic ---
if (bombReactorBtn) {
  function startButtonHold(e) {
    e.preventDefault();
    sound.init();
    sound.playClick();
    triggerHaptic([30]);

    if (!currentGameState?.modules?.button || currentGameState.modules.button.solved) return;

    buttonPressStartTime = Date.now();
    btnSideStrip.className = 'side-strip active-yellow';

    // Show side strip color after brief hold
    buttonPressTimer = setTimeout(() => {
      const stripColor = currentGameState.modules.button.holdStripColor || 'blue';
      btnSideStrip.className = `side-strip active-${stripColor}`;
    }, 250);
  }

  function endButtonHold(e) {
    e.preventDefault();
    if (!buttonPressStartTime) return;

    const duration = Date.now() - buttonPressStartTime;
    clearTimeout(buttonPressTimer);
    buttonPressStartTime = null;
    btnSideStrip.className = 'side-strip';

    // Get current synchronized seconds digit
    const remaining = getCurrentRemainingSeconds();
    const currentTimerLastDigit = Math.floor(remaining) % 10;

    if (duration < 350) {
      // Quick click/tap
      transport.send('action', {
        moduleId: 'button',
        action: 'press'
      });
    } else {
      // Released after hold
      transport.send('action', {
        moduleId: 'button',
        action: 'release',
        data: { releaseDigit: currentTimerLastDigit }
      });
    }
  }

  bombReactorBtn.addEventListener('pointerdown', startButtonHold);
  bombReactorBtn.addEventListener('pointerup', endButtonHold);
  bombReactorBtn.addEventListener('pointercancel', endButtonHold);
}

// --- Non-verbal Bell for Mute Player ---
if (btnMuteBell) {
  btnMuteBell.addEventListener('click', () => {
    sound.init();
    sound.playTone(880, 0.25);
    triggerHaptic([50, 50, 50]);
  });
}

// --- Blind Role Acoustic Cue Button ---
if (btnBlindListen) {
  btnBlindListen.addEventListener('click', () => {
    sound.init();
    if (!currentGameState?.modules?.button) {
      sound.playTone(440, 0.3);
      return;
    }
    const color = currentGameState.modules.button.color;
    const toneMap = { red: 520, blue: 660, yellow: 440, white: 880 };
    sound.playTone(toneMap[color] || 440, 0.4);
    triggerHaptic([80]);
  });
}

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
  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);

  timerDisplay.textContent = formatTime(remaining);

  if (currentGameState.status === 'running') {
    // Urgent pulse styling when time < 60s
    if (remaining <= 60) {
      timerDisplay.classList.add('urgent');
    } else {
      timerDisplay.classList.remove('urgent');
    }

    // Audio ticking on whole second change
    const currentSec = Math.floor(remaining);
    if (currentSec !== lastTickSecond) {
      lastTickSecond = currentSec;
      if (remaining <= 30) {
        sound.playUrgentBeep();
      } else {
        sound.playTick(remaining <= 60 ? 1200 : 900);
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
