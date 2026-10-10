'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function until(check, description, timeout = 10000, diagnostics = () => '') {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${description}${diagnostics()}`);
}

async function run() {
  const manifest = require('../package.json');
  const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
  assert.ok(extension, 'development extension is installed');
  const api = await extension.activate();
  assert.equal(api.getState().enabled, false, 'fresh projects must wait for the user to enable following');
  await vscode.commands.executeCommand('codexLiveFollow.resume');
  assert.equal(api.getState().enabled, true, 'the project choice enables following');
  console.log('PASS fresh-profile first-use pause and explicit project enable');
  const config = vscode.workspace.getConfiguration('codexLiveFollow');
  for (const [key, value] of Object.entries({
    enabled: true, pauseOnInteraction: true, pauseWhenUnfocused: false, idleDelayMs: 500,
    ignoreEditorSaves: true, typingCharsPerSecond: 400, maxReplayDurationMs: 1000,
    minimumDisplayMs: 100, inspectionDisplayMs: 10000, mode: 'typing', replayPane: 'beside'
  })) await config.update(key, value, vscode.ConfigurationTarget.Workspace);
  const startingDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(__dirname, '..', 'src', 'extension.js')));
  await vscode.window.showTextDocument(startingDocument, { preview: false });
  await vscode.commands.executeCommand('codexLiveFollow.controls');
  await until(() => api.areControlsReady(), 'sidebar HTML and scripts connect to the extension');
  assert.ok((await vscode.commands.getCommands(true)).includes('codexLiveFollow.sidebar.focus'));
  console.log('PASS dedicated Specter sidebar opens in the real host');
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  await config.update('typingCharsPerSecond', 60, vscode.ConfigurationTarget.Workspace);
  await vscode.commands.executeCommand('codexLiveFollow.pause');
  const demoSettings = await fs.readFile(path.join(root, '.vscode', 'settings.json'), 'utf8');
  const demoFiles = await fs.readdir(root);
  const demoFrames = [];
  const demoSubscription = vscode.workspace.onDidChangeTextDocument(event => {
    if (event.document.uri.scheme === 'codex-live-follow' && event.document.uri.path.endsWith('/specter-test.js')) {
      demoFrames.push(event.document.getText().replace(/\r\n/g, '\n'));
    }
  });
  try {
    const demoStarted = Date.now();
    await vscode.commands.executeCommand('codexLiveFollow.testSpecter');
    assert.equal(api.getState().testing, true);
    const sampleInspectionVisible = () => vscode.window.visibleTextEditors.some(editor =>
      editor.document.uri.scheme === 'codex-live-follow' &&
      editor.document.uri.path.endsWith('/specter-test.js') &&
      editor.document.uri.query.startsWith('history=') &&
      editor.document.getText().includes('specter is working'));
    await until(() => api.getState().status === 'inspecting' && api.getState().line === 2 && sampleInspectionVisible(),
      '30-second sample typing finishes and a line-2 inspection is displayed', 45000);
    assert.ok(Date.now() - demoStarted >= 30000, 'demo must not finish at the normal one-second replay limit');
    assert.ok(demoFrames.some(frame => frame.includes('"S') && !frame.includes('console.log(item.label);')),
      `sample generates partial typing frames even while paused; observed ${JSON.stringify(demoFrames)}`);
    assert.ok(demoFrames.some(frame => frame.includes('specter is working')));
    await vscode.commands.executeCommand('codexLiveFollow.skipReplay');
    await until(() => !api.getState().testing && !vscode.window.tabGroups.all.some(group =>
      group.tabs.some(tab => tab.input?.uri?.scheme === 'codex-live-follow')), 'sample tabs close after Skip');
    assert.equal(api.getState().enabled, false);
    assert.equal(api.getState().recent.length, 0);
    assert.equal(await fs.readFile(path.join(root, '.vscode', 'settings.json'), 'utf8'), demoSettings);
    assert.deepEqual(await fs.readdir(root), demoFiles);
    console.log('PASS Test Specter while paused: typing, line inspection, Skip cleanup, files and settings untouched');
  } finally {
    demoSubscription.dispose();
    await config.update('typingCharsPerSecond', 400, vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('codexLiveFollow.resume');
  }
  const source = vscode.Uri.file(path.join(root, 'live-follow-host-test.js'));
  const frames = [];
  const subscription = vscode.workspace.onDidChangeTextDocument(event => {
    if (event.document.uri.scheme === 'codex-live-follow' && event.document.uri.path === source.path) {
      frames.push(event.document.getText());
    }
  });
  const previewTabs = () => vscode.window.tabGroups.all.flatMap(group => group.tabs)
    .filter(tab => tab.input?.uri?.scheme === 'codex-live-follow');
  try {
    const text = Array.from({ length: 30 }, (_, i) => `const message${i} = 'Hello from the real VS Code host';`).join('\n') + '\n';
    await fs.writeFile(source.fsPath, text);
    await until(() => frames.some(frame => frame.length > 0 && frame.length < text.length), 'partial typing frame');
    assert.equal(await fs.readFile(source.fsPath, 'utf8'), text, 'animation does not rewrite the real source');
    // VS Code normalizes virtual models to the host's EOL; disk bytes remain exact.
    await until(() => frames.some(frame => frame.replace(/\r\n/g, '\n') === text) && previewTabs().length === 0 &&
      vscode.window.visibleTextEditors.some(editor => editor.document.uri.toString() === source.toString()),
    'complete replay, source reveal, and virtual tab cleanup', 10000, () => JSON.stringify({
      state: api.getState(), frameCount: frames.length,
      finalFrameLength: frames.at(-1)?.length, expectedLength: text.length,
      finalFrameUsesCRLF: frames.at(-1)?.includes('\r\n'),
      visibleEditors: vscode.window.visibleTextEditors.map(editor => editor.document.uri.toString()),
      source: source.toString(), replayTabs: previewTabs().length
    }));
    console.log('PASS real watcher → virtual typing frames → real file; disk untouched');
    assert.equal(vscode.window.tabGroups.all.length, 2, 'one separate pane is created');
    assert.ok(vscode.window.visibleTextEditors.some(editor =>
      editor.document.uri.toString() === startingDocument.uri.toString()), 'original file remains visible');
    const editedLines = text.split('\n');
    editedLines[2] += ' // first change';
    editedLines[25] += ' // second change';
    const updated = editedLines.join('\n');
    const editFrameStart = frames.length;
    await fs.writeFile(source.fsPath, updated);
    await until(() => frames.slice(editFrameStart).some(frame => frame.replace(/\r\n/g, '\n') === updated) &&
      previewTabs().length === 0 && api.getState().status === 'watching', 'separated edit replay completes');
    assert.ok(frames.slice(editFrameStart).every(frame => frame.includes(editedLines[10])),
      'unchanged middle stays in every frame');
    assert.equal(vscode.window.tabGroups.all.length, 2, 'separate pane is reused');
    const oldId = api.getState().recent.at(-1).id;
    const historicalFrames = frames.length;
    await vscode.commands.executeCommand('codexLiveFollow.replayRecent', oldId);
    await until(() => frames.slice(historicalFrames).some(frame => frame.replace(/\r\n/g, '\n') === text) &&
      previewTabs().length === 0 && api.getState().status === 'watching', 'historical replay completes');
    assert.equal(await fs.readFile(source.fsPath, 'utf8'), updated, 'old replay never restores disk');
    await vscode.commands.executeCommand('codexLiveFollow.clearRecent');
    assert.equal(api.getState().recent.length, 0);
    console.log('PASS separate pane, separated blocks, and read-only recent replay');

    const skipSource = vscode.Uri.file(path.join(root, 'skip-blocks-host-test.txt'));
    await config.update('mode', 'follow', vscode.ConfigurationTarget.Workspace);
    await config.update('minimumDisplayMs', 500, vscode.ConfigurationTarget.Workspace);
    const skipLines = Array.from({ length: 400 }, (_, i) => `unchanged line ${i + 1}`);
    await fs.writeFile(skipSource.fsPath, skipLines.join('\n'));
    await until(() => api.getState().recent.some(entry => entry.file.endsWith('skip-blocks-host-test.txt')) &&
      api.getState().status === 'watching', 'changed-lines baseline finishes');
    for (const line of [79, 199, 319]) skipLines[line] = `changed line ${line + 1}`;
    await fs.writeFile(skipSource.fsPath, skipLines.join('\n'));
    const firstBlockVisible = () => vscode.window.visibleTextEditors.some(editor =>
      editor.document.uri.toString() === skipSource.toString() &&
      editor.visibleRanges.some(range => range.start.line <= 79 && range.end.line >= 79));
    await until(() => api.getState().status === 'playing' && firstBlockVisible(), 'first changed block is visible');
    await vscode.commands.executeCommand('codexLiveFollow.skipReplay');
    await until(() => api.getState().status === 'watching', 'changed-lines skip completes');
    assert.ok(firstBlockVisible(), 'skip must not scroll to the later changed blocks');
    await config.update('mode', 'typing', vscode.ConfigurationTarget.Workspace);
    await config.update('minimumDisplayMs', 100, vscode.ConfigurationTarget.Workspace);
    console.log('PASS Skip stops further changed-line visits in the real host');

    const largeSource = vscode.Uri.file(path.join(root, 'large-frame-host-test.txt'));
    const largeHead = 'a'.repeat(500000) + '\n';
    await fs.writeFile(largeSource.fsPath, largeHead + 'old\n');
    await until(() => api.getState().recent.some(entry => entry.file.endsWith('large-frame-host-test.txt')) &&
      api.getState().status === 'watching', 'large-file baseline finishes');
    const largeFrames = [];
    const largeSubscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.scheme === 'codex-live-follow' && event.document.uri.path === largeSource.path) {
        largeFrames.push(event.document.getText().replace(/\r\n/g, '\n'));
      }
    });
    try {
      await config.update('typingCharsPerSecond', 20, vscode.ConfigurationTarget.Workspace);
      const largeAfter = largeHead + 'z'.repeat(100) + '\n';
      await fs.writeFile(largeSource.fsPath, largeAfter);
      await until(() => largeFrames.includes(largeAfter) && previewTabs().length === 0 &&
        api.getState().status === 'watching', 'large-file typing respects its deadline');
      const partial = largeFrames.filter(frame => frame.includes('z') && frame !== largeAfter);
      assert.ok(partial.length > 1 && partial.length <= 8, 'large files use fewer full-document refreshes');
      assert.ok(partial.every(frame => frame.match(/z/g).length <= 21), 'cadence cannot increase typing speed');
      assert.equal(await fs.readFile(largeSource.fsPath, 'utf8'), largeAfter);
      console.log('PASS large-document refresh cadence, selected speed, and deadline; disk untouched');
    } finally {
      largeSubscription.dispose();
      await config.update('typingCharsPerSecond', 400, vscode.ConfigurationTarget.Workspace);
    }

    const speedSource = vscode.Uri.file(path.join(root, 'speed-host-test.txt'));
    const speedFrames = [];
    const speedSubscription = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.scheme === 'codex-live-follow' && event.document.uri.path === speedSource.path) {
        speedFrames.push(event.document.getText().length);
      }
    });
    try {
      await config.update('maxReplayDurationMs', 5000, vscode.ConfigurationTarget.Workspace);
      await config.update('typingCharsPerSecond', 20, vscode.ConfigurationTarget.Workspace);
      await fs.writeFile(speedSource.fsPath, 'x'.repeat(2000));
      await until(() => speedFrames.some(length => length > 0), 'slow speed replay starts');
      const sample = async () => {
        const started = Date.now();
        const before = speedFrames.at(-1);
        await new Promise(resolve => setTimeout(resolve, 350));
        return { chars: speedFrames.at(-1) - before, elapsed: Date.now() - started };
      };
      const slow = await sample();
      assert.ok(slow.chars <= Math.ceil(slow.elapsed * 20 / 1000) + 25, 'slow speed is honored for a large edit');
      await config.update('typingCharsPerSecond', 400, vscode.ConfigurationTarget.Workspace);
      const fast = await sample();
      assert.ok(fast.chars >= 70, 'increasing speed changes the same running replay');
      assert.ok(fast.chars <= Math.ceil(fast.elapsed * 400 / 1000) + 25, 'speed change does not jump through past time');
      await config.update('typingCharsPerSecond', 20, vscode.ConfigurationTarget.Workspace);
      const slowerAgain = await sample();
      assert.ok(slowerAgain.chars <= Math.ceil(slowerAgain.elapsed * 20 / 1000) + 25,
        'decreasing speed changes the same running replay');
      await vscode.commands.executeCommand('codexLiveFollow.skipReplay');
      await until(() => previewTabs().length === 0 && api.getState().status === 'watching', 'speed test cleanup');
      assert.equal(await fs.readFile(speedSource.fsPath, 'utf8'), 'x'.repeat(2000));
      console.log('PASS slow → fast → slow speed changes during one real replay; disk untouched');
    } finally {
      speedSubscription.dispose();
      await config.update('typingCharsPerSecond', 400, vscode.ConfigurationTarget.Workspace);
      await config.update('maxReplayDurationMs', 1000, vscode.ConfigurationTarget.Workspace);
    }

    const activity = path.join(root, '.codex-live-follow', 'activity.json');
    await fs.mkdir(path.dirname(activity), { recursive: true });
    const beforeInspection = frames.length;
    await fs.writeFile(activity, JSON.stringify({ id: 'host-inspection',
      path: path.basename(source.fsPath), line: 20,
      message: 'Inspecting a real source line', phase: 'suspect' }));
    await until(() => api.getState().status === 'inspecting' && api.getState().line === 20,
      'local inspection report reaches the real sidebar', 10000,
      () => JSON.stringify({ state: api.getState(),
        visibleEditors: vscode.window.visibleTextEditors.map(editor => editor.document.uri.toString()) }));
    await until(() => vscode.window.visibleTextEditors.some(editor =>
      editor.document.uri.toString() === source.toString() &&
      editor.visibleRanges.some(range => range.start.line <= 19 && range.end.line >= 19)),
    'reported line is visible in the real editor');
    assert.equal(frames.length, beforeInspection, 'inspections do not type or modify source');
    assert.equal(await fs.readFile(source.fsPath, 'utf8'), updated);
    await vscode.commands.executeCommand('codexLiveFollow.skipReplay');
    await until(() => api.getState().status === 'watching', 'inspection skips promptly');
    console.log('PASS local inspection → real source line and sidebar; source untouched');

    await vscode.commands.executeCommand('codexLiveFollow.pause');
    assert.equal(vscode.workspace.getConfiguration('codexLiveFollow').get('enabled'), false);
    const priorFrames = frames.length;
    const pausedText = updated + '// saved while following is paused\n';
    await fs.writeFile(source.fsPath, pausedText);
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(frames.length, priorFrames, 'paused file writes do not replay');
    await vscode.commands.executeCommand('codexLiveFollow.resume');
    assert.equal(vscode.workspace.getConfiguration('codexLiveFollow').get('enabled'), true);
    const next = pausedText + '// A longer update to verify cancelling an active replay.\n'.repeat(40);
    await fs.writeFile(source.fsPath, next);
    await until(() => frames.length > priorFrames && previewTabs().length > 0, 'second replay starts');
    await vscode.commands.executeCommand('codexLiveFollow.pause');
    await until(() => previewTabs().length === 0, 'pause removes incomplete virtual tab');
    assert.equal(await fs.readFile(source.fsPath, 'utf8'), next);
    console.log('PASS pause/resume commands and cancellation cleanup');

    await vscode.commands.executeCommand('codexLiveFollow.resume');
    const document = await vscode.workspace.openTextDocument(source);
    const editor = await vscode.window.showTextDocument(document, { preview: false });
    await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '// unsaved user edit\n'));
    assert.ok(document.isDirty);
    const beforeDirtyWrite = frames.length;
    await fs.writeFile(source.fsPath, next + '// external write while editor is dirty\n');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.ok(document.isDirty, 'external writes preserve unsaved edits');
    assert.equal(frames.length, beforeDirtyWrite, 'dirty file never becomes replay');
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '// saved by the user\n'));
    await document.save();
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(frames.length, beforeDirtyWrite, 'normal editor saves do not replay');
    console.log('PASS dirty-editor protection and editor-save suppression');
    const ignored = vscode.Uri.file(path.join(root, 'ignored.js'));
    await fs.writeFile(ignored.fsPath, '// baseline\n');
    await new Promise(resolve => setTimeout(resolve, 400));
    await vscode.commands.executeCommand('codexLiveFollow.ignore', ignored);
    await until(() => api.getState().status !== 'preparing', 'ignore rule rescans the project');
    assert.ok(vscode.workspace.getConfiguration('codexLiveFollow', ignored).get('excludeGlobs').includes('ignored.js'));
    const beforeIgnored = api.getState().recent.length;
    await fs.writeFile(ignored.fsPath, '// ignored update\n');
    await new Promise(resolve => setTimeout(resolve, 350));
    assert.equal(api.getState().recent.length, beforeIgnored, 'ignored writes do not enter recent edits');
    assert.ok(await fs.readFile(path.join(extension.extensionPath, 'src', 'inspection-helper.js'), 'utf8'));
    console.log('PASS real ignore command and packaged inspection helper');
  } finally {
    subscription.dispose();
    await vscode.commands.executeCommand('codexLiveFollow.pause');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }
  if (process.env.SPECTER_PROFILE_DIR) {
    await require('./profile').runProfile(vscode, api, extension, process.env.SPECTER_PROFILE_DIR);
  }
}

module.exports = { run };
