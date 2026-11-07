import { ROLE_LABEL } from "@/domain/constants";
import { Shell } from "@/components/Shell";
import { requireActor } from "@/server/current";

export const dynamic = "force-dynamic";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  return (
    <Shell name={actor.name} role={actor.roles.map((role) => ROLE_LABEL[role]).join(", ")}>
      {children}
    </Shell>
  );
}
