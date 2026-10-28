/**
 * Server Modules Registry & Polymorphic Action Payload Validator.
 *
 * Adding a new bomb defusal module requires creating its file (implementing
 * `id`, `title`, `create`, `filterForRole`, `validateAction`, `handleAction`, `isSolved`,
 * and optional `isRedundantAction`) and registering it in `activeModules` below.
 */
import { buttonModule } from './button.js';
import { wiresModule } from './wires.js';
import { keypadModule } from './keypad.js';
import { beaconModule } from './beacon.js';

export const activeModules = [
  buttonModule,
  wiresModule,
  keypadModule,
  beaconModule
];

export const modulesById = new Map(activeModules.map((m) => [m.id, m]));

/**
 * Strictly validates module action type and parameters via the target module's
 * `validateAction` contract, returning `{ ok: true, sanitizedData, targetKey }`
 * stripped of any client-injected correctness claims, or `{ ok: false, message }`.
 */
export function validateBombActionPayload(moduleId, action, rawData) {
  const mod = typeof moduleId === 'string' ? modulesById.get(moduleId) : null;
  if (!mod || typeof mod.validateAction !== 'function') {
    return { ok: false, message: 'ماژول یا عملیات پشتیبانی نمی‌شود.' };
  }
  return mod.validateAction(action, rawData);
}
