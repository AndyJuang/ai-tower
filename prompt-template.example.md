> ⚠️ Background agent: never launch GUI apps, Electron windows or browsers (headless included). Verify with unit tests and static checks only.

# You are {{agent}} working on line {{line}} ({{msLabel}})
Worktree: {{worktree}} · branch **{{branch}}** (created by AI Tower at {{now}} from origin/{{base}} {{baseHash}}).

## Task: #{{issueNumber}} {{issueTitle}}
{{issueUrl}}

### Issue body (snapshot at dispatch time)
{{issueBody}}

### Latest comments
{{comments}}

## Rules
{{pushRule}}
- No GUI launches. Anything that needs a real window: mark it `DEFERRED: needs real session` in the progress file.
- Use theme tokens only (no hard-coded colors); no warnings or prompts on app startup.
- Add layout regression tests for new UI (`{{testScript}}` in package.json); failing tests print FAIL and exit non-zero.
- Run the full non-GUI test suite before every commit: `{{fullTestsCmd}}`.
- Progress file **{{pf}}**: within the first 10 lines keep a line `Status: in progress` or `Status: READY TO MERGE`. Set READY TO MERGE only when everything is done, tests pass and the branch is pushed.
- If you hit a usage limit: commit + push, write `Status: paused (usage limit)`, and exit (the runner waits for the reset).
{{codexPart}}
