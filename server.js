import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { activeModules, modulesById } from './modules/index.js';
import { selectRoundRules } from './modules/rules-config.js';
import {
  DIFFICULTY_PRESETS,
  DEFAULT_DIFFICULTY_ID,
  sanitizeDifficultyConfig
} from './modules/difficulty-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve Three.js offline vendor files strictly from local node_modules
const threeBuildDir = path.join(__dirname, 'node_modules/three/build');
const threeAddonsDir = path.join(__dirname, 'node_modules/three/examples/jsm');

app.use('/vendor/three', express.static(threeBuildDir));
app.use('/vendor/three-addons', express.static(threeAddonsDir));

// Fallback alias in case importmap references three.module.min.js
app.get('/vendor/three/three.module.min.js', (req, res) => {
  res.sendFile(path.join(threeBuildDir, 'three.module.js'));
});

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
  console.log('💣  پروتکل ۳: بازی همکارانه خنثی‌سازی بمب (۳D سه‌بعدی لوکال)');
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
// INTERNAL IDENTIFIER MAPPING (Backward-Compatible Wire Protocol):
// Internal storage slots 'blind', 'deaf', 'mute' map 1-to-1 to canonical functional roles:
//   - 'blind' <-> 'operator' (Operator / اپراتور)
//   - 'deaf'  <-> 'observer' (Observer / ناظر — sole verbal speaker & gesture bridge)
//   - 'mute'  <-> 'manual'   (Manual-holder / دفترچه راهنما)
// Legacy keys are retained in wire payloads strictly for backward compatibility with existing clients/tests;
// all player-facing titles and descriptions exclusively use Operator, Observer, and Manual-holder.
const ROLES = ['blind', 'deaf', 'mute'];
const ALL_ROLES = ['blind', 'deaf', 'mute', 'operator', 'observer', 'manual'];

const COMM_AID_SYMBOLS = {
  confirm: { id: 'confirm', symbol: '✓', label: 'تأیید' },
  reject: { id: 'reject', symbol: '✕', label: 'رد' },
  urgent: { id: 'urgent', symbol: '⏱', label: 'زمان / فوری' }
};

function createCommAidState(difficulty) {
  const budget = difficulty?.features?.commAidEnabled ? (difficulty?.features?.commAidBudget || 0) : 0;
  return {
    enabled: Boolean(difficulty?.features?.commAidEnabled && budget > 0),
    totalBudget: budget,
    remainingUses: budget,
    seq: 0,
    lastSignal: null
  };
}

function canonicalRole(r) {
  if (r === 'operator' || r === 'blind') return 'blind';
  if (r === 'observer' || r === 'deaf') return 'deaf';
  if (r === 'manual' || r === 'mute') return 'mute';
  return r;
}

const roleMeta = {
  operator: {
    title: 'اپراتور (Operator)',
    subtitle: 'تنها بازیکن مجاز به لمس بمب ۳D؛ بدون کلام، دارای محدودیت دید توافقی (عینک آفتابی)، بدون دید به دفترچه راهنما؛ پخش صدای بازی از گوشی اپراتور'
  },
  observer: {
    title: 'ناظر (Observer)',
    subtitle: 'تنها گوینده تیم و پل ارتباطی؛ مشاهده رنگ‌ها، نمادها و پلاک سریال؛ صحبت با اپراتور و اشاره با دفترچه راهنما؛ دارای هدفون (بدون استفاده از صدای بازی) و بدون لمس بمب'
  },
  manual: {
    title: 'دفترچه راهنما (Manual-holder)',
    subtitle: 'دارنده دفترچه قوانین راند جاری؛ بدون کلام، بدون دید به صفحه اپراتور و بدون لمس بمب؛ ارتباط فقط با ناظر از طریق اشاره‌های توافقی'
  },
  blind: {
    title: 'اپراتور (Operator)',
    subtitle: 'تنها بازیکن مجاز به لمس بمب ۳D؛ بدون کلام، دارای محدودیت دید توافقی (عینک آفتابی)، بدون دید به دفترچه راهنما؛ پخش صدای بازی از گوشی اپراتور'
  },
  deaf: {
    title: 'ناظر (Observer)',
    subtitle: 'تنها گوینده تیم و پل ارتباطی؛ مشاهده رنگ‌ها، نمادها و پلاک سریال؛ صحبت با اپراتور و اشاره با دفترچه راهنما؛ دارای هدفون (بدون استفاده از صدای بازی) و بدون لمس بمب'
  },
  mute: {
    title: 'دفترچه راهنما (Manual-holder)',
    subtitle: 'دارنده دفترچه قوانین راند جاری؛ بدون کلام، بدون دید به صفحه اپراتور و بدون لمس بمب؛ ارتباط فقط با ناظر از طریق اشاره‌های توافقی'
  }
};

