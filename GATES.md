# Gates: StarBase v0.3.1 Safari freeze

OWNS: public/app.js, public/index.html, public/starbase/player.html, public/starbase/bridge.js, tests/ui-static.test.js, tests/verify-starbase.js, README.md, GATES.md, docs/STARBASE3_PROGRESS.md

Scope: STARBASE3_FEEDBACK.md v0.3.1 — hide AudioContext before Remotion loads, version player assets, drop iframe sandbox.

- [x] G1: JavaScript files parse
  CHECK: node --check server.js public/app.js public/starbase-state.js public/starbase/bridge.js tools/extract-starbase.js lib/starbase.js lib/demo.js && echo STARBASE_SYNTAX_OK
  EXPECT: STARBASE_SYNTAX_OK
  EVIDENCE: STARBASE_SYNTAX_OK

- [x] G2: unit tests all pass
  CHECK: for t in tests/*.test.js; do node "$t" || exit 1; done && echo STARBASE_TESTS_OK
  EXPECT: STARBASE_TESTS_OK
  EVIDENCE: STARBASE_TESTS_OK（bridge-queue 12 PASS、dispatch、processes、starbase-state 25 PASS、starbase、ui-static）

- [x] G3: UI static includes AudioContext stub, versioned assets, no sandbox
  CHECK: node tests/ui-static.test.js
  EXPECT: PASS
  EVIDENCE: PASS（AudioContext stub before __player、SB_ASSET_V 0.3.1、無 sandbox）

- [x] G4: player.html serves versioned bridge.js
  CHECK: node tests/verify-starbase.js --all
  EXPECT: STARBASE_VERIFY_OK
  EVIDENCE: STARBASE_VERIFY_OK；player.html bridge.js?v=0.3.1；starbase.js 200 public 525833

- [x] G5: repo files do not embed a personal home path
  CHECK: node tests/verify-starbase.js --nopath
  EXPECT: STARBASE_NOPATH_OK
  EVIDENCE: STARBASE_NOPATH_OK
