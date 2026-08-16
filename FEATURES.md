# Feature Sprint — 30 brainstormed features

Brainstormed and implemented in one pass. Cut freely from this list.

## Batch 1 — Engine correctness
1. Clamp HP at 0 in `dealDamage` (no negative HP).
2. Push/pull blocks when the destination tile is occupied.
3. Declare Attack phase message (announce the declared attack).
4. On Miss effect phase (effects that fire when the attack misses).
5. Before Damage effect phase.
6. Unify win-condition logic (`isWinCondition` vs `checkGameOver`).

## Batch 2 — BDLang parser
7. Colon syntax: `If COND: EFFECT`.
8. `Spend 2+ Qi` plus sign in resource amounts.
9. Phase markers (`New Moon` / `Full Moon` / `Waxing` / `Waning`).
10. `Per hit` / `Per X` clauses.
11. `When X` trigger clause recognition.

## Batch 3 — UX / commands
12. Team indicators in `%info` / `%pl` display.
13. No-viable-target cancel prompt.
14. Richer `%choose` buttons (contextual labels).
15. `%wt <ability>` specific lookup (targeted, less chat flood).
16. Spectator welcome message on join.
17. Elimination / kill-feed announcement.
18. Turn countdown reminder before auto-advance.

## Batch 4 — Quality / perf / config
19. Bound the send queue (max size + expiry).
20. Memoize parsed effects per ability (perf).
21. Config: devs list + custom prefix honored from config.
22. Config: turn timer duration option.
23. Config: event announcement toggles.
24. Docstrings on core exported functions.

## Batch 5 — New gameplay
25. Basic abilities beyond Dash (Basic Attack + Rest).
26. Lava terrain entry damage.
27. Status tick summary at turn start (DoT report).
28. `%turnorder` command (upcoming turn order).
29. `%cooldowns` command (ability cooldown status).
30. `%help <command>` per-command help.
