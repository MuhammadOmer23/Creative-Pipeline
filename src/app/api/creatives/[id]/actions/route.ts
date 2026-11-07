import { requireActorApi } from "@/server/current";
import {
  acceptHandoff,
  addEvidence,
  approveBrief,
  assignRole,
  attest,
  chooseModules,
  markAnalysisReady,
  offerHandoff,
  parkCreative,
  requestChanges,
  returnGaps,
  reviewReference,
  revise,
  saveBriefSection,
  submitBrief,
  saveFinding,
  saveIntake,
  saveReference,
  selectCreative,
  ServiceError,
} from "@/server/service";
import type { Role } from "@/domain/constants";

type Body = Record<string, unknown>;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActorApi();
    const { id } = await context.params;
    const body = (await request.json()) as Body;
    const action = String(body.action ?? "");
    const creative = await run(actor, id, action, body);
    return Response.json({ creative });
  } catch (error) {
    if (error instanceof ServiceError) {
      return Response.json({ error: error.message, ...(error.details ?? {}) }, { status: error.status });
    }
    console.error(error);
    return Response.json({ error: "The pipeline could not complete that action." }, { status: 500 });
  }
}

async function run(actor: Awaited<ReturnType<typeof requireActorApi>>, id: string, action: string, body: Body) {
  const revision = Number(body.baseRevision ?? 0);
  const key = String(body.idempotencyKey ?? "");
  switch (action) {
    case "save_intake":
      return saveIntake(actor, id, (body.intake ?? {}) as never, revision);
    case "assign":
      return assignRole(actor, id, body.role as Role, String(body.accountId ?? ""));
    case "select":
      return selectCreative(actor, id, key);
    case "save_reference":
      return saveReference(actor, id, (body.reference ?? {}) as never, revision);
    case "review_reference":
      return reviewReference(actor, id);
    case "save_finding":
      return saveFinding(actor, id, String(body.findingId ?? ""), (body.patch ?? {}) as never, revision);
    case "add_evidence":
      return addEvidence(actor, id, String(body.findingId ?? ""), String(body.location ?? ""), String(body.quote ?? ""), revision);
    case "mark_ready":
      return markAnalysisReady(actor, id);
    case "save_brief":
      return saveBriefSection(actor, id, String(body.section ?? ""), body.value, revision);
    case "choose_modules":
      return chooseModules(actor, id, body.choice as { video: boolean; static: boolean; native: boolean }, revision);
    case "attest":
      return attest(actor, id, body.key as "c1-invented" | "c1-honesty", String(body.statement ?? ""));
    case "submit":
      return submitBrief(actor, id, key);
    case "approve":
      return approveBrief(actor, id, String(body.words ?? ""), key);
    case "request_changes":
      return requestChanges(actor, id, String(body.section ?? "brief"), String(body.body ?? ""));
    case "revise":
      return revise(actor, id);
    case "offer_handoff":
      return offerHandoff(actor, id, String(body.destination ?? ""), String(body.externalLink ?? ""), key);
    case "accept_handoff":
      return acceptHandoff(actor, id, key);
    case "return_gaps":
      return returnGaps(actor, id, String(body.gaps ?? ""));
    case "park":
      return parkCreative(actor, id, Boolean(body.parked));
    default:
      throw new ServiceError(404, "Unknown action.");
  }
}
