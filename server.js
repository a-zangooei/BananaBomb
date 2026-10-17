import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files from 'public' directory
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// Fallback route for index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// --- Network Interface Logger with Termux Graceful Handling ---
function printNetworkInterfaces(port) {
  console.log('='.repeat(56));
  console.log('💣  پروتکل ۳: بازی همکارانه خنثی‌سازی بمب (۳ نفره محلی)');
  console.log('='.repeat(56));
  console.log(`🌐 پورت سرور: ${port}`);
  console.log(`💻 مرورگر همین دستگاه: http://localhost:${port}`);
  console.log('\n📱 آدرس اتصال برای سایر گوشی‌ها در شبکه Wi-Fi یا هات‌اسپات:');

  try {
    const interfaces = os.networkInterfaces();
    let count = 0;
    for (const name of Object.keys(interfaces)) {
      const netList = interfaces[name];
      if (!netList) continue;
      for (const net of netList) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`   ➜ [${name}] http://${net.address}:${port}`);
          count++;
        }
      }
    }
    if (count === 0) {
      console.log('   ℹ️ هیچ کارت شبکه خارجی فعالی شناسایی نشد. به وای‌فای یا هات‌اسپات متصل شوید.');
    }
  } catch (err) {
    console.warn('\n⚠️ خطا در خواندن خودکار os.networkInterfaces() (این اتفاق در Termux اندروید رایج است).');
    console.warn('📌 لطفا آدرس IP دستگاه را از تنظیمات Hotspot گوشی، یا با اجرای دستور "ifconfig" یا "ip addr" در Termux مشاهده کنید:');
    console.warn(`   ➜ آدرس قابل استفاده: http://<IP_گوشی>:${port}\n`);
  }
  console.log('='.repeat(56));
}

// --- Authoritative Game State Engine ---
const ROLES = ['blind', 'deaf', 'mute'];

const roleMeta = {
  blind: { title: 'نابینا (Blind)', subtitle: 'تنها تعامل‌گر با بمب؛ ظاهر مونوکروم و تنها نقش دارای صدا' },
  deaf: { title: 'ناشنوا (Deaf)', subtitle: 'مشاهده کامل رنگ‌ها و سریال بمب؛ بدون امکان لمس و بدون صدا' },
  mute: { title: 'بی‌کلام (Mute)', subtitle: 'دفترچه راهنمای قوانین رمزگشایی؛ فقط مطالعه قوانین بدون لمس و صدا' }
};

let roles = {
  blind: { playerId: null, connected: false, joinedAt: null },
  deaf: { playerId: null, connected: false, joinedAt: null },
  mute: { playerId: null, connected: false, joinedAt: null }
};

let gameState = {
  status: 'waiting', // 'waiting' | 'ready' | 'running' | 'exploded' | 'defused'
  seed: null,
  startTime: null,      // Server timestamp in ms
  duration: 300,        // 5 minutes in seconds
  remainingSeconds: 300,
  strikes: 0,
  maxStrikes: 3,
  serialNumber: '',
  endReason: null,      // 'time_out' | 'max_strikes' | 'defused'
  modules: {}           // Authoritative modules data (contains secrets, NEVER sent raw)
};

let gameTimerInterval = null;

// Track active WebSocket connections: ws -> { playerId, role }
const activeSockets = new Map();

// --- Fixed Seeded RNG with correct bitwise operator precedence ---
function createRng(seedStr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 16777619);
  }
  return function () {
    h += h << 13;
    h ^= h >>> 7;
    h += h << 3;
    h ^= h >>> 17;
    return ((h += h << 5) >>> 0) / 4294967296;
  };
}