// Monotonic counter to uniquely identify socket connections
let nextSocketId = 1;

const log = (...args) => {
  if (process.env.NODE_ENV !== 'test') {
    console.log(...args);
  }
};

// Central session registry: playerId -> { playerId, socket, socketId, role, connected, joinedAt }
const sessions = new Map();

// Map of active WebSocket instances: ws -> { playerId, socketId }
const activeSockets = new Map();

// Designated host for room control (starts and resets)
let hostPlayerId = null;

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

let roles = {
  blind: { playerId: null, connected: false, joinedAt: null },
  deaf: { playerId: null, connected: false, joinedAt: null },
  mute: { playerId: null, connected: false, joinedAt: null }
};
roles.operator = roles.blind;
roles.observer = roles.deaf;
roles.manual = roles.mute;

const defaultDifficulty = sanitizeDifficultyConfig(DEFAULT_DIFFICULTY_ID);
const defaultDuration = defaultDifficulty.duration + (defaultDifficulty.features?.timerGraceSeconds || 0);

let gameState = {
  status: 'waiting', // 'waiting' | 'ready' | 'running' | 'exploded' | 'defused'
  seed: null,        // Server internal seed (never sent to client)
  roundSeed: generateRandomSeed(), // Public room match seed
  roundRules: null,  // Authoritative selected schemas & rulebook
  startTime: null,   // Server timestamp in ms
  duration: defaultDuration,     // Configured round duration
  remainingSeconds: defaultDuration,
  strikes: 0,
  maxStrikes: defaultDifficulty.maxStrikes,
  difficulty: defaultDifficulty,
  commAid: createCommAidState(defaultDifficulty),
  activeModuleIds: activeModules.slice(0, defaultDifficulty.moduleCount).map((m) => m.id),
  processedActionIds: new Set(), // Ring buffer for action idempotency / deduplication
  serialNumber: '',
  endReason: null,   // 'time_out' | 'max_strikes' | 'defused'
  modules: {}        // Authoritative module states
};

let gameTimerInterval = null;

function generateSerialNumber(rng) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '0123456789';
  return `${chars[Math.floor(rng() * chars.length)]}${digits[Math.floor(rng() * digits.length)]}-${digits[Math.floor(rng() * digits.length)]}${digits[Math.floor(rng() * digits.length)]}-${chars[Math.floor(rng() * chars.length)]}${digits[Math.floor(rng() * digits.length)]}`;
}

// Find role currently owned by a player ID
function getRoleByPlayerId(playerId) {
  if (!playerId) return null;
  for (const r of ROLES) {
    if (roles[r].playerId === playerId) return r;
  }
  return null;
}

// Release a specific role cleanly
function releaseRole(roleName) {
  if (!roles[roleName]) return;
  const pId = roles[roleName].playerId;
  roles[roleName].playerId = null;
  roles[roleName].connected = false;
  roles[roleName].joinedAt = null;

  if (pId) {
    const sess = sessions.get(pId);
    if (sess && sess.role === roleName) {
      sess.role = null;
    }
  }
}

// Release current role of player if any
function releasePlayerCurrentRole(playerId) {
  const currentRole = getRoleByPlayerId(playerId);
  if (currentRole) {
    releaseRole(currentRole);
    return currentRole;
  }
  return null;
}

// Ensure host is assigned deterministically to the first connected active player
function updateHost() {
  // If current host is still connected with an active role, maintain authority
  if (hostPlayerId) {
    const currentHostSession = sessions.get(hostPlayerId);
    if (currentHostSession && currentHostSession.connected && currentHostSession.role) {
      gameState.hostPlayerId = hostPlayerId;
      return hostPlayerId;
    }
  }

  // Fallback 1: First connected player holding an active role
  for (const r of ROLES) {
    if (roles[r].playerId && roles[r].connected) {
      const sess = sessions.get(roles[r].playerId);
      if (sess && sess.connected) {
        hostPlayerId = roles[r].playerId;
        gameState.hostPlayerId = hostPlayerId;
        return hostPlayerId;
      }
    }
  }

  // Fallback 2: Any connected player session
  for (const [pId, sess] of sessions.entries()) {
    if (sess.connected) {
      hostPlayerId = pId;
      gameState.hostPlayerId = hostPlayerId;
      return hostPlayerId;
    }
  }

  hostPlayerId = null;
  gameState.hostPlayerId = null;
  return null;
}

