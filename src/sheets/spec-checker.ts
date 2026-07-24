import type { SheetRow } from "./scraper.js";

interface Violation {
  rule: string;
  found: string;
  suggestion: string;
  severity: "error" | "warning";
}

const STATS = [
  "ATK",
  "MAG",
  "PDEF",
  "MDEF",
  "DEF",
  "ACC",
  "CR",
  "DMG",
  "EVA",
  "MP",
  "Range",
];
const STAT_PATTERN = STATS.join("|");
const STATUSSES = [
  "Bleed",
  "Burn",
  "Curse",
  "Poison",
  "Cripple",
  "Slow",
  "Confusion",
  "Stun",
  "Seal",
  "Root",
];
const STATUS_PATTERN = STATUSSES.join("|");
const RESOURCES = [
  "Rage",
  "Qi",
  "Mana",
  "Blood",
  "Resolve",
  "Focus",
  "Coin",
  "CP",
  "Mark",
  "Campaign",
  "Enrage",
];
const FREQUENCIES = [
  "Every Turn",
  "EoT",
  "E3T",
  "Once",
  "Twice",
  "Thrice",
  "Twice/EoT",
  "Twice/E3T",
  "Thrice/E3T",
  "Once/E3T",
  "Passive",
];
const ACTIONS = [
  "Standard",
  "Full",
  "Movement",
  "Swift",
  "Free",
  "Trigger",
  "Reaction",
  "Passive",
  "Standard or Swift",
  "Standard or Full",
  "Standard or Movement",
  "Movement or Standard",
  "Movement or Swift",
  "Standard or Reaction",
  "Swift or Standard",
  "Reaction or Trigger",
];
const SELF_REF_WORDS = ["you", "your", "yourself"];
const CHOICE_WORDS = ["select", "pick", "opt"];
const CONDITIONAL_STARTS = ["on ", "when ", "whenever "];

