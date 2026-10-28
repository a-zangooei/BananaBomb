/**
 * BananaBomb HTTP & WebSocket Server Bootstrap.
 *
 * Mounts offline Three.js vendor modules, isomorphic `/shared` domain modules,
 * `/public` static assets, `/api/lan-info`, and the authoritative WebSocket server,
 * while re-exporting public state and lifecycle helpers consumed by integration tests.
 */
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

import { ROLES } from './shared/roles.js';
import {
  DIFFICULTY_PRESETS,
  DEFAULT_DIFFICULTY_ID,
  sanitizeDifficultyConfig
} from './shared/difficulty.js';
import { COMM_AID_SYMBOLS } from './shared/comm-aid.js';
import { createRng } from './shared/utils.js';
import { validateBombActionPayload } from './modules/index.js';
import { sanitizeTerminalText } from './server/logger.js';
import {
  detectLanInterfaces,
  printNetworkInterfaces
} from './server/lan-discovery.js';
import {
  sessions,
  activeSockets,
  roles,
  getRoleByPlayerId,
  releaseRole,
  updateHost
} from './server/session-registry.js';
import {
  gameState,
  bindWebSocketServer,
  startGame,
  startPreRoundCountdown,
  cancelPreRoundCountdown,
  resetGame,
  getFilteredStateForRole
} from './server/game-engine.js';
import { attachWebSocketServer } from './server/ws-router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

bindWebSocketServer(wss);
attachWebSocketServer(wss);

// Serve Three.js offline vendor files strictly from local node_modules
const threeBuildDir = path.join(__dirname, 'node_modules/three/build');
const threeAddonsDir = path.join(__dirname, 'node_modules/three/examples/jsm');
const sharedDir = path.join(__dirname, 'shared');
const publicDir = path.join(__dirname, 'public');

app.use('/vendor/three', express.static(threeBuildDir));
app.use('/vendor/three-addons', express.static(threeAddonsDir));

// Fallback alias in case importmap references three.module.min.js
app.get('/vendor/three/three.module.min.js', (req, res) => {
  res.sendFile(path.join(threeBuildDir, 'three.module.js'));
});

// Serve isomorphic pure ES modules shared between Node server and browser client
app.use('/shared', express.static(sharedDir));

// Serve static client files from 'public' directory
app.use(express.static(publicDir));

app.get('/api/lan-info', (req, res) => {
  const boundAddr = server.address();
  const activePort =
    boundAddr && typeof boundAddr === 'object' && boundAddr.port
      ? boundAddr.port
      : Number(PORT) || 3000;
  const interfaces = detectLanInterfaces(activePort, PORT);
  res.json({
    port: activePort,
    interfaces
  });
});

// Fallback route for index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

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
  COMM_AID_SYMBOLS,
  startGame,
  startPreRoundCountdown,
  cancelPreRoundCountdown,
  resetGame,
  getRoleByPlayerId,
  releaseRole,
  updateHost,
  getFilteredStateForRole,
  createRng,
  DIFFICULTY_PRESETS,
  DEFAULT_DIFFICULTY_ID,
  sanitizeDifficultyConfig,
  validateBombActionPayload,
  detectLanInterfaces,
  printNetworkInterfaces,
  sanitizeTerminalText
};
