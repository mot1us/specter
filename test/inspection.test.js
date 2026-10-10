'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { LiveFollow } = require('../src/controller');
const { parseInspection, InspectionFeed } = require('../src/inspection');
const { createVscodeMock, until, deferred } = require('./helpers/vscode');

const report = overrides => ({ id: 'first', path: 'bug.js', line: 2,
  message: 'Checking the return value', ...overrides });

test('source reads and inspection reports reject file symlinks before reading bytes', async t => {
  const mock = createVscodeMock();
  const controller = new LiveFollow(mock.vscode, mock.context);
  const feed = new InspectionFeed(mock.vscode, () => assert.fail('linked reports must not run'));
  t.after(() => { feed.dispose(); controller.dispose(); mock.dispose(); });
  mock.hooks.stat = async () => ({ type: mock.vscode.FileType.File | mock.vscode.FileType.SymbolicLink, size: 10 });
  mock.hooks.readFile = () => assert.fail('linked files must not be read');
  assert.equal(await controller.readText(mock.uri('linked.js')), null);
  const signal = mock.uri('.codex-live-follow/activity.json');
  feed.revisions.set(signal.toString(), 1);
  await feed.read(signal, mock.vscode.workspace.workspaceFolders[0], signal.toString(), 1, 0);
  assert.equal(feed.seen.size, 0);
});

async function fixture(t, config = {}) {
  const mock = createVscodeMock({ config: { inspectionDisplayMs: 300, ...config } });
  const uri = mock.uri('bug.js');
  mock.put(uri, 'function result() {\n  return false;\n}\n');
  const controller = new LiveFollow(mock.vscode, mock.context);
  t.after(() => { controller.dispose(); mock.dispose(); });
  await controller.start();
  const signal = mock.uri('.codex-live-follow/activity.json');
  return { mock, controller, uri, signal };
}

test('reports reject traversal, absolute paths, commands, and malformed line numbers', () => {
  for (const path of ['../bug.js', '/bug.js', 'file://bug.js', 'C:\\bug.js', 'src/../bug.js', 'src//bug.js']) {
    assert.equal(parseInspection(JSON.stringify(report({ path }))), undefined);
  }
  for (const bad of [{ line: 0 }, { line: 1.5 }, { endLine: 1 }, { phase: 'execute' },
    { message: 'x'.repeat(501) }, { id: '' }]) {
    assert.equal(parseInspection(JSON.stringify(report(bad))), undefined);
  }
  assert.equal(parseInspection(JSON.stringify(report())).endLine, 2);
});

test('a reported line is revealed without editing source or creating a typing replay', async t => {
  const { mock, controller, uri, signal } = await fixture(t);
  mock.write(signal, JSON.stringify(report({ phase: 'suspect' })), true);
  await until(() => mock.shown.length === 1);
  assert.equal(mock.shown[0].document.uri.toString(), uri.toString());
  assert.equal(mock.shown[0].editor.revealed.start.line, 1);
  assert.equal(controller.getState().status, 'inspecting');
  assert.equal(controller.getState().title, 'checking a hunch');
  assert.equal(controller.getState().line, 2);
  assert.equal(controller.getState().progress, null);
  assert.equal(mock.frames.length, 0);
  assert.equal(controller.snapshots.has(signal.toString()), false);
  assert.equal(mock.files.get(uri.toString()).content, 'function result() {\n  return false;\n}\n');
  await mock.commands.get('codexLiveFollow.skipReplay')();
  await until(() => !controller.playing);
  mock.write(signal, JSON.stringify(report({ phase: 'suspect' })));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(mock.shown.length, 1, 'a duplicate report must not run twice');
});

test('a coalesced activity-directory creation still reveals its first report', async t => {
  const { mock, controller, uri, signal } = await fixture(t);
  mock.put(signal, JSON.stringify(report()));
  // Some native watchers emit only the containing directory creation.
  mock.write(mock.uri('.codex-live-follow'), '', true);
  await until(() => controller.getState().status === 'inspecting');
  assert.equal(mock.shown[0].document.uri.toString(), uri.toString());
  assert.equal(controller.getState().line, 2);
  assert.equal(controller.inspections.seen.get(signal.toString()), 'first');
});

test('background inspections wait, skip works, and dirty documents are protected', async t => {
  const { mock, controller, uri, signal } = await fixture(t);
  mock.events.windowState.fire({ focused: false });
  mock.write(signal, JSON.stringify(report()));
  await until(() => controller.queue.length === 1);
  assert.equal(mock.shown.length, 0);
  mock.events.windowState.fire({ focused: true });
  await until(() => controller.getState().status === 'inspecting');
  await mock.commands.get('codexLiveFollow.skipReplay')();
  await until(() => !controller.playing);
  mock.documents.get(uri.toString()).isDirty = true;
  mock.write(signal, JSON.stringify(report({ id: 'dirty' })));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(mock.shown.length, 1);
});

test('stale startup reports, oversized reports, and ignored targets do not open editors', async t => {
  const mock = createVscodeMock();
  const signal = mock.uri('.codex-live-follow/activity.json');
  mock.put(signal, JSON.stringify(report()));
  mock.put(mock.uri('bug.js'), 'source');
  mock.put(mock.uri('node_modules/bug.js'), 'source');
  const controller = new LiveFollow(mock.vscode, mock.context);
  t.after(() => { controller.dispose(); mock.dispose(); });
  await controller.start();
  assert.equal(mock.shown.length, 0);
  mock.write(signal, ' '.repeat(16385));
  await new Promise(resolve => setTimeout(resolve, 100));
  mock.write(signal, JSON.stringify(report({ id: 'ignored', path: 'node_modules/bug.js' })));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(mock.shown.length, 0);
});