function generateRandomSeed() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function initializeModules(seed) {
  const rng = createRng(seed);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '0123456789';

  // Generate Bomb Serial Number: e.g. 'B7-49-X2'
  const serial = `${chars[Math.floor(rng() * chars.length)]}${digits[Math.floor(rng() * digits.length)]}-${digits[Math.floor(rng() * digits.length)]}${digits[Math.floor(rng() * digits.length)]}-${chars[Math.floor(rng() * chars.length)]}${digits[Math.floor(rng() * digits.length)]}`;
  const lastSerialDigit = parseInt(serial[serial.length - 1], 10);
  const isSerialEven = lastSerialDigit % 2 === 0;

  // Module 1: The Reactor Button (دکمه کاتالیزور)
  const buttonColors = ['red', 'blue', 'yellow', 'white'];
  const buttonColor = buttonColors[Math.floor(rng() * buttonColors.length)];
  const buttonLabels = ['خنثی‌سازی', 'نگه‌دار', 'انفجار', 'هشدار'];
  const buttonLabel = buttonLabels[Math.floor(rng() * buttonLabels.length)];
  const stripColors = ['yellow', 'blue', 'white'];
  const holdStripColor = stripColors[Math.floor(rng() * stripColors.length)];

  // Logical rules for button:
  let actionType = 'hold';
  let targetReleaseDigit = 1;

  if (buttonColor === 'white') {
    actionType = 'press';
    targetReleaseDigit = null;
  } else if (buttonColor === 'red' && !isSerialEven) {
    actionType = 'press';
    targetReleaseDigit = null;
  } else if (buttonColor === 'blue') {
    actionType = 'hold';
    targetReleaseDigit = 4;
  } else if (buttonColor === 'yellow') {
    actionType = 'hold';
    targetReleaseDigit = 7;
  } else {
    actionType = 'hold';
    targetReleaseDigit = 1;
  }

  // Module 2: The Wire Sequencer (مدار ۴ سیمه)
  const availableColors = ['red', 'blue', 'yellow', 'green'];
  const wires = [];
  for (let i = 0; i < 4; i++) {
    wires.push(availableColors[Math.floor(rng() * availableColors.length)]);
  }

  const redCount = wires.filter((c) => c === 'red').length;
  const blueCount = wires.filter((c) => c === 'blue').length;
  let correctWireIndex = 3;
  if (redCount > 1) {
    correctWireIndex = 1;
  } else if (wires[3] === 'yellow') {
    correctWireIndex = 0;
  } else if (blueCount === 1) {
    correctWireIndex = 2;
  } else {
    correctWireIndex = 3;
  }

  // Module 3: The Cipher Keypad (صفحه کلید رمزی)
  const symbolPool = ['⚡', '★', 'Ω', 'Ψ', '▲', '◆', '✦', '⚙'];
  const shuffledSymbols = [...symbolPool].sort(() => rng() - 0.5).slice(0, 4);
  const correctOrder = [...shuffledSymbols].sort((a, b) => symbolPool.indexOf(a) - symbolPool.indexOf(b));

  return {
    serialNumber: serial,
    isSerialEven,
    modules: {
      button: {
        id: 'button',
        title: 'ماژول ۱: دکمه کاتالیزور',
        color: buttonColor,
        label: buttonLabel,
        holdStripColor,
        actionType,
        targetReleaseDigit,
        solved: false
      },
      wires: {
        id: 'wires',
        title: 'ماژول ۲: فیوزهای چهارگانه',
        wires,
        correctWireIndex,
        cutWires: [],
        solved: false
      },
      keypad: {
        id: 'keypad',
        title: 'ماژول ۳: نمادهای رمزی',
        symbols: shuffledSymbols,
        correctOrder,
        enteredOrder: [],
        solved: false
      }
    }
  };
}

// Check whether all modules are defused
function checkDefused() {
  const m = gameState.modules;
  return m.button?.solved && m.wires?.solved && m.keypad?.solved;
}

