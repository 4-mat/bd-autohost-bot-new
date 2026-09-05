import type { SheetRow, FetchResult } from "./scraper.js";

const NAME_KEYS = [
  "Name Basic Abilities",
  "58 Items",
  "Name",
  "name",
  "Ability Name",
];

export function rowName(row: SheetRow): string {
  for (const k of NAME_KEYS) {
    const v = row[k];
    if (v && v.trim()) return v.trim();
  }
  return "";
}

export interface Violation {
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
const SELF_REF_WORDS = ["you", "your", "yourself"];
const CHOICE_WORDS = ["select", "pick", "opt"];
const CONDITIONAL_STARTS = ["on ", "when ", "whenever "];

type RuleFn = (
  e: string,
  abilityName: string,
  action: string | undefined,
) => Violation[];

// Rule 1: Status application must use "inflict X Status/Y" (not "applies", "causes", "gives", etc.)
const ruleStatusApplication: RuleFn = (e) => {
  const v: Violation[] = [];
  const badStatus = new RegExp(
    `(apply|applies|applied|causes?|gives?|applied with|deals?)\\s+(\\d+\\s+)?(${STATUS_PATTERN})`,
    "gi",
  );
  const m = e.match(badStatus);
  if (m) {
    v.push({
      rule: "Status Application",
      found: m[0],
      suggestion: `Use "inflict X ${STATUSSES.find((s) => new RegExp(s, "i").test(m[0]))}/Y" instead`,
      severity: "error",
    });
  }

  // Rule 16: Status application must be active ("Inflict X [Status]/Y on
  // [target]"), not passive ("target is inflicted with X Status") or
  // object-first ("inflict the target with X Status"). Negated forms
  // ("cannot be inflicted with...") are immunity wording, not application.
  const passiveStatus = new RegExp(
    `(?:(cannot|can't|won't|never|not|no)\\s+)?\\b(is|are|was|were|be|being|been)\\s+inflicted with\\b[^.]{0,50}?\\b(${STATUS_PATTERN})\\b`,
    "gi",
  );
  for (const pm of e.matchAll(passiveStatus)) {
    if (pm[1]) continue;
    v.push({
      rule: "Status Application",
      found: pm[0],
      suggestion: 'Use the active form "Inflict X [Status]/Y on [target]"',
      severity: "error",
    });
  }
  const inflictWith = new RegExp(
    `\\b(inflicts?)\\s+(the\\s+)?(targets?|foes?|foe|them|allies?|ally)\\s+with\\s+(\\d+\\s*)?(${STATUS_PATTERN})\\b`,
    "gi",
  );
  const m16b = e.match(inflictWith);
  if (m16b) {
    v.push({
      rule: "Status Application",
      found: m16b[0],
      suggestion: 'Use "Inflict X [Status]/Y on [target]"',
      severity: "error",
    });
  }
  return v;
};

// Rule 2: Buffs/debuffs must use "gain" or "inflict"
const ruleBuffDebuff: RuleFn = (e) => {
  const badBuff = new RegExp(
    `(the user |target )?(gets?|receives?|obtains?)\\s+\\+\\d+\\s+(${STAT_PATTERN})`,
    "gi",
  );
  const m = e.match(badBuff);
  if (!m) return [];
  return [
    {
      rule: "Buff/Debuff",
      found: m[0],
      suggestion: 'Use "gain +X STAT/Y"',
      severity: "error",
    },
  ];
};

// Rule 3: Self-reference must use "the user"
const ruleSelfReference: RuleFn = (e, abilityName) => {
  const v: Violation[] = [];
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
  return v;
};

// Rule 4: Choices must use "Choose" not "Select"/"Pick"
const ruleChoiceAbilities: RuleFn = (e) => {
  const v: Violation[] = [];
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
  return v;
};

// Rule 5: Conditional effects must start with "If" (not "On"/"When" for non-passives)
const ruleConditionalEffects: RuleFn = (e, _abilityName, action) => {
  const isPassive = action === "Passive";
  const v: Violation[] = [];
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
  return v;
};

// Rule 6: Ignore/Immunity must use "Ignores" not "bypass"/"penetrat"
const ruleIgnoreImmunity: RuleFn = (e) => {
  const badIgnore = /\b(bypass|penetrat|无视|忽略|穿透)\b/gi;
  const m = e.match(badIgnore);
  if (!m) return [];
  return [
    {
      rule: "Ignore/Immunity",
      found: m[0],
      suggestion: 'Use "Ignores [factor]." instead',
      severity: "error",
    },
  ];
};

// Rule 7: Duration "for X rounds" is valid per BD_LANG_SPEC.md §4.2 — no check needed

// Rule 8: "Until next turn" should be used for non-numeric durations
const ruleDurationNotation: RuleFn = (e) => {
  // Flag the "the" article and "their" pronoun variants, not the canonical
  // "until start of user's next turn" / "until end of target's next turn"
  // forms (§4.1).
  const badUntil =
    /\buntil\s+(?:the\s+)?(?:start of |end of )?(?:their\s+|the\s+(?:target|user)'s\s+)next\s+turn\b/gi;
  const m = e.match(badUntil);
  if (!m) return [];
  return [
    {
      rule: "Duration Notation",
      found: m[0],
      suggestion:
        'Use "until start of user\'s next turn" or "until end of target\'s next turn"',
      severity: "warning",
    },
  ];
};

// Rule 9: Reactions must use "This may be used" opener
// (Can't reliably detect this without knowing action type)

// Rule 10: Resource costs must use "Spend" not "pay"/"use"/"consume"
const ruleResourceCosts: RuleFn = (e) => {
  const badSpend =
    /\b(pay|use|consume|expend)\s+(\d+\s+)?(Rage|Qi|Mana|Blood|Resolve|Focus|Coin|CP|Mark|Campaign|Enrage)/gi;
  const m = e.match(badSpend);
  if (!m) return [];
  return [
    {
      rule: "Resource Costs",
      found: m[0],
      suggestion: 'Use "Spend X [Resource]" instead',
      severity: "error",
    },
  ];
};

// Rule 11: Damage notation should be XdY+Z
const ruleDamageNotation: RuleFn = (e) => {
  const badDice = /\bd\d+[-+]\d+\b/g;
  const m = e.match(badDice);
  if (!m) return [];
  return [
    {
      rule: "Damage Notation",
      found: m[0],
      suggestion: "Use XdY+Z format",
      severity: "warning",
    },
  ];
};

// Rule 12: "cannot" vs "Can't" - prefer full words
const ruleContractions: RuleFn = (e) => {
  const badContraction =
    /\b(can't|won't|doesn't|isn't|aren't|wouldn't|shouldn't|couldn't)\b/gi;
  const m = e.match(badContraction);
  if (!m) return [];
  return [
    {
      rule: "Contractions",
      found: m[0],
      suggestion: 'Use full words (e.g., "cannot" instead of "can\'t")',
      severity: "warning",
    },
  ];
};

// Rule 13: Reactions/Triggers must start with "This may be used"
const ruleReactionOpener: RuleFn = (e, _abilityName, action) => {
  if (
    action !== "Reaction" &&
    action !== "Trigger" &&
    action !== "Reaction or Trigger"
  ) {
    return [];
  }
  if (e.toLowerCase().startsWith("this may be used")) return [];
  return [
    {
      rule: "Reaction Opener",
      found: e.slice(0, 40) + (e.length > 40 ? "..." : ""),
      suggestion:
        'Start with "This may be used [condition]." for Reactions/Triggers',
      severity: "error",
    },
  ];
};

// Rule 14: Resource names must use standard BD Lang names
const ruleResourceNaming: RuleFn = (e) => {
  const resourceAliases: Record<string, string> = {
    "crimson pact": "CP",
    "hit points": "HP",
    "magic points": "MP",
    "movement points": "MP",
    health: "HP",
    "mana points": "MP",
  };
  const v: Violation[] = [];
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
  return v;
};

// Rule 15: Damage type must be Physical or Magical (not True, Fire, Poison, etc.)
const ruleDamageType: RuleFn = (e) => {
  const invalidDmgTypes =
    /\b(True|Pure|Hybrid|Elemental|Fire|Ice|Lightning|Dark|Holy|Neutral|Poison|Bleed|Burn|Cursed|Light|Shadow)\s+damage\b/gi;
  const m = e.match(invalidDmgTypes);
  if (!m) return [];
  return m.map((found) => ({
    rule: "Damage Type",
    found,
    suggestion: 'Use "Physical damage" or "Magical damage"',
    severity: "warning" as const,
  }));
};

const RULES: RuleFn[] = [
  ruleStatusApplication,
  ruleBuffDebuff,
  ruleSelfReference,
  ruleChoiceAbilities,
  ruleConditionalEffects,
  ruleIgnoreImmunity,
  ruleDurationNotation,
  ruleResourceCosts,
  ruleDamageNotation,
  ruleContractions,
  ruleReactionOpener,
  ruleResourceNaming,
  ruleDamageType,
];

export function checkEffect(
  effect: string,
  abilityName: string,
  action?: string,
): Violation[] {
  const e = effect.trim();
  if (!e) return [];
  return RULES.flatMap((rule) => rule(e, abilityName, action));
}

export function checkAbility(row: SheetRow): {
  name: string;
  violations: Violation[];
} {
  const name = rowName(row);
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

export interface SheetComplianceResult {
  label: string;
  total: number;
  issues: { name: string; violations: Violation[] }[];
}

export function checkAllSheets(
  results: FetchResult[],
): SheetComplianceResult[] {
  const out: SheetComplianceResult[] = [];
  for (const r of results) {
    for (const tab of r.tabs) {
      if (tab.data.length === 0) continue;
      const issues = checkSheet(tab.data);
      out.push({ label: tab.label, total: tab.data.length, issues });
    }
  }
  return out;
}

