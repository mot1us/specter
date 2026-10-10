'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { LiveFollow } = require('../src/controller');
const { createVscodeMock, deferred, until } = require('./helpers/vscode');

const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t, options) {
  const mock = createVscodeMock(options);
  const controller = new LiveFollow(mock.vscode, mock.context);
  t.after(() => { controller.dispose(); mock.dispose(); });
  return { mock, controller };
}

async function settleRead(controller) {
  await until(() => controller.pendingReads.size === 0, 'file debounce did not finish');
  await until(() => controller.reading.size === 0, 'file reads did not finish');
  await tick();
}

test('burst backpressure bounds revisions before source reads start', async t => {
  const { mock, controller } = fixture(t, { config: { enabled: false } });
  await controller.start();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  for (let i = 0; i < 10000; i++) mock.write(mock.uri(`burst-${i}.js`), 'latest', true);
  assert.equal(controller.pendingReads.size, 256);
  assert.equal(controller.revisions.size, 256);
  assert.equal(controller.skipped, 9744);
  t.mock.timers.tick(90);
  for (let i = 0; i < 100 && controller.reading.size; i++) await tick();
  assert.equal(controller.reading.size, 0);
  assert.equal(controller.revisions.size, 0);
  assert.equal(controller.snapshots.size, 256);
  assert.equal(controller.snapshots.get(mock.uri('burst-9999.js').toString()), 'latest');
});

test('paused file watching stops I/O and resume baselines paused changes without replay', async t => {
  const { mock, controller } = fixture(t, { config: { enabled: false, suspendWhenPaused: true } });
  const source = mock.uri('paused.js');
  mock.put(source, 'before pause');
  let reads = 0;
  mock.hooks.readFile = async uri => { reads++; return Buffer.from(mock.files.get(uri.toString()).content); };
  await controller.start();
  assert.equal(reads, 0);
  assert.equal(controller.watchers.length, 0);
  mock.write(source, 'saved while paused');
  controller.scheduleRead(source);
  mock.events.saveDocument.fire({ uri: source, getText: () => assert.fail('paused saves must not read text') });
  assert.equal(controller.pendingReads.size, 0);
  await mock.commands.get('codexLiveFollow.resume')();
  assert.equal(controller.snapshots.get(source.toString()), 'saved while paused');
  assert.equal(controller.queue.length, 0);
  assert.equal(controller.history.entries.length, 0);
  mock.events.windowState.fire({ focused: false });
  mock.write(source, 'next real edit');
  await settleRead(controller);
  assert.equal(controller.queue[0].before, 'saved while paused');
  await mock.commands.get('codexLiveFollow.pause')();
  assert.equal(controller.watchers.length, 0);
  assert.equal(controller.snapshots.size, 0);
  assert.equal(controller.history.entries.length, 1, 'explicit recent history survives pause');
  const stoppedReads = reads;
  mock.write(source, 'another paused edit');
  assert.equal(controller.pendingReads.size, 0);
  assert.equal(reads, stoppedReads);
});

test('oversized user saves cancel obsolete replay without reading or hashing the model', async t => {
  const { mock, controller } = fixture(t, { config: { maxFileSizeKB: 16 } });
  const uri = mock.uri('oversized.txt');
  mock.put(uri, 'old');
  await controller.start();
  mock.events.windowState.fire({ focused: false });
  mock.write(uri, 'pending edit');
  await settleRead(controller);
  assert.equal(controller.queue.length, 1);
  mock.events.saveDocument.fire({ uri, lineCount: 1, offsetAt: () => 32 * 1024 * 1024,
    getText: () => assert.fail('oversized save cannot assemble full text') });
  assert.equal(controller.queue.length, 0);
  assert.equal(controller.savedByEditor.size, 0);
});

test('excluded folders and files cannot consume the startup source-file allowance', async t => {
  const { mock, controller } = fixture(t, { config: { enabled: false,
    excludeDirectories: ['generated'], excludeGlobs: ['**/*.map', 'ignored/**'] } });
  for (let i = 0; i < 1200; i++) {
    mock.put(mock.uri(`generated/file-${i}.js`), 'excluded directory');
    mock.put(mock.uri(`ignored/file-${i}.js`), 'excluded glob directory');
    mock.put(mock.uri(`file-${i}.map`), 'excluded file');
  }
  const source = mock.uri('src/main.js');
  mock.put(source, 'existing source');
  const visited = [];
  const readDirectory = mock.vscode.workspace.fs.readDirectory;
  mock.vscode.workspace.fs.readDirectory = async uri => { visited.push(uri.path); return readDirectory(uri); };
  await controller.start();
  assert.equal(controller.snapshots.get(source.toString()), 'existing source');
  assert.equal(controller.snapshots.size, 1);
  assert.ok(!visited.includes('/workspace/generated'));
  assert.ok(!visited.includes('/workspace/ignored'));
});

test('a parent-folder deletion drops child snapshots, debounce entries, and queued jobs', async t => {
  const { mock, controller } = fixture(t);
  const first = mock.uri('nested/first.js');
  const second = mock.uri('nested/second.js');
  const sibling = mock.uri('nested-other/keep.js');
  for (const uri of [first, second, sibling]) mock.put(uri, 'before');
  await controller.start();
  mock.events.windowState.fire({ focused: false });
  mock.write(first, 'queued edit');
  await settleRead(controller);
  mock.write(second, 'debounced edit');
  mock.files.delete(first.toString());
  mock.files.delete(second.toString());
  mock.remove(mock.uri('nested'));
  assert.equal(controller.pendingReads.size, 0);
  assert.equal(controller.queue.length, 0);
  assert.equal(controller.snapshots.size, 1);
  assert.equal(controller.trackedBytes, Buffer.byteLength('before'));
  assert.equal(controller.snapshots.get(sibling.toString()), 'before');
  assert.equal(controller.revisions.size, 0);
});

