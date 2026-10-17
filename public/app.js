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

// Blind Interactive Elements
const blindReactorBtn = document.getElementById('blindReactorBtn');
const blindSideStrip = document.getElementById('blindSideStrip');
const blindWiresContainer = document.getElementById('blindWiresContainer');
const blindKeypadContainer = document.getElementById('blindKeypadContainer');
const blindLedButton = document.getElementById('blindLedButton');
const blindLedWires = document.getElementById('blindLedWires');
const blindLedKeypad = document.getElementById('blindLedKeypad');

// Deaf Read-Only Observation Elements
const deafReactorBtn = document.getElementById('deafReactorBtn');
const deafSideStrip = document.getElementById('deafSideStrip');
const deafWiresContainer = document.getElementById('deafWiresContainer');
const deafKeypadContainer = document.getElementById('deafKeypadContainer');
const deafLedButton = document.getElementById('deafLedButton');
const deafLedWires = document.getElementById('deafLedWires');
const deafLedKeypad = document.getElementById('deafLedKeypad');

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
    syncStatus.textContent = `همگام‌سازی: ${Math.abs(data.serverOffset)}ms`;
    return;
  }

  if (eventType === 'state_update') {
    currentGameState = data.state;
    // Audio is strictly enabled ONLY for 'blind' role
    sound.setEnabled(myRole === 'blind');
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
    triggerHaptic([100, 50, 100]);
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

  // 1. Serial Number Tag (Only Deaf sees serial, Blind & Mute see masked tag)
  if (myRole === 'deaf' && state.serialNumber) {
    serialTag.textContent = `SERIAL: ${state.serialNumber} (مشاهده اختصاصی ناشنوا)`;
  } else if (state.status === 'running') {
    serialTag.textContent = 'SERIAL: [مخدوش / فقط پیش ناشنوا]';
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

  // 4. Overlays Management
  overlayExploded.classList.remove('active');
  overlayDefused.classList.remove('active');

  if (state.status === 'exploded') {
    overlayExploded.classList.add('active');
    if (state.endReason === 'time_out') {
      explodeReason.textContent = '⏰ زمان ۵ دقیقه‌ای بمب به اتمام رسید!';
    } else if (state.endReason === 'max_strikes') {
      explodeReason.textContent = '💥 تعداد خطاها (Strikes) به ۳ رسید و مدار ترکید!';
    } else {
      explodeReason.textContent = 'بمب منفجر شد!';
    }
    if (myRole === 'blind') {
      sound.playExplosion();
    }
    return;
  }

  if (state.status === 'defused') {
    overlayDefused.classList.add('active');
    defusedStats.textContent = `تبریک به تیم! بمب با ${state.strikes} خطا و در زمان ${formatTime(state.remainingSeconds)} با موفقیت خنثی شد.`;
    if (myRole === 'blind') {
      sound.playDefused();
    }
    return;
  }

  // 5. Active Section Router based on Role
  [lobbySection, blindSection, deafSection, muteSection].forEach((sec) => sec.classList.remove('active'));

  if (state.status === 'running') {
    if (myRole === 'blind') {
      blindSection.classList.add('active');
      renderBlindCockpit(state.modules);
    } else if (myRole === 'deaf') {
      deafSection.classList.add('active');
      renderDeafObservation(state.modules);
    } else if (myRole === 'mute') {
      muteSection.classList.add('active');
    } else {
      lobbySection.classList.add('active');
    }
  } else {
    lobbySection.classList.add('active');
  }
}

// --- 1. Blind Technician Cockpit (Monochrome, Interactive) ---
function renderBlindCockpit(modules) {
  if (!modules) return;

  // Module 1: Reactor Button (Monochrome)
  const btn = modules.button;
  if (btn) {
    blindLedButton.classList.toggle('on', btn.solved);
    blindReactorBtn.disabled = btn.solved;
    blindReactorBtn.textContent = btn.solved ? 'خنثی شد ✓' : 'دکمه خنثی‌ساز';
  }

  // Module 2: Wires (4 Gray Wires with Scissors)
  const w = modules.wires;
  if (w && blindWiresContainer) {
    blindLedWires.classList.toggle('on', w.solved);
    blindWiresContainer.innerHTML = '';
    const wireCount = w.count || 4;

    for (let idx = 0; idx < wireCount; idx++) {
      const isCut = w.cutWires.includes(idx);
      const row = document.createElement('div');
      row.className = 'wire-row';
      row.innerHTML = `
        <span style="font-size: 0.82rem; font-family: monospace; color: #a1a1aa; font-weight: bold;">سیم #${idx + 1}</span>
        <div class="wire-cable gray ${isCut ? 'cut' : ''}"></div>
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

      blindWiresContainer.appendChild(row);
    }
  }

  // Module 3: Keypad (4 generic numbered buttons)
  const kp = modules.keypad;
  if (kp && blindKeypadContainer) {
    blindLedKeypad.classList.toggle('on', kp.solved);
    blindKeypadContainer.innerHTML = '';
    const slotCount = kp.slotCount || 4;

    for (let slotIdx = 0; slotIdx < slotCount; slotIdx++) {
      const isEntered = slotIdx < (kp.enteredCount || 0);
      const keyBtn = document.createElement('button');
      keyBtn.className = `keypad-btn ${isEntered ? 'entered' : ''}`;
      keyBtn.textContent = `کلید [ ${slotIdx + 1} ]`;
      keyBtn.disabled = isEntered || kp.solved;

      keyBtn.addEventListener('click', () => {
        sound.playClick();
        triggerHaptic([40]);
        transport.send('action', {
          moduleId: 'keypad',
          action: 'press',
          data: { slotIndex: slotIdx }
        });
      });

      blindKeypadContainer.appendChild(keyBtn);
    }
  }
}

// --- 2. Deaf Observation Cockpit (Real Colors, Read-Only, No Audio) ---
function renderDeafObservation(modules) {
  if (!modules) return;

  // Module 1: Reactor Button (Real Colors)
  const btn = modules.button;
  if (btn) {
    deafLedButton.classList.toggle('on', btn.solved);
    deafReactorBtn.textContent = btn.solved ? 'خنثی شد ✓' : (btn.label || 'خنثی‌سازی');
    deafReactorBtn.className = `reactor-button readonly ${btn.color || 'white'}`;
    if (btn.holdStripColor) {
      deafSideStrip.className = `side-strip active-${btn.holdStripColor}`;
    } else {
      deafSideStrip.className = 'side-strip';
    }
  }

  // Module 2: Wires (Real Colors, No Scissors)
  const w = modules.wires;
  if (w && deafWiresContainer) {
    deafLedWires.classList.toggle('on', w.solved);
    deafWiresContainer.innerHTML = '';
    const colorNames = { red: 'قرمز', blue: 'آبی', yellow: 'زرد', green: 'سبز' };

    (w.wires || []).forEach((color, idx) => {
      const isCut = w.cutWires.includes(idx);
      const row = document.createElement('div');
      row.className = 'wire-row';
      row.innerHTML = `
        <span class="wire-color-tag" style="color: ${getWireHex(color)}">#${idx + 1} (${colorNames[color] || color})</span>
        <div class="wire-cable ${color} ${isCut ? 'cut' : ''}"></div>
        <span style="font-size: 0.75rem; color: ${isCut ? '#ef4444' : '#10b981'}; font-weight: bold; min-width: 55px; text-align: left;">
          ${isCut ? 'قطع شده' : 'سالم'}
        </span>
      `;
      deafWiresContainer.appendChild(row);
    });
  }

  // Module 3: Keypad (Real Symbols, Read-Only)
  const kp = modules.keypad;
  if (kp && deafKeypadContainer) {
    deafLedKeypad.classList.toggle('on', kp.solved);
    deafKeypadContainer.innerHTML = '';

    (kp.symbols || []).forEach((sym, idx) => {
      const card = document.createElement('div');
      card.className = 'keypad-symbol-card';
      card.innerHTML = `<span style="font-size: 0.75rem; color: #64748b; margin-left: 6px;">#${idx + 1}:</span> ${sym}`;
      deafKeypadContainer.appendChild(card);
    });
  }
}

