# Dead Code Audit

Generated on 2026-05-06 using GitNexus, static import reachability, `knip`, Vitest, and Vite build.

## GitNexus Summary

GitNexus was refreshed after the cleanup:

| Metric | Initial | After first pass | Current |
| --- | ---: | ---: | ---: |
| Files | 226 | 221 | 168 |
| Symbols / nodes | 2,272 | 2,238 | 1,907 |
| Edges | 5,049 | 4,937 | 4,141 |
| Clusters | 164 | 166 | 94 |
| Execution flows | 186 | 183 | 158 |

Current GitNexus list output:

```text
Stats: 168 files, 1907 symbols, 4141 edges
Clusters: 94
Processes: 158
```

## Removed

These files had no incoming GitNexus context, no production import path, and were reported by `knip` as unused or stale.

| Removed file | Reason |
| --- | --- |
| `src/components/batch/SleepModeWarning.jsx` | Unused component; GitNexus reported no incoming callers and no process participation. |
| `src/components/batch/SleepModeWarning.css` | Only imported by the removed `SleepModeWarning.jsx`. |
| `src/services/storageService.examples.js` | Example-only module, no production importers. |
| `src/services/wakeLockService.js` | No importers; GitNexus could not resolve it as a used symbol. |
| `src/services/batch/searchLogic.js` | Stale batch search implementation; no production importers, flagged by `knip`, and only referenced in a facade comment. |
| `batchEnrichment.js` | Standalone root script outside package scripts; duplicated app batch enrichment behavior and carried CSV-only dependencies. |
| `batchEnrichmentParallel.js` | Standalone root script outside package scripts; duplicated batch enrichment and required `dotenv` only for that script. |
| `batchEnrichmentPass2.js` | Standalone second-pass root script outside package scripts; duplicated search behavior and required removed CSV dependencies. |
| `debug_lucene_syntax.js` | Standalone debug script outside package scripts with a hardcoded INSEE API key. |
| `install_top_codex_skills.mjs` | Unreferenced Codex skill installer, unrelated to the app runtime or configured npm scripts. |
| `marketplace_skillbrowser.js` | Unreferenced generated/minified marketplace bundle at repo root. |
| `src/services/review/goldenReplayService.js` | Review harness had no production caller; its only test depended on a missing fixture. |
| `src/services/__tests__/goldenReplayService.test.js` | Stale test import pointed to missing `test/golden/phase4Phase6GoldenDataset.js`. |

The stale `test:golden` npm script was removed with the dead golden replay harness.

## Dependency Cleanup

Removed package entries that were only used by deleted dead code:

- `csv-parse`
- `csv-stringify`
- `dotenv`
- `@testing-library/user-event`

`package-lock.json` was updated by `npm uninstall` as a direct result of that dependency removal.

## Export Cleanup

`knip` reported no unused files after the root script cleanup, but it still found unused exports. Those were simplified by either deleting truly unused helpers or making module-local values private:

- Removed unused exported aliases such as `scorerUtils` and Gemini prompt aliases.
- Made internal config/catalog/dictionary constants private.
- Made `normalizeExtractionRow`, worker API-key constants, and initial-state constants private where only their module uses them.
- Removed unused logger and cache helpers.
- Removed unused Lucene query/address helper code from `src/utils/nameCleaners.js` while preserving `extractSearchParams`.

## Still Candidate Only

These remain intentionally because they are part of active app paths or covered by tests:

| Candidate | Why not removed now |
| --- | --- |
| `src/services/batch/workerQueue.js` and dependent batch/domain modules | Re-exported through `src/services/batchEnrichmentService.js` and used by the batch UI. |
| `src/services/progressManager.js` | Its exported class/state are covered by direct unit tests. Only the unused singleton export was removed. |
| `test/` and `insee_tests/` scripts | Standalone/manual scripts are outside the Vite app graph; no additional removal was made without a stronger ownership signal. |

## Remaining `knip` Findings

None.

## Verification

After removal:

```text
npx knip --no-exit-code --reporter compact
No findings

npx vitest run
37 test files passed
254 tests passed

npm run build
Vite production build passed
```

Build still emits the existing large chunk warning for `exceljs`, unrelated to the dead-code cleanup.
