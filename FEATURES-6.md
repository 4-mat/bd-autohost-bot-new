# Feature Sprint 6 — Batch 14 (damage tracking, team surrender, AFK)

Sixth pass; none overlap with the first 87. All 6 implemented. No buy/gold
economy (out of scope per request).

## Batch 14 — Damage, team surrender & AFK
88. Damage tracking — `damageDealt`/`damageTaken` entity fields, accumulated in
    `dealDamage` (taken) and at the attack sites in `resolve.ts` (dealt).
89. `%damage [entity]` — show cumulative damage dealt/taken.
90. `%forfeit` — individual concede (split from the old combined `%surrender`).
91. `%surrender` — team majority vote; a majority of living teammates forfeits
    the whole team (individual forfeit in FFA).
92. `%afk [entity]` — mark an entity away (host may target anyone).
93. `%return [entity]` — clear AFK; AFK entities auto-skip their turn, and
    `%summary` tags them with "AFK".

## Notes
- Damage "dealt" counts the attacker's raw final damage; "taken" counts actual
  HP lost after shields. Self/DoT/lava damage counts as "taken" only.
- `surrenderVotes` and damage/afk are reset on `%rematch`.

## Verification
- `tsc --noEmit` clean.
- 451/451 tests pass (1 new: cumulative damage-taken tracking).
