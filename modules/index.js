/**
 * Server Modules Registry
 * Central registry of active bomb defusal modules.
 * Adding a new module simply requires creating its file and adding it here.
 */
import { buttonModule } from './button.js';
import { wiresModule } from './wires.js';
import { keypadModule } from './keypad.js';

export const activeModules = [
  buttonModule,
  wiresModule,
  keypadModule
];

export const modulesById = new Map(activeModules.map((m) => [m.id, m]));
