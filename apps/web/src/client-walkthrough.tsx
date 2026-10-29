"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { AgentBot } from "./agent-panel";
import { BringForward } from "./bring-forward";
import {
  alternativesFor,
  categoryOf,
  documentsFor,
  isQuestion,
  nextQuestion,
  pointAnswers,
  pointsSaid,
  progressSegments,
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
import {
  type CopyOffer,
  controlLabel,
  parseOffer,
  suggestedSource,
} from "./understanding-copy-model";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** Another part of the page opens a question in the walkthrough (its key). */
export const WALK_ASK_EVENT = "aw:walk-ask";

/** Another part of the page opens the points waiting for the client's confirmation. */
export const WALK_POINTS_EVENT = "aw:walk-points";

const STATUS_WORDS = {
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In progress",
  SKIPPED: "Skipped",
  PENDING: "Pending",
} as const;

/** What the agent says under the question after a step: saved, skipped, or a link. */
type Notice = {
  tone: "done" | "info" | "error";
  text: string;
  link?: { label: string; href: string };
};

const OTHER = "\u0000other";

/**
 * The client-specific information, as the product owner's reference (28 October 2026,
 * replacing the conversation of 26 October): the Control Understanding Agent asks the
 * control's client questions one at a time, each with its category, the answers to choose
 * from (the agent's prior-year proposal or the usual answer first, with where it came from;
 * the control's own policies for a question that asks for one) and Other; optional context
 * is kept as a walkthrough note on the control and a file can be attached to it. Beside the
 * question, the understanding so far: each answer under its category, opened to change it.
 * Each answer is saved with who recorded it; once every question is answered the process
 * narrative is drafted from them. The agent's words are fixed: no model writes them.
 */
export function ClientWalkthrough({
  ids,
  slots,
  canAct,
  documents,
  policiesHref,
  askHref,
  everywhere,
  onEverywhere,
  onSave,
  onComplete,
  onNote,
  onAttach,
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
  /** The person answering, by name or email (kept for callers; not shown). */
  viewer?: string;
  everywhere: boolean;
  onEverywhere: (value: boolean) => void;
  /** Saves one answer as the client's value; true once it is saved. */
  onSave: (key: string, value: string) => Promise<boolean>;
  /** Every question has its answer: the narrative is drafted from them. */
  onComplete: () => void;
  /** Keeps added context as a walkthrough note on the control; true once it is saved. */
  onNote?: (question: string, text: string) => Promise<boolean>;
  /** Attaches a supporting file to the control; null once attached, else why not. */
  onAttach?: (file: File) => Promise<string | null>;
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
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const card = useRef<HTMLDivElement>(null);
  // Another control's answers to bring forward (28 October 2026), read once.
  const [offer, setOffer] = useState<CopyOffer | null>(null);
  const [copying, setCopying] = useState<string | null>(null);
  useEffect(() => {
    if (!canAct) {
      return;
    }
    let alive = true;
    void fetch(
      `/workspace/understanding-copy?${new URLSearchParams({
        organization: ids.organizationId,
        project: ids.projectId,
        control: ids.controlId,
      }).toString()}`,
    )
      .then((response) => response.json())
      .then((answer: { result?: unknown }) => {
        if (alive) {
          setOffer(parseOffer(answer.result));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ids, canAct]);

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

  // The narrative's points arrive in rounds, shown together under the question to confirm
  // as one decision.
  const [pointsOpen, setPointsOpen] = useState(true);
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

  // A source listed beside the narrative opens its question here.
  useEffect(() => {
    const open = (event: Event) => {
      setCurrent(String((event as CustomEvent<string>).detail));
      setNotice(null);
      card.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    document.addEventListener(WALK_ASK_EVENT, open);
    return () => document.removeEventListener(WALK_ASK_EVENT, open);
  }, []);

  const slotOf = (key: string | null) =>
    live.find((slot) => slot.key === key) ?? null;
  const open = (key: string | null) => {
    setCurrent(key);
    setNotice(null);
  };

  async function confirm(value: string, suggestion: Suggestion | null) {
    const slot = slotOf(current);
    if (slot === null || value.trim() === "" || busy) {
      return false;
    }
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
      setNotice({
        tone: "error",
        text: "The answer could not be saved. Try again.",
      });
      return false;
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
    setCurrent(next);
    setNotice(
      complete && !wasComplete
        ? {
            tone: "done",
            text: "Every question has its answer. The process narrative is being drafted from them.",
          }
        : { tone: "done", text: `Recorded: ${value}.` },
    );
    if (complete && !wasComplete) {
      onComplete();
    }
    return true;
  }

  async function confirmPoints(
    items: Array<{ issue_id: string; version: number; answer: string }>,
  ) {
    if (onConfirmPoints === undefined || busy) {
      return;
    }
    const ok = await onConfirmPoints(items);
    setNotice(
      ok
        ? {
            tone: "done",
            text: "Recorded. The narrative is being drafted again from the answers.",
          }
        : { tone: "error", text: "The answers could not be saved. Try again." },
    );
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
    setCurrent(next === slot.key ? null : next);
    setNotice({
      tone: "info",
      text: "Skipped. The question stays open; return to it from View all questions.",
    });
  }

  function copied(values: Record<string, string>, from: string) {
    setCopying(null);
    const wasComplete = live.every((item) => item.value.trim() !== "");
    const done = { ...saved, ...values };
    setSaved(done);
    const answered = new Set(Object.keys(done));
    const complete = live.every(
      (item) => item.value.trim() !== "" || answered.has(item.key),
    );
    setCurrent(nextQuestion(walkSlots(live, filter), skipped, null, answered));
    const count = Object.keys(values).length;
    setNotice({
      tone: "done",
      text: `Brought forward ${count} answer${count === 1 ? "" : "s"} from ${from}.${
        complete && !wasComplete
          ? " Every question has its answer; the process narrative is being drafted from them."
          : ""
      }`,
    });
    if (complete && !wasComplete) {
      onComplete();
    }
  }

  const sources = offer?.sources ?? [];
  const suggested = suggestedSource(offer);
  const progress = walkProgress(live);
  const segments = progressSegments(progress.done, progress.total);
  const asked = slotOf(current);
  const answers = live.filter((slot) => slot.value.trim() !== "");

  return (
    <section className="wt cu" aria-labelledby="wt-title" id="client-info">
      <header className="cu-head">
        <span className="cu-head-icon" aria-hidden="true">
          <UiIcon name="layers" size={24} />
        </span>
        <div className="cu-head-text">
          <small>Control understanding</small>
          <h4 id="wt-title">Understand how this control operates</h4>
          <p>
            Answer a few focused questions to build a client-specific process
            narrative.
          </p>
        </div>
        <div className="cu-head-side">
          <span className="cu-progress">
            <span className="cu-segments" aria-hidden="true">
              {segments.map((filled, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional.
                  key={index}
                  className={filled ? "is-done" : undefined}
                />
              ))}
            </span>
            <small>
              {progress.done} of {progress.total} answered
            </small>
          </span>
          <span className="cu-head-actions">
            {canAct && sources.length > 0 ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() =>
                  setCopying((suggested ?? sources[0])?.controlId ?? null)
                }
              >
                <UiIcon name="copy" size={15} />
                Copy from another system
              </button>
            ) : null}
            <button
              type="button"
              className="btn-secondary btn-sm"
              aria-expanded={showAll}
              onClick={() => setShowAll(!showAll)}
            >
              <UiIcon name="list" size={15} />
              View all questions
            </button>
          </span>
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
                      open(slot.key);
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

      <div className="cu-grid">
        <div className="cu-main" ref={card}>
          <div className="cu-agent">
            <span className="cu-agent-mark" aria-hidden="true">
              <AgentBot size={44} />
            </span>
            <strong>Control Understanding Agent</strong>
            <span className="cu-agent-step">
              {asked !== null
                ? `Question ${live.findIndex((item) => item.key === asked.key) + 1} of ${live.length}`
                : `${progress.done} of ${progress.total} answered`}
            </span>
          </div>
          {asked !== null ? (
            <QuestionCard
              key={asked.key}
              slot={asked}
              canAct={canAct}
              busy={busy}
              documents={documentsFor(asked, documents)}
              policiesHref={policiesHref}
              suggestion={suggestionFor(asked, proposals)}
              askHref={askHref}
              onConfirm={confirm}
              onSkip={skip}
              onNote={onNote}
              onAttach={onAttach}
              onNotice={setNotice}
            />
          ) : (
            <div className="cu-card cu-done">
              <span className="cu-done-mark" aria-hidden="true">
                <UiIcon name="check" size={18} />
              </span>
              <div>
                <strong>Every question has its answer.</strong>
                <p>
                  The process narrative is drafted from them. Change one from
                  the understanding so far, or from View all questions.
                </p>
              </div>
            </div>
          )}
          {notice !== null ? (
            <p className={`cu-notice is-${notice.tone}`} role="status">
              <UiIcon
                name={notice.tone === "done" ? "check" : "info"}
                size={14}
              />
              <span>{notice.text}</span>
              {notice.link !== undefined ? (
                <a className="text-link is-plain" href={notice.link.href}>
                  {notice.link.label}
                  <UiIcon name="arrow" size={13} />
                </a>
              ) : null}
            </p>
          ) : null}
          {points.length > 0 ? (
            <div ref={pointsRef}>
              <PointsCard
                points={points}
                open={pointsOpen}
                onOpen={setPointsOpen}
                canAct={canAct && onConfirmPoints !== undefined}
                busy={busy}
                onConfirm={(items) => void confirmPoints(items)}
              />
            </div>
          ) : null}
          {problem !== null ? (
            <p className="form-error" role="alert">
              {problem}
            </p>
          ) : null}
        </div>

        <aside className="cu-side" aria-labelledby="cu-side-title">
          <h5 id="cu-side-title">Understanding so far</h5>
          <span
            className={`cu-captured${answers.length === 0 ? " is-none" : ""}`}
          >
            <span className="cu-tick" aria-hidden="true">
              <UiIcon name="check" size={11} />
            </span>
            {answers.length === 1
              ? "1 answer captured"
              : `${answers.length} answers captured`}
          </span>
          {answers.length > 0 ? (
            <ul className="cu-answers">
              {answers.map((slot) => {
                const category = categoryOf(slot);
                return (
                  <li key={slot.key}>
                    <button
                      type="button"
                      className={
                        slot.key === current ? "is-current" : undefined
                      }
                      title={`Change: ${slot.question}`}
                      onClick={() => open(slot.key)}
                    >
                      <span className="cu-answer-icon" aria-hidden="true">
                        <UiIcon name={category.icon} size={17} />
                      </span>
                      <span className="cu-answer-text">
                        <small>{category.label}</small>
                        <strong>{slot.value}</strong>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="cu-side-empty">
              Each answer appears here under what it covers.
            </p>
          )}
          {canAct && suggested !== null && answers.length < live.length ? (
            // The same control answered on another system: offered, never applied.
            <div className="cu-reuse">
              <p>
                <UiIcon name="copy" size={15} />
                <span>
                  <strong>{controlLabel(suggested)}</strong> is answered (
                  {suggested.answers.length} answer
                  {suggested.answers.length === 1 ? "" : "s"}).
                </span>
              </p>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setCopying(suggested.controlId)}
              >
                Bring forward its answers
              </button>
            </div>
          ) : null}
          <div className="cu-insights">
            <p>
              <UiIcon name="sparkles" size={15} />
              <strong>Draft insights</strong>
              <span>· Not yet verified</span>
            </p>
            <p>
              Your answers help prepare the process narrative for reviewer
              validation.
            </p>
          </div>
        </aside>
      </div>
      {copying !== null && offer !== null ? (
        <BringForward
          ids={ids}
          offer={offer}
          initial={copying}
          onClose={() => setCopying(null)}
          onCopied={copied}
        />
      ) : null}
    </section>
  );
}

/**
 * One question, as the reference's card: its category, the question and how to answer it,
 * the answers to choose from as cards (the suggestion first and chosen, with where it came
 * from), Other with a field of its own, Skip for now; then context to add, a file to attach,
 * and Save & continue. A typed question in the context goes to the agent console.
 */
function QuestionCard({
  slot,
  canAct,
  busy,
  documents,
  policiesHref,
  suggestion,
  askHref,
  onConfirm,
  onSkip,
  onNote,
  onAttach,
  onNotice,
}: {
  slot: WalkSlot;
  canAct: boolean;
  busy: boolean;
  documents: WalkDocument[];
  policiesHref: string;
  suggestion: Suggestion | null;
  askHref: string;
  onConfirm: (value: string, suggestion: Suggestion | null) => Promise<boolean>;
  onSkip: () => void;
  onNote?: ((question: string, text: string) => Promise<boolean>) | undefined;
  onAttach?: ((file: File) => Promise<string | null>) | undefined;
  onNotice: (notice: Notice | null) => void;
}) {
  const id = useId();
  const category = categoryOf(slot);
  // A document question offers the control's policies; any other, the suggestion and the
  // usual answers.
  const options =
    documents.length > 0
      ? documents.map((item) => item.title)
      : [
          ...(suggestion !== null ? [suggestion.value] : []),
          ...alternativesFor(slot, suggestion),
        ];
  const answered = slot.value.trim();
  const [choice, setChoice] = useState<string>(() =>
    answered !== ""
      ? options.includes(answered)
        ? answered
        : OTHER
      : (options[0] ?? OTHER),
  );
  const [other, setOther] = useState(
    answered !== "" && !options.includes(answered) ? answered : "",
  );
  const [context, setContext] = useState("");
  const [attached, setAttached] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const otherInput = useRef<HTMLInputElement>(null);
  const value = choice === OTHER ? other.trim() : choice;

  async function save() {
    setProblem(null);
    const extra = context.trim();
    if (value === "") {
      setProblem("Choose an answer, or write one under Other.");
      return;
    }
    setSaving(true);
    let noted: Notice | null = null;
    if (extra !== "") {
      if (isQuestion(extra)) {
        const url = new URL(askHref, window.location.origin);
        url.searchParams.set("ask", extra.slice(0, 1500));
        noted = {
          tone: "info",
          text: "Questions about the control are answered in the agent console.",
          link: { label: "Ask the agent", href: url.toString() },
        };
      } else if (
        onNote !== undefined &&
        !(await onNote(slot.question, extra))
      ) {
        setProblem("The context could not be saved. Try again.");
        setSaving(false);
        return;
      }
    }
    const used =
      suggestion !== null && value === suggestion.value ? suggestion : null;
    const ok = await onConfirm(value, used);
    setSaving(false);
    if (ok && noted !== null) {
      onNotice(noted);
    }
  }

  async function attach(file: File) {
    if (onAttach === undefined) {
      return;
    }
    setAttaching(true);
    setProblem(null);
    const refused = await onAttach(file);
    setAttaching(false);
    if (refused === null) {
      setAttached(file.name);
    } else {
      setProblem(refused);
    }
  }

  return (
    <div className="cu-card">
      <span className="cu-pill">{category.label}</span>
      <h5 className="cu-question">{slot.question}</h5>
      {slot.hint !== "" ? <p className="cu-hint">{slot.hint}</p> : null}
      {canAct ? (
        <>
          <fieldset className="cu-options">
            <legend className="sr-only">{slot.question}</legend>
            {options.map((option) => (
              <label
                key={option}
                className={`cu-option${choice === option ? " is-on" : ""}`}
              >
                <input
                  type="radio"
                  name={`${id}-answer`}
                  value={option}
                  checked={choice === option}
                  onChange={() => setChoice(option)}
                />
                <span className="cu-radio" aria-hidden="true">
                  <UiIcon name="check" size={12} />
                </span>
                {option}
              </label>
            ))}
            <label className={`cu-option${choice === OTHER ? " is-on" : ""}`}>
              <input
                type="radio"
                name={`${id}-answer`}
                value="other"
                checked={choice === OTHER}
                onChange={() => {
                  setChoice(OTHER);
                  window.setTimeout(() => otherInput.current?.focus(), 0);
                }}
              />
              <span className="cu-radio" aria-hidden="true">
                <UiIcon name="check" size={12} />
              </span>
              Other (specify)
            </label>
          </fieldset>
          {choice === OTHER ? (
            <input
              ref={otherInput}
              className="cu-other"
              type="text"
              value={other}
              maxLength={300}
              autoComplete="off"
              placeholder={
                slot.example !== ""
                  ? `For example: ${slot.example}`
                  : "Your answer"
              }
              aria-label="Your answer"
              onChange={(event) => setOther(event.target.value)}
            />
          ) : null}
          {documents.length > 0 ? (
            <p className="cu-source">
              <UiIcon name="file" size={13} />
              The control's policies on file.{" "}
              <a className="text-link is-plain" href={policiesHref}>
                View documents
              </a>
            </p>
          ) : suggestion !== null && choice === suggestion.value ? (
            <p className="cu-source">
              <UiIcon
                name={suggestion.source === "PRIOR_YEAR" ? "clock" : "sparkles"}
                size={13}
              />
              {suggestion.label}
              {suggestion.quote !== "" ? <q>{suggestion.quote}</q> : null}
            </p>
          ) : null}
          <button type="button" className="cu-skip" onClick={onSkip}>
            Skip for now
          </button>
          <div className="cu-context">
            <label htmlFor={`${id}-context`}>
              Additional context (optional)
              <span
                className="cu-info"
                title="Kept as a walkthrough note on this control, which the narrative's agents read. A question goes to the agent console."
              >
                <UiIcon name="info" size={14} />
              </span>
            </label>
            <span className="cu-context-box">
              <textarea
                id={`${id}-context`}
                rows={2}
                maxLength={2000}
                value={context}
                autoComplete="off"
                placeholder="Add context about this answer or ask a follow-up…"
                onChange={(event) => setContext(event.target.value)}
              />
              {onAttach !== undefined ? (
                <button
                  type="button"
                  className="cu-attach"
                  aria-label="Attach a supporting file to this control"
                  title="Attach a supporting file to this control"
                  disabled={attaching}
                  onClick={() => fileInput.current?.click()}
                >
                  {attaching ? (
                    <span className="spinner small" aria-hidden="true" />
                  ) : (
                    <UiIcon name="paperclip" size={17} />
                  )}
                </button>
              ) : null}
              <input
                ref={fileInput}
                type="file"
                hidden
                aria-label="Supporting file"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file !== undefined) {
                    void attach(file);
                  }
                }}
              />
            </span>
            {attached !== null ? (
              <small className="cu-attached">
                <UiIcon name="file" size={12} />
                {attached} is attached to the control.
              </small>
            ) : null}
          </div>
          {problem !== null ? (
            <p className="form-error" role="alert">
              {problem}
            </p>
          ) : null}
          <div className="cu-foot">
            <button
              type="button"
              disabled={busy || saving || value === ""}
              onClick={() => void save()}
            >
              {saving ? (
                <span className="spinner small" aria-hidden="true" />
              ) : null}
              Save &amp; continue
              <UiIcon name="arrow" size={15} />
            </button>
          </div>
        </>
      ) : answered !== "" ? (
        <p className="cu-readonly">{answered}</p>
      ) : null}
    </div>
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
