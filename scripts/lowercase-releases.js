'use strict';

const { spawnSync } = require('node:child_process');
const { lowercaseProse } = require('./lowercase-prose');
const { validateEnvironment } = require('./release-beta');

function lowercaseReleases(options = {}) {
  const repository = validateEnvironment(options.env || process.env);
  const run = options.run || ((args, input) => spawnSync('gh', args, { encoding: 'utf8', input }));
  const gh = (args, input) => {
    const result = run(args, input);
    if (result.error || result.status !== 0) throw new Error(result.stderr || String(result.error));
    return result.stdout;
  };
  const pages = JSON.parse(gh(['api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp']));
  let updated = 0;
  for (const release of pages.flat()) {
    if (!Number.isSafeInteger(release.id) || release.id < 1) throw new Error('invalid release id');
    const name = (release.name || '').toLowerCase();
    const body = lowercaseProse(release.body || '');
    if (name === (release.name || '') && body === (release.body || '')) continue;
    // Patch only prose: tags, commit targets, drafts, assets, and prerelease flags stay intact.
    gh(['api', `repos/${repository}/releases/${release.id}`, '--method', 'PATCH', '--input', '-'],
      JSON.stringify({ name, body }));
    updated++;
  }
  (options.log || console.log)(`lowercased ${updated} release descriptions`);
  return updated;
}

if (require.main === module) {
  try { lowercaseReleases(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { lowercaseReleases };
