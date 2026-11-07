import type { Role } from "./constants";
import {
  adaptationStatus,
  findingStatus,
  hasYear,
  isMissingValue,
  type Finding,
  type Snapshot,
} from "./snapshot";

export type CheckResult = "pass" | "fail" | "na";

export type CheckView = {
  key: string;
  title: string;
  group: string;
  result: CheckResult;
  reason: string;
  owner: Role;
  stale: boolean;
  staleReason: string;
  blocks: "approval" | "handoff" | "none";
  needsAttestation: boolean;
};

export type Attestation = {
  result: "pass" | "fail";
  reason: string;
  basis: Record<string, string>;
  checkedByName?: string;
};

type Input = {
  snapshot: Snapshot;
  hashes: Record<string, string>;
  attestations: Record<string, Attestation | undefined>;
  assignments: { strategist: boolean; copyWriter: boolean; editor: boolean };
  creativeCode: string | null;
  historicalOrder: boolean;
  earliestAnalysisAt: string | null;
  approved: boolean;
  handoffAcceptance: "none" | "pending" | "accepted" | "gaps";
  handoffDestination: string;
};

function attest(input: Input, key: string, dependsOn: string[]): { stale: boolean; staleReason: string; result?: "pass" | "fail"; reason: string } {
  const row = input.attestations[key];
  if (!row) return { stale: false, staleReason: "", reason: "" };
  const changed = dependsOn.filter((section) => row.basis[section] !== input.hashes[section]);
  if (changed.length) {
    return {
      stale: true,
      staleReason: `Stale because ${changed.join(", ")} changed after this confirmation.`,
      result: row.result,
      reason: row.reason,
    };
  }
  return { stale: false, staleReason: "", result: row.result, reason: row.reason };
}

function sourcedList(none: boolean, rows: { text: string; source: string }[], name: string): string | null {
  if (none) return null;
  if (!rows.length) return `Say that there are no ${name}, or add each one with its source.`;
  const gap = rows.find((row) => !row.text.trim() || !row.source.trim());
  if (gap) return `Every ${name} item needs the item and its source.`;
  return null;
}

