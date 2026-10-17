/**
 * Client 3D Modules Registry
 * All active client-side 3D modules are exported here.
 * Adding a new module requires creating its file and adding it to this array.
 */
import { buttonClientModule } from './button.js';
import { wiresClientModule } from './wires.js';
import { keypadClientModule } from './keypad.js';

export const clientModules = [
  buttonClientModule,
  wiresClientModule,
  keypadClientModule
];

export const clientModulesById = new Map(clientModules.map((m) => [m.id, m]));
