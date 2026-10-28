"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AgentBot } from "./agent-panel";
import {
  alternativesFor,
  documentsFor,
  initialsOf,
  isQuestion,
  nextQuestion,
  pointAnswers,
  pointsSaid,
  type Suggestion,
  suggestionFor,
  type WalkDocument,
  type WalkFilter,
  type WalkPoint,
  type WalkProposal,
  type WalkSlot,
  walkProgress,
  walkSlots,
  walkStatus,
} from "./client-walkthrough-model";
import { acceptProposal, controlProposals } from "./references-view";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** Another part of the page opens a question in the walkthrough (its key). */
export const WALK_ASK_EVENT = "aw:walk-ask";

/** Another part of the page opens the points waiting for the client's confirmation. */
export const WALK_POINTS_EVENT = "aw:walk-points";

/** One line of the conversation: the agent's, or the person's. */
type Entry =
  | { id: number; at: Date; who: "agent"; kind: "ask"; key: string }
  | {
      id: number;
      at: Date;
      who: "agent";
      kind: "say";
      text: string;
      strong?: string;
      recorded?: boolean;
      /** Null under the last answer: every question has its answer. */
      next?: null;
      link?: { label: string; href: string };
    }
  | { id: number; at: Date; who: "you"; text: string };

/** An entry before it is timed and numbered, kind by kind. */
type NewEntry = Entry extends infer E
  ? E extends Entry
    ? Omit<E, "id" | "at">
    : never
  : never;

const TIME = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const STATUS_WORDS = {
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In progress",
  SKIPPED: "Skipped",
  PENDING: "Pending",
} as const;

/**
 * The client-specific information as a conversation (decided by the product owner on 26
 * October 2026, from the walkthrough references): the Control Understanding Agent asks the
 * control's client questions one at a time, with the answers to choose from (the agent's
 * prior-year proposal or the usual answers as chips; the control's own policies for a
 * question that asks for one); each answer is saved as it is chosen or typed, with who
 * recorded it; once every question is answered the process narrative is drafted from them.
 * A typed question goes to the agent console. The agent's lines are fixed wording: no model
 * writes them.
 */
