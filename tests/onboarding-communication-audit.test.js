process.env.NODE_ENV = 'test';
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import {
  server,
  gameState,
  roles,
  sessions,
  activeSockets,
  ROLES,
  COMM_AID_SYMBOLS,
  resetGame,
  createRng
} from '../server.js';
import { selectRoundRules } from '../modules/rules-config.js';
import { DIFFICULTY_PRESETS, sanitizeDifficultyConfig } from '../modules/difficulty-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Onboarding, Physical Setup Audit, Gesture Vocabulary & Easy-Mode Communication Aid', () => {
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
          messageQueue,
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
                rej(new Error(`Timeout waiting for message after ${timeoutMs}ms`));
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

  function cleanRoom() {
    for (const ws of openSockets) {
      try {
        ws.terminate();
      } catch (e) {}
    }
    openSockets.clear();
    sessions.clear();
    activeSockets.clear();
    for (const r of ROLES) {
      roles[r].playerId = null;
      roles[r].connected = false;
      roles[r].joinedAt = null;
    }
    gameState.difficulty = sanitizeDifficultyConfig('normal');
    resetGame(true);
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
    cleanRoom();
    server.unref();
  });

  describe('1. Codebase & Rulebook Contradiction Audit', () => {
    const indexHtml = fs.readFileSync(path.join(rootDir, 'public/index.html'), 'utf8');
    const appJs = fs.readFileSync(path.join(rootDir, 'public/app.js'), 'utf8');
    const rulesConfigJs = fs.readFileSync(path.join(rootDir, 'modules/rules-config.js'), 'utf8');

    test('Player-facing HTML and JS eliminate misleading role labels, window.alert, and false exclusive-audio claims', () => {
      assert.ok(!indexHtml.includes('نقش نابینا'), 'index.html must not label Operator as Blind role');
      assert.ok(!indexHtml.includes('نقش ناشنوا'), 'index.html must not label Observer as Deaf role');
      assert.ok(!indexHtml.includes('نقش لال'), 'index.html must not label Manual-holder as Mute role');

      assert.ok(!appJs.includes('alert('), 'app.js must not use blocking window.alert');
      assert.ok(!appJs.includes('window.open('), 'app.js must not use window.open');

      // Verify zero inaccurate claims that only the Operator can hear audio in the shared room
      assert.ok(!indexHtml.includes('تنها اپراتور ریتم'), 'index.html must not claim exclusive Operator audio');
      assert.ok(!appJs.includes('تنها <strong>اپراتور</strong> ریتم صوتی بوق‌ها را می‌شنود'), 'app.js must not claim exclusive Operator audio');
      assert.ok(!rulesConfigJs.includes('تنها اپراتور الگوی ریتمیک بیپ را می‌شنود'), 'rules-config.js must not claim exclusive Operator audio');
    });

    test('Dynamic rulebook notes enforce Manual-holder <-> Observer gesture bridge and never instruct speaking to Operator', () => {
      const rng = createRng('AUDIT_SEED_1');
      const { rulebook } = selectRoundRules(rng, 'AUDIT_SEED_1');

      assert.ok(!rulebook.button.note.includes('به اپراتور کلیک یا زمان رهاسازی را بگویید'), 'Manual-holder must not be told to speak to Operator');
      assert.ok(rulebook.button.note.includes('ناظر'), 'Button note must route through Observer');
      assert.ok(rulebook.button.note.includes('اشاره'), 'Button note must specify gesture communication');

      assert.ok(rulebook.wires.note.includes('ناظر') && rulebook.wires.note.includes('اشاره'), 'Wires note must route via gestures to Observer');
      assert.ok(rulebook.keypad.note.includes('ناظر') && rulebook.keypad.note.includes('اشاره'), 'Keypad note must route via gestures to Observer');
      assert.ok(rulebook.beacon.note.includes('در فضای اتاق ممکن است'), 'Beacon note must accurately explain physical room audio');
      assert.ok(rulebook.beacon.note.includes('ناظر نیز نباید از صدای بازی استفاده کند'), 'Beacon note must state Observer cannot rely on game audio');
    });

    test('Onboarding UI contains Tutorial, You-can/You-cannot panel, 9-item Gesture Vocabulary, and 7-item Pre-Round Checklist', () => {
      // Tutorial & communication graph
      assert.ok(indexHtml.includes('id="onboardingTutorialPanel"'), 'Missing onboarding tutorial panel');
      assert.ok(indexHtml.includes('چیدمان نشستن'), 'Tutorial must explain seating arrangement');
      assert.ok(indexHtml.includes('واقعیت فیزیکی صدا'), 'Tutorial must explain physical room audio');
      assert.ok(indexHtml.includes('ایمنی و دسترس‌پذیری'), 'Tutorial must include safety & accessibility alternatives');

      // You can / You cannot panel
      assert.ok(indexHtml.includes('id="rolePermissionsPanel"'), 'Missing role permissions panel');
      assert.ok(appJs.includes('ROLE_PERMISSIONS_SPEC'), 'Missing structured role permissions specification');

      // Gesture vocabulary items (9 distinct cards covering all required meanings)
      const gestureMatches = indexHtml.match(/class="gesture-item"/g) || [];
      assert.equal(gestureMatches.length, 9, 'Gesture vocabulary must present 9 distinct, learnable gesture cards');
      assert.ok(indexHtml.includes('۱ تا ۴'), 'Gesture vocabulary must include numbers 1-4');
      assert.ok(indexHtml.includes('بله / تأیید') && indexHtml.includes('خیر / رد'), 'Gesture vocabulary must include Yes and No');
      assert.ok(indexHtml.includes('تکرار کن'), 'Gesture vocabulary must include Repeat');
      assert.ok(indexHtml.includes('توقف'), 'Gesture vocabulary must include Stop');
      assert.ok(indexHtml.includes('ضربه در برابر نگه‌داشتن'), 'Gesture vocabulary must include Tap vs Hold');
      assert.ok(indexHtml.includes('انجام شد'), 'Gesture vocabulary must include Action Completed');
      assert.ok(indexHtml.includes('نیاز به زمان بیشتر'), 'Gesture vocabulary must include Need More Time');
      assert.ok(indexHtml.includes('عدم اطمینان'), 'Gesture vocabulary must include Uncertainty');

      // 7-item equipment & seating checklist
      const checklistMatches = indexHtml.match(/data-check-key="/g) || [];
      assert.equal(checklistMatches.length, 7, 'Pre-round checklist must include all 7 required items');
    });
  });

  describe('2. Easy-Mode 3-Symbol Communication Aid & Server Validation', () => {
    test('Difficulty presets configure Easy with 5 commAid uses and Normal/Hard with 0', () => {
      assert.equal(DIFFICULTY_PRESETS.easy.features.commAidEnabled, true);
      assert.equal(DIFFICULTY_PRESETS.easy.features.commAidBudget, 5);
      assert.equal(DIFFICULTY_PRESETS.normal.features.commAidEnabled, false);
      assert.equal(DIFFICULTY_PRESETS.normal.features.commAidBudget, 0);
      assert.equal(DIFFICULTY_PRESETS.hard.features.commAidEnabled, false);
      assert.equal(DIFFICULTY_PRESETS.hard.features.commAidBudget, 0);

      // Custom budget sanitization clamps to [0..15]
      const custom = sanitizeDifficultyConfig('easy', {
        features: { commAidEnabled: true, commAidBudget: 99 }
      });
      assert.equal(custom.features.commAidEnabled, true);
      assert.equal(custom.features.commAidBudget, 15);

      // Exactly 3 symbols defined on server
      assert.deepEqual(Object.keys(COMM_AID_SYMBOLS).sort(), ['confirm', 'reject', 'urgent']);
    });

    test('Server enforces 5-use budget, 3-symbol enum, anti-chat validation, and Operator isolation in Easy mode', async () => {
      cleanRoom();

      const operatorClient = await createClient();
      const observerClient = await createClient();
      const manualClient = await createClient();

      operatorClient.send({ type: 'join', payload: { role: 'operator', playerId: 'aid_op' } });
      await operatorClient.waitFor((m) => m.type === 'role_assigned');

      observerClient.send({ type: 'join', payload: { role: 'observer', playerId: 'aid_obs' } });
      await observerClient.waitFor((m) => m.type === 'role_assigned');

      manualClient.send({ type: 'join', payload: { role: 'manual', playerId: 'aid_man' } });
      await manualClient.waitFor((m) => m.type === 'role_assigned');

      await operatorClient.waitFor((m) => m.type === 'state_update' && m.state.status === 'ready');

      // Host (aid_op) switches to Easy preset (budget = 5)
      operatorClient.send({ type: 'set_difficulty', payload: { presetId: 'easy' } });
      await observerClient.waitFor((m) => m.type === 'state_update' && m.state.difficulty?.preset === 'easy');

      // Start game
      operatorClient.send({ type: 'start', payload: { seed: 'EASY_AID_TEST' } });
      const obsStartState = await observerClient.waitFor((m) => m.type === 'state_update' && m.state.status === 'running');
      assert.equal(obsStartState.state.commAid.enabled, true);
      assert.equal(obsStartState.state.commAid.totalBudget, 5);
      assert.equal(obsStartState.state.commAid.remainingUses, 5);

      // 1. Operator attempting to use comm_signal is rejected (preserves Observer bridge!)
      operatorClient.send({ type: 'comm_signal', payload: { symbolId: 'confirm' } });
      const opErr = await operatorClient.waitFor((m) => m.type === 'error' && m.code === 'UNAUTHORIZED_COMM_ROLE');
      assert.equal(opErr.code, 'UNAUTHORIZED_COMM_ROLE');
      assert.equal(gameState.commAid.remainingUses, 5, 'Failed Operator signal must not consume budget');

      // 2. Attempting to send free-text chat or invalid symbol is rejected
      manualClient.send({ type: 'comm_signal', payload: { symbolId: 'confirm', text: 'cut wire 2' } });
      const chatErr = await manualClient.waitFor((m) => m.type === 'error' && m.code === 'INVALID_COMM_SYMBOL');
      assert.equal(chatErr.code, 'INVALID_COMM_SYMBOL');

      observerClient.send({ type: 'comm_signal', payload: { symbolId: 'wire_3_shortcut' } });
      const symErr = await observerClient.waitFor((m) => m.type === 'error' && m.code === 'INVALID_COMM_SYMBOL');
      assert.equal(symErr.code, 'INVALID_COMM_SYMBOL');
      assert.equal(gameState.commAid.remainingUses, 5, 'Invalid symbol must not consume budget');

      // 3. Valid signal from Manual-holder reaches Observer, decrements budget, and is hidden from Operator!
      manualClient.send({ type: 'comm_signal', payload: { symbolId: 'confirm', actionId: 'sig-1' } });
      const obsSignalEvent = await observerClient.waitFor((m) => m.type === 'comm_signal_sent' && m.signal?.seq === 1);
      assert.equal(obsSignalEvent.signal.id, 'confirm');
      assert.equal(obsSignalEvent.signal.senderRole, 'manual');
      assert.equal(obsSignalEvent.remainingUses, 4);

      const opFilteredAfterSig1 = await operatorClient.waitFor(
        (m) => m.type === 'state_update' && m.state.commAid?.seq === 1
      );
      assert.equal(opFilteredAfterSig1.state.commAid.lastSignal, null, 'Operator must never receive direct Manual-holder signal details');

      // Duplicate actionId does not double-spend budget
      manualClient.send({ type: 'comm_signal', payload: { symbolId: 'confirm', actionId: 'sig-1' } });
      const dupAck = await manualClient.waitFor((m) => m.type === 'action_duplicate');
      assert.equal(dupAck.actionId, 'sig-1');
      assert.equal(gameState.commAid.remainingUses, 4);

      // 4. Consume remaining 4 uses across Observer and Manual-holder
      const sequence = [
        { client: observerClient, sym: 'urgent', id: 'sig-2' },
        { client: manualClient, sym: 'reject', id: 'sig-3' },
        { client: observerClient, sym: 'confirm', id: 'sig-4' },
        { client: manualClient, sym: 'urgent', id: 'sig-5' }
      ];

      for (let i = 0; i < sequence.length; i++) {
        sequence[i].client.send({
          type: 'comm_signal',
          payload: { symbolId: sequence[i].sym, actionId: sequence[i].id }
        });
        await observerClient.waitFor((m) => m.type === 'comm_signal_sent' && m.signal?.seq === i + 2);
      }

      assert.equal(gameState.commAid.remainingUses, 0);

      // 5. 6th attempt is rejected with COMM_BUDGET_EXHAUSTED
      observerClient.send({ type: 'comm_signal', payload: { symbolId: 'confirm', actionId: 'sig-6' } });
      const exhaustedErr = await observerClient.waitFor((m) => m.type === 'error' && m.code === 'COMM_BUDGET_EXHAUSTED');
      assert.equal(exhaustedErr.code, 'COMM_BUDGET_EXHAUSTED');
      assert.equal(gameState.commAid.remainingUses, 0);
    });

    test('Comm aid is rejected when disabled in Normal difficulty', async () => {
      cleanRoom();

      const op = await createClient();
      const obs = await createClient();
      const man = await createClient();

      op.send({ type: 'join', payload: { role: 'operator', playerId: 'norm_op' } });
      await op.waitFor((m) => m.type === 'role_assigned');
      obs.send({ type: 'join', payload: { role: 'observer', playerId: 'norm_obs' } });
      await obs.waitFor((m) => m.type === 'role_assigned');
      man.send({ type: 'join', payload: { role: 'manual', playerId: 'norm_man' } });
      await man.waitFor((m) => m.type === 'role_assigned');

      await op.waitFor((m) => m.type === 'state_update' && m.state.status === 'ready');
      op.send({ type: 'start', payload: { seed: 'NORM_NO_AID' } });
      await obs.waitFor((m) => m.type === 'state_update' && m.state.status === 'running');

      man.send({ type: 'comm_signal', payload: { symbolId: 'confirm' } });
      const disabledErr = await man.waitFor((m) => m.type === 'error' && m.code === 'COMM_AID_DISABLED');
      assert.equal(disabledErr.code, 'COMM_AID_DISABLED');
    });
  });
});
