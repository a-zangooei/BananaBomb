/**
 * Authoritative Game State Engine, Timers & Role-Filtered State Projection.
 *
 * Guarantees that puzzle secrets (`seed`, `correctWireIndex`, `targetReleaseDigit`,
 * `correctOrder`, `targetChannel`) never leave the server, and projects strict
 * per-role views for Operator, Observer, Manual-holder, and unassigned spectators.
 */
import { WebSocket } from 'ws';
import {
  ROLES,
  canonicalRole,
  isOperatorRole,
  isObserverRole,
  isManualRole,
  roleMeta
} from '../shared/roles.js';
import {
  DEFAULT_DIFFICULTY_ID,
  sanitizeDifficultyConfig
} from '../shared/difficulty.js';
import { createCommAidState } from '../shared/comm-aid.js';
import {
  createRng,
  generateRandomSeed,
  generateSerialNumber
} from '../shared/utils.js';
import { activeModules } from '../modules/index.js';
import { selectRoundRules } from '../modules/rules-config.js';
import { log, sanitizeTerminalText, formatRoleForLog } from './logger.js';
import {
  sessions,
  activeSockets,
  roles,
  getHostPlayerId,
  releaseRole,
  areAllRolesReady,
  resetAllSessionRateLimits,
  updateHost,
  bindHostStateTarget
} from './session-registry.js';

let attachedWss = null;
let gameTimerInterval = null;
let countdownTimer = null;
let pendingCountdownSeed = null;

const defaultDifficulty = sanitizeDifficultyConfig(DEFAULT_DIFFICULTY_ID);
const defaultDuration = defaultDifficulty.duration + (defaultDifficulty.features?.timerGraceSeconds || 0);

export const gameState = {
  status: 'waiting', // 'waiting' | 'ready' | 'countdown' | 'running' | 'exploded' | 'defused'
  seed: null,        // Server internal seed (never sent to client)
  roundSeed: generateRandomSeed(), // Public room match seed
  roundRules: null,  // Authoritative selected schemas & rulebook
  startTime: null,   // Server timestamp in ms
  countdownEndsAt: null, // Server timestamp in ms when 3s readiness curtain finishes
  countdownDurationMs: 3000,
  duration: defaultDuration,
  remainingSeconds: defaultDuration,
  strikes: 0,
  maxStrikes: defaultDifficulty.maxStrikes,
  difficulty: defaultDifficulty,
  commAid: createCommAidState(defaultDifficulty),
  activeModuleIds: activeModules.slice(0, defaultDifficulty.moduleCount).map((m) => m.id),
  processedActionIds: new Set(),
  serialNumber: '',
  endReason: null,   // 'time_out' | 'max_strikes' | 'all_modules_defused'
  hostPlayerId: null,
  modules: {}        // Authoritative module states
};

bindHostStateTarget(gameState);

export function bindWebSocketServer(wss) {
  attachedWss = wss;
}

export function checkDefused() {
  const activeIds = gameState.activeModuleIds || activeModules.map((m) => m.id);
  const activeMods = activeModules.filter((mod) => activeIds.includes(mod.id));
  return activeMods.length > 0 && activeMods.every((mod) => mod.isSolved(gameState.modules[mod.id]));
}

export function getFilteredStateForRole(rawRole) {
  const role = canonicalRole(rawRole);
  const isOperator = isOperatorRole(role);
  const isObserver = isObserverRole(role);
  const isManual = isManualRole(role);

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

  const buildRoleSlotSummary = (slot, meta) => ({
    playerId: slot.playerId,
    connected: slot.connected,
    ready: Boolean(slot.connected && slot.ready !== false),
    title: meta.title,
    subtitle: meta.subtitle
  });

  const common = {
    status: gameState.status,
    roundSeed: gameState.roundSeed,
    startTime: gameState.startTime,
    countdownEndsAt: gameState.countdownEndsAt,
    countdownDurationMs: gameState.countdownDurationMs,
    duration: gameState.duration,
    remainingSeconds: gameState.remainingSeconds,
    strikes: gameState.strikes,
    maxStrikes: gameState.maxStrikes,
    difficulty: gameState.difficulty,
    commAid: roleCommAid,
    endReason: gameState.endReason,
    hostPlayerId: getHostPlayerId(),
    moduleIds: activeIds,
    modulesDefusedCount,
    totalModulesCount,
    roles: {
      operator: buildRoleSlotSummary(roles.blind, roleMeta.operator),
      observer: buildRoleSlotSummary(roles.deaf, roleMeta.observer),
      manual: buildRoleSlotSummary(roles.mute, roleMeta.manual),
      blind: buildRoleSlotSummary(roles.blind, roleMeta.blind),
      deaf: buildRoleSlotSummary(roles.deaf, roleMeta.deaf),
      mute: buildRoleSlotSummary(roles.mute, roleMeta.mute)
    },
    serverTimestamp: Date.now()
  };

  if (gameState.status !== 'running' && gameState.status !== 'exploded' && gameState.status !== 'defused') {
    return {
      ...common,
      serialNumber: null,
      modules: null,
      roundManual: gameState.status === 'countdown' ? null : (isManual && gameState.roundRules ? gameState.roundRules.rulebook : null),
      canInteract: false
    };
  }

  const filteredModules = {};
  for (const mod of activeModules) {
    if (!activeIds.includes(mod.id)) continue;
    filteredModules[mod.id] = mod.filterForRole(role, gameState.modules[mod.id], { difficulty: gameState.difficulty });
  }

  if (isOperator) {
    return {
      ...common,
      serialNumber: null,
      canInteract: true,
      hasAudio: true,
      isMonochrome: true,
      roundManual: null,
      modules: filteredModules
    };
  }

  if (isObserver) {
    return {
      ...common,
      serialNumber: gameState.serialNumber,
      canInteract: false,
      hasAudio: false,
      isMonochrome: false,
      roundManual: null,
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

  return {
    ...common,
    serialNumber: null,
    canInteract: false,
    hasAudio: false,
    roundManual: null,
    modules: null
  };
}

export function sendStateToClient(ws) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const socketInfo = activeSockets.get(ws);
  const session = socketInfo ? sessions.get(socketInfo.playerId) : null;
  const role = session ? session.role : null;
  const filteredState = getFilteredStateForRole(role);
  ws.send(JSON.stringify({ type: 'state_update', state: filteredState, data: filteredState }));
}

export function broadcastFullState() {
  if (!attachedWss) return;
  for (const client of attachedWss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      sendStateToClient(client);
    }
  }
}

