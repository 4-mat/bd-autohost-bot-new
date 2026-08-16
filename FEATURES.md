# Feature Sprint — 30 brainstormed features

Brainstormed and implemented in one pass. Cut freely from this list.
Status: `done` = implemented in this sprint; `already` = the codebase already
covered it, noted here for completeness.

## Batch 1 — Engine correctness
1. Clamp HP at 0 in `dealDamage` (no negative HP). — done
2. Push/pull blocks when the destination tile is occupied. — done
3. Declare Attack phase message (announce the declared attack). — done
4. On Miss effect phase (effects that fire when the attack misses). — done
5. Before Damage effect phase. — done
6. Unify win-condition logic (`isWinCondition` vs `checkGameOver`). — done

## Batch 2 — BDLang parser
7. Colon syntax: `If COND: EFFECT`. — done
8. `Spend 2+ Qi` plus sign in resource amounts. — done
9. Phase markers (`New Moon` / `Full Moon` / `Waxing` / `Waning`). — done
10. `Per hit` / `Per X` clauses. — done
11. `When X` trigger clause recognition. — done

## Batch 3 — UX / commands
12. Team indicators in `%info` / `%pl` display. — done (added `T#` to `%pl`)
13. No-viable-target cancel prompt. — done (defensive `%cancel` hint)
14. Richer `%choose` buttons (contextual labels). — done (`id = label`)
15. `%wt <ability>` specific lookup (targeted, less chat flood). — done
16. Spectator welcome message on join. — done
17. Elimination / kill-feed announcement. — done
18. Turn countdown reminder before auto-advance. — done (10s warning)

## Batch 4 — Quality / perf / config
19. Bound the send queue (max size + expiry). — done
20. Memoize parsed effects per ability (perf). — done
21. Config: devs list + custom prefix honored from config. — done (`%dev`)
22. Config: turn timer duration option. — done (`turnTimerSeconds`)
23. Config: event announcement toggles. — done (`announcements.{kills,timer,join}`)
24. Docstrings on core exported functions. — done (utils + helpers)

## Batch 5 — New gameplay
25. Basic abilities beyond Dash (Basic Attack + Rest). — done
26. Lava terrain entry damage. — already (end-of-turn lava damage in
    `processEndOfTurn`; lava stays impassable by design)
27. Status tick summary at turn start (DoT report). — done (consolidated line)
28. `%turnorder` command (upcoming turn order). — done (alias of `%to`)
29. `%cooldowns` command (ability cooldown status). — done
30. `%help <command>` per-command help. — done
