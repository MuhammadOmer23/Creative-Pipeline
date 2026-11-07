export const BRAND = "TriCore";

export const HANDOFF_DISCLAIMER =
  "Recipient acceptance does not authorize production, publishing, or ad spend.";

export const MISSING_THRESHOLD = "MISSING until approved source";

export const ROLES = [
  "strategist",
  "copy_writer",
  "editor",
  "approver",
  "architect",
] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  strategist: "Strategist",
  copy_writer: "Copy writer",
  editor: "Editor",
  approver: "Approver",
  architect: "Architect",
};

export const MEDIUMS = ["Video", "Still image", "Other"] as const;
export const EXECUTION_STYLES = [
  "Native avatar-story",
  "UGC",
  "Animation",
  "Listicle",
  "Other",
] as const;

export const SOURCE_TYPES = ["Organic", "Swipe"] as const;
