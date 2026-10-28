/**
 * Pure ASCII-English Terminal Sanitizer & Lifecycle Logger.
 *
 * Ensures all stdout/stderr diagnostics remain safe on minimal Linux and Android Termux
 * terminals even when client-supplied strings contain non-ASCII or RTL characters.
 */
import { isOperatorRole, isObserverRole, isManualRole } from '../shared/roles.js';

const NON_ASCII_TERMINAL_RE = /[^\x20-\x7E\r\n\t]/g;

export function sanitizeTerminalText(value) {
  return String(value ?? '').replace(NON_ASCII_TERMINAL_RE, '?');
}

export function formatRoleForLog(rawRole) {
  if (isOperatorRole(rawRole)) return 'operator';
  if (isObserverRole(rawRole)) return 'observer';
  if (isManualRole(rawRole)) return 'manual';
  return sanitizeTerminalText(rawRole || 'unassigned');
}

export function shortPlayerId(playerId) {
  const clean = sanitizeTerminalText(String(playerId || '').trim());
  return clean.substring(0, 8) || 'unknown';
}

export function log(...args) {
  if (process.env.NODE_ENV !== 'test') {
    console.log(...args.map((arg) => sanitizeTerminalText(arg)));
  }
}

export function logError(...args) {
  if (process.env.NODE_ENV !== 'test') {
    console.error(...args.map((arg) => sanitizeTerminalText(arg)));
  }
}
