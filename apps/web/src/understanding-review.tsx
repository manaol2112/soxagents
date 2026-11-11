"use client";

import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AgentAvatar } from "./agent-avatar";
import { AuthenticationPoint } from "./authentication-point";
import { useAction } from "./control-context-view";
import { RecordDialog } from "./record-dialog";
import { acceptProposal } from "./references-view";
import { UiIcon } from "./ui-icon";
import {
  AGENT_NAME,
  askSeparately,
  CARRIED,
  type CopyTarget,
  type CopyTargets,
  copyChoices,
  copyTargetLine,
  draftText,
  extendInterview,
  type Interview,
  interviewProgress,
  type Need,
  type NotesResult,
  neededForLine,
  nextOpen,
  notesChosen,
  notesSummary,
  parseNotes,
  parseReview,
  parseTargets,
  type Review,
  reviewGroups,
  startInterview,
  statusLine,
  stepOpen,
  withConfirmed,
} from "./understanding-chat-model";

type Ids = { organizationId: string; projectId: string; controlId: string };

const SOURCE_WORDS: Record<Need["source"], string> = {
  RCM: "From the RCM",
  PERSON: "Recorded by the team",
  RECORDS: "From the records",
  PRIOR_YEAR: "Last year's workpaper",
  USUAL: "Usual practice",
  AGENT: "Raised by the agents",
  NONE: "",
};

/** The value the "Other (specify)" choice stands for in a point's selection. */
const OTHER = "@other";

/**
 * The control's understanding, reviewed one point at a time (product owner, 9 November 2026:
 * "show the draft, the user updates"; then "does not feel premium", and the mock-up approved
 * the same day). The understanding reads as a document on the left, each answer in place and
 * the point being asked outlined; the right asks one point at a time, last year's answers first
 * as one step. The readiness shown is the gates' own, read again after each save. Answers save
 * through the same routes as the form, so the same validation, approvals and audit apply.
 */
