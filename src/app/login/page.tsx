"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const FIXTURES = [
  ["strategist@fixture.test", "Fixture Strategist", "Strategist"],
  ["copywriter@fixture.test", "Fixture Copy Writer", "Copy writer"],
  ["editor@fixture.test", "Fixture Editor", "Editor"],
  ["approver@fixture.test", "Bilal (fixture approver)", "Approver"],
  ["architect@fixture.test", "Fixture Architect", "Architect"],
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(FIXTURES[0][0]);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Sign-in failed.");
      return;
    }
    router.push("/pipeline");
    router.refresh();
  }

  return (
    <main id="main" className="shell">
      <h1>Creative pipeline</h1>
      <p className="muted">The final outcome is the final draft. This sign-in is for labelled fixture accounts only.</p>
      <form className="work" onSubmit={submit}>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </div>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button type="submit">Sign in</button>
      </form>
      <div className="actions" style={{ marginTop: "1rem" }}>
        {FIXTURES.map(([address, name, role]) => (
          <button key={address} type="button" className="secondary" onClick={() => setEmail(address)}>
            {name} · {role}
          </button>
        ))}
      </div>
      <p className="muted">These are labelled fixture accounts. They are not production accounts. The password is configured for this installation and is not stored in the app.</p>
    </main>
  );
}
