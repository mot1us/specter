'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { LiveFollow } = require('../src/controller');
const { VIEW_ID } = require('../src/sidebar');
const { createVscodeMock, until } = require('./helpers/vscode');

async function setup(t, version) {
  const mock = createVscodeMock();
  if (version !== undefined) mock.context.extension = { packageJSON: { version } };
  const controller = new LiveFollow(mock.vscode, mock.context);
  t.after(() => { controller.dispose(); mock.dispose(); });
  await controller.start();
  const messages = [];
  const received = new mock.vscode.EventEmitter();
  const visibility = new mock.vscode.EventEmitter();
  const disposed = new mock.vscode.EventEmitter();
  const view = {
    visible: true,
    onDidChangeVisibility: visibility.event,
    onDidDispose: disposed.event,
    webview: {
      cspSource: 'vscode-webview://test',
      asWebviewUri: uri => uri.toString(),
      onDidReceiveMessage: received.event,
      async postMessage(message) { messages.push(message); return true; }
    }
  };
  const sidebar = mock.viewProviders.get(VIEW_ID);
  assert.ok(sidebar, 'registered sidebar provider');
  sidebar.resolveWebviewView(view);
  await sidebar.handleMessage({ type: 'ready' });
  return { mock, controller, sidebar, view, messages, visibility, disposed };
}

test('the sidebar title and heading use the installed manifest version', async t => {
  const { view } = await setup(t, '1.2.3-beta.4');
  assert.equal(view.title, 'specter v1.2.3-beta.4');
  assert.match(view.webview.html, /<h1>specter <span class="version">v1\.2\.3-beta\.4<\/span>/);
  assert.match(view.webview.html, /<details class="preferences">/);
  assert.match(view.webview.html, /<details class="inspections">/);
  assert.match(view.webview.html, /script-src 'nonce-[^']+'/);
});

test('invalid version metadata cannot insert markup into the sidebar', async t => {
  const { view } = await setup(t, '<script>bad()</script>');
  assert.equal(view.title, 'specter vunknown');
  assert.ok(!view.webview.html.includes('bad()'));
});

test('sidebar controls persist settings and stay in sync with commands and Settings', async t => {
  const { mock, sidebar, messages } = await setup(t);
  assert.equal(messages.at(-1).state.enabled, true);
  await sidebar.handleMessage({ type: 'setting', key: 'enabled', value: false });
  assert.equal(mock.config.enabled, false);
  assert.equal(messages.at(-1).state.status, 'paused');
  await mock.commands.get('codexLiveFollow.resume')();
  assert.equal(messages.at(-1).state.enabled, true);
  await sidebar.handleMessage({ type: 'setting', key: 'mode', value: 'follow' });
  await sidebar.handleMessage({ type: 'setting', key: 'replayPane', value: 'beside' });
  assert.equal(messages.at(-1).state.replayPane, 'beside');
  await sidebar.handleMessage({ type: 'setting', key: 'typingCharsPerSecond', value: 240 });
  await sidebar.handleMessage({ type: 'setting', key: 'pauseOnInteraction', value: false });
  assert.equal(mock.config.mode, 'follow');
  assert.equal(mock.config.typingCharsPerSecond, 240);
  assert.equal(mock.config.pauseOnInteraction, false);
  await mock.configure('typingCharsPerSecond', 60);
  assert.equal(messages.at(-1).state.speed, 60);
});

test('sidebar rejects unknown settings, malformed values, and arbitrary commands', async t => {
  const { mock, sidebar } = await setup(t);
  const before = { ...mock.config };
  for (const message of [
    null, { type: 'setting', key: 'enabled', value: 'false' },
    { type: 'setting', key: 'mode', value: 'execute' },
    { type: 'setting', key: 'replayPane', value: 'execute' },
    { type: 'action', action: 'replay', id: '../source.js' },
    { type: 'setting', key: 'typingCharsPerSecond', value: 401 },
    { type: 'setting', key: 'typingCharsPerSecond', value: NaN },
    { type: 'speedPreview', value: 401 }, { type: 'speedPreview', value: '20' },
    { type: 'setting', key: 'maxFileSizeKB', value: 9999 },
    { type: 'action', action: 'workbench.action.files.save' }
  ]) await sidebar.handleMessage(message);
  assert.deepEqual(mock.config, before);
});

