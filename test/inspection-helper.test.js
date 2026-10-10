'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { parseInspection, ACTIVITY_PATH } = require('../src/inspection');

test('a copied inspection helper works in an unrelated project without repository dependencies', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-follow-helper-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const helper = path.join(root, 'inspect-line.js');
  fs.copyFileSync(path.join(__dirname, '..', 'src', 'inspection-helper.js'), helper);
  fs.writeFileSync(path.join(root, 'demo.js'), 'const broken = false;\n');
  const result = spawnSync(process.execPath,
    [helper, 'demo.js', '1', 'Checking the flag', 'suspect'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = parseInspection(fs.readFileSync(path.join(root, ACTIVITY_PATH), 'utf8'));
  assert.equal(report.path, 'demo.js');
  assert.equal(report.line, 1);
  assert.equal(report.phase, 'suspect');
  assert.equal(fs.readFileSync(path.join(root, 'demo.js'), 'utf8'), 'const broken = false;\n');
  assert.deepEqual(fs.readdirSync(path.join(root, '.codex-live-follow')), ['activity.json']);
});

test('invalid helper arguments produce no activity file', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-follow-invalid-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const helper = path.join(__dirname, '..', 'src', 'inspection-helper.js');
  for (const args of [['../outside.js', '1', 'Checking'], ['demo.js', '0', 'Checking'],
    ['demo.js', '1', 'Checking', 'execute']]) {
    assert.notEqual(spawnSync(process.execPath, [helper, ...args], { cwd: root }).status, 0);
  }
  assert.equal(fs.existsSync(path.join(root, '.codex-live-follow')), false);
});

test('the inspection helper cannot write through a linked activity directory', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'specter-linked-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'specter-outside-'));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'demo.js'), 'source');
  fs.writeFileSync(path.join(outside, 'activity.json'), 'leave this alone');
  fs.symlinkSync(outside, path.join(root, '.codex-live-follow'), 'junction');
  const helper = path.join(__dirname, '..', 'src', 'inspection-helper.js');
  const result = spawnSync(process.execPath, [helper, 'demo.js', '1', 'checking'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /regular folder/);
  assert.equal(fs.readFileSync(path.join(outside, 'activity.json'), 'utf8'), 'leave this alone');
  assert.deepEqual(fs.readdirSync(outside), ['activity.json']);
});
