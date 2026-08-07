# BD Lang Complete-Coverage Design Task

This chunk contains the FULL Battle Dome ability corpus and its design artifacts. Your job is to design a single, strictly-defined, prose-first "BD lang" that can express EVERY current ability and effect exactly.

## What is in this chunk

- `_data/*.json` — the parsed Battle Dome 4.4 ability corpus (373 abilities across Classes, Archer, Clairvoyant, Dark, Dueler, Heavy, Noble, Sorcerer, Trophy). Fields include `effect` (the raw effect sentence), `damage` (roll/dice/type), `range`, `action`, `frequency`, `targetGroup`, `targetAmount`, `cooldown`, `uses`, `duration`, and more.
- `_original_source/` — the raw source sheets this corpus was parsed from (Glossary.txt, per-class Homepage CSVs, Homepage.txt).
- `move_sort_csv/` — the sorted effect/move grid views (`Effects-Grid view.csv`, `Moves-Grid view.csv`) tagging each move with its design categories.
- `EFFECT_SORT.md` — effect categories with the standard wording pattern and every ability that uses it.
- `BD_LANG_SPEC.md`, `EFFECT_LANGUAGE_SPEC.md`, `BD_LANG_REWORDING_GUIDE.md` — the current (draft, competing-dialects) language specs.
- `ABILITY_GROUPS.json` + `_group_effects.mjs` — the effect-grouping inventory and its generator.
- `src/game/effects.ts` — the actual executor parser that runs effects in-game.

## Design requirements

1. **Full coverage**: The language MUST be able to express every effect sentence in the corpus — do an exhaustive pass over `_data/*.json`. Every `effect` string must map to a grammar rule. Treat any sentence that does NOT fit your grammar as a spec failure and show how to rewrite it in your syntax.
2. **Round-trip fidelity**: Given an ability authored in BD lang, parsing it must reproduce the exact mechanical content (damage roll, status X/Y, dice faces, ranges, costs, targets, timing hooks, conditions).
3. **Strictly defined but human-first**: full prose sentences a non-programmer can read and write; deterministic to parse (fixed sentence templates, bounded vocab, case-insensitive keywords, JSON-style escaping for names).
4. **Use the grids**: incorporate the `move_sort_csv` category vocabulary and the `EFFECT_SORT.md` "standard wording" as the canonical sentence templates. Every distinct effect category in the grids must have exactly one canonical template.
5. **Executor-aware**: check each proposed template against what `src/game/effects.ts` already parses/runs; flag which templates need new executor support and which are already handled.

## Deliverables in your review

- A complete grammar (EBNF) for the language.
- The full template list — one canonical prose template per grid category — with the status code column indicating what a parser must capture (subject, verb, amounts, dice, duration, condition, timing).
- 3–5 fully written example abilities + 1 weapon + 1 class that exercise the hard cases (choose-1, conditional timing, resource sacrifice, tile placement, self-damage/recoil, passive triggers, forced movement, status with duration).
- A coverage audit: a table mapping each distinct sentence pattern you find in the corpus to your template, with counts, and any corpus sentences that need extension templates or a rewrite.
- Concrete, ordered implementation steps (parser-first vs template-first, which regex/tokenizer primitives, how to validate round-trip).
- Explicit list of grammar holes you deliberately left open and how an author should handle them.
