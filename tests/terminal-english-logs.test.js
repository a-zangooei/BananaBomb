process.env.NODE_ENV = 'test';
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import {
  server,
  wss,
  gameState,
  resetGame,
  sessions,
  activeSockets,
  printNetworkInterfaces,
  sanitizeTerminalText
} from '../server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PERSIAN_ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const NON_ASCII_RE = /[^\x20-\x7E\r\n\t]/;

function collectCodeFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectCodeFiles(fullPath));
    } else if (fullPath.endsWith('.js')) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('English-Only Terminal & Log Output Guarantees', () => {
  let port;
  const openSockets = new Set();

  before(async () => {
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    resetGame(true);
    for (const ws of openSockets) {
      if (ws.readyState !== WebSocket.CLOSED) {
        ws.terminate();
      }
    }
    openSockets.clear();
    for (const client of wss.clients) {
      client.terminate();
    }
    sessions.clear();
    activeSockets.clear();
    await new Promise((resolve) => server.close(() => resolve()));
  });

  test('1. Static audit: zero Persian/Arabic characters in any console/terminal log statement or npm script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    for (const [scriptName, cmd] of Object.entries(pkg.scripts || {})) {
      assert.equal(
        PERSIAN_ARABIC_RE.test(cmd),
        false,
        `npm script "${scriptName}" must not contain Persian characters: ${cmd}`
      );
    }

    const codeFiles = collectCodeFiles(ROOT_DIR).filter(
      (f) => !f.startsWith(path.join(ROOT_DIR, 'tests'))
    );
    const logCallPattern = /\b(console\.(?:log|warn|error|info|debug|trace)|process\.std(?:out|err)\.write|log|logError)\s*\(([\s\S]*?)\);/g;

    for (const file of codeFiles) {
      const rel = path.relative(ROOT_DIR, file);
      const src = fs.readFileSync(file, 'utf8');
      for (const match of src.matchAll(logCallPattern)) {
        const snippet = match[0];
        assert.equal(
          PERSIAN_ARABIC_RE.test(snippet),
          false,
          `Log statement in ${rel} must be strictly English without Persian characters: ${snippet}`
        );
      }
    }
  });

  test('2. Startup network banner (normal IPv4, offline empty, and Android Termux error) outputs pure ASCII English', () => {
    const origLog = console.log;
    const origWarn = console.warn;
    const origNet = os.networkInterfaces;
    const captured = [];

    console.log = (...args) => captured.push(args.join(' '));
    console.warn = (...args) => captured.push(args.join(' '));

    try {
      // Case A: Active Wi-Fi interface
      os.networkInterfaces = () => ({
        wlan0: [{ family: 'IPv4', internal: false, address: '192.168.43.1' }]
      });
      printNetworkInterfaces(3000);

      // Case B: No active external interface
      os.networkInterfaces = () => ({
        lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }]
      });
      printNetworkInterfaces(3000);

      // Case C: Termux os.networkInterfaces() permission error
      os.networkInterfaces = () => {
        throw new Error('EACCES: permission denied');
      };
      printNetworkInterfaces(3000);
    } finally {
      console.log = origLog;
      console.warn = origWarn;
      os.networkInterfaces = origNet;
    }

    assert.ok(captured.length >= 12, 'Expected startup banner lines to be logged');
    const joined = captured.join('\n');
    assert.match(joined, /\[SERVER\] BananaBomb/);
    assert.match(joined, /http:\/\/192\.168\.43\.1:3000/);
    assert.match(joined, /No active external IPv4 interface detected/);
    assert.match(joined, /ifconfig/);

    for (const line of captured) {
      assert.equal(
        PERSIAN_ARABIC_RE.test(line),
        false,
        `Startup log line contains Persian/Arabic characters: ${line}`
      );
      assert.equal(
        NON_ASCII_RE.test(line),
        false,
        `Startup log line contains non-ASCII characters unsafe for minimal terminals: ${line}`
      );
    }
  });

  test('3. Runtime server & WebSocket lifecycle logs stay 100% English ASCII even when client inputs contain Persian text', async () => {
    resetGame(true);
    sessions.clear();
    activeSockets.clear();

    const origLog = console.log;
    const origError = console.error;
    const prevEnv = process.env.NODE_ENV;
    const runtimeLogs = [];

    console.log = (...args) => runtimeLogs.push(args.join(' '));
    console.error = (...args) => runtimeLogs.push(args.join(' '));
    process.env.NODE_ENV = 'development';

    function connectWs() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        openSockets.add(ws);
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
      });
    }

    const waitTick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

    try {
      const c1 = await connectWs();
      const c2 = await connectWs();
      const c3 = await connectWs();

      // Send malformed JSON with Persian text to exercise error logging
      c1.send('{متن_نامعتبر');
      await waitTick();

      // Join with a Persian playerId to verify terminal sanitization strips non-ASCII from logs
      c1.send(JSON.stringify({ type: 'join', payload: { playerId: 'بازیکن_اول', role: 'observer' } }));
      await waitTick();
      // Switch role to operator
      c1.send(JSON.stringify({ type: 'join', payload: { playerId: 'بازیکن_اول', role: 'operator' } }));
      await waitTick();

      c2.send(JSON.stringify({ type: 'join', payload: { playerId: 'player_obs', role: 'observer' } }));
      c3.send(JSON.stringify({ type: 'join', payload: { playerId: 'player_man', role: 'manual' } }));
      await waitTick();

      // Toggle ready & set difficulty
      c2.send(JSON.stringify({ type: 'set_ready', payload: { ready: true } }));
      c1.send(JSON.stringify({ type: 'set_difficulty', payload: { presetId: 'easy' } }));
      await waitTick();

      // Start round
      c1.send(JSON.stringify({ type: 'start', payload: { seed: 'LOGTEST1' } }));
      await waitTick();

      assert.equal(gameState.status, 'running');

      // Trigger a wrong wire cut (strike) and a right wire cut (module solved)
      const wiresState = gameState.modules.wires;
      const wrongWire = [0, 1, 2, 3].find((idx) => idx !== wiresState.correctWireIndex);
      c1.send(JSON.stringify({
        type: 'action',
        payload: {
          actionId: 'act_strike_1',
          moduleId: 'wires',
          action: 'cut',
          data: { wireIndex: wrongWire }
        }
      }));
      await waitTick(180);

      c1.send(JSON.stringify({
        type: 'action',
        payload: {
          actionId: 'act_solve_wires',
          moduleId: 'wires',
          action: 'cut',
          data: { wireIndex: wiresState.correctWireIndex }
        }
      }));
      await waitTick(120);

      // Disconnect one player
      c3.close();
      await waitTick(60);

      // Reset round
      resetGame(true);
    } finally {
      process.env.NODE_ENV = prevEnv;
      console.log = origLog;
      console.error = origError;
    }

    assert.ok(runtimeLogs.length >= 8, 'Expected runtime server lifecycle events to be logged in English');
    const combined = runtimeLogs.join('\n');
    assert.match(combined, /\[ROLE\] Player .* assigned to role \[operator\]/);
    assert.match(combined, /\[LOBBY\] Difficulty set to "easy"/);
    assert.match(combined, /\[GAME\] Round started/);
    assert.match(combined, /\[GAME\] Strike 1\//);
    assert.match(combined, /\[GAME\] Module "wires" solved/);
    assert.match(combined, /\[WS\] Player .* disconnected from role \[manual\]/);
    assert.match(combined, /\[GAME\] Round reset to waiting state/);

    for (const line of runtimeLogs) {
      assert.equal(
        PERSIAN_ARABIC_RE.test(line),
        false,
        `Runtime terminal log contains Persian/Arabic characters: ${line}`
      );
      assert.equal(
        NON_ASCII_RE.test(line),
        false,
        `Runtime terminal log contains non-ASCII characters: ${line}`
      );
    }

    assert.equal(PERSIAN_ARABIC_RE.test(sanitizeTerminalText('خطای سرور ۱۲۳')), false);
  });
});
