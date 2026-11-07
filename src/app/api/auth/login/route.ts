import { cookies } from "next/headers";
import { authenticate, createSession } from "@/server/session";

export async function POST(request: Request) {
  const body = (await request.json()) as { email?: string; password?: string };
  const actor = await authenticate(body.email ?? "", body.password ?? "");
  if (!actor) {
    return Response.json({ error: "Those credentials were not recognized." }, { status: 401 });
  }
  const token = await createSession(actor.id);
  const jar = await cookies();
  jar.set("cp_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return Response.json({ ok: true, name: actor.name });
}