test('a parent-folder deletion invalidates a child bootstrap read already in flight', async t => {
  const { mock, controller } = fixture(t, { config: { enabled: false } });
  const source = mock.uri('removed/child.js');
  mock.put(source, 'stale source');
  const gate = deferred();
  let reading = false;
  mock.hooks.readFile = () => { reading = true; return gate.promise; };
  const starting = controller.start();
  await until(() => reading);
  mock.files.delete(source.toString());
  mock.remove(mock.uri('removed'));
  gate.resolve(Buffer.from('stale source'));
  await starting;
  assert.equal(controller.snapshots.size, 0);
  assert.equal(controller.revisions.size, 0);
  assert.equal(controller.scanning.size, 0);
});

test('configuration changes pause and resume the controller', async t => {
  const { mock, controller } = fixture(t);
  await controller.start();
  await mock.configure('enabled', false);
  assert.equal(controller.enabled, false);
  await mock.configure('enabled', true);
  assert.equal(controller.enabled, true);
});

test('disposal during bootstrap cannot install a live watcher afterward', async t => {
  const { mock, controller } = fixture(t);
  const files = deferred();
  mock.hooks.readDirectory = () => files.promise;
  const starting = controller.start();
  controller.dispose();
  files.resolve([]);
  await starting;
  assert.equal(mock.watchers.filter(watcher => !watcher.disposed).length, 0);
  assert.equal(controller.snapshots.size, 0);
});

test('overlapping workspace resets leave exactly one watcher set', async t => {
  const { mock, controller } = fixture(t);
  const firstFiles = deferred();
  const secondFiles = deferred();
  let searches = 0;
  mock.hooks.readDirectory = () => ++searches === 1 ? firstFiles.promise : secondFiles.promise;
  const first = controller.resetWorkspace();
  const second = controller.resetWorkspace();
  secondFiles.resolve([]);
  await second;
  firstFiles.resolve([]);
  await first;
  assert.equal(mock.watchers.filter(watcher => !watcher.disposed).length, 1);
});

test('removing the last workspace during bootstrap leaves no watcher or snapshot', async t => {
  const { mock, controller } = fixture(t);
  const files = deferred();
  mock.hooks.readDirectory = () => files.promise;
  const first = controller.resetWorkspace();
  mock.vscode.workspace.workspaceFolders = undefined;
  await controller.resetWorkspace();
  files.resolve([]);
  await first;
  assert.equal(mock.watchers.filter(watcher => !watcher.disposed).length, 0);
  assert.equal(controller.snapshots.size, 0);
});

test('an older asynchronous read cannot overwrite a newer file revision', async t => {
  const { mock, controller } = fixture(t, { config: { enabled: false } });
  const uri = mock.uri('race.js');
  mock.put(uri, 'original');
  await controller.start();
  const olderRead = deferred();
  let reads = 0;
  mock.hooks.readFile = async () => {
    if (++reads === 1) return olderRead.promise;
    return Buffer.from('newest');
  };
  mock.write(uri, 'older');
  await until(() => reads === 1, 'first file read did not start');
  mock.write(uri, 'newest');
  await until(() => controller.snapshots.get(uri.toString()) === 'newest', 'new revision was not recorded');
  olderRead.resolve(Buffer.from('older'));
  await tick();
  assert.equal(controller.snapshots.get(uri.toString()), 'newest');
});

test('a file change during bootstrap is observed and its snapshot stays current', async t => {
  const { mock, controller } = fixture(t, { config: { enabled: false } });
  const uri = mock.uri('bootstrap.js');
  mock.put(uri, 'original');
  const originalRead = deferred();
  let reads = 0;
  mock.hooks.readFile = async () => {
    if (++reads === 1) return originalRead.promise;
    return Buffer.from('written during bootstrap');
  };
  const starting = controller.start();
  await until(() => reads === 1, 'bootstrap read did not start');
  mock.write(uri, 'written during bootstrap');
  await until(() => controller.snapshots.get(uri.toString()) === 'written during bootstrap',
    'watcher missed a write during bootstrap');
  originalRead.resolve(Buffer.from('original'));
  await starting;
  assert.equal(controller.snapshots.get(uri.toString()), 'written during bootstrap');
});

test('deleting a file invalidates a read already in flight', async t => {
  const { mock, controller } = fixture(t);
  const uri = mock.uri('deleted.js');
  mock.put(uri, 'before');
  await controller.start();
  const reading = deferred();
  let readStarted = false;
  mock.hooks.readFile = async () => { readStarted = true; return reading.promise; };
  mock.write(uri, 'after');
  await until(() => readStarted, 'file read did not start');
  mock.files.delete(uri.toString());
  for (const watcher of mock.watchers) {
    if (!watcher.disposed) watcher.remove.fire(uri);
  }
  reading.resolve(Buffer.from('after'));
  await tick();
  assert.equal(controller.snapshots.has(uri.toString()), false);
  assert.equal(controller.queue.length, 0);
  assert.equal(mock.shown.length, 0);
});

test('deleting a file during bootstrap does not restore its stale snapshot', async t => {
  const { mock, controller } = fixture(t);
  const uri = mock.uri('bootstrap-delete.js');
  mock.put(uri, 'deleted content');
  const reading = deferred();
  let readStarted = false;
  mock.hooks.readFile = async () => { readStarted = true; return reading.promise; };
  const starting = controller.start();
  await until(() => readStarted, 'bootstrap read did not start');
  mock.remove(uri);
  reading.resolve(Buffer.from('deleted content'));
  await starting;
  assert.equal(controller.snapshots.has(uri.toString()), false);
  assert.equal(controller.revisions.size, 0);
});

