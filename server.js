import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { activeModules, modulesById } from './modules/index.js';
import { selectRoundRules } from './modules/rules-config.js';

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
const ROLES = ['blind', 'deaf', 'mute'];

const roleMeta = {
  blind: { title: 'نابینا (Blind)', subtitle: 'تنها تعامل‌گر سه‌بعدی بمب (مونوکروم و تنها نقش شنونده صدا)' },
  deaf: { title: 'ناشنوا (Deaf)', subtitle: 'مشاهده کامل رنگ‌ها و سریال در صحنه ۳D (بدون لمس و بدون صدا)' },
  mute: { title: 'بی‌کلام (Mute)', subtitle: 'دفترچه راهنمای قوانین رمزگشایی ۲D (فقط مطالعه، بدون لمس و بدون صدا)' }
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

let gameState = {
  status: 'waiting', // 'waiting' | 'ready' | 'running' | 'exploded' | 'defused'
  seed: null,        // Server internal seed (never sent to client)
  roundSeed: generateRandomSeed(), // Public room match seed
  roundRules: null,  // Authoritative selected schemas & rulebook
  startTime: null,   // Server timestamp in ms
  duration: 300,     // 5 minutes in seconds
  remainingSeconds: 300,
  strikes: 0,
  maxStrikes: 3,
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
  return activeModules.every((mod) => mod.isSolved(gameState.modules[mod.id]));
}

// --- Role-filtered state generation (Secrets & Seed are NEVER sent) ---
function getFilteredStateForRole(role) {
  const common = {
    status: gameState.status,
    roundSeed: gameState.roundSeed,
    startTime: gameState.startTime,
    duration: gameState.duration,
    remainingSeconds: gameState.remainingSeconds,
    strikes: gameState.strikes,
    maxStrikes: gameState.maxStrikes,
    endReason: gameState.endReason,
    hostPlayerId: hostPlayerId,
    moduleIds: activeModules.map((m) => m.id),
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
      roundManual: role === 'mute' && gameState.roundRules ? gameState.roundRules.rulebook : null,
      canInteract: false
    };
  }

  // Filter modules polymorphically using each module's filterForRole
  const filteredModules = {};
  for (const mod of activeModules) {
    filteredModules[mod.id] = mod.filterForRole(role, gameState.modules[mod.id]);
  }

  if (role === 'blind') {
    return {
      ...common,
      serialNumber: null, // Blind cannot see serial number
      canInteract: true,
      hasAudio: true,
      isMonochrome: true,
      roundManual: null,  // Strictly null for blind
      modules: filteredModules
    };
  }

  if (role === 'deaf') {
    return {
      ...common,
      serialNumber: gameState.serialNumber, // Deaf observes serial plate
      canInteract: false,
      hasAudio: false,
      isMonochrome: false,
      roundManual: null,  // Strictly null for deaf
      modules: filteredModules
    };
  }

  if (role === 'mute') {
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

  const serial = generateSerialNumber(rng);
  const lastSerialDigit = parseInt(serial[serial.length - 1], 10);
  const isSerialEven = lastSerialDigit % 2 === 0;
  const ctx = { serialNumber: serial, isSerialEven, rng, roundRules };

  // Dynamically initialize all active modules using roundRules
  gameState.serialNumber = serial;
  gameState.modules = {};
  for (const mod of activeModules) {
    gameState.modules[mod.id] = mod.create(rng, ctx);
  }

  gameState.strikes = 0;
  gameState.endReason = null;
  gameState.duration = 300; // 5 minutes
  gameState.remainingSeconds = 300;
  gameState.startTime = Date.now();
  gameState.status = 'running';

  broadcastEvent({
    type: 'game_started',
    startTime: gameState.startTime,
    duration: gameState.duration,
    roundSeed: gameState.roundSeed,
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
  gameState.duration = 300;
  gameState.remainingSeconds = 300;
  gameState.strikes = 0;
  gameState.endReason = null;
  gameState.serialNumber = '';
  gameState.modules = {};

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
    const { role, playerId } = payload || {};

    // Validate inputs strictly
    if (!playerId || typeof playerId !== 'string' || !playerId.trim() || playerId.length > 64) {
      ws.send(JSON.stringify({ type: 'error', code: 'INVALID_PLAYER_ID', message: 'شناسه بازیکن نامعتبر است.' }));
      return;
    }
    const cleanPlayerId = playerId.trim();

    if (!ROLES.includes(role)) {
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

    const currentRole = roles[role];
    const previousRole = getRoleByPlayerId(cleanPlayerId);

    // If game is running, disallow switching roles mid-game
    if (gameState.status === 'running' && previousRole && previousRole !== role) {
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
          message: `نقش «${roleMeta[role].title}» هم‌اکنون توسط بازیکن دیگری انتخاب شده است.`
        })
      );
      return;
    }

    // 1. Role replacement: When a player changes roles, safely release their previous role!
    if (previousRole && previousRole !== role) {
      releaseRole(previousRole);
      log(`Player ${cleanPlayerId.substring(0, 6)} safely released previous role [${previousRole}]`);
    }

    // If target role was previously assigned to a disconnected player, transfer it cleanly
    if (currentRole.playerId && currentRole.playerId !== cleanPlayerId && !currentRole.connected) {
      const formerSess = sessions.get(currentRole.playerId);
      if (formerSess && formerSess.role === role) {
        formerSess.role = null;
      }
      releaseRole(role);
    }

    // Assign target role to this player
    currentRole.playerId = cleanPlayerId;
    currentRole.connected = true;
    currentRole.joinedAt = currentRole.joinedAt || Date.now();
    session.role = role;

    updateHost();
    checkReadyStatus();

    ws.send(
      JSON.stringify({
        type: 'role_assigned',
        role,
        playerId: cleanPlayerId,
        meta: roleMeta[role]
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

    startGame(payload?.seed);
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
    const rawSeed = payload?.seed;
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
    if (!session || session.role !== 'blind') {
      ws.send(
        JSON.stringify({
          type: 'error',
          code: 'UNAUTHORIZED_ACTION',
          message: 'تنها بازیکن نابینا (Blind) مجاز به تعامل فیزیکی با ماژول‌های بمب است!'
        })
      );
      return;
    }

    const { moduleId, action, data } = payload || {};
    if (typeof moduleId !== 'string' || typeof action !== 'string') {
      return;
    }

    // Flood protection / rate limiting (70ms between actions per player)
    const now = Date.now();
    if (session.lastActionTime && (now - session.lastActionTime < 70)) {
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
      serialNumber: gameState.serialNumber
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
  startGame,
  resetGame,
  getRoleByPlayerId,
  releaseRole,
  updateHost,
  getFilteredStateForRole,
  createRng
};
