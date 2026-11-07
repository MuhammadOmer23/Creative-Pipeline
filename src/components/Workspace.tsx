"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CreativeDto } from "@/domain/dto";
import { REQUIREMENT_TEXT } from "@/domain/labels";
import type { Finding } from "@/domain/snapshot";

const SECTIONS = [
  ["intake", "Intake"],
  ["reference", "Reference"],
  ["breakdown", "Breakdown"],
  ["strategy", "Strategy"],
  ["offer", "Offer and claims"],
  ["copy", "Copy and format"],
  ["assets", "Assets"],
] as const;

type Send = (body: Record<string, unknown>, backupKey?: string, backup?: unknown) => Promise<CreativeDto | null>;

export function Workspace({ initial, initialSection }: { initial: CreativeDto; initialSection: string }) {
  const [dto, setDto] = useState(initial);
  const [section, setSection] = useState(SECTIONS.some(([key]) => key === initialSection) ? initialSection : "intake");
  const [status, setStatus] = useState("No unsaved changes");
  const [tone, setTone] = useState<"ok" | "error">("ok");
  const [conflict, setConflict] = useState("");
  const [recovery, setRecovery] = useState<CreativeDto["intake"] | null>(null);

  useEffect(() => {
    const raw = localStorage.getItem(`cp-intake-${initial.id}`);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as CreativeDto["intake"];
      if (JSON.stringify(saved) !== JSON.stringify(initial.intake)) setRecovery(saved);
    } catch {
      localStorage.removeItem(`cp-intake-${initial.id}`);
    }
  }, [initial]);

  async function send(body: Record<string, unknown>, backupKey?: string, backup?: unknown) {
    if (backupKey) localStorage.setItem(backupKey, JSON.stringify(backup));
    setTone("ok");
    setStatus("Saving");
    setConflict("");
    try {
      const response = await fetch(`/api/creatives/${dto.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (response.status === 409 && data.conflict) {
        setTone("error");
        setStatus("Someone else saved this section. Your copy was not overwritten.");
        setConflict(String(data.section ?? "this section"));
        return null;
      }
      if (!response.ok) {
        setTone("error");
        setStatus(data.error ?? "Could not save.");
        return null;
      }
      if (backupKey) localStorage.removeItem(backupKey);
      setDto(data.creative);
      setStatus("Saved");
      setTone("ok");
      return data.creative as CreativeDto;
    } catch {
      setTone("error");
      setStatus("Could not save. A copy is kept on this device.");
      return null;
    }
  }

  return (
    <div>
      <header className="top">
        <div>
          <p className="kicker">{dto.code ?? "Not selected"} · {dto.stageLabel}</p>
          <h2>{dto.intake.idea || "Untitled intake"}</h2>
          <p>{dto.finalDraftLabel}. {dto.approvalLabel}. Handoff: {dto.handoffLabel}.</p>
          <p><strong>Next:</strong> {dto.nextAction} <span className="muted">Owner: {dto.owner}</span></p>
        </div>
        <Link className="button secondary" href={`/creatives/${dto.id}/review`}>Review and handoff</Link>
      </header>
      {dto.banner ? <p className="banner" role="status">{dto.banner}</p> : null}
      {dto.blockers[0] ? <p className="note">Blocker: {dto.blockers[0].reason} Owner: {dto.blockers[0].owner}. Blocks: {dto.blockers[0].blocks}.</p> : null}
      {dto.notes.map((note) => <p key={note} className="note">{note}</p>)}
      <p className={tone === "error" ? "error" : status === "Saved" ? "ok" : "quiet"} role={tone === "error" ? "alert" : "status"} aria-live={tone === "error" ? "assertive" : "polite"} data-testid="save-status">{status}</p>
      {conflict ? (
        <div className="error" data-testid="conflict">
          <p>Someone else saved {conflict}.</p>
          <button type="button" onClick={() => window.location.reload()}>Load their version</button>
        </div>
      ) : null}
      {recovery ? (
        <div className="note" data-testid="recovery">
          <p>This device has intake text from a save that did not finish.</p>
          <button type="button" onClick={() => {
            const next = recovery;
            setRecovery(null);
            void send({ action: "save_intake", baseRevision: dto.intakeRevision, intake: next }, `cp-intake-${dto.id}`, next);
          }}>Restore it</button>
        </div>
      ) : null}
      <div className="layout with-side">
        <div className="side">
          {!dto.code ? <p id="sections-locked" className="muted">The other sections open after this creative is selected into the pipeline.</p> : null}
          <nav className="steps" aria-label="Brief sections">
          {SECTIONS.map(([key, label]) => {
            const lockedSection = key !== "intake" && !dto.code;
            return (
              <button key={key} type="button" aria-current={section === key ? "true" : undefined} disabled={lockedSection} aria-describedby={lockedSection ? "sections-locked" : undefined} onClick={() => setSection(key)}>
                {label}
              </button>
            );
          })}
        </nav>
        </div>
        <div className="work">
          {section === "intake" ? <Intake dto={dto} send={send} /> : null}
          {section === "reference" ? <Reference dto={dto} send={send} /> : null}
          {section === "breakdown" ? <Breakdown dto={dto} send={send} /> : null}
          {section === "strategy" ? <StrategyForm dto={dto} send={send} /> : null}
          {section === "offer" ? <OfferForm dto={dto} send={send} /> : null}
          {section === "copy" ? <CopyForm dto={dto} send={send} /> : null}
          {section === "assets" ? <Assets dto={dto} send={send} /> : null}
        </div>
      </div>
    </div>
  );
}

function useDraftSaver<T>(serverValue: T, revision: number, persist: (value: T, revision: number) => Promise<number | null>) {
  const draft = useRef(serverValue);
  const revisionRef = useRef(revision);
  const [local, setLocal] = useState(serverValue);
  const dirty = useRef(false);
  const sending = useRef(false);
  const epoch = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<number | null> | null>(null);

  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  useEffect(() => {
    if (!dirty.current && !sending.current) {
      draft.current = serverValue;
      setLocal(serverValue);
    }
  }, [serverValue]);

  async function flush(): Promise<number | null> {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current) await inflight.current;
    if (!dirty.current) return revisionRef.current;
    const seen = epoch.current;
    const payload = draft.current;
    sending.current = true;
    const run = persist(payload, revisionRef.current).finally(() => {
      sending.current = false;
    });
    inflight.current = run;
    const nextRevision = await run;
    inflight.current = null;
    if (nextRevision != null) revisionRef.current = nextRevision;
    if (nextRevision != null && seen === epoch.current) dirty.current = false;
    if (dirty.current && nextRevision != null) return flush();
    return nextRevision == null ? null : revisionRef.current;
  }

  function update(next: T) {
    draft.current = next;
    dirty.current = true;
    epoch.current += 1;
    setLocal(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 300);
  }

  function merge(partial: Partial<T>) {
    update({ ...(draft.current as object), ...partial } as T);
  }

  return { local, update, merge, flush };
}

function Intake({ dto, send }: { dto: CreativeDto; send: Send }) {
  const saver = useDraftSaver(dto.intake, dto.intakeRevision, async (intake, revision) => {
    const next = await send({ action: "save_intake", baseRevision: revision, intake }, `cp-intake-${dto.id}`, intake);
    return next ? next.intakeRevision : null;
  });
  const locked = !dto.permissions.canEditIntake;
  return (
    <form onSubmit={(event) => { event.preventDefault(); void saver.flush(); }}>
      <h3>Intake</h3>
      <p className="muted">Five fields open a creative. Format can wait until you know it. A sheet link is only a pointer. This app does not write to the sheet.</p>
      <Field label="Idea" required><input id="idea" data-testid="idea" value={saver.local.idea} disabled={locked} onChange={(event) => saver.merge({ idea: event.target.value })} /></Field>
      <Field label="Source type" required>
        <select aria-label="Source type" value={saver.local.sourceType} disabled={locked} onChange={(event) => saver.merge({ sourceType: event.target.value })}>
          <option value="">Choose</option>
          <option>Organic</option>
          <option>Swipe</option>
        </select>
      </Field>
      <Field label="Spotted by" required><input aria-label="Spotted by" value={saver.local.spottedBy} disabled={locked} onChange={(event) => saver.merge({ spottedBy: event.target.value })} /></Field>
      <Field label="Date" required><input aria-label="Date" type="date" value={saver.local.spottedOn} disabled={locked} onChange={(event) => saver.merge({ spottedOn: event.target.value })} /></Field>
      <Field label="One-line hypothesis" required><textarea aria-label="One-line hypothesis" value={saver.local.hypothesis} disabled={locked} onChange={(event) => saver.merge({ hypothesis: event.target.value })} /></Field>
      <Field label="Parent ID"><input aria-label="Parent ID" value={saver.local.parentCode} disabled={locked} onChange={(event) => saver.merge({ parentCode: event.target.value })} /></Field>
      <Field label="Sheet link"><input aria-label="Sheet link" value={saver.local.sheetLink} disabled={locked} onChange={(event) => saver.merge({ sheetLink: event.target.value })} /></Field>
      <h3>Format</h3>
      <Field label="Medium">
        <select aria-label="Medium" value={saver.local.medium} disabled={locked} onChange={(event) => saver.merge({ medium: event.target.value })}>
          <option value="">Choose later</option>
          <option>Video</option>
          <option>Still image</option>
          <option>Other</option>
        </select>
      </Field>
      <Field label="Execution style">
        <select aria-label="Execution style" value={saver.local.executionStyle} disabled={locked} onChange={(event) => saver.merge({ executionStyle: event.target.value })}>
          <option value="">Choose later</option>
          <option>Native avatar-story</option>
          <option>UGC</option>
          <option>Animation</option>
          <option>Listicle</option>
          <option>Other</option>
        </select>
      </Field>
      {locked ? null : <button type="submit">Save intake</button>}
      <Assignments dto={dto} send={send} />
      {dto.permissions.canSelect ? (
        <button type="button" data-testid="select-pipeline" onClick={() => void saver.flush().then((revision) => {
          if (revision == null) return;
          return send({ action: "select", idempotencyKey: stableKey(`select-${dto.id}`) });
        })}>
          Select into the pipeline
        </button>
      ) : <p className="muted">{dto.code ? `Pipeline ID ${dto.code}` : "Selection stays closed until the five intake fields are saved."}</p>}
    </form>
  );
}

function Assignments({ dto, send }: { dto: CreativeDto; send: Send }) {
  const roles = ["strategist", "copy_writer", "editor"] as const;
  const labels = { strategist: "Strategist", copy_writer: "Copy writer", editor: "Editor" };
  return (
    <div>
      <h3>Assignments</h3>
      {roles.map((role) => {
        const current = dto.assignments.find((item) => item.role === role);
        const options = dto.directory.filter((person) => person.roles.includes(role));
        const listed = current && !options.some((person) => person.id === current.accountId)
          ? [{ id: current.accountId, name: current.name }, ...options]
          : options;
        return (
          <Field key={role} label={labels[role]}>
            <select aria-label={labels[role]} value={current?.accountId ?? ""} disabled={!dto.permissions.canAssign} onChange={(event) => {
              if (event.target.value) void send({ action: "assign", role, accountId: event.target.value });
            }}>
              <option value="">Choose</option>
              {listed.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </Field>
        );
      })}
      <p className="muted">Approver is a role, not a field on the brief. The fixture approver is Bilal.</p>
    </div>
  );
}

function Reference({ dto, send }: { dto: CreativeDto; send: Send }) {
  const saver = useDraftSaver(dto.reference, dto.revisions.reference ?? 1, async (reference, revision) => {
    const next = await send({
      action: "save_reference",
      baseRevision: revision,
      reference: { url: reference.url, title: reference.title, note: reference.note },
    });
    return next ? (next.revisions.reference ?? revision + 1) : null;
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); void saver.flush(); }}>
      <h3>Reference</h3>
      <Field label="Reference link" required>
        <input aria-label="Reference link" value={saver.local.url} disabled={!dto.permissions.canEditReference} onChange={(event) => saver.merge({ url: event.target.value })} />
      </Field>
      <Field label="Title">
        <input aria-label="Reference title" value={saver.local.title} disabled={!dto.permissions.canEditReference} onChange={(event) => saver.merge({ title: event.target.value })} />
      </Field>
      <p>{saver.local.reviewedAt ? `Reviewed by ${saver.local.reviewedByName} at ${saver.local.reviewedAt}.` : "Not reviewed yet."}</p>
      {dto.permissions.canEditReference ? <button type="submit">Save reference</button> : null}
      {dto.permissions.canReviewReference ? <button type="button" data-testid="review-reference" onClick={() => void saver.flush().then((revision) => {
        if (revision == null) return;
        return send({ action: "review_reference" });
      })}>Mark reviewed</button> : null}
    </form>
  );
}

function Breakdown({ dto, send }: { dto: CreativeDto; send: Send }) {
  const [index, setIndex] = useState(0);
  const finding = dto.findings[index];
  if (!finding) return <p>Select the creative into the pipeline before the breakdown.</p>;
  return (
    <div>
      <h3>Breakdown</h3>
      <p className="muted">Eighteen labels from the approved brief. A score or a link on its own is not a finding. {dto.analysis ? `Scorecard v${dto.analysis.versionNumber}, ${dto.analysis.state}, dated ${dto.analysis.authoredAt}.` : ""}</p>
      <div className="finding-list">
        {dto.findings.map((item, itemIndex) => (
          <button key={item.id} type="button" aria-current={itemIndex === index ? "true" : undefined} onClick={() => setIndex(itemIndex)}>
            {item.sortOrder}. {item.label}
          </button>
        ))}
      </div>
      <FindingEditor key={finding.id} dto={dto} finding={finding} send={send} />
      {dto.permissions.canMarkReady ? <button type="button" data-testid="mark-ready" onClick={() => void send({ action: "mark_ready" })}>Mark breakdown ready</button> : null}
    </div>
  );
}

function FindingEditor({ dto, finding, send }: { dto: CreativeDto; finding: Finding; send: Send }) {
  const saver = useDraftSaver(finding, finding.revision, async (draft, revision) => {
    const patch: Partial<Pick<Finding, "referenceObserved" | "inference" | "adaptation" | "naReason">> = {};
    if (dto.permissions.canEditFindings) {
      patch.referenceObserved = draft.referenceObserved;
      patch.inference = draft.inference;
      patch.naReason = draft.naReason;
    }
    if (dto.permissions.canEditAdaptation) patch.adaptation = draft.adaptation;
    const next = await send({ action: "save_finding", findingId: draft.id, baseRevision: revision, patch });
    return next?.findings.find((item) => item.id === draft.id)?.revision ?? null;
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); void saver.flush(); }}>
      <p>{REQUIREMENT_TEXT[finding.requirement]}</p>
      <Field label="Reference (observed + evidence)">
        <textarea aria-label="Reference observed" value={saver.local.referenceObserved} disabled={!dto.permissions.canEditFindings} onChange={(event) => saver.merge({ referenceObserved: event.target.value })} />
      </Field>
      <Field label="Inference (marked)">
        <textarea aria-label="Inference" value={saver.local.inference} disabled={!dto.permissions.canEditFindings} onChange={(event) => saver.merge({ inference: event.target.value })} />
      </Field>
      <Field label="Our adaptation">
        <textarea aria-label="Our adaptation" value={saver.local.adaptation} disabled={!dto.permissions.canEditAdaptation} onChange={(event) => saver.merge({ adaptation: event.target.value })} />
      </Field>
      <Field label="N/A reason">
        <input aria-label="N/A reason" value={saver.local.naReason} disabled={!dto.permissions.canEditFindings} onChange={(event) => saver.merge({ naReason: event.target.value })} />
      </Field>
      {dto.permissions.canEditFindings || dto.permissions.canEditAdaptation ? <button type="submit" data-testid="save-finding">Save this finding</button> : null}
      <div className="evidence">
        <h4>Evidence for this label</h4>
        {finding.evidence.map((item) => <p key={item.id}>{item.location} {item.quote}</p>)}
        {dto.permissions.canEditFindings ? <EvidenceForm findingId={finding.id} revision={finding.revision} send={send} flush={saver.flush} /> : <p className="muted">The copy writer adds evidence.</p>}
      </div>
    </form>
  );
}

function EvidenceForm({ findingId, revision, send, flush }: { findingId: string; revision: number; send: Send; flush: () => Promise<number | null> }) {
  const [location, setLocation] = useState("");
  const [quote, setQuote] = useState("");
  return (
    <div>
      <Field label="Evidence location"><input aria-label="Evidence location" value={location} onChange={(event) => setLocation(event.target.value)} /></Field>
      <Field label="Evidence quote"><input aria-label="Evidence quote" value={quote} onChange={(event) => setQuote(event.target.value)} /></Field>
      <button type="button" onClick={() => {
        void flush().then((savedRevision) => {
          if (savedRevision == null) return null;
          return send({
            action: "add_evidence",
            findingId,
            location,
            quote,
            baseRevision: savedRevision,
          });
        }).then((next) => {
          if (next) { setLocation(""); setQuote(""); }
        });
      }}>Add evidence</button>
    </div>
  );
}

function StrategyForm({ dto, send }: { dto: CreativeDto; send: Send }) {
  return (
    <SectionSave title="Strategy" section="strategy" dto={dto} value={dto.strategy} disabled={!dto.permissions.canEditStrategy} send={send} fields={[
      ["concept", "Concept", true],
      ["buyer", "Buyer / situation", true],
      ["awareness", "Awareness and sophistication", false],
      ["emotionalArc", "Emotional arc", false],
      ["messenger", "Messenger / authority", false],
      ["stakes", "Stakes", false],
      ["intendedAction", "Intended action", false],
      ["hypothesis", "Test hypothesis", true],
      ["whyFormat", "Why this format", true],
      ["variables", "Core and secondary variable", true],
      ["controls", "Controls", true],
      ["breakEven", "Break-even CPA", false],
      ["spendCap", "Spend / discovery cap", false],
      ["killPromote", "Kill rule / promote rule", false],
      ["nextTest", "Next test if it wins", false],
    ]} />
  );
}

function OfferForm({ dto, send }: { dto: CreativeDto; send: Send }) {
  const [mechanism, setMechanism] = useState(dto.mechanism);
  const [beats, setBeats] = useState(dto.beats);
  return (
    <div>
      <SectionSave title="Offer and destination" section="offer" dto={dto} value={dto.offer} disabled={!dto.permissions.canEditOffer} send={send} fields={[
        ["landingUrl", "Landing page URL", true],
        ["landingSource", "Landing source and date verified", true],
        ["offerPrice", "Offer / price / bundle", true],
        ["offerSource", "Offer source and date", true],
        ["limits", "Offer limits / terms", true],
        ["limitsSource", "Limits source and date", true],
        ["cta", "CTA wording", true],
        ["ctaSource", "CTA source and date", false],
        ["productLanguage", "Required product language / locked product facts", true],
        ["productSource", "Product language source and date", false],
      ]} />
      <h3>Mechanism, proof and claims</h3>
      <p className="muted">Claims needing evidence + source. Do not invent proof.</p>
      <Field label="Mechanism"><textarea aria-label="Mechanism" value={mechanism.mechanism} disabled={!dto.permissions.canEditOffer} onChange={(event) => setMechanism({ ...mechanism, mechanism: event.target.value })} /></Field>
      <Field label="Mechanism honesty line"><textarea aria-label="Mechanism honesty line" value={mechanism.honestyLine} disabled={!dto.permissions.canEditOffer} onChange={(event) => setMechanism({ ...mechanism, honestyLine: event.target.value })} /></Field>
      <label><input type="checkbox" checked={mechanism.claimsNone} disabled={!dto.permissions.canEditOffer} onChange={(event) => setMechanism({ ...mechanism, claimsNone: event.target.checked })} /> No claims</label>
      <label><input type="checkbox" checked={mechanism.proofNone} disabled={!dto.permissions.canEditOffer} onChange={(event) => setMechanism({ ...mechanism, proofNone: event.target.checked })} /> No proof items</label>
      <label><input type="checkbox" checked={mechanism.realPeopleNone} disabled={!dto.permissions.canEditOffer} onChange={(event) => setMechanism({ ...mechanism, realPeopleNone: event.target.checked })} /> No real person</label>
      <button type="button" disabled={!dto.permissions.canEditOffer} onClick={() => void send({ action: "save_brief", section: "mechanism", baseRevision: dto.revisions.mechanism, value: mechanism })}>Save claims</button>
      <h3>Beat coverage</h3>
      {beats.map((beat, index) => (
        <div key={beat.id} className="columns two">
          <Field label="Reference beat"><input aria-label={`Reference beat ${index + 1}`} value={beat.referenceBeat} disabled={!dto.permissions.canEditOffer} onChange={(event) => setBeats(beats.map((item, itemIndex) => itemIndex === index ? { ...item, referenceBeat: event.target.value } : item))} /></Field>
          <Field label="Our beat"><input aria-label={`Our beat ${index + 1}`} value={beat.ourBeat} disabled={!dto.permissions.canEditOffer} onChange={(event) => setBeats(beats.map((item, itemIndex) => itemIndex === index ? { ...item, ourBeat: event.target.value } : item))} /></Field>
        </div>
      ))}
      <div className="actions">
        <button type="button" className="secondary" disabled={!dto.permissions.canEditOffer} onClick={() => setBeats([...beats, { id: crypto.randomUUID(), referenceBeat: "", ourBeat: "", carriedBy: "", departure: "" }])}>Add beat</button>
        <button type="button" disabled={!dto.permissions.canEditOffer} onClick={() => void send({ action: "save_brief", section: "beats", baseRevision: dto.revisions.beats, value: beats })}>Save beats</button>
      </div>
    </div>
  );
}

function CopyForm({ dto, send }: { dto: CreativeDto; send: Send }) {
  const [choice, setChoice] = useState({
    video: dto.modules.video.state === "active",
    static: dto.modules.static.state === "active",
    native: dto.modules.native.state === "active",
  });
  return (
    <div>
      <h3>Copy and format</h3>
      {!dto.permissions.canEditCopy ? <p className="note">Copy stays closed until the breakdown is marked ready, or until a revision is open.</p> : null}
      {dto.permissions.canEditModules ? (
        <div className="actions">
          <label><input type="checkbox" checked={choice.video} onChange={(event) => setChoice({ ...choice, video: event.target.checked })} /> Video module</label>
          <label><input type="checkbox" checked={choice.static} onChange={(event) => setChoice({ ...choice, static: event.target.checked })} /> Static module</label>
          <label><input type="checkbox" checked={choice.native} onChange={(event) => setChoice({ ...choice, native: event.target.checked })} /> Native module</label>
          <button type="button" onClick={() => void send({ action: "choose_modules", baseRevision: dto.revisions.modules, choice })}>Save module choice</button>
        </div>
      ) : null}
      <ModuleNote name="Video" state={dto.modules.video.state} reason={dto.modules.video.naReason} />
      <ModuleNote name="Static" state={dto.modules.static.state} reason={dto.modules.static.naReason} />
      <ModuleNote name="Native" state={dto.modules.native.state} reason={dto.modules.native.naReason} />
      {dto.modules.native.state === "active" ? (
        <SectionSave title="Native image and avatar story" section="native" dto={dto} value={dto.modules.native} disabled={!dto.permissions.canEditCopy} send={send} fields={[
          ["subject", "Subject and action", true],
          ["setting", "Setting", true],
          ["framing", "Framing", true],
          ["emotionalCue", "Emotional cue", true],
          ["whyAttention", "Why the image earns attention", true],
          ["copyMakesImageMean", "What the copy makes the image mean", true],
          ["overlay", "Embedded headline / labels / logo", true],
          ["overlayReason", "Exception reason", false],
          ["platformCta", "Platform CTA / ad labels", false],
          ["assetSource", "Asset source and permission", true],
          ["situation", "Avatar situation and perspective", true],
          ["narrativeVoice", "Narrative voice", true],
          ["opening", "Story opening", true],
          ["incident", "Incident / problem", true],
          ["beliefs", "Current beliefs and failed attempts", true],
          ["turningPoint", "Turning point", true],
          ["payoff", "Payoff", true],
          ["cta", "Transition / CTA", true],
          ["reality", "Real or illustrative", true],
          ["permission", "Permission", false],
        ]} />
      ) : null}
      {dto.modules.static.state === "active" ? (
        <SectionSave title="Static" section="static" dto={dto} value={dto.modules.static} disabled={!dto.permissions.canEditCopy} send={send} fields={[
          ["subject", "Subject and action", true],
          ["environment", "Environment / setting", false],
          ["emotionalCue", "Emotional cue", false],
          ["composition", "Composition and focal point", true],
          ["crop", "Crop / aspect ratio", true],
          ["placement", "Placement", true],
          ["textOnImage", "Text on image", true],
          ["textHierarchy", "Headline / sub / CTA hierarchy", false],
          ["primaryText", "Primary text", false],
          ["imageCopy", "How image and copy work together", true],
          ["readerPath", "Reader path", false],
          ["approvedClaims", "Approved claims used", false],
          ["assetSource", "Asset source", true],
          ["permission", "Permission", true],
          ["exportSpecs", "Export specs", false],
        ]} />
      ) : null}
      {dto.modules.video.state === "active" ? <VideoFields dto={dto} send={send} /> : null}
    </div>
  );
}

function VideoFields({ dto, send }: { dto: CreativeDto; send: Send }) {
  const [video, setVideo] = useState(dto.modules.video);
  const disabled = !dto.permissions.canEditCopy;
  return (
    <div>
      <h3>Video</h3>
      {video.leads.map((lead, index) => (
        <div key={lead.key} className="columns two">
          <Field label={`Lead ${lead.key} open`}><input aria-label={`Lead ${lead.key} open`} value={lead.open} disabled={disabled} onChange={(event) => setVideo({ ...video, leads: video.leads.map((item, itemIndex) => itemIndex === index ? { ...item, open: event.target.value } : item) })} /></Field>
          <Field label={`Lead ${lead.key} first frame`}><input aria-label={`Lead ${lead.key} first frame`} value={lead.firstFrame} disabled={disabled} onChange={(event) => setVideo({ ...video, leads: video.leads.map((item, itemIndex) => itemIndex === index ? { ...item, firstFrame: event.target.value } : item) })} /></Field>
        </div>
      ))}
      <Field label="Locked body and close"><textarea aria-label="Locked body and close" value={video.bodyClose} disabled={disabled} onChange={(event) => setVideo({ ...video, bodyClose: event.target.value })} /></Field>
      <Field label="Shared back half starts at beat"><input aria-label="Shared back half" value={video.sharedBackHalf} disabled={disabled} onChange={(event) => setVideo({ ...video, sharedBackHalf: event.target.value })} /></Field>
      <Field label="Full VO script"><textarea aria-label="VO script" value={video.voScript} disabled={disabled} onChange={(event) => setVideo({ ...video, voScript: event.target.value })} /></Field>
      <Field label="Caption plan"><textarea aria-label="Caption plan" value={video.captionPlan} disabled={disabled} onChange={(event) => setVideo({ ...video, captionPlan: event.target.value })} /></Field>
      <Field label="Source-pack N/A reason"><input aria-label="Source pack N/A reason" value={video.sourcePack.naReason} disabled={disabled} onChange={(event) => setVideo({ ...video, sourcePack: { ...video.sourcePack, naReason: event.target.value } })} /></Field>
      <Field label="Aspect ratio"><input aria-label="Aspect ratio" value={video.specs.aspect} disabled={disabled} onChange={(event) => setVideo({ ...video, specs: { ...video.specs, aspect: event.target.value } })} /></Field>
      <Field label="Resolution / frame rate"><input aria-label="Resolution" value={video.specs.resolution} disabled={disabled} onChange={(event) => setVideo({ ...video, specs: { ...video.specs, resolution: event.target.value } })} /></Field>
      <Field label="Target length"><input aria-label="Target length" value={video.specs.length} disabled={disabled} onChange={(event) => setVideo({ ...video, specs: { ...video.specs, length: event.target.value } })} /></Field>
      <Field label="Specs source and date"><input aria-label="Specs source" value={video.specs.source} disabled={disabled} onChange={(event) => setVideo({ ...video, specs: { ...video.specs, source: event.target.value } })} /></Field>
      <Field label="Voiceover"><input aria-label="Voiceover" value={video.audio.voice} disabled={disabled} onChange={(event) => setVideo({ ...video, audio: { ...video.audio, voice: event.target.value } })} /></Field>
      <Field label="Music / SFX"><input aria-label="Music" value={video.audio.music} disabled={disabled} onChange={(event) => setVideo({ ...video, audio: { ...video.audio, music: event.target.value } })} /></Field>
      <label><input type="checkbox" checked={video.dialIn.firstFrameMatches} disabled={disabled} onChange={(event) => setVideo({ ...video, dialIn: { ...video.dialIn, firstFrameMatches: event.target.checked } })} /> First frame matches the first line</label>
      {(["storyArc", "patternInterrupt", "mechanismVisual", "transition", "captionPlan", "hookVariants"] as const).map((key) => (
        <Field key={key} label={key}><input aria-label={key} value={video.dialIn[key]} disabled={disabled} onChange={(event) => setVideo({ ...video, dialIn: { ...video.dialIn, [key]: event.target.value } })} /></Field>
      ))}
      <button type="button" disabled={disabled} onClick={() => void send({ action: "save_brief", section: "video", baseRevision: dto.revisions.video, value: video })}>Save video module</button>
    </div>
  );
}

function Assets({ dto, send }: { dto: CreativeDto; send: Send }) {
  const [assets, setAssets] = useState(dto.assets);
  return (
    <div>
      <h3>Assets</h3>
      <p className="muted">The editor records status and permission. Linking an asset does not clear it for generation or spend.</p>
      {assets.map((asset, index) => (
        <div key={asset.id}>
          <Field label="Label"><input aria-label={`Asset label ${index + 1}`} value={asset.label} disabled={!dto.permissions.canEditAssets} onChange={(event) => setAssets(assets.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} /></Field>
          <Field label="Status">
            <select aria-label={`Asset status ${index + 1}`} value={asset.status} disabled={!dto.permissions.canEditAssets} onChange={(event) => setAssets(assets.map((item, itemIndex) => itemIndex === index ? { ...item, status: event.target.value as typeof asset.status } : item))}>
              <option value="">Choose</option>
              <option value="needed">Needed</option>
              <option value="linked">Linked</option>
              <option value="missing">Missing</option>
              <option value="permission_recorded">Permission recorded</option>
            </select>
          </Field>
          <Field label="Permission"><input aria-label={`Asset permission ${index + 1}`} value={asset.permission} disabled={!dto.permissions.canEditAssets} onChange={(event) => setAssets(assets.map((item, itemIndex) => itemIndex === index ? { ...item, permission: event.target.value } : item))} /></Field>
        </div>
      ))}
      <div className="actions">
        <button type="button" className="secondary" disabled={!dto.permissions.canEditAssets} onClick={() => setAssets([...assets, { id: crypto.randomUUID(), label: "", status: "", link: "", permission: "", mapsTo: "" }])}>Add asset</button>
        <button type="button" disabled={!dto.permissions.canEditAssets} onClick={() => void send({ action: "save_brief", section: "assets", baseRevision: dto.revisions.assets, value: assets })}>Save assets</button>
      </div>
    </div>
  );
}

function SectionSave<T extends Record<string, unknown>>({ title, section, dto, value, fields, disabled, send }: {
  title: string;
  section: string;
  dto: CreativeDto;
  value: T;
  fields: [keyof T & string, string, boolean][];
  disabled: boolean;
  send: Send;
}) {
  const saver = useDraftSaver(value, dto.revisions[section] ?? 1, async (draft, revision) => {
    const next = await send({ action: "save_brief", section, baseRevision: revision, value: draft });
    return next ? (next.revisions[section] ?? revision + 1) : null;
  });
  return (
    <form onSubmit={(event) => { event.preventDefault(); void saver.flush(); }}>
      <h3>{title}</h3>
      {fields.map(([key, label, required]) => (
        <Field key={key} label={label} required={required}>
          {choiceControl(key, label, String(saver.local[key] ?? ""), disabled, (next) => saver.merge({ [key]: next } as Partial<T>))
            ?? (String(saver.local[key] ?? "").length > 80 || /hypothesis|language|story|reason/i.test(key) ? (
              <textarea aria-label={label} value={String(saver.local[key] ?? "")} disabled={disabled} onChange={(event) => saver.merge({ [key]: event.target.value } as Partial<T>)} />
            ) : (
              <input aria-label={label} value={String(saver.local[key] ?? "")} disabled={disabled} onChange={(event) => saver.merge({ [key]: event.target.value } as Partial<T>)} />
            ))}
        </Field>
      ))}
      {disabled ? null : <button type="submit">Save {title}</button>}
    </form>
  );
}

function choiceControl(key: string, label: string, value: string, disabled: boolean, onChange: (value: string) => void) {
  const options = key === "overlay"
    ? [["", "Choose"], ["none", "None"], ["exception", "Exception"]]
    : key === "reality"
      ? [["", "Choose"], ["illustrative", "Illustrative"], ["real", "Real"]]
      : key === "textOnImage"
        ? [["", "Choose"], ["no", "No"], ["yes", "Yes"]]
        : null;
  if (!options) return null;
  return (
    <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}
    </select>
  );
}

function ModuleNote({ name, state, reason }: { name: string; state: string; reason: string }) {
  return <p>{name}: {state === "active" ? "In use" : reason || "N/A"}</p>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label} <span className="req">{required ? "Required" : "Optional"}</span></span>
      {children}
    </label>
  );
}

function stableKey(name: string) {
  const existing = sessionStorage.getItem(name);
  if (existing) return existing;
  const key = crypto.randomUUID();
  sessionStorage.setItem(name, key);
  return key;
}