// --- Role-filtered state generation (Secrets are NEVER leaked) ---
function getFilteredStateForRole(role) {
  const common = {
    status: gameState.status,
    seed: gameState.seed,
    startTime: gameState.startTime,
    duration: gameState.duration,
    remainingSeconds: gameState.remainingSeconds,
    strikes: gameState.strikes,
    maxStrikes: gameState.maxStrikes,
    endReason: gameState.endReason,
    roles: {
      blind: { playerId: roles.blind.playerId, connected: roles.blind.connected, title: roleMeta.blind.title, subtitle: roleMeta.blind.subtitle },
      deaf: { playerId: roles.deaf.playerId, connected: roles.deaf.connected, title: roleMeta.deaf.title, subtitle: roleMeta.deaf.subtitle },
      mute: { playerId: roles.mute.playerId, connected: roles.mute.connected, title: roleMeta.mute.title, subtitle: roleMeta.mute.subtitle }
    },
    serverTimestamp: Date.now()
  };

  if (gameState.status !== 'running' && gameState.status !== 'exploded' && gameState.status !== 'defused') {
    return {
      ...common,
      serialNumber: null,
      modules: null,
      canInteract: false
    };
  }

  const m = gameState.modules;
  if (!m || !m.button) {
    return { ...common, serialNumber: null, modules: null, canInteract: false };
  }

  // 1. Blind: Interacts with bomb, sees monochrome/no-color, no serial, generic keypad slots, has audio
  if (role === 'blind') {
    return {
      ...common,
      serialNumber: null, // Blind cannot see serial number
      canInteract: true,
      hasAudio: true,
      isMonochrome: true,
      modules: {
        button: {
          id: 'button',
          label: 'دکمه',
          color: 'monochrome',
          holdStripColor: m.button.solved ? null : 'monochrome',
          solved: m.button.solved
        },
        wires: {
          id: 'wires',
          count: m.wires.wires.length,
          cutWires: m.wires.cutWires,
          solved: m.wires.solved
        },
        keypad: {
          id: 'keypad',
          slotCount: m.keypad.symbols.length,
          enteredCount: m.keypad.enteredOrder.length,
          solved: m.keypad.solved
        }
      }
    };
  }

  // 2. Deaf: Sees colorful bomb (colors, serial, keypad symbols), but CANNOT interact and NO audio
  if (role === 'deaf') {
    return {
      ...common,
      serialNumber: gameState.serialNumber, // Deaf sees serial
      canInteract: false,
      hasAudio: false,
      isMonochrome: false,
      modules: {
        button: {
          id: 'button',
          label: m.button.label,
          color: m.button.color,
          holdStripColor: m.button.holdStripColor,
          solved: m.button.solved
        },
        wires: {
          id: 'wires',
          wires: m.wires.wires, // Deaf sees the wire colors
          cutWires: m.wires.cutWires,
          solved: m.wires.solved
        },
        keypad: {
          id: 'keypad',
          symbols: m.keypad.symbols, // Deaf sees the exact symbols
          enteredCount: m.keypad.enteredOrder.length,
          solved: m.keypad.solved
        }
      }
    };
  }

  // 3. Mute: Sees the rulebook (manual) statically in client; only gets progress/solved status, no bomb view, no audio
  if (role === 'mute') {
    return {
      ...common,
      serialNumber: null,
      canInteract: false,
      hasAudio: false,
      modules: {
        button: { solved: m.button.solved },
        wires: { solved: m.wires.solved },
        keypad: { solved: m.keypad.solved }
      }
    };
  }

  // Spectator or lobby
  return {
    ...common,
    serialNumber: null,
    canInteract: false,
    hasAudio: false,
    modules: null
  };
}

// Send filtered state to a specific client
function sendStateToClient(ws) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const clientInfo = activeSockets.get(ws);
  const role = clientInfo ? clientInfo.role : null;
  const filteredState = getFilteredStateForRole(role);
  ws.send(JSON.stringify({ type: 'state_update', state: filteredState }));
}

// Broadcast filtered states to all connected clients
function broadcastFullState() {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      sendStateToClient(client);
    }
  }
}

