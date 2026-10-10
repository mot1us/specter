# working on specter

## delivering updates

after completing each requested update and its required checks, commit the task's
changes and push to the configured github remote. the user has authorized this
workflow; do not ask again for routine commits and pushes. keep unrelated changes
out of commits and do not force-push. on `main`, the existing github actions
workflow publishes the beta for a new version after its checks pass.

## investigating bugs

during bug investigation, report meaningful source locations so the user can watch
the investigation in vs code. from this repository root, run:

```sh
node scripts/inspect-line.js assets/sidebar.css 15 "Checking the status card height"
```

use the real relative file path and one-based line being inspected, with a short
description of the check. add `suspect` as the final argument only when evidence
points to a possible cause. report actual inspections, not invented progress.
continue fixing and verifying the problem normally. the helper writes local viewer
activity; it does not edit source code or communicate over the network.
