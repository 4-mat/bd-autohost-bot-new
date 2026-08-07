Design a single strictly-defined, prose-first "BD lang" that can express EVERY ability and effect in this chunk. Inputs: \_data/\*.json (parsed 373-ability corpus), \_original_source/ (raw source sheets), move_sort_csv/ (sorted effect grids), EFFECT_SORT.md (per-category standard wording), current spec docs, ABILITY_GROUPS.json + \_group_effects.mjs, and src/game/effects.ts (the executor parser).

Requirements:

1. FULL coverage: every effect string in \_data/\*.json must map to a grammar rule. Any sentence that does not fit your grammar is a spec failure; show the rewrite.
2. Round-trip fidelity: parsing an authored ability must reproduce exact mechanics (damage rolls, status X/Y, dice, ranges, costs, targets, timing, conditions).
3. Prose-first but deterministic: full sentences a non-programmer can read/write; fixed sentence templates, bounded vocab, case-insensitive keywords, JSON-style escaping.
4. Use the grids: each move_sort_csv effect category has exactly one canonical template, using EFFECT_SORT.md standard wording.
5. Executor-aware: flag which templates need new executor support vs already handled in effects.ts.

Deliverables:

- Complete EBNF grammar.
- Full canonical template list (one per grid category) with what a parser must capture.
- 3-5 example abilities + 1 weapon + 1 class exercising hard cases (choose-1, conditional timing, resource sacrifice, tile placement, recoil/self-damage, passives, forced movement, status+duration).
- Coverage audit: table mapping each distinct corpus sentence pattern to your template, with counts; list sentences needing extension templates or rewrites.
- Ordered implementation steps (parser-first vs template-first, tokenizer primitives, round-trip validation).
- Explicit list of grammar holes left open and how authors handle them.
