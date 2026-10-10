# contributing

keep the extension small, predictable, and safe to use while someone else is editing the workspace. the animation must never write to source files. it must be possible to stop following immediately.

## development

1. open this repository in desktop vs code, version 1.96 or newer.
2. use node.js 22 or newer and run `npm ci` to install the pinned development tools.
3. press **f5** to launch the extension development host, then open a disposable sample folder in that window.
4. change files in the sample folder from another editor or terminal to exercise the watcher. leave the development host focused and its editor idle so the interaction guard allows playback.

the runtime has no third-party dependencies. before submitting a change, run:

```sh
npm run check
npm test
npm run test:integration
npm run package:check
npm run package
npm run test:packaged
```

the node tests exercise pure diff/replay logic and controller behavior with a vs code api mock. the integration suite uses `@vscode/test-electron` to launch a real extension development host. it creates a temporary workspace, profile, and extension directory, then removes them when the host exits. other installed extensions are disabled for this test host.

## host test versions

the default integration command downloads and tests stable vs code. to test the minimum supported version in a posix shell:

```sh
VSCODE_VERSION=1.96.0 npm run test:integration
```

to use the installed macos application without downloading another copy:

```sh
VSCODE_EXECUTABLE_PATH="/Applications/Visual Studio Code.app/Contents/MacOS/Code" npm run test:integration
```

use the path to the actual vs code executable for your platform, not the `code` shell wrapper. some older macos builds name this executable `Electron` instead of `Code`; check the app’s `Contents/MacOS` directory. `VSCODE_EXECUTABLE_PATH` takes precedence over the version download. in powershell, set the environment variable first, for example `$env:VSCODE_VERSION = '1.96.0'`, then run `npm run test:integration`.

on linux without a display, install xvfb and run:

```sh
xvfb-run -a npm run test:integration
```

ci is configured for unit checks on macos, windows, and linux with node.js 24, plus linux with node.js 22. host tests target stable vs code on all three platforms and vs code 1.96.0 on linux. packaging runs on linux after both test groups pass. the local sidebar host checks passed on macos with both installed vs code 1.140 and version 1.96.0, including the webview script readiness check; the hosted ci matrix passes on macos, windows, and linux, including the minimum vs code version on linux. automated tests cover their defined scenarios; the manual checks below exercise the rest of the user experience.

## useful manual checks

- open the specter activity bar view and use pause/resume, replay mode, speed, and editing preferences. change a setting through vs code settings or a command and confirm the sidebar updates. verify the panel in light/dark themes and with keyboard navigation.

- create and edit html, css, and javascript files; confirm typing replay and direct follow both reach the latest real file.
- save the same file repeatedly during a replay. confirm an old version does not open after the latest one.
- pause during a replay, then edit several files. confirm following stays paused and resuming does not replay the paused backlog.
- type into a dirty editor while files change externally. confirm your unsaved work and navigation are respected.
- switch tabs, click in the editor, and move the caret during playback. confirm following yields and resumes only after the configured idle delay. unfocus the window and confirm following waits.
- change playback speed or mode during a replay. confirm the next job uses the new setting; use skip current replay to finish the current animation immediately.
- save from the development host with `ignoreEditorSaves` enabled, then write externally. only the external write should replay.
- delete or rename a queued file, close the folder, and switch workspace folders while a replay runs.
- try unicode, crlf, large files, binary files, ignored folders, multiple workspace folders, and light/dark themes.

use a minimal reproduction when reporting an issue: vs code version, operating system, whether the workspace is local or remote, mode/settings, and the order of edits that caused the issue. remove private paths and code from logs or recordings before sharing them.

see [architecture](docs/architecture.md) for the event flow and [release preparation](docs/releasing.md) for packaging and publication.
