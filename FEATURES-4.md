# Feature Sprint 4 — Batch 12 (records, lookups, export)

Fourth pass; none overlap with the first 73. All 6 implemented.

## Batch 12 — Records persistence, lookups & export
74. Records persistence — leaderboard saves to `records.json` (repo root) on
    game over and reloads at boot (`src/records.ts` `loadRecords`/`saveRecords`).
75. `%records <name>` — show one player's lifetime record.
76. `%records reset` — dev-only leaderboard clear.
77. Ability alias/prefix resolution in `%wt` / `%freq` — `findAbility` now
    matches exact → explicit alias → unique prefix.
78. `%find <query>` — substring search across classes, weapons, abilities, and
    items (capped at 20 results).
79. `%export` — full action-log transcript, formatted for pasting as a replay.

## Notes
- `records.json` is gitignored runtime state; the file path is overridable via
  `setRecordsFile()` (tests use it).
- Ability aliases (from the editor, feature 63) are now actually *consumed* at
  runtime — closing the earlier caveat.

## Verification
- `tsc --noEmit` clean.
- 442/442 tests pass (2 new: single-player lookup, save/load round-trip).
