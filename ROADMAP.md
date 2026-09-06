# Roadmap — Data structures, performance & review hygiene

This is the tracking doc for the data-shape / performance cleanup effort
(following the Linus principle: *worry about data structures, not code*).
Full detail per structure lives in [docs/data-shape-audit.md](docs/data-shape-audit.md).

## Review checklist rule (adopted for all code reviews)

For every new or changed data structure, reviewers must answer three
questions before approving:

1. **Cardinality** — how many items (worst case)?
2. **Access pattern** — keyed lookup, scan, or iterate-all? Mutated in place?
3. **Frequency** — per command / per attack / per hit?

Right structure follows mechanically:

- N ≤ ~10, scan/iterate → **array**
- Keyed lookup, any N → **Map / Record** by natural id
- Immutable input, recomputed per use → **parse/derive once, cache**
- Membership tests in a loop → **Set**
- Ordered iteration → **array**

A wrong structure only matters when frequency is high — per-hit combat code
*is* high frequency, so this question belongs in every review of `src/game/`.

## Workstreams

### 1. Combat data shapes (done / in flight)
- [ ] **#200 → #201** `AbilityData.effect` parse-once + combat metadata cache — *in flight: PR #201*
- [x] Data shape audit written → [docs/data-shape-audit.md](docs/data-shape-audit.md)
- [ ] **#182** confirm `getPassiveRangeBonus` / `getDefenderDiceMods` inRange hot path is covered by the #201 cache
- [ ] Precompute `parsePushPull` / `parseMultiHit` / heal detection onto the cached parse (drop ad-hoc regex passes)

### 2. Review hygiene
- [x] Standing review rule (above) written into this roadmap
- [ ] Make the rule visible to review bots: post it as a pinned comment on PRs touching `src/game/`, or add to AGENTS.md / CODE_REVIEW_GUIDE

### 3. Follow-on structure work (proposed)
- [ ] `.gitattributes` line-ending normalization (`* text=auto eol=lf`) to kill CRLF diff noise (keeps burning review time on fake 4000-line diffs)
- [ ] Target group strings (`targetGroup` free text matched with `.includes`) → enum/ids with a lookup table, if the set is closed
- [ ] Evaluate spatial index for tile targeting only if entity count ever grows past ~20 (not now — arrays are correct at N ≤ 8)
