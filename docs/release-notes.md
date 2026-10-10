## specter 0.9.6 beta

saved file changes, replayed as typing. runs locally, with no ai calls or telemetry.

### this update

- installed version beside the sidebar title and in the view heading.
- minimal sidebar with square controls, a pixel-inspired icon, and fewer explanations.
- preferences and optional agent inspections collapse out of the way.
- lowercase visible text, documentation, and github release descriptions.
- shorter readme.
- saved-file and report reads reject file symlinks; the helper refuses a linked activity folder.

### install

1. download the `.vsix` below.
2. in vs code: **extensions → … → install from vsix…**
3. open a local project and choose **enable for this project**.

requires desktop vs code 1.96 or newer on macos, windows, or linux.
open **specter** in the activity bar; **test specter** works while paused.
reload an existing window after updating to activate the new version.

replay uses read-only previews. source files and unsaved edits are preserved.
optional inspection setup writes a helper and project instructions after review.
recent edits stay in memory, capped at 20 entries or 4 mb.

updates are manual beta vsix installs. disable the old `local.codex-live-follow`
prototype first. the `mot1us.codex-live-follow` identity and `codexLiveFollow`
settings are preserved. marketplace registration is pending.

[report a bug](https://github.com/mot1us/specter/issues) ·
[security and privacy](https://github.com/mot1us/specter/blob/main/SECURITY.md)

free, open source, mit licensed. unofficial; not affiliated with openai.
