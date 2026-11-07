import { cookies } from "next/headers";
import { destroySession } from "@/server/session";

export async function POST() {
  const jar = await cookies();
  const token = jar.get("cp_session")?.value;
  if (token) await destroySession(token);
  jar.delete("cp_session");
  return Response.json({ ok: true });
}