test('slider drag previews speed without settings writes, then release saves it', async t => {
  const { mock, controller, sidebar, messages, view, visibility } = await setup(t);
  await sidebar.handleMessage({ type: 'speedPreview', value: 20 });
  assert.equal(messages.at(-1).state.speed, 20);
  assert.equal(mock.config.typingCharsPerSecond, 400, 'dragging does not write settings on every event');
  await sidebar.handleMessage({ type: 'setting', key: 'typingCharsPerSecond', value: 20 });
  assert.equal(mock.config.typingCharsPerSecond, 20);
  assert.equal(controller.liveSpeed, undefined);
  await sidebar.handleMessage({ type: 'speedPreview', value: 240 });
  view.visible = false;
  visibility.fire();
  assert.equal(controller.typingSpeed(), 20, 'hiding controls clears an uncommitted drag');
});

test('live sidebar tracks typing, skip, queued writes, and background waiting', async t => {
  const { mock, controller, sidebar, messages } = await setup(t);
  const uri = mock.uri('demo.js');
  mock.write(uri, 'console.log("Following a saved edit");\n'.repeat(10), true);
  await until(() => messages.some(message => message.state?.progress > 0), 'sidebar gets real typing progress');
  assert.equal(messages.at(-1).state.file, 'demo.js');
  assert.equal(messages.at(-1).state.canSkip, true);
  await sidebar.handleMessage({ type: 'action', action: 'skip' });
  await until(() => !controller.playing, 'skip finishes the replay');
  assert.equal(messages.at(-1).state.status, 'watching');
  assert.equal(messages.at(-1).state.canSkip, false);
  mock.events.windowState.fire({ focused: false });
  mock.write(mock.uri('queued.js'), 'const queued = true;\n', true);
  await until(() => messages.at(-1).state.pending === 1, 'sidebar reports waiting queue');
  assert.equal(messages.at(-1).state.status, 'waiting');
  assert.match(messages.at(-1).state.title, /window/);
});

test('hidden sidebar stops updates, catches up on reveal, and releases view listeners', async t => {
  const { mock, controller, sidebar, view, messages, visibility, disposed } = await setup(t);
  const prior = messages.length;
  assert.equal(sidebar.ready, true);
  controller.updateStatus();
  assert.equal(messages.length, prior, 'unchanged state is not posted twice');
  view.visible = false;
  visibility.fire();
  assert.equal(sidebar.ready, false);
  await mock.configure('enabled', false);
  assert.equal(messages.length, prior, 'hidden webview gets no updates');
  view.visible = true;
  visibility.fire();
  assert.equal(messages.at(-1).state.enabled, false);
  disposed.fire();
  assert.equal(sidebar.ready, false);
  const after = messages.length;
  await mock.configure('enabled', true);
  assert.equal(messages.length, after);
  assert.equal(visibility.listeners.size, 0);
  sidebar.dispose();
});

test('status bar and Open Controls use the contributed sidebar without a Quick Pick', async t => {
  const { mock, controller } = await setup(t);
  let focused = 0;
  mock.commands.set(`${VIEW_ID}.focus`, () => { focused++; });
  mock.vscode.window.showQuickPick = () => { throw new Error('controls should open the sidebar'); };
  assert.equal(controller.status.command, 'codexLiveFollow.controls');
  await mock.commands.get('codexLiveFollow.controls')();
  await mock.commands.get('codexLiveFollow.openSidebar')();
  assert.equal(focused, 2);
});

test('the Test Specter sidebar action starts a demo while replay stays paused', async t => {
  const { mock, controller, sidebar, messages, view } = await setup(t);
  await mock.configure('enabled', false);
  assert.match(view.webview.html, /id="test"[^>]*>test specter/);
  await sidebar.handleMessage({ type: 'action', action: 'test' });
  assert.equal(controller.enabled, false);
  assert.equal(messages.at(-1).state.testing, true);
  await until(() => controller.currentJob?.progress > 0);
  await sidebar.handleMessage({ type: 'action', action: 'skip' });
  await until(() => !controller.playing);
  assert.equal(messages.at(-1).state.testing, false);
});