test('read and delete bursts release per-file revision bookkeeping', async t => {
  const { mock, controller } = fixture(t, { config: { enabled: false } });
  await controller.start();
  const uris = Array.from({ length: 150 }, (_, index) => mock.uri(`burst-${index}.js`));
  for (const uri of uris) mock.write(uri, 'first content', true);
  await settleRead(controller);
  assert.equal(controller.snapshots.size, uris.length);
  assert.equal(controller.revisions.size, 0);
  assert.equal(controller.reading.size, 0);

  for (const uri of uris) {
    mock.write(uri, 'content pending when deleted');
    mock.remove(uri);
  }
  await settleRead(controller);
  assert.equal(controller.pendingReads.size, 0);
  assert.equal(controller.snapshots.size, 0);
  assert.equal(controller.revisions.size, 0);
  assert.equal(controller.reading.size, 0);
});

test('pausing while a document opens prevents a late editor change', async t => {
  const { mock, controller } = fixture(t, { config: { mode: 'follow' } });
  const uri = mock.uri('paused.js');
  mock.put(uri, 'before');
  await controller.start();
  const opening = deferred();
  let openStarted = false;
  mock.hooks.openTextDocument = async () => { openStarted = true; await opening.promise; };
  mock.write(uri, 'after');
  await until(() => openStarted, 'changed document did not start opening');
  await mock.configure('enabled', false);
  opening.resolve();
  await until(() => !controller.playing, 'paused display did not finish');
  assert.equal(mock.shown.length, 0);
});

test('typing emits partial and complete text then cleans up its virtual document', async t => {
  const { mock, controller } = fixture(t);
  await controller.start();
  const uri = mock.uri('typing.js');
  const content = 'const color = "green";\nconsole.log(color);\n';
  mock.write(uri, content, true);
  await until(() => mock.frames.some(frame => frame.text === content), 'typing never reached the saved text');
  await until(() => !controller.playing, 'typing job did not finish');
  assert.ok(mock.frames.some(frame => frame.text.length > 0 && frame.text !== content));
  assert.equal(mock.shown.at(-1).document.uri.toString(), uri.toString());
  assert.equal(controller.replayContents.size, 0);
  assert.ok(mock.vscode.window.tabGroups.all.every(group =>
    group.tabs.every(tab => tab.input.uri.scheme !== 'codex-live-follow')));
});

test('pausing midway through typing cleans up the partial virtual editor', async t => {
  const { mock, controller } = fixture(t);
  await controller.start();
  const uri = mock.uri('long.js');
  mock.write(uri, 'const value = 1;\n'.repeat(100), true);
  await until(() => mock.frames.length > 0, 'typing never started');
  await mock.configure('enabled', false);
  await until(() => !controller.playing, 'paused typing job did not finish');
  assert.equal(controller.replayContents.size, 0);
  assert.ok(mock.vscode.window.tabGroups.all.every(group =>
    group.tabs.every(tab => tab.input.uri.scheme !== 'codex-live-follow')));
  assert.equal(controller.quietUntil, 0, 'closing an owned preview must not count as user activity');
});

test('queued saves of the same file coalesce to the latest contents', async t => {
  const { mock, controller } = fixture(t);
  await controller.start();
  const active = mock.uri('active.js');
  const queued = mock.uri('queued.js');
  mock.write(active, 'const value = 1;\n'.repeat(100), true);
  await until(() => mock.frames.length > 0, 'initial replay did not start');
  mock.write(queued, 'const queued = "first";\n', true);
  await until(() => controller.queue.some(job => job.uri.toString() === queued.toString()),
    'first queued write was not recorded');
  const latest = 'const queued = "latest";\n';
  mock.write(queued, latest);
  await until(() => controller.queue.some(job => job.uri.toString() === queued.toString() && job.after === latest),
    'latest queued write was not recorded');
  assert.equal(controller.queue.filter(job => job.uri.toString() === queued.toString()).length, 1);
  await until(() => mock.frames.some(frame => frame.uri.path === queued.path && frame.text === latest),
    'latest queued contents were not replayed', 4000);
  await until(() => !controller.playing, 'coalesced replay did not finish');
});

test('external changes do not replace a dirty editor with playback', async t => {
  const { mock, controller } = fixture(t);
  const uri = mock.uri('dirty.js');
  mock.put(uri, 'saved');
  await controller.start();
  const document = await mock.vscode.workspace.openTextDocument(uri);
  document.isDirty = true;
  document.text = 'my unsaved work';
  mock.write(uri, 'external update');
  await settleRead(controller);
  assert.equal(document.text, 'my unsaved work');
  assert.equal(mock.shown.length, 0);
  assert.equal(controller.queue.length, 0);
});

test('an editor save updates the snapshot without replaying the user’s own edit', async t => {
  const { mock, controller } = fixture(t);
  const uri = mock.uri('my-edit.js');
  mock.put(uri, 'before');
  await controller.start();
  const document = await mock.vscode.workspace.openTextDocument(uri);
  document.text = 'my saved edit';
  document.version++;
  mock.events.saveDocument.fire(document);
  mock.write(uri, document.getText());
  await settleRead(controller);
  assert.equal(controller.snapshots.get(uri.toString()), 'my saved edit');
  assert.equal(mock.shown.length, 0);
  assert.equal(controller.queue.length, 0);
});

