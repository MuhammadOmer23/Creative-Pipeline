"use client";

import Link from "next/link";
import { useState } from "react";
import { ROLE_LABEL } from "@/domain/constants";
import type { CreativeDto } from "@/domain/dto";

export function Review({ initial }: { initial: CreativeDto }) {
  const [dto, setDto] = useState(initial);
  const [words, setWords] = useState("");
  const [feedback, setFeedback] = useState("");
  const [section, setSection] = useState("strategy");
  const [destination, setDestination] = useState("In-app handoff record for this final draft");
  const [externalLink, setExternalLink] = useState("");
  const [gaps, setGaps] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [honesty, setHonesty] = useState("The honesty line is obeyed.");

  async function act(body: Record<string, unknown>) {
    setError("");
    const response = await fetch(`/api/creatives/${dto.id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "The action was refused.");
      return;
    }
    setDto(data.creative);
    setMessage("Saved");
  }

  return (
    <div data-launch-controls="none">
      <p><Link href={`/creatives/${dto.id}`}>Back to the brief</Link></p>
      <header>
        <p className="kicker">{dto.code ?? "Not selected"}</p>
        <h2 data-testid="final-draft">{dto.finalDraftLabel}</h2>
        <p>{dto.approvalLabel}. Handoff: {dto.handoffLabel}.</p>
        <p><strong>Next:</strong> {dto.nextAction}</p>
      </header>
      {dto.banner ? <p className="banner">{dto.banner}</p> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p className="ok" role="status">{message}</p> : null}

      <section>
        <h3>Versions</h3>
        {dto.versions.length ? (
          <ul>
            {dto.versions.map((version) => (
              <li key={version.id}>v{version.number} · {version.state} · {version.hash.slice(0, 12)}{version.isFinalDraft ? " · final draft" : ""}</li>
            ))}
          </ul>
        ) : <p className="muted">No version yet. Select the creative into the pipeline first.</p>}
        {dto.changes.length ? (
          <div>
            <h3>What changed since the approved version</h3>
            <ul>{dto.changes.map((change) => <li key={`${change.section}-${change.label}`}>{change.label} in {change.section}: {change.before} became {change.after}</li>)}</ul>
          </div>
        ) : <p className="muted">No previous approved version to compare.</p>}
      </section>

      <section>
        <h3>Checklist</h3>
        {dto.checks.length ? dto.checks.map((check) => (
          <div key={check.key} className="check">
            <strong>{check.stale ? "Stale" : check.result === "pass" ? "Pass" : check.result === "fail" ? "Fail" : "N/A"}</strong>
            <div>
              <p>{check.title}</p>
              <p className="muted">{check.reason} Owner: {ROLE_LABEL[check.owner]}.</p>
            </div>
          </div>
        )) : <p className="muted">The checklist appears after the creative is selected.</p>}
        {dto.permissions.canAttest ? (
          <div className="actions">
            <button type="button" onClick={() => void act({ action: "attest", key: "c1-invented", statement: "I did not invent a testimonial, medical event, or endorsement." })}>Attest: nothing was invented as ours</button>
            <label className="field">Confirm the honesty line.
              <input aria-label="Honesty confirmation" value={honesty} onChange={(event) => setHonesty(event.target.value)} />
            </label>
            <button type="button" onClick={() => void act({ action: "attest", key: "c1-honesty", statement: honesty })}>Attest the honesty line</button>
          </div>
        ) : null}
      </section>

      <section>
        <h3>Approval</h3>
        <p className="muted">Approving this exact version makes it the final draft. It does not approve production, publishing, or spend.</p>
        {dto.permissions.canSubmit ? (
          <button type="button" data-testid="submit-approval" onClick={() => void act({ action: "submit", idempotencyKey: crypto.randomUUID() })}>Freeze this version and request approval</button>
        ) : null}
        {dto.permissions.canApprove ? (
          <div>
            <label className="field">Approver’s exact words
              <textarea data-testid="approve-words" value={words} onChange={(event) => setWords(event.target.value)} />
            </label>
            <button type="button" data-testid="approve" onClick={() => void act({ action: "approve", words, idempotencyKey: crypto.randomUUID() })}>Approve this exact version as the final draft</button>
          </div>
        ) : null}
        {dto.permissions.canApprove ? (
          <form onSubmit={(event) => { event.preventDefault(); void act({ action: "request_changes", section, body: feedback }); }}>
            <label className="field">Section
              <input aria-label="Feedback section" value={section} onChange={(event) => setSection(event.target.value)} />
            </label>
            <label className="field">What to change
              <textarea aria-label="Feedback" value={feedback} onChange={(event) => setFeedback(event.target.value)} />
            </label>
            <button type="submit" className="secondary">Request changes</button>
          </form>
        ) : null}
        {dto.permissions.canRevise ? <button type="button" className="secondary" onClick={() => void act({ action: "revise" })}>Revise the final draft</button> : null}
        {dto.feedback.map((item) => (
          <p key={item.id}>{item.section}: {item.body} · {item.authorName} · v{item.versionNumber}</p>
        ))}
      </section>

      <section>
        <h3>Handoff</h3>
        <p data-testid="disclaimer">{dto.handoff?.disclaimer ?? "Recipient acceptance does not authorize production, publishing, or ad spend."}</p>
        {dto.permissions.canOfferHandoff ? (
          <form onSubmit={(event) => { event.preventDefault(); void act({ action: "offer_handoff", destination, externalLink, idempotencyKey: crypto.randomUUID() }); }}>
            <label className="field">Destination
              <input aria-label="Destination" value={destination} onChange={(event) => setDestination(event.target.value)} />
            </label>
            <label className="field">External link
              <input aria-label="External link" value={externalLink} onChange={(event) => setExternalLink(event.target.value)} />
            </label>
            <button type="submit">Hand this final draft to the editor</button>
          </form>
        ) : null}
        {dto.permissions.canRespondHandoff ? (
          <div>
            <label className="field">Gaps
              <textarea aria-label="Gaps" value={gaps} onChange={(event) => setGaps(event.target.value)} />
            </label>
            <div className="actions">
              <button type="button" data-testid="accept-handoff" onClick={() => void act({ action: "accept_handoff", idempotencyKey: crypto.randomUUID() })}>Accept the final draft</button>
              <button type="button" className="secondary" onClick={() => void act({ action: "return_gaps", gaps })}>Return with gaps</button>
            </div>
          </div>
        ) : null}
      </section>

      <section>
        <h3>History</h3>
        <ul>{dto.history.map((item) => <li key={item.id}>{item.at} · {item.actorName} · {item.sentence}</li>)}</ul>
      </section>
    </div>
  );
}
