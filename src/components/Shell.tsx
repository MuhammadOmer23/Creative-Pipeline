"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export function Shell({ name, role, children }: { name: string; role: string; children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }
  return (
    <div className="app">
      <aside className="rail">
        <p className="brand">TriCore</p>
        <h1 className="brand-name">Creative pipeline</h1>
        <nav aria-label="Workspace">
          <Link href="/pipeline" aria-current={path.startsWith("/pipeline") ? "page" : undefined}>Pipeline</Link>
        </nav>
        <p className="rail-note">The final outcome is the final draft.</p>
      </aside>
      <div className="frame">
        <header className="bar">
          <p className="who">{name} · {role}</p>
          <button type="button" className="secondary" onClick={logout}>Log out</button>
        </header>
        <main id="main">{children}</main>
        <footer>
          Approval of a blank template is not approval of a brief. Editor acceptance does not authorize production, publishing, or ad spend.
        </footer>
      </div>
    </div>
  );
}
