'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { LiveFollow } = require('../src/controller');
const { createVscodeMock, deferred, until } = require('./helpers/vscode');

function fixture(t, options = {}) {
  const mock = createVscodeMock({ explicitSettings: false, ...options });
  const controller = new LiveFollow(mock.vscode, mock.context);
  t.after(() => { controller.dispose(); mock.dispose(); });
  return { mock, controller };
}

test('a fresh project stays paused until the user enables following', async t => {
  const { mock, controller } = fixture(t);
  const choice = deferred();
  mock.hooks.showInformationMessage = () => choice.promise;
  await controller.start();
  await until(() => mock.informationMessages.length === 1);
  mock.write(mock.uri('before.js'), 'const before = true;', true);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(controller.enabled, false);
  assert.equal(mock.shown.length, 0);
  choice.resolve('enable for this project');
  await until(() => controller.enabled);
  assert.equal(mock.workspaceValues.get('followDecision'), true);
  mock.write(mock.uri('after.js'), 'const after = true;', true);
  await until(() => mock.shown.length > 0);
  assert.match(mock.shown[0].document.uri.path, /after.js$/);
});

test('keeping a project paused is remembered and the sidebar can enable it later', async t => {
  const { mock, controller } = fixture(t, { firstUseChoice: 'keep paused' });
  await controller.start();
  await until(() => !controller.promptPending);
  assert.equal(controller.enabled, false);
  assert.equal(mock.workspaceValues.get('followDecision'), false);
  await controller.askFirstUse();
  assert.equal(mock.informationMessages.length, 1);
  await mock.commands.get('codexLiveFollow.resume')();
  assert.equal(controller.enabled, true);
  await controller.askFirstUse();
  assert.equal(mock.informationMessages.length, 1);
});

test('an existing project setting preserves the prototype user choice without prompting', async t => {
  for (const enabled of [true, false]) {
    const { mock, controller } = fixture(t, { explicitSettings: true, config: { enabled } });
    await controller.start();
    assert.equal(controller.enabled, enabled);
    assert.equal(mock.informationMessages.length, 0);
  }
});

test('remembered project consent respects a global pause', async t => {
  const { mock, controller } = fixture(t, {
    workspaceState: { followDecision: true }, config: { enabled: false }
  });
  await controller.start();
  assert.equal(controller.enabled, false);
  assert.equal(mock.informationMessages.length, 0);
});

test('a dismissed invitation remains paused after the controller is recreated', async t => {
  const { mock, controller } = fixture(t);
  await controller.start();
  await until(() => !controller.promptPending);
  controller.dispose();
  const reloaded = new LiveFollow(mock.vscode, mock.context);
  t.after(() => reloaded.dispose());
  await reloaded.start();
  assert.equal(reloaded.enabled, false);
  assert.equal(mock.informationMessages.length, 1);
});

test('a late first-use response cannot enable a disposed controller', async t => {
  const { mock, controller } = fixture(t);
  const choice = deferred();
  mock.hooks.showInformationMessage = () => choice.promise;
  await controller.start();
  await until(() => mock.informationMessages.length === 1);
  controller.dispose();
  choice.resolve('enable for this project');
  await until(() => !controller.promptPending);
  assert.equal(mock.workspaceValues.get('followDecision'), false);
  assert.equal(mock.config.enabled, true, 'the default was not changed by a stale response');
});
