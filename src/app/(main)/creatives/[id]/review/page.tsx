import { Review } from "@/components/Review";
import { requireActor } from "@/server/current";
import { getCreative, ServiceError } from "@/server/service";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor();
  const { id } = await params;
  try {
    const creative = await getCreative(actor, id);
    return <Review initial={creative} />;
  } catch (error) {
    if (error instanceof ServiceError && (error.status === 403 || error.status === 404)) {
      return <p className="error" role="alert">{error.message}</p>;
    }
    throw error;
  }
}
