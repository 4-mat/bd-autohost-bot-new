# Battle Dome — Full-Codebase Review Findings

Synthetic Greptile review of the entire `bd-autohost-bot-new` repository.
Because a whole-repo diff exceeds Greptile's limits, the codebase was split into 13 chunks, each reviewed against an empty tree base (`empty-base`) so the diff is exactly the chunk's files. Greptile's graph index still provides full-repo context.

- Method: Greptile CLI `greptile review -b empty-base` per chunk + Greptile GitHub app reviews on chunk PRs (with flowcharts).
- 16 real findings (15 P1, 1 P2), 6 chunk-artifact false positives, 2 `.xlsx` binaries not reviewed.

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

### src/commands/ (PR #76, review-commands)

9. **P1 Security — `%back` undo without authorization** (`src/commands/game.ts:907`)
   Any room user routed to `%back` pops the latest game snapshot with no host/controller check.

### connection / login / parser (PR #77, review-core)

10. **P1 — Room-framed / batched Showdown payloads dropped** (`src/connection.ts:18`)
    The inbound handler assumes one pipe-prefixed event per WebSocket message, discarding `>room` headers and newline-batched events (room chat, commands, membership).

### src/html + src/sheets (PR #78, review-htmlsheets)

11. **P1 — Multiline CSV cells split into fake rows** (`src/sheets/scraper.ts:32`)
    Quoted fields containing newlines are split into separate records before CSV parsing, corrupting diffs and compliance results.
12. **P1 — Pending snapshot replaces approved baseline** (`src/sheets/scraper.ts:126`)
    On a second check before approval, `pending` becomes the comparison baseline, so an unchanged remote sheet reports no changes even though edits remain unapproved.
13. **P1 — First-run crash in `savePending`** (`src/sheets/state.ts:54`)
    `writeFileSync` runs before `.sheets-state/` exists, causing ENOENT on first check.

### \_data/ (PR #84, review-databin)

14. **P1 — `.docx` files are plain text mislabeled** (`_data/How to Play BD 4.4.docx`, `_data/Kyubs Help Page.docx`)
    Both use the `.docx` extension without Office Open XML package structure; DOCX readers reject them.

### \_original_source/ (PR #85, review-origsource)

15. **P2 — Unavailable working-copy paths** (`_original_source/README-ORIGINAL.txt:9`)
    Preservation guidance points to `../_data/` and `../src/`, which don't exist in this checkout; contributors can't follow the documented update process.

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

| Chunk branch      | PR  | CLI review ID                        |
| ----------------- | --- | ------------------------------------ |
| review-scripts    | #74 | 768ba424-7ec8-40bb-b7b2-a34c2a6980f6 |
| review-game       | #75 | 49d2fd30-6d2b-405a-9e5f-00dccb05d677 |
| review-commands   | #76 | b1b24629-663d-45a7-9522-7c26c5afd7de |
| review-core       | #77 | cb761751-43ad-40dd-8642-c3795069fe83 |
| review-htmlsheets | #78 | 5c35e558-2950-49af-84cb-b2db42ac7839 |
| review-data       | #79 | 0abe4d26-19a7-4b38-8a86-d78dc1745556 |
| review-config     | #80 | bf3c38fb-96bd-48fb-8f0e-862cbfaa5592 |
| review-bigdata    | #81 | 60fea8c9-a139-4d19-a27a-fd136f30ec5a |
| review-datatext   | #82 | a220028a-43f9-4151-b959-e671469e27f6 |
| review-datacsv    | #83 | b53eee58-7746-49d7-92c4-554412cf57d3 |
| review-databin    | #84 | 26d8ccec-433a-4ed9-a49b-bcdabcad842b |
| review-origsource | #85 | 03c02809-f816-40bb-a776-9fb3d5baf67e |
| review-tests      | #86 | 82c4596f-57fb-4210-8063-85287d915160 |

Re-open a CLI review anytime with `greptile review show <ID>` (run from the `bd-autohost-fullreview` worktree).

The 13 PRs (#74–#86, base `empty-base`) are synthetic review-only PRs — **do not merge**; safe to close.
