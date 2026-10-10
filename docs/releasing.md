# releasing

the source and downloadable beta live in
[mot1us/specter](https://github.com/mot1us/specter).
github releases are public prereleases with a vsix installer, checksums, and the
optional inspection helper. installing the viewer requires no build tools or api key.

## identity and marketplace status

specter keeps the existing `mot1us.codex-live-follow` extension id and
`codexLiveFollow` settings so installs update in place. the repository url and
inspection report path also keep their existing names for compatibility.
marketplace publisher registration is pending while the owner sets up the
microsoft account. confirm ownership of the publisher before marketplace
publication. do not describe the publisher as verified or reserved.

if marketplace requires another publisher id, document migration to that identity.
the old `local.codex-live-follow` prototype and this beta are separate extensions;
remove or disable the old identity before installing the beta to avoid two watchers.
same-identity beta updates are installed manually from newer vsix files.

## for each github beta

1. update `package.json`, `package-lock.json`, the changelog, and
   `docs/release-notes.md` together. use a new version for each release.
2. run `npm ci`, `npm run check`, `npm test`, `npm run test:integration`,
   `npm run package:check`, `npm run package`, and `npm run test:packaged`
   with node.js 22 or newer. for linux headless runs and specific host versions,
   follow [contributing](../CONTRIBUTING.md#host-test-versions).
3. complete the manual cases relevant to the change, including updating an
   existing installation. use disposable files when demonstrating the extension.
4. inspect the vsix in `dist/`. it should contain runtime files and user documentation,
   with no development fixtures, credentials, or old packages. inspect the release
   notes and optional helper assets too.
5. commit to `main`. github actions runs unit checks and real vs code host tests
   on macos, windows, and linux, plus the minimum supported host on linux.
   packaging waits for those checks, then installs and tests that exact vsix
   in a disposable linux profile and verifies archive and checksum integrity.
6. once those gates pass, the release job uses its temporary `GITHUB_TOKEN`
   with `contents: write` to publish a public prerelease tagged `v<version>` at
   the tested commit. no publication credential or personal token is committed.
7. check the [workflow results](https://github.com/mot1us/specter/actions)
   and [release](https://github.com/mot1us/specter/releases). confirm its
   tag, installer, both checksum files, helper, and setup instructions are present.

the release job only publishes pushes to this repository's `main` branch. pull
requests, forks, and manual workflow runs test and package without publishing.
existing release tags, assets, and publication flags are preserved on reruns.
release titles and prose are normalized to lowercase; commands and links retain their casing. a conflicting version
tag causes a failure; do not force it to another commit. if a published beta needs
a fix, increment the version and release a new package.

## before marketplace publication

- resolve publisher registration and confirm the identity is controlled by the owner.
- collect successful everyday-use feedback from 3–5 independent testers and fix
  installation or source editing problems. see [beta testing](beta-testing.md).
- verify guided inspection setup and keep manual instructions available.
- record a short demo with disposable source, including replay and pause.
- keep the independent-companion disclosure, mit attribution, repository links,
  and accurate local-folder support scope. test remote environments before extending it.
- enable private vulnerability reporting if that will be the repository's reporting channel.
- review the packaged host's `specter-performance` ci artifact and test everyday
  editor use before treating its measurements as representative. see [performance](performance.md).

microsoft's current publishing guidance recommends microsoft entra authentication
for automation. global azure devops pats retire december 1, 2026; choose the
authentication flow from the current official guide when setting up the accounts.

follow vs code's [official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
for current publisher registration and authentication. marketplace publication is
a separate owner action and is not performed by the github beta workflow.
sha-256 checksums verify download integrity; they are not marketplace signatures.
