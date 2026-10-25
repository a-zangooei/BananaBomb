/**
 * Hybrid Mobile Session Store with Active Tab Lease
 *
 * Solves two competing requirements simultaneously:
 * 1) Mobile Browser Resilience: Closing and reopening a mobile browser tab (or OS memory purge)
 *    restores the player's persistent `playerId` and role from `localStorage` so the lobby or
 *    active round never loses the player's seat.
 * 2) Multi-Tab Local Testing: Opening 2 or 3 simultaneous tabs on the SAME browser detects that
 *    another tab actively holds a live lease on the primary `localStorage` identity, and mints an
 *    isolated per-tab identity in `sessionStorage` so tabs do not kick each other via `session_replaced`.
 */

const PERSISTENT_ID_KEY = 'defusal_persistent_player_id';
const PERSISTENT_ROLE_KEY = 'defusal_persistent_role';
const SESSION_ID_KEY = 'defusal_player_id';
const SESSION_ROLE_KEY = 'defusal_role';
const SESSION_TAB_ID_KEY = 'defusal_tab_id';
const TAB_LEASES_KEY = 'defusal_tab_leases';
const LEASE_TTL_MS = 4500;
const HEARTBEAT_INTERVAL_MS = 1500;

function generateRandomId(prefix = 'p_') {
  return `${prefix}${Math.random().toString(36).substring(2, 10)}`;
}

function readLeases(localStore, now) {
  try {
    const raw = localStore.getItem(TAB_LEASES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const pruned = {};
    for (const [pId, entry] of Object.entries(parsed)) {
      if (entry && typeof entry.tabId === 'string' && typeof entry.updatedAt === 'number') {
        if (now - entry.updatedAt < LEASE_TTL_MS) {
          pruned[pId] = entry;
        }
      }
    }
    return pruned;
  } catch (e) {
    return {};
  }
}

function writeLeases(localStore, leases) {
  try {
    localStore.setItem(TAB_LEASES_KEY, JSON.stringify(leases));
  } catch (e) {}
}

export function createHybridSessionManager(options = {}) {
  const localStore = options.localStorage || window.localStorage;
  const sessionStore = options.sessionStorage || window.sessionStorage;
  const nowFn = options.now || (() => Date.now());

  const now = nowFn();

  // 1. Identify this browser tab uniquely across reloads (sessionStorage survives F5 reload, resets on new/closed tab)
  let tabId = null;
  try {
    tabId = sessionStore.getItem(SESSION_TAB_ID_KEY);
    if (!tabId) {
      tabId = generateRandomId('tab_');
      sessionStore.setItem(SESSION_TAB_ID_KEY, tabId);
    }
  } catch (e) {
    tabId = generateRandomId('tab_');
  }

  const leases = readLeases(localStore, now);
  let persistentId = null;
  try {
    persistentId = localStore.getItem(PERSISTENT_ID_KEY);
  } catch (e) {}

  let existingSessionId = null;
  try {
    existingSessionId = sessionStore.getItem(SESSION_ID_KEY);
  } catch (e) {}

  let playerId = null;
  let isPrimaryPersistentOwner = false;

  // Case A: This tab already has a sessionStorage playerId (e.g. page reload) and nobody else holds its lease
  if (existingSessionId && (!leases[existingSessionId] || leases[existingSessionId].tabId === tabId)) {
    playerId = existingSessionId;
    isPrimaryPersistentOwner = Boolean(persistentId && existingSessionId === persistentId);
    if (!persistentId) {
      persistentId = playerId;
      isPrimaryPersistentOwner = true;
      try {
        localStore.setItem(PERSISTENT_ID_KEY, persistentId);
      } catch (e) {}
    }
  } else if (persistentId && (!leases[persistentId] || leases[persistentId].tabId === tabId)) {
    // Case B: Fresh/reopened tab after previous tab closed! Claim the persistent mobile identity.
    playerId = persistentId;
    isPrimaryPersistentOwner = true;
  } else if (!persistentId) {
    // Case C: First ever visit on this browser
    playerId = generateRandomId('p_');
    persistentId = playerId;
    isPrimaryPersistentOwner = true;
    try {
      localStore.setItem(PERSISTENT_ID_KEY, persistentId);
    } catch (e) {}
  } else {
    // Case D: Another open tab on this browser actively holds `persistentId` -> mint isolated secondary tab ID!
    playerId = generateRandomId('p_');
    isPrimaryPersistentOwner = false;
  }

  try {
    sessionStore.setItem(SESSION_ID_KEY, playerId);
  } catch (e) {}

  // Register initial lease synchronously
  leases[playerId] = { tabId, updatedAt: now };
  writeLeases(localStore, leases);

  // Restore saved role for this identity
  let initialRole = null;
  try {
    initialRole = sessionStore.getItem(SESSION_ROLE_KEY);
    if (!initialRole && isPrimaryPersistentOwner) {
      initialRole = localStore.getItem(PERSISTENT_ROLE_KEY);
      if (initialRole) {
        sessionStore.setItem(SESSION_ROLE_KEY, initialRole);
      }
    }
  } catch (e) {}

  function renewLease() {
    const currentNow = nowFn();
    const currentLeases = readLeases(localStore, currentNow);
    currentLeases[playerId] = { tabId, updatedAt: currentNow };
    writeLeases(localStore, currentLeases);
  }

  function releaseLease() {
    const currentNow = nowFn();
    const currentLeases = readLeases(localStore, currentNow);
    if (currentLeases[playerId] && currentLeases[playerId].tabId === tabId) {
      delete currentLeases[playerId];
      writeLeases(localStore, currentLeases);
    }
  }

  let heartbeatTimer = null;
  if (options.autoHeartbeat !== false && typeof window !== 'undefined') {
    heartbeatTimer = window.setInterval(renewLease, HEARTBEAT_INTERVAL_MS);
    window.addEventListener('pagehide', releaseLease);
    window.addEventListener('beforeunload', releaseLease);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        renewLease();
      }
    });
  }

  return {
    playerId,
    tabId,
    isPrimaryPersistentOwner,
    getRole() {
      try {
        return sessionStore.getItem(SESSION_ROLE_KEY) || (isPrimaryPersistentOwner ? localStore.getItem(PERSISTENT_ROLE_KEY) : null) || null;
      } catch (e) {
        return null;
      }
    },
    setRole(role) {
      try {
        if (role) {
          sessionStore.setItem(SESSION_ROLE_KEY, role);
          if (isPrimaryPersistentOwner) {
            localStore.setItem(PERSISTENT_ROLE_KEY, role);
          }
        } else {
          sessionStore.removeItem(SESSION_ROLE_KEY);
          if (isPrimaryPersistentOwner) {
            localStore.removeItem(PERSISTENT_ROLE_KEY);
          }
        }
      } catch (e) {}
    },
    renewLease,
    releaseLease,
    dispose() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      releaseLease();
    }
  };
}
