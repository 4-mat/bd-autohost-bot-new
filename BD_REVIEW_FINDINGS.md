# Battle Dome — Full-Codebase Review Findings

Synthetic Greptile review of the entire `bd-autohost-bot-new` repository.
Because a whole-repo diff exceeds Greptile's limits, the codebase was split into 13 chunks, each reviewed against an empty tree base (`empty-base`) so the diff is exactly the chunk's files. Greptile's graph index still provides full-repo context.

- Method: Greptile CLI `greptile review -b empty-base` per chunk + Greptile GitHub app reviews on chunk PRs (with flowcharts).
- 31 real findings (26 P1, 5 P2), 6 chunk-artifact false positives, 2 `.xlsx` binaries not reviewed.
- 13 chunk reviews (PRs #74–#86) plus a deep adversarial pass over the game engine (PR #88), a combat-flow conformance check (PR #89), an attack-builder review (PR #91), a BD-lang design review (PR #92), and a complete-coverage BD-lang design pass (PR #94, resulting in `BD_LANG_V1_SPEC.md`).

## Real findings

### test-app.ts / scripts (PR #74, review-scripts)

1. **P1 Security — username-only identity impersonation** (`test-app.ts:627`)
   Any client can authenticate as any host or player by supplying a known name; name-based role resolution then grants the corresponding GUI and command access. No credentials or ownership proof.
2. **P1 Security — team chat crosses team boundaries** (`test-app.ts:768`)
   `/t` delivers the message to every player without comparing teams, exposing private chat to opponents and letting non-players post.
3. **P1 Security — DOM XSS via unsanitized HTML** (`test-app.ts:1182`)
   Player names and team-chat messages are concatenated into markup and assigned through `innerHTML`, enabling same-origin script execution.
4. **P1 — Tile ability controls unreachable** (`scripts/pages-render-alt.ts:607`)
   The generic `%use` branch runs before the tile-button branch, so players can never select a valid tile for Tile abilities.
5. **P1 — Rejected maps still emitted** (`scripts/parse-maps.ts:334`)
   The generation loop iterates `maps` instead of `filtered`, so terrain-artifact / undersized maps land in the runtime registry despite being reported as filtered.

### src/game/ — core engine (PR #75, review-game)

6. **P1 Security — prompted cost bypass** (`src/game/resolve.ts:502`)
   Any choice ID other than `pay_cost` makes `applySelection` return success without deducting cost, letting abilities resolve for free.
7. **P1 — Foes do not block targeting** (`src/game/state.ts:456`)
   `hasLineOfSight` checks only terrain, so Range/Star/Line/Pierce attacks hit through living foes.
8. **P1 — Forced movement ignores occupants** (`src/game/state.ts:943`)
   `isPassable` checks only terrain, so push/pull can move entities onto occupied tiles (overlap).

**Deep adversarial pass (PR #88, deep-game)** — review ID `002354cf-ce2c-4a80-a9c7-d5ce2e3a5a40`. Engine reviewed together with its test suite.

9. **P1 — Resource effects leave stale state** (`src/game/effects.ts:1391`)
   Gain/spend/lose branches only log and never update `user.resources`, so later costs and Thirst read unchanged values.
10. **P1 — Unsupported conditions activate effects** (`src/game/effects.ts:1521`)
    `evaluateCondition` failure falls through to `thenEffects`, so guarded damage/statuses/buffs fire without their prerequisite.
11. **P1 — Cost consumed before target validation** (`src/game/resolve.ts:183`)
    A paid ability with no valid/invalid target deducts HP/MP/resource and never refunds it.
12. **P1 — Pathfinding crosses occupied tiles** (`src/game/state.ts:417`)
    The BFS enqueues a living-entity tile as an intermediate node, so destinations behind a blocker report as reachable.

### src/commands/ (PR #76, review-commands)

13. **P1 Security — `%back` undo without authorization** (`src/commands/game.ts:907`)
    Any room user routed to `%back` pops the latest game snapshot with no host/controller check.

### connection / login / parser (PR #77, review-core)

14. **P1 — Room-framed / batched Showdown payloads dropped** (`src/connection.ts:18`)
    The inbound handler assumes one pipe-prefixed event per WebSocket message, discarding `>room` headers and newline-batched events (room chat, commands, membership).

### src/html + src/sheets (PR #78, review-htmlsheets)

15. **P1 — Multiline CSV cells split into fake rows** (`src/sheets/scraper.ts:32`)
    Quoted fields containing newlines are split into separate records before CSV parsing, corrupting diffs and compliance results.
16. **P1 — Pending snapshot replaces approved baseline** (`src/sheets/scraper.ts:126`)
    On a second check before approval, `pending` becomes the comparison baseline, so an unchanged remote sheet reports no changes even though edits remain unapproved.
17. **P1 — First-run crash in `savePending`** (`src/sheets/state.ts:54`)
    `writeFileSync` runs before `.sheets-state/` exists, causing ENOENT on first check.

### \_data/ (PR #84, review-databin)

18. **P1 — `.docx` files are plain text mislabeled** (`_data/How to Play BD 4.4.docx`, `_data/Kyubs Help Page.docx`)
    Both use the `.docx` extension without Office Open XML package structure; DOCX readers reject them.

### \_original_source/ (PR #85, review-origsource)

19. **P2 — Unavailable working-copy paths** (`_original_source/README-ORIGINAL.txt:9`)
    Preservation guidance points to `../_data/` and `../src/`, which don't exist in this checkout; contributors can't follow the documented update process.

## Attack builder (PR #91, review-attackbuilder)

Deep review of the attack builder and its resolver (review ID `814833e3-cd97-4665-9dbd-a957e92954e4`): `handleAttack` in `src/commands/game.ts` builds `pendingAction`; `resolveAction` in `src/game/resolve.ts` consumes it. Confidence 1/5 — not safe to merge until prompted costs are enforced and pending-action cancellation/replacement restore action state.

20. **P1 — Pending actions overwrite reserved slots** (`src/commands/game.ts:474-486`)
    Selecting another ability while one awaits a prompt replaces the pending action without restoring the first declaration's reserved slot (e.g. replacing a pending Swift with a Standard leaves `swiftUsed` set; cancellation can restore only the Standard slot).
21. **P1 — Cancellation retains Trigger authorization** (`src/commands/game.ts:777-782`)
    Cancelling a Trigger leaves the declaration's triggered flag set, so the entity can use a Reaction even though the Trigger that authorized it never resolved.
22. **P1 Security — Prompted costs accept unpaid choices** (`src/game/resolve.ts:493-496`)
    Submitting any `%choose` value other than `pay_cost` makes `applySelection` return success without calling `autoDeductCost`, so the ability resolves for free.
23. **P1 — Invalid targets still consume costs** (`src/game/resolve.ts:1673-1697`)
    A cost-bearing ability with an invalid/dead/out-of-range target deducts its cost before target validation and completes without refund, losing HP/MP/resources for an action with no effect.

## BD lang design (PR #92, review-bdlang)

Design consultation on the spec docs (BD_LANG_SPEC, BD_LANG_REWORDING_GUIDE, EFFECT_LANGUAGE_SPEC, EFFECT_SORT), move_sort_csv grids, `_group_effects.mjs`, and the `src/game/effects.ts` parser (review ID `0c853c3a-ab3a-44b3-9d0e-3304f73efcb8`). Confidence 4/5 — safe to iterate; unify the dialects before presenting as executable/contributor-ready.

**Recommended direction:** keep the labeled envelope, explicit action-resolution stages, bounded vocab, and grid coverage; replace the slash dialect + `plain_english_text` fallback with **one canonical prose syntax** (`[Timing,] Subject Verb Arguments [for Duration] [if Condition]`); bounded case-insensitive keywords; JSON-style escaping; CSV rows as grammar-coverage fixtures (category, canonical template, subject, timing, parameters, example, parser/executor support, representative moves). Full prose examples (Bloodrush ability, Ember Spear weapon) are in the review.

24. **P2 — Grouping inputs not reproducible** (`_group_effects.mjs:2-15`)
    The script reads fixed `_data/*.json` files that aren't in the checked-in artifacts (only CSV grids are), so `ABILITY_GROUPS.json` can't be regenerated from the design artifacts; needs checked-in inputs or direct CSV ingestion.
25. **P2 — Canonical syntaxes conflict** (`BD_LANG_SPEC.md:154-182`)
    Grammar, examples, and the effect standard define different canonical forms for the same mechanics; the parser mainly recognizes slash notation and treats unmatched clauses as unknown, leaving documented prose only partially executable.
26. **P2 — Tile token has two meanings** (`BD_LANG_SPEC.md:548-552`)
    The map vocabulary assigns `K` to both Broken and Sticky terrain; a deterministic language needs one meaning per token.
27. **P2 — Resource qualifiers are discarded** (`src/game/effects.ts:706-717`)
    `Spend 3 Mana (only on hit)` loses its timing qualifier in the regex, so integrated resolution would spend resources under different conditions than the author specified.
28. **P2 — Unknown conditions execute as true** (`src/game/effects.ts:1523`)
    Unhandled conditions (e.g. `at maximum range`) fall through `evaluateCondition` to the positive branch, applying gated effects instead of erroring or remaining unapplied.

## BD lang complete-coverage design (PR #94, review-bdlang2)

Follow-up to the bdlang design review. Chunk = the FULL corpus (`_data/*.json` 373 abilities), `_original_source/` raw sheets, `move_sort_csv` grids, `EFFECT_SORT.md`, current specs, `_group_effects.mjs`, and `effects.ts` (review ID `b0638d02-62c0-419e-8602-9fb28f80debf`). Confidence 2/5 on the draft specs.

29. **P1 — Corpus coverage remains unaudited** (`BD_LANG_SPEC.md:1-3`)
    The spec claims completeness with no exhaustive sentence-pattern mapping (counts + rewrites), so collapsed mechanics can't be caught during parser validation.
30. **P1 — Stat syntax breaks round trips** (`BD_LANG_SPEC.md:166-170`)
    `Buff: +ATK 5 for 1 round` / HP modifiers: `parseStatMods` expects the number before the stat, captures durations only as `/N`, and excludes HP — so duration or the whole modifier is lost on execution.
31. **P1 — Fallback defeats deterministic parsing** (`BD_LANG_SPEC.md:255-257`)
    `plain_english_text` accepts any unmatched effect as valid opaque text, so unsupported mechanics pass validation unparsed/un-round-tripped.

**Outcome — `BD_LANG_V1_SPEC.md`** (on PR #94): a complete prose-first BD lang designed against the corpus — full EBNF grammar (no fallback; unknown sentences are parse errors with line:column), one canonical template per grid category (T01–T40, each annotated HANDLED/PARTIAL/NEW vs `effects.ts`), example ability/weapon/class, a corpus pattern→template coverage audit with counts and verbatim nasty-sentence rewrites, ordered implementation steps (vocab → tokenizer → splitter → matchers → AST → round-trip validator → executor extension), and 8 deliberately open grammar holes (tabled rolls, event-history conditions, HP-percentage conditions, damage redirection, subweapon branches, etc.).

## Combat-flow conformance (PR #89, flowcheck-combat)

The attack-resolution pipeline was checked against the intended 10-step combat flowchart (review ID `a198d421-8df3-4bfc-a14b-56904b61d5bb`). Overall verdict: the order is roughly right (costs → target → acc → damage → cleanup), but the code is **not conformant**.

| Step                                           | Status                                                               | Code                                                                                                                         |
| ---------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Declare Attack                              | Partial                                                              | `handleAttack` builds `pendingAction` + announces (`commands/game.ts:475`); resolver declaration disabled (`resolve.ts:180`) |
| 2. Selection / Choices / Sacrifice / Pay Costs | Runs, but forged `%choose` bypasses cost                             | `resolve.ts:183`, `resolve.ts:498`                                                                                           |
| 3. Target                                      | Runs; invalid/no target stops **without rollback**                   | `resolve.ts:221`, `resolve.ts:184`                                                                                           |
| 4. Before Acc                                  | **Skipped**                                                          | `resolve.ts:668`                                                                                                             |
| 5. Acc                                         | Runs; misses skip the hit branch                                     | `resolve.ts:668`                                                                                                             |
| 6. Before Damage                               | **Skipped**                                                          | `resolve.ts:681`                                                                                                             |
| 7. Damage                                      | Runs                                                                 | `resolve.ts:682`                                                                                                             |
| 8. On Hit / On Miss                            | **No distinct phase**; effects run post-damage on hits, none on miss | `resolve.ts:724`, `resolve.ts:763`                                                                                           |
| 9. Regardless of Hit                           | **No general phase**; only a hard-coded Confusion check              | `resolve.ts:763`                                                                                                             |
| 10. Cleanup / After Resolving                  | Runs                                                                 | `resolve.ts:328`, `game.ts:750`                                                                                              |

Deviations (P1s): target failure retains paid cost/action slot (`resolve.ts:184-191`); prompted cost bypass via forged choice (`resolve.ts:503-506`); required combat hooks (Before Acc / Before Damage / On Miss / Regardless) skipped — the full effect stream is dumped into the hit branch (`resolve.ts:724-727`).

## Chunk-artifact false positives (not real)

The partial-tree diffs made Greptile report missing imports/entrypoints. The full repo resolves all of these (typecheck/build pass).

- `src/commands/index.ts:1-2` "required modules absent" (review-commands)
- `src/index.ts:3` "required modules missing" (review-core)
- `src/html/pages.ts:1-15` "required runtime modules absent" (review-htmlsheets)
- `src/data/maps.ts:1` "Terrain module cannot resolve" (review-data)
- `package.json:8` "build entrypoints missing" (review-config)
- `src/__tests__/calc.test.ts:2` + all nine test files "implementation modules missing" (review-tests)

## Clean chunks

No findings (5/5 confidence): `review-bigdata` (data/abilities.json + .sheets-state), `review-datatext` (\_data text), `review-datacsv` (\_data CSVs).

## Not reviewed

- 2 `.xlsx` binaries skipped by Greptile in each of `review-databin` / `review-origsource` (Glossary.xlsx, Homepage 7-22.xlsx).

## Appendix — chunk → PR → review ID

| Chunk branch         | PR  | CLI review ID                        |
| -------------------- | --- | ------------------------------------ |
| review-scripts       | #74 | 768ba424-7ec8-40bb-b7b2-a34c2a6980f6 |
| review-game          | #75 | 49d2fd30-6d2b-405a-9e5f-00dccb05d677 |
| review-commands      | #76 | b1b24629-663d-45a7-9522-7c26c5afd7de |
| review-core          | #77 | cb761751-43ad-40dd-8642-c3795069fe83 |
| review-htmlsheets    | #78 | 5c35e558-2950-49af-84cb-b2db42ac7839 |
| review-data          | #79 | 0abe4d26-19a7-4b38-8a86-d78dc1745556 |
| review-config        | #80 | bf3c38fb-96bd-48fb-8f0e-862cbfaa5592 |
| review-bigdata       | #81 | 60fea8c9-a139-4d19-a27a-fd136f30ec5a |
| review-datatext      | #82 | a220028a-43f9-4151-b959-e671469e27f6 |
| review-datacsv       | #83 | b53eee58-7746-49d7-92c4-554412cf57d3 |
| review-databin       | #84 | 26d8ccec-433a-4ed9-a49b-bcdabcad842b |
| review-origsource    | #85 | 03c02809-f816-40bb-a776-9fb3d5baf67e |
| review-tests         | #86 | 82c4596f-57fb-4210-8063-85287d915160 |
| deep-game            | #88 | 002354cf-ce2c-4a80-a9c7-d5ce2e3a5a40 |
| flowcheck-combat     | #89 | a198d421-8df3-4bfc-a14b-56904b61d5bb |
| review-attackbuilder | #91 | 814833e3-cd97-4665-9dbd-a957e92954e4 |
| review-bdlang        | #92 | 0c853c3a-ab3a-44b3-9d0e-3304f73efcb8 |
| review-bdlang2       | #94 | b0638d02-62c0-419e-8602-9fb28f80debf |

Re-open a CLI review anytime with `greptile review show <ID>` (run from the `bd-autohost-fullreview` worktree).

The PRs (#74–#86, #88, #89, #91, #92, #94, base `empty-base`) are synthetic review-only PRs — **do not merge**; safe to close.
