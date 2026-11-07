import Link from "next/link";
import { NewIntake } from "@/components/Pipeline";
import { requireActor } from "@/server/current";
import { listPipeline } from "@/server/service";

export const dynamic = "force-dynamic";

type Query = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export default async function PipelinePage({ searchParams }: { searchParams: Promise<Query> }) {
  const actor = await requireActor();
  const query = await searchParams;
  const q = one(query.q).trim().toLowerCase();
  const stage = one(query.stage);
  const blocked = one(query.blocked);
  const format = one(query.format).trim().toLowerCase();
  const mine = one(query.mine) === "yes";
  const cards = (await listPipeline(actor)).filter((card) => {
    if (mine && !card.assignments.some((item) => item.accountId === actor.id)) return false;
    if (stage && card.stageLabel !== stage) return false;
    if (blocked === "yes" && card.blockers.length === 0) return false;
    if (blocked === "no" && card.blockers.length > 0) return false;
    const formatText = `${card.intake.medium} ${card.intake.executionStyle}`.toLowerCase();
    if (format && !formatText.includes(format)) return false;
    const haystack = `${card.intake.idea} ${card.code ?? ""} ${card.intake.hypothesis}`.toLowerCase();
    if (q && !haystack.includes(q)) return false;
    return true;
  });

  return (
    <div>
      <div className="top">
        <div>
          <h2>Pipeline</h2>
          <p className="muted">Work in progress, the next action, and who owns it. The final outcome is the final draft.</p>
        </div>
        <NewIntake canCreate={actor.roles.includes("strategist")} />
      </div>
      <form className="filters" method="get" aria-label="Filter creatives">
        <label><span>Search</span><input name="q" defaultValue={one(query.q)} aria-label="Search" /></label>
        <label>
          <span>Stage</span>
          <select name="stage" aria-label="Stage" defaultValue={stage}>
            <option value="">Any stage</option>
            {["Intake", "Reference", "Breakdown", "Strategy", "Copy", "Assets", "Review", "Final draft", "Parked"].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>
          <span>Blocked</span>
          <select name="blocked" aria-label="Blocked" defaultValue={blocked}>
            <option value="">Any</option>
            <option value="yes">Blocked</option>
            <option value="no">Clear</option>
          </select>
        </label>
        <label><span>Format</span><input name="format" aria-label="Format" defaultValue={one(query.format)} placeholder="Native, Video" /></label>
        <label>
          <span>Assignment</span>
          <select name="mine" aria-label="Assignment" defaultValue={mine ? "yes" : ""}>
            <option value="">Visible to me</option>
            <option value="yes">Assigned to me</option>
          </select>
        </label>
        <button type="submit" className="secondary">Filter</button>
      </form>
      <div className="cards">
        {cards.map((card) => (
          <article key={card.id} className="card" data-testid="creative-card">
            <div>
              {card.banner ? <p className="banner">{card.banner}</p> : null}
              <p className="kicker">{card.code ?? "No pipeline ID"}</p>
              <h3><Link href={`/creatives/${card.id}`}>{card.intake.idea || "Untitled intake"}</Link></h3>
            </div>
            <p className="meta"><span>Stage</span>{card.stageLabel}</p>
            <p className="meta"><span>Next action</span>{card.nextAction} Owner: {card.owner}.</p>
            <p className="meta"><span>Blocker</span>{card.blockers[0] ? `${card.blockers[0].reason} Owner: ${card.blockers[0].owner}.` : "None."}</p>
            <p className="meta"><span>Final draft</span>{card.finalDraftLabel}. {card.handoffLabel}.</p>
          </article>
        ))}
      </div>
      {cards.length === 0 ? <p className="muted" role="status">No creatives match this filter.</p> : null}
    </div>
  );
}