export function UnderstandingReview({
  ids,
  canAct,
  onTalk,
  onProcess,
  documentsHref,
}: {
  ids: Ids;
  canAct: boolean;
  /** Opens the conversation with the planner, for the agents' questions or to talk it
   * through. */
  onTalk: () => void;
  /** Opens the process understanding, for a business process control. */
  onProcess: (() => void) | null;
  /** D&I Evidence: where the governing documents are linked, and the step that follows. */
  documentsHref: string | null;
}) {
  const action = useAction(ids);
  const router = useRouter();
  const [review, setReview] = useState<Review | null>(null);
  const [failed, setFailed] = useState(false);
  const [targets, setTargets] = useState<CopyTargets | null>(null);
  // The other systems the answers are copied to, each chosen on its own.
  const [copyTo, setCopyTo] = useState<Record<string, boolean>>({});
  const [copying, setCopying] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The course through the points, fixed at the first read, and where the person is on it.
  const [interview, setInterview] = useState<Interview | null>(null);
  const [at, setAt] = useState(0);
  // The choice made on each point before it is saved, and the text of "Other (specify)".
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  // Last year's answers unticked on the carried step: asked on their own.
  const [unticked, setUnticked] = useState<Record<string, boolean>>({});
  // On record: an answer being changed in place.
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [recordOpen, setRecordOpen] = useState(false);
  // On a phone the understanding folds above the question.
  const [docOpen, setDocOpen] = useState(false);
  // The gates are read again after a save: their lines show as updating until then.
  const [checking, setChecking] = useState(false);
  // Walkthrough notes: pasted, read by the planner, its answers chosen by the person.
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState("");
  const [readingNotes, setReadingNotes] = useState(false);
  const [found, setFound] = useState<NotesResult | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  // Only the latest read is shown: an earlier one answering late never overwrites it.
  const reads = useRef(0);
  const started = useRef(false);
  const askPane = useRef<HTMLElement>(null);

  const read = useCallback(async () => {
    reads.current += 1;
    const mine = reads.current;
    const query = (intent: string) =>
      `/workspace/understanding-chat?${new URLSearchParams({
        intent,
        organization_id: ids.organizationId,
        project_id: ids.projectId,
        control_id: ids.controlId,
      }).toString()}`;
    try {
      const [first, second] = await Promise.all([
        fetch(query("review")).then(
          (response) => response.json() as Promise<{ body?: unknown }>,
        ),
        fetch(query("targets")).then(
          (response) => response.json() as Promise<{ body?: unknown }>,
        ),
      ]);
      if (mine !== reads.current) {
        return;
      }
      const found = parseReview(first.body ?? null);
      setFailed(found === null);
      if (found !== null) {
        setReview(found);
        setInterview((now) =>
          now === null ? startInterview(found) : extendInterview(found, now),
        );
        // The first read opens on the first point still open.
        if (!started.current) {
          started.current = true;
          setAt(nextOpen(found, startInterview(found), -1));
        }
      }
      setTargets(parseTargets(second.body ?? null));
    } catch {
      if (mine === reads.current) {
        setFailed(true);
      }
    }
  }, [ids]);

  useEffect(() => {
    void read();
  }, [read]);

  /** Moves to a step, and brings the question into view on a phone. */
  function go(step: number) {
    setAt(step);
    setProblem(null);
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 760px)").matches
    ) {
      askPane.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  /** Copies this control's answers to the systems given, where each has no answer. The
   * server decides what each lacks at the moment of the copy, and answers with every
   * system's list as it now stands. True once the server has confirmed it. */
  async function copyOut(systems: readonly CopyTarget[]): Promise<boolean> {
    try {
      const response = await fetch("/workspace/understanding-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: "copy-out",
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          targets: systems.map((item) => item.controlId),
        }),
      });
      const answer = (await response.json()) as {
        status?: unknown;
        body?: unknown;
      };
      if (answer.status !== 200) {
        return false;
      }
      const now = parseTargets(answer.body ?? null);
      if (now !== null) {
        setTargets(now);
      }
      return true;
    } catch {
      return false;
    }
  }

  /** After a save: the answers also go to the systems ticked, where unanswered. */
  async function spread(): Promise<string> {
    const systems = (targets?.targets ?? []).filter(
      (item) => copyTo[item.controlId] === true,
    );
    if (systems.length === 0) {
      return "";
    }
    return (await copyOut(systems))
      ? ` Also filled on ${systems.map((item) => item.system || "another system").join(", ")} where it had no answer.`
      : " It could not be copied to the other systems; try again.";
  }

  /** Ticking a system copies the answers there now, and every later save copies there too;
   * unticking stops the later copies and removes nothing. */
  async function choose(target: CopyTarget, on: boolean) {
    setCopyTo((was) => ({ ...was, [target.controlId]: on }));
    if (!on || target.fills.length === 0 || !canAct) {
      return;
    }
    const name = target.system || "the other system";
    const count = target.fills.length;
    setCopying(target.controlId);
    setSaved(null);
    setProblem(null);
    const ok = await copyOut([target]);
    setCopying(null);
    if (!ok) {
      setCopyTo((was) => ({ ...was, [target.controlId]: false }));
      setProblem(`The answers could not be copied to ${name}. Try again.`);
      return;
    }
    setSaved(
      `${count} ${count === 1 ? "answer" : "answers"} filled on ${name}.`,
    );
    router.refresh();
  }

  /** After a save the server confirmed: the gates and the other systems, read again. */
  async function settle(message: string) {
    const also = await spread();
    setSaving(null);
    setSaved(`${message}${also}`);
    router.refresh();
    setChecking(true);
    await read();
    setChecking(false);
  }

  /** Saves one answer; moves on to the next open point when `move` is set. */
  async function save(need: Need, value: string, move: boolean) {
    const answer = value.trim();
    if (answer === "" || !canAct || review === null || interview === null) {
      return;
    }
    setSaving(need.key);
    setSaved(null);
    setProblem(null);
    const ok =
      need.source === "PRIOR_YEAR" &&
      need.proposalId !== null &&
      answer === need.value
        ? await acceptProposal(ids, need.proposalId)
        : await action.run("values", {
            intent: "values-set",
            values: { [need.key]: answer },
            everywhere: false,
          });
    if (!ok) {
      setSaving(null);
      setProblem(
        `${draftText(need.label, "", true)} could not be saved. Try again.`,
      );
      return;
    }
    // Confirmed by the server: shown as on record now, before the next read arrives.
    const now = withConfirmed(review, { [need.key]: answer });
    setReview(now);
    setEditing((was) => ({ ...was, [need.key]: false }));
    setTyped((was) => ({ ...was, [need.key]: "" }));
    setPicked((was) => {
      const { [need.key]: _gone, ...rest } = was;
      return rest;
    });
    if (move) {
      go(nextOpen(now, interview, at));
    }
    await settle(`${draftText(need.label, "", true)}: saved.`);
  }

  /** The carried step: the ticked answers confirmed together, the rest asked on their own. */
  async function confirmCarried() {
    if (!canAct || review === null || interview === null) {
      return;
    }
    const waiting = interview.carried
      .map((key) => review.needs.find((need) => need.key === key))
      .filter(
        (need): need is Need =>
          need !== undefined && need.status !== "CONFIRMED",
      );
    const ticked = waiting.filter((need) => unticked[need.key] !== true);
    const course = askSeparately(
      interview,
      waiting
        .filter((need) => unticked[need.key] === true)
        .map((need) => need.key),
    );
    setInterview(course);
    if (ticked.length === 0) {
      go(nextOpen(review, course, course.plan.indexOf(CARRIED)));
      return;
    }
    setSaving(CARRIED);
    setSaved(null);
    setProblem(null);
    let now = review;
    let done = 0;
    for (const need of ticked) {
      const ok =
        need.proposalId !== null
          ? await acceptProposal(ids, need.proposalId)
          : await action.run("values", {
              intent: "values-set",
              values: { [need.key]: need.value },
              everywhere: false,
            });
      if (!ok) {
        break;
      }
      done += 1;
      now = withConfirmed(now, { [need.key]: need.value });
      setReview(now);
    }
    if (done < ticked.length) {
      setProblem(
        `${done} of ${ticked.length} were confirmed; the rest could not be saved. Try again.`,
      );
    } else {
      go(nextOpen(now, course, course.plan.indexOf(CARRIED)));
    }
    if (done === 0) {
      setSaving(null);
      return;
    }
    await settle(
      `${done} ${done === 1 ? "answer" : "answers"} from last year confirmed.`,
    );
  }

  async function readNotes() {
    const text = notes.trim();
    if (text.length < 20 || !canAct) {
      setProblem("Paste at least a sentence or two of notes.");
      return;
    }
    setReadingNotes(true);
    setProblem(null);
    setSaved(null);
    setFound(null);
    let status = 0;
    let detail = "";
    let body: unknown = null;
    try {
      const response = await fetch("/workspace/understanding-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: "notes",
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          text,
        }),
      });
      const answer = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
        body?: unknown;
      };
      status = typeof answer.status === "number" ? answer.status : 0;
      detail = typeof answer.detail === "string" ? answer.detail : "";
      body = answer.body ?? null;
    } catch {
      status = 0;
    }
    setReadingNotes(false);
    const result = status === 200 ? parseNotes(body) : null;
    if (result === null) {
      setProblem(
        status === 0
          ? "The notes took too long to read. Try again, or paste a shorter part."
          : detail !== ""
            ? `The notes could not be read: ${detail}.`
            : "The notes could not be read. Try again.",
      );
      return;
    }
    setFound(result);
    setChosen(notesChosen(result.answers));
  }

  function closeNotes() {
    if (saving !== null || readingNotes) {
      return;
    }
    setNotesOpen(false);
    setFound(null);
    setNotes("");
    setProblem(null);
  }

  async function applyNotes() {
    if (found === null || !canAct || review === null || interview === null) {
      return;
    }
    const values = Object.fromEntries(
      found.answers
        .filter((answer) => chosen[answer.key] === true)
        .map((answer) => [answer.key, answer.value]),
    );
    const count = Object.keys(values).length;
    if (count === 0) {
      setFound(null);
      return;
    }
    setSaving("notes");
    setSaved(null);
    setProblem(null);
    // All the chosen answers in one save: one decision, recorded together.
    const ok = await action.run("values", {
      intent: "values-set",
      values,
      everywhere: false,
    });
    if (!ok) {
      setSaving(null);
      setProblem("The answers from the notes could not be saved. Try again.");
      return;
    }
    const now = withConfirmed(review, values);
    setReview(now);
    setFound(null);
    setNotes("");
    setNotesOpen(false);
    // The point being asked may be one the notes answered.
    go(nextOpen(now, interview, at - 1));
    await settle(
      `${count} ${count === 1 ? "answer" : "answers"} from the notes saved.`,
    );
  }

  if (review === null || interview === null) {
    return failed ? (
      <p className="cc-problem" role="alert">
        The understanding could not be loaded.{" "}
        <button type="button" className="cs-link" onClick={() => void read()}>
          Try again
        </button>
      </p>
    ) : (
      <p className="ur-loading" role="status">
        <span className="spinner small" aria-hidden="true" /> Reading the
        understanding…
      </p>
    );
  }

  const groups = reviewGroups(review);
  const byKey = new Map(review.needs.map((need) => [need.key, need]));
  const status = statusLine(review);
  const progress = interviewProgress(review, interview);
  const plan = interview.plan;
  const step = at < plan.length ? (plan[at] ?? null) : null;
  const current = step !== null && step !== CARRIED ? byKey.get(step) : null;
  const onRecord = [...groups.confirmed, ...groups.rcm];
  const copyTargets = copyChoices(targets, copyTo);
  const busy = saving !== null;

  /** Where a slot of the statement leads: its point, last year's step, or the record. */
  function openSlot(key: string) {
    if (byKey.get(key)?.kind === "AUTH" && interview !== null) {
      const known = plan.indexOf(key);
      if (known >= 0) {
        go(known);
        return;
      }
      const course = { ...interview, plan: [...plan, key] };
      setInterview(course);
      go(course.plan.length - 1);
      return;
    }
    const index = plan.indexOf(key);
    if (index >= 0) {
      go(index);
      return;
    }
    if (interview?.carried.includes(key) === true) {
      go(plan.indexOf(CARRIED));
      return;
    }
    setRecordOpen(true);
    setEditing((was) => ({ ...was, [key]: true }));
    setDocOpen(true);
  }

  /** An answer on record changed in place, from the record's fold. */
  const recordEditor = (need: Need) => (
    <div className="ur-answer">
      {need.options.length > 0 ? (
        // biome-ignore lint/a11y/useSemanticElements: a row of answer buttons, not a fieldset
        <div
          className="uc-chips"
          role="group"
          aria-label={`Answers to: ${need.question || need.label}`}
        >
          {need.options.map((option) => (
            <button
              key={option}
              type="button"
              className={`uc-chip${option === need.value ? " is-suggested" : ""}`}
              disabled={!canAct || busy}
              onClick={() => void save(need, option, false)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="uc-compose"
        autoComplete="off"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void save(need, typed[need.key] ?? "", false);
        }}
      >
        <input
          type="text"
          maxLength={300}
          value={typed[need.key] ?? ""}
          disabled={!canAct || busy}
          placeholder="Type the client's answer"
          aria-label={`Answer to: ${need.question || need.label}`}
          onChange={(event) => {
            const value = event.target.value;
            setTyped((was) => ({ ...was, [need.key]: value }));
          }}
        />
        <button
          type="submit"
          className="btn btn-sm"
          disabled={!canAct || busy || (typed[need.key] ?? "").trim() === ""}
        >
          {saving === need.key ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="cs-link"
          onClick={() => setEditing((was) => ({ ...was, [need.key]: false }))}
        >
          Cancel
        </button>
      </form>
    </div>
  );

  /** A system's checkbox: ticking it copies the answers there now. */
  const systemBox = (target: CopyTarget) => (
    <input
      type="checkbox"
      id={`ur-copy-${target.controlId}`}
      checked={copyTo[target.controlId] === true}
      disabled={!canAct || busy || copying !== null}
      aria-busy={copying === target.controlId}
      onChange={(event) => void choose(target, event.target.checked)}
    />
  );

  // The left pane: the understanding as it reads now, what it is ready for, and the scope.
  const documentPane = (
    <>
      <div className="ur-doc-head">
        <p className="ur-label">The understanding</p>
        {review.system !== "" ? (
          <span className="ur-chip">{review.system}</span>
        ) : null}
      </div>
      <p className="ur-statement">
        {review.statement.map((part, index) => {
          const need = part.key === null ? undefined : byKey.get(part.key);
          if (need === undefined) {
            // biome-ignore lint/suspicious/noArrayIndexKey: the statement's parts in order
            return <span key={index}>{part.text}</span>;
          }
          const filled = need.status === "CONFIRMED";
          return (
            // biome-ignore lint/a11y/useSemanticElements: an inline phrase of the sentence that wraps across lines, which a button cannot
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: the statement's parts in order
              key={index}
              role="button"
              tabIndex={0}
              className={`ur-slot ${filled ? "is-filled" : need.status === "PROPOSED" ? "is-proposed" : "is-empty"}${need.key === step ? " is-current" : ""}`}
              title={need.label}
              aria-label={`${need.label}: ${filled ? need.value || part.text : "not confirmed"}`}
              onClick={() => openSlot(need.key)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openSlot(need.key);
                }
              }}
            >
              {filled
                ? part.text
                : draftText(
                    need.label,
                    review.statement[index - 1]?.text ?? "",
                    true,
                  )}
            </span>
          );
        })}
      </p>

      <ul
        className={`ur-ready${checking ? " is-updating" : ""}`}
        aria-busy={checking}
        aria-label="What the understanding is ready for"
      >
        {[
          {
            key: "evidence",
            text: "D&I evidence can be requested",
            gate: review.evidence,
          },
          {
            key: "attributes",
            text: "Attributes can be finalized",
            gate: review.attributes,
          },
        ].map((line) => (
          <li key={line.key} className={line.gate.ready ? "is-ok" : ""}>
            <span className="ur-check" aria-hidden="true">
              {line.gate.ready ? <UiIcon name="check" size={12} /> : null}
            </span>
            <span>{line.text}</span>
            <small>
              {checking
                ? "Updating…"
                : line.gate.ready
                  ? "Ready"
                  : line.gate.missing.length > 0
                    ? `${line.gate.missing.length} left`
                    : "Not yet"}
            </small>
          </li>
        ))}
      </ul>

      {copyTargets.length === 1 && copyTargets[0] !== undefined ? (
        <label
          className="ur-systems"
          htmlFor={`ur-copy-${copyTargets[0].controlId}`}
        >
          {systemBox(copyTargets[0])}
          <span>
            <strong>
              Use these answers on {copyTargets[0].system || "the other system"}{" "}
              too
            </strong>
            <span>
              {copying === copyTargets[0].controlId
                ? "Copying…"
                : `${copyTargetLine(copyTargets[0], copyTo[copyTargets[0].controlId])} Nothing is overwritten.`}
            </span>
          </span>
        </label>
      ) : copyTargets.length > 1 ? (
        <fieldset className="ur-systems is-many">
          <legend>
            <strong>Use these answers on other systems too</strong>
            <span>
              Choose each system. Only the answers it does not have are filled;
              nothing is overwritten.
            </span>
          </legend>
          <ul>
            {copyTargets.map((target) => (
              <li key={target.controlId}>
                <label htmlFor={`ur-copy-${target.controlId}`}>
                  {systemBox(target)}
                  <span>
                    <strong>{target.system || "Another system"}</strong>
                    <span>
                      {copying === target.controlId
                        ? "Copying…"
                        : copyTargetLine(target, copyTo[target.controlId])}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      {onRecord.length > 0 ? (
        <details
          className="ur-record"
          open={recordOpen}
          onToggle={(event) => setRecordOpen(event.currentTarget.open)}
        >
          <summary>
            On record <span className="ur-count">{onRecord.length}</span>
            <UiIcon name="chevron" size={14} />
          </summary>
          <ul>
            {onRecord.map((need) => (
              <li key={need.key}>
                <span className="ur-record-q">{need.label}</span>
                {editing[need.key] === true && need.kind === "ANSWER" ? (
                  recordEditor(need)
                ) : (
                  <span className="ur-record-a">
                    <strong>{need.value || "Not given"}</strong>
                    {SOURCE_WORDS[need.source] !== "" ? (
                      <small>{SOURCE_WORDS[need.source]}</small>
                    ) : null}
                    {canAct && need.kind === "ANSWER" ? (
                      <button
                        type="button"
                        className="cs-link"
                        onClick={() =>
                          setEditing((was) => ({ ...was, [need.key]: true }))
                        }
                      >
                        Change
                      </button>
                    ) : canAct && need.kind === "AUTH" ? (
                      <button
                        type="button"
                        className="cs-link"
                        onClick={() => openSlot(need.key)}
                      >
                        Change
                      </button>
                    ) : null}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );

  /** The foot of a step: where it stands, and Back with the step's own action. */
  const foot = (primary: ReactNode, skip: boolean) => (
    <div className="ur-foot">
      <p className="ur-foot-where">
        {plan.length > 1 ? `Point ${at + 1} of ${plan.length}` : null}
        {skip ? (
          <button
            type="button"
            className="ur-skip"
            disabled={busy}
            onClick={() => go(nextOpen(review, interview, at))}
          >
            Skip for now
          </button>
        ) : null}
      </p>
      <div className="ur-foot-actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || at === 0}
          onClick={() => go(Math.max(0, at - 1))}
        >
          <UiIcon name="back" size={14} /> Back
        </button>
        {primary}
      </div>
    </div>
  );

  const carriedStep = () => {
    const items = interview.carried
      .map((key) => byKey.get(key))
      .filter((need): need is Need => need !== undefined);
    const waiting = items.filter((need) => need.status !== "CONFIRMED");
    const ticked = waiting.filter((need) => unticked[need.key] !== true);
    return (
      <>
        <div className="ur-kicker">
          <span className="ur-chip is-accent">From last year's workpaper</span>
        </div>
        <h3 className="ur-q" id="ur-q">
          Confirm last year's answers
        </h3>
        <p className="ur-hint">
          {waiting.length === 0
            ? "Last year's answers are confirmed."
            : `${waiting.length} ${waiting.length === 1 ? "answer was" : "answers were"} given by the client last year. Untick any that changed; it is asked on its own.`}
        </p>
        <ul className="ur-carried">
          {items.map((need) => {
            const done = need.status === "CONFIRMED";
            return (
              <li key={need.key} className={done ? "is-done" : ""}>
                {done ? (
                  <span className="ur-check is-ok" aria-hidden="true">
                    <UiIcon name="check" size={12} />
                  </span>
                ) : (
                  <input
                    type="checkbox"
                    checked={unticked[need.key] !== true}
                    disabled={!canAct || busy}
                    aria-label={`Confirm: ${need.question || need.label}`}
                    onChange={(event) => {
                      const on = event.target.checked;
                      setUnticked((was) => ({ ...was, [need.key]: !on }));
                    }}
                  />
                )}
                <span className="ur-carried-text">
                  <span className="ur-carried-q">
                    {need.question || need.label}
                  </span>
                  <strong>{need.value}</strong>
                </span>
                {done ? <small>Confirmed</small> : null}
              </li>
            );
          })}
        </ul>
        {foot(
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canAct || busy}
            onClick={() =>
              waiting.length === 0
                ? go(nextOpen(review, interview, at))
                : void confirmCarried()
            }
          >
            {saving === CARRIED ? (
              <span className="spinner small" aria-hidden="true" />
            ) : null}
            {saving === CARRIED
              ? "Confirming…"
              : ticked.length > 0
                ? `Confirm ${ticked.length} and continue`
                : "Continue"}
            <UiIcon name="arrow" size={14} />
          </button>,
          false,
        )}
      </>
    );
  };

  const pointStep = (need: Need) => {
    const onFile = need.status === "CONFIRMED";
    const preset = need.value !== "" ? need.value : "";
    const choice =
      picked[need.key] ??
      (preset !== "" &&
      need.options.length > 0 &&
      !need.options.includes(preset)
        ? OTHER
        : preset);
    const other = choice === OTHER || need.options.length === 0;
    const text =
      typed[need.key] ??
      (choice === OTHER && !need.options.includes(preset) ? preset : "");
    const answer = other ? text.trim() : choice;
    const unchanged = onFile && answer === need.value;
    const forLine = neededForLine(need);
    const chips = (
      <div className="ur-kicker">
        {need.kind === "QUESTION" ? (
          <span className="ur-chip is-accent">Raised by the agents</span>
        ) : null}
        {need.source === "USUAL" && !onFile ? (
          <span className="ur-chip is-warm">Usual practice</span>
        ) : null}
        {need.source === "PRIOR_YEAR" && !onFile ? (
          <span className="ur-chip is-accent">Last year</span>
        ) : null}
        {onFile ? <span className="ur-chip is-ok">On record</span> : null}
        {!need.required ? <span className="ur-chip">Optional</span> : null}
        {forLine !== "" ? <span className="ur-chip">{forLine}</span> : null}
      </div>
    );
    const why =
      need.why !== "" ? (
        <details className="ur-why">
          <summary>Why this is asked</summary>
          <p>{need.why}</p>
        </details>
      ) : null;
    const title = (
      <h3 className="ur-q" id="ur-q">
        {need.question || need.label}
      </h3>
    );

    if (need.kind === "AUTH") {
      // The sign-in settings, one at a time, by how users sign in (10 November 2026).
      return (
        <AuthenticationPoint
          key={need.key}
          ids={ids}
          canAct={canAct}
          onChanged={async () => {
            router.refresh();
            setChecking(true);
            await read();
            setChecking(false);
          }}
          onDone={() => go(nextOpen(review, interview, at))}
          onBack={() => go(Math.max(0, at - 1))}
        />
      );
    }
    if (need.kind !== "ANSWER") {
      const lead =
        need.kind === "QUESTION"
          ? "The planner asks it as a short interview, with a proposed answer to confirm."
          : need.kind === "PROCESS"
            ? "The process understanding is confirmed in its own screen: the steps, the hand-offs and where this control sits."
            : "Optional. The governing policy is linked as a D&I evidence item.";
      const act =
        need.kind === "QUESTION" ? (
          <button type="button" className="btn btn-primary" onClick={onTalk}>
            Answer with the planner <UiIcon name="arrow" size={14} />
          </button>
        ) : need.kind === "PROCESS" && onProcess !== null ? (
          <button type="button" className="btn btn-primary" onClick={onProcess}>
            Confirm the process <UiIcon name="arrow" size={14} />
          </button>
        ) : need.kind === "DOCUMENT" && documentsHref !== null ? (
          <a className="btn btn-primary" href={documentsHref}>
            Link it in D&amp;I Evidence <UiIcon name="arrow" size={14} />
          </a>
        ) : null;
      return (
        <>
          {chips}
          {title}
          <p className="ur-hint">{lead}</p>
          {why}
          {foot(act, true)}
        </>
      );
    }

    const hint = onFile
      ? "On record. Change it, or continue."
      : need.source === "USUAL"
        ? "Selected from usual practice. Confirm it holds for this client, or choose another."
        : need.source === "PRIOR_YEAR"
          ? "Last year's answer is selected. Confirm it still holds."
          : need.status === "PROPOSED"
            ? "A proposed answer is selected. Confirm it, or choose another."
            : "";
    const tagFor = (option: string) =>
      option !== need.value || onFile
        ? ""
        : need.source === "USUAL"
          ? "Usual"
          : need.source === "PRIOR_YEAR"
            ? "Last year"
            : need.status === "PROPOSED"
              ? "Proposed"
              : "";
    const name = `ur-${need.key}`;
    return (
      <form
        className="ur-point"
        autoComplete="off"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          if (unchanged) {
            go(nextOpen(review, interview, at));
            return;
          }
          void save(need, answer, true);
        }}
      >
        {chips}
        {title}
        {hint !== "" ? <p className="ur-hint">{hint}</p> : null}
        {need.options.length > 0 ? (
          <fieldset className="ur-options" aria-labelledby="ur-q">
            {[...need.options, OTHER].map((option) => {
              const on = choice === option;
              const tag = option === OTHER ? "" : tagFor(option);
              return (
                <label
                  key={option}
                  className={`ur-option${on ? " is-on" : ""}${option === OTHER ? " is-other" : ""}`}
                >
                  <input
                    type="radio"
                    name={name}
                    value={option}
                    checked={on}
                    disabled={!canAct || busy}
                    onChange={() =>
                      setPicked((was) => ({ ...was, [need.key]: option }))
                    }
                  />
                  <span className="ur-dot" aria-hidden="true" />
                  <span className="ur-option-text">
                    {option === OTHER ? "Other (specify)" : option}
                  </span>
                  {tag !== "" ? <span className="ur-tag">{tag}</span> : null}
                </label>
              );
            })}
          </fieldset>
        ) : null}
        {other ? (
          <input
            className="ur-other"
            type="text"
            maxLength={300}
            value={text}
            disabled={!canAct || busy}
            placeholder="Type the client's answer"
            aria-label={`Answer to: ${need.question || need.label}`}
            onChange={(event) => {
              const value = event.target.value;
              setTyped((was) => ({ ...was, [need.key]: value }));
            }}
          />
        ) : null}
        {why}
        {foot(
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canAct || busy || answer === ""}
          >
            {saving === need.key ? (
              <span className="spinner small" aria-hidden="true" />
            ) : null}
            {saving === need.key
              ? "Saving…"
              : unchanged
                ? "Continue"
                : "Save & continue"}
            <UiIcon name="arrow" size={14} />
          </button>,
          !onFile,
        )}
      </form>
    );
  };

  const openSteps = plan
    .map((key, index) => ({ key, index }))
    .filter((item) => stepOpen(review, interview, item.key));
  const endStep = () =>
    status.done ? (
      <div className="ur-end">
        <span className="ur-seal" aria-hidden="true">
          <UiIcon name="check" size={22} />
        </span>
        <h3 className="ur-q">{review.controlRef} is understood</h3>
        <p className="ur-hint">{status.text}</p>
        {groups.confirmed.some((need) => need.kind === "ANSWER") ? (
          <dl className="ur-answers">
            {groups.confirmed
              .filter((need) => need.kind === "ANSWER")
              .map((need) => (
                <div key={need.key}>
                  <dt>{need.label}</dt>
                  <dd>{need.value}</dd>
                </div>
              ))}
          </dl>
        ) : null}
        <div className="ur-foot-actions">
          {plan.length > 0 ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => go(Math.max(0, plan.length - 1))}
            >
              <UiIcon name="back" size={14} /> Back
            </button>
          ) : null}
          {documentsHref !== null ? (
            <a className="btn btn-primary" href={documentsHref}>
              Continue to D&amp;I evidence <UiIcon name="arrow" size={14} />
            </a>
          ) : null}
        </div>
      </div>
    ) : (
      <div className="ur-end">
        <h3 className="ur-q">
          {openSteps.length === 0
            ? "Waiting for the understanding to be read again"
            : `${openSteps.length} ${openSteps.length === 1 ? "point is" : "points are"} still open`}
        </h3>
        <p className="ur-hint">{status.text}</p>
        {openSteps.length > 0 ? (
          <ul className="ur-left">
            {openSteps.map((item) => {
              const need = byKey.get(item.key);
              return (
                <li key={item.key}>
                  <span>
                    {item.key === CARRIED
                      ? "Last year's answers"
                      : need?.question || need?.label || item.key}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => go(item.index)}
                  >
                    Answer
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    );

  // The drawer around the review already names the step and its number.
  const eyebrow = AGENT_NAME;

  return (
    <section className="ur" aria-labelledby="ur-title">
      <header className="ur-head">
        <span className="ur-tile" aria-hidden="true">
          <AgentAvatar
            size={30}
            state={checking || busy ? "working" : "idle"}
          />
        </span>
        <div className="ur-head-text">
          <p className="ur-eyebrow">{eyebrow}</p>
          <h2 id="ur-title">
            {status.done
              ? `${review.controlRef} is understood`
              : `Confirm how ${review.controlRef} runs`}
          </h2>
          <p className="ur-lede">
            {status.done
              ? "Every point the evidence and the attributes rely on is on record."
              : `Drafted from the RCM${groups.lastYear.length > 0 || interview.carried.length > 0 ? " and last year's workpaper" : ""}. Confirm it, so the D&I evidence can be requested and the attributes finalized.`}
          </p>
        </div>
        <div className="ur-head-tools">
          <button
            type="button"
            className="btn btn-quiet"
            disabled={!canAct}
            onClick={() => setNotesOpen(true)}
          >
            <UiIcon name="file" size={15} /> Paste walkthrough notes
          </button>
          <button type="button" className="btn btn-quiet" onClick={onTalk}>
            <UiIcon name="message" size={15} /> Ask the planner
          </button>
          {onProcess !== null ? (
            <button type="button" className="btn btn-quiet" onClick={onProcess}>
              <UiIcon name="layers" size={15} /> Process
            </button>
          ) : null}
        </div>
        {progress.total > 0 ? (
          <div className="ur-progress">
            <div className="ur-segments" aria-hidden="true">
              {progress.marks.map((done, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: one segment per counted point, in order
                  key={index}
                  className={done ? "is-done" : ""}
                />
              ))}
            </div>
            <span className="ur-progress-label">
              {progress.done} of {progress.total} confirmed
            </span>
          </div>
        ) : null}
      </header>

      <div className="ur-body">
        <button
          type="button"
          className="ur-fold"
          aria-expanded={docOpen}
          aria-controls="ur-doc"
          onClick={() => setDocOpen((was) => !was)}
        >
          <span className="ur-label">The understanding</span>
          <span className="ur-chip">
            {progress.total > 0
              ? `${progress.done} of ${progress.total}`
              : status.done
                ? "Confirmed"
                : "Draft"}
          </span>
          <UiIcon name="chevron" size={16} />
        </button>
        <aside
          className={`ur-doc${docOpen ? " is-open" : ""}`}
          id="ur-doc"
          aria-label="The understanding"
        >
          {documentPane}
        </aside>

        <section
          className="ur-ask"
          id="ur-ask"
          ref={askPane}
          aria-labelledby={step === null ? undefined : "ur-q"}
        >
          {saved !== null ? (
            <p className="ur-saved" role="status">
              <UiIcon name="check" size={13} /> {saved}
            </p>
          ) : null}
          {problem !== null && !notesOpen ? (
            <p className="cc-problem" role="alert">
              {problem}
            </p>
          ) : null}
          <div className="ur-step" key={step ?? "end"}>
            {step === CARRIED
              ? carriedStep()
              : current !== null && current !== undefined
                ? pointStep(current)
                : endStep()}
          </div>
        </section>
      </div>

      {notesOpen ? (
        <RecordDialog
          icon={
            <AgentAvatar size={26} state={readingNotes ? "thinking" : "idle"} />
          }
          eyebrow={AGENT_NAME}
          title="Fill from walkthrough notes"
          description="Paste notes or a client's email. The planner proposes answers, each with the words it rests on. Nothing is saved until you choose."
          closeHref=""
          className="ur-notes-dialog"
          onClose={closeNotes}
        >
          <div className="ur-notes">
            {problem !== null ? (
              <p className="cc-problem" role="alert">
                {problem}
              </p>
            ) : null}
            {found === null ? (
              <form
                className="ur-notes-form"
                autoComplete="off"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  void readNotes();
                }}
              >
                <textarea
                  value={notes}
                  rows={8}
                  maxLength={20000}
                  disabled={readingNotes}
                  placeholder="Paste walkthrough notes or a client's email about this control"
                  aria-label="Walkthrough notes"
                  onChange={(event) => setNotes(event.target.value)}
                />
                <div className="ur-notes-foot">
                  {readingNotes ? (
                    <span className="ur-reading" role="status">
                      <span className="spinner small" aria-hidden="true" />{" "}
                      Reading the notes…
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={readingNotes}
                    onClick={closeNotes}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={readingNotes || notes.trim().length < 20}
                  >
                    Read the notes
                  </button>
                </div>
              </form>
            ) : (
              <div className="ur-found">
                <p className="ur-hint" role="status">
                  {notesSummary(found)}
                </p>
                {found.answers.length > 0 ? (
                  <ul className="ur-proposals">
                    {found.answers.map((answer) => (
                      <li key={answer.key}>
                        <input
                          type="checkbox"
                          id={`ur-note-${answer.key}`}
                          checked={chosen[answer.key] === true}
                          disabled={busy}
                          onChange={(event) => {
                            const on = event.target.checked;
                            setChosen((was) => ({ ...was, [answer.key]: on }));
                          }}
                        />
                        <label htmlFor={`ur-note-${answer.key}`}>
                          <span className="ur-proposal-q">
                            {answer.question}
                          </span>
                          <strong>{answer.value}</strong>
                          {answer.current !== "" ? (
                            <small>Replaces: {answer.current}</small>
                          ) : null}
                        </label>
                        <blockquote>{answer.quote}</blockquote>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="ur-notes-foot">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy}
                    onClick={() => setFound(null)}
                  >
                    {found.answers.length > 0
                      ? "Back to the notes"
                      : "Try other notes"}
                  </button>
                  {found.answers.length > 0 ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={
                        !canAct ||
                        busy ||
                        !found.answers.some((a) => chosen[a.key] === true)
                      }
                      onClick={() => void applyNotes()}
                    >
                      {saving === "notes" ? (
                        <span className="spinner small" aria-hidden="true" />
                      ) : null}
                      {saving === "notes"
                        ? "Saving…"
                        : `Use ${found.answers.filter((a) => chosen[a.key] === true).length} selected`}
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </RecordDialog>
      ) : null}
    </section>
  );
}
