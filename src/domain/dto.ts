import type { Role } from "./constants";
import type { Change } from "./diff";
import type { CheckView } from "./checks";
import type { Blocker } from "./status";
import type {
  AnalysisSnap,
  AssetRow,
  Beat,
  Finding,
  Mechanism,
  NativeModule,
  Offer,
  ReferenceSnap,
  StaticModule,
  Strategy,
  VideoModule,
} from "./snapshot";

export type Permissions = {
  canEditIntake: boolean;
  canAssign: boolean;
  canSelect: boolean;
  canEditReference: boolean;
  canReviewReference: boolean;
  canEditFindings: boolean;
  canEditAdaptation: boolean;
  canMarkReady: boolean;
  canEditStrategy: boolean;
  canEditOffer: boolean;
  canEditCopy: boolean;
  canEditModules: boolean;
  canEditAssets: boolean;
  canAttest: boolean;
  canSubmit: boolean;
  canApprove: boolean;
  canRevise: boolean;
  canOfferHandoff: boolean;
  canRespondHandoff: boolean;
  canPark: boolean;
};

export type CreativeDto = {
  id: string;
  code: string | null;
  fixtureKind: "shelved" | "historical" | null;
  banner: string | null;
  intakeRevision: number;
  intake: {
    idea: string;
    sourceType: string;
    spottedBy: string;
    spottedOn: string;
    hypothesis: string;
    parentCode: string;
    sheetLink: string;
    medium: string;
    executionStyle: string;
    otherMedium: string;
    otherExecution: string;
  };
  assignments: { role: Role; accountId: string; name: string }[];
  directory: { id: string; name: string; roles: Role[] }[];
  reference: ReferenceSnap;
  analysis: AnalysisSnap | null;
  findings: Finding[];
  strategy: Strategy;
  offer: Offer;
  mechanism: Mechanism;
  beats: Beat[];
  guardrails: string;
  openItems: string;
  modules: {
    customized: boolean;
    video: VideoModule;
    static: StaticModule;
    native: NativeModule;
  };
  assets: AssetRow[];
  revisions: Record<string, number>;
  copyAuthoredAt: string | null;
  brief: { id: string; number: number; state: string; hash: string } | null;
  versions: { id: string; number: number; state: string; hash: string; createdAt: string; isFinalDraft: boolean }[];
  checks: CheckView[];
  changes: Change[];
  feedback: { id: string; section: string; body: string; authorName: string; versionNumber: number; createdAt: string }[];
  approval: { versionNumber: number; words: string; approverName: string; at: string; hash: string } | null;
  handoff: {
    id: string;
    versionNumber: number;
    acceptance: "pending" | "accepted" | "gaps";
    destination: string;
    externalLink: string;
    gaps: string;
    disclaimer: string;
    recipientName: string;
  } | null;
  stageLabel: string;
  nextAction: string;
  owner: string;
  blockers: Blocker[];
  notes: string[];
  finalDraftLabel: string;
  approvalLabel: string;
  handoffLabel: string;
  permissions: Permissions;
  history: { id: string; at: string; sentence: string; actorName: string }[];
};
