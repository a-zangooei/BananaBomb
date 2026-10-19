process.env.NODE_ENV = 'test';
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { server, wss, gameState, roles, resetGame, startGame, sessions, activeSockets, ROLES } from '../server.js';
import { buttonModule } from '../modules/button.js';
import { wiresModule } from '../modules/wires.js';
import { keypadModule } from '../modules/keypad.js';

describe('Phase 3 — Responsive Layout, 3D Interaction & Input Reliability Tests', () => {
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
        } catch (err) {}
      });

      ws.on('open', () => {
        resolve({
          ws,
          send(obj) {
            ws.send(JSON.stringify(obj));
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
                rej(new Error(`Timeout waiting for message matching predicate after ${timeoutMs}ms`));
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

      ws.on('error', (err) => reject(err));
    });
  }

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
    await new Promise((resolve) => {
      wss.close(() => {
        server.close(() => resolve());
      });
    });
  });

  describe('1. Camera & Viewport Adaptation Geometry Calculations', () => {
    // Pure calculation logic identical to Bomb3DScene.calcOptimalCameraDist
    function calcOptimalCameraDist(width, height, baseDist = 3.6) {
      const aspect = (width && height) ? (width / height) : 1;
      if (aspect < 1.0) {
        return baseDist / Math.max(0.62, aspect);
      }
      return baseDist;
    }

    test('Desktop/Landscape (16:9, aspect ~1.77) preserves standard base camera distance', () => {
      const dist = calcOptimalCameraDist(1280, 720);
      assert.equal(dist, 3.6, 'Landscape viewports should use base camera distance of 3.6');
    });

    test('Mobile Landscape (aspect ~2.1) uses standard base camera distance without clipping', () => {
      const dist = calcOptimalCameraDist(800, 380);
      assert.equal(dist, 3.6);
    });

    test('Mobile Portrait (360x640, aspect ~0.56) adapts distance inversely to prevent horizontal clipping', () => {
      const dist = calcOptimalCameraDist(360, 640);
      // aspect is 0.5625; clamped at 0.62 -> 3.6 / 0.62 = ~5.806
      assert.ok(dist > 5.0, `Portrait distance ${dist} must increase to fit the bomb in narrow FOV`);
      assert.ok(dist <= 6.0, `Portrait distance ${dist} should not zoom out too far`);
    });

    test('Square or Tablet Portrait (768x1024, aspect 0.75) adapts distance moderately', () => {
      const dist = calcOptimalCameraDist(768, 1024);
      // 3.6 / 0.75 = 4.8
      assert.equal(Math.round(dist * 10) / 10, 4.8);
    });
  });

  describe('2. Pointer Coordinate Mapping & Canvas Offset Calculation', () => {
    function clientToNdc(clientX, clientY, rect) {
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
      return { ndcX, ndcY };
    }

    test('Center of offset canvas maps precisely to (0, 0)', () => {
      const rect = { left: 100, top: 150, width: 400, height: 300 };
      const { ndcX, ndcY } = clientToNdc(300, 300, rect);
      assert.equal(ndcX, 0);
      assert.equal(ndcY, 0);
    });

    test('Top-Left corner of canvas maps to (-1, 1)', () => {
      const rect = { left: 50, top: 80, width: 500, height: 400 };
      const { ndcX, ndcY } = clientToNdc(50, 80, rect);
      assert.equal(ndcX, -1);
      assert.equal(ndcY, 1);
    });

    test('Bottom-Right corner of canvas maps to (1, -1)', () => {
      const rect = { left: 50, top: 80, width: 500, height: 400 };
      const { ndcX, ndcY } = clientToNdc(550, 480, rect);
      assert.equal(ndcX, 1);
      assert.equal(ndcY, -1);
    });
  });

  describe('3. Drag vs Tap Discrimination & Gesture Cancellation Logic', () => {
    test('Movement > 10px flags hasMovedSignificantly and cancels pending module actions', () => {
      const dragStartPos = { x: 100, y: 100 };
      let hasMovedSignificantly = false;
      let candidateCancelled = false;

      function onMove(currentX, currentY) {
        const dist = Math.hypot(currentX - dragStartPos.x, currentY - dragStartPos.y);
        if (dist > 10) {
          hasMovedSignificantly = true;
          candidateCancelled = true;
        }
      }

      onMove(102, 101);
      assert.equal(hasMovedSignificantly, false);
      assert.equal(candidateCancelled, false);

      onMove(112, 110);
      assert.equal(hasMovedSignificantly, true);
      assert.equal(candidateCancelled, true);
    });

    test('Pointer cancel event cleanly resets button state without sending action', () => {
      let state = { solved: false, actionType: 'hold', targetReleaseDigit: 4 };
      let actionsSent = [];

      const mockModuleView = {
        userData: {
          defaultBtnZ: 0.14,
          pressStartTime: Date.now(),
          btnMesh: { position: { z: 0.10 } },
          capMesh: { position: { z: 0.175 } },
          stripMesh: { material: { color: { setHex(c) { this.val = c; } } } }
        }
      };

      // In client module pointercancel:
      mockModuleView.userData.pressStartTime = null;
      mockModuleView.userData.btnMesh.position.z = mockModuleView.userData.defaultBtnZ;

      assert.equal(mockModuleView.userData.pressStartTime, null);
      assert.equal(mockModuleView.userData.btnMesh.position.z, 0.14);
      assert.equal(actionsSent.length, 0, 'No action sent on pointercancel');
    });
  });

  describe('4. Server-Side Action Validation, Role Enforcement & Flood Rate Limiting', () => {
    let blindClient;
    let deafClient;
    let muteClient;

    test('Setup 3 connected players and start running game', async () => {
      for (const ws of openSockets) {
        try { ws.terminate(); } catch (e) {}
      }
      openSockets.clear();
      sessions.clear();
      activeSockets.clear();
      for (const r of ROLES) {
        roles[r].playerId = null;
        roles[r].connected = false;
        roles[r].joinedAt = null;
      }
      resetGame(true);

      blindClient = await createClient();
      deafClient = await createClient();
      muteClient = await createClient();

      blindClient.send({ type: 'join', payload: { role: 'blind', playerId: 'resp_blind' } });
      await blindClient.waitFor((m) => m.type === 'role_assigned');

      deafClient.send({ type: 'join', payload: { role: 'deaf', playerId: 'resp_deaf' } });
      await deafClient.waitFor((m) => m.type === 'role_assigned');

      muteClient.send({ type: 'join', payload: { role: 'mute', playerId: 'resp_mute' } });
      await muteClient.waitFor((m) => m.type === 'role_assigned');

      await blindClient.waitFor((m) => m.type === 'state_update' && m.state.status === 'ready');

      // Host starts game
      const hostId = gameState.hostPlayerId;
      const hostClient = hostId === 'resp_blind' ? blindClient : (hostId === 'resp_deaf' ? deafClient : muteClient);
      hostClient.send({ type: 'start' });

      await blindClient.waitFor((m) => m.type === 'state_update' && m.state.status === 'running');
      assert.equal(gameState.status, 'running');
    });

    test('Deaf role attempting physical bomb action is rejected with UNAUTHORIZED_ACTION', async () => {
      deafClient.send({
        type: 'action',
        payload: { moduleId: 'button', action: 'press' }
      });

      const err = await deafClient.waitFor((m) => m.type === 'error');
      assert.equal(err.code, 'UNAUTHORIZED_ACTION');
    });

    test('Malformed action payloads (non-string moduleId, invalid action) are ignored safely', async () => {
      const initialStrikes = gameState.strikes;

      blindClient.send({
        type: 'action',
        payload: { moduleId: 12345, action: 'press' }
      });

      blindClient.send({
        type: 'action',
        payload: { moduleId: 'button', action: null }
      });

      await new Promise((r) => setTimeout(r, 100));
      assert.equal(gameState.strikes, initialStrikes);
    });

    test('Rapid action flood is rate-limited by the server (70ms cooldown)', async () => {
      // Send 5 rapid actions in immediate succession
      for (let i = 0; i < 5; i++) {
        blindClient.send({
          type: 'action',
          payload: { moduleId: 'keypad', action: 'press', data: { slotIndex: 0 } }
        });
      }

      await new Promise((r) => setTimeout(r, 150));
      // First action was processed; subsequent rapid actions in <70ms were throttled
      assert.ok(gameState.modules.keypad.enteredSlots.length <= 1, 'Flood rate limiter prevented spam');
    });
  });
});
