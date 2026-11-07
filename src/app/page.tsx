import { redirect } from "next/navigation";
import { currentActor } from "@/server/current";

export const dynamic = "force-dynamic";

export default async function Home() {
  const actor = await currentActor();
  redirect(actor ? "/pipeline" : "/login");
}
