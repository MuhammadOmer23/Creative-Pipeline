import type { Role } from "./constants";
import { ROLE_LABEL } from "./constants";

export type StageKey = "intake" | "reference" | "breakdown" | "strategy" | "copy" | "assets" | "review" | "final" | "parked";

export type Blocker = {
  id: string;
  reason: string;
  owner: string;
  blocks: string;
};

export type DeriveInput = {
  fixtureKind: "shelved" | "historical" | null;
  parked: boolean;
  intakeComplete: boolean;
  selected: boolean;
  formatChosen: boolean;
  referenceReviewed: boolean;
  analysisState: "missing" | "draft" | "ready";
  findingsOk: boolean;
  adaptationOk: boolean;
  strategyOk: boolean;
  copyOk: boolean;
  assetsOk: boolean;
  historicalBlocked: boolean;
  approvalFailures: { owner: Role; reason: string }[];
  briefState: "none" | "draft" | "frozen" | "approved" | "changes_requested";
  workingVersion: number | null;
  finalVersion: number | null;
  handoff: "none" | "pending" | "accepted" | "gaps";
  thresholdsMissing: boolean;
  hasOpenFeedback: boolean;
};

export type Derived = {
  stage: StageKey;
  stageLabel: string;
  nextAction: string;
  owner: string;
  blockers: Blocker[];
  notes: string[];
  finalDraftLabel: string;
  approvalLabel: string;
  handoffLabel: string;
  approvalStatus: "none" | "pending" | "approved" | "stale";
  handoffStatus: "not_offered" | "awaiting" | "accepted" | "gaps";
};

const STAGE_LABEL: Record<StageKey, string> = {
  intake: "Intake",
  reference: "Reference",
  breakdown: "Breakdown",
  strategy: "Strategy",
  copy: "Copy",
  assets: "Assets",
  review: "Review",
  final: "Final draft",
  parked: "Parked",
};

function blocker(id: string, reason: string, owner: Role, blocks: string): Blocker {
  return { id, reason, owner: ROLE_LABEL[owner], blocks };
}

