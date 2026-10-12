# Gates: StarBase v0.3.0 feedback

OWNS: server.js, public/app.js, public/index.html, public/style.css, public/starbase-state.js, public/starbase/player.html, public/starbase/bridge.js, tools/extract-starbase.js, lib/demo.js, lib/starbase.js, tests/**, README.md, .gitignore, docs/STARBASE3_PROGRESS.md, GATES.md

Scope: Grok Bot STARBASE3_FEEDBACK.md — once-clip restart, play watchdog, chip refresh, HOLD tag, Remotion gitignore, 1px overflow.

- [x] G1: JavaScript files parse
  CHECK: node --check server.js public/app.js public/starbase-state.js public/starbase/bridge.js tools/extract-starbase.js lib/starbase.js lib/demo.js
  EXPECT: STARBASE_SYNTAX_OK
  EVIDENCE: STARBASE_SYNTAX_OK

- [x] G2: extract tool is idempotent
  CHECK: node tools/extract-starbase.js
  EXPECT: EXTRACT_OK
  EVIDENCE: EXTRACT_OK 525833 bytes，連跑兩次不變

- [x] G3: unit tests all pass
  CHECK: node tests/starbase-state.test.js
  EXPECT: PASS
  EVIDENCE: 25 PASS

- [x] G4: parser and existing unit tests still pass
  CHECK: node tests/starbase.test.js
  EXPECT: PASS
  EVIDENCE: PASS

- [x] G5: UI static structure includes v0.3.0 feedback
  CHECK: node tests/ui-static.test.js
  EXPECT: PASS
  EVIDENCE: PASS（started/resume、onerror、gitignore、HOLD bottom、overflow clip）

- [x] G6: demo API, player bundle cache or SKIP, 404, and HTML
  CHECK: node tests/verify-starbase.js --all
  EXPECT: STARBASE_VERIFY_OK
  EVIDENCE: STARBASE_VERIFY_OK；starbase.js 200 public 525833；__missing__.js 404；server still up

- [x] G7: repo files do not embed a personal home path
  CHECK: node tests/verify-starbase.js --nopath
  EXPECT: STARBASE_NOPATH_OK
  EVIDENCE: STARBASE_NOPATH_OK
