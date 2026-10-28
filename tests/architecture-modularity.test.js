import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.PORT = '0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const { server } = await import('../server.js');
const { activeModules, modulesById, validateBombActionPayload } = await import('../modules/index.js');
const { clientModules } = await import('../public/modules/index.js');

function collectProdJsFiles(dir, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'tests' || entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectProdJsFiles(full, result);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      result.push(full);
    }
  }
  return result.sort();
}

function parseStaticModuleSpecifiers(code) {
  const specifiers = [];
  const regex = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = regex.exec(code)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

describe('Architecture, Dependency Graph & Module Registry Contracts', () => {
  let port = 0;

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

  after(() => {
    server.unref();
  });

  test('1. Static ES import graph has zero broken relative imports and zero circular dependencies', () => {
    const files = collectProdJsFiles(ROOT_DIR);
    assert.ok(files.length >= 25, `Expected modular file layout, found ${files.length} files`);

    const adj = new Map();
    for (const file of files) {
      const code = fs.readFileSync(file, 'utf8');
      const specs = parseStaticModuleSpecifiers(code);
      const deps = [];

      for (const spec of specs) {
        if (spec.startsWith('.')) {
          const resolved = path.resolve(path.dirname(file), spec);
          assert.ok(
            fs.existsSync(resolved),
            `Broken relative import "${spec}" in ${path.relative(ROOT_DIR, file)} -> ${resolved}`
          );
          deps.push(resolved);

          // Verify browser URL resolution parity for files served from public/
          const relFromRoot = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
          if (relFromRoot.startsWith('public/')) {
            const browserMountPath = '/' + relFromRoot.slice('public/'.length);
            const resolvedUrl = new URL(spec, `http://127.0.0.1:3000${browserMountPath}`);
            const urlPathname = resolvedUrl.pathname;
            const diskCandidatePublic = path.join(ROOT_DIR, 'public', urlPathname);
            const diskCandidateShared = urlPathname.startsWith('/shared/')
              ? path.join(ROOT_DIR, urlPathname)
              : null;

            const validHttpTarget =
              fs.existsSync(diskCandidatePublic) ||
              (diskCandidateShared !== null && fs.existsSync(diskCandidateShared));
            assert.ok(
              validHttpTarget,
              `Browser HTTP URL resolution mismatch for "${spec}" in ${relFromRoot} -> ${urlPathname}`
            );
          }
        }
      }
      adj.set(file, deps);
    }

    // DFS Cycle Detection
    const state = new Map(); // 0=unvisited, 1=visiting, 2=visited
    const stack = [];
    const cycles = [];

    function dfs(node) {
      state.set(node, 1);
      stack.push(node);
      for (const next of adj.get(node) || []) {
        const nextState = state.get(next) || 0;
        if (nextState === 1) {
          const idx = stack.indexOf(next);
          const cyclePath = [...stack.slice(idx), next].map((p) => path.relative(ROOT_DIR, p));
          cycles.push(cyclePath.join(' -> '));
        } else if (nextState === 0) {
          dfs(next);
        }
      }
      stack.pop();
      state.set(node, 2);
    }

    for (const file of files) {
      if ((state.get(file) || 0) === 0) {
        dfs(file);
      }
    }

    assert.deepEqual(cycles, [], `Detected circular dependencies: ${cycles.join('; ')}`);
  });

  test('2. Layering direction: shared/ modules do not import from server/, modules/, or public/', () => {
    const sharedDir = path.join(ROOT_DIR, 'shared');
    const sharedFiles = collectProdJsFiles(sharedDir);
    assert.ok(sharedFiles.length >= 4, 'shared/ directory must contain isomorphic domain modules');

    for (const file of sharedFiles) {
      const code = fs.readFileSync(file, 'utf8');
      const specs = parseStaticModuleSpecifiers(code);
      for (const spec of specs) {
        if (spec.startsWith('.')) {
          const target = path.resolve(path.dirname(file), spec);
          assert.ok(
            target.startsWith(sharedDir + path.sep),
            `shared module ${path.basename(file)} must not depend on outer layer: ${spec}`
          );
        }
      }
    }
  });

  test('3. Express serves isomorphic /shared/* modules over HTTP with JavaScript MIME type', async () => {
    for (const sharedPath of ['/shared/roles.js', '/shared/difficulty.js', '/shared/comm-aid.js', '/shared/utils.js']) {
      const resp = await fetch(`http://127.0.0.1:${port}${sharedPath}`);
      assert.equal(resp.status, 200, `Expected 200 OK for ${sharedPath}`);
      const contentType = resp.headers.get('content-type') || '';
      assert.ok(
        contentType.includes('javascript'),
        `Expected JavaScript content-type for ${sharedPath}, got "${contentType}"`
      );
      const body = await resp.text();
      assert.ok(body.includes('export '), `${sharedPath} response must contain ES module exports`);
    }
  });

  test('4. Server and client gameplay module registries satisfy explicit contracts and parity', () => {
    assert.equal(activeModules.length, clientModules.length, 'Server and client module counts must match');

    const clientIds = new Set(clientModules.map((m) => m.id));
    for (const mod of activeModules) {
      assert.equal(typeof mod.id, 'string');
      assert.equal(typeof mod.title, 'string');
      assert.equal(typeof mod.create, 'function', `${mod.id} missing create()`);
      assert.equal(typeof mod.filterForRole, 'function', `${mod.id} missing filterForRole()`);
      assert.equal(typeof mod.validateAction, 'function', `${mod.id} missing validateAction()`);
      assert.equal(typeof mod.handleAction, 'function', `${mod.id} missing handleAction()`);
      assert.equal(typeof mod.isSolved, 'function', `${mod.id} missing isSolved()`);
      assert.equal(modulesById.get(mod.id), mod, `${mod.id} must be indexed in modulesById`);
      assert.ok(clientIds.has(mod.id), `Client module registry missing "${mod.id}"`);
    }

    for (const cMod of clientModules) {
      assert.equal(typeof cMod.build, 'function', `Client module ${cMod.id} missing build()`);
      assert.equal(typeof cMod.update, 'function', `Client module ${cMod.id} missing update()`);
      assert.equal(typeof cMod.resolveControl, 'function', `Client module ${cMod.id} missing resolveControl()`);
    }

    // Verify polymorphic validateBombActionPayload delegates to registered modules
    assert.equal(validateBombActionPayload('unknown_mod', 'press', {}).ok, false);
    assert.equal(validateBombActionPayload('button', 'press', undefined).ok, true);
    assert.equal(validateBombActionPayload('button', 'release', { releaseDigit: 7 }).ok, true);
    assert.equal(validateBombActionPayload('button', 'release', { releaseDigit: 12 }).ok, false);
    assert.equal(validateBombActionPayload('wires', 'cut', { wireIndex: 2 }).ok, true);
    assert.equal(validateBombActionPayload('wires', 'cut', { wireIndex: -1 }).ok, false);
    assert.equal(validateBombActionPayload('keypad', 'press', { slotIndex: 3 }).ok, true);
    assert.equal(validateBombActionPayload('keypad', 'press', { slotIndex: 9 }).ok, false);
    assert.equal(validateBombActionPayload('beacon', 'tune', { slot: 2 }).ok, true);
    assert.equal(validateBombActionPayload('beacon', 'transmit', undefined).ok, true);
  });
});
