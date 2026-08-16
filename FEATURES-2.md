# Feature Sprint 2 — 30 more brainstormed features

Second pass; none overlap with the first 30. All 30 implemented (commits below).

## Batch 6 — Combat & targeting ✅
31. Directional AoE: re-enable `needsDirection` and aim cone/line/beam/pierce.
32. Block movement onto occupied tiles.
33. `%terrain <pos>` — tile terrain + move cost.
34. `%los <a>,<b>` — line-of-sight check.
35. Auto-trigger reactions when an entity takes a hit.
36. `%moves [entity]` — list an entity's abilities.

## Batch 7 — Resources & status ✅
37. `%resources [entity]` — show resource pools.
38. `%resource <entity>,<name>,<delta>` — host adjusts a resource.
39. `%mp <delta>[,entity]` — host adjusts MP.
40. `%uses [entity]` — show remaining ability uses.
41. `%buffs [entity]` — show active buffs.
42. `%cure <entity>` — clear removable statuses.

## Batch 8 — Team / spectate / chat ✅
43. `%teams` — group entities by team.
44. `%spectate` — spectator game summary.
45. `%chat <msg>` — team-only chat.
46. `%premove list` — show queued premoves.
47. `%round` — round / turn / index info.
48. `%undo` alias for `%back`.

## Batch 9 — Robustness & UX ✅
49. `%log tail <N>` — last N action-log entries. *(replaced "cap snapshots" — already capped at 20)*
50. Cap chat log (200) / toasts (20) length.
51. `%log clear` — host clears the action log.
52. `%pl` stable sort (team, then numeric num).
53. `%info` inline cooldowns + remaining uses.
54. `%data` — loaded-data counts (classes/weapons/abilities/WhatIs/refs). *(replaced "%wtm" — alias already exists)*

## Batch 10 — Data / mechanics ✅
55. `%rollstats <formula>` — min/avg/max of a dice formula.
56. `%freq <ability>` — explain an ability's frequency (uses + cooldown).
57. `%version` — BD data version of the active game.
58. `%statuses` — all entities' statuses at a glance.
59. `%summary` — one-line-per-entity round summary (HP, statuses, kills).
60. `%standings` — kills + HP leaderboard.

## Also fixed
- **Routing bug**: 20 sprint-1/2 game commands (`%log`, `%cooldowns`, `%teams`, `%terrain`, `%los`, `%moves`, `%resources`, `%resource`, `%mp`, `%uses`, `%buffs`, `%cure`, `%spectate`, `%chat`, `%round`, `%undo`, `%turnorder`, `%dir`, `%tile`, `%cds`) were handled in `game.ts` but never routed from `index.ts`, so they were dead in production. Routed them all.

## Verification
- `tsc --noEmit` clean.
- 437/437 tests pass.

## Commits
- `e4b0062`…`4bf98da` — batches 6–8 (features 31–48)
- `f679227` — routing fix
- `ceab7f8` — batch 9 (49–54)
- batch 10 (55–60) — uncommitted at time of writing
