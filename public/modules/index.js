/**
 * Client 3D Modules Registry
 * All active client-side 3D modules are exported here.
 * Adding a new module requires creating its file and adding it to this array.
 */
import { buttonClientModule } from './button.js';
import { wiresClientModule } from './wires.js';
import { keypadClientModule } from './keypad.js';
import { beaconClientModule } from './beacon.js';

export const clientModules = [
  buttonClientModule,
  wiresClientModule,
  keypadClientModule,
  beaconClientModule
];

export const clientModulesById = new Map(clientModules.map((m) => [m.id, m]));
