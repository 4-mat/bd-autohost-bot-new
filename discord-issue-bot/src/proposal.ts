// Ability Editor proposal payload builder.
//
// Matches the exact format consumed by PR #181's `ability-pr.yml` workflow:
//   - the issue title must start with "Ability: "
//   - the issue body must contain a ```json code block whose payload is
//     `{ "updates": [{ kind, name, entry }], "adds": [{ kind, entry }] }`
//
// See scripts/apply-editor-proposal.ts in PR #181 for the validator.

export type ProposalKind = "class" | "weapon";
export type ProposalMode = "add" | "update";

export interface ProposalEntry {
  kind: ProposalKind;
  name: string;
  entry: Record<string, unknown>;
}

export interface AbilityProposal {
  mode: ProposalMode;
  kind: ProposalKind;
  name: string;
  entry: Record<string, unknown>;
}

/** One entry in the payload consumed by scripts/apply-editor-proposal.ts. */
export interface ProposalChange {
  kind: ProposalKind;
  /** Set for updates (the target); absent for adds (name lives inside entry). */
  name?: string;
  entry: Record<string, unknown>;
}

/** Shape of the ```json payload embedded in the proposal issue body. */
export interface ProposalPayload {
  updates: ProposalChange[];
  adds: ProposalChange[];
}

export function normalizeKind(
  kind: string | null | undefined,
): ProposalKind | null {
  const k = (kind ?? "").toLowerCase().trim();
  if (!k || k === "class") return "class"; // default for empty/missing
  if (k === "weapon" || k === "w") return "weapon";
  return null; // unrecognized → caller reports the typo instead of coercing
}

export function normalizeMode(
  mode: string | null | undefined,
): ProposalMode | null {
  const m = (mode ?? "").toLowerCase().trim();
  if (!m || m === "add") return "add"; // default for empty/missing
  if (m === "update" || m === "upd" || m === "u" || m === "edit" || m === "e")
    return "update";
  return null; // unrecognized → caller reports the typo instead of coercing
}

/**
 * Build the JSON payload for apply-editor-proposal.ts.
 * - update: must target an existing entry (name must match an existing block)
 * - add:    must NOT collide with an existing entry
 * The workflow's validator performs those checks; here we just shape the JSON.
 */
export function buildProposalPayload(
  proposal: AbilityProposal,
): ProposalPayload {
  const entry: Record<string, unknown> = {
    ...proposal.entry,
    name: proposal.name,
  };
  if (proposal.mode === "update") {
    return {
      updates: [
        { kind: proposal.kind, name: proposal.name, entry },
      ],
      adds: [],
    };
  }
  return {
    updates: [],
    adds: [{ kind: proposal.kind, entry }],
  };
}

/**
 * Render the GitHub issue body for a proposal: markdown prose + the ```json
 * code block the workflow extracts.
 */
export function proposalIssueBody(
  proposal: AbilityProposal,
  payload: ProposalPayload,
): string {
  const action =
    proposal.mode === "update"
      ? `update to **${proposal.name}** (${proposal.kind})`
      : `new ${proposal.kind} **${proposal.name}**`;
  return [
    `Automated proposal from Discord — ${action}.`,
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

/** Issue title for a proposal (must start with "Ability: "). */
export function proposalTitle(name: string): string {
  return `Ability: ${name}`;
}
