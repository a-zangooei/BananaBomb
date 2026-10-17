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
  blind: { title: 'نابینا (Blind)', subtitle: 'چشمان بسته، راهنمای صوتی و شنیداری' },
  deaf: { title: 'ناشنوا (Deaf)', subtitle: 'گوش‌های ناشنوا، تحلیل‌گر بصری و دفترچه راهنما' },
  mute: { title: 'بی‌کلام (Mute)', subtitle: 'زبان بسته، تکنسین خنثی‌ساز با دستان آزاد' }
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
  endReason: null,      // 'time_out' | 'max_strikes' | 'all_modules_defused'
  modules: {}
};

let gameTimerInterval = null;

// Track active WebSocket connections: ws -> { playerId, role }
const activeSockets = new Map();

// Helper: Seeded pseudo-random generator
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
    return (h += h << 5) >>> 0 / 4294967296;
  };
}

function generateRandomSeed() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function initializeModules(seed) {
  const rng = createRng(seed);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '0123456789';

  // Generate Bomb Serial Number: e.g., 'B7-49-X2'
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
  // - If button is White: single press immediately
  // - If button is Red and serial last digit is odd: single press immediately
  // - If button is Blue: hold and release when timer last digit equals 4
  // - If button is Yellow: hold and release when timer last digit equals 7
  // - Otherwise: hold and release when timer last digit equals 1
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

  // Wire Rules:
  // - If more than one Red wire: cut the 2nd wire (index 1)
  // - Else if last wire is Yellow: cut the 1st wire (index 0)
  // - Else if exactly one Blue wire: cut the 3rd wire (index 2)
  // - Otherwise: cut the 4th wire (index 3)
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
  // Pick 4 unique symbols
  const shuffledSymbols = [...symbolPool].sort(() => rng() - 0.5).slice(0, 4);
  // Standard priority order for defusal is based on their appearance in symbolPool
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

// Broadcast game state to all connected clients
function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function broadcastFullState() {
  broadcast({
    type: 'state_update',
    state: {
      ...gameState,
      roles: {
        blind: { ...roles.blind, title: roleMeta.blind.title, subtitle: roleMeta.blind.subtitle },
        deaf: { ...roles.deaf, title: roleMeta.deaf.title, subtitle: roleMeta.deaf.subtitle },
        mute: { ...roles.mute, title: roleMeta.mute.title, subtitle: roleMeta.mute.subtitle }
      },
      serverTimestamp: Date.now()
    }
  });
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

  broadcast({
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
  broadcast({
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
  // Connection ping/pong keepalive
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  // Immediately send initial state on connect
  ws.send(
    JSON.stringify({
      type: 'state_update',
      state: {
        ...gameState,
        roles: {
          blind: { ...roles.blind, title: roleMeta.blind.title, subtitle: roleMeta.blind.subtitle },
          deaf: { ...roles.deaf, title: roleMeta.deaf.title, subtitle: roleMeta.deaf.subtitle },
          mute: { ...roles.mute, title: roleMeta.mute.title, subtitle: roleMeta.mute.subtitle }
        },
        serverTimestamp: Date.now()
      }
    })
  );

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

  // 6. Bomb Defusal Action
  if (type === 'action') {
    if (gameState.status !== 'running') {
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
      broadcast({ type: 'module_solved', moduleId: 'button', message: 'دکمه کاتالیزور با موفقیت فشرده شد!' });
    } else {
      registerStrike('فشار ناگهانی روی دکمه در حالتی که نیاز به نگه داشتن بود!');
    }
  } else if (action === 'release') {
    const { releaseDigit } = data || {};
    if (btn.actionType === 'hold') {
      if (parseInt(releaseDigit, 10) === btn.targetReleaseDigit) {
        btn.solved = true;
        broadcast({
          type: 'module_solved',
          moduleId: 'button',
          message: `دکمه با موفقیت در ثانیه با رقم ${btn.targetReleaseDigit} رها شد!`
        });
      } else {
        registerStrike(`رهاسازی دکمه در ثانیه‌ی اشتباه! (رقم مورد انتظار: ${btn.targetReleaseDigit} بود)`);
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
    broadcast({ type: 'module_solved', moduleId: 'wires', message: 'سیم صحیح قطع شد و مدار خنثی گشت!' });
  } else {
    registerStrike(`سیم نادرست شماره ${wireIndex + 1} قطع شد! مدار بار اضافی دریافت کرد.`);
  }
}

function handleKeypadAction(action, data) {
  const kp = gameState.modules.keypad;
  if (!kp || kp.solved) return;

  const symbol = data?.symbol;
  if (!symbol) return;

  const expectedNextSymbol = kp.correctOrder[kp.enteredOrder.length];

  if (symbol === expectedNextSymbol) {
    kp.enteredOrder.push(symbol);
    if (kp.enteredOrder.length === kp.correctOrder.length) {
      kp.solved = true;
      broadcast({ type: 'module_solved', moduleId: 'keypad', message: 'کد امنیتی با موفقیت وارد شد!' });
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
