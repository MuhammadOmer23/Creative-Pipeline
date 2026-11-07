import { randomUUID } from "crypto";
import { requireActorApi } from "@/server/current";
import { createCreative, ServiceError } from "@/server/service";

export async function POST(request: Request) {
  try {
    const actor = await requireActorApi();
    const body = (await request.json().catch(() => ({}))) as { idempotencyKey?: string };
    const creative = await createCreative(actor, body.idempotencyKey || randomUUID());
    return Response.json({ creative });
  } catch (error) {
    return jsonError(error);
  }
}

function jsonError(error: unknown) {
  if (error instanceof ServiceError) {
    return Response.json({ error: error.message, ...(error.details ?? {}) }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "The pipeline could not complete that action." }, { status: 500 });
}
