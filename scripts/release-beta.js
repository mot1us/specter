'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const manifest = require('../package.json');

function validateEnvironment(env) {
  const repository = env.GITHUB_REPOSITORY;
  const commit = env.GITHUB_SHA;
  if (repository !== 'mot1us/specter' || !/^[a-f0-9]{40}$/.test(commit || '') ||
      env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') {
    throw new Error('beta releases run only in the repository workflow at an exact commit.');
  }
  return repository;
}

function releaseBeta(options = {}) {
  const env = options.env || process.env;
  const repository = validateEnvironment(env);
  const commit = env.GITHUB_SHA;
  const tag = `v${manifest.version}`;
  const run = options.run || (args => spawnSync('gh', args, { encoding: 'utf8' }));
  const log = options.log || console.log;
  const gh = args => run([...args, '--repo', repository]);
  const existing = gh(['release', 'view', tag, '--json', 'isDraft,url']);
  if (existing.status === 0) {
    const release = JSON.parse(existing.stdout);
    log(`Release ${tag} already exists (${release.isDraft ? 'draft' : 'published'}). It is preserved.`);
    return;
  }
  if (existing.error || !/release not found|HTTP 404/i.test(existing.stderr || '')) {
    throw new Error(`Could not check release ${tag}: ${existing.stderr}`);
  }
  // Do not attach a new package to an unrelated pre-existing version tag.
  const tagged = run(['api', `repos/${repository}/git/ref/tags/${tag}`]);
  if (tagged.status === 0) {
    const object = JSON.parse(tagged.stdout).object;
    if (object?.type !== 'commit' || object.sha !== commit) {
      throw new Error(`Tag ${tag} already points to a different commit. It is preserved.`);
    }
  } else if (tagged.error || !/HTTP 404/i.test(tagged.stderr || '')) {
    throw new Error(`Could not check tag ${tag}: ${tagged.stderr}`);
  }
  const root = options.root || path.resolve(__dirname, '..');
  const names = [`specter-${manifest.version}.vsix`,
    `specter-${manifest.version}.vsix.sha256`,
    'inspect-line.js', 'inspect-line.js.sha256', 'inspection-setup.md'];
  const assets = names.map(name => path.join(root, 'dist', name));
  for (const asset of assets) if (!fs.statSync(asset).isFile()) throw new Error(`Missing ${asset}`);
  const created = gh(['release', 'create', tag, ...assets, '--target', commit,
    '--prerelease', '--latest=false',
    '--title', `${manifest.displayName} ${manifest.version} beta`,
    '--notes-file', path.join(root, 'docs', 'release-notes.md')]);
  if (created.error || created.status !== 0) throw new Error(created.stderr || String(created.error));
  log(created.stdout.trim());
}

if (require.main === module) {
  try { releaseBeta(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { releaseBeta, validateEnvironment };
