# Feature Sprint 3 — Batch 11 (loot, records, game flow)

Third pass; none overlap with the first 60 (or the aliases/items group, which
is features 61–64 from the closed PRs #245–#248). All 9 implemented.

## Batch 11 — Loot, records & game flow
65. `%loot [entity]` — XP/gold/gems breakdown for the game (or one entity).
66. `%xp [entity]` — XP earned this game.
67. `%gold [entity]` — gold earned this game.
68. `%gems [entity]` — gems earned this game.
69. `%records [top N]` — lifetime leaderboard (kills/wins/games), auto-tracked
    at game over via `recordGame` (new `src/records.ts`). In-memory only.
70. `%surrender` (alias `%forfeit`) — a player concedes and is removed.
71. `%rematch` — host resets HP/statuses/scores and restarts on the same map.
72. `%coin` — coin flip.
73. `%pick <a>, <b>, <c>` — pick one option at random.

## Notes
- Features 65–68 wire the previously-unused `calculateLoot` in
  `src/game/state.ts` into real commands (the old `%loot`/`%xp`/`%gold` were
  "not yet implemented" stubs).
- `%records` is process-lifetime only; a disk-persistence follow-up is a
  candidate for a later PR.
- `%rematch` keeps the map, loadouts, and turn order; it resets per-entity
  state, kills, round, and the round timer.

## Verification
- `tsc --noEmit` clean.
- 440/440 tests pass (3 new `records.test.ts` cases).