export function evaluateChecks(input: Input): CheckView[] {
  const { snapshot } = input;
  const modules = snapshot.modules;
  const checks: CheckView[] = [];
  const push = (check: CheckView) => checks.push(check);

  const headerGaps: string[] = [];
  if (!input.creativeCode) headerGaps.push("pipeline ID");
  if (!snapshot.intake.medium) headerGaps.push("medium");
  if (!snapshot.intake.executionStyle) headerGaps.push("execution style");
  if (!snapshot.intake.sourceType) headerGaps.push("source type");
  if (!input.assignments.strategist) headerGaps.push("strategist");
  if (!input.assignments.copyWriter) headerGaps.push("copy writer");
  (["video", "static", "native"] as const).forEach((key) => {
    const module = modules[key];
    if (module.state === "na" && !module.naReason.trim()) headerGaps.push(`${key} module N/A reason`);
    if (module.state !== "active" && module.state !== "na") headerGaps.push(`${key} module choice`);
  });
  push({
    key: "c1-header",
    group: "C1 Shared",
    title: "A0 is filled, the format is chosen, and unused modules are N/A.",
    owner: "strategist",
    blocks: "approval",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: headerGaps.length ? "fail" : "pass",
    reason: headerGaps.length ? `Still missing: ${headerGaps.join(", ")}.` : "Header, format, and unused modules are recorded.",
  });

  const referenceOk = Boolean(snapshot.reference.url.trim() && snapshot.reference.reviewedAt && snapshot.reference.reviewedByName);
  push({
    key: "c1-reference",
    group: "C1 Shared",
    title: "Reference ad is linked and reviewed, with who and when.",
    owner: "strategist",
    blocks: "approval",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: referenceOk ? "pass" : "fail",
    reason: referenceOk
      ? `Reviewed by ${snapshot.reference.reviewedByName} on ${snapshot.reference.reviewedAt}.`
      : "Add the reference link and mark it reviewed.",
  });

  const copyAt = snapshot.copyAuthoredAt;
  const earliest = input.earliestAnalysisAt;
  let scorecard: CheckView = {
    key: "c1-scorecard",
    group: "C1 Shared",
    title: "Scorecard version is linked and dated before the first copy.",
    owner: "copy_writer",
    blocks: "approval",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: "fail",
    reason: "The breakdown has not been created.",
  };
  if (!snapshot.analysis) {
    scorecard.reason = "The breakdown has not been created.";
  } else if (copyAt && earliest && earliest > copyAt) {
    scorecard.reason = input.historicalOrder
      ? "Historical order kept: the copy is dated before the analysis. The dates were not rewritten, so this cannot become a final draft."
      : "The analysis is dated after the first copy.";
  } else if (snapshot.analysis.state !== "ready") {
    scorecard.reason = "The breakdown exists and is not marked ready.";
  } else {
    scorecard = {
      ...scorecard,
      result: "pass",
      reason: copyAt
        ? `Analysis v${snapshot.analysis.versionNumber} is ready. An earlier or equal analysis date precedes the first copy.`
        : `Analysis v${snapshot.analysis.versionNumber} is ready. Copy has not been started.`,
    };
  }
  push(scorecard);

  const findingGaps = snapshot.findings.map(findingStatus).filter((item) => !item.ok).map((item) => item.reason);
  push({
    key: "c1-analysis",
    group: "C1 Shared",
    title: "All 18 labels have a finding or a legal N/A.",
    owner: "copy_writer",
    blocks: "approval",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: snapshot.findings.length === 18 && findingGaps.length === 0 ? "pass" : "fail",
    reason: findingGaps.length ? findingGaps.slice(0, 3).join(" ") : "All 18 labels are resolved.",
  });

  const match = Boolean(snapshot.analysis && snapshot.findings.length === 18);
  push({
    key: "c1-match",
    group: "C1 Shared",
    title: "The brief shows the linked scorecard version.",
    owner: "copy_writer",
    blocks: "approval",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: match ? "pass" : "fail",
    reason: match
      ? `This version displays analysis v${snapshot.analysis?.versionNumber}.`
      : "The brief is not pinned to a breakdown.",
  });

  push({
    key: "c1-columns",
    group: "C1 Shared",
    title: "Observed finding, inference, and adaptation stay separate.",
    owner: "copy_writer",
    blocks: "approval",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: snapshot.findings.length ? "pass" : "fail",
    reason: snapshot.findings.length
      ? "Those three are separate fields. The software does not merge them."
      : "The breakdown has not been created.",
  });

  const offerGaps: string[] = [];
  const offerPairs: [string, string, string][] = [
    ["Landing page", snapshot.offer.landingUrl, snapshot.offer.landingSource],
    ["Offer", snapshot.offer.offerPrice, snapshot.offer.offerSource],
    ["Limits", snapshot.offer.limits, snapshot.offer.limitsSource],
  ];
  offerPairs.forEach(([name, value, source]) => {
    if (isMissingValue(value) || !hasYear(source)) offerGaps.push(`${name} needs a verified value plus source and date`);
  });
  if (!snapshot.offer.cta.trim()) offerGaps.push("CTA wording");
  if (!snapshot.offer.productLanguage.trim()) offerGaps.push("product language");
  push({
    key: "c1-offer",
    group: "C1 Shared",
    title: "Landing page, offer, and limits are verified against a source and date.",
    owner: "strategist",
    blocks: "approval",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: offerGaps.length ? "fail" : "pass",
    reason: offerGaps.length ? offerGaps.join(". ") + "." : "Offer fields name a source and a year.",
  });

  const claimGap = [
    sourcedList(snapshot.mechanism.proofNone, snapshot.mechanism.proofs, "proof"),
    sourcedList(snapshot.mechanism.claimsNone, snapshot.mechanism.claims, "claims"),
    snapshot.mechanism.realPeopleNone || snapshot.mechanism.realPeople.trim()
      ? null
      : "Record real-people permission, or mark that no real person is used.",
  ].filter(Boolean) as string[];
  push({
    key: "c1-claims",
    group: "C1 Shared",
    title: "Every claim and proof item has a source, and real-people permission is recorded.",
    owner: "copy_writer",
    blocks: "approval",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: claimGap.length ? "fail" : "pass",
    reason: claimGap.join(" ") || "Claims, proof, and real-people status are sourced.",
  });

  const invented = attest(input, "c1-invented", ["mechanism", "native", "static", "video"]);
  const nativeRealityOk = modules.native.state !== "active" || modules.native.reality !== "";
  push({
    key: "c1-invented",
    group: "C1 Shared",
    title: "No invented testimonial, medical event, or endorsement. Illustrative work is not presented as real.",
    owner: "copy_writer",
    blocks: "approval",
    needsAttestation: true,
    stale: invented.stale,
    staleReason: invented.staleReason,
    result: !nativeRealityOk ? "fail" : invented.stale ? "fail" : invented.result === "pass" ? "pass" : "fail",
    reason: !nativeRealityOk
      ? "The native story must say whether it is real or illustrative."
      : invented.stale
        ? invented.staleReason
        : invented.result === "pass"
          ? invented.reason || "Copy writer confirmed this."
          : "Copy writer confirmation is still required.",
  });

  const honesty = attest(input, "c1-honesty", ["mechanism"]);
  const honestyLine = snapshot.mechanism.honestyLine.trim();
  push({
    key: "c1-honesty",
    group: "C1 Shared",
    title: "Mechanism honesty line is written and obeyed.",
    owner: "copy_writer",
    blocks: "approval",
    needsAttestation: true,
    stale: honesty.stale,
    staleReason: honesty.staleReason,
    result: !honestyLine ? "fail" : honesty.stale ? "fail" : honesty.result === "pass" ? "pass" : "fail",
    reason: !honestyLine
      ? "Write what the ad must not imply."
      : honesty.stale
        ? honesty.staleReason
        : honesty.result === "pass"
          ? honesty.reason || "Copy writer confirmed the line is obeyed."
          : "The line is written. Copy writer confirmation is still required.",
  });

  const beatGaps = snapshot.beats.length
    ? snapshot.beats
        .filter((beat) => !beat.referenceBeat.trim() || (!beat.ourBeat.trim() && !beat.departure.trim()))
        .map((beat) => beat.referenceBeat || "A beat")
    : ["at least one reference beat"];
  push({
    key: "c1-beats",
    group: "C1 Shared",
    title: "Every reference beat is covered or a departure is recorded.",
    owner: "copy_writer",
    blocks: "approval",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: snapshot.beats.length > 0 && beatGaps.length === 0 ? "pass" : "fail",
    reason:
      snapshot.beats.length > 0 && beatGaps.length === 0
        ? "Beat coverage is filled."
        : `Beat coverage is incomplete: ${beatGaps.slice(0, 3).join(", ")}.`,
  });

  const strategy = snapshot.strategy;
  const strategyGaps = [
    ["hypothesis", strategy.hypothesis],
    ["test variable", strategy.variables],
    ["controls", strategy.controls],
    ["concept", strategy.concept],
    ["buyer", strategy.buyer],
    ["why this format", strategy.whyFormat],
  ].filter(([, value]) => !String(value).trim()).map(([name]) => name);
  push({
    key: "c1-hypothesis",
    group: "C1 Shared",
    title: "Hypothesis, variable, and controls are filled. Missing thresholds block launch only.",
    owner: "strategist",
    blocks: "approval",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: strategyGaps.length ? "fail" : "pass",
    reason: strategyGaps.length
      ? `Still missing: ${strategyGaps.join(", ")}. Thresholds may stay MISSING.`
      : "Hypothesis, variable, and controls are filled. MISSING thresholds do not block this draft.",
  });

  const adaptationGaps = snapshot.findings.map(adaptationStatus).filter((item) => !item.ok).map((item) => item.reason);
  push({
    key: "c1-adaptation",
    group: "C1 Shared",
    title: "Adaptation is written for every label that has a finding.",
    owner: "strategist",
    blocks: "approval",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: snapshot.findings.length === 18 && adaptationGaps.length === 0 ? "pass" : "fail",
    reason: adaptationGaps.length ? adaptationGaps.slice(0, 2).join(" ") : "Adaptation is filled.",
  });

  const videoOn = modules.video.state === "active";
  const videoNa = {
    result: "na" as const,
    reason: modules.video.naReason || "N/A — not this format.",
    stale: false,
    staleReason: "",
    needsAttestation: false,
    blocks: "approval" as const,
    owner: "copy_writer" as const,
  };
  if (!videoOn) {
    push({ ...videoNa, key: "c2-scenes", group: "C2 Video", title: "Every reference beat has a scene block." });
    push({ ...videoNa, key: "c2-shots", group: "C2 Video", title: "Every VO line has a shot with the exact action." });
    push({ ...videoNa, key: "c2-dialin", group: "C2 Video", title: "Visual Dial-In is filled and the first frame matches the first line." });
    push({ ...videoNa, key: "c2-leads", group: "C2 Video", title: "Leads share one locked body and close, and specs come from a confirmed source." });
  } else {
    const video = modules.video;
    const uncovered = snapshot.beats.filter((beat) => !video.scenes.some((scene) => scene.beat.trim() === beat.referenceBeat.trim()));
    push({
      key: "c2-scenes",
      group: "C2 Video",
      title: "Every reference beat has a scene block.",
      owner: "copy_writer",
      blocks: "approval",
      needsAttestation: false,
      stale: false,
      staleReason: "",
      result: snapshot.beats.length > 0 && uncovered.length === 0 && video.scenes.every((scene) => scene.visual.trim()) ? "pass" : "fail",
      reason: uncovered.length ? `No scene for: ${uncovered.map((beat) => beat.referenceBeat).slice(0, 3).join(", ")}.` : video.scenes.length ? "Scene blocks cover the beats." : "Add the scene blocks.",
    });
    const lines = video.voScript.split("\n").map((line) => line.trim()).filter(Boolean);
    const shotsOk = lines.length > 0 && video.shots.length >= lines.length && video.shots.every((shot) => shot.vo.trim() && shot.action.trim());
    push({
      key: "c2-shots",
      group: "C2 Video",
      title: "Every VO line has a shot with the exact action.",
      owner: "copy_writer",
      blocks: "approval",
      needsAttestation: false,
      stale: false,
      staleReason: "",
      result: shotsOk ? "pass" : "fail",
      reason: shotsOk ? "Shot-per-line rows include the action." : "Add the VO script and one shot row with the exact action for every line.",
    });
    const dial = video.dialIn;
    const dialOk = [dial.storyArc, dial.patternInterrupt, dial.mechanismVisual, dial.transition, dial.captionPlan, dial.hookVariants].every((item) => item.trim()) && dial.firstFrameMatches;
    push({
      key: "c2-dialin",
      group: "C2 Video",
      title: "Visual Dial-In is filled and the first frame matches the first line.",
      owner: "copy_writer",
      blocks: "approval",
      needsAttestation: false,
      stale: false,
      staleReason: "",
      result: dialOk ? "pass" : "fail",
      reason: dialOk ? "Visual Dial-In is filled and the first frame is marked as matching." : "Fill Visual Dial-In and confirm the first frame matches the first line.",
    });
    const leadsOk = video.leads.every((lead) => lead.open.trim() && lead.firstFrame.trim()) && video.bodyClose.trim() && video.sharedBackHalf.trim() && video.specs.aspect.trim() && video.specs.source.trim() && hasYear(video.specs.source);
    const packOk = Boolean(video.sourcePack.naReason.trim() || (video.sourcePack.folderUrl.trim() && video.sourcePack.frames.length > 0));
    const motionOk = Boolean(video.motion.naReason.trim() || video.motion.pairs.length > 0);
    const specOk = [video.specs.resolution, video.specs.length, video.audio.voice, video.audio.music, video.captionPlan].every((item) => item.trim());
    push({
      key: "c2-leads",
      group: "C2 Video",
      title: "Leads share one locked body and close, and specs come from a confirmed source.",
      owner: "copy_writer",
      blocks: "approval",
      needsAttestation: false,
      stale: false,
      staleReason: "",
      result: leadsOk && packOk && motionOk && specOk ? "pass" : "fail",
      reason: leadsOk && packOk && motionOk && specOk ? "Leads, body, source pack, and specs are recorded." : "Leads, shared body, source frames or an N/A reason, and confirmed specs are still incomplete.",
    });
  }

  const staticOn = modules.static.state === "active";
  if (!staticOn) {
    const na = { result: "na" as const, reason: modules.static.naReason || "N/A — not this format.", stale: false, staleReason: "", needsAttestation: false, blocks: "approval" as const, owner: "copy_writer" as const };
    push({ ...na, key: "c3-composition", group: "C3 Static", title: "Subject, composition, focal point, crop, and placement are filled." });
    push({ ...na, key: "c3-text", group: "C3 Static", title: "Text-on-image decision is recorded." });
    push({ ...na, key: "c3-relation", group: "C3 Static", title: "Image and copy relationship, asset source, and permission are recorded." });
  } else {
    const still = modules.static;
    const compositionOk = [still.subject, still.composition, still.crop, still.placement].every((item) => item.trim());
    push({
      key: "c3-composition",
      group: "C3 Static",
      title: "Subject, composition, focal point, crop, and placement are filled.",
      owner: "copy_writer",
      blocks: "approval",
      needsAttestation: false,
      stale: false,
      staleReason: "",
      result: compositionOk ? "pass" : "fail",
      reason: compositionOk ? "Static composition fields are filled." : "Subject, composition, crop, and placement are required for a static ad.",
    });
    const textOk = still.textOnImage === "no" || (still.textOnImage === "yes" && still.textHierarchy.trim());
    push({
      key: "c3-text",
      group: "C3 Static",
      title: "Text-on-image decision is recorded.",
      owner: "copy_writer",
      blocks: "approval",
      needsAttestation: false,
      stale: false,
      staleReason: "",
      result: textOk ? "pass" : "fail",
      reason: textOk ? "Text-on-image decision is recorded." : "Choose whether the image has text. If it does, write the hierarchy.",
    });
    const relationOk = still.imageCopy.trim() && still.assetSource.trim() && still.permission.trim();
    push({
      key: "c3-relation",
      group: "C3 Static",
      title: "Image and copy relationship, asset source, and permission are recorded.",
      owner: "copy_writer",
      blocks: "approval",
      needsAttestation: false,
      stale: false,
      staleReason: "",
      result: relationOk ? "pass" : "fail",
      reason: relationOk ? "Image, copy, source, and permission are recorded." : "Write how the image and copy work together, the asset source, and the permission.",
    });
  }

  const nativeOn = modules.native.state === "active";
  if (!nativeOn) {
    const na = { result: "na" as const, reason: modules.native.naReason || "N/A — not this format.", stale: false, staleReason: "", needsAttestation: false, blocks: "approval" as const, owner: "copy_writer" as const };
    push({ ...na, key: "c4-image", group: "C4 Native", title: "Native image fields are filled, and any overlay is an exception with a reason." });
    push({ ...na, key: "c4-story", group: "C4 Native", title: "Avatar story runs from opening through payoff and CTA." });
    push({ ...na, key: "c4-explains", group: "C4 Native", title: "The copy explains what the image means." });
    push({ ...na, key: "c4-reality", group: "C4 Native", title: "Real or illustrative is stated, with permission for a real photo." });
  } else {
    const native = modules.native;
    const imageOk = [native.subject, native.setting, native.framing, native.emotionalCue, native.whyAttention, native.assetSource].every((item) => item.trim()) && (native.overlay === "none" || (native.overlay === "exception" && native.overlayReason.trim()));
    push({
      key: "c4-image",
      group: "C4 Native",
      title: "Native image fields are filled, and any overlay is an exception with a reason.",
      owner: "copy_writer",
      blocks: "approval",
      needsAttestation: false,
      stale: false,
      staleReason: "",
      result: imageOk ? "pass" : "fail",
      reason: imageOk ? "Native image fields are filled." : "Fill the image fields. Overlay stays none unless an exception has a reason.",
    });
    const storyOk = [native.situation, native.narrativeVoice, native.opening, native.incident, native.beliefs, native.turningPoint, native.payoff, native.cta].every((item) => item.trim());
    push({
      key: "c4-story",
      group: "C4 Native",
      title: "Avatar story runs from opening through payoff and CTA.",
      owner: "copy_writer",
      blocks: "approval",
      needsAttestation: false,
      stale: false,
      staleReason: "",
      result: storyOk ? "pass" : "fail",
      reason: storyOk ? "The avatar story is filled in order." : "Fill situation, voice, opening, incident, beliefs, turning point, payoff, and CTA.",
    });
    push({
      key: "c4-explains",
      group: "C4 Native",
      title: "The copy explains what the image means.",
      owner: "copy_writer",
      blocks: "approval",
      needsAttestation: false,
      stale: false,
      staleReason: "",
      result: native.copyMakesImageMean.trim() ? "pass" : "fail",
      reason: native.copyMakesImageMean.trim() ? "The copy states what the image means." : "Write what the copy makes the image mean.",
    });
    const realityOk = native.reality === "illustrative" || (native.reality === "real" && native.permission.trim());
    push({
      key: "c4-reality",
      group: "C4 Native",
      title: "Real or illustrative is stated, with permission for a real photo.",
      owner: "copy_writer",
      blocks: "approval",
      needsAttestation: false,
      stale: false,
      staleReason: "",
      result: realityOk ? "pass" : "fail",
      reason: realityOk ? "Real or illustrative is stated." : "Mark the story real or illustrative. A real photo needs permission.",
    });
  }

  const visual = videoOn || staticOn || nativeOn;
  const assetOk = snapshot.assets.some((asset) => asset.status === "permission_recorded" || (asset.status === "linked" && asset.permission.trim()));
  push({
    key: "c-assets",
    group: "Assets",
    title: "Editor recorded asset status and permission.",
    owner: "editor",
    blocks: "approval",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: visual ? (assetOk ? "pass" : "fail") : "na",
    reason: !visual ? "No visual module is active." : assetOk ? "An asset has status and permission." : "Editor needs to record at least one asset as permission recorded, or linked with a permission note.",
  });

  push({
    key: "c5-exact",
    group: "C5 Approval and handoff",
    title: "The approver approved this exact version.",
    owner: "approver",
    blocks: "handoff",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: input.approved ? "pass" : "fail",
    reason: input.approved ? "This exact version is the final draft." : "This version is not the approved final draft.",
  });

  push({
    key: "c5-reapproval",
    group: "C5 Approval and handoff",
    title: "A content change opens a new version and needs approval again.",
    owner: "approver",
    blocks: "none",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: "pass",
    reason: "Approval sticks to the frozen version. It does not move onto later edits.",
  });

  push({
    key: "c5-destination",
    group: "C5 Approval and handoff",
    title: "Handoff destination is recorded.",
    owner: "strategist",
    blocks: "handoff",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: input.handoffDestination.trim() ? "pass" : "fail",
    reason: input.handoffDestination.trim() ? input.handoffDestination : "The handoff destination is empty.",
  });

  push({
    key: "c5-recipient",
    group: "C5 Approval and handoff",
    title: "The editor accepted the handoff or returned gaps.",
    owner: "editor",
    blocks: "handoff",
    needsAttestation: false,
    stale: false,
    staleReason: "",
    result: input.handoffAcceptance === "accepted" ? "pass" : "fail",
    reason:
      input.handoffAcceptance === "accepted"
        ? "The editor accepted this version."
        : input.handoffAcceptance === "gaps"
          ? "The editor returned gaps. This version is not accepted."
          : input.handoffAcceptance === "pending"
            ? "Handoff is waiting for the editor."
            : "Handoff has not been offered.",
  });

  return checks;
}

export function failing(checks: CheckView[], gate: "approval" | "handoff"): CheckView[] {
  if (gate === "approval") return checks.filter((check) => check.blocks === "approval" && check.result === "fail");
  return checks.filter((check) => check.result === "fail" && (check.blocks === "approval" || check.blocks === "handoff"));
}
