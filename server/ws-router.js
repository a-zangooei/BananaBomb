/**
 * WebSocket Connection Lifecycle & Client Event Router.
 *
 * Routes parsed client messages (`ping`, `join`, `leave`, `set_ready`,
 * `release_disconnected_role`, `start`, `start_countdown`, `cancel_countdown`,
 * `set_seed`, `set_difficulty`, `reset`, `action`, `comm_signal`) to focused
 * handlers backed by the session registry, rate limiter, and authoritative game engine.
 */
import { WebSocket } from 'ws';
import { ROLES, canonicalRole, roleMeta } from '../shared/roles.js';
import { sanitizeDifficultyConfig } from '../shared/difficulty.js';
import { COMM_AID_SYMBOLS, createCommAidState } from '../shared/comm-aid.js';
import {
  activeModules,
  modulesById,
  validateBombActionPayload
} from '../modules/index.js';
import { log, logError, shortPlayerId, formatRoleForLog } from './logger.js';
import {
  sessions,
  activeSockets,
  roles,
  allocateSocketId,
  getHostPlayerId,
  getRoleByPlayerId,
  releaseRole,
  releasePlayerCurrentRole,
  updateHost
} from './session-registry.js';
import {
  isDuplicateAndRecordActionId,
  evaluateActionRateLimit
} from './rate-limiter.js';
import {
  gameState,
  sendStateToClient,
  broadcastFullState,
  broadcastEvent,
  checkReadyStatus,
  startPreRoundCountdown,
  cancelPreRoundCountdown,
  startGame,
  resetGame,
  checkDefused,
  triggerDefusal,
  registerStrike
} from './game-engine.js';

function sendError(ws, code, message) {
  ws.send(JSON.stringify({ type: 'error', code, message }));
}

function handlePing(ws, msg) {
  ws.send(
    JSON.stringify({
      type: 'pong',
      clientTime: msg.clientTime || 0,
      serverTime: Date.now()
    })
  );
}

