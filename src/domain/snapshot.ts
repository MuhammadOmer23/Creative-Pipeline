import { randomUUID } from "crypto";
import { MISSING_THRESHOLD } from "./constants";
import { sha256 } from "./hash";
import { ANALYSIS_LABELS, type Requirement } from "./labels";

export type Evidence = { id: string; location: string; quote: string };

export type Finding = {
  id: string;
  label: string;
  requirement: Requirement;
  sortOrder: number;
  referenceObserved: string;
  inference: string;
  adaptation: string;
  naReason: string;
  revision: number;
  evidence: Evidence[];
};

export type Beat = {
  id: string;
  referenceBeat: string;
  ourBeat: string;
  carriedBy: "" | "visual" | "copy" | "both";
  departure: string;
};

export type AssetRow = {
  id: string;
  label: string;
  status: "" | "needed" | "linked" | "missing" | "permission_recorded";
  link: string;
  permission: string;
  mapsTo: string;
};

export type Strategy = {
  concept: string;
  buyer: string;
  awareness: string;
  emotionalArc: string;
  messenger: string;
  stakes: string;
  intendedAction: string;
  hypothesis: string;
  whyFormat: string;
  variables: string;
  controls: string;
  breakEven: string;
  spendCap: string;
  killPromote: string;
  nextTest: string;
};

export type Offer = {
  landingUrl: string;
  landingSource: string;
  offerPrice: string;
  offerSource: string;
  limits: string;
  limitsSource: string;
  cta: string;
  ctaSource: string;
  productLanguage: string;
  productSource: string;
};

export type SourcedRow = { id: string; text: string; source: string };

export type Mechanism = {
  mechanism: string;
  honestyLine: string;
  proofs: SourcedRow[];
  proofNone: boolean;
  claims: SourcedRow[];
  claimsNone: boolean;
  realPeople: string;
  realPeopleNone: boolean;
};

export type VideoModule = {
  state: "active" | "na";
  naReason: string;
  leads: { key: "A" | "B" | "C"; creativeId: string; open: string; firstFrame: string }[];
  bodyClose: string;
  sharedBackHalf: string;
  visualGrammar: string;
  departures: string;
  visualRhyme: string;
  colourCode: string;
  sourcePack: {
    folderUrl: string;
    contactSheet: string;
    naReason: string;
    frames: {
      id: string;
      scene: string;
      timestamp: string;
      frameId: string;
      job: string;
      mirror: string;
      changes: string;
      observed: string;
    }[];
  };
  voScript: string;
  captionPlan: string;
  scenes: {
    id: string;
    timecode: string;
    beat: string;
    refBeat: string;
    vo: string;
    visual: string;
    notes: string;
  }[];
  dialIn: {
    storyArc: string;
    patternInterrupt: string;
    mechanismVisual: string;
    transition: string;
    captionPlan: string;
    hookVariants: string;
    firstFrameMatches: boolean;
  };
  shots: { id: string; timecode: string; vo: string; action: string; shotSize: string; assetNote: string }[];
  motion: { naReason: string; pairs: { id: string; pair: string; fromTo: string; intent: string; clipId: string }[] };
  audio: { voice: string; music: string };
  specs: {
    aspect: string;
    resolution: string;
    length: string;
    cutRate: string;
    exports: string;
    naming: string;
    folder: string;
    source: string;
  };
};

export type StaticModule = {
  state: "active" | "na";
  naReason: string;
  subject: string;
  environment: string;
  emotionalCue: string;
  composition: string;
  crop: string;
  placement: string;
  textOnImage: "" | "yes" | "no";
  textHierarchy: string;
  primaryText: string;
  imageCopy: string;
  readerPath: string;
  approvedClaims: string;
  assetSource: string;
  permission: string;
  exportSpecs: string;
};

export type NativeModule = {
  state: "active" | "na";
  naReason: string;
  subject: string;
  setting: string;
  framing: string;
  emotionalCue: string;
  whyAttention: string;
  copyMakesImageMean: string;
  overlay: "" | "none" | "exception";
  overlayReason: string;
  platformCta: string;
  assetSource: string;
  situation: string;
  narrativeVoice: string;
  opening: string;
  incident: string;
  beliefs: string;
  mechanism: string;
  proof: string;
  turningPoint: string;
  payoff: string;
  cta: string;
  reality: "" | "real" | "illustrative";
  permission: string;
};

export type IntakeSnap = {
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
  brand: string;
};

export type ReferenceSnap = {
  url: string;
  title: string;
  note: string;
  reviewedAt: string | null;
  reviewedById: string | null;
  reviewedByName: string | null;
};

export type AnalysisSnap = {
  id: string;
  versionNumber: number;
  state: "draft" | "ready";
  authoredAt: string;
};

