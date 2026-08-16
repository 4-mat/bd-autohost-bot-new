# Feature Sprint 5 — Batch 13 (item equip & usage)

Fifth pass; none overlap with the first 79. All 8 implemented. No gold/economy
— items are granted by the host and equipped/used, not bought.

## Batch 13 — Item equip & usage
80. `parseItemStats` — parse `statBoosts`/`statNerfs` into stat deltas
    (`src/game/items.ts`, accepts "ATK +2" and "+2 ATK" forms).
81. Entity inventory fields (`inventory`, `equipped`, `maxSlots` — default 2).
82. `%giveitem <entity>, <item>` — host grants an item.
83. `%takeitem <entity>, <item>` — host removes an item (auto-unequips).
84. `%equip <item>` — equip from inventory; enforces slots and applies stat mods.
85. `%unequip <item>` — revert the item's stat mods.
86. `%inventory [entity]` — list owned/equipped items + slot usage.
87. `%useitem <item>` — consume an item; applies a heal when the effect text
    implies one ("Heal 20 HP"), else logs the effect.

## Notes
- Stat mods mutate the entity's base stats directly and are reverted on
  unequip; HP changes keep `curhp` clamped to `maxhp`.
- Inventory/equipped/maxSlots are included in `%undo` snapshots.
- Item lookup is exact-name for now; `%find` (feature 78) is the search path.

## Verification
- `tsc --noEmit` clean.
- 450/450 tests pass (8 new `items.test.ts` cases).
