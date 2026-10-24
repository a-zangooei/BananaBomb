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

// --- Terminal Sanitization & English-Only Logger (Termux / Linux Safe) ---
const NON_ASCII_TERMINAL_RE = /[^\x20-\x7E\r\n\t]/g;

function sanitizeTerminalText(value) {
  return String(value ?? '').replace(NON_ASCII_TERMINAL_RE, '?');
}

function formatRoleForLog(rawRole) {
  if (rawRole === 'blind' || rawRole === 'operator') return 'operator';
  if (rawRole === 'deaf' || rawRole === 'observer') return 'observer';
  if (rawRole === 'mute' || rawRole === 'manual') return 'manual';
  return sanitizeTerminalText(rawRole || 'unassigned');
}

function shortPlayerId(playerId) {
  const clean = sanitizeTerminalText(String(playerId || '').trim());
  return clean.substring(0, 8) || 'unknown';
}

// --- Network Interface Logger with Termux Graceful Handling ---
function printNetworkInterfaces(port) {
  const safePort = sanitizeTerminalText(port);
  console.log('='.repeat(60));
  console.log('[SERVER] BananaBomb - 3D Local Co-op Bomb Defusal Server');
  console.log('='.repeat(60));
  console.log(`[SERVER] Listening on port: ${safePort}`);
  console.log(`[LOCAL]  Browser on this device: http://localhost:${safePort}`);
  console.log('\n[LAN]    Connect other phones over Wi-Fi or Mobile Hotspot:');

  try {
    const interfaces = os.networkInterfaces();
    let count = 0;
    for (const name of Object.keys(interfaces || {})) {
      const netList = interfaces[name];
      if (!netList) continue;
      for (const net of netList) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`  -> [${sanitizeTerminalText(name)}] http://${sanitizeTerminalText(net.address)}:${safePort}`);
          count++;
        }
      }
    }
    if (count === 0) {
      console.log('  [INFO] No active external IPv4 interface detected. Connect to Wi-Fi or enable Hotspot.');
    }
  } catch (err) {
    console.warn('\n[WARN] Unable to read os.networkInterfaces() automatically (common on Android Termux).');
    console.warn('[INFO] Check Hotspot settings or run "ifconfig" or "ip addr" in Termux to find your device IP:');
    console.warn(`  -> http://<DEVICE_IP>:${safePort}\n`);
  }
  console.log('='.repeat(60));
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
    console.log(...args.map((arg) => sanitizeTerminalText(arg)));
  }
};