export type Snapshot = {
  intake: IntakeSnap;
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
  copyAuthoredAt: string | null;
  revisions: Record<string, number>;
};

export function emptyFindings(): Finding[] {
  return ANALYSIS_LABELS.map((item, index) => ({
    id: randomUUID(),
    label: item.label,
    requirement: item.requirement,
    sortOrder: index + 1,
    referenceObserved: "",
    inference: "",
    adaptation: "",
    naReason: "",
    revision: 1,
    evidence: [],
  }));
}

function videoModule(): VideoModule {
  return {
    state: "na",
    naReason: "N/A — medium and execution style are not chosen yet.",
    leads: [
      { key: "A", creativeId: "", open: "", firstFrame: "" },
      { key: "B", creativeId: "", open: "", firstFrame: "" },
      { key: "C", creativeId: "", open: "", firstFrame: "" },
    ],
    bodyClose: "",
    sharedBackHalf: "",
    visualGrammar: "",
    departures: "",
    visualRhyme: "",
    colourCode: "",
    sourcePack: { folderUrl: "", contactSheet: "", naReason: "", frames: [] },
    voScript: "",
    captionPlan: "",
    scenes: [],
    dialIn: {
      storyArc: "",
      patternInterrupt: "",
      mechanismVisual: "",
      transition: "",
      captionPlan: "",
      hookVariants: "",
      firstFrameMatches: false,
    },
    shots: [],
    motion: { naReason: "N/A — AI motion is not used.", pairs: [] },
    audio: { voice: "", music: "" },
    specs: {
      aspect: "",
      resolution: "",
      length: "",
      cutRate: "",
      exports: "",
      naming: "",
      folder: "",
      source: "",
    },
  };
}

function staticModule(): StaticModule {
  return {
    state: "na",
    naReason: "N/A — medium and execution style are not chosen yet.",
    subject: "",
    environment: "",
    emotionalCue: "",
    composition: "",
    crop: "",
    placement: "",
    textOnImage: "",
    textHierarchy: "",
    primaryText: "",
    imageCopy: "",
    readerPath: "",
    approvedClaims: "",
    assetSource: "",
    permission: "",
    exportSpecs: "",
  };
}

function nativeModule(): NativeModule {
  return {
    state: "na",
    naReason: "N/A — medium and execution style are not chosen yet.",
    subject: "",
    setting: "",
    framing: "",
    emotionalCue: "",
    whyAttention: "",
    copyMakesImageMean: "",
    overlay: "",
    overlayReason: "",
    platformCta: "",
    assetSource: "",
    situation: "",
    narrativeVoice: "",
    opening: "",
    incident: "",
    beliefs: "",
    mechanism: "",
    proof: "",
    turningPoint: "",
    payoff: "",
    cta: "",
    reality: "",
    permission: "",
  };
}

export function emptyStrategy(): Strategy {
  return {
    concept: "",
    buyer: "",
    awareness: "",
    emotionalArc: "",
    messenger: "",
    stakes: "",
    intendedAction: "",
    hypothesis: "",
    whyFormat: "",
    variables: "",
    controls: "",
    breakEven: MISSING_THRESHOLD,
    spendCap: MISSING_THRESHOLD,
    killPromote: MISSING_THRESHOLD,
    nextTest: "",
  };
}

export function emptySnapshot(): Snapshot {
  return {
    intake: {
      idea: "",
      sourceType: "",
      spottedBy: "",
      spottedOn: "",
      hypothesis: "",
      parentCode: "net new",
      sheetLink: "",
      medium: "",
      executionStyle: "",
      otherMedium: "",
      otherExecution: "",
      brand: "TriCore",
    },
    reference: {
      url: "",
      title: "",
      note: "",
      reviewedAt: null,
      reviewedById: null,
      reviewedByName: null,
    },
    analysis: null,
    findings: [],
    strategy: emptyStrategy(),
    offer: {
      landingUrl: "MISSING",
      landingSource: "",
      offerPrice: "MISSING",
      offerSource: "",
      limits: "MISSING",
      limitsSource: "",
      cta: "",
      ctaSource: "",
      productLanguage: "",
      productSource: "",
    },
    mechanism: {
      mechanism: "",
      honestyLine: "",
      proofs: [],
      proofNone: false,
      claims: [],
      claimsNone: false,
      realPeople: "",
      realPeopleNone: false,
    },
    beats: [],
    guardrails: "",
    openItems: "",
    modules: {
      customized: false,
      video: videoModule(),
      static: staticModule(),
      native: nativeModule(),
    },
    assets: [],
    copyAuthoredAt: null,
    revisions: {
      reference: 1,
      strategy: 1,
      offer: 1,
      mechanism: 1,
      beats: 1,
      guardrails: 1,
      openItems: 1,
      video: 1,
      static: 1,
      native: 1,
      assets: 1,
      modules: 1,
    },
  };
}

