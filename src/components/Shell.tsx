"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function Shell({ name, role, children }: { name: string; role: string; children: React.ReactNode }) {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="shell">
      <header className="top">
        <div>
          <p className="kicker">TriCore</p>
          <h1><Link href="/pipeline">Creative pipeline</Link></h1>
          <p className="muted">The final outcome is the final draft.</p>
        </div>
        <div className="actions">
          <p>{name} · {role}</p>
          <button type="button" className="secondary" onClick={logout}>Log out</button>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer>
        Approval of a blank template is not approval of a brief. Editor acceptance does not authorize production, publishing, or ad spend.
      </footer>
    </div>
  );
}
