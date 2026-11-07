import { Workspace } from "@/components/Workspace";
import { requireActor } from "@/server/current";
import { getCreative, ServiceError } from "@/server/service";

export const dynamic = "force-dynamic";

export default async function CreativePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string }>;
}) {
  const actor = await requireActor();
  const { id } = await params;
  const query = await searchParams;
  try {
    const creative = await getCreative(actor, id);
    return <Workspace initial={creative} initialSection={query.section ?? "intake"} />;
  } catch (error) {
    if (error instanceof ServiceError && (error.status === 403 || error.status === 404)) {
      return <p className="error" role="alert">{error.message}</p>;
    }
    throw error;
  }
}