test('a user save replaces a queued external edit before following resumes from idle', async t => {
  const { mock, controller } = fixture(t, { config: { idleDelayMs: 500 } });
  const uri = mock.uri('saved-over-queued.js');
  mock.put(uri, 'original');
  await controller.start();
  controller.userActivity();
  mock.write(uri, 'external edit waiting to replay');
  await until(() => controller.queue.length === 1, 'external edit was not queued while waiting');
  const document = await mock.vscode.workspace.openTextDocument(uri);
  document.text = 'my saved replacement';
  document.isDirty = true;
  mock.events.changeDocument.fire({ document, contentChanges: [{ text: document.text }] });
  document.isDirty = false;
  mock.events.saveDocument.fire(document);
  mock.write(uri, document.getText());
  await settleRead(controller);
  await until(() => !controller.isWaiting(), 'controller did not return from idle');
  await tick();
  assert.equal(controller.snapshots.get(uri.toString()), 'my saved replacement');
  assert.equal(controller.queue.length, 0);
  assert.equal(controller.playing, false);
  assert.equal(mock.frames.length, 0);
  assert.equal(mock.shown.length, 0);
});

test('writes wait in the background and play when the window regains focus', async t => {
  const { mock, controller } = fixture(t, { config: { mode: 'follow' } });
  await controller.start();
  const uri = mock.uri('background.js');
  mock.events.windowState.fire({ focused: false });
  mock.write(uri, 'const queued = true;\n', true);
  await settleRead(controller);
  assert.equal(controller.queue.length, 1);
  assert.equal(mock.shown.length, 0);
  assert.equal(controller.isWaiting(), true);
  mock.events.windowState.fire({ focused: true });
  await until(() => mock.shown.length === 1, 'background edit did not resume');
  await until(() => !controller.playing, 'resumed edit did not finish');
  assert.equal(mock.shown[0].document.uri.toString(), uri.toString());
  assert.equal(controller.queue.length, 0);
});

test('own editor transitions do not interrupt replay while a sidebar has focus', async t => {
  const { mock, controller } = fixture(t);
  await controller.start();
  mock.hooks.showTextDocument = () => mock.events.activeEditor.fire(undefined);
  const uri = mock.uri('sidebar-focus.js');
  const text = 'const smallIdea = "Make something good";\n'.repeat(12);
  mock.write(uri, text, true);
  await until(() => mock.frames.some(frame => frame.text.length > 0 && frame.text.length < text.length),
    'sidebar focus interrupted opening the replay');
  // The host can deliver its editor-change event after showTextDocument resolves.
  mock.events.activeEditor.fire(mock.shown.at(-1).editor);
  await until(() => !controller.playing, 'replay did not complete');
  assert.ok(mock.frames.some(frame => frame.text === text), 'replay must finish typing');
  assert.equal(mock.shown.at(-1).document.uri.toString(), uri.toString());
  assert.equal(controller.quietUntil, 0);
});

test('user navigation cancels playback while retaining the selected file', async t => {
  const { mock, controller } = fixture(t);
  const destination = mock.uri('my-work.js');
  mock.put(destination, 'const myWork = true;\n');
  await controller.start();
  const animated = mock.uri('animated.js');
  mock.write(animated, 'const value = 1;\n'.repeat(100), true);
  await until(() => mock.frames.length > 0, 'typing did not start');
  const document = await mock.vscode.workspace.openTextDocument(destination);
  await mock.vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
  await until(() => !controller.playing, 'navigation did not stop the replay');
  assert.equal(mock.vscode.window.activeTextEditor.document.uri.toString(), destination.toString());
  assert.equal(mock.shown.at(-1).document.uri.toString(), destination.toString());
  assert.equal(controller.replayContents.size, 0);
  assert.equal(controller.isWaiting(), true);
});

test('user navigation during an asynchronous preview close is still respected', async t => {
  const { mock, controller } = fixture(t);
  const destination = mock.uri('work-during-close.js');
  mock.put(destination, 'const myWork = true;\n');
  await controller.start();
  const animated = mock.uri('closing.js');
  mock.write(animated, 'const value = 1;\n'.repeat(100), true);
  await until(() => mock.frames.length > 0, 'typing did not start');
  const closing = deferred();
  let closeStarted = false;
  mock.hooks.closeTabs = async () => { closeStarted = true; await closing.promise; };
  mock.write(animated, 'const latest = true;\n');
  await until(() => closeStarted, 'superseded preview did not start closing');
  const document = await mock.vscode.workspace.openTextDocument(destination);
  await mock.vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
  closing.resolve();
  await until(() => !controller.playing, 'preview close did not finish');
  assert.equal(controller.isWaiting(), true, 'genuine navigation was mistaken for owned tab cleanup');
  assert.equal(mock.vscode.window.activeTextEditor.document.uri.toString(), destination.toString());
});

test('the resume command does not cancel the queued replay it just started', async t => {
  const { mock, controller } = fixture(t);
  await controller.start();
  controller.userActivity();
  const uri = mock.uri('resume-queued.js');
  mock.write(uri, 'const queued = true;\n', true);
  await until(() => controller.queue.length === 1, 'write was not queued while waiting');
  const opening = deferred();
  mock.hooks.openTextDocument = () => opening.promise;
  await mock.commands.get('codexLiveFollow.resume')();
  opening.resolve();
  await until(() => !controller.playing, 'resumed replay did not finish');
  assert.ok(mock.shown.some(item => item.document.uri.toString() === uri.toString()),
    'resuming must display the queued file');
  assert.equal(controller.queue.length, 0);
});

test('superseding an active replay does not confuse owned tab closure with navigation', async t => {
  const { mock, controller } = fixture(t);
  await controller.start();
  const uri = mock.uri('superseded.js');
  mock.write(uri, 'const value = 1;\n'.repeat(100), true);
  await until(() => mock.frames.length > 0, 'typing did not start');
  const latest = 'const latest = true;\n';
  mock.write(uri, latest);
  await until(() => mock.shown.some(item => item.document.uri.toString() === uri.toString()),
    'newest revision was delayed by false user activity');
  await until(() => !controller.playing, 'newest replay did not finish');
  assert.equal(mock.shown.at(-1).document.getText(), latest);
  assert.equal(controller.quietUntil, 0);
});

