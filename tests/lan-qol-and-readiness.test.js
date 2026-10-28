process.env.NODE_ENV = 'test';
import test, { describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

import {
  server,
  gameState,
  roles,
  resetGame,
  sessions,
  activeSockets,
  ROLES,
  detectLanInterfaces
} from '../server.js';
import { encodeQrMatrix, renderQrSvg } from '../public/qr-svg.js';
import { createHybridSessionManager } from '../public/session-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, val) {
      map.set(key, String(val));
    },
    removeItem(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    }
  };
}

let port;
const openSockets = new Set();

function createClient() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    openSockets.add(ws);

    const messageQueue = [];
    const waiters = [];

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        for (let i = 0; i < waiters.length; i++) {
          const { predicate, resolveWaiter } = waiters[i];
          if (predicate(data)) {
            waiters.splice(i, 1);
            resolveWaiter(data);
            return;
          }
        }
        messageQueue.push(data);
      } catch (err) {
        // ignore malformed test packet
      }
    });

    ws.on('open', () => {
      resolve({
        ws,
        send(obj) {
          ws.send(JSON.stringify(obj));
        },
        clearQueue() {
          messageQueue.length = 0;
        },
        waitFor(predicate, timeoutMs = 2500) {
          for (let i = 0; i < messageQueue.length; i++) {
            if (predicate(messageQueue[i])) {
              return Promise.resolve(messageQueue.splice(i, 1)[0]);
            }
          }

          return new Promise((res, rej) => {
            const timer = setTimeout(() => {
              const idx = waiters.findIndex((w) => w.resolveWaiter === res);
              if (idx !== -1) waiters.splice(idx, 1);
              rej(new Error(`Timeout waiting for WebSocket message after ${timeoutMs}ms`));
            }, timeoutMs);

            waiters.push({
              predicate,
              resolveWaiter: (data) => {
                clearTimeout(timer);
                res(data);
              }
            });
          });
        },
        close() {
          return new Promise((res) => {
            openSockets.delete(ws);
            if (ws.readyState === WebSocket.CLOSED) {
              res();
            } else {
              ws.on('close', () => res());
              ws.close();
            }
          });
        }
      });
    });

    ws.on('error', reject);
  });
}