function getWireHex(color) {
  if (color === 'red') return '#ef4444';
  if (color === 'blue') return '#3b82f6';
  if (color === 'yellow') return '#eab308';
  if (color === 'green') return '#22c55e';
  return '#cbd5e1';
}

// --- Blind Reactor Button Press / Hold Logic ---
if (blindReactorBtn) {
  function startButtonHold(e) {
    e.preventDefault();
    sound.init();
    sound.playClick();
    triggerHaptic([30]);

    if (!currentGameState?.modules?.button || currentGameState.modules.button.solved) return;

    buttonPressStartTime = Date.now();
    blindSideStrip.className = 'side-strip monochrome active-monochrome';
  }

  function endButtonHold(e) {
    e.preventDefault();
    if (!buttonPressStartTime) return;

    const duration = Date.now() - buttonPressStartTime;
    clearTimeout(buttonPressTimer);
    buttonPressStartTime = null;
    blindSideStrip.className = 'side-strip monochrome';

    const remaining = getCurrentRemainingSeconds();
    const currentTimerLastDigit = Math.floor(remaining) % 10;

    if (duration < 350) {
      transport.send('action', {
        moduleId: 'button',
        action: 'press'
      });
    } else {
      transport.send('action', {
        moduleId: 'button',
        action: 'release',
        data: { releaseDigit: currentTimerLastDigit }
      });
    }
  }

  blindReactorBtn.addEventListener('pointerdown', startButtonHold);
  blindReactorBtn.addEventListener('pointerup', endButtonHold);
  blindReactorBtn.addEventListener('pointercancel', endButtonHold);
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
