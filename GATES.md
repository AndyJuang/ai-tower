# Gates: StarBase v0.2.0 feedback

OWNS: lib/starbase.js, lib/config.js, lib/demo.js, lib/processes.js, lib/dispatch.js, server.js, public/**, tests/**, config.example.json, README.md, examples/starbase-report.sh, docs/STARBASE_PROGRESS.md, GATES.md

Scope: StarBase visual feedback plus equal-width bays and takeoff stale-line / live-only cap (Fixes #1)

- [ ] G1: JavaScript files parse
  CHECK: node tests/verify-starbase.js --syntax
  EXPECT: STARBASE_SYNTAX_OK
  EVIDENCE: pending

- [ ] G2: parser unit tests cover object/array/tasks/bad-json/status/link/hideHours
  CHECK: node tests/starbase.test.js
  EXPECT: PASS
  EVIDENCE: pending

- [ ] G3: demo API and HTML include StarBase
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

- [ ] G7: equal-width bays, wide pads, HOLD bar, fuel label, jump-to-card
  CHECK: node tests/ui-static.test.js
  EXPECT: PASS
  EVIDENCE: pending