export function ClientWalkthrough({
  ids,
  slots,
  canAct,
  documents,
  policiesHref,
  askHref,
  viewer,
  everywhere,
  onEverywhere,
  onSave,
  onComplete,
  points = [],
  onConfirmPoints,
  problem,
  busy,
}: {
  ids: Ids;
  slots: WalkSlot[];
  canAct: boolean;
  /** The control's documents, for a question that asks for its policy or procedure. */
  documents: WalkDocument[];
  /** Where the control's policies are read and managed. */
  policiesHref: string;
  /** The agent console, for a question about the control. */
  askHref: string;
  /** The person answering, by name or email, for their initials. */
  viewer: string;
  everywhere: boolean;
  onEverywhere: (value: boolean) => void;
  /** Saves one answer as the client's value; true once it is saved. */
  onSave: (key: string, value: string) => Promise<boolean>;
  /** Every question has its answer: the narrative is drafted from them. */
  onComplete: () => void;
  /** The narrative's points still waiting for the client, confirmed as one decision. */
  points?: WalkPoint[];
  /** Sends a round's answers; true once they are recorded. */
  onConfirmPoints?: (
    items: Array<{ issue_id: string; version: number; answer: string }>,
  ) => Promise<boolean>;
  problem: string | null;
  busy: boolean;
}) {
  const [filter, setFilter] = useState<WalkFilter>("all");
  const [proposals, setProposals] = useState<WalkProposal[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  // Answers saved this session, shown before the page's data has refreshed.
  const [saved, setSaved] = useState<Record<string, string>>({});
  const live = useMemo(
    () =>
      slots.map((slot) =>
        saved[slot.key] !== undefined
          ? { ...slot, value: saved[slot.key] ?? "" }
          : slot,
      ),
    [slots, saved],
  );
  const shown = walkSlots(live, filter);
  const [current, setCurrent] = useState<string | null>(() =>
    nextQuestion(slots, new Set()),
  );
  const [choosing, setChoosing] = useState(false);
  const [text, setText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const idRef = useRef(1);
  const [log, setLog] = useState<Entry[]>(() =>
    current === null
      ? []
      : [{ id: 0, at: new Date(), who: "agent", kind: "ask", key: current }],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void controlProposals(ids, ids.controlId).then((items) => {
      if (alive) {
        setProposals(
          items
            .filter((item) => item.kind === "ANSWER")
            .map((item) => ({
              id: item.id,
              slotKey: item.slotKey,
              value: item.value,
              quote: item.quote,
              status: item.status,
            })),
        );
      }
    });
    return () => {
      alive = false;
    };
  }, [ids]);

  // The newest line stays in view, inside the conversation's own scroll.
  useEffect(() => {
    const box = scroller.current;
    if (box !== null && log.length > 0) {
      box.scrollTop = box.scrollHeight;
    }
  }, [log]);

  // The narrative's points arrive in rounds: each round is announced once, and shown
  // together below the conversation to confirm as one decision.
  const knownPoints = useRef(new Set(points.map((point) => point.id)));
  const [pointsOpen, setPointsOpen] = useState(true);
  useEffect(() => {
    const fresh = points.filter((point) => !knownPoints.current.has(point.id));
    for (const point of points) {
      knownPoints.current.add(point.id);
    }
    if (fresh.length === 0) {
      return;
    }
    setPointsOpen(true);
    setLog((now) => [
      ...now,
      {
        id: idRef.current++,
        at: new Date(),
        who: "agent",
        kind: "say",
        text:
          points.length === 1
            ? "The narrative needs one point confirmed before it is final."
            : `The narrative needs ${points.length} points confirmed before it is final.`,
      },
    ]);
  }, [points]);

  // The narrative's review sends the person here to confirm the points.
  const pointsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = () => {
      setPointsOpen(true);
      window.setTimeout(() => {
        pointsRef.current?.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
      }, 50);
    };
    document.addEventListener(WALK_POINTS_EVENT, show);
    return () => document.removeEventListener(WALK_POINTS_EVENT, show);
  }, []);

  // A source listed beside the conversation opens its question here.
  useEffect(() => {
    const open = (event: Event) => {
      const key = String((event as CustomEvent<string>).detail);
      setCurrent(key);
      setChoosing(false);
      setLog((now) => [
        ...now,
        { id: idRef.current++, at: new Date(), who: "agent", kind: "ask", key },
      ]);
      scroller.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    };
    document.addEventListener(WALK_ASK_EVENT, open);
    return () => document.removeEventListener(WALK_ASK_EVENT, open);
  }, []);

  const slotOf = (key: string | null) =>
    live.find((slot) => slot.key === key) ?? null;
  const add = (entries: NewEntry[]) =>
    setLog((now) => [
      ...now,
      ...entries.map(
        (entry) => ({ ...entry, id: idRef.current++, at: new Date() }) as Entry,
      ),
    ]);
  const ask = (key: string | null) => {
    setCurrent(key);
    setChoosing(false);
    if (key !== null) {
      add([{ who: "agent", kind: "ask", key }]);
    }
  };

  async function confirm(
    value: string,
    said: string,
    suggestion: Suggestion | null,
  ) {
    const slot = slotOf(current);
    if (slot === null || value.trim() === "" || busy) {
      return;
    }
    add([{ who: "you", text: said }]);
    let ok = false;
    if (suggestion?.proposalId != null && suggestion.value === value) {
      // The prior-year proposal is accepted, so the decision is on record with it.
      ok = await acceptProposal(ids, suggestion.proposalId);
      if (ok && everywhere) {
        ok = await onSave(slot.key, value);
      }
    } else {
      ok = await onSave(slot.key, value);
    }
    if (!ok) {
      add([
        {
          who: "agent",
          kind: "say",
          text: "The answer could not be saved. Try again.",
        },
      ]);
      return;
    }
    const wasComplete = live.every((item) => item.value.trim() !== "");
    const done = { ...saved, [slot.key]: value };
    setSaved(done);
    const answered = new Set(Object.keys(done));
    const next = nextQuestion(
      walkSlots(live, filter),
      skipped,
      slot.key,
      answered,
    );
    const complete = live.every(
      (item) => item.value.trim() !== "" || answered.has(item.key),
    );
    // The answer is recorded on its own line; the next question follows in its own card.
    const recorded: NewEntry = {
      who: "agent",
      kind: "say",
      text: "Recorded:",
      strong: value,
      recorded: true,
      // "Every question has its answer" under the last one.
      ...(next === null && complete ? { next: null } : {}),
    };
    add(
      next === null
        ? [recorded]
        : [recorded, { who: "agent", kind: "ask", key: next }],
    );
    setCurrent(next);
    setChoosing(false);
    if (complete && !wasComplete) {
      add([
        {
          who: "agent",
          kind: "say",
          text: "The process narrative is being drafted from the answers, below this conversation.",
        },
      ]);
      onComplete();
    }
  }

  async function confirmPoints(
    items: Array<{ issue_id: string; version: number; answer: string }>,
    said: string,
  ) {
    if (onConfirmPoints === undefined || busy) {
      return;
    }
    add([{ who: "you", text: said }]);
    const ok = await onConfirmPoints(items);
    add([
      ok
        ? {
            who: "agent",
            kind: "say",
            text: "Recorded. The narrative is being drafted again from the answers, below this conversation.",
          }
        : {
            who: "agent",
            kind: "say",
            text: "The answers could not be saved. Try again.",
          },
    ]);
  }

  function skip() {
    const slot = slotOf(current);
    if (slot === null) {
      return;
    }
    const now = new Set(skipped).add(slot.key);
    setSkipped(now);
    const next = nextQuestion(
      walkSlots(live, filter),
      now,
      slot.key,
      new Set(Object.keys(saved)),
    );
    const following = next === slot.key ? null : next;
    const said: NewEntry[] = [
      { who: "you", text: "Skip for now" },
      {
        who: "agent",
        kind: "say",
        text: "Skipped. The question stays open; return to it from View all questions.",
      },
    ];
    add(
      following === null
        ? said
        : [...said, { who: "agent", kind: "ask", key: following }],
    );
    setCurrent(following);
    setChoosing(false);
  }

  function send() {
    const typed = text.trim();
    if (typed === "") {
      return;
    }
    setText("");
    if (isQuestion(typed)) {
      const url = new URL(askHref, window.location.origin);
      url.searchParams.set("ask", typed.slice(0, 1500));
      add([
        { who: "you", text: typed },
        {
          who: "agent",
          kind: "say",
          text: "Questions about the control are answered in the agent console.",
          link: { label: "Ask the agent", href: url.toString() },
        },
      ]);
      return;
    }
    if (current === null) {
      add([
        { who: "you", text: typed },
        {
          who: "agent",
          kind: "say",
          text: "Every question has an answer. Open one from View all questions to change it.",
        },
      ]);
      return;
    }
    void confirm(typed, typed, null);
  }

  // The agent's last line that names a question: where the question asked now is answered.
  const promptKeyOf = (entry: Entry): string | null =>
    entry.who !== "agent"
      ? null
      : entry.kind === "ask"
        ? entry.key
        : (entry.next ?? null);
  const lastPrompt =
    [...log].reverse().find((entry) => promptKeyOf(entry) !== null)?.id ?? -1;
  const progress = walkProgress(live);

  const prompt = (slot: WalkSlot) => {
    if (!canAct) {
      return null;
    }
    const docs = documentsFor(slot, documents);
    const [first, ...rest] = docs;
    if (first !== undefined) {
      return (
        <div className="wt-prompt">
          <div className="wt-doc">
            <span className="wt-doc-icon" aria-hidden="true">
              <UiIcon name="file" size={18} />
            </span>
            <span className="wt-doc-text">
              <strong>{first.title}</strong>
              <small>{first.detail}</small>
            </span>
            <a className="wt-doc-view" href={policiesHref}>
              View document
            </a>
          </div>
          <div className="wt-actions">
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy}
              onClick={() => void confirm(first.title, first.title, null)}
            >
              Use this document
            </button>
            {rest.length > 0 ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                aria-expanded={choosing}
                onClick={() => setChoosing(!choosing)}
              >
                Choose a different document
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => input.current?.focus()}
            >
              Type my own answer
            </button>
          </div>
          {choosing ? (
            <div className="wt-chips">
              {rest.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="wt-chip"
                  disabled={busy}
                  onClick={() => void confirm(item.title, item.title, null)}
                >
                  {item.title}
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="wt-skip" onClick={skip}>
            Skip for now
          </button>
        </div>
      );
    }
    const suggestion = suggestionFor(slot, proposals);
    const others = alternativesFor(slot, suggestion);
    return (
      <div className="wt-prompt">
        {suggestion?.source === "PRIOR_YEAR" ? (
          <p className="wt-prior">
            <UiIcon name="clock" size={12} />
            {suggestion.label}
            {suggestion.quote !== "" ? <q>{suggestion.quote}</q> : null}
          </p>
        ) : null}
        <div className="wt-chips">
          {suggestion !== null ? (
            <button
              type="button"
              className="wt-chip is-suggested"
              disabled={busy}
              title={suggestion.label}
              onClick={() =>
                void confirm(suggestion.value, suggestion.value, suggestion)
              }
            >
              <span className="wt-chip-mark" aria-hidden="true">
                <UiIcon name="check" size={10} />
              </span>
              {suggestion.value}
            </button>
          ) : null}
          {others.map((option) => (
            <button
              key={option}
              type="button"
              className="wt-chip"
              disabled={busy}
              onClick={() => void confirm(option, option, null)}
            >
              {option}
            </button>
          ))}
          <button
            type="button"
            className="wt-chip"
            onClick={() => input.current?.focus()}
          >
            Other (specify)
          </button>
        </div>
        <button type="button" className="wt-skip" onClick={skip}>
          Skip for now
        </button>
      </div>
    );
  };

  return (
    <section className="wt" aria-labelledby="wt-title" id="client-info">
      <header className="wt-head">
        <span className="wt-head-icon" aria-hidden="true">
          <UiIcon name="layers" size={22} />
        </span>
        <div>
          <h4 id="wt-title">Client-specific information</h4>
          <p>
            A walk through how this control works in the client's environment: a
            few questions, whose answers draft the process narrative.
          </p>
        </div>
        <div className="wt-head-side">
          <span className="wt-progress">
            <span className="wt-bar" aria-hidden="true">
              <span style={{ width: `${progress.percent}%` }} />
            </span>
            <small>
              {progress.done} of {progress.total} completed
            </small>
          </span>
          <button
            type="button"
            className="btn-secondary btn-sm"
            aria-expanded={showAll}
            onClick={() => setShowAll(!showAll)}
          >
            View all questions
          </button>
        </div>
      </header>

      {showAll ? (
        <div className="wt-all">
          <div className="wt-all-head">
            <label>
              <span className="sr-only">Show</span>
              <select
                value={filter}
                onChange={(event) =>
                  setFilter(event.target.value as WalkFilter)
                }
              >
                <option value="all">All questions</option>
                <option value="required">Required</option>
                <option value="open">Not answered yet</option>
              </select>
            </label>
            {canAct ? (
              <span className="wt-reuse">
                <button
                  type="button"
                  role="switch"
                  aria-checked={everywhere}
                  aria-label="Reuse each answer for other controls that ask the same"
                  className={`wt-switch${everywhere ? " is-on" : ""}`}
                  onClick={() => onEverywhere(!everywhere)}
                >
                  <span />
                </button>
                Reuse each answer for other controls that ask the same
              </span>
            ) : null}
          </div>
          <ol className="wt-steps">
            {shown.map((slot) => {
              const status = walkStatus(slot, current, skipped);
              return (
                <li key={slot.key} className={`is-${status.toLowerCase()}`}>
                  <button
                    type="button"
                    onClick={() => {
                      ask(slot.key);
                      setShowAll(false);
                    }}
                  >
                    <span className="wt-step-num">
                      {live.findIndex((item) => item.key === slot.key) + 1}
                    </span>
                    <span className="wt-step-text">
                      {slot.question}
                      {slot.value !== "" ? <small>{slot.value}</small> : null}
                    </span>
                    <span className={`wt-status is-${status.toLowerCase()}`}>
                      {STATUS_WORDS[status]}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      <div className="wt-log" ref={scroller} aria-live="polite">
        {log.length === 0 ? (
          <p className="wt-empty">
            Every question has its answer. Open one from View all questions to
            change it.
          </p>
        ) : null}
        {log.map((entry) => {
          if (entry.who === "you") {
            return (
              <div key={entry.id} className="wt-you">
                <div>
                  <p className="wt-meta">
                    You <time>{TIME.format(entry.at)}</time>
                  </p>
                  <p className="wt-bubble is-you">{entry.text}</p>
                </div>
                <span className="wt-avatar" aria-hidden="true">
                  {initialsOf(viewer)}
                </span>
              </div>
            );
          }
          const asked = entry.kind === "ask" ? slotOf(entry.key) : null;
          const here =
            promptKeyOf(entry) === current && entry.id === lastPrompt
              ? slotOf(current)
              : null;
          return (
            <div key={entry.id} className="wt-agent">
              <span className="wt-agent-mark" aria-hidden="true">
                <AgentBot />
              </span>
              <div className="wt-agent-body">
                <p className="wt-meta">
                  Control Understanding Agent{" "}
                  <time>{TIME.format(entry.at)}</time>
                </p>
                <div className="wt-bubble">
                  {asked !== null ? (
                    <>
                      <span className="wt-qnum">
                        Question{" "}
                        {live.findIndex((item) => item.key === asked.key) + 1}{" "}
                        of {live.length}
                      </span>
                      <strong>{asked.question}</strong>
                      {asked.hint !== "" ? <span>{asked.hint}</span> : null}
                      {here !== null && canAct ? (
                        <span className="wt-lead">
                          Choose from the options below or type your own answer.
                        </span>
                      ) : null}
                    </>
                  ) : entry.kind === "say" ? (
                    <div className={entry.recorded ? "wt-recorded" : undefined}>
                      {entry.recorded ? (
                        <span className="wt-recorded-mark" aria-hidden="true">
                          <UiIcon name="check" size={14} />
                        </span>
                      ) : null}
                      <span className="wt-say">
                        <span>
                          {entry.text}
                          {entry.strong !== undefined ? (
                            <>
                              {" "}
                              <strong>{entry.strong}</strong>.
                            </>
                          ) : null}
                        </span>
                        {entry.recorded && entry.next === null ? (
                          <span className="wt-next">
                            Every question has its answer.
                          </span>
                        ) : null}
                        {entry.link !== undefined ? (
                          <a className="wt-link" href={entry.link.href}>
                            {entry.link.label}
                            <UiIcon name="arrow" size={13} />
                          </a>
                        ) : null}
                      </span>
                    </div>
                  ) : null}
                </div>
                {here !== null ? prompt(here) : null}
              </div>
            </div>
          );
        })}
        {points.length > 0 ? (
          <div ref={pointsRef}>
            <PointsCard
              points={points}
              open={pointsOpen}
              onOpen={setPointsOpen}
              canAct={canAct && onConfirmPoints !== undefined}
              busy={busy}
              onConfirm={(items, said) => void confirmPoints(items, said)}
            />
          </div>
        ) : null}
      </div>

      {canAct ? (
        <form
          className="wt-input"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          <input
            ref={input}
            type="text"
            value={text}
            maxLength={300}
            placeholder="Type your answer or ask a question…"
            aria-label="Type your answer or ask a question"
            onChange={(event) => setText(event.target.value)}
          />
          <button
            type="submit"
            className="btn"
            aria-label="Send"
            disabled={text.trim() === "" || busy}
          >
            <UiIcon name="arrow" size={16} />
          </button>
        </form>
      ) : null}
      {problem !== null ? (
        <p className="form-error" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

/**
 * A round of the narrative's points, confirmed as one decision (decided by the product
 * owner on 26 October 2026): each states what the records and earlier answers suggest, to
 * confirm as it stands or correct; a point the records suggest nothing for is answered in
 * its own words. Nothing is sent until Confirm all.
 */
function PointsCard({
  points,
  open,
  onOpen,
  canAct,
  busy,
  onConfirm,
}: {
  points: WalkPoint[];
  open: boolean;
  onOpen: (open: boolean) => void;
  canAct: boolean;
  busy: boolean;
  onConfirm: (
    items: Array<{ issue_id: string; version: number; answer: string }>,
    said: string,
  ) => void;
}) {
  // The person's corrections, by point; a point without one is confirmed as stated.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const answers = pointAnswers(points, edits);
  const count = `${points.length} point${points.length === 1 ? "" : "s"}`;

  if (!open) {
    return (
      <div className="wt-points is-closed">
        <span>
          <UiIcon name="risk" size={14} />
          {count} to confirm before the narrative is final.
        </span>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => onOpen(true)}
        >
          Open
        </button>
      </div>
    );
  }
  return (
    <section className="wt-points" aria-labelledby="wt-points-title">
      <header>
        <h4 id="wt-points-title">Before the narrative is final</h4>
        <span className="wt-points-count">{count} to confirm</span>
      </header>
      <p className="wt-points-lead">
        Each point states what the records and earlier answers show or, where
        they are silent, what is typical for this kind of control. Confirm them
        together, or choose or write a correction first.
      </p>
      <ol>
        {points.map((point, index) => {
          const open = point.statement === "" || editing.has(point.id);
          const corrected =
            edits[point.id] !== undefined &&
            edits[point.id]?.trim() !== point.statement.trim();
          return (
            <li key={point.id}>
              <span className="wt-point-num">{index + 1}</span>
              <div className="wt-point-body">
                <p className="wt-point-meta">
                  {point.section !== "" ? <span>{point.section}</span> : null}
                  {point.attributes.map((code) => (
                    <span key={code} className="pa-code">
                      {code}
                    </span>
                  ))}
                  {point.contradiction ? (
                    <span className="wt-point-flag">Contradiction</span>
                  ) : null}
                  {point.basis !== "" ? (
                    <span
                      className={`wt-point-basis is-${point.basis.toLowerCase()}`}
                    >
                      {point.basis === "SOURCES"
                        ? "From the records"
                        : "Typical for this control"}
                    </span>
                  ) : null}
                </p>
                {open ? (
                  <label className="wt-point-edit">
                    <span>{point.question}</span>
                    <textarea
                      rows={2}
                      maxLength={1000}
                      value={edits[point.id] ?? point.statement}
                      disabled={!canAct}
                      onChange={(event) =>
                        setEdits({ ...edits, [point.id]: event.target.value })
                      }
                    />
                  </label>
                ) : (
                  <p className="wt-point-text">
                    {corrected ? edits[point.id] : point.statement}
                  </p>
                )}
                {canAct && point.options.length > 0 ? (
                  <span className="wt-point-options">
                    <span>Other answers</span>
                    {point.options.map((option) => {
                      const chosen = edits[point.id]?.trim() === option.trim();
                      return (
                        <button
                          key={option}
                          type="button"
                          className={`wt-chip${chosen ? " is-suggested" : ""}`}
                          aria-pressed={chosen}
                          onClick={() => {
                            if (chosen) {
                              const { [point.id]: _dropped, ...rest } = edits;
                              setEdits(rest);
                            } else {
                              setEdits({ ...edits, [point.id]: option });
                            }
                            const next = new Set(editing);
                            next.delete(point.id);
                            setEditing(next);
                          }}
                        >
                          {chosen ? (
                            <span className="wt-chip-mark" aria-hidden="true">
                              <UiIcon name="check" size={10} />
                            </span>
                          ) : null}
                          {option}
                        </button>
                      );
                    })}
                  </span>
                ) : null}
                {point.why !== "" ? (
                  <small className="wt-point-why">{point.why}</small>
                ) : null}
                {canAct && point.statement !== "" ? (
                  <span className="wt-point-actions">
                    {open ? (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          const { [point.id]: _dropped, ...rest } = edits;
                          setEdits(rest);
                          const next = new Set(editing);
                          next.delete(point.id);
                          setEditing(next);
                        }}
                      >
                        <UiIcon name="check" size={13} />
                        Use the statement as written
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() =>
                          setEditing(new Set(editing).add(point.id))
                        }
                      >
                        <UiIcon name="compose" size={13} />
                        {corrected ? "Edit the correction" : "Correct it"}
                      </button>
                    )}
                    {corrected && !open ? (
                      <span className="wt-point-state">Corrected</span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {canAct ? (
        <footer>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => onOpen(false)}
          >
            Skip for now
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || answers === null}
            onClick={() => {
              if (answers !== null) {
                onConfirm(answers, pointsSaid(points, edits));
              }
            }}
          >
            <UiIcon name="check" size={13} />
            {points.length === 1 ? "Confirm" : `Confirm all ${points.length}`}
          </button>
        </footer>
      ) : null}
    </section>
  );
}