export type ModulePlan = { video: boolean; static: boolean; native: boolean };

export function planModules(medium: string, executionStyle: string): ModulePlan {
  const native = executionStyle === "Native avatar-story";
  const video = medium === "Video";
  const still = medium === "Still image";
  return {
    video,
    native,
    static: still && !native,
  };
}

export function naReasonFor(key: "video" | "static" | "native", plan: ModulePlan, executionStyle: string): string {
  if (key === "static" && executionStyle === "Native avatar-story" && !plan.static) {
    return "N/A — covered by the native module.";
  }
  return "N/A — not this format.";
}

export function applyModulePlan(snapshot: Snapshot, medium: string, executionStyle: string): void {
  if (snapshot.modules.customized) return;
  if (!medium || !executionStyle) return;
  const plan = planModules(medium, executionStyle);
  (["video", "static", "native"] as const).forEach((key) => {
    const module = snapshot.modules[key];
    if (plan[key]) {
      module.state = "active";
      module.naReason = "";
    } else {
      module.state = "na";
      module.naReason = naReasonFor(key, plan, executionStyle);
    }
  });
}

export function findingStatus(finding: Finding): { ok: boolean; reason: string } {
  const observed = finding.referenceObserved.trim();
  const na = finding.naReason.trim();
  const hasEvidence = finding.evidence.some((item) => item.location.trim() || item.quote.trim());
  if (finding.requirement === "conditional") {
    if (!observed && !na) {
      return { ok: false, reason: `${finding.label} needs a finding or an N/A reason.` };
    }
    if (!observed && na) return { ok: true, reason: "" };
    if (!hasEvidence) {
      return { ok: false, reason: `${finding.label} is present and needs its own evidence.` };
    }
    return { ok: true, reason: "" };
  }
  if (!observed) return { ok: false, reason: `${finding.label} needs an observed finding.` };
  if (!hasEvidence) {
    return { ok: false, reason: `${finding.label} needs evidence. A score or a link alone is not a finding.` };
  }
  return { ok: true, reason: "" };
}

export function adaptationStatus(finding: Finding): { ok: boolean; reason: string } {
  if (finding.requirement === "conditional" && finding.naReason.trim() && !finding.referenceObserved.trim()) {
    return { ok: true, reason: "" };
  }
  if (!finding.adaptation.trim()) return { ok: false, reason: `${finding.label} needs an adaptation.` };
  return { ok: true, reason: "" };
}

export function hasYear(value: string): boolean {
  return /\b20\d{2}\b/.test(value);
}

export function isMissingValue(value: string): boolean {
  return !value.trim() || /^missing\b/i.test(value.trim());
}

function filled(value: string): boolean {
  return value.trim().length > 0;
}

export function moduleHasCopy(snapshot: Snapshot): boolean {
  const { video, static: still, native } = snapshot.modules;
  if (video.state === "active" && (filled(video.voScript) || video.scenes.length > 0 || filled(video.bodyClose))) return true;
  if (still.state === "active" && (filled(still.subject) || filled(still.primaryText))) return true;
  if (native.state === "active" && (filled(native.opening) || filled(native.subject) || filled(native.situation))) return true;
  return false;
}

export function sectionHashes(snapshot: Snapshot): Record<string, string> {
  const findings = snapshot.findings.map(({ revision: _revision, ...rest }) => rest);
  return {
    intake: sha256(snapshot.intake),
    reference: sha256(snapshot.reference),
    analysis: sha256({ analysis: snapshot.analysis, findings }),
    strategy: sha256(snapshot.strategy),
    offer: sha256(snapshot.offer),
    mechanism: sha256(snapshot.mechanism),
    beats: sha256(snapshot.beats),
    guardrails: sha256(snapshot.guardrails),
    openItems: sha256(snapshot.openItems),
    video: sha256(snapshot.modules.video),
    static: sha256(snapshot.modules.static),
    native: sha256(snapshot.modules.native),
    assets: sha256(snapshot.assets),
    modules: sha256({
      video: snapshot.modules.video.state,
      static: snapshot.modules.static.state,
      native: snapshot.modules.native.state,
    }),
  };
}

export function contentHash(snapshot: Snapshot): string {
  const { revisions: _revisions, ...content } = snapshot;
  const findings = content.findings.map(({ revision: _revision, ...rest }) => rest);
  return sha256({ ...content, findings });
}

export function blankContent(snapshot: Snapshot): boolean {
  const idea = snapshot.intake.idea.trim();
  const anyFinding = snapshot.findings.some((finding) => finding.referenceObserved.trim() || finding.naReason.trim());
  return !idea || !anyFinding || !moduleHasCopy(snapshot);
}
