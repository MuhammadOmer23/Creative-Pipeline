import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { after, before, test } from "node:test";
import { ANALYSIS_LABELS } from "../src/domain/labels";
import { IDS } from "../src/server/fixtures";
import { getPool } from "../src/server/db";
import { resetDatabase } from "../scripts/setup-db";
import {
  acceptHandoff,
  addEvidence,
  approveBrief,
  assignRole,
  attest,
  createCreative,
  getCreative,
  markAnalysisReady,
  offerHandoff,
  returnGaps,
  reviewReference,
  revise,
  saveBriefSection,
  saveFinding,
  saveIntake,
  saveReference,
  selectCreative,
  ServiceError,
  submitBrief,
  type Actor,
} from "../src/server/service";
import type { CreativeDto } from "../src/domain/dto";

const strategist: Actor = { id: IDS.strategist, name: "Fixture Strategist", roles: ["strategist"], fixture: true };
const copyWriter: Actor = { id: IDS.copyWriter, name: "Fixture Copy Writer", roles: ["copy_writer"], fixture: true };
const editor: Actor = { id: IDS.editor, name: "Fixture Editor", roles: ["editor"], fixture: true };
const approver: Actor = { id: IDS.approver, name: "Bilal (fixture approver)", roles: ["approver"], fixture: true };

before(async () => {
  process.env.DATABASE_URL ??= "postgres://pipeline:pipeline@127.0.0.1:5432/creative_pipeline_test";
  await resetDatabase();
});

after(async () => {
  await getPool().end();
});

test("keeps the 18 brief labels verbatim", () => {
  assert.equal(ANALYSIS_LABELS.length, 18);
  assert.equal(ANALYSIS_LABELS[0].label, "Beats / anatomy (logical sequence + job of each beat)");
  assert.equal(ANALYSIS_LABELS[11].label, "Belief: current → new");
  assert.equal(ANALYSIS_LABELS[15].label, "Problem ↔ solution mirror");
  assert.equal(ANALYSIS_LABELS[17].label, "Do-not-copy items from reference");
  assert.equal(ANALYSIS_LABELS[5].label, "Authority (Y/N, who; imagery ≠ expert)");
});

test("a copy writer cannot create intake", async () => {
  await assert.rejects(() => createCreative(copyWriter, randomUUID()), (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.status, 403);
    return true;
  });
});

test("repeating a create key does not create a second creative", async () => {
  const key = randomUUID();
  const first = await createCreative(strategist, key);
  const second = await createCreative(strategist, key);
  assert.equal(first.id, second.id);
});

test("intake survives a reload and a stale save conflicts", async () => {
  const created = await createCreative(strategist, randomUUID());
  const saved = await saveIntake(strategist, created.id, {
    idea: "Doorway shoes",
    sourceType: "Swipe",
    spottedBy: "Fixture Strategist",
    spottedOn: "2026-11-07",
    hypothesis: "A repeated object can carry the story.",
    parentCode: "net new",
    sheetLink: "",
    medium: "",
    executionStyle: "",
    otherMedium: "",
    otherExecution: "",
  }, created.intakeRevision);
  const reloaded = await getCreative(strategist, created.id);
  assert.equal(reloaded.intake.idea, "Doorway shoes");
  await assert.rejects(() => saveIntake(strategist, created.id, { ...saved.intake, idea: "Older tab" }, created.intakeRevision), (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.status, 409);
    return true;
  });
});

test("two different brief sections can save together", async () => {
  const current = await draftWithFormat();
  const strategy = saveBriefSection(strategist, current.id, "strategy", { ...current.strategy, concept: "One" }, current.revisions.strategy);
  const offer = saveBriefSection(strategist, current.id, "offer", { ...current.offer, cta: "Read" }, current.revisions.offer);
  const [left, right] = await Promise.all([strategy, offer]);
  const final = left.brief && right.brief ? await getCreative(strategist, current.id) : left;
  assert.equal(final.strategy.concept, "One");
  assert.equal(final.offer.cta, "Read");
});

