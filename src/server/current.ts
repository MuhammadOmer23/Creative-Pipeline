import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { actorFromToken } from "./session";
import { ServiceError, type Actor } from "./service";

export async function currentActor(): Promise<Actor | null> {
  const jar = await cookies();
  const token = jar.get("cp_session")?.value;
  if (!token) return null;
  return actorFromToken(token);
}

export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function requireActorApi(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) throw new ServiceError(401, "Sign in required.");
  return actor;
}
