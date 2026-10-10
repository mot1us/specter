'use strict';

const { randomBytes } = require('node:crypto');

const VIEW_ID = 'codexLiveFollow.sidebar';
const BOOLEAN_SETTINGS = new Set([
  'enabled', 'pauseOnInteraction', 'pauseWhenUnfocused', 'ignoreEditorSaves', 'suspendWhenPaused'
]);

class FollowSidebar {
  constructor(vscode, context, controller) {
    this.api = vscode;
    this.context = context;
    this.controller = controller;
    const version = context.extension?.packageJSON?.version ?? require('../package.json').version;
    this.version = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version) ? version : 'unknown';
    this.disposables = [controller.onDidChangeState(() => this.publish())];
    this.viewDisposables = [];
    this.disposed = false;
    this.ready = false;
  }

  resolveWebviewView(view) {
    if (this.disposed) return;
    this.clearView();
    this.view = view;
    view.title = `specter v${this.version}`;
    const assets = this.api.Uri.joinPath(this.context.extensionUri, 'assets');
    view.webview.options = { enableScripts: true, localResourceRoots: [assets] };
    this.viewDisposables.push(
      view.webview.onDidReceiveMessage(message => {
        void this.handleMessage(message).catch(error => {
          this.controller.log(`sidebar action failed: ${String(error)}`);
          if (this.view === view) void view.webview.postMessage({
            type: 'error', message: 'could not update the controls. check the logs.'
          });
        });
      }),
      view.onDidChangeVisibility(() => {
        if (!view.visible) { this.ready = false; this.controller.clearSpeedPreview(); }
        this.lastState = undefined;
        this.publish();
      }),
      view.onDidDispose(() => { if (this.view === view) this.clearView(); })
    );
    view.webview.html = this.html(view.webview, assets);
  }

  async open() {
    await this.api.commands.executeCommand(`${VIEW_ID}.focus`);
  }

  async handleMessage(message) {
    if (this.disposed || !message || typeof message !== 'object') return;
    if (message.type === 'ready') {
      this.ready = true;
      this.lastState = undefined;
      this.publish();
      return;
    }
    if (message.type === 'speedPreview') {
      this.controller.previewSpeed(message.value);
      return;
    }
    if (message.type === 'setting') {
      const { key, value } = message;
      const valid = (BOOLEAN_SETTINGS.has(key) && typeof value === 'boolean') ||
        (key === 'mode' && (value === 'typing' || value === 'follow')) ||
        (key === 'replayPane' && (value === 'current' || value === 'beside')) ||
        (key === 'typingCharsPerSecond' && typeof value === 'number' &&
          Number.isFinite(value) && value >= 20 && value <= 400);
      if (!valid) return;
      if (key === 'enabled') {
        await this.api.commands.executeCommand(`codexLiveFollow.${value ? 'resume' : 'pause'}`);
      } else await this.controller.setSetting(key, value);
    } else if (message.type === 'action') {
      if (message.action === 'skip') await this.api.commands.executeCommand('codexLiveFollow.skipReplay');
      else if (message.action === 'output') await this.api.commands.executeCommand('codexLiveFollow.showOutput');
      else if (message.action === 'settings') await this.api.commands.executeCommand('codexLiveFollow.settings');
      else if (message.action === 'setup') await this.api.commands.executeCommand('codexLiveFollow.setupInspection');
      else if (message.action === 'test') await this.api.commands.executeCommand('codexLiveFollow.testSpecter');
      else if (message.action === 'clear') await this.api.commands.executeCommand('codexLiveFollow.clearRecent');
      else if (message.action === 'replay' && typeof message.id === 'string' && /^\d{1,16}$/.test(message.id)) {
        await this.api.commands.executeCommand('codexLiveFollow.replayRecent', message.id);
      }
      else return;
    } else return;
    this.publish();
  }

  publish() {
    if (this.disposed || !this.view?.visible) return;
    const state = this.controller.getState();
    const signature = JSON.stringify(state);
    if (signature === this.lastState) return;
    this.lastState = signature;
    void this.view.webview.postMessage({ type: 'state', state }).then(undefined, () => {
      this.lastState = undefined;
    });
  }

  html(webview, assets) {
    const nonce = randomBytes(18).toString('base64');
    const css = webview.asWebviewUri(this.api.Uri.joinPath(assets, 'sidebar.css'));
    const script = webview.asWebviewUri(this.api.Uri.joinPath(assets, 'sidebar.js'));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${css}">
  <title>specter v${this.version}</title>
</head>
<body>
  <main>
    <header class="intro">
      <h1>specter <span class="version">v${this.version}</span></h1>
      <span class="beta">beta</span>
    </header>

    <section class="status-card" aria-labelledby="status-title" data-status="preparing">
      <div class="status-heading"><span class="status-dot" aria-hidden="true"></span><h2 id="status-title" role="status">starting…</h2></div>
      <p id="status-detail">getting ready.</p>
      <p id="current-file" class="file" hidden></p>
      <progress id="progress" max="100" value="0" aria-label="typing replay progress" hidden></progress>
      <div class="queue-row"><span id="queue">nothing queued</span><button id="skip" class="text-button" disabled>skip</button></div>
      <p id="skipped" class="hint skipped" aria-live="polite"></p>
    </section>

    <section class="controls" aria-label="playback controls">
      <div class="toggle-row"><label for="enabled" class="control-label">replay saved edits</label><input id="enabled" type="checkbox" role="switch" disabled></div>
      <div class="field"><label class="control-label" for="mode">display</label><select id="mode" disabled><option value="typing">typing</option><option value="follow">changed lines</option></select></div>
      <div class="field"><label class="control-label" for="replayPane">pane</label><select id="replayPane" disabled><option value="current">current</option><option value="beside">beside my code</option></select></div>
      <div class="field speed-field"><div class="label-row"><label class="control-label" for="speed">speed</label><output id="speed-value" for="speed">120 chars/s</output></div><input id="speed" type="range" min="20" max="400" step="1" value="120" aria-describedby="speed-hint" disabled><p id="speed-hint" class="hint">updates during replay</p></div>
      <button id="test" class="secondary-button" title="30 seconds of typing, then a 5-second inspection. works while paused." disabled>test specter</button>
    </section>

    <details class="preferences">
      <summary id="preferences-title">preferences</summary>
      <label class="check-row"><input id="pauseOnInteraction" type="checkbox" disabled><span>pause while i edit</span></label>
      <label class="check-row"><input id="pauseWhenUnfocused" type="checkbox" disabled><span>wait while this window is in the background</span></label>
      <label class="check-row"><input id="ignoreEditorSaves" type="checkbox" disabled><span>skip my saves</span></label>
      <label class="check-row"><input id="suspendWhenPaused" type="checkbox" disabled><span>stop watching when paused</span></label>
    </details>

    <p id="error" role="alert" hidden></p>
    <section class="recent" aria-labelledby="recent-title">
      <div class="label-row"><h2 id="recent-title">recent edits</h2><button id="clear" class="text-button" disabled>clear</button></div>
      <p id="recent-empty" class="hint">nothing yet</p>
      <ul id="recent-list" aria-label="recent saved edits"></ul>
    </section>
    <details class="inspections">
      <summary id="inspection-title">agent inspections</summary>
      <p class="hint">see the lines your agent checks. adds a helper and project instructions after review.</p>
      <button id="setup" class="secondary-button">set up inspections</button>
    </details>
    <footer><div class="footer-actions"><button id="settings" class="text-button">settings</button><button id="output" class="text-button">logs</button></div><p id="settings-scope">saved for this project</p></footer>
  </main>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  clearView() {
    this.controller.clearSpeedPreview();
    this.ready = false;
    this.view = undefined;
    this.lastState = undefined;
    for (const disposable of this.viewDisposables) disposable.dispose();
    this.viewDisposables = [];
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearView();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables = [];
  }
}

module.exports = { FollowSidebar, VIEW_ID };