// Check whether all active modules are defused
function checkDefused() {
  const activeIds = gameState.activeModuleIds || activeModules.map((m) => m.id);
  const activeMods = activeModules.filter((mod) => activeIds.includes(mod.id));
  return activeMods.length > 0 && activeMods.every((mod) => mod.isSolved(gameState.modules[mod.id]));
}

// --- Role-filtered state generation (Secrets & Seed are NEVER sent) ---
function getFilteredStateForRole(rawRole) {
  const role = canonicalRole(rawRole);
  const isOperator = role === 'blind';
  const isObserver = role === 'deaf';
  const isManual = role === 'mute';

  const activeIds = gameState.activeModuleIds || activeModules.map((m) => m.id);
  const modulesDefusedCount = activeIds.filter((id) => gameState.modules?.[id]?.solved).length;
  const totalModulesCount = activeIds.length;

  const rawCommAid = gameState.commAid || createCommAidState(gameState.difficulty);
  // Enforce communication graph: Only Observer and Manual-holder see bridge signals; Operator never receives direct signals from Manual-holder
  const roleCommAid = (isObserver || isManual)
    ? { ...rawCommAid }
    : {
        enabled: rawCommAid.enabled,
        totalBudget: rawCommAid.totalBudget,
        remainingUses: rawCommAid.remainingUses,
        seq: rawCommAid.seq,
        lastSignal: null
      };

  const common = {
    status: gameState.status,
    roundSeed: gameState.roundSeed,
    startTime: gameState.startTime,
    duration: gameState.duration,
    remainingSeconds: gameState.remainingSeconds,
    strikes: gameState.strikes,
    maxStrikes: gameState.maxStrikes,
    difficulty: gameState.difficulty,
    commAid: roleCommAid,
    endReason: gameState.endReason,
    hostPlayerId: hostPlayerId,
    moduleIds: activeIds,
    modulesDefusedCount,
    totalModulesCount,
    roles: {
      operator: { playerId: roles.blind.playerId, connected: roles.blind.connected, title: roleMeta.operator.title, subtitle: roleMeta.operator.subtitle },
      observer: { playerId: roles.deaf.playerId, connected: roles.deaf.connected, title: roleMeta.observer.title, subtitle: roleMeta.observer.subtitle },
      manual: { playerId: roles.mute.playerId, connected: roles.mute.connected, title: roleMeta.manual.title, subtitle: roleMeta.manual.subtitle },
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
      roundManual: isManual && gameState.roundRules ? gameState.roundRules.rulebook : null,
      canInteract: false
    };
  }

  // Filter modules polymorphically using each module's filterForRole
  const filteredModules = {};
  for (const mod of activeModules) {
    if (!activeIds.includes(mod.id)) continue;
    filteredModules[mod.id] = mod.filterForRole(role, gameState.modules[mod.id], { difficulty: gameState.difficulty });
  }

  if (isOperator) {
    return {
      ...common,
      serialNumber: null, // Operator cannot see serial number
      canInteract: true,
      hasAudio: true,
      isMonochrome: true,
      roundManual: null,  // Strictly null for Operator
      modules: filteredModules
    };
  }

  if (isObserver) {
    return {
      ...common,
      serialNumber: gameState.serialNumber, // Observer observes serial plate
      canInteract: false,
      hasAudio: false,
      isMonochrome: false,
      roundManual: null,  // Strictly null for Observer
      modules: filteredModules
    };
  }

  if (isManual) {
    return {
      ...common,
      serialNumber: null,
      canInteract: false,
      hasAudio: false,
      roundManual: gameState.roundRules ? gameState.roundRules.rulebook : null,
      modules: filteredModules
    };
  }

  // Spectator or unassigned connection
  return {
    ...common,
    serialNumber: null,
    canInteract: false,
    hasAudio: false,
    roundManual: null,
    modules: null
  };
}

// Send filtered state to a specific client
function sendStateToClient(ws) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const socketInfo = activeSockets.get(ws);
  const session = socketInfo ? sessions.get(socketInfo.playerId) : null;
  const role = session ? session.role : null;
  const filteredState = getFilteredStateForRole(role);
  ws.send(JSON.stringify({ type: 'state_update', state: filteredState, data: filteredState }));
}

// Broadcast filtered states to all connected clients
function broadcastFullState() {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      sendStateToClient(client);
    }
  }
}

