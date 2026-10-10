# optional inspection setup

saved edits show up once you enable specter. this setup lets your agent
show the file and line it's checking during a code check.

## from the sidebar

click **set up inspections**. choose a project if you have more than one open.
specter lists the files before making changes:

- `.specter/inspect-line.cjs` — a standalone local helper.
- `AGENTS.md` — adds the inspection note and keeps existing instructions.
- `.gitignore` — adds `.codex-live-follow/` for temporary activity reports.

save any unsaved edits in those files first. setup leaves a conflicting helper
alone, refuses symlink targets, and asks for workspace trust. running setup
again doesn't add the note twice. your agent needs to read the updated
`AGENTS.md`; start a new prompt if it already read the old instructions.

to try the guided helper from the project root:

```sh
node .specter/inspect-line.cjs src/app.js 12 "Checking the calculation"
```

## manual setup

1. download `inspect-line.js` from the same github release as your vsix.
   it needs node.js 18 or newer. no npm install.
2. copy it into your project's `scripts/` directory.
3. add `.codex-live-follow/` to that project's `.gitignore`.
4. add the note below to your project's `AGENTS.md`. keep its other instructions.
   create the file if you don't have one.

```markdown
## Specter inspection reports

When checking a bug, show the lines you actually inspect. From the project root:

node scripts/inspect-line.js <relative-file> <one-based-line> "What you are checking"

Keep the explanation short. Add `suspect` at the end when the code looks like a
possible cause. Keep fixing and checking the issue. Reports stay local and don't
edit source files.
```

## try it

with your project open in vs code and replay enabled, run the helper from the
project root using an existing source file:

```sh
node scripts/inspect-line.js src/app.js 12 "Checking how this value is calculated"
```

specter opens the real file, highlights the line, and shows **taking a look**.
then ask codex to check a bug. it can report the locations as it works.
saved edits still show up if the agent skips these reports.

## without the helper

an agent can write `.codex-live-follow/activity.json` directly. use a fresh `id`, a
workspace-relative path, positive one-based line numbers, and a message up to 500
characters. `endLine` is optional. `phase` is `inspect` or `suspect`.

```json
{"id":"new-report-123","path":"src/app.js","line":12,"message":"Checking the calculation","phase":"inspect"}
```

specter shows new reports. it skips old reports at startup. visits use the
locations the agent reports. pause and unsaved edit protection still apply.

to remove this setup, delete the helper (`.specter/inspect-line.cjs` for guided setup), the added agent note, and
`.codex-live-follow/`. saved edit replay keeps working.
