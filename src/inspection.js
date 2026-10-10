'use strict';

const ACTIVITY_PATH = '.codex-live-follow/activity.json';
const MAX_BYTES = 16384;

function parseInspection(text) {
  const event = JSON.parse(text);
  if (!event || typeof event !== 'object' || Array.isArray(event) ||
    typeof event.id !== 'string' || !event.id.length || event.id.length > 128 ||
    typeof event.path !== 'string' || event.path.length > 1024 ||
    !event.path.length || /[\\:\x00-\x1f]/.test(event.path) ||
    event.path.split('/').some(part => !part || part === '.' || part === '..') ||
    !Number.isSafeInteger(event.line) || event.line < 1 ||
    (event.endLine !== undefined && (!Number.isSafeInteger(event.endLine) || event.endLine < event.line)) ||
    typeof event.message !== 'string' || event.message.length > 500 ||
    !['inspect', 'suspect'].includes(event.phase ?? 'inspect')) return undefined;
  return { ...event, endLine: event.endLine ?? event.line, phase: event.phase ?? 'inspect' };
}

// Reports are explicit local file writes; reading a source file alone emits no event.
class InspectionFeed {
  constructor(api, report) {
    this.api = api;
    this.report = report;
    this.pending = new Map();
    this.revisions = new Map();
    this.seen = new Map();
    this.serial = 0;
  }

  folderFor(uri) {
    const folder = this.api.workspace.getWorkspaceFolder(uri);
    // Native watchers can coalesce creation of a directory and its first file.
    // Either notification should read the one supported report path.
    return folder && [ACTIVITY_PATH, '.codex-live-follow'].some(relative =>
      this.api.Uri.joinPath(folder.uri, relative).toString() === uri.toString())
      ? folder : undefined;
  }

  schedule(uri, generation) {
    const folder = this.folderFor(uri);
    if (!folder) return false;
    uri = this.api.Uri.joinPath(folder.uri, ACTIVITY_PATH);
    const key = uri.toString();
    const revision = ++this.serial;
    this.revisions.set(key, revision);
    clearTimeout(this.pending.get(key));
    this.pending.set(key, setTimeout(() => {
      this.pending.delete(key);
      void this.read(uri, folder, key, revision, generation);
    }, 40));
    return true;
  }

  async read(uri, folder, key, revision, generation) {
    try {
      const stat = await this.api.workspace.fs.stat(uri);
      if (!(stat.type & this.api.FileType.File) ||
        (stat.type & this.api.FileType.SymbolicLink) || stat.size > MAX_BYTES) return;
      const bytes = await this.api.workspace.fs.readFile(uri);
      if (bytes.byteLength > MAX_BYTES || this.revisions.get(key) !== revision) return;
      const event = parseInspection(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      if (!event || this.seen.get(key) === event.id) return;
      this.seen.set(key, event.id);
      const target = this.api.Uri.joinPath(folder.uri, event.path);
      // Recheck the accepted report after the target's asynchronous source read.
      // Repeated filesystem notifications for the same ID do not supersede it.
      await this.report({ ...event, uri: target, generation }, () => this.seen.get(key) === event.id);
    } catch { /* Incomplete, invalid, or deleted reports are ignored. */ }
  }

  reset() {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    this.revisions.clear();
    this.seen.clear();
  }

  dispose() { this.reset(); }
}

module.exports = { InspectionFeed, parseInspection, ACTIVITY_PATH };
