# Feature Checklist — for PR selection

Everything below is **already implemented and committed** on the branch
`feat/feature-sprint` (worktree `bd-autohost-bot-new-wtfs`). The branch is
**22 commits ahead of `origin/master`** and **not pushed**; `master` is
untouched. The four earlier draft PRs (#245–#248) were closed and their remote
branches deleted.

> How to use this: check the features you want to ship, then ask an agent to
> split the corresponding commits from `feat/feature-sprint` into focused
> PRs targeting `master`. Each feature below lists its commit so it can be
> cherry-picked / diffed independently.

## Suggested PR groupings

Pick whole groups (or individual features) with `[x]`.

### A. Engine correctness — commit `e4b0062`
- [ ] 1. Clamp HP at 0 in `dealDamage`
- [ ] 2. Push/pull blocks when the destination tile is occupied
- [ ] 3. Declare Attack phase message
- [ ] 4. On Miss effect phase
- [ ] 5. Before Damage effect phase
- [ ] 6. Unify win-condition logic

### B. BDLang parser — commit `bba6a18`
- [ ] 7. Colon syntax `If COND: EFFECT`
- [ ] 8. `Spend 2+ Qi` amounts
- [ ] 9. Phase markers (New/Waxing/Full/Waning)
- [ ] 10. `Per hit` clauses
- [ ] 11. `When X` trigger clauses

### C. UX / commands — commit `b4ea9fe`
- [ ] 12. Team indicators in `%pl`
- [ ] 13. No-viable-target `%cancel` hint
- [ ] 14. `%choose` shows `id = label`
- [ ] 15. `%wt <ability>` targeted lookup
- [ ] 16. Spectator welcome on join
- [ ] 17. Kill-feed announcements
- [ ] 18. 10s shot-clock warning

### D. Quality / perf / config — commit `262ae31`
- [ ] 19. Bound send queue (cap + expiry)
- [ ] 20. Memoized effect parsing
- [ ] 21. `config.devs` → `%dev`
- [ ] 22. `turnTimerSeconds` config
- [ ] 23. `announcements.{kills,timer,join}` toggles
- [ ] 24. Docstrings on core utils

### E. New gameplay — commit `f8ca0de`
- [ ] 25. Basic Attack + Rest for every entity
- [ ] 26. Lava entry damage (already present; documented)
- [ ] 27. DoT summary at turn start
- [ ] 28. `%turnorder` alias
- [ ] 29. `%cooldowns` command
- [ ] 30. `%help <command>`

### F. Combat & targeting — commit `eb06ad1`
- [ ] 31. Directional AoE aiming
- [ ] 32. Block movement onto occupied tiles
- [ ] 33. `%terrain <pos>`
- [ ] 34. `%los <a>,<b>`
- [ ] 35. Auto-trigger reactions on hit
- [ ] 36. `%moves [entity]`

### G. Resources & status — commit `5564905`
- [ ] 37. `%resources [entity]`
- [ ] 38. `%resource <entity>,<name>,<delta>`
- [ ] 39. `%mp <delta>[,entity]`
- [ ] 40. `%uses [entity]`
- [ ] 41. `%buffs [entity]`
- [ ] 42. `%cure <entity>`

### H. Team / spectate / chat — commit `4bf98da`
- [ ] 43. `%teams`
- [ ] 44. `%spectate`
- [ ] 45. `%chat <msg>`
- [ ] 46. `%premove list`
- [ ] 47. `%round`
- [ ] 48. `%undo` alias

### I. Robustness & UX — commits `f679227` + `ceab7f8`
- [ ] 49. `%log tail <N>` / `%log clear`
- [ ] 50. Cap chat (200) / toasts (20)
- [ ] 51. `%pl` stable sort
- [ ] 52. `%info` cooldowns + uses
- [ ] 53. `%data` counts
- [ ] 54. **Routing fix** — 20 game commands were dead; now routed

### J. Data / mechanics — commit `5683418`
- [ ] 55. `%rollstats <formula>`
- [ ] 56. `%freq <ability>`
- [ ] 57. `%version`
- [ ] 58. `%statuses`
- [ ] 59. `%summary`
- [ ] 60. `%standings`

### K. Aliases & items (was PRs #245–#248) — commits `a596b32`, `367905e`, `3332e78`, `6ba8422`, `8735e45`
- [ ] 61. `%j` alias for `%join`
- [ ] 62. Short class/weapon name lookups (`resolveName`: exact → alias → unique prefix)
- [ ] 63. Editor `aliases` field on classes / weapons / abilities
- [ ] 64. Items workflow (beta): `ItemData` model, editor section, `%wt <item>`, `%vi`

### L. Loot, records & game flow (batch 11) — commit `2d1c914`
- [ ] 65. `%loot [entity]`
- [ ] 66. `%xp [entity]`
- [ ] 67. `%gold [entity]`
- [ ] 68. `%gems [entity]`
- [ ] 69. `%records [N]` lifetime leaderboard (`src/records.ts`, in-memory)
- [ ] 70. `%surrender` / `%forfeit`
- [ ] 71. `%rematch`
- [ ] 72. `%coin`
- [ ] 73. `%pick`

## Deferred ideas (not implemented)
- [ ] Persist `%records` to disk across bot restarts
- [ ] `%records reset` (clear the leaderboard)
- [ ] Item equip / slot / `%buyitem` runtime (items are data + lookup only)
- [ ] Ability-alias *consumption* at runtime (`findAbility` lives on this branch;
      plugs into `resolveName` once merged)
- [ ] AFK / timeout detection
- [ ] Surrender vote (majority) vs individual concede

## Verification state (at time of writing)
- `tsc --noEmit` clean
- 440/440 tests pass (19 files)