function broadcastEvent(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

function checkReadyStatus() {
  const allRolesAssignedAndConnected = ROLES.every((r) => roles[r].playerId && roles[r].connected);
  if (gameState.status === 'waiting' && allRolesAssignedAndConnected) {
    gameState.status = 'ready';
  } else if (gameState.status === 'ready' && !allRolesAssignedAndConnected) {
    gameState.status = 'waiting';
  }
}

function stopGameTimer() {
  if (gameTimerInterval) {
    clearInterval(gameTimerInterval);
    gameTimerInterval = null;
  }
}

function startGame(customSeed = null) {
  stopGameTimer();
  const seed = (typeof customSeed === 'string' && customSeed.trim().length >= 3)
    ? customSeed.trim().replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 16).toUpperCase()
    : (gameState.roundSeed || generateRandomSeed());

  const rng = createRng(seed);
  const roundRules = selectRoundRules(rng, seed);
  gameState.roundRules = roundRules;
  gameState.roundSeed = seed;
  gameState.seed = seed;

  if (!gameState.difficulty) {
    gameState.difficulty = sanitizeDifficultyConfig(DEFAULT_DIFFICULTY_ID);
  }

  const serial = generateSerialNumber(rng);
  const lastSerialDigit = parseInt(serial[serial.length - 1], 10);
  const isSerialEven = lastSerialDigit % 2 === 0;
  const ctx = { serialNumber: serial, isSerialEven, rng, roundRules, difficulty: gameState.difficulty };

  // Select active modules according to difficulty moduleCount (preserving wires first)
  const modCount = gameState.difficulty.moduleCount || activeModules.length;
  const selectedMods = activeModules.slice(0, modCount);
  gameState.activeModuleIds = selectedMods.map((m) => m.id);

  // Dynamically initialize only active modules using roundRules
  gameState.serialNumber = serial;
  gameState.modules = {};
  for (const mod of selectedMods) {
    gameState.modules[mod.id] = mod.create(rng, ctx);
  }

  gameState.strikes = 0;
  gameState.maxStrikes = gameState.difficulty.maxStrikes || 3;
  gameState.endReason = null;
  gameState.processedActionIds = new Set();
  gameState.commAid = createCommAidState(gameState.difficulty);

  const totalDuration = (gameState.difficulty.duration || 300) + (gameState.difficulty.features?.timerGraceSeconds || 0);
  gameState.duration = totalDuration;
  gameState.remainingSeconds = totalDuration;
  gameState.startTime = Date.now();
  gameState.status = 'running';

  broadcastEvent({
    type: 'game_started',
    startTime: gameState.startTime,
    duration: gameState.duration,
    roundSeed: gameState.roundSeed,
    difficulty: gameState.difficulty,
    serverTimestamp: Date.now()
  });

  broadcastFullState();

  // Authoritative server timer loop
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

function resetGame(clearDisconnectedRoles = true) {
  stopGameTimer();
  gameState.status = 'waiting';
  gameState.seed = null;
  gameState.roundSeed = generateRandomSeed();
  gameState.roundRules = null;
  gameState.startTime = null;
  gameState.processedActionIds = new Set();

  if (!gameState.difficulty) {
    gameState.difficulty = sanitizeDifficultyConfig(DEFAULT_DIFFICULTY_ID);
  }
  const totalDuration = gameState.difficulty.duration + (gameState.difficulty.features?.timerGraceSeconds || 0);
  gameState.duration = totalDuration;
  gameState.remainingSeconds = totalDuration;
  gameState.strikes = 0;
  gameState.maxStrikes = gameState.difficulty.maxStrikes;
  gameState.endReason = null;
  gameState.serialNumber = '';
  gameState.modules = {};
  gameState.activeModuleIds = activeModules.slice(0, gameState.difficulty.moduleCount).map((m) => m.id);
  gameState.commAid = createCommAidState(gameState.difficulty);

  if (clearDisconnectedRoles) {
    // Purge any stale role claims from disconnected players
    for (const r of ROLES) {
      if (!roles[r].connected) {
        releaseRole(r);
      }
    }
    // Clean up any session references to cleared roles
    for (const [pId, sess] of sessions.entries()) {
      if (sess.role && (!roles[sess.role] || roles[sess.role].playerId !== pId)) {
        sess.role = null;
      }
    }
  }

  updateHost();
  checkReadyStatus();
  broadcastFullState();
}

function triggerExplosion(reason) {
  // Ensure terminal states are strictly mutually exclusive and trigger exactly once
  if (gameState.status !== 'running') return;
  stopGameTimer();
  gameState.status = 'exploded';
  gameState.endReason = reason; // 'time_out' | 'max_strikes'
  broadcastFullState();
}

function triggerDefusal() {
  // Ensure terminal states are strictly mutually exclusive and trigger exactly once
  if (gameState.status !== 'running') return;
  stopGameTimer();
  gameState.status = 'defused';
  gameState.endReason = 'all_modules_defused';
  broadcastFullState();
}

function registerStrike(reason) {
  if (gameState.status !== 'running') return;
  gameState.strikes += 1;

  const penalty = gameState.difficulty?.timePenaltySeconds ?? 30;
  if (penalty > 0 && gameState.startTime) {
    // Exact authoritative time penalty deduction
    gameState.startTime -= penalty * 1000;
    const elapsed = (Date.now() - gameState.startTime) / 1000;
    gameState.remainingSeconds = Math.max(0, Math.round(gameState.duration - elapsed));
  }

  broadcastEvent({
    type: 'strike',
    strikes: gameState.strikes,
    maxStrikes: gameState.maxStrikes,
    penaltySeconds: penalty,
    remainingSeconds: gameState.remainingSeconds,
    reason: reason || 'خطا در اجرای ماژول'
  });

  if (gameState.strikes >= gameState.maxStrikes) {
    triggerExplosion('max_strikes');
  } else if (gameState.remainingSeconds <= 0) {
    triggerExplosion('time_out');
  } else {
    broadcastFullState();
  }
}

// --- WebSocket Connection Lifecycle ---
wss.on('connection', (ws) => {
  ws.isAlive = true;
  const socketId = nextSocketId++;
  ws.socketId = socketId;

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
    const socketInfo = activeSockets.get(ws);
    if (!socketInfo) return;
    activeSockets.delete(ws);

    const { playerId } = socketInfo;
    const session = sessions.get(playerId);

    // CRITICAL: Ensure an old socket closing after a reconnect cannot accidentally remove the new active session!
    if (session && session.socketId === socketId) {
      session.connected = false;
      session.socket = null;

      if (session.role && roles[session.role] && roles[session.role].playerId === playerId) {
        roles[session.role].connected = false;
        log(`🔌 بازیکن ${playerId.substring(0, 6)} نقش [${session.role}] قطع شد.`);
      }

      updateHost();
      checkReadyStatus();
      broadcastFullState();
    } else {
      log(`Stale socket ${socketId} closed for player ${playerId}; active session unaffected.`);
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

  // 2. Join / Reconnect / Role Selection
  if (type === 'join') {
    const role = payload?.role || msg.role;
    const playerId = payload?.playerId || msg.playerId;

    // Validate inputs strictly
    if (!playerId || typeof playerId !== 'string' || !playerId.trim() || playerId.length > 64) {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_PLAYER_ID', message: 'شناسه بازیکن نامعتبر است.' }));
      return;
    }
    const cleanPlayerId = playerId.trim();

    const targetRole = canonicalRole(role);

    if (!ROLES.includes(targetRole)) {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_ROLE', message: 'نقش انتخاب شده نامعتبر است.' }));
      return;
    }

    // Check for duplicate active connection with same playerId
    let session = sessions.get(cleanPlayerId);
    if (!session) {
      session = {
        playerId: cleanPlayerId,
        socket: ws,
        socketId: ws.socketId,
        role: null,
        connected: true,
        joinedAt: Date.now()
      };
      sessions.set(cleanPlayerId, session);
    } else {
      // Deterministic policy for duplicate sessions:
      // Newer connection replaces older connection; older socket is closed cleanly.
      if (session.socket && session.socket !== ws && session.connected) {
        log(`Duplicate session detected for player ${cleanPlayerId}. Terminating older socket.`);
        const oldSocket = session.socket;
        try {
          oldSocket.send(JSON.stringify({
            type: 'session_replaced',
            message: 'نشست شما در دستگاه یا تب دیگری فعال شد.'
          }));
          oldSocket.close();
        } catch (e) {}
      }
      session.socket = ws;
      session.socketId = ws.socketId;
      session.connected = true;
    }

    activeSockets.set(ws, { playerId: cleanPlayerId, socketId: ws.socketId });

    const currentRole = roles[targetRole];
    const previousRole = getRoleByPlayerId(cleanPlayerId);

    // If game is running, disallow switching roles mid-game
    if (gameState.status === 'running' && previousRole && previousRole !== targetRole) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'CANNOT_SWITCH_MIDGAME',
        message: 'تغییر نقش در حین انجام عملیات خنثی‌سازی مجاز نیست.'
      }));
      return;
    }

    // Check if target role is currently taken by ANOTHER active connected player
    if (currentRole.playerId && currentRole.playerId !== cleanPlayerId && currentRole.connected) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'ROLE_TAKEN',
          message: `نقش «${(roleMeta[role] || roleMeta[targetRole]).title}» هم‌اکنون توسط بازیکن دیگری انتخاب شده است.`
        })
      );
      return;
    }

    // 1. Role replacement: When a player changes roles, safely release their previous role!
    if (previousRole && previousRole !== targetRole) {
      releaseRole(previousRole);
      log(`Player ${cleanPlayerId.substring(0, 6)} safely released previous role [${previousRole}]`);
    }

    // If target role was previously assigned to a disconnected player, transfer it cleanly
    if (currentRole.playerId && currentRole.playerId !== cleanPlayerId && !currentRole.connected) {
      const formerSess = sessions.get(currentRole.playerId);
      if (formerSess && formerSess.role === targetRole) {
        formerSess.role = null;
      }
      releaseRole(targetRole);
    }

    // Assign target role to this player
    currentRole.playerId = cleanPlayerId;
    currentRole.connected = true;
    currentRole.joinedAt = currentRole.joinedAt || Date.now();
    session.role = targetRole;

    updateHost();
    checkReadyStatus();

    ws.send(
      JSON.stringify({
        type: 'role_assigned',
        role: targetRole,
        roleRequested: role,
        playerId: cleanPlayerId,
        meta: roleMeta[role] || roleMeta[targetRole]
      })
    );

    log(`✅ بازیکن ${cleanPlayerId.substring(0, 6)} نقش [${role}] را برگزید.`);
    broadcastFullState();
    return;
  }

  // 3. Leave Role
  if (type === 'leave') {
    const socketInfo = activeSockets.get(ws);
    if (socketInfo) {
      const { playerId } = socketInfo;
      const released = releasePlayerCurrentRole(playerId);
      if (released) {
        updateHost();
        checkReadyStatus();
        ws.send(JSON.stringify({ type: 'role_released' }));
        broadcastFullState();
      }
    }
    return;
  }

  // 4. Start Game (Must be ready AND initiated by host)
  if (type === 'start') {
    const socketInfo = activeSockets.get(ws);
    const playerId = socketInfo ? socketInfo.playerId : null;

    if (!playerId || playerId !== hostPlayerId) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'UNAUTHORIZED',
          message: 'تنها میزبان بازی مجاز به شروع عملیات است.'
        })
      );
      return;
    }

    if (gameState.status !== 'ready') {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'NOT_READY',
          message: 'بازی تنها زمانی شروع می‌شود که هر ۳ نقش انتخاب شده و متصل باشند.'
        })
      );
      return;
    }

    startGame(payload?.seed || msg.seed);
    return;
  }

  // 4b. Set Custom Seed in Lobby (Host only)
  if (type === 'set_seed') {
    if (gameState.status !== 'waiting' && gameState.status !== 'ready') {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_STATE', message: 'تنظیم سید فقط در لابی امکان‌پذیر است.' }));
      return;
    }
    const socketInfo = activeSockets.get(ws);
    const playerId = socketInfo ? socketInfo.playerId : null;
    if (!playerId || playerId !== hostPlayerId) {
      ws.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'تنها میزبان مجاز به تغییر سید بازی است.' }));
      return;
    }
    const rawSeed = payload?.seed || msg.seed;
    if (typeof rawSeed !== 'string' || !rawSeed.trim()) {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_SEED', message: 'سید وارد شده معتبر نیست.' }));
      return;
    }
    const cleanSeed = rawSeed.trim().replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 16).toUpperCase();
    if (cleanSeed.length < 3) {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_SEED', message: 'سید بازی باید حداقل ۳ نویسه باشد.' }));
      return;
    }
    gameState.roundSeed = cleanSeed;
    broadcastFullState();
    return;
  }

  // 4c. Set Difficulty Preset & Custom Overrides in Lobby (Host only)
  if (type === 'set_difficulty') {
    if (gameState.status !== 'waiting' && gameState.status !== 'ready') {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'INVALID_STATE',
        message: 'تنظیم درجه سختی فقط در لابی امکان‌پذیر است.'
      }));
      return;
    }

    const socketInfo = activeSockets.get(ws);
    const playerId = socketInfo ? socketInfo.playerId : null;
    if (!playerId || playerId !== hostPlayerId) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'UNAUTHORIZED',
        message: 'تنها میزبان بازی مجاز به تغییر درجه سختی است.'
      }));
      return;
    }

    const presetId = payload?.presetId || payload?.preset || msg.presetId || msg.preset;
    const customOverrides = payload?.customOverrides || payload?.custom || msg.customOverrides;

    const sanitized = sanitizeDifficultyConfig(presetId, customOverrides);
    gameState.difficulty = sanitized;
    const totalDuration = sanitized.duration + (sanitized.features?.timerGraceSeconds || 0);
    gameState.duration = totalDuration;
    gameState.remainingSeconds = totalDuration;
    gameState.maxStrikes = sanitized.maxStrikes;
    gameState.activeModuleIds = activeModules.slice(0, sanitized.moduleCount).map((m) => m.id);
    gameState.commAid = createCommAidState(sanitized);

    broadcastEvent({
      type: 'difficulty_changed',
      difficulty: gameState.difficulty
    });
    broadcastFullState();
    return;
  }

  // 5. Reset Game (Must be in valid state AND initiated by host)
  if (type === 'reset') {
    if (!['waiting', 'exploded', 'defused'].includes(gameState.status)) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'INVALID_STATE',
          message: 'ریست کردن بازی فقط پس از اتمام بازی یا در لابی امکان‌پذیر است.'
        })
      );
      return;
    }

    const socketInfo = activeSockets.get(ws);
    const playerId = socketInfo ? socketInfo.playerId : null;

    if (!playerId || playerId !== hostPlayerId) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'UNAUTHORIZED',
          message: 'تنها میزبان بازی مجاز به ریست کردن است.'
        })
      );
      return;
    }

    resetGame(true);
    return;
  }

  // 6. Bomb Defusal Action (STRICTLY allowed ONLY for 'blind' role)
  if (type === 'action') {
    if (gameState.status !== 'running') {
      return;
    }

    const socketInfo = activeSockets.get(ws);
    const session = socketInfo ? sessions.get(socketInfo.playerId) : null;
    const isAuthorizedOperator = session && (session.role === 'blind' || session.role === 'operator');
    if (!isAuthorizedOperator) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'UNAUTHORIZED_ACTION',
          message: 'تنها اپراتور بمب (Operator) مجاز به تعامل فیزیکی با ماژول‌های بمب است!'
        })
      );
      return;
    }

    const actionData = payload || msg.data || msg;
    const { moduleId, action, data } = actionData || {};
    if (typeof moduleId !== 'string' || typeof action !== 'string') {
      return;
    }

    // Action idempotency & deduplication: Ignore duplicate action IDs
    const actionId = actionData.actionId || msg.actionId;
    if (actionId) {
      if (gameState.processedActionIds && gameState.processedActionIds.has(actionId)) {
        ws.send(JSON.stringify({
          type: 'action_duplicate',
          actionId,
          message: 'عملیات تکراری نادیده گرفته شد.'
        }));
        return;
      }
      if (!gameState.processedActionIds) gameState.processedActionIds = new Set();
      gameState.processedActionIds.add(actionId);
      if (gameState.processedActionIds.size > 500) {
        const oldest = gameState.processedActionIds.values().next().value;
        gameState.processedActionIds.delete(oldest);
      }
    }

    // Flood protection / rate limiting based on difficulty interaction grace
    const now = Date.now();
    const cooldownMs = gameState.difficulty?.interactionGraceMs || 70;
    if (session.lastActionTime && (now - session.lastActionTime < cooldownMs)) {
      return;
    }
    session.lastActionTime = now;

    const mod = modulesById.get(moduleId);
    if (!mod || !gameState.modules[moduleId]) {
      return;
    }

    const lastDigit = Math.floor(Math.max(0, gameState.remainingSeconds)) % 10;
    const ctx = {
      remainingSeconds: gameState.remainingSeconds,
      lastDigit,
      serialNumber: gameState.serialNumber,
      difficulty: gameState.difficulty
    };

    const result = mod.handleAction(gameState.modules[moduleId], action, data, ctx);

    if (result.strike) {
      registerStrike(result.reason);
    } else if (result.solved) {
      broadcastEvent({
        type: 'module_solved',
        moduleId,
        message: result.reason || 'ماژول با موفقیت خنثی شد!'
      });
      if (checkDefused()) {
        triggerDefusal();
        return;
      }
    }

    broadcastFullState();
    return;
  }

  // 7. Optional Easy-mode 3-Symbol Communication Aid (Observer <-> Manual-holder bridge only)
  if (type === 'comm_signal') {
    if (gameState.status !== 'running') {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'INVALID_STATE',
        message: 'ارسال نماد کمک‌ارتباطی فقط در حین اجرای راند مجاز است.'
      }));
      return;
    }

    const socketInfo = activeSockets.get(ws);
    const session = socketInfo ? sessions.get(socketInfo.playerId) : null;
    const senderRole = session ? canonicalRole(session.role) : null;

    // Strictly enforce canonical communication graph: Only Observer ('deaf') and Manual-holder ('mute') share this bridge
    if (senderRole !== 'deaf' && senderRole !== 'mute') {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'UNAUTHORIZED_COMM_ROLE',
        message: 'کمک‌ارتباطی فقط بین ناظر و دارنده دفترچه راهنما فعال است؛ ارتباط مستقیم با اپراتور مجاز نیست.'
      }));
      return;
    }

    const reqData = payload || msg.data || msg;
    // Reject any attempt to smuggle free-text chat, voice payloads, or answer shortcuts
    if (
      reqData?.text !== undefined ||
      reqData?.chat !== undefined ||
      reqData?.answer !== undefined ||
      msg.text !== undefined ||
      msg.chat !== undefined
    ) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'INVALID_COMM_SYMBOL',
        message: 'ارسال متن آزاد یا میانبر پاسخ ممنوع است؛ فقط سه نماد استاندارد مجاز هستند.'
      }));
      return;
    }

    const symbolId = typeof reqData?.symbolId === 'string' ? reqData.symbolId.trim() : '';
    const symbolDef = COMM_AID_SYMBOLS[symbolId];
    if (!symbolDef) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'INVALID_COMM_SYMBOL',
        message: 'نماد انتخاب‌شده معتبر نیست. فقط تأیید، رد یا زمان/فوری مجاز است.'
      }));
      return;
    }

    if (!gameState.commAid || !gameState.commAid.enabled) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'COMM_AID_DISABLED',
        message: 'کمک‌ارتباطی ۳ نمادی در درجه سختی فعلی غیرفعال است.'
      }));
      return;
    }

    const actionId = reqData?.actionId || msg.actionId;
    if (actionId) {
      if (gameState.processedActionIds && gameState.processedActionIds.has(actionId)) {
        ws.send(JSON.stringify({
          type: 'action_duplicate',
          actionId,
          message: 'نماد تکراری نادیده گرفته شد.'
        }));
        return;
      }
      if (!gameState.processedActionIds) gameState.processedActionIds = new Set();
      gameState.processedActionIds.add(actionId);
    }

    if (gameState.commAid.remainingUses <= 0) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'COMM_BUDGET_EXHAUSTED',
        message: 'سهمیه کمک‌ارتباطی در این راند به پایان رسیده است؛ از اشاره‌های توافقی استفاده کنید.'
      }));
      return;
    }

    gameState.commAid.remainingUses -= 1;
    gameState.commAid.seq += 1;
    const signalRecord = {
      id: symbolDef.id,
      symbol: symbolDef.symbol,
      label: symbolDef.label,
      senderRole: senderRole === 'deaf' ? 'observer' : 'manual',
      senderTitle: senderRole === 'deaf' ? 'ناظر (Observer)' : 'دفترچه راهنما (Manual-holder)',
      seq: gameState.commAid.seq,
      remainingUses: gameState.commAid.remainingUses,
      totalBudget: gameState.commAid.totalBudget,
      timestamp: Date.now()
    };
    gameState.commAid.lastSignal = signalRecord;

    // Deliver signal event ONLY to Observer and Manual-holder sockets (never to Operator)
    const eventMsg = JSON.stringify({
      type: 'comm_signal_sent',
      signal: signalRecord,
      remainingUses: gameState.commAid.remainingUses,
      totalBudget: gameState.commAid.totalBudget
    });
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      const cInfo = activeSockets.get(client);
      const cSess = cInfo ? sessions.get(cInfo.playerId) : null;
      const cRole = cSess ? canonicalRole(cSess.role) : null;
      if (cRole === 'deaf' || cRole === 'mute') {
        client.send(eventMsg);
      }
    }

    broadcastFullState();
    return;
  }
}

// Start HTTP and WebSocket Server only when executed as the main application entry point
import { pathToFileURL } from 'url';
const isMain = process.argv[1] && (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
);

if (isMain && process.env.NODE_ENV !== 'test') {
  server.listen(PORT, '0.0.0.0', () => {
    printNetworkInterfaces(PORT);
  });
}

export {
  app,
  server,
  wss,
  gameState,
  roles,
  sessions,
  activeSockets,
  ROLES,
  COMM_AID_SYMBOLS,
  startGame,
  resetGame,
  getRoleByPlayerId,
  releaseRole,
  updateHost,
  getFilteredStateForRole,
  createRng,
  DIFFICULTY_PRESETS,
  DEFAULT_DIFFICULTY_ID,
  sanitizeDifficultyConfig
};
