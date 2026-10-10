# changelog

## 0.9.6

- show the installed version beside the sidebar title and in the view heading.
- simplify the sidebar with square controls, a pixel-inspired icon, and collapsible preferences and inspection setup.
- lowercase visible app text, documentation, issue forms, and release titles and prose; preserve identifiers, commands, and filenames.
- shorten the readme and update marketplace setup notes.
- reject source and report file symlinks and prevent the inspection helper from writing through a linked activity folder.

## 0.9.5

- debounce saved-file bursts with one timer and at most 256 waiting files.
- stop file watching and release source baselines while manually paused by default;
  resume establishes current baselines without replaying paused changes. recent
  history survives pause. the new option can retain baseline updates during pause.
- check editor model size before reading full text and hashing saves; skip paused saves.
- stream startup paths with exclusions before the file allowance and prune ignored trees.
- remove descendant snapshots and pending playback when a folder is deleted, including stale bootstrap reads.
- keep the demo speed slider available in changed lines mode.
- remove the unused replay-plan helper and icon source; extract debounce, startup scanning, and save guards.
- add regression tests and packaged-host cpu profiles with explicit measurement scope.

## 0.9.4

- extend test specter to a 30-second typing demo followed by a 5-second line inspection.
- keep enough bounded sample text to try the speed slider even at the fastest setting.
- give the demo its own duration and character limits, with progress showing elapsed demo time.

## 0.9.3

- keep the latest pending inspection per project and prioritize saved-edit replays.
- prevent inspection traffic from evicting saved edits from a full queue.
- release obsolete waiting reads immediately and cap the source-read backlog at 256 requests.
- count saved reads dropped during backlog overflow in the skipped total.
- add test specter in the sidebar and command palette: a read-only sample typing replay and inspection that works while paused or without a project.

## 0.9.2

- preserve the latest editor choice when a cancelled display request completes late.
- drop slow inspections superseded by newer reports, while preserving duplicate-notification handling.
- make skip stop visiting further blocks in changed lines mode.
- share eight source-read workers across startup, save bursts, inspections, and rescans.
- check replay limits before allocating character arrays and reduce refresh frequency for large files.
- correct architecture notes about live typing speed, deadlines, separate blocks, and cache limits.

## 0.9.1

- make the typing slider affect the running replay while dragging.
- keep the selected speed instead of overriding it to meet a time limit.
- show the complete saved file at the deadline and explain this in the controls.
- preview slider changes in memory; save the setting when dragging ends.

## 0.9.0

- replay separate changed blocks without retyping the code between them.
- add a reusable separate replay pane and bounded, read-only recent edit replay.
- show a count when the queue drops older changes during a burst of saves.
- add file and folder ignore menus and workspace-relative glob exclusions.
- add guided inspection setup with a bundled standalone helper.
- update repository links and release guards for the github rename to specter.

## 0.8.0 — specter

- renamed the extension and controls to specter.
- rewrote the readme and beta description in the author's own voice.
- removed the tagline and simplified the interface wording.
- kept the existing extension id, settings, and inspection setup so beta installs update in place.

## 0.7.3 — follow along

- relaxed the wording in the sidebar, settings, and docs.
- replay only splits changed text into characters, reducing allocation for small edits in large files.
- sidebar elements are cached and unchanged values are left alone during animation frames.
- removed an unused status argument, the legacy packaging shortcut, and stale package entries.
- added checks for emoji changes and small edits in large files.

## 0.7.2 — keep it simple

- new headline: watch your agent work.
- shorter readme, beta notes, sidebar labels, and settings descriptions.

## 0.7.1 — beta inspection reliability

- read the first inspection report when a native watcher combines its file and directory creation into one notification.
- include sidebar state in host-test timeout diagnostics.

## 0.7.0 — github beta

- new projects ask once before following saved changes, then remember the choice. existing project settings are preserved.
- changed the github beta identity to `mot1us.codex-live-follow`. marketplace registration is pending; disable or remove the old `local` build when migrating.
- made the optional inspection helper portable to unrelated projects with no repository dependencies.
- added downloadable beta assets, installation and update instructions, tester guidance, and issue reporting.
- added checks for first-use behavior, helper portability, and installing the exact packaged extension in a fresh profile.

## 0.6.0

- added local inspection reports so agents can reveal source lines and describe what they are checking during bug investigations.
- inspection visits share the bounded edit queue and respect pause controls, workspace changes, and unsaved files.
- reserved space for dynamic sidebar status rows so filenames and progress no longer move the controls below them.
- added a local reporting helper and agent instructions for working on this extension.

## 0.5.2

- fixed replay cancelling itself when the sidebar has focus or vs code delivers a delayed editor-change event.
- added a regression check and exercised real host playback with editing protection enabled and the controls focused.
- diagnostic output now records when editor interaction pauses a replay.

## 0.5.1

- register sidebar message listeners before loading its html, and expose read-only state for host checks.
- host tests now wait for the sidebar's script to connect before passing the ui check.

## 0.5.0

- added a dedicated live follow activity bar icon and sidebar with pause/resume, mode, typing speed, and editing preferences.
- added live playback status, current file, pending changes, and typing progress, plus buttons for skipping, settings, and diagnostics.
- the status bar button and open controls command now open the sidebar. settings remain synchronized with command palette commands and vs code settings.
- sidebar content follows the vs code theme and releases its resources when closed.

## 0.4.0

- added controls for pause/resume, replay speed, mode, skipping the current replay, and diagnostic output.
- following yields during editor interaction and while vs code is unfocused. dirty files and saves from this editor are skipped by default.
- added custom directory exclusions and made the enabled setting the source of truth for manual pause.
- bounded the pending queue by both job count and text size, and tightened cancellation and stale-read handling during saves and workspace changes.
- added standard vsix packaging with a checksum, package-content checks, real vs code host tests, cross-platform ci configuration, and development/release documentation.

## 0.3.1

- increased the default typing replay limit from 4,000 to 20,000 characters so typical new html, css, and javascript files animate.

## 0.3.0

- reduced typing updates to at most 20 frames per second and limited the target replay duration to 12 seconds by default.
- coalesced queued writes to the same file and stopped a superseded replay when a newer version arrived.
- tracked the replay cursor incrementally to avoid rescanning the whole inserted text on each frame.

## 0.2.0

- added typing replay in a temporary read-only document before revealing the real file.
- added replay speed and size controls.

## 0.1.0

- initial local prototype: watch saved workspace text files, open changed files, and highlight changed lines.
- added a status bar toggle, bounded snapshots, and filters for common generated and binary files.
