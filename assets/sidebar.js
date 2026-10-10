'use strict';

(() => {
  const api = acquireVsCodeApi();
  const elements = new Map(Array.from(document.querySelectorAll('[id]'), node => [node.id, node]));
  const element = id => elements.get(id);
  const statusCard = document.querySelector('.status-card');
  const update = (id, property, value) => {
    const node = element(id);
    if (node[property] !== value) node[property] = value;
  };
  let latestState;
  const settings = ['enabled', 'pauseOnInteraction', 'pauseWhenUnfocused', 'ignoreEditorSaves', 'suspendWhenPaused'];
  const send = message => {
    element('error').hidden = true;
    api.postMessage(message);
  };
  for (const key of settings) {
    element(key).addEventListener('change', event => {
      send({ type: 'setting', key, value: event.target.checked });
    });
  }
  element('mode').addEventListener('change', event => {
    send({ type: 'setting', key: 'mode', value: event.target.value });
  });
  const speed = element('speed');
  speed.addEventListener('input', () => {
    update('speed-value', 'textContent', `${speed.value} chars/s`);
    send({ type: 'speedPreview', value: Number(speed.value) });
  });
  speed.addEventListener('change', () => {
    send({ type: 'setting', key: 'typingCharsPerSecond', value: Number(speed.value) });
  });
  speed.addEventListener('blur', () => { if (latestState) updateSpeed(latestState); });
  element('replayPane').addEventListener('change', event => {
    send({ type: 'setting', key: 'replayPane', value: event.target.value });
  });
  for (const action of ['skip', 'settings', 'output', 'clear', 'setup', 'test']) {
    element(action).addEventListener('click', () => send({ type: 'action', action }));
  }

  element('recent-list').addEventListener('click', event => {
    const button = event.target.closest('button[data-id]');
    if (button && !button.disabled) send({ type: 'action', action: 'replay', id: button.dataset.id });
  });
  let recentSignature;

  function renderRecent(state) {
    const recent = state.recent || [];
    update('clear', 'disabled', !recent.length && !state.skipped);
    update('recent-empty', 'hidden', recent.length > 0);
    const signature = JSON.stringify([recent, state.enabled]);
    if (signature === recentSignature) return;
    recentSignature = signature;
    const rows = recent.map(entry => {
      const row = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'recent-button';
      button.dataset.id = entry.id;
      button.textContent = entry.file;
      const time = new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase();
      button.title = `replay ${entry.file} (${time})${entry.skipped ? ' — skipped while catching up' : ''}`;
      button.disabled = !state.enabled;
      row.append(button);
      const label = document.createElement('span');
      label.className = 'hint';
      label.textContent = entry.skipped ? 'skipped' : time;
      row.append(label);
      return row;
    });
    element('recent-list').replaceChildren(...rows);
  }

  function updateSpeed(state) {
    update('speed', 'value', String(state.speed));
    update('speed-value', 'textContent', `${state.speed} chars/s`);
  }

  function render(state) {
    latestState = state;
    update('settings-scope', 'textContent', state.configurationScope === 'workspace'
      ? 'saved for this project.' : 'saved in your vs code settings.');
    if (statusCard.dataset.status !== state.status) statusCard.dataset.status = state.status;
    update('status-title', 'textContent', state.title);
    update('status-title', 'title', state.title);
    update('status-detail', 'textContent', state.detail);
    update('status-detail', 'title', state.detail);
    update('current-file', 'hidden', !state.file);
    const location = state.file && state.line ? `${state.file}:${state.line}` : state.file;
    update('current-file', 'textContent', location);
    update('current-file', 'title', location);
    update('queue', 'textContent', state.pending
      ? `${state.pending} ${state.pending === 1 ? 'change' : 'changes'} queued` : 'nothing queued');
    update('skipped', 'textContent', state.skipped
      ? `${state.skipped} skipped while catching up. check recent edits.` : '');
    update('skip', 'disabled', !state.canSkip);
    update('test', 'disabled', state.testing);
    update('test', 'textContent', state.testing ? 'testing…' : 'test specter');
    update('progress', 'hidden', state.progress === null);
    update('progress', 'value', state.progress ?? 0);
    for (const key of settings) {
      update(key, 'checked', state[key]);
      update(key, 'disabled', false);
    }
    update('mode', 'value', state.mode);
    update('mode', 'disabled', false);
    update('replayPane', 'value', state.replayPane);
    update('replayPane', 'disabled', false);
    update('speed', 'disabled', state.mode !== 'typing' && !state.testing);
    if (document.activeElement !== speed) updateSpeed(state);
    renderRecent(state);
  }

  window.addEventListener('message', event => {
    const message = event.data;
    if (message?.type === 'state') render(message.state);
    else if (message?.type === 'error') {
      element('error').textContent = message.message;
      element('error').hidden = false;
    }
  });
  send({ type: 'ready' });
})();