test('changing excluded directories removes old snapshots and ignores subsequent writes', async t => {
  const { mock, controller } = fixture(t, { config: { enabled: false } });
  const source = mock.uri('src/main.js');
  const generated = mock.uri('generated/bundle.js');
  mock.put(source, 'source');
  mock.put(generated, 'generated');
  await controller.start();
  assert.equal(controller.snapshots.has(generated.toString()), true);
  await mock.configure('excludeDirectories', ['generated']);
  await until(() => !controller.initializing, 'exclusion rescan did not finish');
  assert.equal(controller.snapshots.has(generated.toString()), false);
  mock.write(generated, 'ignored update');
  mock.write(source, 'source update');
  await settleRead(controller);
  assert.equal(controller.snapshots.has(generated.toString()), false);
  assert.equal(controller.snapshots.get(source.toString()), 'source update');
});

test('the pending queue drops older files when its count limit is reached', async t => {
  const { mock, controller } = fixture(t);
  await controller.start();
  mock.events.windowState.fire({ focused: false });
  const uris = Array.from({ length: 20 }, (_, index) => mock.uri(`queued-${index}.js`));
  for (const uri of uris) mock.write(uri, 'const pending = true;\n', true);
  await settleRead(controller);
  assert.equal(controller.queue.length, 12);
  assert.equal(controller.getState().skipped, 8);
  assert.equal(controller.getState().recent.filter(entry => entry.skipped).length, 8);
  assert.deepEqual(controller.queue.map(job => job.uri.toString()), uris.slice(-12).map(uri => uri.toString()));
  assert.equal(mock.shown.length, 0);
});

test('the pending queue is bounded by bytes as well as file count', async t => {
  const { mock, controller } = fixture(t, { config: { maxFileSizeKB: 4096 } });
  const uris = Array.from({ length: 10 }, (_, index) => mock.uri(`large-${index}.js`));
  const before = 'a'.repeat(512 * 1024);
  const after = 'b'.repeat(512 * 1024);
  for (const uri of uris) mock.put(uri, before);
  await controller.start();
  mock.events.windowState.fire({ focused: false });
  for (const uri of uris) mock.write(uri, after);
  await settleRead(controller);
  assert.ok(controller.queue.length < uris.length);
  assert.ok(controller.queue.reduce((bytes, job) => bytes + job.bytes, 0) <= 8 * 1024 * 1024);
  assert.equal(controller.queue.at(-1).uri.toString(), uris.at(-1).toString());
});

test('separated typing frames retain untouched code between edits', async t => {
  const { mock, controller } = fixture(t, { config: { typingCharsPerSecond: 20 } });
  const uri = mock.uri('blocks.js');
  const middle = '// unchanged middle stays visible\n';
  const before = 'const a = 1;\n' + middle + 'const b = 2;\n';
  const after = 'const a = 1234;\n' + middle + 'const b = 5678;\n';
  mock.put(uri, before);
  await controller.start();
  mock.write(uri, after);
  await until(() => mock.frames.some(frame => frame.text === after), 'multi-block edit completes');
  assert.ok(mock.frames.length > 2);
  assert.ok(mock.frames.every(frame => frame.text.includes(middle)));
  assert.equal(mock.files.get(uri.toString()).content, after);
});

test('recent replay stays read-only and does not restore an older source revision', async t => {
  const { mock, controller } = fixture(t);
  const uri = mock.uri('history.js');
  mock.put(uri, 'const value = 1;\n');
  await controller.start();
  mock.write(uri, 'const value = 2;\n');
  await until(() => controller.history.entries.length === 1 && !controller.playing, 'first edit completes');
  const old = controller.getState().recent[0].id;
  mock.write(uri, 'const value = 3;\n');
  await until(() => controller.history.entries.length === 2 && !controller.playing, 'new edit completes');
  const priorShown = mock.shown.length;
  const priorFrames = mock.frames.length;
  await mock.commands.get('codexLiveFollow.replayRecent')(old);
  await until(() => mock.frames.length > priorFrames && !controller.playing, 'old edit replays');
  assert.equal(mock.files.get(uri.toString()).content, 'const value = 3;\n');
  assert.ok(mock.shown.slice(priorShown).every(item => item.document.uri.scheme === 'codex-live-follow'));
  assert.ok(mock.frames.slice(priorFrames).some(frame => frame.text === 'const value = 2;\n'));
  assert.equal(controller.history.entries.length, 2);
  mock.events.windowState.fire({ focused: false });
  await mock.commands.get('codexLiveFollow.replayRecent')(old);
  mock.write(uri, 'const value = 4;\n');
  await settleRead(controller);
  assert.equal(controller.queue[0].historical, undefined);
  assert.equal(controller.queue[0].before, 'const value = 3;\n',
    'an external save uses the latest disk baseline, not a queued old replay');
  await mock.commands.get('codexLiveFollow.clearRecent')();
  assert.equal(controller.getState().recent.length, 0);
});

test('ignore menu adds a literal exclusion and clears pending playback of that file', async t => {
  const { mock, controller } = fixture(t);
  const uri = mock.uri('ignore-me.js');
  mock.put(uri, 'before');
  await controller.start();
  mock.events.windowState.fire({ focused: false });
  mock.write(uri, 'after');
  await settleRead(controller);
  assert.equal(controller.queue.length, 1);
  await mock.commands.get('codexLiveFollow.ignore')(uri);
  await until(() => !controller.initializing, 'ignore rescan completes');
  assert.deepEqual(mock.config.excludeGlobs, ['ignore-me.js']);
  assert.equal(controller.queue.length, 0);
  mock.write(uri, 'another change');
  assert.equal(controller.pendingReads.size, 0);
  assert.equal(controller.snapshots.has(uri.toString()), false);
});

