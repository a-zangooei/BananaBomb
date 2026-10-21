process.env.NODE_ENV = 'test';
import test, { describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { server, wss, gameState, roles, resetGame, startGame, sessions, activeSockets, ROLES } from '../server.js';

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
        // ignore
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

    ws.on('error', (err) => {
      reject(err);
    });
  });
}

describe('Player Sessions and Game State Lifecycle', () => {
  before(() => {
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        resolve();
      });
    });
  });

  after(async () => {
    resetGame(true);
    for (const ws of openSockets) {
      try {
        ws.terminate();
      } catch (e) {}
    }
    openSockets.clear();
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

  // 1. Connecting all three roles
  test('1. Connecting all three roles assigns roles and sets status to ready', async () => {
    const client1 = await createClient();
    const client2 = await createClient();
    const client3 = await createClient();

    // Player 1 joins blind
    client1.send({ type: 'join', payload: { role: 'blind', playerId: 'p1_blind' } });
    const res1 = await client1.waitFor((m) => m.type === 'role_assigned');
    assert.equal(res1.role, 'blind');
    assert.equal(roles.blind.playerId, 'p1_blind');
    assert.equal(roles.blind.connected, true);

    // Player 2 joins deaf
    client2.send({ type: 'join', payload: { role: 'deaf', playerId: 'p2_deaf' } });
    const res2 = await client2.waitFor((m) => m.type === 'role_assigned');
    assert.equal(res2.role, 'deaf');
    assert.equal(roles.deaf.playerId, 'p2_deaf');
    assert.equal(roles.deaf.connected, true);

    // Player 3 joins mute
    client3.send({ type: 'join', payload: { role: 'mute', playerId: 'p3_mute' } });
    const res3 = await client3.waitFor((m) => m.type === 'role_assigned');
    assert.equal(res3.role, 'mute');
    assert.equal(roles.mute.playerId, 'p3_mute');
    assert.equal(roles.mute.connected, true);

    // Verify all 3 connected and state became ready
    const stateUpdate = await client1.waitFor((m) => m.type === 'state_update' && m.state.status === 'ready');
    assert.equal(stateUpdate.state.status, 'ready');
    assert.equal(stateUpdate.state.roles.blind.playerId, 'p1_blind');
    assert.equal(stateUpdate.state.roles.deaf.playerId, 'p2_deaf');
    assert.equal(stateUpdate.state.roles.mute.playerId, 'p3_mute');
  });

  // 2. Rejecting or safely handling a duplicate role
  test('2. Rejecting a duplicate role when role is already taken by connected player', async () => {
    const client1 = await createClient();
    const client2 = await createClient();

    // Player 1 claims blind
    client1.send({ type: 'join', payload: { role: 'blind', playerId: 'player_1' } });
    await client1.waitFor((m) => m.type === 'role_assigned');

    // Player 2 tries to claim blind while Player 1 is connected
    client2.send({ type: 'join', payload: { role: 'blind', playerId: 'player_2' } });
    const err = await client2.waitFor((m) => m.type === 'error' && m.code === 'ROLE_TAKEN');
    assert.equal(err.code, 'ROLE_TAKEN');

    // Role blind remains owned by Player 1
    assert.equal(roles.blind.playerId, 'player_1');
    assert.equal(roles.blind.connected, true);
  });

  // 3. Switching roles without leaving previous role occupied
  test('3. Switching roles safely releases previous role without leaving it occupied', async () => {
    const client1 = await createClient();
    const client2 = await createClient();

    // Player 1 claims blind
    client1.send({ type: 'join', payload: { role: 'blind', playerId: 'player_switcher' } });
    await client1.waitFor((m) => m.type === 'role_assigned');
    assert.equal(roles.blind.playerId, 'player_switcher');

    // Player 1 now switches to deaf
    client1.send({ type: 'join', payload: { role: 'deaf', playerId: 'player_switcher' } });
    const assigned = await client1.waitFor((m) => m.type === 'role_assigned' && m.role === 'deaf');
    assert.equal(assigned.role, 'deaf');

    // Critical invariant check: Previous role 'blind' MUST be completely free!
    assert.equal(roles.blind.playerId, null);
    assert.equal(roles.blind.connected, false);
    assert.equal(roles.deaf.playerId, 'player_switcher');
    assert.equal(roles.deaf.connected, true);

    // Now Player 2 can immediately claim the released 'blind' role without issue
    client2.send({ type: 'join', payload: { role: 'blind', playerId: 'player_2' } });
    const assignedP2 = await client2.waitFor((m) => m.type === 'role_assigned');
    assert.equal(assignedP2.role, 'blind');
    assert.equal(roles.blind.playerId, 'player_2');
  });

  // 4. Disconnecting a player and reconnecting
  test('4. Disconnecting a player and reconnecting restores their legitimate session', async () => {
    let client1 = await createClient();

    // Player 1 joins as blind
    client1.send({ type: 'join', payload: { role: 'blind', playerId: 'player_reconnect' } });
    await client1.waitFor((m) => m.type === 'role_assigned');
    assert.equal(roles.blind.connected, true);

    // Player 1 disconnects (socket closes)
    await client1.close();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(roles.blind.playerId, 'player_reconnect');
    assert.equal(roles.blind.connected, false);

    // Player 1 reconnects with new socket using same playerId
    client1 = await createClient();
    client1.send({ type: 'join', payload: { role: 'blind', playerId: 'player_reconnect' } });
    const reassigned = await client1.waitFor((m) => m.type === 'role_assigned');
    assert.equal(reassigned.role, 'blind');
    assert.equal(roles.blind.playerId, 'player_reconnect');
    assert.equal(roles.blind.connected, true);
  });

  // 5. An old connection closing after a newer connection becomes active
  test('5. An old connection closing after a newer connection becomes active does not mark session disconnected', async () => {
    const clientOld = await createClient();

    // Player joins with clientOld
    clientOld.send({ type: 'join', payload: { role: 'blind', playerId: 'player_dual' } });
    await clientOld.waitFor((m) => m.type === 'role_assigned');
    assert.equal(roles.blind.connected, true);

    // Player opens duplicate connection clientNew with same playerId
    const clientNew = await createClient();
    clientNew.send({ type: 'join', payload: { role: 'blind', playerId: 'player_dual' } });
    await clientNew.waitFor((m) => m.type === 'role_assigned');

    // clientOld receives session_replaced notification
    const replaced = await clientOld.waitFor((m) => m.type === 'session_replaced');
    assert.ok(replaced);

    // Now clientOld socket closes
    await clientOld.close();
    await new Promise((r) => setTimeout(r, 60));

    // INVARIANT: Player role MUST STILL BE CONNECTED on clientNew!
    assert.equal(roles.blind.playerId, 'player_dual');
    assert.equal(roles.blind.connected, true);

    const session = sessions.get('player_dual');
    assert.equal(session.connected, true);
    assert.ok(session.socket);
  });

  // 6. Attempting a reset from an unauthorized client
  test('6. Attempting a reset from an unauthorized client is rejected', async () => {
    const hostClient = await createClient();
    const spectatorClient = await createClient();

    // Host claims role
    hostClient.send({ type: 'join', payload: { role: 'blind', playerId: 'player_host' } });
    await hostClient.waitFor((m) => m.type === 'role_assigned');

    // Spectator (no role, not host) tries to reset
    spectatorClient.send({ type: 'reset' });
    const err = await spectatorClient.waitFor((m) => m.type === 'error');
    assert.equal(err.code, 'UNAUTHORIZED');

    // Non-host player also tries to reset
    const player2Client = await createClient();
    player2Client.send({ type: 'join', payload: { role: 'deaf', playerId: 'player_non_host' } });
    await player2Client.waitFor((m) => m.type === 'role_assigned');

    player2Client.send({ type: 'reset' });
    const err2 = await player2Client.waitFor((m) => m.type === 'error');
    assert.equal(err2.code, 'UNAUTHORIZED');

    // Host resets successfully
    hostClient.send({ type: 'reset' });
    const state = await hostClient.waitFor((m) => m.type === 'state_update' && m.state.status === 'waiting');
    assert.equal(state.state.status, 'waiting');
  });

  // 7. Resetting and starting a new session without stale roles
  test('7. Resetting purges stale disconnected roles while retaining connected players', async () => {
    const client1 = await createClient();
    const client2 = await createClient();

    // Client 1 is host (blind)
    client1.send({ type: 'join', payload: { role: 'blind', playerId: 'host_p1' } });
    await client1.waitFor((m) => m.type === 'role_assigned');

    // Client 2 joins deaf
    client2.send({ type: 'join', payload: { role: 'deaf', playerId: 'player_p2' } });
    await client2.waitFor((m) => m.type === 'role_assigned');

    // Client 2 disconnects
    await client2.close();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(roles.deaf.connected, false);
    assert.equal(roles.deaf.playerId, 'player_p2');

    // Clear client1 queue so we only catch the post-reset state_update
    client1.clearQueue();

    // Host triggers reset
    client1.send({ type: 'reset' });
    const state = await client1.waitFor((m) => m.type === 'state_update' && m.state.roles.deaf.playerId === null);

    // Verify: stale disconnected role 'deaf' was purged
    assert.equal(state.state.roles.deaf.playerId, null);
    assert.equal(state.state.roles.deaf.connected, false);

    // Active connected host role 'blind' is retained
    assert.equal(state.state.roles.blind.playerId, 'host_p1');
    assert.equal(state.state.roles.blind.connected, true);
  });

  // 8. Confirming unauthorized clients cannot access hidden solution data
  test('8. Confirming unauthorized clients and roles cannot access hidden solution data', async () => {
    const spectatorClient = await createClient();
    const blindClient = await createClient();
    const deafClient = await createClient();
    const muteClient = await createClient();

    blindClient.send({ type: 'join', payload: { role: 'blind', playerId: 'p_b' } });
    await blindClient.waitFor((m) => m.type === 'role_assigned');

    deafClient.send({ type: 'join', payload: { role: 'deaf', playerId: 'p_d' } });
    await deafClient.waitFor((m) => m.type === 'role_assigned');

    muteClient.send({ type: 'join', payload: { role: 'mute', playerId: 'p_m' } });
    await muteClient.waitFor((m) => m.type === 'role_assigned');

    // Host starts the game
    blindClient.send({ type: 'start' });
    await blindClient.waitFor((m) => m.type === 'game_started');

    // Check spectator state:
    const spectatorState = await spectatorClient.waitFor((m) => m.type === 'state_update' && m.state.status === 'running');
    assert.equal(spectatorState.state.modules, null, 'Spectator should receive null modules');
    assert.equal(spectatorState.state.serialNumber, null, 'Spectator should receive null serial');
    assert.equal(spectatorState.state.seed, undefined, 'Seed must not be sent');

    // Check blind state:
    const blindState = await blindClient.waitFor((m) => m.type === 'state_update' && m.state.status === 'running');
    assert.equal(blindState.state.serialNumber, null, 'Blind must not receive serial number');
    assert.equal(blindState.state.seed, undefined, 'Seed must not be sent');
    assert.equal(blindState.state.modules.button.targetReleaseDigit, undefined, 'Blind must not receive targetReleaseDigit');
    assert.equal(blindState.state.modules.button.actionType, undefined, 'Blind must not receive actionType');
    assert.equal(blindState.state.modules.wires.correctWireIndex, undefined, 'Blind must not receive correctWireIndex');
    assert.equal(blindState.state.modules.keypad.correctOrder, undefined, 'Blind must not receive correctOrder');

    // Check deaf state:
    const deafState = await deafClient.waitFor((m) => m.type === 'state_update' && m.state.status === 'running');
    assert.ok(deafState.state.serialNumber, 'Deaf should see serial plate');
    assert.equal(deafState.state.seed, undefined, 'Seed must not be sent');
    assert.equal(deafState.state.modules.button.targetReleaseDigit, undefined, 'Deaf must not receive targetReleaseDigit');
    assert.equal(deafState.state.modules.button.actionType, undefined, 'Deaf must not receive actionType');
    assert.equal(deafState.state.modules.wires.correctWireIndex, undefined, 'Deaf must not receive correctWireIndex');
    assert.equal(deafState.state.modules.keypad.correctOrder, undefined, 'Deaf must not receive correctOrder');

    // Check mute state:
    const muteState = await muteClient.waitFor((m) => m.type === 'state_update' && m.state.status === 'running');
    assert.equal(muteState.state.serialNumber, null, 'Mute must not receive serial number');
    assert.equal(muteState.state.modules.button.color, undefined, 'Mute should only see solved status');
    assert.equal(muteState.state.modules.wires.wires, undefined, 'Mute should not see wire colors');
    assert.equal(muteState.state.modules.keypad.symbols, undefined, 'Mute should not see keypad symbols');
  });
});
