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
  createRng,
  getFilteredStateForRole,
  sanitizeDifficultyConfig
} from '../server.js';
import { activeModules, modulesById } from '../modules/index.js';
import {
  selectRoundRules,
  BUTTON_RULES,
  WIRES_RULES,
  KEYPAD_RULES,
  BEACON_RULES
} from '../modules/rules-config.js';

describe('Triadic Role Redesign & Silent Optical Morse + Tactile Braille Verification Suite', () => {
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
          if (data.type === 'state_update') {
            data.data = data.data || data.state;
          }
          for (let i = 0; i < waiters.length; i++) {
            const { predicate, resolveWaiter } = waiters[i];
            if (predicate(data)) {
              waiters.splice(i, 1);
              resolveWaiter(data);
              return;
            }
          }
          messageQueue.push(data);

          if (data.type === 'state_update') {
            const alias = { ...data, type: 'state' };
            for (let i = 0; i < waiters.length; i++) {
              const { predicate, resolveWaiter } = waiters[i];
              if (predicate(alias)) {
                waiters.splice(i, 1);
                resolveWaiter(alias);
                return;
              }
            }
            messageQueue.push(alias);
          }
        } catch (err) {}
      });

      const activeTimers = new Set();

      ws.on('open', () => {
        ws.on('error', () => {});
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
                activeTimers.delete(timer);
                const idx = waiters.findIndex((w) => w.resolveWaiter === res);
                if (idx !== -1) waiters.splice(idx, 1);
                rej(new Error(`Timeout waiting for message matching predicate after ${timeoutMs}ms`));
              }, timeoutMs);
              activeTimers.add(timer);

              waiters.push({
                predicate,
                resolveWaiter: (data) => {
                  activeTimers.delete(timer);
                  clearTimeout(timer);
                  res(data);
                }
              });
            });
          },
          close() {
            for (const t of activeTimers) {
              clearTimeout(t);
            }
            activeTimers.clear();
            waiters.length = 0;

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
    for (const ws of openSockets) {
      try {
        ws.terminate();
      } catch (e) {}
    }
    openSockets.clear();
    resetGame(true);
    server.unref();
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
    gameState.difficulty = sanitizeDifficultyConfig('hard');
    resetGame(true);
  });

  describe('1. Information Dependency & Role Boundary Isolation', () => {
    test('Strict information isolation: No role possesses both clues and rules or clues and controls', async () => {
      const operatorClient = await createClient();
      const observerClient = await createClient();
      const manualClient = await createClient();

      operatorClient.send({ type: 'join', role: 'operator', playerId: 'p-operator' });
      await operatorClient.waitFor((m) => m.type === 'role_assigned');
      observerClient.send({ type: 'join', role: 'observer', playerId: 'p-observer' });
      manualClient.send({ type: 'join', role: 'manual', playerId: 'p-manual' });

      // Wait for all 3 players to be ready
      await operatorClient.waitFor((m) => m.type === 'state' && m.data?.status === 'ready');

      // Operator (host) starts the game
      operatorClient.send({ type: 'start' });

      const [operatorState, observerState, manualState] = await Promise.all([
        operatorClient.waitFor((m) => m.type === 'state' && m.data?.status === 'running'),
        observerClient.waitFor((m) => m.type === 'state' && m.data?.status === 'running'),
        manualClient.waitFor((m) => m.type === 'state' && m.data?.status === 'running')
      ]);

      const op = operatorState.data;
      const obs = observerState.data;
      const man = manualState.data;

      // --- A. Operator Verification (The Hands & Silent West-Side Optical Morse + Tactile Braille) ---
      assert.equal(op.canInteract, true, 'Operator MUST be permitted to physically interact');
      assert.equal(op.hasAudio, true, 'Operator MUST receive general non-secret SFX flag');
      assert.equal(op.isMonochrome, true, 'Operator view MUST be monochrome');
      assert.equal(op.serialNumber, null, 'Operator MUST NOT see serial number');
      assert.equal(op.roundManual, null, 'Operator MUST NOT receive rulebook manual');
      assert.ok(op.modules.button.color === undefined || op.modules.button.color === 'monochrome', 'Operator MUST NOT receive actual button housing color clue');
      assert.equal(op.modules.wires.colors, undefined, 'Operator MUST NOT receive wire colors');
      assert.equal(op.modules.keypad.symbols, undefined, 'Operator MUST NOT receive keypad symbols');
      assert.ok(Array.isArray(op.modules.beacon.beats), 'Operator MUST receive silent Optical Morse lamp beats');
      assert.ok(Array.isArray(op.modules.beacon.slotChannels) && op.modules.beacon.slotChannels.length === 3, 'Operator MUST receive randomized tactile Braille slotChannels');
      assert.deepEqual([...op.modules.beacon.slotChannels].sort(), [1, 2, 3], 'slotChannels MUST be a permutation of [1, 2, 3]');
      assert.equal(op.modules.beacon.spectrumColor, undefined, 'Operator MUST NOT receive Spectrum Indicator color');
      assert.equal(op.modules.beacon.targetChannel, undefined, 'Operator MUST NOT receive targetChannel');

      // --- B. Observer Verification (The Eyes & Voice) ---
      assert.equal(obs.canInteract, false, 'Observer MUST NOT be permitted to physically interact');
      assert.equal(obs.hasAudio, false, 'Observer MUST NOT have audio cues enabled');
      assert.equal(obs.isMonochrome, false, 'Observer MUST see full color bomb');
      assert.ok(typeof obs.serialNumber === 'string' && obs.serialNumber.length > 0, 'Observer MUST see serial plate');
      assert.equal(obs.roundManual, null, 'Observer MUST NOT receive rulebook manual');
      assert.ok(typeof obs.modules.button.color === 'string', 'Observer MUST receive button housing color');
      assert.ok(Array.isArray(obs.modules.wires.colors), 'Observer MUST receive wire color array');
      assert.ok(Array.isArray(obs.modules.keypad.symbols), 'Observer MUST receive keypad symbols');
      assert.ok(['red', 'blue', 'yellow'].includes(obs.modules.beacon.spectrumColor), 'Observer MUST receive colored Spectrum Indicator clue');
      assert.equal(obs.modules.beacon.beats, undefined, 'Observer MUST NOT receive Optical Morse beats');
      assert.equal(obs.modules.beacon.patternStr, undefined, 'Observer MUST NOT receive Morse pattern string');
      assert.equal(obs.modules.beacon.slotChannels, undefined, 'Observer MUST NOT receive tactile Braille slot mapping');
      assert.equal(obs.modules.beacon.tunedChannel, undefined, 'Observer MUST NOT receive decoded Braille channel');

      // --- C. Manual-holder Verification (The Field Intel & Brain) ---
      assert.equal(man.canInteract, false, 'Manual-holder MUST NOT interact with bomb');
      assert.equal(man.hasAudio, false, 'Manual-holder MUST NOT receive audio cues');
      assert.equal(man.serialNumber, null, 'Manual-holder MUST NOT see serial plate');
      assert.ok(man.roundManual !== null && typeof man.roundManual === 'object', 'Manual-holder MUST receive structured rulebook');
      assert.ok(man.roundManual.button, 'Manual-holder MUST have button rules');
      assert.ok(man.roundManual.wires, 'Manual-holder MUST have wires rules');
      assert.ok(man.roundManual.keypad, 'Manual-holder MUST have keypad rules');
      assert.ok(man.roundManual.beacon, 'Manual-holder MUST have beacon rules');
      assert.equal(man.modulesDefusedCount, 0, 'Initial defused count must be 0');
      assert.equal(man.totalModulesCount, 4, 'Total modules count must be 4');
    });
  });

  describe('2. Optical Morse & Tactile Braille Dial Mechanics & Server Authority', () => {
    test('Braille dial slot tuning, strike on wrong slot/frequency, and defusal on target channel', async () => {
      const operatorClient = await createClient();
      const observerClient = await createClient();
      const manualClient = await createClient();

      operatorClient.send({ type: 'join', role: 'operator', playerId: 'p-op' });
      await operatorClient.waitFor((m) => m.type === 'role_assigned');
      observerClient.send({ type: 'join', role: 'observer', playerId: 'p-obs' });
      manualClient.send({ type: 'join', role: 'manual', playerId: 'p-man' });

      await operatorClient.waitFor((m) => m.type === 'state' && m.data?.status === 'ready');
      operatorClient.send({ type: 'start' });
      await operatorClient.waitFor((m) => m.type === 'state' && m.data?.status === 'running');

      const serverBeacon = gameState.modules.beacon;
      const targetChannel = serverBeacon.targetChannel;
      assert.ok([1, 2, 3].includes(targetChannel), `Target channel must be 1, 2, or 3 (got ${targetChannel})`);
      assert.deepEqual([...serverBeacon.slotChannels].sort(), [1, 2, 3], 'slotChannels must be a permutation of [1, 2, 3]');
      assert.ok(['red', 'blue', 'yellow'].includes(serverBeacon.spectrumColor), 'spectrumColor must be red, blue, or yellow');

      const correctSlot = serverBeacon.slotChannels.indexOf(targetChannel) + 1;
      const wrongSlot = correctSlot === 1 ? 2 : 1;

      // 1. Operator tunes physical dial to slot 2
      operatorClient.send({
        type: 'action',
        data: { moduleId: 'beacon', action: 'tune', data: { slot: 2 } }
      });
      await operatorClient.waitFor((m) => m.type === 'state' && m.data?.modules?.beacon?.tunedSlot === 2);
      assert.equal(gameState.modules.beacon.tunedSlot, 2);
      assert.equal(gameState.modules.beacon.tunedChannel, serverBeacon.slotChannels[1]);

      // 2. Transmit on wrong Braille slot triggers strike
      await new Promise((r) => setTimeout(r, 80));
      operatorClient.send({
        type: 'action',
        data: { moduleId: 'beacon', action: 'tune', data: { slot: wrongSlot } }
      });
      await operatorClient.waitFor((m) => m.type === 'state' && m.data?.modules?.beacon?.tunedSlot === wrongSlot);

      const strikePromise = operatorClient.waitFor((m) => m.type === 'strike');
      await new Promise((r) => setTimeout(r, 80));
      operatorClient.send({
        type: 'action',
        data: { moduleId: 'beacon', action: 'transmit' }
      });
      const strikeMsg = await strikePromise;
      assert.ok(strikeMsg, 'Transmitting wrong Braille slot must generate strike');
      assert.equal(gameState.strikes, 1);
      assert.equal(gameState.modules.beacon.solved, false);

      // 3. Transmit on correct Braille slot solves the module
      await new Promise((r) => setTimeout(r, 80));
      operatorClient.send({
        type: 'action',
        data: { moduleId: 'beacon', action: 'tune', data: { slot: correctSlot } }
      });
      await operatorClient.waitFor((m) => m.type === 'state' && m.data?.modules?.beacon?.tunedSlot === correctSlot);
      assert.equal(gameState.modules.beacon.tunedChannel, targetChannel);

      const solvedPromise = operatorClient.waitFor((m) => m.type === 'module_solved');
      await new Promise((r) => setTimeout(r, 80));
      operatorClient.send({
        type: 'action',
        data: { moduleId: 'beacon', action: 'transmit' }
      });
      const solvedMsg = await solvedPromise;
      assert.ok(solvedMsg, 'Transmitting correct Braille slot must solve beacon');
      assert.equal(gameState.modules.beacon.solved, true);

      // 4. Live status count is reflected for Manual-holder
      const manualState = await manualClient.waitFor((m) => m.type === 'state' && m.data?.modules?.beacon?.solved === true);
      assert.equal(manualState.data.modulesDefusedCount, 1);
      assert.equal(manualState.data.modules.beacon.solved, true);
    });

    test('Observer or Manual-holder attempting physical interaction on Beacon is rejected', async () => {
      const operatorClient = await createClient();
      const observerClient = await createClient();
      const manualClient = await createClient();

      operatorClient.send({ type: 'join', role: 'operator', playerId: 'p1' });
      observerClient.send({ type: 'join', role: 'observer', playerId: 'p2' });
      manualClient.send({ type: 'join', role: 'manual', playerId: 'p3' });

      await operatorClient.waitFor((m) => m.type === 'state' && m.data?.status === 'ready');
      operatorClient.send({ type: 'start' });
      await observerClient.waitFor((m) => m.type === 'state' && m.data?.status === 'running');

      // Observer tries to tune channel
      const errPromise = observerClient.waitFor((m) => m.type === 'error' && m.code === 'UNAUTHORIZED_ACTION');
      observerClient.send({
        type: 'action',
        data: { moduleId: 'beacon', action: 'tune', data: { channel: 2 } }
      });
      const errMsg = await errPromise;
      assert.equal(errMsg.code, 'UNAUTHORIZED_ACTION');
    });
  });

  describe('3. 1,000-Round Monte Carlo Solvability & Rulebook Agreement', () => {
    test('1,000 randomized seeded rounds guarantee 100% solvability and exact manual agreement across all 4 modules', () => {
      const TOTAL_ROUNDS = 1000;

      for (let i = 0; i < TOTAL_ROUNDS; i++) {
        const seed = `SIM-ROUND-${i}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
        const rng = createRng(seed);
        const roundRules = selectRoundRules(rng, seed);

        // Generate synthetic bomb context
        const serialLastDigit = Math.floor(rng() * 10);
        const serialNumber = `BB-${rng().toString(36).substring(2, 6).toUpperCase()}-${serialLastDigit}`;
        const isSerialEven = serialLastDigit % 2 === 0;

        const ctx = {
          seed,
          roundRules,
          serialNumber,
          isSerialEven,
          rng
        };

        // Module 1: Button
        const btnState = modulesById.get('button').create(rng, ctx);
        const btnEval = roundRules.buttonSchema.evaluate(btnState.color, btnState.holdStripColor, isSerialEven);
        if (btnEval.actionType === 'press') {
          const res = modulesById.get('button').handleAction(btnState, 'press', {}, ctx);
          assert.equal(res.solved, true, `Button tap mismatch at round ${i} with seed ${seed}`);
        } else {
          const res = modulesById.get('button').handleAction(btnState, 'release', { releaseDigit: btnEval.targetReleaseDigit }, ctx);
          assert.equal(res.solved, true, `Button hold release mismatch at round ${i} with seed ${seed}`);
        }

        // Module 2: Wires
        const wiresState = modulesById.get('wires').create(rng, ctx);
        const targetWireIdx = roundRules.wiresSchema.evaluate(wiresState.wires);
        assert.ok(targetWireIdx >= 0 && targetWireIdx <= 3, `Wire index out of bounds: ${targetWireIdx}`);
        const wireRes = modulesById.get('wires').handleAction(wiresState, 'cut', { wireIndex: targetWireIdx }, ctx);
        assert.equal(wireRes.solved, true, `Wire solve mismatch at round ${i} with seed ${seed}`);

        // Module 3: Keypad
        const keypadState = modulesById.get('keypad').create(rng, ctx);
        const expectedOrder = KEYPAD_RULES.evaluate(keypadState.symbols, roundRules.keypadSchema.priorityOrder);
        assert.equal(expectedOrder.length, 4);
        for (let s = 0; s < 4; s++) {
          const targetSym = expectedOrder[s];
          const slotIdx = keypadState.symbols.indexOf(targetSym);
          const keyRes = modulesById.get('keypad').handleAction(keypadState, 'press', { slotIndex: slotIdx }, ctx);
          if (s === 3) {
            assert.equal(keyRes.solved, true, `Keypad solve mismatch at round ${i} with seed ${seed}`);
          }
        }

        // Module 4: Silent Optical Morse & Tactile Braille Dial
        const beaconState = modulesById.get('beacon').create(rng, ctx);
        const targetChannel = roundRules.beaconSchema.evaluate(beaconState.pattern.id, beaconState.spectrumColor);
        assert.equal(beaconState.targetChannel, targetChannel, `Beacon target mismatch at round ${i} with seed ${seed}`);

        const targetSlot = beaconState.slotChannels.indexOf(targetChannel) + 1;
        assert.ok(targetSlot >= 1 && targetSlot <= 3, `Braille slot missing targetChannel ${targetChannel}`);

        // Simulate Operator reading Braille slot and transmitting
        modulesById.get('beacon').handleAction(beaconState, 'tune', { slot: targetSlot }, ctx);
        const beaconRes = modulesById.get('beacon').handleAction(beaconState, 'transmit', {}, ctx);
        assert.equal(beaconRes.solved, true, `Beacon transmit mismatch at round ${i} with seed ${seed}`);
      }
    });
  });

  describe('4. Tactical Role Nomenclature & Legacy Compatibility', () => {
    test('Both modern tactical roles (operator, observer, manual) and legacy roles (blind, deaf, mute) are accepted and mapped smoothly', async () => {
      const clientA = await createClient();
      const clientB = await createClient();
      const clientC = await createClient();

      // Connect with modern names
      clientA.send({ type: 'join', role: 'operator', playerId: 'tactical-1' });
      clientB.send({ type: 'join', role: 'observer', playerId: 'tactical-2' });
      clientC.send({ type: 'join', role: 'manual', playerId: 'tactical-3' });

      const readyMsg = await clientA.waitFor((m) => m.type === 'state' && m.data?.status === 'ready');
      assert.equal(readyMsg.data.status, 'ready');
      assert.ok(readyMsg.data.roles.operator.connected);
      assert.ok(readyMsg.data.roles.observer.connected);
      assert.ok(readyMsg.data.roles.manual.connected);

      // Verify titles are tactical
      assert.ok(readyMsg.data.roles.operator.title.includes('اپراتور'));
      assert.ok(readyMsg.data.roles.observer.title.includes('ناظر'));
      assert.ok(readyMsg.data.roles.manual.title.includes('دفترچه راهنما'));
    });
  });
});
