# give it a run

use desktop vs code with a local folder on macos, windows, or linux.
remote workspaces, other editors, and browser-only vs code haven't been checked
for this beta.

## try this

1. install the vsix in a clean vs code profile. disable any older specter build.
2. open a throwaway project. before enabling replay, save a file from outside
   vs code. specter should stay paused.
3. enable replay. have codex create and edit a few files. watch the typing replay
   finish at the latest real file.
4. pick **changed lines**. edits should open at the changed block.
5. try pause, resume, speed, and skip. type and switch files while an edit arrives.
   your unsaved work should stay put.
6. reload vs code. your project choice should stick. a new project should ask once.
7. try the optional [inspection setup](inspection-setup.md). have codex check a bug.
   reports should open the file and line it names.
8. install a newer beta over the same extension id. check that your settings stick.

## found something broken?

[open an issue](https://github.com/mot1us/specter/issues). include:

- extension version, vs code version, and operating system.
- selected view and whether your folder is local.
- what happened, what you expected, and how to repeat it.

use throwaway code in examples. logs and recordings can show your source and paths.

## before marketplace

get 3–5 independent testers through installation and everyday use. fix installation
failures, problems with source editing, incomplete replays, and blocking ui issues.
keep the platform checks green and verify guided inspection setup.

[github actions](https://github.com/mot1us/specter/actions) records the
automated checks. independent tester feedback still needs to be collected.

## new controls to try

- click test specter while paused, then without a project open. expect 30 seconds
  of typing followed by a 5-second line-2 inspection, with no file or setting changes.
- move the speed slider during the demo; typing should change speed while the
  progress bar continues counting demo time.
- stop the sample using skip or pause replay; its preview tabs should close.
- background vs code while saved edits and inspections arrive. only the latest
  inspection per project should wait, and saved edits should play first.
- choose beside my code and keep another file open beside the replay.
- save two distant edits in one file; the middle should stay visible.
- click an older recent edit; the actual file should keep its newest content.
- save many different files at once; check the skipped count and recent list.
- right-click a file or folder, choose ignore in specter, and save it again.
- in a throwaway project, run set up inspections twice. check that existing
  AGENTS.md instructions and .gitignore rules are preserved and not duplicated.