test('workspace reset invalidates a report already being read', async t => {
  const { mock, controller, signal } = await fixture(t);
  const reading = deferred();
  let started = false;
  mock.hooks.readFile = uri => {
    if (uri.toString() === signal.toString()) { started = true; return reading.promise; }
    return Buffer.from(mock.files.get(uri.toString()).content);
  };
  mock.write(signal, JSON.stringify(report()));
  await until(() => started);
  await controller.resetWorkspace();
  reading.resolve(Buffer.from(JSON.stringify(report())));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(mock.shown.length, 0);
});

test('an edit supersedes a queued inspection while preserving the real edit baseline', async t => {
  const { mock, controller, uri, signal } = await fixture(t, { mode: 'follow' });
  mock.events.windowState.fire({ focused: false });
  mock.write(signal, JSON.stringify(report()));
  await until(() => controller.queue.length === 1);
  mock.write(uri, 'function result() {\n  return true;\n}\n');
  await until(() => controller.queue[0]?.after?.includes('return true'));
  assert.equal(controller.queue.length, 1);
  assert.equal(controller.queue[0].before, 'function result() {\n  return false;\n}\n');
  mock.events.windowState.fire({ focused: true });
  await until(() => !controller.playing && controller.queue.length === 0);
  assert.equal(mock.shown[0].editor.revealed.start.line, 1);
});

test('a slow older inspection cannot enqueue after a newer report', async t => {
  const { mock, controller, uri, signal } = await fixture(t);
  mock.events.windowState.fire({ focused: false });
  const older = deferred();
  t.after(() => older.resolve(Buffer.from('source')));
  let reads = 0;
  mock.hooks.readFile = target => {
    if (target.toString() === uri.toString() && ++reads === 1) return older.promise;
    return Buffer.from(mock.files.get(target.toString()).content);
  };
  mock.write(signal, JSON.stringify(report({ id: 'older', line: 1 })), true);
  await until(() => reads === 1, 'older target read starts');
  mock.write(signal, JSON.stringify(report({ id: 'newer', line: 3 })));
  await until(() => controller.queue.some(job => job.id === 'newer'));
  older.resolve(Buffer.from('source'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(controller.queue.map(job => job.id), ['newer']);
});

test('duplicate report notifications do not invalidate an inspection being checked', async t => {
  const { mock, controller, uri, signal } = await fixture(t);
  mock.events.windowState.fire({ focused: false });
  const targetRead = deferred();
  t.after(() => targetRead.resolve(Buffer.from('source')));
  let started = false;
  let signalReads = 0;
  mock.hooks.readFile = target => {
    if (target.toString() === uri.toString()) { started = true; return targetRead.promise; }
    if (target.toString() === signal.toString()) signalReads++;
    return Buffer.from(mock.files.get(target.toString()).content);
  };
  mock.write(signal, JSON.stringify(report()), true);
  await until(() => started);
  mock.write(signal, JSON.stringify(report()));
  await until(() => signalReads === 2);
  targetRead.resolve(Buffer.from('source'));
  await until(() => controller.queue.length > 0);
  assert.deepEqual(controller.queue.map(job => job.id), ['first']);
});

test('inspection bursts keep only the latest pending report without displacing saved edits', async t => {
  const { mock, controller, signal } = await fixture(t);
  mock.events.windowState.fire({ focused: false });
  for (let i = 0; i < 8; i++) mock.write(mock.uri(`saved-${i}.js`), 'saved edit', true);
  await until(() => controller.queue.length === 8);
  for (let i = 0; i < 12; i++) {
    mock.write(signal, JSON.stringify(report({ id: `report-${i}` })), i === 0);
    await until(() => controller.queue.some(job => job.id === `report-${i}`));
  }
  assert.equal(controller.queue.filter(job => job.kind !== 'inspection').length, 8);
  assert.deepEqual(controller.queue.filter(job => job.kind === 'inspection').map(job => job.id), ['report-11']);
  assert.equal(controller.skipped, 0);
  mock.write(mock.uri('last-save.js'), 'new saved edit', true);
  await until(() => controller.queue.length === 10);
  assert.equal(controller.queue.at(-1).id, 'report-11', 'a later saved edit plays before the pending inspection');
});

test('an inspection cannot evict a saved edit from a full queue', async t => {
  const { mock, controller, signal } = await fixture(t);
  mock.events.windowState.fire({ focused: false });
  for (let i = 0; i < 12; i++) mock.write(mock.uri(`full-${i}.js`), 'saved edit', true);
  await until(() => controller.queue.length === 12);
  mock.write(signal, JSON.stringify(report()), true);
  await until(() => controller.inspections.seen.get(signal.toString()) === 'first');
  await until(() => controller.readPool.active === 0);
  assert.equal(controller.queue.length, 12);
  assert.ok(controller.queue.every(job => job.kind !== 'inspection'));
  assert.equal(controller.skipped, 0);
});

test('each workspace root retains its own latest pending inspection', async t => {
  const { mock, controller, uri } = await fixture(t);
  const other = { uri: mock.vscode.Uri.file('/other'), name: 'other', index: 1 };
  mock.vscode.workspace.workspaceFolders.push(other);
  const target = mock.vscode.Uri.joinPath(other.uri, 'bug.js');
  mock.put(target, 'other source');
  mock.events.windowState.fire({ focused: false });
  await controller.handleInspection({ ...report(), uri, generation: controller.generation });
  await controller.handleInspection({ ...report({ id: 'other' }), uri: target, generation: controller.generation });
  await controller.handleInspection({ ...report({ id: 'latest' }), uri, generation: controller.generation });
  assert.deepEqual(controller.queue.map(job => job.id), ['other', 'latest']);
});
