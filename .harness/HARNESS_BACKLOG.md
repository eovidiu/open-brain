# Harness Backlog

Candidates the Phase 5.5 promotion and ablation passes have surfaced. Not
auto-applied: a human or a dedicated session executes a row, then marks it
promoted. Cross-project pattern aggregation is a future extension, not done
here -- this file is per-project.

| date | observation | proposed owner | evidence pointer | score | status | last_seen |
|---|---|---|---|---|---|---|
| 2026-08-09 | `.harness/init.sh full_test` runs only the mcp-server and cli suites; the four `workers/*` packages (shared, capture, retry, mcp — 222 of the repo's 396 tests) must be run by hand. A "full test" gate that covers a third of the codebase reports green on work it never executed. | hook change (init.sh) | Meta-Session 2026-08-09; init.sh:8 states the limit explicitly | 1 | candidate | 2026-08-09 |
| 2026-08-09 | SessionStart doctor warns `test_file does not exist` for 12 of 13 passing features. `test_file` is free text holding several comma-separated paths plus prose; the check stats the whole string as one path. Every warning this session was false, which trains the reader to skip the warning block. | hook change | Orientation block 2026-08-09; files verified present on disk | 1 | candidate | 2026-08-09 |
| 2026-08-09 | Editing a file that has no test coverage silently imports its debt into the current feature's coverage gate. `cli/src/steps/secrets.ts` was at 0% and a three-line deletion required writing an eight-test file to clear the gate. Worth surfacing at edit time, not at the gate. | not-yet | Meta-Session 2026-08-09 | 1 | candidate | 2026-08-09 |
| 2026-08-09 | A numbered procedure in the spec drifted from the branch order in the handler it described (§9.2 step 1 vs step 4) and survived five months. Mechanical to detect, invisible to review. | not-yet | docs/open-brain-spec.md §9.2, ADR-005 amendment | 1 | candidate | 2026-08-09 |

## Ablation

| date | control | verdict | reason |
|---|---|---|---|
| 2026-08-09 | SessionStart `test_file` existence warning | revise (matcher treats free-text prose as a single path; split on `,` and stat each, or stop asserting on a free-text field) | Fired 12 times, all false positives. |
| 2026-08-09 | `require_plan_approval` / `risk` on features.json | retain | F015's `standard` / `false` was the signal that settled whether to gate on a decision the feature had already scoped. Correct call, correctly recorded. |