// Broadcast general event (like strike alert or game started)
function broadcastEvent(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function checkReadyStatus() {
  const allRolesAssigned = ROLES.every((r) => roles[r].playerId && roles[r].connected);
  if (gameState.status === 'waiting' && allRolesAssigned) {
    gameState.status = 'ready';
  } else if (gameState.status === 'ready' && !allRolesAssigned) {
    gameState.status = 'waiting';
  }
}

function stopGameTimer() {
  if (gameTimerInterval) {
    clearInterval(gameTimerInterval);
    gameTimerInterval = null;
  }
}

function startGame() {
  stopGameTimer();
  const seed = generateRandomSeed();
  const init = initializeModules(seed);

  gameState.seed = seed;
  gameState.serialNumber = init.serialNumber;
  gameState.modules = init.modules;
  gameState.strikes = 0;
  gameState.endReason = null;
  gameState.duration = 300; // 5 minutes
  gameState.remainingSeconds = 300;
  gameState.startTime = Date.now();
  gameState.status = 'running';

  broadcastEvent({
    type: 'game_started',
    seed,
    startTime: gameState.startTime,
    duration: gameState.duration,
    serverTimestamp: Date.now()
  });

  broadcastFullState();

  // Tick interval to check server authoritative expiration
  gameTimerInterval = setInterval(() => {
    if (gameState.status !== 'running') {
      stopGameTimer();
      return;
    }

    const elapsed = (Date.now() - gameState.startTime) / 1000;
    const remaining = Math.max(0, gameState.duration - elapsed);
    gameState.remainingSeconds = Math.round(remaining);

    if (remaining <= 0) {
      triggerExplosion('time_out');
    }
  }, 500);
}

function resetGame() {
  stopGameTimer();
  gameState.status = 'waiting';
  gameState.seed = null;
  gameState.startTime = null;
  gameState.duration = 300;
  gameState.remainingSeconds = 300;
  gameState.strikes = 0;
  gameState.endReason = null;
  gameState.serialNumber = '';
  gameState.modules = {};

  checkReadyStatus();
  broadcastFullState();
}

function triggerExplosion(reason) {
  stopGameTimer();
  gameState.status = 'exploded';
  gameState.endReason = reason; // 'time_out' | 'max_strikes'
  broadcastFullState();
}

function triggerDefusal() {
  stopGameTimer();
  gameState.status = 'defused';
  gameState.endReason = 'all_modules_defused';
  broadcastFullState();
}

function registerStrike(reason) {
  gameState.strikes += 1;
  broadcastEvent({
    type: 'strike',
    strikes: gameState.strikes,
    maxStrikes: gameState.maxStrikes,
    reason: reason || 'خطا در اجرای ماژول'
  });

  if (gameState.strikes >= gameState.maxStrikes) {
    triggerExplosion('max_strikes');
  } else {
    broadcastFullState();
  }
}

// --- WebSocket Event Router ---
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Send initial state to newly connected client
  sendStateToClient(ws);

  ws.on('message', (raw) => {
    try {
      const message = JSON.parse(raw.toString());
      handleClientEvent(ws, message);
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });

  ws.on('close', () => {
    const info = activeSockets.get(ws);
    if (info) {
      const { role, playerId } = info;
      if (role && roles[role] && roles[role].playerId === playerId) {
        roles[role].connected = false;
        console.log(`🔌 بازیکن نقش [${role}] قطع شد.`);
      }
      activeSockets.delete(ws);
      checkReadyStatus();
      broadcastFullState();
    }
  });
});

function handleClientEvent(ws, msg) {
  const { type, payload } = msg;

  // 1. Clock synchronization ping / pong
  if (type === 'ping') {
    ws.send(
      JSON.stringify({
        type: 'pong',
        clientTime: msg.clientTime || 0,
        serverTime: Date.now()
      })
    );
    return;
  }

  // 2. Join / Reconnect role
  if (type === 'join') {
    const { role, playerId } = payload || {};
    if (!ROLES.includes(role)) {
      ws.send(JSON.stringify({ type: 'error', message: 'نقش انتخاب شده نامعتبر است.' }));
      return;
    }

    if (!playerId) {
      ws.send(JSON.stringify({ type: 'error', message: 'شناسه بازیکن نامعتبر است.' }));
      return;
    }

    const currentRole = roles[role];

    // If already taken by ANOTHER connected player
    if (currentRole.playerId && currentRole.playerId !== playerId && currentRole.connected) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'ROLE_TAKEN',
          message: `نقش «${roleMeta[role].title}» هم‌اکنون توسط بازیکن دیگری انتخاب شده است.`
        })
      );
      return;
    }

    // Assign role to player (or reconnect existing player)
    currentRole.playerId = playerId;
    currentRole.connected = true;
    currentRole.joinedAt = currentRole.joinedAt || Date.now();

    activeSockets.set(ws, { playerId, role });
    checkReadyStatus();

    ws.send(
      JSON.stringify({
        type: 'role_assigned',
        role,
        playerId,
        meta: roleMeta[role]
      })
    );

    console.log(`✅ بازیکن ${playerId.substring(0, 6)} به نقش [${role}] پیوست.`);
    broadcastFullState();
    return;
  }

  // 3. Leave Role
  if (type === 'leave') {
    const info = activeSockets.get(ws);
    if (info && info.role) {
      const r = info.role;
      roles[r].playerId = null;
      roles[r].connected = false;
      roles[r].joinedAt = null;
      activeSockets.delete(ws);
      checkReadyStatus();
      ws.send(JSON.stringify({ type: 'role_released' }));
      broadcastFullState();
    }
    return;
  }

  // 4. Start Game
  if (type === 'start') {
    if (gameState.status === 'running') {
      return;
    }
    startGame();
    return;
  }

  // 5. Reset Game
  if (type === 'reset') {
    resetGame();
    return;
  }

  // 6. Bomb Defusal Action (STRICTLY allowed ONLY for 'blind' role)
  if (type === 'action') {
    if (gameState.status !== 'running') {
      return;
    }

    const clientInfo = activeSockets.get(ws);
    if (!clientInfo || clientInfo.role !== 'blind') {
      ws.send(
        JSON.stringify({
          type: 'error',
          message: 'تنها بازیکن نابینا (Blind) مجاز به تعامل فیزیکی با ماژول‌های بمب است!'
        })
      );
      return;
    }

    const { moduleId, action, data } = payload || {};

    if (moduleId === 'button') {
      handleButtonAction(action, data);
    } else if (moduleId === 'wires') {
      handleWiresAction(action, data);
    } else if (moduleId === 'keypad') {
      handleKeypadAction(action, data);
    }

    if (checkDefused()) {
      triggerDefusal();
    } else {
      broadcastFullState();
    }
    return;
  }
}

