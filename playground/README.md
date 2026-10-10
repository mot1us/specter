# little things

a small task board for watching specter replay real file changes. vanilla html,
css, and javascript, with a local node server and no dependencies to install.
the extension's source and configuration are separate from this app.

## run it

from the repository root:

```sh
npm --prefix playground start
```

open http://127.0.0.1:4173. refresh after source changes. use `PORT=4174` before
the command if the default port is busy. node.js 18 or newer is required.

add, complete, delete, filter, or search tasks. tasks and your chosen theme save
in this browser. **reset the sample board** reloads the tasks from `data.js`.

## watch live typing

keep this repository open in vs code and enable specter before asking your
agent for changes. existing files make it easy to watch insertion, replacement,
and deletion replays. these are good prompts to try:

- “change the playground's orange accent to blue.”
- “replace two sample tasks, one near the top and one near the bottom.”
- “add a button to clear all completed tasks.”
- “add a priority selector and show a priority badge on each task.”

while edits arrive, try **typing replay**, **changed lines**, typing speed,
pause/resume, **skip**, **separate pane**, and **recent edits**. click or type in
vs code during replay to try pause on interaction. the app's browser controls
change local browser data; source-file replay is triggered by saved code edits.

for inspections, ask the agent to investigate an actual issue in this app.
the repository's `AGENTS.md` and `scripts/inspect-line.js` are already set up.
right-click `playground/data.js` and choose **ignore in specter** to test
exclusions, then remove the exclusion in settings when you're done.

## files

- `index.html` — layout and the built-in test guide.
- `styles.css` — responsive layout, colors, and light/dark themes.
- `app.js` — task interactions, local saving, and progress.
- `data.js` — the starter tasks.
- `server.cjs` — serves only the app's public files on localhost.

```sh
npm --prefix playground run check
```