test('separate pane is reused and recreated only when its group closes', async t => {
  const { mock, controller } = fixture(t, { config: { mode: 'follow', replayPane: 'beside' } });
  await controller.start();
  const originalShow = mock.vscode.window.showTextDocument;
  mock.vscode.window.showTextDocument = async (...args) => {
    const editor = await originalShow(...args);
    editor.viewColumn = 2;
    return editor;
  };
  mock.vscode.window.tabGroups.all.push({ viewColumn: 2, tabs: [] });
  for (const name of ['one.js', 'two.js']) {
    mock.write(mock.uri(name), 'const x = true;\n', true);
    await until(() => mock.shown.some(item => item.document.uri.path.endsWith(name)) && !controller.playing,
      'separate pane edit completes');
  }
  assert.equal(mock.shown[0].options.viewColumn, mock.vscode.ViewColumn.Beside);
  assert.equal(mock.shown[1].options.viewColumn, 2);
  mock.vscode.window.tabGroups.all.pop();
  mock.write(mock.uri('three.js'), 'const x = true;\n', true);
  await until(() => mock.shown.length === 3, 'closed pane is recreated');
  assert.equal(mock.shown[2].options.viewColumn, mock.vscode.ViewColumn.Beside);
});

test('changing speed affects the running replay in both directions without jumping ahead', async t => {
  const { mock, controller } = fixture(t, {
    config: { typingCharsPerSecond: 20, maxReplayDurationMs: 5000 }
  });
  await controller.start();
  const uri = mock.uri('speed.js');
  mock.write(uri, 'x'.repeat(2000), true);
  await until(() => mock.frames.some(frame => frame.text.length > 0), 'slow replay starts');
  const sample = async () => {
    const started = Date.now();
    const before = controller.currentJob.displayedText.length;
    await new Promise(resolve => setTimeout(resolve, 300));
    return { chars: controller.currentJob.displayedText.length - before, elapsed: Date.now() - started };
  };
  const slow = await sample();
  assert.ok(slow.chars <= Math.ceil(slow.elapsed * 20 / 1000) + 3, 'time limit cannot override slow speed');
  controller.previewSpeed(400);
  const fast = await sample();
  assert.ok(fast.chars >= 60, 'dragging faster changes this replay');
  assert.ok(fast.chars <= Math.ceil(fast.elapsed * 400 / 1000) + 25, 'changing speed never recalculates past time');
  await controller.setSetting('typingCharsPerSecond', 400);
  assert.equal(controller.liveSpeed, undefined, 'releasing the slider commits its value');
  await mock.configure('typingCharsPerSecond', 20);
  const slowerAgain = await sample();
  assert.ok(slowerAgain.chars <= Math.ceil(slowerAgain.elapsed * 20 / 1000) + 3, 'slowing down affects this replay too');
  assert.equal(mock.files.get(uri.toString()).content.length, 2000);
  await mock.commands.get('codexLiveFollow.skipReplay')();
  await until(() => !controller.playing, 'speed test replay cleans up');
});

test('long slow replay finishes at its deadline instead of increasing typing speed', async t => {
  const { mock, controller } = fixture(t, {
    config: { typingCharsPerSecond: 20, maxReplayDurationMs: 1000 }
  });
  await controller.start();
  const uri = mock.uri('deadline.js');
  const source = 'x'.repeat(2000);
  mock.write(uri, source, true);
  await until(() => mock.frames.some(frame => frame.text.length > 0), 'deadline replay starts');
  await until(() => !controller.playing, 'slow replay respects its time limit');
  const partial = mock.frames.filter(frame => frame.text.length < source.length);
  assert.ok(partial.length > 5);
  assert.ok(partial.every(frame => frame.text.length <= 21), 'animation keeps the selected rate until the deadline');
  assert.ok(mock.frames.some(frame => frame.text === source), 'deadline shows complete saved content');
  assert.equal(controller.replayContents.size, 0);
  assert.equal(mock.files.get(uri.toString()).content, source);
});

test('skip stops visiting further blocks in changed-lines mode', async t => {
  const { mock, controller } = fixture(t, { config: { mode: 'follow', minimumDisplayMs: 500 } });
  const uri = mock.uri('skip-blocks.js');
  mock.put(uri, 'old-a\nkeep-a\nold-b\nkeep-b\nold-c\n');
  await controller.start();
  mock.write(uri, 'new-a\nkeep-a\nnew-b\nkeep-b\nnew-c\n');
  await until(() => mock.shown.length === 1, 'first changed block appears');
  await mock.commands.get('codexLiveFollow.skipReplay')();
  await until(() => !controller.playing, 'skipped job finishes');
  assert.equal(mock.shown.length, 1, 'skip must not visit the remaining blocks');
});

for (const mode of ['follow', 'typing']) test(`navigation during a pending ${mode} display survives its late completion`, async t => {
  const { mock, controller } = fixture(t, { config: { mode } });
  const source = mock.uri('late-display.js');
  const firstChoice = mock.uri('first-choice.js');
  const latestChoice = mock.uri('latest-choice.js');
  for (const uri of [source, firstChoice, latestChoice]) mock.put(uri, 'before\n');
  await controller.start();
  const showing = deferred();
  t.after(() => showing.resolve());
  let started = false;
  mock.hooks.showTextDocument = async document => {
    if (document.uri.toString() === source.toString()) { started = true; await showing.promise; }
  };
  mock.write(source, 'after\n');
  await until(() => started, 'display request starts');
  for (const uri of [firstChoice, latestChoice]) {
    const document = await mock.vscode.workspace.openTextDocument(uri);
    await mock.vscode.window.showTextDocument(document, { preview: false });
  }
  assert.equal(controller.currentJob.cancelled, true);
  showing.resolve();
  await until(() => !controller.playing, 'cancelled display finishes');
  assert.equal(mock.vscode.window.activeTextEditor.document.uri.toString(), latestChoice.toString());
  assert.equal(controller.isWaiting(), true);
});