test("the same finding cannot be saved twice from a stale revision", async () => {
  const current = await draftWithFormat();
  const finding = current.findings[0];
  await saveFinding(copyWriter, current.id, finding.id, { referenceObserved: "First save" }, finding.revision);
  await assert.rejects(() => saveFinding(copyWriter, current.id, finding.id, { referenceObserved: "Stale save" }, finding.revision), (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.status, 409);
    return true;
  });
});

test("copy is refused before the breakdown is ready", async () => {
  const current = await draftWithFormat();
  await assert.rejects(() => saveBriefSection(copyWriter, current.id, "native", { ...current.modules.native, opening: "Too early." }, current.revisions.native), (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.status, 422);
    assert.match(error.message, /breakdown ready/);
    return true;
  });
});

test("a native still uses the native module and can become an accepted final draft", async () => {
  const current = await completeNative();
  assert.equal(current.modules.native.state, "active");
  assert.equal(current.modules.static.state, "na");
  assert.match(current.modules.static.naReason, /covered by the native module/);
  assert.match(current.notes.join(" "), /MISSING/);
  const submitted = await submitBrief(strategist, current.id, randomUUID());
  assert.equal(submitted.brief?.state, "frozen");
  assert.equal(submitted.finalDraftLabel, "No final draft");
  const approved = await approveBrief(approver, current.id, "Approved as the final draft.", randomUUID());
  assert.equal(approved.finalDraftLabel, "Final draft v1");
  assert.match(approved.approvalLabel, /Approved v1/);
  const offered = await offerHandoff(strategist, current.id, "In-app handoff record for this final draft", "", randomUUID());
  assert.equal(offered.handoffLabel, "Awaiting editor acceptance");
  const accepted = await acceptHandoff(editor, current.id, randomUUID());
  assert.equal(accepted.handoffLabel, "Accepted · no launch permission");
  assert.equal(accepted.handoff?.disclaimer, "Recipient acceptance does not authorize production, publishing, or ad spend.");
  const columns = await getPool().query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'creatives' AND column_name IN ('launch_authorized','spend_authorized','published')`,
  );
  assert.equal(columns.rowCount, 0);
});

test("a blank brief cannot be approved", async () => {
  const current = await draftWithFormat();
  await assert.rejects(() => submitBrief(strategist, current.id, randomUUID()), (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.status, 422);
    return true;
  });
});

test("editing after approval leaves the final draft and stales only the dependent check", async () => {
  const current = await completeNative();
  await submitBrief(strategist, current.id, randomUUID());
  const approved = await approveBrief(approver, current.id, "Approved once.", randomUUID());
  const hash = approved.approval?.hash;
  const revised = await revise(strategist, current.id);
  assert.match(revised.finalDraftLabel, /Final draft v1 · working draft v2/);
  assert.equal(revised.approval?.hash, hash);
  const changed = await saveBriefSection(copyWriter, current.id, "native", {
    ...revised.modules.native,
    opening: "A later opening.",
  }, revised.revisions.native);
  const invented = changed.checks.find((check) => check.key === "c1-invented");
  const strategy = changed.checks.find((check) => check.key === "c1-hypothesis");
  assert.equal(invented?.stale, true);
  assert.equal(strategy?.result, "pass");
  assert.equal(strategy?.stale, false);
  const stillApproved = await getCreative(approver, current.id);
  assert.equal(stillApproved.approval?.hash, hash);
  assert.match(stillApproved.approvalLabel, /not approved/);
});

test("the shelved fixture cannot be submitted or shown as approved", async () => {
  const shelved = await getCreative(strategist, IDS.shelved);
  assert.match(shelved.banner ?? "", /Not a live creative/);
  assert.equal(shelved.finalDraftLabel, "No final draft");
  assert.equal(shelved.approvalLabel, "Not approved");
  await assert.rejects(() => submitBrief(strategist, IDS.shelved, randomUUID()), (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.status, 403);
    return true;
  });
});

test("the historical fixture keeps copy before analysis and cannot become a final draft", async () => {
  const historical = await getCreative(strategist, IDS.historical);
  assert.ok(historical.blockers.some((item) => /before the analysis/.test(item.reason)));
  assert.match(historical.nextAction, /rewrites history/);
  await assert.rejects(() => approveBrief(approver, IDS.historical, "No.", randomUUID()), (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.status, 403);
    return true;
  });
});

test("an editor cannot approve, and a tampered hash cannot be approved", async () => {
  const current = await completeNative();
  await submitBrief(strategist, current.id, randomUUID());
  await assert.rejects(() => approveBrief(editor, current.id, "Editor trying to approve.", randomUUID()), (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.status, 403);
    return true;
  });
  await getPool().query(`UPDATE brief_versions SET content_hash = 'tampered' WHERE creative_id = $1 AND state = 'frozen'`, [current.id]);
  await assert.rejects(() => approveBrief(approver, current.id, "Should fail.", randomUUID()), (error: unknown) => {
    assert.ok(error instanceof ServiceError);
    assert.equal(error.status, 409);
    return true;
  });
});

test("video checks apply only when video is the medium", async () => {
  const created = await createCreative(strategist, randomUUID());
  const saved = await saveIntake(strategist, created.id, baseIntake(created, { medium: "Video", executionStyle: "UGC" }), created.intakeRevision);
  await assignRole(strategist, created.id, "copy_writer", IDS.copyWriter);
  const selected = await selectCreative(strategist, created.id, randomUUID());
  assert.equal(selected.modules.video.state, "active");
  assert.equal(selected.modules.native.state, "na");
  const scene = selected.checks.find((check) => check.key === "c2-scenes");
  const native = selected.checks.find((check) => check.key === "c4-story");
  assert.equal(scene?.result, "fail");
  assert.equal(native?.result, "na");
  assert.equal(saved.intake.medium, "Video");
});

test("returned gaps do not accept the handoff", async () => {
  const current = await completeNative();
  await submitBrief(strategist, current.id, randomUUID());
  await approveBrief(approver, current.id, "Approved for a gap return.", randomUUID());
  await offerHandoff(strategist, current.id, "In-app handoff record for this final draft", "", randomUUID());
  const returned = await returnGaps(editor, current.id, "The image permission note is unclear.");
  assert.equal(returned.handoff?.acceptance, "gaps");
  assert.equal(returned.handoffLabel, "Returned with gaps");
  assert.notEqual(returned.handoffLabel, "Accepted · no launch permission");
});

async function draftWithFormat(): Promise<CreativeDto> {
  const created = await createCreative(strategist, randomUUID());
  const saved = await saveIntake(strategist, created.id, baseIntake(created, { medium: "Still image", executionStyle: "Native avatar-story" }), created.intakeRevision);
  await assignRole(strategist, created.id, "copy_writer", IDS.copyWriter);
  await assignRole(strategist, created.id, "editor", IDS.editor);
  return selectCreative(strategist, created.id, randomUUID()).then(async (selected) => {
    assert.ok(selected.code?.startsWith("TC-PIPE-"));
    const again = await selectCreative(strategist, created.id, `same-${created.id}`);
    const repeat = await selectCreative(strategist, created.id, `same-${created.id}`);
    assert.equal(again.code, repeat.code);
    return saved && again ? again : selected;
  });
}

function baseIntake(current: CreativeDto, extra: Partial<CreativeDto["intake"]> = {}): CreativeDto["intake"] {
  return {
    idea: extra.idea ?? "A workable intake",
    sourceType: "Organic",
    spottedBy: "Fixture Strategist",
    spottedOn: "2026-11-07",
    hypothesis: "A hypothesis for the fixture path.",
    parentCode: "net new",
    sheetLink: "",
    medium: extra.medium ?? "",
    executionStyle: extra.executionStyle ?? "",
    otherMedium: "",
    otherExecution: "",
  };
}

async function completeNative(): Promise<CreativeDto> {
  let current = await draftWithFormat();
  current = await saveReference(strategist, current.id, { url: "https://example.test/reference", title: "Reference ad" }, current.revisions.reference);
  current = await reviewReference(strategist, current.id);
  for (const finding of current.findings) {
    current = await saveFinding(copyWriter, current.id, finding.id, {
      referenceObserved: `Observed: ${finding.label}`,
      inference: "Marked inference.",
      naReason: "",
    }, finding.revision);
    const updated = current.findings.find((item) => item.id === finding.id);
    if (!updated) throw new Error("missing finding");
    current = await addEvidence(copyWriter, current.id, finding.id, "0:12", "A line from the reference.", updated.revision);
  }
  for (const finding of current.findings) {
    current = await saveFinding(strategist, current.id, finding.id, { adaptation: `Our version of ${finding.label}` }, finding.revision);
  }
  current = await markAnalysisReady(copyWriter, current.id);
  current = await saveBriefSection(strategist, current.id, "strategy", {
    ...current.strategy,
    concept: "Doorway",
    buyer: "Cold reader",
    awareness: "Linked to the awareness finding.",
    emotionalArc: "Loss to agency",
    messenger: "Illustrative narrator",
    stakes: "Soft",
    intendedAction: "Keep reading",
    hypothesis: "The object holds the story.",
    whyFormat: "A native still lets the copy carry it.",
    variables: "The opening object",
    controls: "No live control.",
  }, current.revisions.strategy);
  current = await saveBriefSection(copyWriter, current.id, "offer", {
    landingUrl: "https://example.test/offer",
    landingSource: "Approved page 2026-11-01",
    offerPrice: "Bundle as listed on the approved page",
    offerSource: "Approved offer 2026-11-01",
    limits: "As published on the approved page",
    limitsSource: "Approved terms 2026-11-01",
    cta: "Learn more",
    ctaSource: "Approved page 2026-11-01",
    productLanguage: "Use the approved product name only.",
    productSource: "Approved facts 2026-11-01",
  }, current.revisions.offer);
  current = await saveBriefSection(copyWriter, current.id, "mechanism", {
    ...current.mechanism,
    mechanism: "A compressed causal chain.",
    honestyLine: "Do not imply a cure or a medical event.",
    proofNone: true,
    claimsNone: true,
    realPeopleNone: true,
  }, current.revisions.mechanism);
  current = await saveBriefSection(copyWriter, current.id, "beats", [{
    id: randomUUID(),
    referenceBeat: "Doorway",
    ourBeat: "Doorway",
    carriedBy: "both",
    departure: "",
  }], current.revisions.beats);
  current = await saveBriefSection(copyWriter, current.id, "native", {
    ...current.modules.native,
    subject: "A pair of shoes",
    setting: "A hallway",
    framing: "Still, little context",
    emotionalCue: "Quiet recognition",
    whyAttention: "The object is familiar.",
    copyMakesImageMean: "The shoes stand for a life that paused.",
    overlay: "none",
    overlayReason: "",
    platformCta: "Learn more",
    assetSource: "Illustrative still",
    situation: "Someone who stopped going out",
    narrativeVoice: "1st",
    opening: "The shoes stayed by the door.",
    incident: "Plans kept being cancelled.",
    beliefs: "Rest alone would fix it.",
    mechanism: "",
    proof: "",
    turningPoint: "The explanation changed.",
    payoff: "The shoes were put on.",
    cta: "Read the story.",
    reality: "illustrative",
    permission: "No real person is shown.",
  }, current.revisions.native);
  current = await saveBriefSection(editor, current.id, "assets", [{
    id: randomUUID(),
    label: "Native still",
    status: "permission_recorded",
    link: "",
    permission: "Illustrative. No real person.",
    mapsTo: "Native image",
  }], current.revisions.assets);
  current = await attest(copyWriter, current.id, "c1-invented", "I did not invent a testimonial, medical event, or endorsement.");
  current = await attest(copyWriter, current.id, "c1-honesty", "The honesty line is obeyed.");
  const failing = current.checks.filter((check) => check.blocks === "approval" && check.result === "fail");
  assert.deepEqual(failing.map((check) => `${check.key}: ${check.reason}`), []);
  return current;
}
