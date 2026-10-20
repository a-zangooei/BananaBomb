process.env.NODE_ENV = 'test';
import test, { describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import {
  server,
  wss,
  gameState,
  roles,
  resetGame,
  startGame,
  sessions,
  activeSockets,
  ROLES,
  createRng
} from '../server.js';
import {
  selectRoundRules,
  BUTTON_SCHEMAS,
  WIRES_SCHEMAS,
  KEYPAD_SCHEMAS
} from '../modules/rules-config.js';
import { buttonModule } from '../modules/button.js';
import { wiresModule } from '../modules/wires.js';
import { keypadModule } from '../modules/keypad.js';

describe('Seed-Based Dynamic Rule Generation & Security Test Suite', () => {
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

  beforeEach(async () => {
    for (const ws of openSockets) {
      try {
        ws.terminate();
      } catch (e) {}
    }
    openSockets.clear();

    await new Promise((r) => setTimeout(r, 60));

    sessions.clear();
    activeSockets.clear();
    for (const r of ROLES) {
      roles[r].playerId = null;
      roles[r].connected = false;
      roles[r].joinedAt = null;
    }
    resetGame(true);
  });

  describe('1. Deterministic PRNG and Rule Selection', () => {
    test('Same seed produces identical PRNG stream and selected schemas', () => {
      const seed = 'ALPHA-992-TEST';
      const rng1 = createRng(seed);
      const rng2 = createRng(seed);

      const numbers1 = Array.from({ length: 20 }, () => rng1());
      const numbers2 = Array.from({ length: 20 }, () => rng2());
      assert.deepEqual(numbers1, numbers2, 'Seeded PRNG outputs must be strictly deterministic');

      const rules1 = selectRoundRules(createRng(seed), seed);
      const rules2 = selectRoundRules(createRng(seed), seed);

      assert.equal(rules1.buttonSchema.id, rules2.buttonSchema.id);
      assert.equal(rules1.wiresSchema.id, rules2.wiresSchema.id);
      assert.equal(rules1.keypadSchema.id, rules2.keypadSchema.id);
      assert.deepEqual(rules1.buttonSchema.stripDigitMap, rules2.buttonSchema.stripDigitMap);
      assert.deepEqual(rules1.keypadSchema.priorityOrder, rules2.keypadSchema.priorityOrder);
    });

    test('Different seeds produce varied schemas across rounds', () => {
      const distinctSeeds = ['SEED-A', 'SEED-B', 'SEED-C', 'SEED-D', 'SEED-E', 'SEED-F', 'SEED-G', 'SEED-H'];
      const observedButtonSchemas = new Set();
      const observedWiresSchemas = new Set();
      const observedKeypadSchemas = new Set();

      for (const s of distinctSeeds) {
        const rules = selectRoundRules(createRng(s), s);
        observedButtonSchemas.add(rules.buttonSchema.id);
        observedWiresSchemas.add(rules.wiresSchema.id);
        observedKeypadSchemas.add(rules.keypadSchema.id);
      }

      assert.ok(observedButtonSchemas.size > 1, 'Should explore multiple button schemas');
      assert.ok(observedWiresSchemas.size > 1, 'Should explore multiple wires schemas');
      assert.ok(observedKeypadSchemas.size > 1, 'Should explore multiple keypad schemas');
    });
  });

  describe('2. Role Filtering and Secret Leak Prevention', () => {
    test('Manual-holder (mute) receives structured roundManual, while blind & deaf receive null', async () => {
      const blindClient = await createClient();
      const deafClient = await createClient();
      const muteClient = await createClient();

      blindClient.send({ type: 'join', payload: { role: 'blind', playerId: 'p_seed_blind' } });
      await blindClient.waitFor((m) => m.type === 'role_assigned');

      deafClient.send({ type: 'join', payload: { role: 'deaf', playerId: 'p_seed_deaf' } });
      await deafClient.waitFor((m) => m.type === 'role_assigned');

      muteClient.send({ type: 'join', payload: { role: 'mute', playerId: 'p_seed_mute' } });
      await muteClient.waitFor((m) => m.type === 'role_assigned');

      // Start game with explicit seed
      const customSeed = 'TOURNAMENT-2026';
      blindClient.send({ type: 'start', payload: { seed: customSeed } });

      const [blindStateMsg, deafStateMsg, muteStateMsg] = await Promise.all([
        blindClient.waitFor((m) => m.type === 'state_update' && m.state?.status === 'running'),
        deafClient.waitFor((m) => m.type === 'state_update' && m.state?.status === 'running'),
        muteClient.waitFor((m) => m.type === 'state_update' && m.state?.status === 'running')
      ]);

      const blindState = blindStateMsg.state;
      const deafState = deafStateMsg.state;
      const muteState = muteStateMsg.state;

      // 1. Both see the roundSeed for sportsmanship/audit
      assert.equal(blindState.roundSeed, customSeed);
      assert.equal(deafState.roundSeed, customSeed);
      assert.equal(muteState.roundSeed, customSeed);

      // 2. Only mute receives the structured manual
      assert.equal(blindState.roundManual, null, 'Defuser (blind) must not receive roundManual');
      assert.equal(deafState.roundManual, null, 'Operator (deaf) must not receive roundManual');
      assert.ok(muteState.roundManual, 'Manual holder (mute) must receive roundManual');
      assert.equal(muteState.roundManual.seed, customSeed);
      assert.ok(muteState.roundManual.button.protocolName);
      assert.ok(muteState.roundManual.wires.checklist.length >= 4);
      assert.ok(muteState.roundManual.keypad.priorityRibbon);

      // 3. Blind role does NOT see the serial number or target answers
      assert.equal(blindState.serialNumber, null, 'Blind must not see serial number');
      assert.equal(blindState.modules.button.targetReleaseDigit, undefined);
      assert.equal(blindState.modules.wires.correctWireIndex, undefined);
      assert.equal(blindState.modules.keypad.correctOrder, undefined);

      // 4. Deaf role does NOT see the target answers
      assert.ok(deafState.serialNumber, 'Deaf sees serial number plate');
      assert.equal(deafState.modules.button.targetReleaseDigit, undefined);
      assert.equal(deafState.modules.wires.correctWireIndex, undefined);
      assert.equal(deafState.modules.keypad.correctOrder, undefined);

      await blindClient.close();
      await deafClient.close();
      await muteClient.close();
    });

    test('Reconnecting to an ongoing round maintains exact same seed, rules, and manual', async () => {
      const blindClient = await createClient();
      const deafClient = await createClient();
      const muteClient = await createClient();

      blindClient.send({ type: 'join', payload: { role: 'blind', playerId: 'p_reconn_blind' } });
      await blindClient.waitFor((m) => m.type === 'role_assigned');

      deafClient.send({ type: 'join', payload: { role: 'deaf', playerId: 'p_reconn_deaf' } });
      await deafClient.waitFor((m) => m.type === 'role_assigned');

      muteClient.send({ type: 'join', payload: { role: 'mute', playerId: 'p_reconn_mute' } });
      await muteClient.waitFor((m) => m.type === 'role_assigned');

      const seed = 'PERSIST-SEED-88';
      blindClient.send({ type: 'start', payload: { seed } });
      const muteInitMsg = await muteClient.waitFor((m) => m.type === 'state_update' && m.state?.status === 'running');
      const initialManual = muteInitMsg.state.roundManual;

      // Disconnect mute client and reconnect
      await muteClient.close();

      const newMuteClient = await createClient();
      newMuteClient.send({ type: 'join', payload: { role: 'mute', playerId: 'p_reconn_mute' } });
      await newMuteClient.waitFor((m) => m.type === 'role_assigned');

      // Wait for state_update for the authenticated mute role containing roundManual
      const restoredStateMsg = await newMuteClient.waitFor(
        (m) => m.type === 'state_update' && m.state?.status === 'running' && m.state?.roundManual
      );
      assert.equal(restoredStateMsg.state.roundSeed, seed);
      assert.deepEqual(restoredStateMsg.state.roundManual.button, initialManual.button);
      assert.deepEqual(restoredStateMsg.state.roundManual.wires, initialManual.wires);
      assert.deepEqual(restoredStateMsg.state.roundManual.keypad, initialManual.keypad);

      await blindClient.close();
      await deafClient.close();
      await newMuteClient.close();
    });
  });

  describe('3. Lobby Seed Customization and Input Sanitization', () => {
    test('Host can set custom seed in lobby, non-host is rejected', async () => {
      const hostClient = await createClient();
      const playerClient = await createClient();

      // Host joins first
      hostClient.send({ type: 'join', payload: { role: 'blind', playerId: 'p_host' } });
      await hostClient.waitFor((m) => m.type === 'role_assigned');

      playerClient.send({ type: 'join', payload: { role: 'deaf', playerId: 'p_regular' } });
      await playerClient.waitFor((m) => m.type === 'role_assigned');

      // Regular player attempts to set seed -> rejected
      playerClient.send({ type: 'set_seed', payload: { seed: 'HACKER-SEED' } });
      const err = await playerClient.waitFor((m) => m.type === 'error' && m.code === 'UNAUTHORIZED');
      assert.ok(err);

      // Host sets seed -> accepted and broadcasted
      hostClient.clearQueue();
      playerClient.clearQueue();
      hostClient.send({ type: 'set_seed', payload: { seed: 'CHAMPIONSHIP-26' } });
      const hostUpdate = await hostClient.waitFor((m) => m.type === 'state_update' && m.state?.roundSeed === 'CHAMPIONSHIP-26');
      assert.equal(hostUpdate.state.roundSeed, 'CHAMPIONSHIP-26');

      const regularUpdate = await playerClient.waitFor((m) => m.type === 'state_update' && m.state?.roundSeed === 'CHAMPIONSHIP-26');
      assert.equal(regularUpdate.state.roundSeed, 'CHAMPIONSHIP-26');

      await hostClient.close();
      await playerClient.close();
    });

    test('Seed is sanitized: invalid characters stripped and length capped', async () => {
      const hostClient = await createClient();
      hostClient.send({ type: 'join', payload: { role: 'blind', playerId: 'p_host_clean' } });
      await hostClient.waitFor((m) => m.type === 'role_assigned');

      hostClient.clearQueue();
      // Dirty seed with spaces, punctuation and excessive length
      hostClient.send({ type: 'set_seed', payload: { seed: '  my_seed!@#$%^&*()-12345678901234567890  ' } });
      const update = await hostClient.waitFor((m) => m.type === 'state_update' && m.state?.roundSeed);
      // Clean seed should have non-alphanumeric/dash/underscore stripped, uppercase, <= 16 chars
      assert.ok(!/[^a-zA-Z0-9_-]/.test(update.state.roundSeed));
      assert.ok(update.state.roundSeed.length <= 16);

      await hostClient.close();
    });
  });

  describe('4. Solvability of All Curated Seed Schemas', () => {
    test('Every seeded round configuration produces fully solvable modules with 100% agreement between manual and validation', () => {
      const testSeeds = [
        'SEED-ALPHA-1',
        'SEED-BETA-2',
        'SEED-GAMMA-3',
        'TOURNAMENT-FINALS',
        'BANANA-BOMB-2026',
        'COMPETITIVE-MATCH',
        'TRAINING-GROUNDS',
        'SPEEDRUN-HERO'
      ];

      for (const s of testSeeds) {
        const rng = createRng(s);
        const roundRules = selectRoundRules(rng, s);
        const serial = 'SN-84-B4';
        const isSerialEven = true;
        const ctx = { serialNumber: serial, isSerialEven, rng, roundRules };

        // 1. Button Solvability
        const btnState = buttonModule.create(rng, ctx);
        const btnSchema = roundRules.buttonSchema;
        const evaluatedBtn = btnSchema.evaluate(btnState.color, btnState.holdStripColor, isSerialEven);

        assert.equal(btnState.actionType, evaluatedBtn.actionType);
        assert.equal(btnState.targetReleaseDigit, evaluatedBtn.targetReleaseDigit);

        // Valid execution solves button
        const btnAction = evaluatedBtn.actionType === 'press'
          ? buttonModule.handleAction(btnState, 'press', {}, ctx)
          : buttonModule.handleAction(btnState, 'release', { releaseDigit: evaluatedBtn.targetReleaseDigit }, ctx);
        assert.equal(btnAction.solved, true);
        assert.equal(btnAction.strike, false);

        // 2. Wires Solvability
        const wiresState = wiresModule.create(rng, ctx);
        const wiresSchema = roundRules.wiresSchema;
        const expectedWire = wiresSchema.evaluate(wiresState.wires);
        assert.equal(wiresState.correctWireIndex, expectedWire);

        const wireAction = wiresModule.handleAction(wiresState, 'cut', { wireIndex: expectedWire }, ctx);
        assert.equal(wireAction.solved, true);
        assert.equal(wireAction.strike, false);

        // 3. Keypad Solvability
        const keypadState = keypadModule.create(rng, ctx);
        const keypadSchema = roundRules.keypadSchema;
        const expectedOrder = keypadSchema.priorityOrder.filter((sym) => keypadState.symbols.includes(sym));
        assert.deepEqual(keypadState.correctOrder, expectedOrder);

        // Solve keypad step by step
        for (const symbol of expectedOrder) {
          const slotIdx = keypadState.symbols.indexOf(symbol);
          const keyAction = keypadModule.handleAction(keypadState, 'press', { slotIndex: slotIdx }, ctx);
          assert.equal(keyAction.strike, false);
        }
        assert.equal(keypadState.solved, true);
      }
    });
  });
});