function handleJoin(ws, msg, payload) {
  const role = payload?.role || msg.role;
  const playerId = payload?.playerId || msg.playerId;

  if (!playerId || typeof playerId !== 'string' || !playerId.trim() || playerId.length > 64) {
    sendError(ws, 'INVALID_PLAYER_ID', 'شناسه بازیکن نامعتبر است.');
    return;
  }
  const cleanPlayerId = playerId.trim();
  const targetRole = canonicalRole(role);

  if (!ROLES.includes(targetRole)) {
    sendError(ws, 'INVALID_ROLE', 'نقش انتخاب شده نامعتبر است.');
    return;
  }

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
    // Newer connection replaces older connection; older socket is closed cleanly
    if (session.socket && session.socket !== ws && session.connected) {
      log(`[WS] Duplicate session detected for player ${shortPlayerId(cleanPlayerId)}; closing older socket.`);
      const oldSocket = session.socket;
      try {
        oldSocket.send(
          JSON.stringify({
            type: 'session_replaced',
            message: 'نشست شما در دستگاه یا تب دیگری فعال شد.'
          })
        );
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

  if ((gameState.status === 'running' || gameState.status === 'countdown') && previousRole && previousRole !== targetRole) {
    sendError(ws, 'CANNOT_SWITCH_MIDGAME', 'تغییر نقش در حین انجام عملیات خنثی‌سازی مجاز نیست.');
    return;
  }

  if (currentRole.playerId && currentRole.playerId !== cleanPlayerId && currentRole.connected) {
    sendError(
      ws,
      'ROLE_TAKEN',
      `نقش «${(roleMeta[role] || roleMeta[targetRole]).title}» هم‌اکنون توسط بازیکن دیگری انتخاب شده است.`
    );
    return;
  }

  if (previousRole && previousRole !== targetRole) {
    releaseRole(previousRole);
    log(`[ROLE] Player ${shortPlayerId(cleanPlayerId)} released previous role [${formatRoleForLog(previousRole)}].`);
  }

  if (currentRole.playerId && currentRole.playerId !== cleanPlayerId && !currentRole.connected) {
    const formerSess = sessions.get(currentRole.playerId);
    if (formerSess && formerSess.role === targetRole) {
      formerSess.role = null;
    }
    releaseRole(targetRole);
  }

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
}

function handleLeave(ws) {
  const socketInfo = activeSockets.get(ws);
  if (!socketInfo) return;

  const { playerId } = socketInfo;
  if (gameState.status === 'running') {
    sendError(ws, 'CANNOT_LEAVE_MIDGAME', 'ترک نقش در حین اجرای عملیات مجاز نیست.');
    return;
  }

  const released = releasePlayerCurrentRole(playerId);
  if (released) {
    log(`[ROLE] Player ${shortPlayerId(playerId)} left role [${formatRoleForLog(released)}].`);
    ws.send(JSON.stringify({ type: 'role_released' }));
    if (gameState.status === 'countdown') {
      cancelPreRoundCountdown('player_cancelled', released);
    } else {
      updateHost();
      checkReadyStatus();
      broadcastFullState();
    }
  }
}

function handleSetReady(ws, payload) {
  if (gameState.status !== 'waiting' && gameState.status !== 'ready') return;
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
}

function handleReleaseDisconnectedRole(ws, msg, payload) {
  if (gameState.status !== 'waiting' && gameState.status !== 'ready') {
    sendError(ws, 'INVALID_STATE', 'آزادسازی نقش فقط در لابی امکان‌پذیر است.');
    return;
  }

  const socketInfo = activeSockets.get(ws);
  const playerId = socketInfo ? socketInfo.playerId : null;
  if (!playerId || playerId !== getHostPlayerId()) {
    sendError(ws, 'UNAUTHORIZED', 'تنها میزبان تیم مجاز به آزادسازی نقش بازیکن قطع‌شده است.');
    return;
  }

  const rawTarget = payload?.role || msg.role;
  const targetRole = canonicalRole(rawTarget);
  if (!ROLES.includes(targetRole)) {
    sendError(ws, 'INVALID_ROLE', 'نقش مورد نظر نامعتبر است.');
    return;
  }

  const slot = roles[targetRole];
  if (!slot.playerId || slot.connected) {
    sendError(ws, 'ROLE_NOT_DISCONNECTED', 'فقط نقش‌هایی که ارتباط بازیکنشان قطع شده قابل آزادسازی هستند.');
    return;
  }

  releaseRole(targetRole);
  updateHost();
  checkReadyStatus();
  log(`[LOBBY] Host ${shortPlayerId(playerId)} released disconnected role [${formatRoleForLog(targetRole)}].`);

  broadcastEvent({
    type: 'disconnected_role_released',
    role: targetRole,
    roleTitle: roleMeta[targetRole]?.title || targetRole
  });
  broadcastFullState();
}

function handleStartOrCountdown(ws, type, msg, payload) {
  const socketInfo = activeSockets.get(ws);
  const playerId = socketInfo ? socketInfo.playerId : null;

  if (!playerId || playerId !== getHostPlayerId()) {
    sendError(ws, 'UNAUTHORIZED', 'تنها میزبان بازی مجاز به شروع عملیات است.');
    return;
  }

  if (gameState.status !== 'ready') {
    sendError(ws, 'NOT_READY', 'بازی تنها زمانی شروع می‌شود که هر ۳ نقش انتخاب شده و متصل باشند.');
    return;
  }

  const customSeed = payload?.seed || msg.seed;
  const requestedCountdownMs =
    type === 'start_countdown'
      ? (Number(payload?.countdownMs) || (Number(payload?.countdownSeconds) ? Number(payload.countdownSeconds) * 1000 : 3000))
      : (Number(payload?.countdownMs) || (Number(payload?.countdownSeconds) ? Number(payload.countdownSeconds) * 1000 : 0));

  if (requestedCountdownMs > 0) {
    startPreRoundCountdown(customSeed, requestedCountdownMs);
  } else {
    startGame(customSeed);
  }
}

function handleCancelCountdown(ws) {
  if (gameState.status !== 'countdown') return;

  const socketInfo = activeSockets.get(ws);
  const session = socketInfo ? sessions.get(socketInfo.playerId) : null;
  const senderRole = session?.role ? canonicalRole(session.role) : null;
  const isAssignedConnectedPlayer = Boolean(
    session &&
    session.connected &&
    senderRole &&
    roles[senderRole]?.playerId === session.playerId &&
    roles[senderRole]?.connected
  );
  const isHostSender = Boolean(session && session.connected && session.playerId === getHostPlayerId());

  if (!isAssignedConnectedPlayer && !isHostSender) {
    sendError(ws, 'UNAUTHORIZED', 'تنها اعضای تیم مجاز به لغو شمارش معکوس هستند.');
    return;
  }

  cancelPreRoundCountdown('player_cancelled', senderRole);
}

function handleSetSeed(ws, msg, payload) {
  if (gameState.status !== 'waiting' && gameState.status !== 'ready') {
    sendError(ws, 'INVALID_STATE', 'تنظیم سید فقط در لابی امکان‌پذیر است.');
    return;
  }
  const socketInfo = activeSockets.get(ws);
  const playerId = socketInfo ? socketInfo.playerId : null;
  if (!playerId || playerId !== getHostPlayerId()) {
    sendError(ws, 'UNAUTHORIZED', 'تنها میزبان مجاز به تغییر سید بازی است.');
    return;
  }
  const rawSeed = payload?.seed || msg.seed;
  if (typeof rawSeed !== 'string' || !rawSeed.trim()) {
    sendError(ws, 'INVALID_SEED', 'سید وارد شده معتبر نیست.');
    return;
  }
  const cleanSeed = rawSeed.trim().replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 16).toUpperCase();
  if (cleanSeed.length < 3) {
    sendError(ws, 'INVALID_SEED', 'سید بازی باید حداقل ۳ نویسه باشد.');
    return;
  }
  gameState.roundSeed = cleanSeed;
  broadcastFullState();
}

function handleSetDifficulty(ws, msg, payload) {
  if (gameState.status !== 'waiting' && gameState.status !== 'ready') {
    sendError(ws, 'INVALID_STATE', 'تنظیم درجه سختی فقط در لابی امکان‌پذیر است.');
    return;
  }

  const socketInfo = activeSockets.get(ws);
  const playerId = socketInfo ? socketInfo.playerId : null;
  if (!playerId || playerId !== getHostPlayerId()) {
    sendError(ws, 'UNAUTHORIZED', 'تنها میزبان بازی مجاز به تغییر درجه سختی است.');
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
}

function handleReset(ws) {
  if (!['waiting', 'exploded', 'defused'].includes(gameState.status)) {
    sendError(ws, 'INVALID_STATE', 'ریست کردن بازی فقط پس از اتمام بازی یا در لابی امکان‌پذیر است.');
    return;
  }

  const socketInfo = activeSockets.get(ws);
  const playerId = socketInfo ? socketInfo.playerId : null;
  if (!playerId || playerId !== getHostPlayerId()) {
    sendError(ws, 'UNAUTHORIZED', 'تنها میزبان بازی مجاز به ریست کردن است.');
    return;
  }

  resetGame(true);
}

function handleBombAction(ws, msg, payload) {
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
    sendError(ws, 'UNAUTHORIZED_ACTION', 'تنها اپراتور بمب (Operator) مجاز به تعامل فیزیکی با ماژول‌های بمب است!');
    return;
  }

  if (gameState.status !== 'running') {
    sendError(ws, 'INVALID_PHASE', 'اجرای فرمان روی بمب فقط در فاز در حال اجرا (Running) مجاز است.');
    return;
  }

  const actionData = payload !== undefined ? payload : (msg.data !== undefined ? msg.data : msg);
  if (!actionData || typeof actionData !== 'object' || Array.isArray(actionData)) {
    sendError(ws, 'MALFORMED_ACTION', 'ساختار بسته فرمان ارسالی نامعتبر است.');
    return;
  }

  if (typeof actionData.roundSeed === 'string' && actionData.roundSeed.trim() && actionData.roundSeed !== gameState.roundSeed) {
    sendError(ws, 'STALE_ACTION', 'این فرمان مربوط به راند قبلی است و بدون ثبت خطا نادیده گرفته شد.');
    return;
  }

  if (
    typeof actionData.clientTimestamp === 'number' &&
    Number.isFinite(actionData.clientTimestamp) &&
    gameState.startTime &&
    actionData.clientTimestamp < gameState.startTime - 1500
  ) {
    sendError(ws, 'STALE_ACTION', 'فرمان منقضی‌شده پیش از شروع راند نادیده گرفته شد.');
    return;
  }

  const { moduleId, action, data } = actionData;
  if (typeof moduleId !== 'string' || typeof action !== 'string') {
    sendError(ws, 'MALFORMED_ACTION', 'شناسه ماژول یا نوع عملیات معتبر نیست.');
    return;
  }

  const activeIds = gameState.activeModuleIds || activeModules.map((m) => m.id);
  const mod = modulesById.get(moduleId);
  if (!mod || !activeIds.includes(moduleId) || !gameState.modules?.[moduleId]) {
    sendError(ws, 'MALFORMED_ACTION', 'ماژول هدف در این راند فعال یا موجود نیست.');
    return;
  }

  const validation = validateBombActionPayload(moduleId, action, data);
  if (!validation.ok) {
    sendError(ws, 'MALFORMED_ACTION', validation.message);
    return;
  }

  const actionId = typeof (actionData.actionId || msg.actionId) === 'string'
    ? (actionData.actionId || msg.actionId).trim()
    : '';
  if (actionId && isDuplicateAndRecordActionId(gameState, actionId)) {
    ws.send(
      JSON.stringify({
        type: 'action_duplicate',
        actionId,
        message: 'عملیات تکراری نادیده گرفته شد.'
      })
    );
    return;
  }

  const rateCheck = evaluateActionRateLimit(
    session,
    `${moduleId}:${action}:${validation.targetKey}`,
    gameState.difficulty?.interactionGraceMs || 70
  );
  if (!rateCheck.allowed) {
    sendError(ws, 'RATE_LIMITED', rateCheck.message);
    return;
  }

  // Ignore stale race packets targeting already-solved modules or already-committed slots without penalty
  const targetModState = gameState.modules[moduleId];
  if (
    targetModState.solved ||
    (typeof mod.isRedundantAction === 'function' &&
      mod.isRedundantAction(targetModState, action, validation.sanitizedData))
  ) {
    return;
  }

  const lastDigit = Math.floor(Math.max(0, gameState.remainingSeconds)) % 10;
  const ctx = {
    remainingSeconds: gameState.remainingSeconds,
    lastDigit,
    serialNumber: gameState.serialNumber,
    difficulty: gameState.difficulty
  };

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
}

function handleCommSignal(wss, ws, msg, payload) {
  if (gameState.status !== 'running') {
    sendError(ws, 'INVALID_STATE', 'ارسال نماد کمک‌ارتباطی فقط در حین اجرای راند مجاز است.');
    return;
  }

  const socketInfo = activeSockets.get(ws);
  const session = socketInfo ? sessions.get(socketInfo.playerId) : null;
  const senderRole = session ? canonicalRole(session.role) : null;

  // Strictly enforce canonical communication graph: Only Observer ('deaf') and Manual-holder ('mute') share this bridge
  if (senderRole !== 'deaf' && senderRole !== 'mute') {
    sendError(
      ws,
      'UNAUTHORIZED_COMM_ROLE',
      'کمک‌ارتباطی فقط بین ناظر و دارنده دفترچه راهنما فعال است؛ ارتباط مستقیم با اپراتور مجاز نیست.'
    );
    return;
  }

  const reqData = payload || msg.data || msg;
  if (
    reqData?.text !== undefined ||
    reqData?.chat !== undefined ||
    reqData?.answer !== undefined ||
    msg.text !== undefined ||
    msg.chat !== undefined
  ) {
    sendError(ws, 'INVALID_COMM_SYMBOL', 'ارسال متن آزاد یا میانبر پاسخ ممنوع است؛ فقط سه نماد استاندارد مجاز هستند.');
    return;
  }

  const symbolId = typeof reqData?.symbolId === 'string' ? reqData.symbolId.trim() : '';
  const symbolDef = COMM_AID_SYMBOLS[symbolId];
  if (!symbolDef) {
    sendError(ws, 'INVALID_COMM_SYMBOL', 'نماد انتخاب‌شده معتبر نیست. فقط تأیید، رد یا زمان/فوری مجاز است.');
    return;
  }

  if (!gameState.commAid || !gameState.commAid.enabled) {
    sendError(ws, 'COMM_AID_DISABLED', 'کمک‌ارتباطی ۳ نمادی در درجه سختی فعلی غیرفعال است.');
    return;
  }

  const actionId = reqData?.actionId || msg.actionId;
  if (actionId && isDuplicateAndRecordActionId(gameState, actionId)) {
    ws.send(
      JSON.stringify({
        type: 'action_duplicate',
        actionId,
        message: 'نماد تکراری نادیده گرفته شد.'
      })
    );
    return;
  }

  if (gameState.commAid.remainingUses <= 0) {
    sendError(
      ws,
      'COMM_BUDGET_EXHAUSTED',
      'سهمیه کمک‌ارتباطی در این راند به پایان رسیده است؛ از اشاره‌های توافقی استفاده کنید.'
    );
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
}

export function handleClientEvent(wss, ws, msg) {
  const { type, payload } = msg;

  switch (type) {
    case 'ping':
      handlePing(ws, msg);
      return;
    case 'join':
      handleJoin(ws, msg, payload);
      return;
    case 'leave':
      handleLeave(ws);
      return;
    case 'set_ready':
      handleSetReady(ws, payload);
      return;
    case 'release_disconnected_role':
      handleReleaseDisconnectedRole(ws, msg, payload);
      return;
    case 'start':
    case 'start_countdown':
      handleStartOrCountdown(ws, type, msg, payload);
      return;
    case 'cancel_countdown':
      handleCancelCountdown(ws);
      return;
    case 'set_seed':
      handleSetSeed(ws, msg, payload);
      return;
    case 'set_difficulty':
      handleSetDifficulty(ws, msg, payload);
      return;
    case 'reset':
      handleReset(ws);
      return;
    case 'action':
      handleBombAction(ws, msg, payload);
      return;
    case 'comm_signal':
      handleCommSignal(wss, ws, msg, payload);
      return;
    default:
      return;
  }
}

export function attachWebSocketServer(wss) {
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    const socketId = allocateSocketId();
    ws.socketId = socketId;

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    sendStateToClient(ws);

    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        handleClientEvent(wss, ws, message);
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

      // Ensure an old socket closing after a reconnect cannot accidentally remove the new active session
      if (session && session.socketId === socketId) {
        session.connected = false;
        session.socket = null;

        if (session.role && roles[session.role] && roles[session.role].playerId === playerId) {
          roles[session.role].connected = false;
          log(`[WS] Player ${shortPlayerId(playerId)} disconnected from role [${formatRoleForLog(session.role)}].`);
        }

        if (gameState.status === 'countdown') {
          cancelPreRoundCountdown('player_disconnected', session.role);
          return;
        }

        updateHost();
        checkReadyStatus();
        broadcastFullState();
      } else {
        log(`[WS] Stale socket #${socketId} closed for player ${shortPlayerId(playerId)}; active session unaffected.`);
      }
    });
  });
}
