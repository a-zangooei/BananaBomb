/**
 * Session, Socket, Role Seat & Deterministic Host Ownership Registry.
 *
 * Exports live Map/object bindings (`sessions`, `activeSockets`, `roles`) so both
 * runtime subsystems and integration tests observe consistent state in place.
 */
import { ROLES } from '../shared/roles.js';

let nextSocketId = 1;
let hostPlayerId = null;
let boundHostStateTarget = null;

// Central session registry: playerId -> { playerId, socket, socketId, role, connected, joinedAt, actionRateState? }
export const sessions = new Map();

// Map of active WebSocket instances: ws -> { playerId, socketId }
export const activeSockets = new Map();

// Authoritative seat slots with backward-compatible functional aliases
export const roles = {
  blind: { playerId: null, connected: false, joinedAt: null, ready: false },
  deaf: { playerId: null, connected: false, joinedAt: null, ready: false },
  mute: { playerId: null, connected: false, joinedAt: null, ready: false }
};
roles.operator = roles.blind;
roles.observer = roles.deaf;
roles.manual = roles.mute;

export function allocateSocketId() {
  return nextSocketId++;
}

export function getHostPlayerId() {
  return hostPlayerId;
}

export function bindHostStateTarget(targetObj) {
  boundHostStateTarget = targetObj;
}

function syncBoundHost(nextHostId) {
  hostPlayerId = nextHostId;
  if (boundHostStateTarget) {
    boundHostStateTarget.hostPlayerId = nextHostId;
  }
  return nextHostId;
}

export function getRoleByPlayerId(playerId) {
  if (!playerId) return null;
  for (const r of ROLES) {
    if (roles[r].playerId === playerId) return r;
  }
  return null;
}

export function releaseRole(roleName) {
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

export function releasePlayerCurrentRole(playerId) {
  const currentRole = getRoleByPlayerId(playerId);
  if (currentRole) {
    releaseRole(currentRole);
    return currentRole;
  }
  return null;
}

export function areAllRolesReady() {
  return ROLES.every(
    (r) => roles[r].playerId && roles[r].connected && roles[r].ready !== false
  );
}

export function resetAllSessionRateLimits() {
  for (const sess of sessions.values()) {
    sess.actionRateState = null;
  }
}

/**
 * Assigns host deterministically: retains current connected role-holding host if valid,
 * otherwise elects the first connected role holder (`blind` -> `deaf` -> `mute`),
 * falling back to any connected session.
 */
export function updateHost() {
  if (hostPlayerId) {
    const currentHostSession = sessions.get(hostPlayerId);
    if (currentHostSession && currentHostSession.connected && currentHostSession.role) {
      return syncBoundHost(hostPlayerId);
    }
  }

  for (const r of ROLES) {
    if (roles[r].playerId && roles[r].connected) {
      const sess = sessions.get(roles[r].playerId);
      if (sess && sess.connected) {
        return syncBoundHost(roles[r].playerId);
      }
    }
  }

  for (const [pId, sess] of sessions.entries()) {
    if (sess.connected) {
      return syncBoundHost(pId);
    }
  }

  return syncBoundHost(null);
}