// Module Action Handlers
function handleButtonAction(action, data) {
  const btn = gameState.modules.button;
  if (!btn || btn.solved) return;

  if (action === 'press') {
    if (btn.actionType === 'press') {
      btn.solved = true;
      broadcastEvent({ type: 'module_solved', moduleId: 'button', message: 'دکمه کاتالیزور با موفقیت فشرده شد!' });
    } else {
      registerStrike('فشار ناگهانی روی دکمه در حالتی که نیاز به نگه‌داشتن و رهاسازی بود!');
    }
  } else if (action === 'release') {
    const { releaseDigit } = data || {};
    if (btn.actionType === 'hold') {
      if (parseInt(releaseDigit, 10) === btn.targetReleaseDigit) {
        btn.solved = true;
        broadcastEvent({
          type: 'module_solved',
          moduleId: 'button',
          message: `دکمه با موفقیت در ثانیه‌ای با رقم ${btn.targetReleaseDigit} رها شد!`
        });
      } else {
        registerStrike(`رهاسازی دکمه در ثانیه‌ی اشتباه!`);
      }
    } else {
      registerStrike('نگه داشتن دکمه در حالتی که نیاز به فشردن سریع بود!');
    }
  }
}

function handleWiresAction(action, data) {
  const w = gameState.modules.wires;
  if (!w || w.solved) return;

  const wireIndex = parseInt(data?.wireIndex, 10);
  if (isNaN(wireIndex) || w.cutWires.includes(wireIndex)) return;

  w.cutWires.push(wireIndex);

  if (wireIndex === w.correctWireIndex) {
    w.solved = true;
    broadcastEvent({ type: 'module_solved', moduleId: 'wires', message: 'سیم صحیح قطع شد و مدار خنثی گشت!' });
  } else {
    registerStrike(`سیم نادرست شماره ${wireIndex + 1} قطع شد! مدار بار اضافی دریافت کرد.`);
  }
}

function handleKeypadAction(action, data) {
  const kp = gameState.modules.keypad;
  if (!kp || kp.solved) return;

  const slotIndex = parseInt(data?.slotIndex, 10);
  if (isNaN(slotIndex) || slotIndex < 0 || slotIndex >= kp.symbols.length) return;

  const symbolPressed = kp.symbols[slotIndex];
  const expectedNextSymbol = kp.correctOrder[kp.enteredOrder.length];

  if (symbolPressed === expectedNextSymbol) {
    kp.enteredOrder.push(symbolPressed);
    if (kp.enteredOrder.length === kp.correctOrder.length) {
      kp.solved = true;
      broadcastEvent({ type: 'module_solved', moduleId: 'keypad', message: 'کد امنیتی با موفقیت وارد شد!' });
    }
  } else {
    kp.enteredOrder = [];
    registerStrike(`ترتیب نماد نادرست وارد شد! کلید رمزنگاری ریست شد.`);
  }
}

// Start HTTP and WebSocket Server
server.listen(PORT, '0.0.0.0', () => {
  printNetworkInterfaces(PORT);
});
