"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function NewIntake({ canCreate }: { canCreate: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  if (!canCreate) return <p className="muted">Your role does not open new intakes.</p>;
  return (
    <div>
      <button type="button" data-testid="new-intake" onClick={async () => {
        setError("");
        const response = await fetch("/api/creatives", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
        });
        const data = await response.json();
        if (!response.ok) {
          setError(data.error ?? "Could not open an intake.");
          return;
        }
        router.push(`/creatives/${data.creative.id}?section=intake`);
      }}>New intake</button>
      {error ? <p className="error" role="alert">{error}</p> : null}
    </div>
  );
}

export function ParkButton({ id, parked, canPark }: { id: string; parked: boolean; canPark: boolean }) {
  const router = useRouter();
  if (!canPark) return null;
  return (
    <button type="button" className="secondary" onClick={async () => {
      await fetch(`/api/creatives/${id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "park", parked: !parked }),
      });
      router.refresh();
    }}>{parked ? "Restore" : "Park"}</button>
  );
}

export function CreativeLink({ id, children }: { id: string; children: React.ReactNode }) {
  return <Link href={`/creatives/${id}`}>{children}</Link>;
}
