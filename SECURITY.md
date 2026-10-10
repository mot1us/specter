# security and privacy

specter reads text files in the open workspace to compare saved versions and display their changes. source content and replay text are held in memory. recent edit snapshots are limited to 20 entries or 4 mb, stay in memory, and clear on reload or project rescan. they can be cleared from the sidebar. historical replay uses read-only previews and never restores source files. guided inspection setup, when requested and confirmed, writes a standalone helper, appends project instructions in AGENTS.md, and adds an activity-directory rule to .gitignore. it preserves existing instructions, refuses symlink targets and conflicting helpers, and requires a trusted local workspace. the agent runs the helper to write local activity reports; the extension reads these reports and does not execute the helper. project enable or pause choices are remembered in vs code settings and workspace state. the extension does not call chatgpt or another model, require an api key, send telemetry, make network requests, or write animation frames to real source files.

for a local workspace it runs on your computer. with a remote workspace, vs code may run this workspace extension on the remote extension host; the normal vs code connection carries the editor content. codex, vs code, and other extensions have their own data handling, independent of this extension.

the watcher does not identify the author of a write. a user save, generator, formatter, or another agent can trigger it. diagnostic output may contain file paths and error messages. treat recordings and shared logs as workspace information.

startup skips symlinks, and saved-source and report reads reject files marked as symlinks by the filesystem provider. the bundled inspection helper refuses a linked activity folder. these checks do not sandbox the workspace or other local processes. this beta has automated regression coverage and dependency checks; it has not had an independent security audit.

## reporting a vulnerability

use the repository's **security → report a vulnerability** option if the owner has enabled private reporting. if it is unavailable, ask the repository owner for a private contact without including sensitive details in a public issue. private reporting availability depends on the repository owner; the beta has no designated security email.

include the affected version, a minimal reproduction using non-sensitive files, and the expected versus observed behavior. never include credentials or private source code in a public report.
