# Feature Sprint 2 — 30 more brainstormed features

Second pass; none overlap with the first 30.

## Batch 6 — Combat & targeting
31. Directional AoE: re-enable `needsDirection` and aim cone/line/beam/pierce.
32. Block movement onto occupied tiles.
33. `%terrain <pos>` — tile terrain + move cost.
34. `%los <a>,<b>` — line-of-sight check.
35. Auto-trigger reactions when an entity takes a hit.
36. `%moves [entity]` — list an entity's abilities.

## Batch 7 — Resources & status
37. `%resources [entity]` — show resource pools.
38. `%resource <entity>,<name>,<delta>` — host adjusts a resource.
39. `%mp <delta>[,entity]` — host adjusts MP.
40. `%uses [entity]` — show remaining ability uses.
41. `%buffs [entity]` — show active buffs.
42. `%cure <entity>` — clear removable statuses.

## Batch 8 — Team / spectate / chat
43. `%teams` — group entities by team.
44. `%spectate` — spectator game summary.
45. `%chat <msg>` — team-only chat.
46. `%premove list` — show queued premoves.
47. `%round` — round / turn / index info.
48. `%undo` alias for `%back`.

## Batch 9 — Robustness & UX
49. Cap snapshots (bound memory).
50. Cap chat log / toasts length.
51. `%log clear` — clear the action log.
52. `%pl` stable sort (team, then num).
53. `%info` inline cooldowns + uses.
54. `%wtm <ability>` — route to ability lookup.

## Batch 10 — Data / mechanics
55. `%rollstats <formula>` — min/avg/max of a dice formula.
56. `%freq <ability>` — explain an ability's frequency (uses + cooldown).
57. `%version` — game version + data summary.
58. `%statuses` — all entities' statuses at a glance.
59. `%summary` — one-line-per-entity round summary (HP, statuses, kills).
60. `%standings` — kills + HP leaderboard.
