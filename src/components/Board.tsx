"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import type { CreativeDto } from "@/domain/dto";

const STAGES = ["Intake", "Reference", "Breakdown", "Strategy", "Copy", "Assets", "Review", "Final draft", "Parked"] as const;

export function Board({ cards, stage, canMove }: { cards: CreativeDto[]; stage: string; canMove: boolean }) {
  const router = useRouter();
  const dragged = useRef(false);
  const draggingId = useRef("");
  const boardRef = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const stages = stage ? STAGES.filter((item) => item === stage) : [...STAGES];

  async function move(card: CreativeDto, target: string) {
    if (target === card.stageLabel || busy) return;
    if (card.fixtureKind) {
      setNotice("A test fixture stays where it was seeded. It is not a live creative and it is not a final draft.");
      return;
    }
    const parking = target === "Parked";
    const restoring = card.stageLabel === "Parked";
    if (!canMove || (!parking && !restoring) || (parking && !card.permissions.canPark)) {
      setNotice("Stage follows the work on the brief. Dragging does not skip a stage. Park is the move available from the board, and only for the assigned strategist.");
      return;
    }
    setBusy(card.id);
    setNotice("");
    const response = await fetch(`/api/creatives/${card.id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "park", parked: parking }),
    });
    const data = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setNotice(data.error ?? "The move was refused.");
      return;
    }
    setNotice(parking
      ? "Parked. This is not live and it is not approved."
      : `Restored. It returns to ${data.creative?.stageLabel ?? "the stage the work has reached"}, because the column has to match the brief.`);
    router.refresh();
  }

  return (
    <div>
      {notice ? <p className="note" role="status">{notice}</p> : null}
      <div
        className="board"
        aria-label="Pipeline board"
        ref={boardRef}
        onDragOver={(event) => {
          const board = boardRef.current;
          if (!board) return;
          const rect = board.getBoundingClientRect();
          if (event.clientX > rect.right - 64) board.scrollLeft += 28;
          if (event.clientX < rect.left + 64) board.scrollLeft -= 28;
        }}
      >
        {stages.map((name) => {
          const column = cards.filter((card) => card.stageLabel === name);
          return (
            <section
              key={name}
              className={over === name ? "column drop" : "column"}
              aria-label={`${name}, ${column.length} ${column.length === 1 ? "creative" : "creatives"}`}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(name);
              }}
              onDragLeave={() => setOver((current) => current === name ? "" : current)}
              onDrop={(event) => {
                event.preventDefault();
                setOver("");
                const id = event.dataTransfer.getData("text/plain") || draggingId.current;
                const card = cards.find((item) => item.id === id);
                if (card) void move(card, name);
              }}
            >
              <header className="column-head">
                <h3>{name}</h3>
                <span>{column.length}</span>
              </header>
              <div className="column-body">
                {column.length === 0 ? <p className="muted">None in this stage.</p> : null}
                {column.map((card) => {
                  const movable = canMove && !card.fixtureKind && (card.permissions.canPark || card.stageLabel === "Parked");
                  return (
                    <article key={card.id} className="card" data-testid="creative-card">
                      {card.banner ? <p className="banner">{card.banner}</p> : null}
                      <p className="kicker">{card.code ?? "No pipeline ID"}</p>
                      <h3><Link href={`/creatives/${card.id}`}>{card.intake.idea || "Untitled intake"}</Link></h3>
                      <p className="meta"><span>Stage</span>{card.stageLabel}</p>
                      <p className="meta"><span>Next action</span>{card.nextAction} Owner: {card.owner}.</p>
                      <p className="meta"><span>Blocker</span>{card.blockers[0] ? `${card.blockers[0].reason} Owner: ${card.blockers[0].owner}.` : "None."}</p>
                      <p className="meta"><span>Final draft</span>{card.finalDraftLabel}. {card.handoffLabel}.</p>
                      {movable ? (
                        <button
                          type="button"
                          className="secondary drag"
                          draggable
                          disabled={busy === card.id}
                          aria-label={card.permissions.canPark ? `Park ${card.intake.idea || "creative"}` : `Restore ${card.intake.idea || "creative"}`}
                          onDragStart={(event) => {
                            dragged.current = true;
                            draggingId.current = card.id;
                            event.dataTransfer.setData("text/plain", card.id);
                            event.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => {
                            window.setTimeout(() => { dragged.current = false; }, 0);
                          }}
                          onClick={() => {
                            if (dragged.current) return;
                            void move(card, card.permissions.canPark ? "Parked" : "Intake");
                          }}
                        >
                          {card.permissions.canPark ? "Drag to Parked" : "Drag to restore"}
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