test('new navigation during a late-display repair wins over the earlier choice', async t => {
  const { mock, controller } = fixture(t, { config: { mode: 'follow' } });
  const source = mock.uri('repair-source.js');
  const first = mock.uri('repair-first.js');
  const latest = mock.uri('repair-latest.js');
  for (const uri of [source, first, latest]) mock.put(uri, 'before');
  await controller.start();
  const showing = deferred();
  const restoring = deferred();
  t.after(() => { showing.resolve(); restoring.resolve(); });
  let started = false;
  let repairing = false;
  let firstShows = 0;
  mock.hooks.showTextDocument = async document => {
    if (document.uri.toString() === source.toString()) { started = true; await showing.promise; }
    if (document.uri.toString() === first.toString() && ++firstShows === 2) {
      repairing = true;
      await restoring.promise;
    }
  };
  mock.write(source, 'after');
  await until(() => started);
  await mock.vscode.window.showTextDocument(await mock.vscode.workspace.openTextDocument(first), { preview: false });
  showing.resolve();
  await until(() => repairing, 'repair starts');
  await mock.vscode.window.showTextDocument(await mock.vscode.workspace.openTextDocument(latest), { preview: false });
  restoring.resolve();
  await until(() => !controller.playing);
  assert.equal(mock.vscode.window.activeTextEditor.document.uri.toString(), latest.toString());
});

test('manual pause during a pending display keeps the previous editor while the sidebar has focus', async t => {
  const { mock, controller } = fixture(t, { config: { mode: 'follow' } });
  const source = mock.uri('pause-late.js');
  const previous = mock.uri('previous-editor.js');
  for (const uri of [source, previous]) mock.put(uri, 'before');
  await controller.start();
  await mock.vscode.window.showTextDocument(await mock.vscode.workspace.openTextDocument(previous));
  mock.vscode.window.activeTextEditor = undefined;
  controller.quietUntil = 0;
  const showing = deferred();
  t.after(() => showing.resolve());
  let started = false;
  mock.hooks.showTextDocument = async document => {
    if (document.uri.toString() === source.toString()) { started = true; await showing.promise; }
  };
  mock.write(source, 'after');
  await until(() => started);
  await mock.configure('enabled', false);
  showing.resolve();
  await until(() => !controller.playing);
  assert.equal(mock.vscode.window.activeTextEditor.document.uri.toString(), previous.toString());
  assert.equal(controller.enabled, false);
});

test('write bursts bound concurrent reads and keep the newest queued revision', async t => {
  const { mock, controller } = fixture(t, { config: { enabled: false } });
  await controller.start();
  const gate = deferred();
  t.after(() => gate.resolve());
  let active = 0;
  let peak = 0;
  let started = 0;
  mock.hooks.readFile = async uri => {
    active++;
    started++;
    peak = Math.max(peak, active);
    await gate.promise;
    active--;
    return Buffer.from(mock.files.get(uri.toString()).content);
  };
  const uris = Array.from({ length: 40 }, (_, i) => mock.uri(`bounded-${i}.js`));
  for (const uri of uris) mock.write(uri, 'first', true);
  await until(() => started >= 8, 'read workers start');
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(started, 8, 'extra reads wait for a worker');
  for (let i = 0; i < 5; i++) mock.write(uris.at(-1), `revision-${i}`);
  await until(() => controller.pendingReads.size === 0);
  gate.resolve();
  await settleRead(controller);
  assert.equal(peak, 8);
  assert.equal(started, uris.length, 'obsolete queued revisions never read the file');
  assert.equal(controller.snapshots.get(uris.at(-1).toString()), 'revision-4');
});

test('a rescan drops waiting reads while in-flight reads still share its limit', async t => {
  const { mock, controller } = fixture(t, { config: { enabled: false } });
  await controller.start();
  const gate = deferred();
  t.after(() => gate.resolve());
  let active = 0;
  let peak = 0;
  const started = [];
  mock.hooks.readFile = async uri => {
    active++;
    peak = Math.max(peak, active);
    started.push(uri.toString());
    await gate.promise;
    active--;
    return Buffer.from('latest');
  };
  for (let i = 0; i < 30; i++) mock.write(mock.uri(`old-scan-${i}.js`), 'old', true);
  await until(() => started.length >= 8);
  await until(() => controller.pendingReads.size === 0);
  const source = mock.uri('new-scan.js');
  mock.put(source, 'latest');
  mock.hooks.readDirectory = () => [['new-scan.js', mock.vscode.FileType.File]];
  const resetting = controller.resetWorkspace();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(started.length, 8, 'reset must not start another eight reads');
  gate.resolve();
  await resetting;
  assert.equal(peak, 8);
  assert.equal(started.length, 9, 'obsolete waiting reads are discarded');
  assert.deepEqual([...controller.snapshots.keys()], [source.toString()]);
});

test('disposal releases queued readers without starting more I/O', async t => {
  const { mock, controller } = fixture(t, { config: { enabled: false } });
  await controller.start();
  const gate = deferred();
  t.after(() => gate.resolve());
  let started = 0;
  mock.hooks.readFile = async () => { started++; await gate.promise; return Buffer.from('source'); };
  for (let i = 0; i < 30; i++) mock.write(mock.uri(`dispose-read-${i}.js`), 'source', true);
  await until(() => started >= 8);
  await until(() => controller.pendingReads.size === 0);
  controller.dispose();
  gate.resolve();
  await until(() => controller.readPool.active === 0);
  assert.equal(started, 8);
  assert.equal(controller.readPool.pending.size, 0);
  assert.equal(controller.snapshots.size, 0);
});