export function derive(input: DeriveInput): Derived {
  const notes: string[] = [];
  if (input.thresholdsMissing) {
    notes.push("Spend, kill, and promote thresholds are MISSING until an approved source exists. That blocks launch only. This pipeline does not launch.");
  }

  const finalDraftLabel = !input.finalVersion
    ? "No final draft"
    : input.workingVersion && input.workingVersion !== input.finalVersion
      ? `Final draft v${input.finalVersion} · working draft v${input.workingVersion}`
      : `Final draft v${input.finalVersion}`;

  const approvalLabel = input.briefState === "frozen" && input.workingVersion
    ? `Awaiting approval of v${input.workingVersion}`
    : input.finalVersion && input.workingVersion && input.workingVersion !== input.finalVersion
      ? `Final draft v${input.finalVersion} approved · v${input.workingVersion} is not approved`
      : input.briefState === "changes_requested" && input.workingVersion
        ? `v${input.workingVersion} was returned and is not a final draft`
        : input.finalVersion
          ? `Approved v${input.finalVersion}`
          : "Not approved";

  const approvalStatus: Derived["approvalStatus"] =
    input.briefState === "frozen"
      ? "pending"
      : input.finalVersion && input.workingVersion && input.workingVersion !== input.finalVersion
        ? "stale"
        : input.finalVersion
          ? "approved"
          : "none";

  const handoffStatus: Derived["handoffStatus"] =
    input.handoff === "accepted" ? "accepted" : input.handoff === "gaps" ? "gaps" : input.handoff === "pending" ? "awaiting" : "not_offered";

  const handoffLabel =
    input.handoff === "accepted" && input.workingVersion && input.finalVersion && input.workingVersion !== input.finalVersion
      ? `Not offered on v${input.workingVersion} · v${input.finalVersion} was accepted`
      : input.handoff === "accepted"
        ? "Accepted · no launch permission"
        : input.handoff === "gaps"
          ? "Returned with gaps"
          : input.handoff === "pending"
            ? "Awaiting editor acceptance"
            : "Not offered";

  const blockers: Blocker[] = [];
  if (input.fixtureKind === "shelved" || input.parked) {
    blockers.push(blocker("shelved", "This test fixture is shelved. It is not live and it cannot be approved.", "strategist", "Approval"));
  }
  if (input.historicalBlocked) {
    blockers.push(blocker("history", "Copy is dated before the analysis. The original dates stay, so this record cannot become a final draft.", "strategist", "Approval"));
  }
  if (!input.parked && input.fixtureKind !== "shelved") {
    if (!input.intakeComplete) blockers.push(blocker("intake", "Intake is missing one of the five fields.", "strategist", "Select into the pipeline"));
    if (input.intakeComplete && !input.selected) blockers.push(blocker("select", "The creative is not selected into the pipeline, so it has no pipeline ID.", "strategist", "Reference"));
    if (input.selected && !input.formatChosen) blockers.push(blocker("format", "Medium and execution style are not chosen.", "strategist", "Approval"));
    if (input.selected && !input.referenceReviewed) blockers.push(blocker("reference", "The reference is not linked and reviewed.", "strategist", "Approval"));
    if (input.selected && !input.findingsOk) blockers.push(blocker("findings", "The 18-label breakdown is incomplete.", "copy_writer", "Approval"));
    if (input.selected && input.findingsOk && input.analysisState !== "ready") blockers.push(blocker("ready", "The breakdown is not marked ready.", "copy_writer", "Copy"));
    if (input.selected && !input.adaptationOk) blockers.push(blocker("adaptation", "Adaptation is not written for every finding.", "strategist", "Approval"));
    if (input.selected && !input.strategyOk) blockers.push(blocker("strategy", "Hypothesis, variable, or controls are still empty.", "strategist", "Approval"));
    if (input.selected && !input.copyOk) blockers.push(blocker("copy", "The active format module is incomplete.", "copy_writer", "Approval"));
    if (input.selected && !input.assetsOk) blockers.push(blocker("assets", "Asset status and permission are not recorded.", "editor", "Approval"));
  }
  input.approvalFailures.slice(0, 4).forEach((failure, index) => {
    if (!blockers.some((item) => item.reason === failure.reason)) {
      blockers.push(blocker(`check-${index}`, failure.reason, failure.owner, "Approval"));
    }
  });

  let stage: StageKey = "review";
  let nextAction = "Open review.";
  let owner: Role = "strategist";

  if (input.fixtureKind === "shelved" || input.parked) {
    stage = "parked";
    nextAction = "No action. This test fixture is shelved.";
    owner = "strategist";
  } else if (input.fixtureKind === "historical" && input.historicalBlocked) {
    stage = "review";
    nextAction = "No action that rewrites history. Copy stays dated before the analysis, so there is no final draft.";
    owner = "strategist";
  } else if (!input.intakeComplete) {
    stage = "intake";
    nextAction = "Finish the five intake fields.";
    owner = "strategist";
  } else if (!input.selected) {
    stage = "intake";
    nextAction = "Select this creative into the pipeline.";
    owner = "strategist";
  } else if (!input.formatChosen) {
    stage = "intake";
    nextAction = "Choose medium and execution style.";
    owner = "strategist";
  } else if (!input.referenceReviewed) {
    stage = "reference";
    nextAction = "Link the reference and mark it reviewed.";
    owner = "strategist";
  } else if (!input.findingsOk || input.analysisState === "missing") {
    stage = "breakdown";
    nextAction = "Finish the 18 reference findings, including evidence.";
    owner = "copy_writer";
  } else if (input.analysisState !== "ready") {
    stage = "breakdown";
    nextAction = "Mark the breakdown ready before copy starts.";
    owner = "copy_writer";
  } else if (!input.adaptationOk || !input.strategyOk) {
    stage = "strategy";
    nextAction = !input.adaptationOk ? "Write the adaptation for each finding." : "Fill the hypothesis, variable, and controls.";
    owner = "strategist";
  } else if (!input.copyOk) {
    stage = "copy";
    nextAction = "Finish the active format module.";
    owner = "copy_writer";
  } else if (!input.assetsOk) {
    stage = "assets";
    nextAction = "Record asset status and permission.";
    owner = "editor";
  } else if (input.briefState === "draft" && input.approvalFailures.length) {
    stage = "review";
    nextAction = "Resolve the failing checks before asking for approval.";
    owner = input.approvalFailures[0]?.owner ?? "strategist";
  } else if (input.briefState === "draft" && input.hasOpenFeedback) {
    stage = "review";
    nextAction = "Address the feedback, then freeze a new version.";
    owner = "strategist";
  } else if (input.briefState === "draft") {
    stage = "review";
    nextAction = "Freeze this version and request approval.";
    owner = "strategist";
  } else if (input.briefState === "frozen") {
    stage = "review";
    nextAction = `Approve or return exact version v${input.workingVersion}.`;
    owner = "approver";
  } else if (input.briefState === "changes_requested") {
    stage = "review";
    nextAction = "Start a revision from the returned version.";
    owner = "strategist";
  } else if (input.finalVersion && input.workingVersion && input.workingVersion !== input.finalVersion) {
    stage = "review";
    nextAction = `Keep editing working draft v${input.workingVersion}. Final draft v${input.finalVersion} stays approved.`;
    owner = "strategist";
  } else if (input.handoff === "none") {
    stage = "review";
    nextAction = "Offer the final draft to the editor.";
    owner = "strategist";
  } else if (input.handoff === "pending") {
    stage = "review";
    nextAction = "Accept the final draft or return gaps.";
    owner = "editor";
  } else if (input.handoff === "gaps") {
    stage = "review";
    nextAction = "Start a revision to address the editor's gaps.";
    owner = "strategist";
  } else {
    stage = "final";
    nextAction = "No further action. The editor accepted the final draft. Production, publishing, and spend stay unauthorized.";
    owner = "strategist";
  }

  return {
    stage,
    stageLabel: STAGE_LABEL[stage],
    nextAction,
    owner: ROLE_LABEL[owner],
    blockers,
    notes,
    finalDraftLabel,
    approvalLabel,
    handoffLabel,
    approvalStatus,
    handoffStatus,
  };
}
