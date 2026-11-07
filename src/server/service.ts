import { randomUUID } from "crypto";
import type { Role } from "../domain/constants";
import { HANDOFF_DISCLAIMER, MISSING_THRESHOLD } from "../domain/constants";
import { evaluateChecks, failing, type Attestation, type CheckView } from "../domain/checks";
import { describeChanges } from "../domain/diff";
import type { CreativeDto, Permissions } from "../domain/dto";
import { sha256 } from "../domain/hash";
import {
  adaptationStatus,
  applyModulePlan,
  blankContent,
  contentHash,
  emptyFindings,
  emptySnapshot,
  findingStatus,
  isMissingValue,
  moduleHasCopy,
  planModules,
  sectionHashes,
  type Finding,
  type Snapshot,
} from "../domain/snapshot";
import { derive } from "../domain/status";
import type { Db } from "./db";
import { getPool, withTx } from "./db";
import type { PoolClient } from "pg";

export class ServiceError extends Error {
  status: number;
  details?: Record<string, unknown>;
  constructor(status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export type Actor = { id: string; name: string; roles: Role[]; fixture: boolean };

type CreativeRow = {
  id: string;
  creative_code: string | null;
  parent_code: string;
  idea: string;
  source_type: string | null;
  spotted_by: string;
  spotted_on: string | null;
  hypothesis: string;
  sheet_link: string | null;
  medium: string | null;
  execution_style: string | null;
  other_medium: string;
  other_execution: string;
  parked: boolean;
  historical_order: boolean;
  fixture_kind: string | null;
  intake_revision: number;
  created_by: string;
};

const HISTORY: Record<string, string> = {
  "creative.created": "Created the intake draft.",
  "intake.saved": "Saved intake.",
  "assignment.saved": "Updated an assignment.",
  "creative.selected": "Selected it into the pipeline.",
  "reference.saved": "Saved the reference.",
  "reference.reviewed": "Marked the reference reviewed.",
  "finding.saved": "Saved a breakdown finding.",
  "evidence.added": "Added evidence.",
  "evidence.removed": "Removed evidence.",
  "analysis.ready": "Marked the breakdown ready.",
  "brief.saved": "Saved a brief section.",
  "modules.chosen": "Updated which format modules are in use.",
  "check.attested": "Confirmed a check.",
  "brief.submitted": "Froze a version and requested approval.",
  "brief.approved": "Approved this exact version as the final draft.",
  "brief.returned": "Returned the version with feedback.",
  "brief.revised": "Started a new working draft.",
  "handoff.offered": "Offered the handoff.",
  "handoff.accepted": "Accepted the handoff.",
  "handoff.gaps": "Returned the handoff with gaps.",
  "creative.parked": "Parked the creative.",
  "creative.unparked": "Returned the creative to the pipeline.",
};

function hasRole(actor: Actor, role: Role): boolean {
  return actor.roles.includes(role);
}

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function audit(db: Db, actor: Actor | null, action: string, creativeId: string | null, payload: Record<string, unknown> = {}) {
  await db.query(
    `INSERT INTO audit_events (id, actor_id, action, creative_id, payload) VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [randomUUID(), actor?.id ?? null, action, creativeId, JSON.stringify(payload)],
  );
}

async function lockCreative(client: PoolClient, id: string): Promise<CreativeRow> {
  const result = await client.query(`SELECT * FROM creatives WHERE id = $1 FOR UPDATE`, [id]);
  if (!result.rowCount) throw new ServiceError(404, "Creative not found.");
  return result.rows[0] as CreativeRow;
}

type Assignment = { role: Role; account_id: string; name: string };

async function loadAssignments(db: Db, creativeId: string): Promise<Assignment[]> {
  const result = await db.query(
    `SELECT a.role, a.account_id, n.name
     FROM creative_assignments a JOIN accounts n ON n.id = a.account_id
     WHERE a.creative_id = $1`,
    [creativeId],
  );
  return result.rows as Assignment[];
}

function canRead(actor: Actor, creative: CreativeRow, assignments: Assignment[]): boolean {
  if (hasRole(actor, "approver") || hasRole(actor, "architect")) return true;
  if (creative.created_by === actor.id) return true;
  return assignments.some((item) => item.account_id === actor.id);
}

function assertRead(actor: Actor, creative: CreativeRow, assignments: Assignment[]) {
  if (!canRead(actor, creative, assignments)) throw new ServiceError(403, "You do not have access to this creative.");
}

function assigned(assignments: Assignment[], role: Role): Assignment | undefined {
  return assignments.find((item) => item.role === role);
}

function assertNotFixture(creative: CreativeRow) {
  if (creative.fixture_kind || creative.parked) {
    throw new ServiceError(403, "This test fixture is not editable, and it cannot be approved or presented as live work.");
  }
}

function assertStrategist(actor: Actor, assignments: Assignment[]) {
  const owner = assigned(assignments, "strategist");
  if (!hasRole(actor, "strategist") || !owner || owner.account_id !== actor.id) {
    throw new ServiceError(403, "The assigned strategist does that.");
  }
}

function intakeFromRow(row: CreativeRow): Snapshot["intake"] {
  return {
    idea: row.idea,
    sourceType: row.source_type ?? "",
    spottedBy: row.spotted_by,
    spottedOn: row.spotted_on ?? "",
    hypothesis: row.hypothesis,
    parentCode: row.parent_code,
    sheetLink: row.sheet_link ?? "",
    medium: row.medium ?? "",
    executionStyle: row.execution_style ?? "",
    otherMedium: row.other_medium,
    otherExecution: row.other_execution,
    brand: "TriCore",
  };
}

function intakeComplete(intake: Snapshot["intake"]): boolean {
  return Boolean(intake.idea.trim() && intake.sourceType && intake.spottedBy.trim() && intake.spottedOn && intake.hypothesis.trim());
}

function validateSheet(link: string) {
  if (!link.trim()) return;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new ServiceError(422, "The sheet link must be an http or https URL. Nothing is written back to the sheet.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ServiceError(422, "The sheet link must be an http or https URL.");
  }
}

async function idempotent(client: PoolClient, actor: Actor, key: string, requestHash: string, fn: () => Promise<string>): Promise<string> {
  if (!key.trim()) throw new ServiceError(400, "An idempotency key is required for this action.");
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]);
  const existing = await client.query(`SELECT request_hash, creative_id FROM idempotency_keys WHERE key = $1`, [key]);
  if (existing.rowCount) {
    if (existing.rows[0].request_hash !== requestHash) {
      throw new ServiceError(409, "This idempotency key was already used for a different request.");
    }
    return existing.rows[0].creative_id as string;
  }
  const creativeId = await fn();
  await client.query(
    `INSERT INTO idempotency_keys (key, account_id, request_hash, creative_id) VALUES ($1,$2,$3,$4)`,
    [key, actor.id, requestHash, creativeId],
  );
  return creativeId;
}

async function draftsAndVersions(db: Db, creativeId: string) {
  const briefs = await db.query(
    `SELECT * FROM brief_versions WHERE creative_id = $1 ORDER BY version_number ASC`,
    [creativeId],
  );
  const analyses = await db.query(
    `SELECT * FROM analysis_versions WHERE creative_id = $1 ORDER BY version_number ASC`,
    [creativeId],
  );
  return {
    briefs: briefs.rows as {
      id: string;
      version_number: number;
      state: string;
      analysis_version_id: string | null;
      snapshot: Snapshot;
      content_hash: string;
      parent_version_id: string | null;
      created_at: Date;
    }[],
    analyses: analyses.rows as {
      id: string;
      version_number: number;
      state: "draft" | "ready";
      authored_at: Date;
      payload: { findings: Finding[] };
    }[],
  };
}

function workingOf<T extends { state: string; version_number: number }>(briefs: T[]): T | null {
  return [...briefs].reverse()[0] ?? null;
}

export async function assemble(db: Db, actor: Actor, creativeId: string): Promise<CreativeDto> {
  const creativeResult = await db.query(`SELECT * FROM creatives WHERE id = $1`, [creativeId]);
  if (!creativeResult.rowCount) throw new ServiceError(404, "Creative not found.");
  const creative = creativeResult.rows[0] as CreativeRow;
  const assignments = await loadAssignments(db, creativeId);
  assertRead(actor, creative, assignments);
  const { briefs, analyses } = await draftsAndVersions(db, creativeId);
  const working = workingOf(briefs);
  const final = [...briefs].reverse().find((item) => item.state === "approved") ?? null;
  const snapshot = working ? (working.snapshot as Snapshot) : emptySnapshot();
  if (!working) snapshot.intake = intakeFromRow(creative);
  const analysis = analyses.find((item) => item.id === working?.analysis_version_id) ?? analyses.at(-1) ?? null;
  if (working && analysis) {
    snapshot.analysis = {
      id: analysis.id,
      versionNumber: analysis.version_number,
      state: analysis.state,
      authoredAt: iso(analysis.authored_at) ?? "",
    };
    snapshot.findings = analysis.payload.findings;
  }

  const checkRows = working
    ? await db.query(`SELECT * FROM checks WHERE brief_version_id = $1`, [working.id])
    : { rows: [] };
  const attestations: Record<string, Attestation> = {};
  for (const row of checkRows.rows) {
    attestations[row.check_key] = { result: row.result, reason: row.reason, basis: row.basis };
  }
  const hashes = sectionHashes(snapshot);
  const earliest = analyses[0] ? iso(analyses[0].authored_at) : null;
  const handoffResult = final
    ? await db.query(`SELECT * FROM handoffs WHERE brief_version_id = $1`, [final.id])
    : { rows: [] as Record<string, string>[] };
  const handoffRow = handoffResult.rows[0] as
    | {
        id: string;
        acceptance: "pending" | "accepted" | "gaps";
        destination: string;
        external_link: string;
        gaps: string;
        disclaimer: string;
        recipient_id: string | null;
      }
    | undefined;
  const approvalResult = final
    ? await db.query(
        `SELECT ap.*, n.name AS approver_name FROM approvals ap JOIN accounts n ON n.id = ap.approver_id WHERE ap.brief_version_id = $1 AND ap.decision = 'approved'`,
        [final.id],
      )
    : { rows: [] as Record<string, unknown>[] };
  const approvalRow = approvalResult.rows[0] as { words: string; approver_name: string; created_at: Date; content_hash: string } | undefined;

  const checks = working
    ? evaluateChecks({
        snapshot,
        hashes,
        attestations,
        assignments: {
          strategist: Boolean(assigned(assignments, "strategist")),
          copyWriter: Boolean(assigned(assignments, "copy_writer")),
          editor: Boolean(assigned(assignments, "editor")),
        },
        creativeCode: creative.creative_code,
        historicalOrder: creative.historical_order,
        earliestAnalysisAt: earliest,
        approved: Boolean(final && working.id === final.id && approvalRow),
        handoffAcceptance: handoffRow && working.id === final?.id ? handoffRow.acceptance : "none",
        handoffDestination: handoffRow && working.id === final?.id ? handoffRow.destination : "",
      })
    : [];

  const findingsOk = snapshot.findings.length === 18 && snapshot.findings.every((finding) => findingStatus(finding).ok);
  const adaptationOk = snapshot.findings.length === 18 && snapshot.findings.every((finding) => adaptationStatus(finding).ok);
  const strategyOk = Boolean(snapshot.strategy.hypothesis.trim() && snapshot.strategy.variables.trim() && snapshot.strategy.controls.trim());
  const copyOk = !checks.some((check) => check.blocks === "approval" && check.result === "fail" && (check.key.startsWith("c2-") || check.key.startsWith("c3-") || check.key.startsWith("c4-")));
  const assetsOk = !checks.some((check) => check.key === "c-assets" && check.result === "fail");
  const approvalFailures = failing(checks, "approval").map((check) => ({ owner: check.owner, reason: check.reason }));
  const feedbackResult = await db.query(
    `SELECT f.*, n.name AS author_name, b.version_number
     FROM feedback f
     JOIN accounts n ON n.id = f.author_id
     JOIN brief_versions b ON b.id = f.brief_version_id
     WHERE b.creative_id = $1 ORDER BY f.created_at ASC`,
    [creativeId],
  );
  const parentFeedback = working?.parent_version_id
    ? feedbackResult.rows.filter((row) => briefs.find((item) => item.id === working.parent_version_id)?.id === row.brief_version_id)
    : [];

  const derived = derive({
    fixtureKind: creative.fixture_kind === "shelved" || creative.fixture_kind === "historical" ? creative.fixture_kind : null,
    parked: creative.parked,
    intakeComplete: intakeComplete(snapshot.intake),
    selected: Boolean(creative.creative_code),
    formatChosen: Boolean(snapshot.intake.medium && snapshot.intake.executionStyle),
    referenceReviewed: Boolean(snapshot.reference.url.trim() && snapshot.reference.reviewedAt),
    analysisState: analysis ? analysis.state : "missing",
    findingsOk,
    adaptationOk,
    strategyOk,
    copyOk: copyOk && (snapshot.modules.video.state === "active" || snapshot.modules.static.state === "active" || snapshot.modules.native.state === "active"),
    assetsOk,
    historicalBlocked: creative.fixture_kind === "historical",
    approvalFailures: creative.fixture_kind ? [] : approvalFailures,
    briefState: (working?.state as "draft" | "frozen" | "approved" | "changes_requested") ?? "none",
    workingVersion: working?.version_number ?? null,
    finalVersion: final?.version_number ?? null,
    handoff: handoffRow ? handoffRow.acceptance : "none",
    thresholdsMissing: [snapshot.strategy.breakEven, snapshot.strategy.spendCap, snapshot.strategy.killPromote].some((item) => isMissingValue(item) || item === MISSING_THRESHOLD),
    hasOpenFeedback: parentFeedback.length > 0 && working?.state === "draft",
  });

  const editable = !creative.fixture_kind && !creative.parked;
  const strategist = assigned(assignments, "strategist");
  const isStrategist = Boolean(editable && strategist && strategist.account_id === actor.id);
  const isCopy = Boolean(editable && assigned(assignments, "copy_writer")?.account_id === actor.id);
  const isEditor = Boolean(editable && assigned(assignments, "editor")?.account_id === actor.id);
  const draft = working?.state === "draft";
  const permissions: Permissions = {
    canEditIntake: isStrategist && (!working || draft),
    canAssign: isStrategist,
    canSelect: isStrategist && !creative.creative_code && intakeComplete(intakeFromRow(creative)),
    canEditReference: isStrategist && draft,
    canReviewReference: isStrategist && draft,
    canEditFindings: isCopy && draft,
    canEditAdaptation: isStrategist && draft,
    canMarkReady: isCopy && draft && analysis?.state !== "ready",
    canEditStrategy: isStrategist && draft,
    canEditOffer: (isStrategist || isCopy) && draft,
    canEditCopy: isCopy && draft && analysis?.state === "ready",
    canEditModules: isStrategist && draft,
    canEditAssets: isEditor && draft,
    canAttest: isCopy && draft,
    canSubmit: isStrategist && draft,
    canApprove: editable && hasRole(actor, "approver") && working?.state === "frozen",
    canRevise: isStrategist && Boolean(working && working.state !== "draft"),
    canOfferHandoff: isStrategist && Boolean(final && working && working.id === final.id && !handoffRow),
    canRespondHandoff: isEditor && Boolean(final && working && working.id === final.id && handoffRow?.acceptance === "pending"),
    canPark: isStrategist && !creative.parked,
  };

  const directoryResult = permissions.canAssign
    ? await db.query(
        `SELECT a.id, a.name, array_remove(array_agg(r.role), null) AS roles
         FROM accounts a LEFT JOIN account_roles r ON r.account_id = a.id
         GROUP BY a.id ORDER BY a.name`,
      )
    : { rows: [] as { id: string; name: string; roles: Role[] }[] };

  const historyResult = await db.query(
    `SELECT e.id, e.action, e.created_at, coalesce(n.name, 'System') AS actor_name
     FROM audit_events e LEFT JOIN accounts n ON n.id = e.actor_id
     WHERE e.creative_id = $1 ORDER BY e.created_at DESC LIMIT 20`,
    [creativeId],
  );
  const recipient = handoffRow?.recipient_id
    ? await db.query(`SELECT name FROM accounts WHERE id = $1`, [handoffRow.recipient_id])
    : { rows: [] as { name: string }[] };

  const changes = final && working && final.id !== working.id ? describeChanges(final.snapshot, snapshot) : [];
  const banner = creative.fixture_kind
    ? "Test fixture. Not a live creative. Not a final draft."
    : creative.parked
      ? "Parked. This is not live and it is not approved."
      : null;

  return {
    id: creative.id,
    code: creative.creative_code,
    fixtureKind: creative.fixture_kind === "shelved" || creative.fixture_kind === "historical" ? creative.fixture_kind : null,
    banner,
    intakeRevision: creative.intake_revision,
    intake: {
      idea: snapshot.intake.idea,
      sourceType: snapshot.intake.sourceType,
      spottedBy: snapshot.intake.spottedBy,
      spottedOn: snapshot.intake.spottedOn,
      hypothesis: snapshot.intake.hypothesis,
      parentCode: snapshot.intake.parentCode,
      sheetLink: snapshot.intake.sheetLink,
      medium: snapshot.intake.medium,
      executionStyle: snapshot.intake.executionStyle,
      otherMedium: snapshot.intake.otherMedium,
      otherExecution: snapshot.intake.otherExecution,
    },
    assignments: assignments.map((item) => ({ role: item.role, accountId: item.account_id, name: item.name })),
    directory: directoryResult.rows.map((row) => ({ id: row.id, name: row.name, roles: row.roles ?? [] })),
    reference: snapshot.reference,
    analysis: snapshot.analysis,
    findings: snapshot.findings,
    strategy: snapshot.strategy,
    offer: snapshot.offer,
    mechanism: snapshot.mechanism,
    beats: snapshot.beats,
    guardrails: snapshot.guardrails,
    openItems: snapshot.openItems,
    modules: snapshot.modules,
    assets: snapshot.assets,
    revisions: snapshot.revisions,
    copyAuthoredAt: snapshot.copyAuthoredAt,
    brief: working ? { id: working.id, number: working.version_number, state: working.state, hash: working.content_hash } : null,
    versions: briefs.map((item) => ({
      id: item.id,
      number: item.version_number,
      state: item.state,
      hash: item.content_hash,
      createdAt: iso(item.created_at) ?? "",
      isFinalDraft: item.id === final?.id,
    })),
    checks,
    changes,
    feedback: feedbackResult.rows.map((row) => ({
      id: row.id,
      section: row.section_key,
      body: row.body,
      authorName: row.author_name,
      versionNumber: row.version_number,
      createdAt: iso(row.created_at) ?? "",
    })),
    approval: approvalRow && final
      ? {
          versionNumber: final.version_number,
          words: approvalRow.words,
          approverName: approvalRow.approver_name,
          at: iso(approvalRow.created_at) ?? "",
          hash: approvalRow.content_hash,
        }
      : null,
    handoff: handoffRow && final
      ? {
          id: handoffRow.id,
          versionNumber: final.version_number,
          acceptance: handoffRow.acceptance,
          destination: handoffRow.destination,
          externalLink: handoffRow.external_link,
          gaps: handoffRow.gaps,
          disclaimer: handoffRow.disclaimer,
          recipientName: recipient.rows[0]?.name ?? "",
        }
      : null,
    stageLabel: derived.stageLabel,
    nextAction: derived.nextAction,
    owner: derived.owner,
    blockers: derived.blockers,
    notes: derived.notes,
    finalDraftLabel: derived.finalDraftLabel,
    approvalLabel: derived.approvalLabel,
    handoffLabel: derived.handoffLabel,
    permissions,
    history: historyResult.rows.map((row) => ({
      id: row.id,
      at: iso(row.created_at) ?? "",
      sentence: HISTORY[row.action] ?? row.action,
      actorName: row.actor_name,
    })),
  };
}

async function remember(client: PoolClient, actor: Actor, creativeId: string): Promise<CreativeDto> {
  const dto = await assemble(client, actor, creativeId);
  await client.query(
    `UPDATE creatives SET stage = $2, approval_status = $3, handoff_status = $4, updated_at = now() WHERE id = $1`,
    [
      creativeId,
      dto.stageLabel.toLowerCase(),
      dto.approvalLabel.startsWith("Awaiting") ? "pending" : dto.finalDraftLabel.startsWith("Final draft") && dto.approvalLabel.includes("not approved") ? "stale" : dto.approval ? "approved" : "none",
      dto.handoff?.acceptance === "accepted" ? "accepted" : dto.handoff?.acceptance === "gaps" ? "gaps" : dto.handoff?.acceptance === "pending" ? "awaiting" : "not_offered",
    ],
  );
  return dto;
}

async function saveDraftSnapshot(client: PoolClient, briefId: string, snapshot: Snapshot) {
  const result = await client.query(
    `UPDATE brief_versions
     SET snapshot = $2::jsonb, content_hash = $3, analysis_version_id = $4
     WHERE id = $1 AND state = 'draft'`,
    [briefId, JSON.stringify(snapshot), contentHash(snapshot), snapshot.analysis?.id ?? null],
  );
  if (!result.rowCount) throw new ServiceError(409, "This version is frozen. Start a revision before editing it.");
}

async function draftContext(client: PoolClient, creativeId: string) {
  const result = await client.query(
    `SELECT * FROM brief_versions WHERE creative_id = $1 ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,
    [creativeId],
  );
  if (!result.rowCount) throw new ServiceError(422, "Select the creative into the pipeline before writing the brief.");
  const brief = result.rows[0] as { id: string; state: string; version_number: number; snapshot: Snapshot; analysis_version_id: string | null; parent_version_id: string | null };
  if (brief.state !== "draft") throw new ServiceError(409, "This version is frozen. Start a revision before editing it.");
  const snapshot = brief.snapshot as Snapshot;
  return { brief, snapshot };
}

export async function getCreative(actor: Actor, id: string): Promise<CreativeDto> {
  return assemble(getPool(), actor, id);
}

export async function listPipeline(actor: Actor): Promise<CreativeDto[]> {
  const seeAll = hasRole(actor, "approver") || hasRole(actor, "architect");
  const result = await getPool().query(
    `SELECT id FROM creatives c
     WHERE $1::boolean OR c.created_by = $2 OR EXISTS (
       SELECT 1 FROM creative_assignments a WHERE a.creative_id = c.id AND a.account_id = $2
     )
     ORDER BY updated_at DESC LIMIT 200`,
    [seeAll, actor.id],
  );
  const cards: CreativeDto[] = [];
  for (const row of result.rows) cards.push(await getCreative(actor, row.id));
  return cards;
}

export async function createCreative(actor: Actor, key: string): Promise<CreativeDto> {
  if (!hasRole(actor, "strategist")) throw new ServiceError(403, "A strategist creates intake.");
  return withTx(async (client) => {
    const id = await idempotent(client, actor, key, sha256({ action: "create", actor: actor.id }), async () => {
      const creativeId = randomUUID();
      await client.query(
        `INSERT INTO creatives (id, idea, created_by) VALUES ($1, '', $2)`,
        [creativeId, actor.id],
      );
      await client.query(
        `INSERT INTO creative_assignments (creative_id, role, account_id, assigned_by) VALUES ($1,'strategist',$2,$2)`,
        [creativeId, actor.id],
      );
      await audit(client, actor, "creative.created", creativeId);
      return creativeId;
    });
    return remember(client, actor, id);
  });
}

export async function saveIntake(actor: Actor, id: string, patch: Partial<CreativeDto["intake"]>, baseRevision: number): Promise<CreativeDto> {
  return withTx(async (client) => {
    const creative = await lockCreative(client, id);
    const assignments = await loadAssignments(client, id);
    assertRead(actor, creative, assignments);
    assertNotFixture(creative);
    assertStrategist(actor, assignments);
    const current = intakeFromRow(creative);
    const next = { ...current, ...patch, brand: "TriCore" };
    validateSheet(next.sheetLink);
    if (!["", "Organic", "Swipe"].includes(next.sourceType)) throw new ServiceError(422, "Source type is Organic or Swipe.");
    if (next.medium && !["Video", "Still image", "Other"].includes(next.medium)) throw new ServiceError(422, "Medium must be Video, Still image, or Other.");
    const updated = await client.query(
      `UPDATE creatives SET
        idea=$2, source_type=NULLIF($3,''), spotted_by=$4, spotted_on=NULLIF($5,'')::date, hypothesis=$6,
        parent_code=$7, sheet_link=NULLIF($8,''), medium=NULLIF($9,''), execution_style=NULLIF($10,''),
        other_medium=$11, other_execution=$12, intake_revision=intake_revision+1
       WHERE id=$1 AND intake_revision=$13
       RETURNING intake_revision`,
      [id, next.idea, next.sourceType, next.spottedBy, next.spottedOn, next.hypothesis, next.parentCode || "net new", next.sheetLink, next.medium, next.executionStyle, next.otherMedium, next.otherExecution, baseRevision],
    );
    if (!updated.rowCount) {
      throw new ServiceError(409, "Someone else saved intake. Your copy was not overwritten.", {
        conflict: true,
        section: "intake",
        revision: creative.intake_revision,
        serverSection: current,
      });
    }
    const draft = await client.query(`SELECT id, state, snapshot FROM brief_versions WHERE creative_id=$1 ORDER BY version_number DESC LIMIT 1`, [id]);
    if (draft.rowCount && draft.rows[0].state === "draft") {
      const snapshot = draft.rows[0].snapshot as Snapshot;
      snapshot.intake = next;
      applyModulePlan(snapshot, next.medium, next.executionStyle);
      await saveDraftSnapshot(client, draft.rows[0].id, snapshot);
    } else if (draft.rowCount) {
      throw new ServiceError(409, "This version is frozen. Start a revision before editing it.");
    }
    await audit(client, actor, "intake.saved", id);
    return remember(client, actor, id);
  });
}

export async function assignRole(actor: Actor, id: string, role: Role, accountId: string): Promise<CreativeDto> {
  if (!["strategist", "copy_writer", "editor"].includes(role)) throw new ServiceError(422, "Assign a strategist, copy writer, or editor.");
  return withTx(async (client) => {
    const creative = await lockCreative(client, id);
    const assignments = await loadAssignments(client, id);
    assertRead(actor, creative, assignments);
    assertNotFixture(creative);
    assertStrategist(actor, assignments);
    const account = await client.query(
      `SELECT a.id FROM accounts a JOIN account_roles r ON r.account_id=a.id WHERE a.id=$1 AND r.role=$2`,
      [accountId, role],
    );
    if (!account.rowCount) throw new ServiceError(422, "That account does not hold this role.");
    await client.query(
      `INSERT INTO creative_assignments (creative_id, role, account_id, assigned_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (creative_id, role) DO UPDATE SET account_id=EXCLUDED.account_id, assigned_by=EXCLUDED.assigned_by, assigned_at=now()`,
      [id, role, accountId, actor.id],
    );
    await audit(client, actor, "assignment.saved", id, { role, accountId });
    return remember(client, actor, id);
  });
}

export async function selectCreative(actor: Actor, id: string, key: string): Promise<CreativeDto> {
  return withTx(async (client) => {
    const creativeId = await idempotent(client, actor, key, sha256({ action: "select", id }), async () => {
      const creative = await lockCreative(client, id);
      const assignments = await loadAssignments(client, id);
      assertRead(actor, creative, assignments);
      assertNotFixture(creative);
      assertStrategist(actor, assignments);
      if (!intakeComplete(intakeFromRow(creative))) throw new ServiceError(422, "Finish the five intake fields before selecting it.");
      if (!creative.creative_code) {
        const next = await client.query(`SELECT nextval('pipeline_code_seq') AS n`);
        const code = `TC-PIPE-${String(next.rows[0].n).padStart(4, "0")}`;
        await client.query(`UPDATE creatives SET creative_code=$2 WHERE id=$1`, [id, code]);
        const findings = emptyFindings();
        const analysisId = randomUUID();
        const authoredAt = new Date().toISOString();
        await client.query(
          `INSERT INTO analysis_versions (id, creative_id, version_number, state, authored_at, payload, created_by)
           VALUES ($1,$2,1,'draft',$3,$4::jsonb,$5)`,
          [analysisId, id, authoredAt, JSON.stringify({ findings }), actor.id],
        );
        const snapshot = emptySnapshot();
        snapshot.intake = { ...intakeFromRow(creative), brand: "TriCore" };
        const fresh = await client.query(`SELECT creative_code, medium, execution_style FROM creatives WHERE id=$1`, [id]);
        snapshot.intake.medium = fresh.rows[0].medium ?? snapshot.intake.medium;
        snapshot.intake.executionStyle = fresh.rows[0].execution_style ?? "";
        applyModulePlan(snapshot, snapshot.intake.medium, snapshot.intake.executionStyle);
        snapshot.analysis = { id: analysisId, versionNumber: 1, state: "draft", authoredAt };
        snapshot.findings = findings;
        await client.query(
          `INSERT INTO brief_versions (id, creative_id, version_number, state, analysis_version_id, snapshot, content_hash, created_by)
           VALUES ($1,$2,1,'draft',$3,$4::jsonb,$5,$6)`,
          [randomUUID(), id, analysisId, JSON.stringify(snapshot), contentHash(snapshot), actor.id],
        );
        await audit(client, actor, "creative.selected", id, { code });
      }
      return id;
    });
    return remember(client, actor, creativeId);
  });
}

export async function saveReference(actor: Actor, id: string, patch: { url?: string; title?: string; note?: string }, baseRevision: number): Promise<CreativeDto> {
  return withTx(async (client) => {
    const creative = await lockCreative(client, id);
    const assignments = await loadAssignments(client, id);
    assertRead(actor, creative, assignments);
    assertNotFixture(creative);
    assertStrategist(actor, assignments);
    const { brief, snapshot } = await draftContext(client, id);
    if ((snapshot.revisions.reference ?? 1) !== baseRevision) {
      throw new ServiceError(409, "Someone else saved the reference.", { conflict: true, section: "reference", revision: snapshot.revisions.reference, serverSection: snapshot.reference });
    }
    snapshot.reference = { ...snapshot.reference, ...patch };
    snapshot.revisions.reference = baseRevision + 1;
    await saveDraftSnapshot(client, brief.id, snapshot);
    await audit(client, actor, "reference.saved", id);
    return remember(client, actor, id);
  });
}

export async function reviewReference(actor: Actor, id: string): Promise<CreativeDto> {
  return withTx(async (client) => {
    const creative = await lockCreative(client, id);
    const assignments = await loadAssignments(client, id);
    assertRead(actor, creative, assignments);
    assertNotFixture(creative);
    assertStrategist(actor, assignments);
    const { brief, snapshot } = await draftContext(client, id);
    if (!snapshot.reference.url.trim()) throw new ServiceError(422, "Add the reference link before marking it reviewed.");
    snapshot.reference.reviewedAt = new Date().toISOString();
    snapshot.reference.reviewedById = actor.id;
    snapshot.reference.reviewedByName = actor.name;
    await saveDraftSnapshot(client, brief.id, snapshot);
    await audit(client, actor, "reference.reviewed", id);
    return remember(client, actor, id);
  });
}

async function analysisForUpdate(client: PoolClient, snapshot: Snapshot) {
  if (!snapshot.analysis) throw new ServiceError(422, "The breakdown does not exist yet.");
  const result = await client.query(`SELECT * FROM analysis_versions WHERE id=$1 FOR UPDATE`, [snapshot.analysis.id]);
  if (!result.rowCount) throw new ServiceError(404, "Breakdown not found.");
  return result.rows[0] as { id: string; creative_id: string; version_number: number; state: "draft" | "ready"; authored_at: Date; payload: { findings: Finding[] } };
}

async function forkAnalysis(client: PoolClient, actor: Actor, analysis: { id: string; creative_id: string; version_number: number; payload: { findings: Finding[] } }, snapshot: Snapshot) {
  const next = await client.query(`SELECT coalesce(max(version_number),0)+1 AS n FROM analysis_versions WHERE creative_id=$1`, [analysis.creative_id]);
  const id = randomUUID();
  const authoredAt = new Date().toISOString();
  const payload = clone(analysis.payload);
  await client.query(
    `INSERT INTO analysis_versions (id, creative_id, version_number, state, authored_at, payload, created_by)
     VALUES ($1,$2,$3,'draft',$4,$5::jsonb,$6)`,
    [id, analysis.creative_id, next.rows[0].n, authoredAt, JSON.stringify(payload), actor.id],
  );
  snapshot.analysis = { id, versionNumber: next.rows[0].n, state: "draft", authoredAt };
  snapshot.findings = payload.findings;
  return { id, payload, state: "draft" as const, version_number: next.rows[0].n as number };
}

export async function saveFinding(
  actor: Actor,
  creativeId: string,
  findingId: string,
  patch: Partial<Pick<Finding, "referenceObserved" | "inference" | "adaptation" | "naReason">>,
  baseRevision: number,
): Promise<CreativeDto> {
  return withTx(async (client) => {
    const creative = await lockCreative(client, creativeId);
    const assignments = await loadAssignments(client, creativeId);
    assertRead(actor, creative, assignments);
    assertNotFixture(creative);
    const { brief, snapshot } = await draftContext(client, creativeId);
    let analysis = await analysisForUpdate(client, snapshot);
    if (analysis.state === "ready") {
      const forked = await forkAnalysis(client, actor, analysis, snapshot);
      analysis = { ...analysis, id: forked.id, payload: forked.payload, state: "draft", version_number: forked.version_number };
    }
    const findings = analysis.payload.findings;
    const finding = findings.find((item) => item.id === findingId);
    if (!finding) throw new ServiceError(404, "Finding not found.");
    if (finding.revision !== baseRevision) {
      throw new ServiceError(409, "Someone else saved this finding.", { conflict: true, section: "finding", revision: finding.revision, serverSection: finding });
    }
    const isCopy = assigned(assignments, "copy_writer")?.account_id === actor.id;
    const isStrategist = assigned(assignments, "strategist")?.account_id === actor.id;
    const copyFields = ["referenceObserved", "inference", "naReason"] as const;
    const changedCopy = copyFields.some((key) => patch[key] !== undefined && patch[key] !== finding[key]);
    const changedAdaptation = patch.adaptation !== undefined && patch.adaptation !== finding.adaptation;
    if (changedCopy && !isCopy) throw new ServiceError(403, "The copy writer writes the observed finding, the inference, and the N/A reason.");
    if (changedAdaptation && !isStrategist) throw new ServiceError(403, "The strategist writes the adaptation.");
    if (!changedCopy && !changedAdaptation && !isCopy && !isStrategist) throw new ServiceError(403, "You cannot edit this finding.");
    Object.assign(finding, patch);
    finding.revision += 1;
    snapshot.findings = findings;
    if (snapshot.analysis) snapshot.analysis.state = "draft";
    await client.query(`UPDATE analysis_versions SET payload=$2::jsonb, state='draft' WHERE id=$1`, [analysis.id, JSON.stringify({ findings })]);
    await saveDraftSnapshot(client, brief.id, snapshot);
    await audit(client, actor, "finding.saved", creativeId, { label: finding.label });
    return remember(client, actor, creativeId);
  });
}

export async function addEvidence(actor: Actor, creativeId: string, findingId: string, location: string, quote: string, baseRevision: number): Promise<CreativeDto> {
  if (!location.trim() && !quote.trim()) throw new ServiceError(422, "Evidence needs a location or a quote.");
  return withTx(async (client) => {
    const creative = await lockCreative(client, creativeId);
    const assignments = await loadAssignments(client, creativeId);
    assertRead(actor, creative, assignments);
    assertNotFixture(creative);
    if (assigned(assignments, "copy_writer")?.account_id !== actor.id) throw new ServiceError(403, "The copy writer adds evidence.");
    const { brief, snapshot } = await draftContext(client, creativeId);
    let analysis = await analysisForUpdate(client, snapshot);
    if (analysis.state === "ready") {
      const forked = await forkAnalysis(client, actor, analysis, snapshot);
      analysis = { ...analysis, id: forked.id, payload: forked.payload, state: "draft", version_number: forked.version_number };
    }
    const finding = analysis.payload.findings.find((item) => item.id === findingId);
    if (!finding) throw new ServiceError(404, "Finding not found.");
    if (finding.revision !== baseRevision) {
      throw new ServiceError(409, "Someone else saved this finding.", { conflict: true, section: "finding", revision: finding.revision, serverSection: finding });
    }
    finding.evidence.push({ id: randomUUID(), location: location.trim(), quote: quote.trim() });
    finding.revision += 1;
    snapshot.findings = analysis.payload.findings;
    await client.query(`UPDATE analysis_versions SET payload=$2::jsonb, state='draft' WHERE id=$1`, [analysis.id, JSON.stringify(analysis.payload)]);
    await saveDraftSnapshot(client, brief.id, snapshot);
    await audit(client, actor, "evidence.added", creativeId, { label: finding.label });
    return remember(client, actor, creativeId);
  });
}

export async function markAnalysisReady(actor: Actor, creativeId: string): Promise<CreativeDto> {
  return withTx(async (client) => {
    const creative = await lockCreative(client, creativeId);
    const assignments = await loadAssignments(client, creativeId);
    assertRead(actor, creative, assignments);
    assertNotFixture(creative);
    if (assigned(assignments, "copy_writer")?.account_id !== actor.id) throw new ServiceError(403, "The copy writer marks the breakdown ready.");
    const { brief, snapshot } = await draftContext(client, creativeId);
    const analysis = await analysisForUpdate(client, snapshot);
    const gaps = analysis.payload.findings.map(findingStatus).filter((item) => !item.ok);
    if (gaps.length) throw new ServiceError(422, gaps.slice(0, 3).map((item) => item.reason).join(" "));
    await client.query(`UPDATE analysis_versions SET state='ready' WHERE id=$1`, [analysis.id]);
    if (snapshot.analysis) snapshot.analysis.state = "ready";
    snapshot.findings = analysis.payload.findings;
    await saveDraftSnapshot(client, brief.id, snapshot);
    await audit(client, actor, "analysis.ready", creativeId);
    return remember(client, actor, creativeId);
  });
}

const STRATEGIST_SECTIONS = new Set(["strategy", "guardrails", "openItems"]);
const SHARED_SECTIONS = new Set(["offer", "mechanism", "beats"]);
const COPY_SECTIONS = new Set(["video", "static", "native"]);

export async function saveBriefSection(actor: Actor, creativeId: string, section: string, value: unknown, baseRevision: number): Promise<CreativeDto> {
  return withTx(async (client) => {
    const creative = await lockCreative(client, creativeId);
    const assignments = await loadAssignments(client, creativeId);
    assertRead(actor, creative, assignments);
    assertNotFixture(creative);
    const isStrategist = assigned(assignments, "strategist")?.account_id === actor.id;
    const isCopy = assigned(assignments, "copy_writer")?.account_id === actor.id;
    const isEditor = assigned(assignments, "editor")?.account_id === actor.id;
    if (STRATEGIST_SECTIONS.has(section) && !isStrategist) throw new ServiceError(403, "The strategist writes strategy.");
    if (SHARED_SECTIONS.has(section) && !isStrategist && !isCopy) throw new ServiceError(403, "The strategist or copy writer writes this section.");
    if (COPY_SECTIONS.has(section) && !isCopy) throw new ServiceError(403, "The copy writer writes the format module.");
    if (section === "assets" && !isEditor) throw new ServiceError(403, "The editor records assets.");
    if (![...STRATEGIST_SECTIONS, ...SHARED_SECTIONS, ...COPY_SECTIONS, "assets"].includes(section)) {
      throw new ServiceError(422, "Unknown section.");
    }
    const { brief, snapshot } = await draftContext(client, creativeId);
    const currentRevision = snapshot.revisions[section] ?? 1;
    if (currentRevision !== baseRevision) {
      const serverSection = section === "video" || section === "static" || section === "native" ? snapshot.modules[section] : (snapshot as unknown as Record<string, unknown>)[section];
      throw new ServiceError(409, "Someone else saved this section. Your copy was not overwritten.", {
        conflict: true,
        section,
        revision: currentRevision,
        serverSection,
      });
    }
    if (section === "video" || section === "static" || section === "native") {
      const moduleValue = value as Snapshot["modules"]["video"];
      moduleValue.state = snapshot.modules[section].state;
      moduleValue.naReason = snapshot.modules[section].naReason;
      snapshot.modules[section] = moduleValue as never;
      if (!snapshot.copyAuthoredAt && moduleHasCopy(snapshot)) {
        if (snapshot.analysis?.state !== "ready") {
          throw new ServiceError(422, "Mark the breakdown ready before writing copy. Reference analysis comes first.");
        }
        snapshot.copyAuthoredAt = new Date().toISOString();
      }
    } else if (section === "assets") {
      snapshot.assets = value as Snapshot["assets"];
    } else {
      (snapshot as unknown as Record<string, unknown>)[section] = value;
    }
    snapshot.revisions[section] = currentRevision + 1;
    await saveDraftSnapshot(client, brief.id, snapshot);
    await audit(client, actor, "brief.saved", creativeId, { section });
    return remember(client, actor, creativeId);
  });
}

export async function chooseModules(actor: Actor, creativeId: string, choice: { video: boolean; static: boolean; native: boolean }, baseRevision: number): Promise<CreativeDto> {
  return withTx(async (client) => {
    const creative = await lockCreative(client, creativeId);
    const assignments = await loadAssignments(client, creativeId);
    assertRead(actor, creative, assignments);
    assertNotFixture(creative);
    assertStrategist(actor, assignments);
    const { brief, snapshot } = await draftContext(client, creativeId);
    if ((snapshot.revisions.modules ?? 1) !== baseRevision) {
      throw new ServiceError(409, "Someone else saved the module choice.", { conflict: true, section: "modules", revision: snapshot.revisions.modules });
    }
    snapshot.modules.customized = true;
    (["video", "static", "native"] as const).forEach((key) => {
      snapshot.modules[key].state = choice[key] ? "active" : "na";
      if (!choice[key]) {
        const plan = planModules(snapshot.intake.medium, snapshot.intake.executionStyle);
        snapshot.modules[key].naReason = key === "static" && snapshot.intake.executionStyle === "Native avatar-story" && !plan.static && !choice.static
          ? "N/A — covered by the native module."
          : "N/A — not this format.";
      } else snapshot.modules[key].naReason = "";
    });
    snapshot.revisions.modules = baseRevision + 1;
    await saveDraftSnapshot(client, brief.id, snapshot);
    await audit(client, actor, "modules.chosen", creativeId);
    return remember(client, actor, creativeId);
  });
}

export async function attest(actor: Actor, creativeId: string, key: "c1-invented" | "c1-honesty", statement: string): Promise<CreativeDto> {
  if (!statement.trim()) throw new ServiceError(422, "Write the confirmation in your own words.");
  return withTx(async (client) => {
    const creative = await lockCreative(client, creativeId);
    const assignments = await loadAssignments(client, creativeId);
    assertRead(actor, creative, assignments);
    assertNotFixture(creative);
    if (assigned(assignments, "copy_writer")?.account_id !== actor.id) throw new ServiceError(403, "The copy writer confirms this.");
    const { brief, snapshot } = await draftContext(client, creativeId);
    if (key === "c1-honesty" && !snapshot.mechanism.honestyLine.trim()) {
      throw new ServiceError(422, "Write the honesty line before confirming it is obeyed.");
    }
    const basis = sectionHashes(snapshot);
    const depends = key === "c1-honesty" ? ["mechanism"] : ["mechanism", "native", "static", "video"];
    const stored: Record<string, string> = {};
    depends.forEach((section) => { stored[section] = basis[section]; });
    await client.query(
      `INSERT INTO checks (brief_version_id, check_key, result, reason, basis, checked_by, checked_at)
       VALUES ($1,$2,'pass',$3,$4::jsonb,$5,now())
       ON CONFLICT (brief_version_id, check_key) DO UPDATE
       SET result='pass', reason=EXCLUDED.reason, basis=EXCLUDED.basis, checked_by=EXCLUDED.checked_by, checked_at=now()`,
      [brief.id, key, statement.trim(), JSON.stringify(stored), actor.id],
    );
    await audit(client, actor, "check.attested", creativeId, { key });
    return remember(client, actor, creativeId);
  });
}

export async function submitBrief(actor: Actor, creativeId: string, key: string): Promise<CreativeDto> {
  return withTx(async (client) => {
    const id = await idempotent(client, actor, key, sha256({ action: "submit", creativeId }), async () => {
      const creative = await lockCreative(client, creativeId);
      const assignments = await loadAssignments(client, creativeId);
      assertRead(actor, creative, assignments);
      assertNotFixture(creative);
      assertStrategist(actor, assignments);
      const { brief, snapshot } = await draftContext(client, creativeId);
      const dto = await assemble(client, actor, creativeId);
      const blocked = dto.checks.filter((check) => check.blocks === "approval" && check.result === "fail");
      if (blankContent(snapshot)) throw new ServiceError(422, "A blank brief cannot be submitted for approval.");
      if (blocked.length) {
        throw new ServiceError(422, "This version still has failing checks.", { checks: blocked.map((check) => check.reason) });
      }
      if (contentHash(snapshot) !== (await client.query(`SELECT content_hash FROM brief_versions WHERE id=$1`, [brief.id])).rows[0].content_hash) {
        throw new ServiceError(409, "The version changed before it could be frozen. Save again and submit once.");
      }
      await client.query(`UPDATE brief_versions SET state='frozen', frozen_at=now(), content_hash=$2 WHERE id=$1 AND state='draft'`, [brief.id, contentHash(snapshot)]);
      await audit(client, actor, "brief.submitted", creativeId, { version: brief.version_number, hash: contentHash(snapshot) });
      return creativeId;
    });
    return remember(client, actor, id);
  });
}

export async function approveBrief(actor: Actor, creativeId: string, words: string, key: string): Promise<CreativeDto> {
  if (words.trim().length < 2) throw new ServiceError(422, "Write the approval in your own words.");
  if (!hasRole(actor, "approver")) throw new ServiceError(403, "An approver approves the exact version.");
  return withTx(async (client) => {
    const id = await idempotent(client, actor, key, sha256({ action: "approve", creativeId, words: words.trim() }), async () => {
      const creative = await lockCreative(client, creativeId);
      const assignments = await loadAssignments(client, creativeId);
      assertRead(actor, creative, assignments);
      assertNotFixture(creative);
      const current = await client.query(`SELECT * FROM brief_versions WHERE creative_id=$1 ORDER BY version_number DESC LIMIT 1 FOR UPDATE`, [creativeId]);
      const brief = current.rows[0] as { id: string; state: string; version_number: number; snapshot: Snapshot; content_hash: string };
      if (!brief || brief.state !== "frozen") throw new ServiceError(422, "There is no frozen version waiting for approval.");
      const snapshot = brief.snapshot as Snapshot;
      if (contentHash(snapshot) !== brief.content_hash) throw new ServiceError(409, "This version's stored hash does not match its contents.");
      if (blankContent(snapshot)) throw new ServiceError(422, "A blank brief cannot become a final draft.");
      const preview = await assemble(client, actor, creativeId);
      const blocked = preview.checks.filter((check: CheckView) => check.blocks === "approval" && check.result === "fail");
      if (blocked.length) throw new ServiceError(422, "Failing checks still block approval.", { checks: blocked.map((check) => check.reason) });
      await client.query(`UPDATE brief_versions SET state='approved' WHERE id=$1`, [brief.id]);
      await client.query(
        `INSERT INTO approvals (id, brief_version_id, approver_id, decision, words, content_hash) VALUES ($1,$2,$3,'approved',$4,$5)`,
        [randomUUID(), brief.id, actor.id, words.trim(), brief.content_hash],
      );
      await audit(client, actor, "brief.approved", creativeId, { version: brief.version_number, hash: brief.content_hash });
      return creativeId;
    });
    return remember(client, actor, id);
  });
}

export async function requestChanges(actor: Actor, creativeId: string, section: string, body: string): Promise<CreativeDto> {
  if (!hasRole(actor, "approver")) throw new ServiceError(403, "An approver returns a version.");
  if (!body.trim()) throw new ServiceError(422, "Write the feedback against a section.");
  return withTx(async (client) => {
    const creative = await lockCreative(client, creativeId);
    const assignments = await loadAssignments(client, creativeId);
    assertRead(actor, creative, assignments);
    assertNotFixture(creative);
    const current = await client.query(`SELECT * FROM brief_versions WHERE creative_id=$1 ORDER BY version_number DESC LIMIT 1 FOR UPDATE`, [creativeId]);
    const brief = current.rows[0] as { id: string; state: string; version_number: number; snapshot: Snapshot; content_hash: string; analysis_version_id: string | null };
    if (!brief || brief.state !== "frozen") throw new ServiceError(422, "Only a frozen version can be returned.");
    await client.query(`UPDATE brief_versions SET state='changes_requested' WHERE id=$1`, [brief.id]);
    await client.query(
      `INSERT INTO feedback (id, brief_version_id, section_key, body, author_id) VALUES ($1,$2,$3,$4,$5)`,
      [randomUUID(), brief.id, section, body.trim(), actor.id],
    );
    const snapshot = clone(brief.snapshot);
    const newId = randomUUID();
    await client.query(
      `INSERT INTO brief_versions (id, creative_id, version_number, state, analysis_version_id, snapshot, content_hash, parent_version_id, created_by)
       VALUES ($1,$2,$3,'draft',$4,$5::jsonb,$6,$7,$8)`,
      [newId, creativeId, brief.version_number + 1, brief.analysis_version_id, JSON.stringify(snapshot), contentHash(snapshot), brief.id, actor.id],
    );
    const priorChecks = await client.query(`SELECT * FROM checks WHERE brief_version_id=$1`, [brief.id]);
    for (const check of priorChecks.rows) {
      await client.query(
        `INSERT INTO checks (brief_version_id, check_key, result, reason, basis, checked_by, checked_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [newId, check.check_key, check.result, check.reason, JSON.stringify(check.basis), check.checked_by, check.checked_at],
      );
    }
    await audit(client, actor, "brief.returned", creativeId, { section });
    return remember(client, actor, creativeId);
  });
}

export async function revise(actor: Actor, creativeId: string): Promise<CreativeDto> {
  return withTx(async (client) => {
    const creative = await lockCreative(client, creativeId);
    const assignments = await loadAssignments(client, creativeId);
    assertRead(actor, creative, assignments);
    assertNotFixture(creative);
    assertStrategist(actor, assignments);
    const current = await client.query(`SELECT * FROM brief_versions WHERE creative_id=$1 ORDER BY version_number DESC LIMIT 1 FOR UPDATE`, [creativeId]);
    const brief = current.rows[0] as { id: string; state: string; version_number: number; snapshot: Snapshot; analysis_version_id: string | null };
    if (!brief) throw new ServiceError(422, "There is no version to revise.");
    if (brief.state === "draft") throw new ServiceError(422, "A working draft is already open.");
    const snapshot = clone(brief.snapshot);
    const newId = randomUUID();
    await client.query(
      `INSERT INTO brief_versions (id, creative_id, version_number, state, analysis_version_id, snapshot, content_hash, parent_version_id, created_by)
       VALUES ($1,$2,$3,'draft',$4,$5::jsonb,$6,$7,$8)`,
      [newId, creativeId, brief.version_number + 1, brief.analysis_version_id, JSON.stringify(snapshot), contentHash(snapshot), brief.id, actor.id],
    );
    const checks = await client.query(`SELECT * FROM checks WHERE brief_version_id=$1`, [brief.id]);
    for (const check of checks.rows) {
      await client.query(
        `INSERT INTO checks (brief_version_id, check_key, result, reason, basis, checked_by, checked_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [newId, check.check_key, check.result, check.reason, JSON.stringify(check.basis), check.checked_by, check.checked_at],
      );
    }
    await audit(client, actor, "brief.revised", creativeId, { from: brief.version_number });
    return remember(client, actor, creativeId);
  });
}

export async function offerHandoff(actor: Actor, creativeId: string, destination: string, externalLink: string, key: string): Promise<CreativeDto> {
  if (!destination.trim()) throw new ServiceError(422, "Record the handoff destination. The in-app record is enough.");
  return withTx(async (client) => {
    const id = await idempotent(client, actor, key, sha256({ action: "offer", creativeId, destination, externalLink }), async () => {
      const creative = await lockCreative(client, creativeId);
      const assignments = await loadAssignments(client, creativeId);
      assertRead(actor, creative, assignments);
      assertNotFixture(creative);
      assertStrategist(actor, assignments);
      const editor = assigned(assignments, "editor");
      if (!editor) throw new ServiceError(422, "Assign an editor before offering the handoff.");
      const current = await client.query(`SELECT * FROM brief_versions WHERE creative_id=$1 ORDER BY version_number DESC LIMIT 1`, [creativeId]);
      const brief = current.rows[0] as { id: string; state: string };
      if (brief?.state !== "approved") throw new ServiceError(422, "Offer the approved final draft, not a working copy.");
      const existing = await client.query(`SELECT id FROM handoffs WHERE brief_version_id=$1`, [brief.id]);
      if (existing.rowCount) throw new ServiceError(422, "A handoff is already recorded for this final draft.");
      await client.query(
        `INSERT INTO handoffs (id, brief_version_id, offered_by, destination, external_link, recipient_id, disclaimer)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), brief.id, actor.id, destination.trim(), externalLink.trim(), editor.account_id, HANDOFF_DISCLAIMER],
      );
      await audit(client, actor, "handoff.offered", creativeId);
      return creativeId;
    });
    return remember(client, actor, id);
  });
}

export async function acceptHandoff(actor: Actor, creativeId: string, key: string): Promise<CreativeDto> {
  return withTx(async (client) => {
    const id = await idempotent(client, actor, key, sha256({ action: "accept", creativeId }), async () => {
      const creative = await lockCreative(client, creativeId);
      const assignments = await loadAssignments(client, creativeId);
      assertRead(actor, creative, assignments);
      assertNotFixture(creative);
      if (assigned(assignments, "editor")?.account_id !== actor.id) throw new ServiceError(403, "The assigned editor accepts the handoff.");
      const current = await client.query(`SELECT id, state FROM brief_versions WHERE creative_id=$1 ORDER BY version_number DESC LIMIT 1`, [creativeId]);
      const brief = current.rows[0] as { id: string; state: string };
      if (brief?.state !== "approved") throw new ServiceError(422, "Accept the final draft only.");
      const handoff = await client.query(`SELECT * FROM handoffs WHERE brief_version_id=$1 FOR UPDATE`, [brief.id]);
      if (!handoff.rowCount || handoff.rows[0].acceptance !== "pending") throw new ServiceError(422, "There is no handoff waiting for acceptance.");
      await client.query(
        `UPDATE handoffs SET acceptance='accepted', decided_at=now(), recipient_id=$2, disclaimer=$3 WHERE id=$1`,
        [handoff.rows[0].id, actor.id, HANDOFF_DISCLAIMER],
      );
      await audit(client, actor, "handoff.accepted", creativeId);
      return creativeId;
    });
    return remember(client, actor, id);
  });
}

export async function returnGaps(actor: Actor, creativeId: string, gaps: string): Promise<CreativeDto> {
  if (!gaps.trim()) throw new ServiceError(422, "List the gaps.");
  return withTx(async (client) => {
    const creative = await lockCreative(client, creativeId);
    const assignments = await loadAssignments(client, creativeId);
    assertRead(actor, creative, assignments);
    assertNotFixture(creative);
    if (assigned(assignments, "editor")?.account_id !== actor.id) throw new ServiceError(403, "The assigned editor returns gaps.");
    const current = await client.query(`SELECT id, state, version_number FROM brief_versions WHERE creative_id=$1 ORDER BY version_number DESC LIMIT 1`, [creativeId]);
    const brief = current.rows[0] as { id: string; state: string; version_number: number };
    if (brief?.state !== "approved") throw new ServiceError(422, "Return gaps against the final draft.");
    const handoff = await client.query(`SELECT * FROM handoffs WHERE brief_version_id=$1 FOR UPDATE`, [brief.id]);
    if (!handoff.rowCount || handoff.rows[0].acceptance !== "pending") throw new ServiceError(422, "There is no open handoff.");
    await client.query(`UPDATE handoffs SET acceptance='gaps', gaps=$2, decided_at=now() WHERE id=$1`, [handoff.rows[0].id, gaps.trim()]);
    await client.query(
      `INSERT INTO feedback (id, brief_version_id, section_key, body, author_id) VALUES ($1,$2,'handoff',$3,$4)`,
      [randomUUID(), brief.id, gaps.trim(), actor.id],
    );
    await audit(client, actor, "handoff.gaps", creativeId);
    return remember(client, actor, creativeId);
  });
}

export async function parkCreative(actor: Actor, creativeId: string, parked: boolean): Promise<CreativeDto> {
  return withTx(async (client) => {
    const creative = await lockCreative(client, creativeId);
    const assignments = await loadAssignments(client, creativeId);
    assertRead(actor, creative, assignments);
    if (creative.fixture_kind) throw new ServiceError(403, "Fixture state stays as seeded.");
    assertStrategist(actor, assignments);
    await client.query(`UPDATE creatives SET parked=$2 WHERE id=$1`, [creativeId, parked]);
    await audit(client, actor, parked ? "creative.parked" : "creative.unparked", creativeId);
    return remember(client, actor, creativeId);
  });
}
