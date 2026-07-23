import fs from "fs";
const files = [
  "Classes",
  "Archer",
  "Clairvoyant",
  "Dark",
  "Dueler",
  "Heavy",
  "Noble",
  "Sorcerer",
  "Trophy",
];
const all = {};
for (const f of files) {
  const d = JSON.parse(fs.readFileSync("_data/" + f + ".json", "utf8"));
  for (const [n, a] of Object.entries(d)) {
    if (n === "meta") continue;
    a.sourceFile = f;
    all[n] = a;
  }
}
function cat(name, a) {
  const e = (a.effect || "") + " " + (a.range || "");
  const c = new Set();
  if (
    /(Place|Create|Replace) .*(wall|tile|hearth|wormhole|totem|silk|cocoon|broken|forest|water|ice|sticky|boost|lava|Stone|Wood)/i.test(
      e,
    ) ||
    /place (one|a|the|up to)/i.test(e) ||
    name.includes("Totem")
  )
    c.add("tile_place");
  if (/\b(Push|Pull)\b/i.test(e)) c.add("push_pull");
  if (/\bTeleport\b/i.test(e)) c.add("teleport");
  if (/\bSwap\b/i.test(e)) c.add("swap");
  if (
    /(inflict|inflicted|Inflict)\b/i.test(e) &&
    /(Bleed|Burn|Curse|Poison|Cripple|Slow|Confusion|Stun|Seal|Root)/i.test(e)
  )
    c.add("status");
  if (
    /[Bb]leed\/\d|[Bb]urn\/\d|[Cc]urse\/\d|[Pp]oison\/\d|[Cc]ripple\/\d|Slow\/\d|[Cc]onfusion\/\d|Stun\/\d|Seal\/\d|[Rr]oot\/\d/.test(
      e,
    )
  )
    c.add("status");
  if (e.startsWith("This may be used")) c.add("reaction");
  if (a.action === "Trigger" || a.action === "Reaction or Trigger")
    c.add("trigger");
  if (a.frequency === "Passive") c.add("passive");
  if (/\b(gain|lose) [\+\-]\d/.test(e)) c.add("statmod");
  if (/\binflict [\+\-]\d/.test(e)) c.add("statmod");
  if (/\+\d+ [A-Z]{2,}\/\d/.test(e)) c.add("statmod");
  if (
    /\+\d [A-Za-z]{2,}/.test(e) &&
    /(ATK|MAG|DEF|DMG|ACC|CR|MP|EVA|Range|MR|Hit)/i.test(e)
  )
    c.add("statmod");
  if (
    /(Spend|spend|spends|Gain|gain|Lose|lose|Sacrifice|sacrifice)( up to)? (\d+|all|one|two|three|some|a)/i.test(
      e,
    ) ||
    /[Cc]osts? \d/.test(e)
  )
    c.add("resource");
  if (/heal(s|ed|ing)?\b/i.test(e) || /\b(healing|heals)\b/i.test(e))
    c.add("heal");
  if (/\bChoose\b/i.test(e) || /\bSelect\b/i.test(e) || /\bchooses\b/i.test(e))
    c.add("choice");
  if (/\bShield\b/i.test(e) || /\bshield\/\d/.test(e) || name === "Aegis")
    c.add("shield");
  if (
    /(teleport|move[sd]?|swap|push|pull)\b/i.test(e) &&
    (a.action === "Movement" || a.action === "Full")
  )
    c.add("movement");
  if (/Phase/i.test(e) || /\b(New Moon|Waxing|Waning|Full Moon)\b/.test(e))
    c.add("phase");
  if (/turn immediately|turn order|after .* turn|before .* turn/.test(e))
    c.add("turn_order");
  if (/(reroll|re-roll|stored roll|roll a d\d)/i.test(e)) c.add("dice_roll");
  if (/(Cannot be prevented|cannot be inflicted|immune|unremovable)/i.test(e))
    c.add("prevention");
  if (/\b(kill|dies|death|dead|slain|kill)\b/i.test(e)) c.add("kill");
  if (
    /(Duet|Covenant|Link|Oath|bound)/i.test(e) &&
    !/Bound (Bow|Gauntlet)/i.test(name)
  )
    c.add("connection");
  if (/(Double Hit|Triple Hit|Quad\. Hit)/i.test(e) || /\b\+1 hit\b/.test(e))
    c.add("multihit");
  if (a.damage && /(Double|Triple|Quad)/i.test(a.damage.roll))
    c.add("multihit");
  if (/\b(dice|dice faces|base dice|crit|Bomb dice)\b/i.test(e))
    c.add("dicemod");
  if (/(ignore|Ignores) .*(DEF|ATK|MAG|EVA|outside factor)/i.test(e))
    c.add("ignore_def");
  if (
    /(Burst|Star|Cone|Beam|Pierce|Splash|Line|AOE|AoE)/i.test(
      e + " " + (a.range || ""),
    )
  )
    c.add("aoe");
  if ((/\bDelay/i.test(e) && !/Delay-/.test(e)) || /Delay(-\d)?/.test(e))
    c.add("delay");
  if (/\b(Before|After) (damage|accuracy|move|attack|hit|miss|push)\b/i.test(e))
    c.add("timing");
  if (/\bchannel/i.test(e)) c.add("channel");
  if (/\b(recoil|sacrifice \d+ HP|self-inflict)/i.test(e)) c.add("recoil");
  if (
    /\bif the target\b|\bif the user\b|\bif not\b|\bif the foe\b|\botherwise\b/i.test(
      e,
    )
  )
    c.add("conditional");
  if (/\bDeclare\b/i.test(e)) c.add("declare");
  if (name.includes("Totem") || /Totem\b/.test(e)) c.add("totem");
  // Covenant-style buff sharing
  if (
    /\bshares\b.*\b(buffs|passive|Crimson Pact|Black Magic|buffs?)\b/i.test(e)
  )
    c.add("connection");
  // Oblation-style next attack buff
  if (/\bnext attack.*(double|bonus|extra|additional)\b/i.test(e))
    c.add("statmod");
  // Tunneling-style movement phasing
  if (/\bmoves through.*as if they were (Normal|empty)\b/i.test(e))
    c.add("movement");
  // Catch stones/masonry-like tile creation
  if (/becomes a (Stone|Ice|Wood|Broken|Lava) tile/i.test(e))
    c.add("tile_place");
  // Catch "spends all" variants
  if (/spends all|spend all/i.test(e)) c.add("resource");
  // Catch "spend [Resource]" without a number (e.g., "spend Rage")
  if (
    /\bspend(s)?\b/i.test(e) &&
    /\b(Rage|Qi|Mana|Blood|Coin|Resolve|Focus|CP|Mark|Campaign|Enrage|Dice|Qi)\b/i.test(
      e,
    )
  )
    c.add("resource");
  // Damage reduction
  if (/\btake[s]? \d+% damage\b|\bdamage reduction\b/i.test(e))
    c.add("damage_mitigation");
  // Calculation expressions
  if (/X = \d/.test(e) || /X = .*[\*]/.test(e)) c.add("calculation");
  if (c.size === 0) c.add("uncategorized");
  return [...c];
}
const g = {};
for (const [name, a] of Object.entries(all)) {
  const cats = cat(name, a);
  for (const d of cats) {
    if (!g[d]) g[d] = [];
    g[d].push(name);
  }
}
for (const k of Object.keys(g)) g[k].sort();
const o = {
  meta: { total: Object.keys(all).length, categories: Object.keys(g).length },
  categories: g,
};
fs.writeFileSync("ABILITY_GROUPS.json", JSON.stringify(o, null, 2) + "\n");
console.log(
  "Generated ABILITY_GROUPS.json (" +
    Object.keys(all).length +
    " abilities, " +
    Object.keys(g).length +
    " categories)",
);
for (const [k, v] of Object.entries(g).sort())
  console.log("  " + k + ": " + v.length);
