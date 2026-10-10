# how it works

```text
Workspace file write
  → debounced filesystem event
  → read UTF-8 text and compare with the cached snapshot
  → queue the newest change
  → animate a read-only virtual document, or reveal changed lines
  → show the real file
```

`src/extension.js` activates and disposes the controller. `src/controller.js` owns vs code registration, watchers, snapshot storage, the queue, commands, and editor display. `src/debounce.js` coalesces file events with one timer and bounded pending storage; `src/source-scan.js` streams initial source paths; `src/editor-save.js` checks model size before hashing an editor save. `src/read-pool.js` limits concurrent source reads. `src/sidebar.js` provides a sidebar webview, and `assets/sidebar.js` and `assets/sidebar.css` implement the controls. the controller sends state changes to the visible sidebar; sidebar actions use existing commands and validated settings. `src/diff.js` finds separate changed line ranges. `src/replay.js` trims unchanged prefixes and suffixes within each range so only changed characters are typed.

typing uses vs code's [virtual document api](https://code.visualstudio.com/api/extension-guides/virtual-documents). the real file is already saved when playback starts. its contents are never reverted or rewritten to create the effect. a preview can show a partial function that is not valid code yet; the actual file is complete. deletion-only edits and oversized changes are shown directly.

this is a companion watcher, with no dependency on the codex extension and no access to codex's model stream. it cannot attribute a write to a particular tool. changes in another checkout or worktree are only visible if that folder is open in this vs code workspace. unsaved editor changes do not produce a disk replay.

## cost and bounds

the watcher reacts to filesystem events rather than polling file contents continuously. events are debounced per file using one shared timer. each eligible changed file is read and compared as a whole; this is not a byte-level stream of edits.

- snapshots are bounded at 1,200 files and 32 mib of utf-8 text. recent edits separately keep up to 20 entries or 4 mib. these are cache bounds, not a total process-memory limit.
- before source reads, debounce storage keeps at most 256 files. a newer save replaces that file's older waiting revision. overflow drops the oldest waiting file and releases its revision tracking; drops contribute to the skipped count. one batch notification updates the controls instead of posting one status update for each dropped event.
- startup streams eligible paths through workspace filesystem apis. per-project exclusions apply before the 1,200-file allowance; excluded directory trees are pruned before listing their contents. traversal stops after 10,000 directory listings and does not follow directory symlinks. each active bootstrap read has revision tracking, so a deleted parent folder cannot resurrect its children from an older read.
- startup, watcher events, and inspection targets share eight source-read workers and at most 256 waiting requests. new requests immediately release obsolete waiting revisions; a newer waiting save replaces the same file's older request. overflow releases the oldest waiting request without i/o. dropped save reads contribute to the skipped count, but cannot enter recent history because their text was never read. rescans discard waiting reads and retain the limit on reads already in flight.
- files above the configured size limit, invalid utf-8, binary content, and common dependency/build directories are skipped.
- typing refreshes at up to 20 frames per second for files up to 128 kib. larger files use longer frame intervals, up to 250 ms. character allowance still follows elapsed time at the selected speed. at the replay deadline, the complete saved contents appear without accelerating typing.
- replay character limits and coarse-diff fallback are checked before allocating character arrays. the character limit applies across all changed blocks and counts unicode code points.
- newer writes replace pending versions of the same file and supersede a replay of that file.
- the pending queue is bounded at 12 jobs and 8 mib of text. saved edits play before inspections. each project keeps only its latest pending inspection. inspections are discarded before saved edits when overloaded; dropping a saved edit contributes to the skipped count and marks its history entry.

refreshing a virtual document sends its current text through vs code, so large documents can cost more than the visible inserted text suggests. recursive watchers and the initial snapshot scan also have costs on large repositories. there is no claim of measured cpu or memory usage across every project size.

when a file has no cached baseline, the extension may present its current contents as a new file. separate changed blocks keep the intervening text visible. diffs that exceed the bounded line-comparison table use a coarse range and show changed lines directly.

## letting the user work

manual pause uses the workspace setting and remains in effect until resumed. by default, `suspendWhenPaused` stops watchers, cancels pending source reads, and releases baselines; resume scans current files without replaying changes made while paused. explicit recent history survives this pause/resume cycle. turning the option off retains baseline updates during manual pause. paused editor saves never assemble or hash the model. enabled editor saves check model length before requesting full text, then check utf-8 bytes before hashing.

by default, editor interaction temporarily suspends playback until the user has been idle for three seconds; an unfocused window waits too. pending changes can coalesce during an automatic pause. dirty documents are skipped, and saves reported by this vs code window are suppressed by default. these are activity and save guards, not proof that a remaining write came from codex.

the playback mode is selected when a job starts. typing speed updates during the current animation, including an in-memory slider preview; releasing the slider saves the setting. pause cancels playback. skip current replay finishes an animation and reveals the real file, or stops visiting further blocks in changed lines mode.

each file's read revision and the workspace generation are checked around asynchronous work, so an older read or a previous workspace cannot enqueue stale content. inspections recheck their accepted report id after reading the target, so a slow older report cannot enqueue after a newer report. duplicate notifications for the same report remain harmless.

a parent deletion removes descendant baselines, waiting reads, save-suppression markers, and queued playback, and cancels any active child replay. existing read-only recent-history snapshots remain until their normal eviction or explicit clearing.

cancelling playback closes the extension's owned typing preview. an editor display request already in flight cannot be cancelled through the vs code api; if its late completion displaces the user's selected text editor, specter restores the latest selected editor. navigation during that restoration takes precedence too. watchers are registered before the initial snapshot scan to cover writes during startup.

## built-in sample

test specter schedules one explicit demo ahead of pending jobs, after the current job finishes. it uses the normal virtual-document typing and highlighting paths with a bounded sample in `src/demo.js`. typing runs for 30 seconds at the selected speed, then the sample inspection stays visible for 5 seconds. the sample has enough characters for the fastest speed and uses its own 20,000-character limit and duration, independently of normal replay limits. demo progress shows elapsed time; normal replay progress still follows characters typed.

the demo can run while replay is disabled or no workspace is open; it still respects background waiting, interaction cancellation, skip, pause, reset, and disposal. it does not change the enabled setting, write files, or enter snapshots or recent history. duplicate requests share the one pending or active demo. all sample tabs are closed afterward.
