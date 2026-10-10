'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const HELPER = '.specter/inspect-line.cjs';
const MARKER = '<!-- specter:inspection -->';
const NOTE = `${MARKER}
## specter inspections

during bug investigation, report meaningful file locations so specter can show
the inspection in vs code. from this project root, run:

\`\`\`sh
node ${HELPER} <relative-file> <one-based-line> "what is being checked" [inspect|suspect]
\`\`\`

use a real file and line being inspected. use \`suspect\` only when evidence points
to a possible cause. continue investigating and fixing normally. this reports
local viewer activity; it does not edit source code or use the network.
<!-- /specter:inspection -->
`;

async function readRegular(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`use a regular file: ${file}`);
    if (stat.size > 1024 * 1024) throw new Error(`file is too large to update: ${file}`);
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

// Preflight all paths and preserve existing instructions and ignore rules.
async function prepareSetup(root, helper) {
  const directory = path.join(root, '.specter');
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('.specter must be a regular folder.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const files = ['AGENTS.md', '.gitignore', HELPER];
  const contents = await Promise.all(files.map(file => readRegular(path.join(root, file))));
  if (contents[2] !== undefined && contents[2] !== helper) {
    throw new Error(`an existing ${HELPER} is different. it has been left alone.`);
  }
  const agents = contents[0] ?? '';
  const ignore = contents[1] ?? '';
  const eol = agents.includes('\r\n') ? '\r\n' : '\n';
  const nextAgents = agents.includes(MARKER) ? agents
    : agents + (agents ? (agents.endsWith('\n') ? eol : eol + eol) : '') + NOTE.replace(/\n/g, eol);
  const ignoreEol = ignore.includes('\r\n') ? '\r\n' : '\n';
  const nextIgnore = ignore.split(/\r?\n/).some(line =>
    ['.codex-live-follow/', '/.codex-live-follow/', '.codex-live-follow', '/.codex-live-follow'].includes(line.trim()))
    ? ignore : ignore + (ignore && !ignore.endsWith('\n') ? ignoreEol : '') + '.codex-live-follow/' + ignoreEol;
  return files.map((file, i) => ({ file, before: contents[i], after: [nextAgents, nextIgnore, helper][i] }))
    .filter(change => change.before !== change.after);
}

async function applySetup(root, changes) {
  // Recheck after the user reviews the prompt; a concurrent edit should not be overwritten.
  await prepareDirectory(root);
  for (const change of changes) {
    if (await readRegular(path.join(root, change.file)) !== change.before) {
      throw new Error(`${change.file} changed during setup. run setup again.`);
    }
  }
  const written = [];
  try {
    for (const change of changes) {
      await fs.writeFile(path.join(root, change.file), change.after,
        { flag: change.before === undefined ? 'wx' : 'w' });
      written.push(change);
    }
  } catch (error) {
    // Roll back only our exact bytes, leaving any concurrent edits alone.
    for (const change of written.reverse()) {
      const file = path.join(root, change.file);
      if (await readRegular(file) !== change.after) continue;
      if (change.before === undefined) await fs.unlink(file);
      else await fs.writeFile(file, change.before);
    }
    throw error;
  }
}

async function prepareDirectory(root) {
  const directory = path.join(root, '.specter');
  await fs.mkdir(directory, { recursive: true });
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('.specter must be a regular folder.');
}

async function setupInspection(vscode, context) {
  if (!vscode.workspace.isTrusted) {
    await vscode.window.showInformationMessage('trust this project before setting up inspection instructions.');
    return;
  }
  const folders = (vscode.workspace.workspaceFolders || []).filter(folder => folder.uri.scheme === 'file');
  const folder = folders.length === 1 ? folders[0] : await vscode.window.showQuickPick(
    folders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })),
    { title: 'specter: choose a project' }).then(choice => choice?.folder);
  if (!folder) return;
  const targets = ['AGENTS.md', '.gitignore', HELPER].map(file => vscode.Uri.joinPath(folder.uri, file).toString());
  const dirty = () => vscode.workspace.textDocuments.some(doc => doc.isDirty && targets.includes(doc.uri.toString()));
  if (dirty()) {
    await vscode.window.showInformationMessage('save AGENTS.md, .gitignore, and the inspection helper before setup.');
    return;
  }
  try {
    const helper = Buffer.from(await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(context.extensionUri, 'src', 'inspection-helper.js'))).toString('utf8');
    const root = folder.uri.fsPath;
    const changes = await prepareSetup(root, helper);
    if (!changes.length) {
      await vscode.window.showInformationMessage('inspections are already set up for this project.');
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      `set up inspections in ${folder.name}? adds a local helper and agent instructions. updates: ${changes.map(change => change.file).join(', ')}. requires node.js 18 or newer.`,
      { modal: true }, 'set up');
    if (choice !== 'set up' || dirty() || !vscode.workspace.isTrusted ||
      !vscode.workspace.workspaceFolders?.some(item => item.uri.toString() === folder.uri.toString())) return;
    await applySetup(root, changes);
    await vscode.window.showInformationMessage('inspections are set up. your agent needs to read the new AGENTS.md instructions.');
  } catch (error) {
    await vscode.window.showInformationMessage(`inspection setup stopped: ${error.message}`);
  }
}

module.exports = { setupInspection, prepareSetup, applySetup, HELPER, NOTE };
