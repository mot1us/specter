'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { lowercaseProse } = require('../scripts/lowercase-prose');
const { lowercaseReleases } = require('../scripts/lowercase-releases');

const env = { GITHUB_REPOSITORY: 'mot1us/specter', GITHUB_SHA: 'a'.repeat(40),
  GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main' };

test('lowercase prose preserves commands, identifiers, filenames, and case-sensitive links', () => {
  const text = '# Specter\nUse `codexLiveFollow.testSpecter` and [README.md](README.md#Case).\n' +
    '```sh\nVSCODE_VERSION=stable npm test\n```\nSee https://example.com/Case and AGENTS.md.\n';
  const lower = lowercaseProse(text);
  assert.equal(lower, '# specter\nuse `codexLiveFollow.testSpecter` and [README.md](README.md#Case).\n' +
    '```sh\nVSCODE_VERSION=stable npm test\n```\nsee https://example.com/Case and AGENTS.md.\n');
  assert.equal(lowercaseProse(lower), lower);
});

test('release normalization is gated to the exact owner main push', () => {
  for (const change of [{ GITHUB_REPOSITORY: 'other/fork' }, { GITHUB_SHA: 'main' },
    { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/feature' }]) {
    assert.throws(() => lowercaseReleases({ env: { ...env, ...change }, run() { assert.fail('no network'); } }), /exact commit/);
  }
});

test('release normalization reads all pages and patches only changed prose', () => {
  const calls = [];
  const releases = [[{ id: 1, name: 'Specter Beta', body: 'Use `codexLiveFollow`.\n', draft: true }],
    [{ id: 2, name: 'specter beta', body: 'already lowercase' }]];
  const count = lowercaseReleases({ env, log() {}, run(args, input) {
    calls.push({ args, input });
    return { status: 0, stdout: input ? '{}' : JSON.stringify(releases) };
  } });
  assert.equal(count, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args.slice(-2), ['--paginate', '--slurp']);
  assert.deepEqual(JSON.parse(calls[1].input), { name: 'specter beta', body: 'use `codexLiveFollow`.\n' });
  assert.deepEqual(calls[1].args, ['api', 'repos/mot1us/specter/releases/1', '--method', 'PATCH', '--input', '-']);
});

test('release lookup failures and invalid ids cannot patch metadata', () => {
  for (const response of [{ status: 1, stderr: 'forbidden' },
    { status: 0, stdout: JSON.stringify([[{ id: '../other', name: 'Bad' }]]) }]) {
    let calls = 0;
    assert.throws(() => lowercaseReleases({ env, log() {}, run() { calls++; return response; } }));
    assert.equal(calls, 1);
  }
});