export function broadcastEvent(data) {
  if (!attachedWss) return;
  const msg = JSON.stringify(data);
  for (const client of attachedWss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  }
}

export function checkReadyStatus() {
  const allRolesAssignedAndConnected = areAllRolesReady();
  if (gameState.status === 'waiting' && allRolesAssignedAndConnected) {
    gameState.status = 'ready';
  } else if (gameState.status === 'ready' && !allRolesAssignedAndConnected) {
    gameState.status = 'waiting';
  }
}

export function stopGameTimer() {
  if (gameTimerInterval) {
    clearInterval(gameTimerInterval);
    gameTimerInterval = null;
  }
}

export function stopCountdownTimer() {
  if (countdownTimer) {
    clearTimeout(countdownTimer);
    countdownTimer = null;
  }
  pendingCountdownSeed = null;
  gameState.countdownEndsAt = null;
}

export function startPreRoundCountdown(customSeed = null, countdownMs = 3000) {
  if (gameState.status !== 'ready') return false;
  stopCountdownTimer();
  stopGameTimer();

  const clampedMs = Math.min(10000, Math.max(500, Number(countdownMs) || 3000));
  pendingCountdownSeed = customSeed || null;
  gameState.status = 'countdown';
  gameState.countdownDurationMs = clampedMs;
  gameState.countdownEndsAt = Date.now() + clampedMs;

  log(`[GAME] Pre-round countdown started (${(clampedMs / 1000).toFixed(1)}s).`);

  broadcastEvent({
    type: 'countdown_started',
    countdownEndsAt: gameState.countdownEndsAt,
    countdownDurationMs: clampedMs,
    serverTimestamp: Date.now()
  });
  broadcastFullState();

  countdownTimer = setTimeout(() => {
    const seedToUse = pendingCountdownSeed;
    stopCountdownTimer();
    if (gameState.status === 'countdown') {
      if (areAllRolesReady()) {
        startGame(seedToUse);
      } else {
        gameState.status = 'waiting';
        checkReadyStatus();
        broadcastFullState();
      }
    }
  }, clampedMs);

  return true;
}

export function cancelPreRoundCountdown(reasonCode = 'player_cancelled', actorRole = null) {
  if (gameState.status !== 'countdown') return false;
  stopCountdownTimer();
  gameState.status = 'waiting';
  updateHost();
  checkReadyStatus();

  const safeReason = sanitizeTerminalText(reasonCode || 'cancelled');
  const safeActor = actorRole ? formatRoleForLog(actorRole) : 'system';
  log(`[GAME] Pre-round countdown cancelled (reason=${safeReason}, by=${safeActor}).`);

  let reasonMessage = 'شمارش معکوس شروع عملیات لغو شد.';
  if (reasonCode === 'player_disconnected') {
    reasonMessage = 'به دلیل قطع ارتباط یکی از بازیکنان، شروع عملیات متوقف شد.';
  } else if (actorRole) {
    const title = roleMeta[actorRole]?.title || 'یکی از بازیکنان';
    reasonMessage = `شمارش معکوس شروع توسط «${title}» لغو شد.`;
  }

  broadcastEvent({
    type: 'countdown_cancelled',
    reason: reasonCode,
    actorRole: safeActor,
    message: reasonMessage
  });
  broadcastFullState();
  return true;
}

export function triggerExplosion(reason) {
  if (gameState.status !== 'running') return;
  stopGameTimer();
  gameState.status = 'exploded';
  gameState.endReason = reason;
  log(`[GAME] Bomb exploded (reason=${reason}).`);
  broadcastFullState();
}

export function triggerDefusal() {
  if (gameState.status !== 'running') return;
  stopGameTimer();
  gameState.status = 'defused';
  gameState.endReason = 'all_modules_defused';
  log('[GAME] Bomb defused! All active modules solved.');
  broadcastFullState();
}

export function registerStrike(reason) {
  if (gameState.status !== 'running') return;
  gameState.strikes += 1;

  const penalty = gameState.difficulty?.timePenaltySeconds ?? 30;
  if (penalty > 0 && gameState.startTime) {
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

export function startGame(customSeed = null) {
  stopCountdownTimer();
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

  const modCount = gameState.difficulty.moduleCount || activeModules.length;
  const selectedMods = activeModules.slice(0, modCount);
  gameState.activeModuleIds = selectedMods.map((m) => m.id);

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

  resetAllSessionRateLimits();

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

export function resetGame(clearDisconnectedRoles = true) {
  stopCountdownTimer();
  stopGameTimer();
  gameState.status = 'waiting';
  gameState.seed = null;
  gameState.roundSeed = generateRandomSeed();
  gameState.roundRules = null;
  gameState.startTime = null;
  gameState.processedActionIds = new Set();
  resetAllSessionRateLimits();

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
    for (const r of ROLES) {
      if (!roles[r].connected) {
        releaseRole(r);
      }
    }
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