test('large documents refresh less often without changing the selected typing rate', async t => {
  const { mock, controller } = fixture(t, {
    config: { typingCharsPerSecond: 20, maxReplayDurationMs: 1000 }
  });
  const uri = mock.uri('large-frame.js');
  const head = 'a'.repeat(500000) + '\n';
  mock.put(uri, head + 'old\n');
  await controller.start();
  const after = head + 'z'.repeat(100) + '\n';
  mock.write(uri, after);
  await until(() => controller.history.entries.length === 1 && !controller.playing, 'large replay finishes');
  const partial = mock.frames.filter(frame => frame.text.includes('z') && frame.text !== after);
  assert.ok(partial.length > 1, 'large files still animate');
  assert.ok(partial.length <= 8, 'large files must not refresh at 20 frames per second');
  assert.ok(partial.every(frame => frame.text.match(/z/g).length <= 21), 'refresh cadence must not increase typing speed');
  assert.ok(mock.frames.some(frame => frame.text === after));
  assert.equal(mock.files.get(uri.toString()).content, after);
});

test('a stalled watcher backlog remains bounded and reports dropped saves', async t => {
  const { mock, controller } = fixture(t, { config: { enabled: false } });
  await controller.start();
  const gate = deferred();
  t.after(() => gate.resolve());
  let started = 0;
  mock.hooks.readFile = async uri => {
    started++;
    await gate.promise;
    return Buffer.from(mock.files.get(uri.toString()).content);
  };
  for (let i = 0; i < 270; i++) mock.write(mock.uri(`backlog-${i}.js`), 'latest', true);
  await until(() => controller.pendingReads.size === 0 && controller.skipped > 0);
  assert.equal(started, 8);
  assert.equal(controller.readPool.pending.size, 248);
  assert.equal(controller.skipped, 14, 'the debounce stage drops saves before allocating read requests');
  for (let i = 270; i < 280; i++) mock.write(mock.uri(`backlog-${i}.js`), 'latest', true);
  await until(() => controller.pendingReads.size === 0 && controller.skipped === 16);
  assert.equal(controller.readPool.pending.size, 256, 'later batches still obey the separate read-pool bound');
  gate.resolve();
  await settleRead(controller);
  assert.equal(controller.readPool.pending.size, 0);
  assert.equal(controller.snapshots.get(mock.uri('backlog-279.js').toString()), 'latest');
});

for (const [empty, speed] of [[false, 400], [true, 20]]) test(`Test Specter runs while paused at ${speed} chars/s${empty ? ' without a project' : ''} and leaves files and settings alone`, async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
  const advance = async ms => {
    for (let elapsed = 0; elapsed < ms;) {
      const step = Math.min(50, ms - elapsed);
      t.mock.timers.tick(step);
      elapsed += step;
      await tick();
    }
  };
  const { mock, controller } = fixture(t, { config: {
    enabled: false, mode: 'follow', typingCharsPerSecond: speed, inspectionDisplayMs: 300, maxReplayCharacters: 100
  } });
  const source = mock.uri('unchanged.js');
  mock.put(source, 'real source');
  if (empty) mock.vscode.workspace.workspaceFolders = [];
  await controller.start();
  const settings = { ...mock.config };
  const files = [...mock.files.values()].map(file => [file.uri.toString(), file.content]);
  const snapshots = [...controller.snapshots];
  await mock.commands.get('codexLiveFollow.testSpecter')();
  const demo = controller.demoJob;
  await mock.commands.get('codexLiveFollow.testSpecter')();
  assert.equal(controller.demoJob, demo, 'repeated clicks cannot queue extra demos');
  await tick();
  await advance(29500);
  assert.equal(controller.getState().status, 'playing', 'demo keeps typing even with a one-second normal replay limit');
  assert.equal(controller.getState().progress, 98, 'demo progress follows elapsed time');
  assert.notEqual(controller.currentJob.displayedText, demo.after, 'enough sample text remains at the selected speed');
  for (let elapsed = 0; controller.getState().status !== 'inspecting' && elapsed < 1500; elapsed += 50) {
    await advance(50);
  }
  assert.equal(controller.getState().title, 'testing a line inspection');
  assert.equal(controller.getState().line, 2);
  assert.equal(mock.shown.at(-1).editor.revealed.start.line, 1);
  assert.ok(mock.frames.some(frame => frame.text.includes('specter is working')));
  assert.ok(mock.shown.every(item => item.document.uri.scheme === 'codex-live-follow'));
  await advance(4999);
  assert.equal(controller.getState().status, 'inspecting', 'sample inspection stays visible for five seconds');
  await advance(1);
  assert.equal(controller.playing, false);
  assert.equal(controller.getState().testing, false);
  assert.equal(mock.shown.length, 2, 'one typing preview and one inspection preview');
  assert.equal(controller.enabled, false);
  assert.equal(controller.replayContents.size, 0);
  assert.equal(controller.history.entries.length, 0);
  assert.deepEqual(mock.config, settings);
  assert.deepEqual([...controller.snapshots], snapshots);
  assert.deepEqual([...mock.files.values()].map(file => [file.uri.toString(), file.content]), files);
});

test('Skip and Pause stop a demo and close its read-only previews', async t => {
  const { mock, controller } = fixture(t, { config: { enabled: false, typingCharsPerSecond: 20 } });
  await controller.start();
  for (const command of ['skipReplay', 'pause']) {
    const shown = mock.shown.length;
    await mock.commands.get('codexLiveFollow.testSpecter')();
    await until(() => mock.shown.length > shown && controller.currentJob?.progress > 0);
    await mock.commands.get(`codexLiveFollow.${command}`)();
    await until(() => !controller.playing && !controller.demoJob);
    assert.equal(mock.shown.length, shown + 1, 'stopping typing must not start the sample inspection');
    assert.equal(controller.replayContents.size, 0);
    assert.equal(controller.enabled, false);
  }
});
