# Gates: StarBase v0.2.1 visuals

OWNS: public/app.js, public/style.css, public/index.html, README.md, tests/ui-static.test.js, tests/verify-starbase.js, docs/STARBASE_PROGRESS.md, GATES.md

Scope: StarBase visual upgrade only (bigger rockets, tower detail, stars, glow, vapor). Do not change server or dispatch logic.

- [ ] G1: JavaScript files parse
  CHECK: node tests/verify-starbase.js --syntax
  EXPECT: STARBASE_SYNTAX_OK
  EVIDENCE: pending

- [ ] G2: parser unit tests still pass
  CHECK: node tests/starbase.test.js
  EXPECT: PASS
  EVIDENCE: pending

- [ ] G3: demo API and HTML include StarBase v0.2.1
  CHECK: node tests/verify-starbase.js --api
  EXPECT: STARBASE_API_OK
  EVIDENCE: pending

- [ ] G4: repo files do not embed a personal home path
  CHECK: node tests/verify-starbase.js --nopath
  EXPECT: STARBASE_NOPATH_OK
  EVIDENCE: pending

- [ ] G5: mapProcesses caffeinate tree is one runner and live-only capacity
  CHECK: node tests/processes.test.js
  EXPECT: PASS
  EVIDENCE: pending

- [ ] G6: stale-line reuse and Chinese cap messages
  CHECK: node tests/dispatch.test.js
  EXPECT: PASS
  EVIDENCE: pending

- [ ] G7: scene 170–180px, meet (no nose crop), glow, meteor, vertical fuel, flown row not clipped
  CHECK: node tests/ui-static.test.js
  EXPECT: PASS
  EVIDENCE: pending