const logError = (...args) => {
  if (process.env.NODE_ENV !== 'test') {
    console.error(...args.map((arg) => sanitizeTerminalText(arg)));
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
  blind: { playerId: null, connected: false, joinedAt: null, ready: false },
  deaf: { playerId: null, connected: false, joinedAt: null, ready: false },
  mute: { playerId: null, connected: false, joinedAt: null, ready: false }
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
  roles[roleName].ready = false;

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
      operator: { playerId: roles.blind.playerId, connected: roles.blind.connected, ready: Boolean(roles.blind.connected && roles.blind.ready !== false), title: roleMeta.operator.title, subtitle: roleMeta.operator.subtitle },
      observer: { playerId: roles.deaf.playerId, connected: roles.deaf.connected, ready: Boolean(roles.deaf.connected && roles.deaf.ready !== false), title: roleMeta.observer.title, subtitle: roleMeta.observer.subtitle },
      manual: { playerId: roles.mute.playerId, connected: roles.mute.connected, ready: Boolean(roles.mute.connected && roles.mute.ready !== false), title: roleMeta.manual.title, subtitle: roleMeta.manual.subtitle },
      blind: { playerId: roles.blind.playerId, connected: roles.blind.connected, ready: Boolean(roles.blind.connected && roles.blind.ready !== false), title: roleMeta.blind.title, subtitle: roleMeta.blind.subtitle },
      deaf: { playerId: roles.deaf.playerId, connected: roles.deaf.connected, ready: Boolean(roles.deaf.connected && roles.deaf.ready !== false), title: roleMeta.deaf.title, subtitle: roleMeta.deaf.subtitle },
      mute: { playerId: roles.mute.playerId, connected: roles.mute.connected, ready: Boolean(roles.mute.connected && roles.mute.ready !== false), title: roleMeta.mute.title, subtitle: roleMeta.mute.subtitle }
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
  const allRolesAssignedAndConnected = ROLES.every(
    (r) => roles[r].playerId && roles[r].connected && roles[r].ready !== false
  );
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

  // Reset per-session action flood buckets at the start of every new round
  for (const sess of sessions.values()) {
    sess.actionRateState = null;
  }

  const totalDuration = (gameState.difficulty.duration || 300) + (gameState.difficulty.features?.timerGraceSeconds || 0);
  gameState.duration = totalDuration;
  gameState.remainingSeconds = totalDuration;
  gameState.startTime = Date.now();
  gameState.status = 'running';

  const diffLabel = `${gameState.difficulty.preset || 'normal'}${gameState.difficulty.isCustom ? '-custom' : ''}`;
  log(`[GAME] Round started (seed=${seed}, difficulty=${diffLabel}, duration=${totalDuration}s, modules=${gameState.activeModuleIds.join(',')}).`);

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
  for (const sess of sessions.values()) {
    sess.actionRateState = null;
  }

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

  for (const r of ROLES) {
    roles[r].ready = Boolean(roles[r].playerId && roles[r].connected);
  }

  updateHost();
  checkReadyStatus();
  log(`[GAME] Round reset to waiting state (nextSeed=${gameState.roundSeed}).`);
  broadcastFullState();
}

function triggerExplosion(reason) {
  // Ensure terminal states are strictly mutually exclusive and trigger exactly once
  if (gameState.status !== 'running') return;
  stopGameTimer();
  gameState.status = 'exploded';
  gameState.endReason = reason; // 'time_out' | 'max_strikes'
  log(`[GAME] Bomb exploded (reason=${reason}).`);
  broadcastFullState();
}

function triggerDefusal() {
  // Ensure terminal states are strictly mutually exclusive and trigger exactly once
  if (gameState.status !== 'running') return;
  stopGameTimer();
  gameState.status = 'defused';
  gameState.endReason = 'all_modules_defused';
  log('[GAME] Bomb defused! All active modules solved.');
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

  log(`[GAME] Strike ${gameState.strikes}/${gameState.maxStrikes} recorded (penalty=-${penalty}s, remaining=${gameState.remainingSeconds}s).`);

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

/**
 * Strictly validates module action type and parameters on the server, returning
 * a clean sanitizedData object stripped of any client-injected correctness claims
 * (e.g. solved, strike, correct).
 */
function validateBombActionPayload(moduleId, action, rawData) {
  const isPlainObj = (v) => Boolean(v && typeof v === 'object' && !Array.isArray(v));

  if (moduleId === 'button') {
    if (action === 'press') {
      return { ok: true, sanitizedData: {}, targetKey: 'plunger_press' };
    }
    if (action === 'release') {
      if (!isPlainObj(rawData) || !Number.isInteger(rawData.releaseDigit) || rawData.releaseDigit < 0 || rawData.releaseDigit > 9) {
        return { ok: false, message: 'پارامتر رقم رهاسازی دکمه نامعتبر است (باید عدد صحیح ۰ تا ۹ باشد).' };
      }
      return { ok: true, sanitizedData: { releaseDigit: rawData.releaseDigit }, targetKey: 'plunger_release' };
    }
    return { ok: false, message: 'نوع عملیات دکمه نامعتبر است.' };
  }

  if (moduleId === 'wires') {
    if (action === 'cut') {
      if (!isPlainObj(rawData) || !Number.isInteger(rawData.wireIndex) || rawData.wireIndex < 0 || rawData.wireIndex > 3) {
        return { ok: false, message: 'شماره سیم ارسالی نامعتبر است (باید عدد صحیح ۰ تا ۳ باشد).' };
      }
      return { ok: true, sanitizedData: { wireIndex: rawData.wireIndex }, targetKey: `wire_${rawData.wireIndex}` };
    }
    return { ok: false, message: 'نوع عملیات ماژول سیم‌ها نامعتبر است.' };
  }

  if (moduleId === 'keypad') {
    if (action === 'press') {
      if (!isPlainObj(rawData) || !Number.isInteger(rawData.slotIndex) || rawData.slotIndex < 0 || rawData.slotIndex > 3) {
        return { ok: false, message: 'شناسه کلید کیپد نامعتبر است (باید عدد صحیح ۰ تا ۳ باشد).' };
      }
      return { ok: true, sanitizedData: { slotIndex: rawData.slotIndex }, targetKey: `slot_${rawData.slotIndex}` };
    }
    return { ok: false, message: 'نوع عملیات ماژول کیپد نامعتبر است.' };
  }

  if (moduleId === 'beacon') {
    if (action === 'tune') {
      if (!isPlainObj(rawData) || !Number.isInteger(rawData.channel) || rawData.channel < 1 || rawData.channel > 3) {
        return { ok: false, message: 'شماره کانال فانوس صوتی نامعتبر است (باید ۱، ۲ یا ۳ باشد).' };
      }
      return { ok: true, sanitizedData: { channel: rawData.channel }, targetKey: `tune_${rawData.channel}` };
    }
    if (action === 'transmit') {
      return { ok: true, sanitizedData: {}, targetKey: 'tx' };
    }
    return { ok: false, message: 'نوع عملیات ماژول فانوس صوتی نامعتبر است.' };
  }

  return { ok: false, message: 'ماژول یا عملیات پشتیبانی نمی‌شود.' };
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
      logError('[WS] Error handling client message:', err instanceof Error ? err.message : String(err));
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
        log(`[WS] Player ${shortPlayerId(playerId)} disconnected from role [${formatRoleForLog(session.role)}].`);
      }

      updateHost();
      checkReadyStatus();
      broadcastFullState();
    } else {
      log(`[WS] Stale socket #${socketId} closed for player ${shortPlayerId(playerId)}; active session unaffected.`);
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
        log(`[WS] Duplicate session detected for player ${shortPlayerId(cleanPlayerId)}; closing older socket.`);
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
      log(`[ROLE] Player ${shortPlayerId(cleanPlayerId)} released previous role [${formatRoleForLog(previousRole)}].`);
    }

    // If target role was previously assigned to a disconnected player, transfer it cleanly
    if (currentRole.playerId && currentRole.playerId !== cleanPlayerId && !currentRole.connected) {
      const formerSess = sessions.get(currentRole.playerId);
      if (formerSess && formerSess.role === targetRole) {
        formerSess.role = null;
      }
      releaseRole(targetRole);
    }

    // Assign target role to this player (default ready = true on join)
    currentRole.playerId = cleanPlayerId;
    currentRole.connected = true;
    currentRole.joinedAt = currentRole.joinedAt || Date.now();
    currentRole.ready = true;
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

    log(`[ROLE] Player ${shortPlayerId(cleanPlayerId)} assigned to role [${formatRoleForLog(targetRole)}].`);
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
        log(`[ROLE] Player ${shortPlayerId(playerId)} left role [${formatRoleForLog(released)}].`);
        ws.send(JSON.stringify({ type: 'role_released' }));
        broadcastFullState();
      }
    }
    return;
  }

  // 3b. Toggle Player Ready Status in Lobby
  if (type === 'set_ready') {
    if (gameState.status !== 'waiting' && gameState.status !== 'ready') {
      return;
    }
    const socketInfo = activeSockets.get(ws);
    const session = socketInfo ? sessions.get(socketInfo.playerId) : null;
    const roleKey = session?.role ? canonicalRole(session.role) : null;
    if (roleKey && roles[roleKey] && roles[roleKey].playerId === session.playerId && roles[roleKey].connected) {
      const nextReady = payload?.ready !== undefined ? Boolean(payload.ready) : !roles[roleKey].ready;
      roles[roleKey].ready = nextReady;
      log(`[LOBBY] Player ${shortPlayerId(session.playerId)} [${formatRoleForLog(roleKey)}] ready=${nextReady}.`);
      checkReadyStatus();
      broadcastFullState();
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

    const presetLabel = `${sanitized.preset || 'normal'}${sanitized.isCustom ? '-custom' : ''}`;
    log(`[LOBBY] Difficulty set to "${presetLabel}" (duration=${totalDuration}s, maxStrikes=${sanitized.maxStrikes}, modules=${sanitized.moduleCount}).`);

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

  // 6. Bomb Defusal Action (STRICTLY allowed ONLY for connected Operator / 'blind' role)
  if (type === 'action') {
    const socketInfo = activeSockets.get(ws);
    const session = socketInfo ? sessions.get(socketInfo.playerId) : null;
    const isAuthorizedOperator = Boolean(
      session &&
      session.connected &&
      canonicalRole(session.role) === 'blind' &&
      roles.blind.playerId === session.playerId &&
      roles.blind.connected
    );

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

    if (gameState.status !== 'running') {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'INVALID_PHASE',
          message: 'اجرای فرمان روی بمب فقط در فاز در حال اجرا (Running) مجاز است.'
        })
      );
      return;
    }

    const actionData = payload !== undefined ? payload : (msg.data !== undefined ? msg.data : msg);
    if (!actionData || typeof actionData !== 'object' || Array.isArray(actionData)) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'MALFORMED_ACTION',
          message: 'ساختار بسته فرمان ارسالی نامعتبر است.'
        })
      );
      return;
    }

    // Reject stale actions originating from an older round or pre-round timestamp
    if (typeof actionData.roundSeed === 'string' && actionData.roundSeed.trim() && actionData.roundSeed !== gameState.roundSeed) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'STALE_ACTION',
          message: 'این فرمان مربوط به راند قبلی است و بدون ثبت خطا نادیده گرفته شد.'
        })
      );
      return;
    }
    if (
      typeof actionData.clientTimestamp === 'number' &&
      Number.isFinite(actionData.clientTimestamp) &&
      gameState.startTime &&
      actionData.clientTimestamp < gameState.startTime - 1500
    ) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'STALE_ACTION',
          message: 'فرمان منقضی‌شده پیش از شروع راند نادیده گرفته شد.'
        })
      );
      return;
    }

    const { moduleId, action, data } = actionData;
    if (typeof moduleId !== 'string' || typeof action !== 'string') {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'MALFORMED_ACTION',
          message: 'شناسه ماژول یا نوع عملیات معتبر نیست.'
        })
      );
      return;
    }

    const activeIds = gameState.activeModuleIds || activeModules.map((m) => m.id);
    const mod = modulesById.get(moduleId);
    if (!mod || !activeIds.includes(moduleId) || !gameState.modules?.[moduleId]) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'MALFORMED_ACTION',
          message: 'ماژول هدف در این راند فعال یا موجود نیست.'
        })
      );
      return;
    }

    const validation = validateBombActionPayload(moduleId, action, data);
    if (!validation.ok) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'MALFORMED_ACTION',
          message: validation.message
        })
      );
      return;
    }

    // Action idempotency & deduplication: Ignore duplicate action IDs
    const actionId = typeof (actionData.actionId || msg.actionId) === 'string'
      ? (actionData.actionId || msg.actionId).trim()
      : '';
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

    // Two-tier rate limiter:
    // 1) Per-target bounce guard (`cooldownMs`) blocks accidental rapid identical repeats
    // 2) Token-bucket flood guard (burst 6, refills 1 token per refillStepMs) blocks abusive floods
    //    without suppressing legitimate rapid interactions across distinct controls.
    const now = Date.now();
    const cooldownMs = gameState.difficulty?.interactionGraceMs || 70;
    const refillStepMs = Math.max(45, cooldownMs);
    const maxBurstTokens = 6;

    if (!session.actionRateState) {
      session.actionRateState = {
        tokens: maxBurstTokens,
        lastRefill: now,
        sigLastTime: new Map()
      };
    }

    const rateState = session.actionRateState;
    const elapsedSinceRefill = Math.max(0, now - rateState.lastRefill);
    if (elapsedSinceRefill > 0) {
      rateState.tokens = Math.min(maxBurstTokens, rateState.tokens + elapsedSinceRefill / refillStepMs);
      rateState.lastRefill = now;
    }

    const actionSig = `${moduleId}:${action}:${validation.targetKey}`;
    const prevSigTime = rateState.sigLastTime.get(actionSig) || 0;
    if (now - prevSigTime < cooldownMs) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'RATE_LIMITED',
          message: 'تکرار بسیار سریع همان فرمان مهار شد.'
        })
      );
      return;
    }

    if (rateState.tokens < 1) {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'RATE_LIMITED',
          message: 'تعداد فرمان‌های ارسالی بیش از حد مجاز است؛ لطفاً کمی مکث کنید.'
        })
      );
      return;
    }

    rateState.tokens -= 1;
    rateState.sigLastTime.set(actionSig, now);

    // Ignore stale race packets targeting already-solved modules or already-cut/entered slots without penalty
    const targetModState = gameState.modules[moduleId];
    if (targetModState.solved) {
      return;
    }
    if (moduleId === 'wires' && targetModState.cutWires?.includes(validation.sanitizedData.wireIndex)) {
      return;
    }
    if (moduleId === 'keypad' && targetModState.enteredSlots?.includes(validation.sanitizedData.slotIndex)) {
      return;
    }

    const lastDigit = Math.floor(Math.max(0, gameState.remainingSeconds)) % 10;
    const ctx = {
      remainingSeconds: gameState.remainingSeconds,
      lastDigit,
      serialNumber: gameState.serialNumber,
      difficulty: gameState.difficulty
    };

    // Never trust client claims of correctness: pass strictly sanitizedData
    const result = mod.handleAction(targetModState, action, validation.sanitizedData, ctx);

    if (result.strike) {
      registerStrike(result.reason);
    } else if (result.solved) {
      const solvedCount = (gameState.activeModuleIds || []).filter((id) => gameState.modules?.[id]?.solved).length;
      const totalCount = (gameState.activeModuleIds || []).length;
      log(`[GAME] Module "${moduleId}" solved (${solvedCount}/${totalCount}).`);
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
  sanitizeDifficultyConfig,
  validateBombActionPayload,
  printNetworkInterfaces,
  sanitizeTerminalText
};
