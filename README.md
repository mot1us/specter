# specter

watch saved file changes replay as typing in vs code. built for coding agents;
works with any tool that saves files. runs locally, with no ai calls or telemetry.

## install

1. download the `.vsix` from [releases](https://github.com/mot1us/specter/releases).
2. in vs code: **extensions → … → install from vsix…**
3. open a local project and choose **enable for this project**.

requires desktop vs code 1.96 or newer on macos, windows, or linux. this is a beta.

## use

open **specter** in the activity bar. the title shows your installed version.

- **replay saved edits** turns replay on or pauses it.
- **display** chooses typing or changed lines; **pane** chooses where they open.
- **speed** updates while a replay is running.
- **test specter** runs a 30-second typing demo and a 5-second inspection.
- **recent edits** replays something you missed; **skip** moves past the current replay.
- right-click a file or folder and choose **ignore in specter** to skip it.

preferences are under **preferences**. pause stops watching files by default;
resume starts from their current contents. long replays finish at the time limit.

## optional inspections

open **agent inspections → set up inspections** to add a local helper and agent
instructions after reviewing the changes. your agent must report the lines it
checks. the helper needs node.js 18 or newer. [manual setup](docs/inspection-setup.md).

## privacy and updates

replay uses read-only previews and preserves unsaved edits. recent edits stay in
memory, up to 20 entries or 4 mb, and clear on reload or rescan. specter makes no
network requests. vs code and your agent manage their own connections.

install newer beta vsix files manually. disable the old `local.codex-live-follow`
prototype first; existing `codexLiveFollow` settings still work.

[report a bug](https://github.com/mot1us/specter/issues) ·
[security and privacy](SECURITY.md) · [contributing](CONTRIBUTING.md)

free, open source, mit licensed. unofficial; not affiliated with openai.