function checkEffect(
  effect: string,
  abilityName: string,
  action?: string,
): Violation[] {
  const v: Violation[] = [];
  const e = effect.trim();
  if (!e) return v;

  // Rule 1: Status application must use "inflict X Status/Y" (not "applies", "causes", "gives", etc.)
  const badStatus = new RegExp(
    `(apply|applies|applied|causes?|gives?|applied with|deals?)\\s+(\\d+\\s+)?(${STATUS_PATTERN})`,
    "gi",
  );
  const m1 = e.match(badStatus);
  if (m1) {
    v.push({
      rule: "Status Application",
      found: m1[0],
      suggestion: `Use "inflict X ${STATUSSES.find((s) => new RegExp(s, "i").test(m1[0]))}/Y" instead`,
      severity: "error",
    });
  }

  // Rule 2: Buffs/debuffs must use "gain" or "inflict"
  const badBuff = new RegExp(
    `(the user |target )?(gets?|receives?|obtains?)\\s+\\+\\d+\\s+(${STAT_PATTERN})`,
    "gi",
  );
  const m2 = e.match(badBuff);
  if (m2) {
    v.push({
      rule: "Buff/Debuff",
      found: m2[0],
      suggestion: 'Use "gain +X STAT/Y"',
      severity: "error",
    });
  }

  // Rule 3: Self-reference must use "the user"
  for (const w of SELF_REF_WORDS) {
    const re = new RegExp(`\\b${w}\\b`, "gi");
    if (
      re.test(e) &&
      !e.includes('"') &&
      !abilityName.toLowerCase().includes("taunt")
    ) {
      v.push({
        rule: "Self-Reference",
        found: w,
        suggestion: 'Use "the user" instead',
        severity: "error",
      });
    }
  }

  // Rule 4: Choices must use "Choose" not "Select"/"Pick"
  for (const w of CHOICE_WORDS) {
    const re = new RegExp(`\\b${w}\\b`, "gi");
    if (re.test(e)) {
      v.push({
        rule: "Choice Abilities",
        found: w,
        suggestion: 'Use "Choose" instead',
        severity: "error",
      });
    }
  }

  // Rule 5: Conditional effects must start with "If" (not "On"/"When" for non-passives)
  const isPassive = action === "Passive";
  if (!isPassive) {
    for (const cs of CONDITIONAL_STARTS) {
      const re = new RegExp(`^${cs}`, "gi");
      if (re.test(e) && !e.toLowerCase().startsWith("if ")) {
        const word = cs.trim();
        v.push({
          rule: "Conditional Effects",
          found: `${word}...`,
          suggestion: 'Start with "If" instead (e.g., "If condition, effect.")',
          severity: "warning",
        });
      }
    }
  }

  // Rule 6: Ignore/Immunity must use "Ignores" not "ignores"/"bypass"/"penetrat"
  const badIgnore = /\b(bypass|penetrat|无视|忽略|穿透)\b/gi;
  const m6 = e.match(badIgnore);
  if (m6) {
    v.push({
      rule: "Ignore/Immunity",
      found: m6[0],
      suggestion: 'Use "Ignores [factor]." instead',
      severity: "error",
    });
  }

  // Rule 7: Duration "for X rounds" is valid per BD_LANG_SPEC.md §4.2
  // No check needed -- both "inflict X Status/Y" and "inflict X Status for Y rounds" are valid

  // Rule 8: "Until next turn" should be used for non-numeric durations
  const badUntil =
    /\buntil\s+(the\s+)?(start of |end of )?(their|the target's|the user's)\s+next\s+turn\b/gi;
  const m8 = e.match(badUntil);
  if (m8) {
    v.push({
      rule: "Duration Notation",
      found: m8[0],
      suggestion: 'Use "until next turn" (standardized form)',
      severity: "warning",
    });
  }

  // Rule 9: Reactions must use "This may be used" opener
  // (Can't reliably detect this without knowing action type)

  // Rule 10: Resource costs must use "Spend" not "pay"/"use"/"consume"
  const badSpend =
    /\b(pay|use|consume|expend)\s+(\d+\s+)?(Rage|Qi|Mana|Blood|Resolve|Focus|Coin|CP|Mark|Campaign|Enrage)/gi;
  const m10 = e.match(badSpend);
  if (m10) {
    v.push({
      rule: "Resource Costs",
      found: m10[0],
      suggestion: 'Use "Spend X [Resource]" instead',
      severity: "error",
    });
  }

  // Rule 11: Damage notation should be XdY+Z
  const badDice = /\bd\d+[-+]\d+\b/g;
  const m11 = e.match(badDice);
  if (m11) {
    v.push({
      rule: "Damage Notation",
      found: m11[0],
      suggestion: "Use XdY+Z format",
      severity: "warning",
    });
  }

  // Rule 12: "cannot" vs "Can't" - prefer full words
  const badContraction =
    /\b(can't|won't|doesn't|isn't|aren't|wouldn't|shouldn't|couldn't)\b/gi;
  const m12 = e.match(badContraction);
  if (m12) {
    v.push({
      rule: "Contractions",
      found: m12[0],
      suggestion: 'Use full words (e.g., "cannot" instead of "can\'t")',
      severity: "warning",
    });
  }

  // Rule 13: Reactions/Triggers must start with "This may be used"
  if (
    action === "Reaction" ||
    action === "Trigger" ||
    action === "Reaction or Trigger"
  ) {
    if (e && !e.toLowerCase().startsWith("this may be used")) {
      v.push({
        rule: "Reaction Opener",
        found: e.slice(0, 40) + (e.length > 40 ? "..." : ""),
        suggestion:
          'Start with "This may be used [condition]." for Reactions/Triggers',
        severity: "error",
      });
    }
  }

  // Rule 14: Resource names must use standard BD Lang names
  const resourceAliases: Record<string, string> = {
    "crimson pact": "CP",
    "hit points": "HP",
    "magic points": "MP",
    "movement points": "MP",
    health: "HP",
    "mana points": "MP",
  };
  for (const [alias, standard] of Object.entries(resourceAliases)) {
    const re = new RegExp(`\\b${alias}\\b`, "gi");
    if (re.test(e)) {
      v.push({
        rule: "Resource Naming",
        found: alias,
        suggestion: `Use "${standard}" instead of "${alias}"`,
        severity: "warning",
      });
    }
  }

  // Rule 15: Damage type must be Physical, Magical, or "Physical or Magical"
  const validDamageTypes = ["Physical", "Magical", "Physical or Magical"];
  const badDamageType =
    /\b(True|Pure|Hybrid|Elemental|Fire|Ice|Lightning|Dark|Holy|Neutral)\s+(damage|type)\b/gi;
  const m15 = e.match(badDamageType);
  if (m15) {
    v.push({
      rule: "Damage Type",
      found: m15[0],
      suggestion: `Use one of: ${validDamageTypes.join(", ")}`,
      severity: "warning",
    });
  }

  return v;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function checkAbility(row: SheetRow): {
  name: string;
  violations: Violation[];
} {
  const name = row.Name || row.name || row["Ability Name"] || "";
  const effect = row.Effect || row.effect || "";
  const action = row.Action || row.action || "";
  return { name, violations: checkEffect(effect, name, action) };
}

export function checkSheet(rows: SheetRow[]): {
  name: string;
  violations: Violation[];
}[] {
  return rows
    .map((r) => checkAbility(r))
    .filter((r) => r.violations.length > 0);
}

export type { Violation };
