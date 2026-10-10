'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
// This file is deliberately self-contained so it can be copied into any project.
const ACTIVITY_PATH = '.codex-live-follow/activity.json';

const [file, line, message, phase = 'inspect'] = process.argv.slice(2);
const event = { id: randomUUID(), path: file, line: Number(line), message, phase };
const validPath = typeof file === 'string' && file.length > 0 && file.length <= 1024 &&
  !/[\\:\x00-\x1f]/.test(file) && !file.split('/').some(part => !part || part === '.' || part === '..');
if (!validPath || !Number.isSafeInteger(event.line) || event.line < 1 ||
  typeof message !== 'string' || message.length > 500 || !['inspect', 'suspect'].includes(phase)) {
  console.error('usage: node scripts/inspect-line.js <relative-file> <line> "what is being checked" [inspect|suspect]');
  process.exitCode = 1;
} else {
  try {
    const target = path.resolve(process.cwd(), event.path);
    if (!fs.statSync(target).isFile()) throw new Error('the target must be a file.');
    const destination = path.resolve(process.cwd(), ACTIVITY_PATH);
    const directory = path.dirname(destination);
    fs.mkdirSync(directory, { recursive: true });
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error('the activity path must be a regular folder.');
    }
    const temporary = `${destination}.${event.id}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify(event), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, destination);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
    console.log(`inspecting ${event.path}:${event.line}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