describe('Offline QR SVG, Hybrid Mobile Session, Pre-Start Countdown & Slot Recovery', () => {
  before(async () => {
    if (!server.listening) {
      await new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          port = server.address().port;
          resolve();
        });
      });
    } else {
      port = server.address().port;
    }
  });

  after(async () => {
    resetGame(true);
    for (const ws of openSockets) {
      try {
        ws.terminate();
      } catch (e) {}
    }
    openSockets.clear();
    server.unref();
  });

  beforeEach(async () => {
    for (const ws of openSockets) {
      try {
        ws.terminate();
      } catch (e) {}
    }
    openSockets.clear();
    await new Promise((r) => setTimeout(r, 50));

    sessions.clear();
    activeSockets.clear();
    for (const r of ROLES) {
      roles[r].playerId = null;
      roles[r].connected = false;
      roles[r].ready = false;
      roles[r].joinedAt = null;
    }
    resetGame(true);
  });

  test('1. Offline QR SVG encoder builds valid ISO/IEC 18004 finder/timing/format invariants and crisp SVG', () => {
    const hotspotUrl = 'http://192.168.43.1:3000';
    const encoded = encodeQrMatrix(hotspotUrl);

    assert.equal(encoded.version, 2, '24-byte LAN URL should select QR Version 2 (25x25)');
    assert.equal(encoded.size, 25);
    assert.ok(encoded.mask >= 0 && encoded.mask <= 7);

    const { modules, size } = encoded;

    // Verify 7x7 corner finder rings and 3x3 centers at (0,0), (0, size-7), (size-7, 0)
    for (const [topR, leftC] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      assert.equal(modules[topR][leftC], 1, 'Finder outer corner must be dark');
      assert.equal(modules[topR + 1][leftC + 1], 0, 'Finder inner ring must be light');
      assert.equal(modules[topR + 3][leftC + 3], 1, 'Finder center must be dark');
    }

    // Verify white separators bordering top-left finder
    for (let i = 0; i <= 7; i++) {
      assert.equal(modules[7][i], 0, 'Horizontal finder separator must be light');
      assert.equal(modules[i][7], 0, 'Vertical finder separator must be light');
    }

    // Verify timing patterns along row 6 and col 6 (between finders)
    for (let i = 8; i < size - 8; i++) {
      const expected = i % 2 === 0 ? 1 : 0;
      assert.equal(modules[6][i], expected, `Row timing pattern mismatch at col ${i}`);
      assert.equal(modules[i][6], expected, `Col timing pattern mismatch at row ${i}`);
    }

    // Verify mandatory fixed dark module at (size - 8, 8)
    assert.equal(modules[size - 8][8], 1, 'Fixed dark module must be 1');

    // Verify SVG output structure and quiet-zone viewBox (25 + 4*2 = 33)
    const svg = renderQrSvg(hotspotUrl, { margin: 4 });
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 33 33"'));
    assert.ok(svg.includes('shape-rendering="crispEdges"'));
    assert.ok(svg.includes('<path d="M'));

    // Verify Version 1 (short text) and Version 6 (multi-block interleaved URL)
    const v1 = encodeQrMatrix('http://10.0.0.1');
    assert.equal(v1.version, 1);
    assert.equal(v1.size, 21);

    const longUrl = 'http://192.168.43.105:3000/?room=BANANA-SQUAD-ALPHA&invite=offline-hotspot-session-2026-multi-block-reed-solomon-test-v6';
    const v6 = encodeQrMatrix(longUrl);
    assert.equal(v6.version, 6);
    assert.equal(v6.size, 41);

    assert.throws(() => encodeQrMatrix(''), /empty/i);
    assert.throws(() => encodeQrMatrix('x'.repeat(150)), /exceeds maximum/i);
  });

  test('2. GET /api/lan-info returns active server port and LAN interface array safely', async () => {
    const list = detectLanInterfaces(port);
    assert.ok(Array.isArray(list));

    const res = await fetch(`http://127.0.0.1:${port}/api/lan-info`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.port, port);
    assert.ok(Array.isArray(body.interfaces));
    for (const item of body.interfaces) {
      assert.equal(typeof item.name, 'string');
      assert.equal(typeof item.address, 'string');
      assert.ok(item.url.endsWith(`:${port}`));
    }
  });

  test('3. Hybrid mobile session manager recovers closed mobile tabs while isolating concurrent multi-tabs', () => {
    const sharedLocalStorage = createMemoryStorage();
    let clock = 100_000;
    const now = () => clock;

    // Tab 1 opens for the first time and selects 'deaf' (Observer)
    const tab1Session = createMemoryStorage();
    const mgr1 = createHybridSessionManager({
      localStorage: sharedLocalStorage,
      sessionStorage: tab1Session,
      now,
      autoHeartbeat: false
    });
    mgr1.setRole('deaf');
    const primaryPlayerId = mgr1.playerId;
    assert.equal(mgr1.isPrimaryPersistentOwner, true);
    assert.equal(mgr1.getRole(), 'deaf');

    // Simultaneous Tab 2 opens on the SAME browser while Tab 1 lease is active (< 4500ms)
    clock += 500;
    const tab2Session = createMemoryStorage();
    const mgr2 = createHybridSessionManager({
      localStorage: sharedLocalStorage,
      sessionStorage: tab2Session,
      now,
      autoHeartbeat: false
    });
    assert.notEqual(mgr2.playerId, primaryPlayerId, 'Concurrent second tab must get an isolated playerId');
    assert.equal(mgr2.isPrimaryPersistentOwner, false);
    assert.equal(mgr2.getRole(), null, 'Concurrent second tab must not steal primary role');

    // Tab 1 reloads (same sessionStorage) -> keeps exact same playerId and role
    clock += 500;
    const mgr1Reloaded = createHybridSessionManager({
      localStorage: sharedLocalStorage,
      sessionStorage: tab1Session,
      now,
      autoHeartbeat: false
    });
    assert.equal(mgr1Reloaded.playerId, primaryPlayerId);
    assert.equal(mgr1Reloaded.getRole(), 'deaf');

    // Mobile user accidentally closes Tab 1 (or OS purges tab & lease expires) and opens a brand-new tab
    mgr1Reloaded.dispose();
    clock += 5000;
    const reopenedMobileTabSession = createMemoryStorage();
    const mgrRecovered = createHybridSessionManager({
      localStorage: sharedLocalStorage,
      sessionStorage: reopenedMobileTabSession,
      now,
      autoHeartbeat: false
    });
    assert.equal(mgrRecovered.playerId, primaryPlayerId, 'Reopened mobile tab must recover persistent playerId');
    assert.equal(mgrRecovered.getRole(), 'deaf', 'Reopened mobile tab must recover saved role');
  });

  test('4. Pre-start readiness countdown hides clues/manual, blocks premature actions, and supports cancellation', async () => {
    const cOp = await createClient();
    const cObs = await createClient();
    const cMan = await createClient();

    cOp.send({ type: 'join', payload: { role: 'blind', playerId: 'p_op_cd' } });
    await cOp.waitFor((m) => m.type === 'role_assigned');

    cObs.send({ type: 'join', payload: { role: 'deaf', playerId: 'p_obs_cd' } });
    await cObs.waitFor((m) => m.type === 'role_assigned');

    cMan.send({ type: 'join', payload: { role: 'mute', playerId: 'p_man_cd' } });
    await cMan.waitFor((m) => m.type === 'role_assigned');
    await cOp.waitFor((m) => m.type === 'state_update' && m.state.status === 'ready');

    cOp.clearQueue();
    cObs.clearQueue();
    cMan.clearQueue();

    // Host starts a 2000ms readiness countdown
    cOp.send({ type: 'start_countdown', payload: { countdownMs: 2000, seed: 'READY01' } });

    const cdEvent = await cOp.waitFor((m) => m.type === 'countdown_started');
    assert.equal(cdEvent.countdownDurationMs, 2000);
    assert.equal(gameState.status, 'countdown');

    // Verify zero clue / manual leak across all 3 roles during countdown
    const opStateMsg = await cOp.waitFor((m) => m.type === 'state_update' && m.state.status === 'countdown');
    const obsStateMsg = await cObs.waitFor((m) => m.type === 'state_update' && m.state.status === 'countdown');
    const manStateMsg = await cMan.waitFor((m) => m.type === 'state_update' && m.state.status === 'countdown');

    assert.equal(opStateMsg.state.modules, null, 'Operator must not receive bomb modules during countdown');
    assert.equal(obsStateMsg.state.serialNumber, null, 'Observer must not receive serial number during countdown');
    assert.equal(obsStateMsg.state.modules, null, 'Observer must not receive color clues during countdown');
    assert.equal(manStateMsg.state.roundManual, null, 'Manual-holder must not receive rulebook during countdown');

    // Verify premature bomb action during countdown is rejected cleanly
    cOp.send({
      type: 'action',
      payload: { moduleId: 'wires', action: 'cut', data: { wireIndex: 0 } }
    });
    const prematureErr = await cOp.waitFor((m) => m.type === 'error');
    assert.equal(prematureErr.code, 'INVALID_PHASE');

    // Manual-holder cancels countdown (e.g., teammate still putting on headphones)
    cMan.send({ type: 'cancel_countdown' });
    const cancelMsg = await cOp.waitFor((m) => m.type === 'countdown_cancelled');
    assert.equal(cancelMsg.reason, 'player_cancelled');
    assert.equal(gameState.status, 'ready');

    // Now start a short 550ms countdown and let it complete into 'running'
    cOp.clearQueue();
    cObs.clearQueue();
    cMan.clearQueue();
    cOp.send({ type: 'start_countdown', payload: { countdownMs: 550, seed: 'READY02' } });
    await cOp.waitFor((m) => m.type === 'countdown_started');

    const startedMsg = await cOp.waitFor((m) => m.type === 'game_started', 2000);
    assert.equal(startedMsg.roundSeed, 'READY02');
    assert.equal(gameState.status, 'running');

    const manRunning = await cMan.waitFor((m) => m.type === 'state_update' && m.state.status === 'running');
    assert.ok(manRunning.state.roundManual, 'Manual-holder receives rulebook once countdown transitions to running');
  });

  test('5. Countdown auto-cancels immediately if a player disconnects before timer start', async () => {
    const cOp = await createClient();
    const cObs = await createClient();
    const cMan = await createClient();

    cOp.send({ type: 'join', payload: { role: 'blind', playerId: 'p_op_dc' } });
    await cOp.waitFor((m) => m.type === 'role_assigned');
    cObs.send({ type: 'join', payload: { role: 'deaf', playerId: 'p_obs_dc' } });
    await cObs.waitFor((m) => m.type === 'role_assigned');
    cMan.send({ type: 'join', payload: { role: 'mute', playerId: 'p_man_dc' } });
    await cMan.waitFor((m) => m.type === 'role_assigned');
    await cOp.waitFor((m) => m.type === 'state_update' && m.state.status === 'ready');

    cOp.send({ type: 'start_countdown', payload: { countdownMs: 3000 } });
    await cOp.waitFor((m) => m.type === 'countdown_started');

    // Observer phone loses Wi-Fi mid-countdown
    await cObs.close();

    const cancelMsg = await cOp.waitFor((m) => m.type === 'countdown_cancelled');
    assert.equal(cancelMsg.reason, 'player_disconnected');
    assert.equal(gameState.status, 'waiting');
  });

  test('6. Host can release disconnected lobby role slot; active round timer continues uninterrupted on disconnect', async () => {
    const cHost = await createClient();
    const cObs = await createClient();
    const cMan = await createClient();

    cHost.send({ type: 'join', payload: { role: 'blind', playerId: 'p_host_slot' } });
    await cHost.waitFor((m) => m.type === 'role_assigned');
    cObs.send({ type: 'join', payload: { role: 'deaf', playerId: 'p_obs_slot' } });
    await cObs.waitFor((m) => m.type === 'role_assigned');
    cMan.send({ type: 'join', payload: { role: 'mute', playerId: 'p_man_slot' } });
    await cMan.waitFor((m) => m.type === 'role_assigned');
    await cHost.waitFor((m) => m.type === 'state_update' && m.state.status === 'ready');

    // Non-host cannot release slots
    cMan.send({ type: 'release_disconnected_role', payload: { role: 'deaf' } });
    const nonHostErr = await cMan.waitFor((m) => m.type === 'error');
    assert.equal(nonHostErr.code, 'UNAUTHORIZED');

    // Host cannot kick a CONNECTED teammate
    cHost.send({ type: 'release_disconnected_role', payload: { role: 'deaf' } });
    const connectedErr = await cHost.waitFor((m) => m.type === 'error');
    assert.equal(connectedErr.code, 'ROLE_NOT_DISCONNECTED');

    // Observer disconnects in lobby -> slot stays reserved until rejoined OR released by Host
    await cObs.close();
    await cHost.waitFor((m) => m.type === 'state_update' && m.state.roles.deaf.connected === false);
    assert.equal(roles.deaf.playerId, 'p_obs_slot');

    // Host releases the disconnected Observer slot so a replacement phone can claim it
    cHost.send({ type: 'release_disconnected_role', payload: { role: 'deaf' } });
    const relEvt = await cHost.waitFor((m) => m.type === 'disconnected_role_released');
    assert.equal(relEvt.role, 'deaf');
    assert.equal(roles.deaf.playerId, null);

    // Replacement player joins 'deaf' and Host starts round
    const cObsNew = await createClient();
    cObsNew.send({ type: 'join', payload: { role: 'deaf', playerId: 'p_obs_replacement' } });
    await cObsNew.waitFor((m) => m.type === 'role_assigned');
    await cHost.waitFor((m) => m.type === 'state_update' && m.state.status === 'ready');

    cHost.send({ type: 'start', payload: { seed: 'CONT99' } });
    await cHost.waitFor((m) => m.type === 'game_started');
    assert.equal(gameState.status, 'running');

    // Mid-round disconnect: timer and round remain 'running', slot stays reserved for automatic rejoin
    await cObsNew.close();
    await cHost.waitFor((m) => m.type === 'state_update' && m.state.roles.deaf.connected === false);
    assert.equal(gameState.status, 'running', 'Active round must continue running when a phone disconnects');
    assert.equal(roles.deaf.playerId, 'p_obs_replacement', 'Disconnected player seat remains reserved mid-round');

    cHost.send({ type: 'release_disconnected_role', payload: { role: 'deaf' } });
    const midRoundErr = await cHost.waitFor((m) => m.type === 'error');
    assert.equal(midRoundErr.code, 'INVALID_STATE');

    // Disconnected player reconnects mid-round via join and automatically recovers their seat & Observer clues
    const cObsRejoin = await createClient();
    cObsRejoin.clearQueue();
    cObsRejoin.send({ type: 'join', payload: { role: 'deaf', playerId: 'p_obs_replacement' } });
    const assignedMsg = await cObsRejoin.waitFor((m) => m.type === 'role_assigned');
    assert.equal(assignedMsg.role, 'deaf');
    assert.equal(roles.deaf.connected, true);
    const rejoinedState = await cObsRejoin.waitFor((m) => m.type === 'state_update' && m.state.status === 'running' && m.state.serialNumber !== null);
    assert.ok(rejoinedState.state.serialNumber, 'Rejoined Observer immediately receives serial number mid-round');
  });

  test('7. Frontend HTML and client UI modules wire QR modal, Wake Lock, Fullscreen toggles, and Readiness Curtain', () => {
    const html = fs.readFileSync(path.join(ROOT_DIR, 'public', 'index.html'), 'utf8');
    const uiDir = path.join(ROOT_DIR, 'public', 'ui');
    const uiFilesText = fs.existsSync(uiDir)
      ? fs
          .readdirSync(uiDir)
          .filter((f) => f.endsWith('.js'))
          .sort()
          .map((f) => fs.readFileSync(path.join(uiDir, f), 'utf8'))
          .join('\n')
      : '';
    const clientUiJs = `${fs.readFileSync(path.join(ROOT_DIR, 'public', 'app.js'), 'utf8')}\n${uiFilesText}`;

    for (const requiredId of [
      'btnOpenQrModal',
      'qrInviteModal',
      'qrSvgContainer',
      'btnLobbyFullscreen',
      'btnHudFullscreen',
      'overlayCountdown',
      'btnCancelCountdown',
      'btnReleaseBlind',
      'btnReleaseDeaf',
      'btnReleaseMute'
    ]) {
      assert.ok(html.includes(`id="${requiredId}"`), `index.html missing #${requiredId}`);
    }

    assert.ok(clientUiJs.includes('navigator.wakeLock'), 'Client UI must integrate Screen Wake Lock API');
    assert.ok(clientUiJs.includes('requestFullscreen'), 'Client UI must integrate Fullscreen API');
    assert.ok(clientUiJs.includes("transport.send('start_countdown'"), 'Start button must trigger synchronized 3s readiness countdown');
    assert.ok(clientUiJs.includes("transport.send('release_disconnected_role'"), 'Host release buttons must send release_disconnected_role');
  });
});
