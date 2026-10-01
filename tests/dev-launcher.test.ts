import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const launcher = await import(new URL('../scripts/start-dev.mjs', import.meta.url).href);

test('development launcher detects missing or mismatched direct locked dependencies', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'awb-launcher-'));
  try {
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ dependencies: { example: '1.0.0' } }));
    await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/example': { version: '1.0.0' } } }));
    assert.deepEqual(launcher.missingDependencies(root), ['example']);
    await mkdir(path.join(root, 'node_modules/example'), { recursive: true });
    await writeFile(path.join(root, 'node_modules/example/package.json'), JSON.stringify({ version: '2.0.0' }));
    assert.deepEqual(launcher.missingDependencies(root), ['example']);
    await writeFile(path.join(root, 'node_modules/example/package.json'), JSON.stringify({ version: '1.0.0' }));
    assert.deepEqual(launcher.missingDependencies(root), []);
  } finally { await rm(root, { recursive: true }); }
});

test('development startup checks and builds before launching, without changing the parent environment', () => {
  const original = { ELECTRON_RUN_AS_NODE: '1', PATH: 'keep-path', EXAMPLE: 'keep-value' };
  assert.deepEqual(launcher.electronEnvironment(original), { PATH: 'keep-path', EXAMPLE: 'keep-value' });
  assert.equal(original.ELECTRON_RUN_AS_NODE, '1');
  const calls: { executable: string; args: string[]; options: any }[] = [];
  const run = (executable: string, args: string[], options: any) => { calls.push({ executable, args, options }); return { status: 0 }; };
  assert.equal(launcher.startDevelopment({ args: [], run }), 0);
  assert.deepEqual(calls.slice(0, 2).map(call => call.args.slice(1)), [['run', 'setup:electron'], ['run', 'build']]);
  assert.ok(calls.slice(0, 2).every(call => call.options.windowsHide === true));
  assert.ok(calls.at(-1)?.executable.endsWith('electron.exe'));
  assert.deepEqual(calls.at(-1)?.args, [launcher.projectRoot]);
  assert.equal(calls.at(-1)?.options.windowsHide, false, 'The interactive Electron window must not inherit SW_HIDE.');
  assert.equal(calls.at(-1)?.options.env.ELECTRON_RUN_AS_NODE, undefined);
  calls.length = 0;
  assert.equal(launcher.startDevelopment({ args: ['--check'], run }), 0);
  assert.equal(calls.length, 2);
});

test('failed build stops the launcher rather than falling back to an old desktop bundle', () => {
  let count = 0;
  assert.throws(() => launcher.startDevelopment({ args: [], run: () => ({ status: ++count === 2 ? 1 : 0 }) }), /build failed/);
  assert.equal(count, 2);
  assert.throws(() => launcher.startDevelopment({ args: ['--unknown'] }), /Supported options/);
});
