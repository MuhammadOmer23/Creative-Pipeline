export type Requirement = "locked" | "mandatory" | "conditional" | "required";

export type AnalysisLabel = { label: string; requirement: Requirement };

/** Verbatim Universal Ad Brief v0.2 labels. Notion is the wording source. */
export const ANALYSIS_LABELS: AnalysisLabel[] = [
  { label: "Beats / anatomy (logical sequence + job of each beat)", requirement: "locked" },
  { label: "Awareness level", requirement: "locked" },
  { label: "Market sophistication", requirement: "locked" },
  { label: "Unique problem", requirement: "locked" },
  { label: "Unique solution (reference's own)", requirement: "locked" },
  { label: "Authority (Y/N, who; imagery ≠ expert)", requirement: "locked" },
  { label: "Messenger", requirement: "locked" },
  { label: "Format / visual grammar", requirement: "locked" },
  { label: "Stakes (none / soft / hard + line)", requirement: "locked" },
  { label: "Emotional valence / arc", requirement: "locked" },
  { label: "Angle", requirement: "mandatory" },
  { label: "Belief: current → new", requirement: "mandatory" },
  { label: "Mass desire", requirement: "conditional" },
  { label: "Persuasion techniques + where", requirement: "conditional" },
  { label: "Gradualization (start belief → bridges → claim)", requirement: "conditional" },
  { label: "Problem ↔ solution mirror", requirement: "conditional" },
  { label: "Mechanism depth / placement / repetition", requirement: "conditional" },
  { label: "Do-not-copy items from reference", requirement: "required" },
];

export const REQUIREMENT_TEXT: Record<Requirement, string> = {
  locked: "Locked. An observed finding and evidence are required.",
  mandatory: "Mandatory. An observed finding and evidence are required.",
  conditional: "If it is present, record it with evidence. Otherwise mark N/A and give the reason.",
  required: "Required. Name the do-not-copy items, or write that none were identified and why.",
};
