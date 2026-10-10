# performance checks

specter does not continuously poll source contents. it reacts to filesystem
events, debounces up to 256 files with one shared timer, and limits source i/o to
eight active reads and 256 waiting requests. manual pause stops watching and
releases baselines by default. recent history remains available when resumed.

text cache budgets are 32 mib for snapshots, 4 mib for recent edits, and 8 mib for
pending playback. these budgets count utf-8 content, not total process ram;
javascript objects, editor models, highlighting, and transient copies cost more.
typing can refresh the virtual document at up to 20 frames per second. files over
128 kib refresh less often. startup paths and source contents are read locally,
and there are no runtime dependencies or network calls.

## real-host profiling

the package ci job installs the exact release vsix in a disposable vs code
profile, disables other installed extensions, runs the integration suite, and
records these phases:

- idle with replay enabled.
- typing a saved edit in approximately 4 kb of text.
- typing a saved edit in approximately 500 kb of text.
- a burst of 400 saved files.
- a file save while manually paused.

download the `specter-performance` artifact from that run. `summary.json`
contains duration, extension-host cpu time, heap and rss snapshots, virtual
document change counts, observed replay backlog, and sampled specter self and
inclusive time. each phase also includes a `.cpuprofile` that can be opened in
vs code for function-level inspection. these artifacts expire after 14 days.

cpu and ram counters cover the entire extension-host process, including the
integration harness and profiling overhead. sampled attribution is approximate,
particularly for brief operations. renderer/gpu work and language-service child
processes are excluded. heap differences can reflect garbage collection.
results depend on the ci hardware, operating system, workspace, and installed
extensions; they are measurements for these scenarios, not universal cpu or ram
limits. there are no brittle hardware-specific performance pass thresholds.

to reproduce in a disposable host, set `SPECTER_PROFILE_DIR` to an output
directory when running `npm run test:packaged`. on headless linux:

```sh
SPECTER_PROFILE_DIR=/tmp/specter-profile xvfb-run -a npm run test:packaged
```

this command opens a separate test editor. use ci when an additional local
vs code instance would disrupt ongoing work. do not use production source for a
shared profile; cpu-profile paths and functions may identify the workspace.

## before a stable release

use real everyday projects and check idle, repeated saves, large files, pause and
resume, dirty editors, folder deletion, and bursts. compare with specter disabled
using vs code's [performance tools](https://github.com/microsoft/vscode/wiki/Performance-Issues).
keep the current local-workspace support scope until remote hosts are tested.
