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
  releaseRole,
  getFilteredStateForRole,
  DIFFICULTY_PRESETS,
  sanitizeDifficultyConfig
} from '../server.js';
import { analyzeGuessingCost } from '../modules/difficulty-config.js';

describe('Authoritative Difficulty Presets & Fair Error Cost System Tests', () => {
  let port;
  const openSockets = new Set();
  const activeTimers = new Set();

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
                activeTimers.delete(timer);
                const idx = waiters.findIndex((w) => w.resolveWaiter === res);
                if (idx !== -1) waiters.splice(idx, 1);
                const qSummary = messageQueue.map((m) => m.type).join(', ');
                rej(new Error(`Timeout waiting for message matching predicate after ${timeoutMs}ms. Queue had: [${qSummary}]`));
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
    resetGame(true);
    for (const ws of openSockets) {
      try {
        ws.terminate();
      } catch (e) {}
    }
    openSockets.clear();
    for (const t of activeTimers) {
      clearTimeout(t);
    }
    activeTimers.clear();
    sessions.clear();
    server.unref();
  });

  beforeEach(async () => {
    for (const ws of openSockets) {
      try {
        ws.terminate();
      } catch (e) {}
    }
    openSockets.clear();
    for (const t of activeTimers) {
      clearTimeout(t);
    }
    activeTimers.clear();
    for (const r of ROLES) {
      releaseRole(r);
    }
    sessions.clear();
    resetGame(true);
  });

  // --- Suite 1: Defined Presets & Authoritative Sanitization ---
  describe('1. Authoritative Difficulty Presets Specification', () => {
    test('Easy preset defines 5m + 30s grace, 3 strikes, 2 modules, -15s penalty, wire indexing', () => {
      const cfg = sanitizeDifficultyConfig('easy');
      assert.equal(cfg.preset, 'easy');
      assert.equal(cfg.duration, 300);
      assert.equal(cfg.maxStrikes, 3);
      assert.equal(cfg.moduleCount, 2);
      assert.equal(cfg.timePenaltySeconds, 15);
      assert.equal(cfg.features.wireIndexLabels, true);
      assert.equal(cfg.features.timerGraceSeconds, 30);
    });

    test('Normal preset defines 5m, 3 strikes, 3 modules, -30s penalty, standard timing', () => {
      const cfg = sanitizeDifficultyConfig('normal');
      assert.equal(cfg.preset, 'normal');
      assert.equal(cfg.duration, 300);
      assert.equal(cfg.maxStrikes, 3);
      assert.equal(cfg.moduleCount, 3);
      assert.equal(cfg.timePenaltySeconds, 30);
      assert.equal(cfg.features.wireIndexLabels, false);
      assert.equal(cfg.features.timerGraceSeconds, 0);
    });

    test('Hard preset defines 3.5m (210s), 2 strikes, 4 modules, -45s penalty, 50ms cooldown', () => {
      const cfg = sanitizeDifficultyConfig('hard');
      assert.equal(cfg.preset, 'hard');
      assert.equal(cfg.duration, 210);
      assert.equal(cfg.maxStrikes, 2);
      assert.equal(cfg.moduleCount, 4);
      assert.equal(cfg.timePenaltySeconds, 45);
      assert.equal(cfg.interactionGraceMs, 50);
      assert.equal(cfg.features.wireIndexLabels, false);
    });

    test('Custom overrides sanitize values strictly within safe authoritative boundaries', () => {
      const cfg = sanitizeDifficultyConfig('normal', {
        duration: 999999, // Clamped to 600
        maxStrikes: 0,    // Clamped to 1
        moduleCount: 10,  // Clamped to 4
        timePenaltySeconds: -50, // Clamped to 0
        features: { wireIndexLabels: true }
      });

      assert.equal(cfg.duration, 600);
      assert.equal(cfg.maxStrikes, 1);
      assert.equal(cfg.moduleCount, 4);
      assert.equal(cfg.timePenaltySeconds, 0);
      assert.equal(cfg.features.wireIndexLabels, true);
      assert.equal(cfg.isCustom, true);
    });
  });

  // --- Suite 2: Host Settings & Authorization in Lobby ---
  describe('2. Host Difficulty Selection & Immutability', () => {
    test('Host can select Easy, Normal, or Hard preset before round starts', async () => {
      const host = await createClient();
      const guest = await createClient();

      host.send({ type: 'join', payload: { role: 'operator', playerId: 's2_host_p1' } });
      await host.waitFor((m) => m.type === 'role_assigned');

      guest.send({ type: 'join', payload: { role: 'observer', playerId: 's2_guest_p2' } });
      await guest.waitFor((m) => m.type === 'role_assigned');

      // Host sets Easy difficulty
      host.send({ type: 'set_difficulty', payload: { presetId: 'easy' } });
      const guestUpdate = await guest.waitFor(
        (m) => m.type === 'difficulty_changed' && m.difficulty.preset === 'easy'
      );
      assert.equal(guestUpdate.difficulty.preset, 'easy');
      assert.equal(guestUpdate.difficulty.timePenaltySeconds, 15);
      assert.equal(guestUpdate.difficulty.moduleCount, 2);

      // Verify server state updated
      assert.equal(gameState.difficulty.preset, 'easy');
      assert.equal(gameState.duration, 330); // 300 + 30s grace
    });

    test('Non-host client attempting to change difficulty is rejected with UNAUTHORIZED', async () => {
      const host = await createClient();
      const guest = await createClient();

      host.send({ type: 'join', payload: { role: 'operator', playerId: 's2_host_p2' } });
      await host.waitFor((m) => m.type === 'role_assigned');

      guest.send({ type: 'join', payload: { role: 'observer', playerId: 's2_guest_p3' } });
      await guest.waitFor((m) => m.type === 'role_assigned');

      // Guest attempts to change difficulty
      guest.send({ type: 'set_difficulty', payload: { presetId: 'hard' } });
      const err = await guest.waitFor((m) => m.type === 'error' && m.code === 'UNAUTHORIZED');
      assert.ok(err, 'Guest must receive UNAUTHORIZED error');

      // Server state remains unchanged
      assert.notEqual(gameState.difficulty.preset, 'hard');
    });

    test('Difficulty is frozen once round begins; attempts to change mid-round are rejected', async () => {
      const op = await createClient();
      const obs = await createClient();
      const man = await createClient();

      op.send({ type: 'join', payload: { role: 'operator', playerId: 's2_op_p4' } });
      await op.waitFor((m) => m.type === 'role_assigned');

      obs.send({ type: 'join', payload: { role: 'observer', playerId: 's2_obs_p5' } });
      await obs.waitFor((m) => m.type === 'role_assigned');

      man.send({ type: 'join', payload: { role: 'manual', playerId: 's2_man_p6' } });
      await man.waitFor((m) => m.type === 'role_assigned');

      // Start round
      op.send({ type: 'start' });
      await op.waitFor((m) => m.type === 'game_started');
      assert.equal(gameState.status, 'running');

      // Host attempts to change difficulty during round
      op.send({ type: 'set_difficulty', payload: { presetId: 'easy' } });
      const err = await op.waitFor((m) => m.type === 'error' && m.code === 'INVALID_STATE');
      assert.ok(err, 'Changing difficulty mid-round must be rejected with INVALID_STATE');
    });
  });

  // --- Suite 3: Error Cost Calculation & Action Deduplication ---
  describe('3. Error Penalties & Deduplication Idempotency', () => {
    test('Mistake deducts scaled time penalty (-30s on Normal) and charges exactly 1 strike', async () => {
      const op = await createClient();
      const obs = await createClient();
      const man = await createClient();

      op.send({ type: 'join', payload: { role: 'operator', playerId: 's3_op_p1' } });
      await op.waitFor((m) => m.type === 'role_assigned');
      obs.send({ type: 'join', payload: { role: 'observer', playerId: 's3_obs_p2' } });
      await obs.waitFor((m) => m.type === 'role_assigned');
      man.send({ type: 'join', payload: { role: 'manual', playerId: 's3_man_p3' } });
      await man.waitFor((m) => m.type === 'role_assigned');

      // Host explicitly sets Normal preset
      op.send({ type: 'set_difficulty', payload: { presetId: 'normal' } });
      await op.waitFor((m) => m.type === 'difficulty_changed');

      op.send({ type: 'start', payload: { seed: 'PENALTY_TEST_1' } });
      await op.waitFor((m) => m.type === 'game_started');

      const timeBefore = gameState.remainingSeconds;
      assert.equal(gameState.strikes, 0);

      // Find an incorrect wire to cut to cause a deliberate strike
      const wiresState = gameState.modules.wires;
      const wrongWireIndex = wiresState.wires.findIndex((_, idx) => idx !== wiresState.correctWireIndex);

      op.send({
        type: 'action',
        payload: {
          actionId: 'act_cut_wrong_1',
          moduleId: 'wires',
          action: 'cut',
          data: { wireIndex: wrongWireIndex }
        }
      });

      const strikeMsg = await op.waitFor((m) => m.type === 'strike');
      assert.equal(strikeMsg.strikes, 1);
      assert.equal(strikeMsg.penaltySeconds, 30);
      assert.equal(gameState.strikes, 1);
      assert.ok(
        gameState.remainingSeconds <= timeBefore - 29 && gameState.remainingSeconds >= timeBefore - 32,
        `Expected remainingSeconds to decrease by ~30s (was ${timeBefore}, now ${gameState.remainingSeconds})`
      );
    });

    test('Duplicate action with same actionId is rejected and does not double-charge penalty or strikes', async () => {
      const op = await createClient();
      const obs = await createClient();
      const man = await createClient();

      op.send({ type: 'join', payload: { role: 'operator', playerId: 's3_op_p4' } });
      await op.waitFor((m) => m.type === 'role_assigned');
      obs.send({ type: 'join', payload: { role: 'observer', playerId: 's3_obs_p5' } });
      await obs.waitFor((m) => m.type === 'role_assigned');
      man.send({ type: 'join', payload: { role: 'manual', playerId: 's3_man_p6' } });
      await man.waitFor((m) => m.type === 'role_assigned');

      op.send({ type: 'start', payload: { seed: 'DEDUP_TEST_1' } });
      await op.waitFor((m) => m.type === 'game_started');

      const wiresState = gameState.modules.wires;
      const wrongWireIndex = wiresState.wires.findIndex((_, idx) => idx !== wiresState.correctWireIndex);

      const fixedActionId = 'act_unique_retry_999';

      // First action
      op.send({
        type: 'action',
        payload: {
          actionId: fixedActionId,
          moduleId: 'wires',
          action: 'cut',
          data: { wireIndex: wrongWireIndex }
        }
      });
      await op.waitFor((m) => m.type === 'strike');
      assert.equal(gameState.strikes, 1);
      const remainingAfterFirst = gameState.remainingSeconds;

      // Generous delay exceeding the 70ms interaction cooldown
      await new Promise((r) => setTimeout(r, 120));

      // Replayed duplicate action with exact same actionId
      op.send({
        type: 'action',
        payload: {
          actionId: fixedActionId,
          moduleId: 'wires',
          action: 'cut',
          data: { wireIndex: wrongWireIndex }
        }
      });

      const dupAck = await op.waitFor((m) => m.type === 'action_duplicate');
      assert.equal(dupAck.actionId, fixedActionId);

      // Verify strikes and remaining seconds were NOT deducted again
      assert.equal(gameState.strikes, 1, 'Strikes must remain 1 after duplicate action');
      assert.ok(
        Math.abs(gameState.remainingSeconds - remainingAfterFirst) <= 1,
        'Time must not be penalized a second time for duplicate action'
      );
    });

    test('Time penalty clamps cleanly at 0 without generating negative time values', async () => {
      const op = await createClient();
      const obs = await createClient();
      const man = await createClient();

      op.send({ type: 'join', payload: { role: 'operator', playerId: 's3_op_p7' } });
      await op.waitFor((m) => m.type === 'role_assigned');
      obs.send({ type: 'join', payload: { role: 'observer', playerId: 's3_obs_p8' } });
      await obs.waitFor((m) => m.type === 'role_assigned');
      man.send({ type: 'join', payload: { role: 'manual', playerId: 's3_man_p9' } });
      await man.waitFor((m) => m.type === 'role_assigned');

      // Set custom difficulty with 5 strikes and 60s duration, 45s penalty
      op.send({
        type: 'set_difficulty',
        payload: {
          presetId: 'normal',
          customOverrides: { duration: 60, maxStrikes: 5, timePenaltySeconds: 45 }
        }
      });
      await op.waitFor((m) => m.type === 'difficulty_changed');

      op.send({ type: 'start', payload: { seed: 'CLAMP_TEST_1' } });
      await op.waitFor((m) => m.type === 'game_started');

      const wiresState = gameState.modules.wires;
      const wrongWires = [0, 1, 2, 3].filter((idx) => idx !== wiresState.correctWireIndex);

      // Trigger strike 1: 60s - 45s = 15s
      op.send({
        type: 'action',
        payload: { actionId: 'act_clamp_1', moduleId: 'wires', action: 'cut', data: { wireIndex: wrongWires[0] } }
      });
      await op.waitFor((m) => m.type === 'strike');

      await new Promise((r) => setTimeout(r, 120));

      // Trigger strike 2 with second wrong wire: 15s - 45s => clamps to 0, timeout explosion
      op.send({
        type: 'action',
        payload: { actionId: 'act_clamp_2', moduleId: 'wires', action: 'cut', data: { wireIndex: wrongWires[1] } }
      });

      const explodedState = await op.waitFor(
        (m) => m.type === 'state_update' && m.state.status === 'exploded'
      );
      assert.equal(explodedState.state.status, 'exploded');
      assert.equal(explodedState.state.remainingSeconds, 0);
      assert.ok(explodedState.state.remainingSeconds >= 0, 'Timer must never drop below 0');
    });
  });

  // --- Suite 4: Terminal Outcome Mutual Exclusivity ---
  describe('4. Mutual Exclusivity of Terminal States', () => {
    test('Max strikes failure and timeout cannot overwrite each other once exploded', async () => {
      const op = await createClient();
      const obs = await createClient();
      const man = await createClient();

      op.send({ type: 'join', payload: { role: 'operator', playerId: 's4_op_p1' } });
      await op.waitFor((m) => m.type === 'role_assigned');
      obs.send({ type: 'join', payload: { role: 'observer', playerId: 's4_obs_p2' } });
      await obs.waitFor((m) => m.type === 'role_assigned');
      man.send({ type: 'join', payload: { role: 'manual', playerId: 's4_man_p3' } });
      await man.waitFor((m) => m.type === 'role_assigned');

      // Hard mode: 2 max strikes
      op.send({ type: 'set_difficulty', payload: { presetId: 'hard' } });
      await op.waitFor((m) => m.type === 'difficulty_changed');

      op.send({ type: 'start', payload: { seed: 'MUTEX_TEST_1' } });
      await op.waitFor((m) => m.type === 'game_started');

      const wiresState = gameState.modules.wires;
      const wrongWires = [0, 1, 2, 3].filter((idx) => idx !== wiresState.correctWireIndex);

      // Strike 1
      op.send({
        type: 'action',
        payload: { actionId: 'mx_1', moduleId: 'wires', action: 'cut', data: { wireIndex: wrongWires[0] } }
      });
      await op.waitFor((m) => m.type === 'strike');

      await new Promise((r) => setTimeout(r, 120));

      // Strike 2 (Reaches maxStrikes = 2)
      op.send({
        type: 'action',
        payload: { actionId: 'mx_2', moduleId: 'wires', action: 'cut', data: { wireIndex: wrongWires[1] } }
      });
      await op.waitFor((m) => m.type === 'state_update' && m.state.status === 'exploded');

      assert.equal(gameState.status, 'exploded');
      assert.equal(gameState.endReason, 'max_strikes');

      // Subsequent actions while exploded must be completely ignored
      op.send({
        type: 'action',
        payload: { actionId: 'mx_3', moduleId: 'button', action: 'press', data: {} }
      });

      await new Promise((r) => setTimeout(r, 60));
      assert.equal(gameState.status, 'exploded');
      assert.equal(gameState.endReason, 'max_strikes');
    });

    test('Defusal on Easy preset (2 modules) stops timer and prevents late timeout from overwriting victory', async () => {
      const op = await createClient();
      const obs = await createClient();
      const man = await createClient();

      op.send({ type: 'join', payload: { role: 'operator', playerId: 's4_def_op' } });
      await op.waitFor((m) => m.type === 'role_assigned');
      obs.send({ type: 'join', payload: { role: 'observer', playerId: 's4_def_obs' } });
      await obs.waitFor((m) => m.type === 'role_assigned');
      man.send({ type: 'join', payload: { role: 'manual', playerId: 's4_def_man' } });
      await man.waitFor((m) => m.type === 'role_assigned');

      op.send({ type: 'set_difficulty', payload: { presetId: 'easy' } });
      await op.waitFor((m) => m.type === 'difficulty_changed');

      op.send({ type: 'start', payload: { seed: 'EASY_VICTORY_1' } });
      await op.waitFor((m) => m.type === 'game_started');

      assert.equal(gameState.activeModuleIds.length, 2, 'Easy preset must activate exactly 2 modules');

      // Solve module 1: wires
      const correctWire = gameState.modules.wires.correctWireIndex;
      op.send({
        type: 'action',
        payload: { actionId: 'win_1', moduleId: 'wires', action: 'cut', data: { wireIndex: correctWire } }
      });
      await op.waitFor((m) => m.type === 'module_solved' && m.moduleId === 'wires');

      await new Promise((r) => setTimeout(r, 170));

      // Solve module 2: button right near timeout boundary
      gameState.startTime = Date.now() - (gameState.duration - 1) * 1000;
      const btnState = gameState.modules.button;
      if (btnState.actionType === 'press') {
        op.send({
          type: 'action',
          payload: { actionId: 'win_2', moduleId: 'button', action: 'press', data: {} }
        });
      } else {
        op.send({
          type: 'action',
          payload: {
            actionId: 'win_2',
            moduleId: 'button',
            action: 'release',
            data: { releaseDigit: btnState.targetReleaseDigit }
          }
        });
      }

      const defusedMsg = await op.waitFor(
        (m) => m.type === 'state_update' && m.state.status === 'defused'
      );
      assert.equal(defusedMsg.state.status, 'defused');
      assert.equal(defusedMsg.state.endReason, 'all_modules_defused');

      // Wait past 600ms server timer tick to verify timeout does NOT overwrite defused status
      await new Promise((r) => setTimeout(r, 650));
      assert.equal(gameState.status, 'defused');
      assert.equal(gameState.endReason, 'all_modules_defused');
    });
  });

  // --- Suite 5: Anti-Guessing Cost & Mathematical Solvability ---
  describe('5. Anti-Guessing Mathematical Balance Analysis', () => {
    test('Blind guessing penalties exceed reasonable error budget across all module types', () => {
      const normalCfg = sanitizeDifficultyConfig('normal');
      const hardCfg = sanitizeDifficultyConfig('hard');

      const wiresCost = analyzeGuessingCost('wires', normalCfg);
      // Wires: 3/4 chance of failure * 30s penalty = 22.5s expected loss
      assert.equal(wiresCost.expectedTimeLoss, 22.5);
      assert.equal(wiresCost.isGuessingDominant, false, 'Wires guessing should never be dominant');

      const keypadCost = analyzeGuessingCost('keypad_full', normalCfg);
      // Keypad full permutation guessing: 1/24 success rate => expected failure > 95%
      assert.ok(keypadCost.failProbability > 0.95);
      assert.ok(keypadCost.expectedTimeLoss > 28);
      assert.equal(keypadCost.isGuessingDominant, false);

      const hardBeaconCost = analyzeGuessingCost('beacon', hardCfg);
      // Hard mode beacon penalty: 2/3 failure * 45s = 30s expected loss, plus 50% of entire strike budget
      assert.equal(hardBeaconCost.expectedTimeLoss, 30);
      assert.equal(hardBeaconCost.strikeRiskFraction, 0.5);
      assert.equal(hardBeaconCost.isGuessingDominant, false);
    });

    test('Observer receives wireIndexLabels in Easy preset, but not in Normal or Hard', () => {
      // In Easy preset
      const easyCfg = sanitizeDifficultyConfig('easy');
      gameState.difficulty = easyCfg;
      gameState.status = 'running';
      gameState.modules = {
        wires: { id: 'wires', wires: ['red', 'blue', 'yellow', 'green'], cutWires: [], solved: false }
      };
      gameState.activeModuleIds = ['wires'];

      const obsEasyState = getFilteredStateForRole('observer');
      assert.equal(obsEasyState.modules.wires.wireIndexLabels, true);

      // In Normal preset
      const normalCfg = sanitizeDifficultyConfig('normal');
      gameState.difficulty = normalCfg;
      const obsNormalState = getFilteredStateForRole('observer');
      assert.equal(obsNormalState.modules.wires.wireIndexLabels, false);
    });

    test('Selecting Easy, Normal, or Hard marks isCustom=false and matches frontend CANONICAL_PRESET_BASELINES', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
      const appJs = fs.readFileSync(path.join(rootDir, 'public', 'app.js'), 'utf8');

      for (const presetId of ['easy', 'normal', 'hard']) {
        const cfg = sanitizeDifficultyConfig(presetId);
        assert.equal(cfg.preset, presetId);
        assert.equal(cfg.isCustom, false, `${presetId} preset must explicitly set isCustom=false`);
        const base = DIFFICULTY_PRESETS[presetId];
        const expectedPattern = new RegExp(
          `${presetId}:\\s*\\{\\s*duration:\\s*${base.duration},\\s*maxStrikes:\\s*${base.maxStrikes},\\s*moduleCount:\\s*${base.moduleCount},\\s*timePenaltySeconds:\\s*${base.timePenaltySeconds}`
        );
        assert.match(appJs, expectedPattern, `Frontend CANONICAL_PRESET_BASELINES.${presetId} must match server DIFFICULTY_PRESETS`);
      }

      const customCfg = sanitizeDifficultyConfig('easy', { duration: 420 });
      assert.equal(customCfg.preset, 'easy');
      assert.equal(customCfg.isCustom, true, 'Custom overrides must set isCustom=true');
    });
  });
});

