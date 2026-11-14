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
import { AgentQuestionPoint } from "./agent-question-point";
import { AuthenticationPoint } from "./authentication-point";
import { useAction } from "./control-context-view";
import {
  agentQuestions,
  confirmPlan,
  NO_DOCUMENT,
  type Prefill,
  type RowPicks,
  type SetupIssue,
} from "./control-setup-model";
import { RecordDialog } from "./record-dialog";
import { acceptProposal } from "./references-view";
import { UiIcon } from "./ui-icon";
import {
  AGENT_NAME,
  ANSWER_MAX,
  afterTopicSave,
  answerDisplay,
  askSeparately,
  CARRIED,
  type CopyTarget,
  type CopyTargets,
  carriedCopy,
  carriedSource,
  confirmsByProposal,
  copyChoices,
  copyTargetLine,
  draftedFrom,
  draftText,
  drivesLine,
  extendInterview,
  followUpShown,
  type Interview,
  ignoredNote,
  interviewProgress,
  type MultiplePick,
  multipleAnswer,
  multipleProblem,
  multipleStart,
  type Need,
  type NotesResult,
  neededForLine,
  nextAfterUnderstanding,
  nextOpen,
  notesChosen,
  runFailureLine as notesFailureLine,
  notesSummary,
  OTHER_MAX,
  OTHER_RULE,
  otherSystemLabel,
  otherText,
  parseNotes,
  parseReview,
  parseTargets,
  pickProblem,
  proposalMark,
  proposedPick,
  type Review,
  readyLines,
  restartInterview,
  reviewGroups,
  START_NONE,
  sameSystemLabel,
  startFromBanner,
  startFromField,
  startInterview,
  statusLine,
  stepRequired,
  stepTopic,
  toggleMultiple,
  topicAsks,
  topicBlocked,
  topicDone,
  topicHint,
  topicLeft,
  topicName,
  topicQuestions,
  topicSave,
  topicShown,
  topicStep,
  WALKTHROUGH_TEXT_MAX,
  type WalkthroughAnswer,
  type WalkthroughTopic,
  walkthroughOutcome,
  walkthroughRecord,
  withConfirmed,
  withOther,
} from "./understanding-chat-model";

type Ids = { organizationId: string; projectId: string; controlId: string };

const SOURCE_WORDS: Record<Need["source"], string> = {
  RCM: "From the RCM",
  PERSON: "Recorded by the team",
  RECORDS: "From the records",
  PRIOR_YEAR: "Last year's workpaper",
  SYSTEM: "Used on this system",
  OTHER_SYSTEM: "From the same control on another system",
  USUAL: "Usual practice",
  AGENT: "Raised by the agents",
  NONE: "",
};

/** The saving mark while the review is read again from another system's answers. */
const STARTING = "@start";

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
  attributesHref = null,
  issues = [],
}: {
  ids: Ids;
  canAct: boolean;
  /** The control's issues: an open question of the agents is answered in place, from its
   * own choices (12 November 2026). */
  issues?: readonly SetupIssue[];
  /** Opens the conversation with the planner, for the agents' questions or to talk it
   * through. */
  onTalk: () => void;
  /** Opens the process understanding, for a business process control. */
  onProcess: (() => void) | null;
  /** D&I Evidence: where the governing documents are linked, and the step that follows
   * once the attributes are settled. */
  documentsHref: string | null;
  /** The Attributes step, where the attributes are decided: the step that follows the
   * understanding until they are settled (11 November 2026). */
  attributesHref?: string | null;
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
  // The course and the step as the latest read and move left them, for the reads and saves
  // that finish after a render.
  const courseRef = useRef<Interview | null>(null);
  const atRef = useRef(0);
  // The walkthrough (11 November 2026): what the person chose on each question before it is
  // saved, the answers on record reopened to change, and the reasons and sources opened.
  const [wtPicks, setWtPicks] = useState<Record<string, string[]>>({});
  const [wtReopened, setWtReopened] = useState<Record<string, boolean>>({});
  const [wtShown, setWtShown] = useState<Record<string, boolean>>({});
  // The words typed for each question's "Other" answer, kept while Other is unticked so
  // ticking it again brings them back (11 November 2026).
  const [wtOther, setWtOther] = useState<Record<string, string>>({});
  // The choice made on each point before it is saved, and the text of "Other (specify)".
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  // A point that takes more than one answer (12 November 2026): what is chosen there before
  // it is saved; its Other words are also kept in `typed`, so unticking Other and ticking it
  // again brings them back.
  const [multiPicked, setMultiPicked] = useState<Record<string, MultiplePick>>(
    {},
  );
  // Known answers (last year's, this system's) unticked on the carried step: asked on
  // their own.
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
  // Which other system's answers the review starts from (11 November 2026): the person's
  // choice for this control, sent with every read of it; none made means the server's
  // default. Kept with the control it was made on, so another control starts afresh. While
  // the new read is on its way, the choice shows as made; once it lands, the course is set
  // afresh from its proposals (`restart`).
  const startRef = useRef<{ control: string; from: string } | null>(null);
  const [startPending, setStartPending] = useState<string | null>(null);
  const restart = useRef(false);

  const read = useCallback(async (): Promise<Review | null> => {
    reads.current += 1;
    const mine = reads.current;
    const query = (intent: string) =>
      `/workspace/understanding-chat?${new URLSearchParams({
        intent,
        organization_id: ids.organizationId,
        project_id: ids.projectId,
        control_id: ids.controlId,
        ...(intent === "review"
          ? startFromField(startRef.current, ids.controlId)
          : {}),
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
        return null;
      }
      const found = parseReview(first.body ?? null);
      setFailed(found === null);
      if (found !== null) {
        setReview(found);
        const now = courseRef.current;
        if (restart.current && now !== null) {
          // Another system's answers to start from: its proposals set the course afresh.
          restart.current = false;
          const next = restartInterview(found, now, atRef.current);
          courseRef.current = next.interview;
          setInterview(next.interview);
          atRef.current = next.at;
          setAt(next.at);
          setUnticked({});
        } else {
          // A follow-up the answers raised takes its place after the step the person is on.
          const course =
            now === null
              ? startInterview(found)
              : extendInterview(found, now, atRef.current);
          courseRef.current = course;
          setInterview(course);
        }
        // The first read opens on the first point still open.
        if (!started.current && courseRef.current !== null) {
          started.current = true;
          const first = nextOpen(found, courseRef.current, -1);
          atRef.current = first;
          setAt(first);
        }
      }
      setTargets(parseTargets(second.body ?? null));
      return found;
    } catch {
      if (mine === reads.current) {
        setFailed(true);
      }
      return null;
    }
  }, [ids]);

  /** The course changed here: kept for the reads that finish later too. */
  function setCourse(course: Interview) {
    courseRef.current = course;
    setInterview(course);
  }

  useEffect(() => {
    void read();
  }, [read]);

  /** Starts from another system's answers, or none ("none"): the review is read again with
   * them proposed. Nothing is written; each proposal is confirmed or changed as before. When
   * the read fails, the choice goes back to what the review shows. */
  async function startFrom(from: string) {
    if (saving !== null) {
      return;
    }
    const before = startRef.current;
    startRef.current = { control: ids.controlId, from };
    restart.current = true;
    setStartPending(from);
    setSaving(STARTING);
    setSaved(null);
    setProblem(null);
    // The read about to start; a newer one landing first carries the same choice.
    const mine = reads.current + 1;
    const found = await read();
    if (found === null && reads.current === mine) {
      startRef.current = before;
      restart.current = false;
      setProblem(
        "The answers could not be read again from that system. Try again.",
      );
    }
    setStartPending(null);
    setSaving(null);
  }

  /** Moves to a step, and brings the question into view on a phone. */
  function go(step: number) {
    atRef.current = step;
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

  /**
   * Which policy governs the control: optional, since many organizations have none (product owner,
   * 13 November 2026: "Policy should always be optional ... Just an option here that policy
   * is not available instead of linking. ... if yes, ask it to add the name of the policy").
   * No formal policy is an answer on the record (it reads as established practice;
   * the product never says "the client", since internal audit uses it for its own organization); a policy is recorded by its name, and the person adds it to the D&I evidence
   * requests and uploads it there.
   */
  function policyPoint(
    need: Need,
    chips: ReactNode,
    title: ReactNode,
    why: ReactNode,
  ) {
    const current = need.value.trim();
    const onRecord = need.status === "CONFIRMED" && current !== "";
    const choice =
      picked[need.key] ??
      (current === NO_DOCUMENT ? "NONE" : current !== "" ? "NAMED" : "");
    const name = typed[need.key] ?? (current !== NO_DOCUMENT ? current : "");
    const answer =
      choice === "NONE" ? NO_DOCUMENT : choice === "NAMED" ? name.trim() : "";
    const unchanged = onRecord && answer === current;
    const radio = `ur-${need.key}`;
    return (
      <form
        className="ur-point"
        autoComplete="off"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          if (unchanged) {
            if (review !== null && interview !== null) {
              go(nextOpen(review, interview, at));
            }
            return;
          }
          void save(need, answer, true);
        }}
      >
        {chips}
        {title}
        <p className="ur-hint" id="ur-hint">
          A formal policy is not required, and many organizations have none.
          Choose No formal policy, and the control reads as established
          practice.
          {need.source === "SYSTEM" || need.source === "OTHER_SYSTEM"
            ? ` "${current}" is used for ${need.source === "SYSTEM" ? "this system's other controls" : "the same control on another system"}; confirm it or choose another answer.`
            : ""}
        </p>
        <fieldset
          className="ur-options"
          aria-labelledby="ur-q"
          aria-describedby="ur-hint"
        >
          <label className={`ur-option${choice === "NAMED" ? " is-on" : ""}`}>
            <input
              type="radio"
              name={radio}
              value="NAMED"
              checked={choice === "NAMED"}
              disabled={!canAct || busy}
              onChange={() =>
                setPicked((was) => ({ ...was, [need.key]: "NAMED" }))
              }
            />
            <span className="ur-dot" aria-hidden="true" />
            <span className="ur-option-text">There is a policy</span>
          </label>
          <label className={`ur-option${choice === "NONE" ? " is-on" : ""}`}>
            <input
              type="radio"
              name={radio}
              value="NONE"
              checked={choice === "NONE"}
              disabled={!canAct || busy}
              onChange={() =>
                setPicked((was) => ({ ...was, [need.key]: "NONE" }))
              }
            />
            <span className="ur-dot" aria-hidden="true" />
            <span className="ur-option-text">No formal policy</span>
          </label>
        </fieldset>
        {choice === "NAMED" ? (
          <>
            <input
              className="ur-other"
              type="text"
              maxLength={300}
              value={name}
              disabled={!canAct || busy}
              placeholder="The policy's name, as it is titled"
              aria-label="The policy's name"
              onChange={(event) => {
                const value = event.target.value;
                setTyped((was) => ({ ...was, [need.key]: value }));
              }}
            />
            <p className="ur-hint">
              The control&apos;s wording names it. Add it to the D&amp;I
              evidence requests and upload it there when you have it.
              {documentsHref !== null ? (
                <>
                  {" "}
                  <a className="text-link" href={documentsHref}>
                    Open D&amp;I Evidence
                  </a>
                </>
              ) : null}
            </p>
          </>
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
          true,
        )}
      </form>
    );
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
    setMultiPicked((was) => {
      const { [need.key]: _gone, ...rest } = was;
      return rest;
    });
    if (move) {
      go(nextOpen(now, interview, at));
    }
    await settle(`${draftText(need.label, "", true)}: saved.`);
  }

  /**
   * Records the answer to a question the agents raised, given in place on its card: through
   * the narrative's points when it is one, else as the issue's own resolution, exactly as the
   * planner's conversation records it (control-setup confirm), so the audit is the same.
   */
  async function answerQuestion(need: Need, row: Prefill, picks: RowPicks) {
    if (!canAct || review === null || interview === null) {
      return;
    }
    const plan = confirmPlan([row], {
      picks: { [row.key]: picks },
      dismissed: [],
    });
    const answer = plan.settled[row.key] ?? "";
    if (answer === "") {
      return;
    }
    setSaving(need.key);
    setSaved(null);
    setProblem(null);
    let ok = true;
    if (plan.points.length > 0) {
      ok = await action.run("values", {
        intent: "process-points",
        items: plan.points,
      });
    }
    for (const item of plan.resolved) {
      if (!ok) {
        break;
      }
      ok = await action.run("values", {
        intent: "issue-resolve",
        issue_id: item.issueId,
        status: "RESOLVED",
        note: item.note,
        version: item.version,
      });
    }
    if (!ok) {
      setSaving(null);
      setProblem(
        "The answer could not be saved. The question may have changed: refresh the page and try again.",
      );
      return;
    }
    // Confirmed by the server: the narrative is drafted again from the answers in the
    // background, as after the conversation.
    void action.run("narrate", { intent: "process-narrate" });
    const now = withConfirmed(review, { [need.key]: answer });
    setReview(now);
    go(nextOpen(now, interview, at));
    await settle(`${need.label || "The question"}: answered.`);
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
    setCourse(course);
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
        confirmsByProposal(need) && need.proposalId !== null
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
    await settle(carriedCopy(course, 0).confirmed(done));
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
    // The planner stores its walkthrough proposals on the server: read the review again so
    // they show pre-selected in their topics.
    if ((result.walkthroughProposed ?? 0) > 0) {
      void read();
    }
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

  /** Sends walkthrough answers in one save; the server's answer, read. */
  async function putWalkthrough(
    answers: Record<string, WalkthroughAnswer>,
  ): Promise<{
    status: number;
    outcome: ReturnType<typeof walkthroughOutcome>;
  }> {
    let status = 0;
    let detail = "";
    let body: unknown = null;
    try {
      const response = await fetch("/workspace/understanding-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent: "walkthrough-answers",
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          answers,
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
    return { status, outcome: walkthroughOutcome(status, detail, body) };
  }

  /** Forgets the choices and reopened answers of the questions given. */
  function clearWalkthrough(keys: readonly string[]) {
    const drop = <T,>(was: Record<string, T>) =>
      Object.fromEntries(
        Object.entries(was).filter(([key]) => !keys.includes(key)),
      );
    setWtPicks(drop);
    setWtReopened(drop);
    setWtOther(drop);
  }

  /** "Save and continue" on a topic: every answered question shown in one save (a follow-up
   * its parent's pick no longer opens is left out). Success is shown once the server confirms
   * it; the review is then read again, and the person stays on the step when a required
   * question is still open there (a follow-up the answers raised). */
  async function saveTopic(topic: WalkthroughTopic, asked: readonly Need[]) {
    if (!canAct || review === null || interview === null) {
      return;
    }
    const shown = topicShown(asked, wtPicks, review.needs).map(
      (need) => need.key,
    );
    // Leaving the step forgets every choice made on it, a hidden follow-up's too.
    const all = asked.map((need) => need.key);
    const blocked = topicBlocked(asked, wtPicks, review.needs);
    if (blocked !== null) {
      // An Other answer that cannot be saved: say why beside it, and send nothing.
      setWtShown((was) => ({ ...was, [`${blocked.key}:tried`]: true }));
      return;
    }
    const answers = topicSave(asked, wtPicks, review.needs);
    const count = Object.keys(answers).length;
    if (count === 0) {
      if (topicDone(review, topic)) {
        clearWalkthrough(all);
        go(nextOpen(review, interview, at));
      }
      return;
    }
    const label = asked[0]?.walkthrough?.topicLabel ?? topicName(review, topic);
    setSaving(topicStep(topic));
    setSaved(null);
    setProblem(null);
    const { status, outcome } = await putWalkthrough(answers);
    if ("problem" in outcome) {
      setSaving(null);
      setProblem(outcome.problem);
      if (status === 409) {
        // The understanding changed meanwhile: read it again, keeping what was chosen.
        setChecking(true);
        await read();
        setChecking(false);
      }
      return;
    }
    const values = Object.fromEntries(
      Object.entries(answers).map(([key, answer]) => [key, answer.value]),
    );
    // Confirmed by the server: shown as on record now, before the next read arrives. Applied
    // to the review as it now stands, so a read that landed meanwhile is never undone; the
    // narrative stays marked as updating until the read below replaces it.
    setReview((was) => (was === null ? was : withConfirmed(was, values)));
    clearWalkthrough(Object.keys(answers));
    const also = await spread();
    const saved = outcome.saved > 0 ? outcome.saved : count;
    // A follow-up the server left out (its parent answered here no longer opens it) is part of
    // a successful save: noted quietly, never as a problem.
    const message = `${label}: ${saved} ${saved === 1 ? "answer" : "answers"} saved.${ignoredNote(outcome.ignored)}${also}`;
    setSaved(message);
    router.refresh();
    setChecking(true);
    const fresh = await read();
    setChecking(false);
    setSaving(null);
    if (fresh === null) {
      return;
    }
    const next = afterTopicSave(shown, fresh, topic);
    if (next.stay) {
      setSaved(`${message} ${next.note}`);
      return;
    }
    clearWalkthrough(all);
    go(nextOpen(fresh, courseRef.current ?? interview, atRef.current));
  }

  /** "Mark not applicable" on an optional question: saved on its own at once. */
  async function notApplicable(need: Need) {
    if (!canAct || review === null || need.required) {
      return;
    }
    setSaving(need.key);
    setSaved(null);
    setProblem(null);
    const { status, outcome } = await putWalkthrough({
      [need.key]: { value: "", not_applicable: true },
    });
    if ("problem" in outcome) {
      setSaving(null);
      setProblem(outcome.problem);
      if (status === 409) {
        setChecking(true);
        await read();
        setChecking(false);
      }
      return;
    }
    setReview((was) =>
      was === null ? was : withConfirmed(was, { [need.key]: "Not applicable" }),
    );
    clearWalkthrough([need.key]);
    setSaved(`Marked not applicable: ${need.question || need.label}`);
    router.refresh();
    setChecking(true);
    await read();
    setChecking(false);
    setSaving(null);
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
  // Where the answers start from: another system's, proposed below, or none.
  const banner = startFromBanner(review);
  const progress = interviewProgress(review, interview);
  const plan = interview.plan;
  const step = at < plan.length ? (plan[at] ?? null) : null;
  const topic = step === null ? null : stepTopic(step);
  const current =
    step !== null && step !== CARRIED && topic === null
      ? byKey.get(step)
      : null;
  const onRecord = [...groups.confirmed, ...groups.rcm];
  // The walkthrough answers on record, by topic.
  const wtRecord = walkthroughRecord(review);
  const recordCount =
    onRecord.length +
    wtRecord.reduce((sum, group) => sum + group.needs.length, 0);
  const wtSteps = plan.filter((item) => stepTopic(item) !== null);
  const reopened = Object.keys(wtReopened).filter(
    (key) => wtReopened[key] === true,
  );
  const copyTargets = copyChoices(targets, copyTo);
  const busy = saving !== null;
  // A walkthrough save in flight (a topic, a question marked not applicable, or the notes):
  // the narrative shows as updating until the review is read again, never as blank.
  const wtSaving =
    saving !== null &&
    (stepTopic(saving) !== null ||
      saving === "notes" ||
      byKey.get(saving)?.kind === "WALKTHROUGH");
  const narrativeUpdating = checking || wtSaving;

  /** Opens a walkthrough topic's step, adding it to the course when it was not asked; an
   * answer on record given is reopened there to change. */
  function openTopic(need: Need) {
    const wt = need.walkthrough;
    if (wt === undefined || interview === null) {
      return;
    }
    if (need.status === "CONFIRMED") {
      setWtReopened((was) => ({ ...was, [need.key]: true }));
    }
    const target = topicStep(wt.topic);
    const known = plan.indexOf(target);
    if (known >= 0) {
      go(known);
      return;
    }
    const course = { ...interview, plan: [...plan, target] };
    setCourse(course);
    go(course.plan.length - 1);
  }

  /** Where a slot of the statement leads: its point, last year's step, or the record. */
  function openSlot(key: string) {
    const slot = byKey.get(key);
    if (slot?.kind === "WALKTHROUGH") {
      openTopic(slot);
      return;
    }
    if (byKey.get(key)?.kind === "AUTH" && interview !== null) {
      const known = plan.indexOf(key);
      if (known >= 0) {
        go(known);
        return;
      }
      const course = { ...interview, plan: [...plan, key] };
      setCourse(course);
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

  /** What is chosen on a point that takes more than one answer: the person's choices, or
   * its proposal or answer on record read back into them. */
  const multipleFor = (need: Need): MultiplePick =>
    multiPicked[need.key] ?? multipleStart(need);

  /** A point that takes more than one answer (12 November 2026): its options as tick chips
   * (the walkthrough's), with "Other (specify)" opening a field for the client's own words.
   * Native checkboxes underneath, so Tab moves between them and Space ticks. A proposal
   * still untouched keeps the proposal's look: never shown as anyone's answer. */
  const multipleChoices = (
    need: Need,
    id: string,
    label: { labelledBy: string; describedBy: string } | null,
  ) => {
    const start = multipleStart(need);
    const pick = multipleFor(need);
    const locked = !canAct || busy;
    const proposed =
      need.status === "PROPOSED" &&
      !(need.key in multiPicked) &&
      (pick.options.length > 0 || pick.other !== null);
    const issue = multipleProblem(need, pick);
    const set = (next: MultiplePick) =>
      setMultiPicked((was) => ({ ...was, [need.key]: next }));
    const otherOn = pick.other !== null;
    const box = (on: boolean) => (
      <span className="ur-wt-box" aria-hidden="true">
        {on ? <UiIcon name="check" size={11} /> : null}
      </span>
    );
    return (
      <>
        <fieldset
          className={`ur-wt-chips ur-multi${proposed ? " is-proposed" : ""}`}
          {...(label === null
            ? {
                "aria-label": `Answers to: ${need.question || need.label} (choose all that apply)`,
              }
            : {
                "aria-labelledby": label.labelledBy,
                "aria-describedby": label.describedBy,
              })}
        >
          {need.options.map((option) => {
            const on = pick.options.includes(option);
            return (
              <label key={option} className={`ur-wt-chip${on ? " is-on" : ""}`}>
                <input
                  type="checkbox"
                  name={id}
                  value={option}
                  checked={on}
                  disabled={locked}
                  onChange={() =>
                    set(toggleMultiple(need.options, pick, option))
                  }
                />
                {box(on)}
                <span>{option}</span>
              </label>
            );
          })}
          <label className={`ur-wt-chip is-other${otherOn ? " is-on" : ""}`}>
            <input
              type="checkbox"
              name={id}
              value={OTHER}
              checked={otherOn}
              disabled={locked}
              aria-controls={otherOn ? `${id}-other` : undefined}
              onChange={() =>
                set({
                  ...pick,
                  other: otherOn
                    ? null
                    : (typed[need.key] ?? start.other ?? ""),
                })
              }
            />
            {box(otherOn)}
            <span>Other (specify)</span>
          </label>
        </fieldset>
        {otherOn ? (
          <div className="ur-wt-other">
            <input
              id={`${id}-other`}
              className="ur-other"
              type="text"
              maxLength={ANSWER_MAX}
              value={pick.other ?? ""}
              disabled={locked}
              placeholder="Type the organization's answer"
              aria-label={`Other answer to: ${need.question || need.label}`}
              aria-describedby={`${id}-other-hint`}
              aria-invalid={issue !== "" && (pick.other ?? "").trim() !== ""}
              onChange={(event) => {
                const words = event.target.value;
                setTyped((was) => ({ ...was, [need.key]: words }));
                set({ ...pick, other: words });
              }}
            />
            <p
              className={`ur-wt-other-hint${issue !== "" && (pick.other ?? "").trim() !== "" ? " is-error" : ""}`}
              id={`${id}-other-hint`}
              aria-live="polite"
            >
              {issue !== ""
                ? issue
                : "Added after the answers ticked, as typed."}
            </p>
          </div>
        ) : issue !== "" ? (
          <p className="ur-wt-other-hint is-error" aria-live="polite">
            {issue}
          </p>
        ) : null}
      </>
    );
  };

  /** A point that takes more than one answer, changed in place from the record's fold. */
  const recordMultiple = (need: Need) => {
    const value = multipleAnswer(need, multiPicked[need.key]);
    return (
      <form
        className="ur-answer"
        autoComplete="off"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void save(need, value, false);
        }}
      >
        {multipleChoices(need, `ur-rec-${need.key}`, null)}
        <div className="ur-answer-actions">
          <button
            type="submit"
            className="btn btn-sm"
            disabled={!canAct || busy || value === "" || value === need.value}
          >
            {saving === need.key ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="cs-link"
            onClick={() => {
              setEditing((was) => ({ ...was, [need.key]: false }));
              setMultiPicked((was) => {
                const { [need.key]: _gone, ...rest } = was;
                return rest;
              });
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  };

  /** An answer on record changed in place, from the record's fold. */
  const recordEditor = (need: Need) =>
    need.multiple && need.options.length > 0
      ? recordMultiple(need)
      : recordSingle(need);

  /** An answer on record with one answer, changed in place. */
  const recordSingle = (need: Need) => (
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
          placeholder="Type the organization's answer"
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

      {review.narrative.length > 0 || wtSaving ? (
        <section
          className={`ur-narrative${narrativeUpdating ? " is-updating" : ""}`}
          aria-label="The walkthrough, as answered"
          aria-busy={narrativeUpdating}
        >
          {review.narrative.length === 0 ? (
            <p className="ur-narrative-label" role="status">
              <small>Updating…</small>
            </p>
          ) : null}
          {review.narrative.map((paragraph, index) => (
            <div key={paragraph.topic} className="ur-narrative-topic">
              <p className="ur-narrative-label">
                <span>{paragraph.label}</span>
                {index === 0 && narrativeUpdating ? (
                  <small role="status">Updating…</small>
                ) : null}
              </p>
              <p className="ur-narrative-text">
                {paragraph.parts.map((part, at) => {
                  const need =
                    part.key === null ? undefined : byKey.get(part.key);
                  if (need === undefined) {
                    // biome-ignore lint/suspicious/noArrayIndexKey: the paragraph's parts in order
                    return <span key={at}>{part.text}</span>;
                  }
                  const question = need.question || need.label;
                  return (
                    // biome-ignore lint/a11y/useSemanticElements: an inline phrase of the sentence that wraps across lines, which a button cannot
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: the paragraph's parts in order
                      key={at}
                      role="button"
                      tabIndex={0}
                      className="ur-slot is-filled"
                      title={question}
                      aria-label={`${canAct ? "Change" : "Show"}: ${question}`}
                      onClick={() => openSlot(need.key)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openSlot(need.key);
                        }
                      }}
                    >
                      {part.text}
                    </span>
                  );
                })}
              </p>
            </div>
          ))}
        </section>
      ) : null}

      <ul
        className={`ur-ready${checking ? " is-updating" : ""}`}
        aria-busy={checking}
        aria-label="What the understanding is ready for"
      >
        {/* The attributes first, then the D&I evidence requested against them (product
            owner, 11 November 2026). */}
        {readyLines(review).map((line) => (
          <li key={line.key} className={line.ready ? "is-ok" : ""}>
            <span className="ur-check" aria-hidden="true">
              {line.ready ? <UiIcon name="check" size={12} /> : null}
            </span>
            <span>{line.text}</span>
            <small>{checking ? "Updating…" : line.note}</small>
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

      {recordCount > 0 ? (
        <details
          className="ur-record"
          open={recordOpen}
          onToggle={(event) => setRecordOpen(event.currentTarget.open)}
        >
          <summary>
            On record <span className="ur-count">{recordCount}</span>
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
          {/* The walkthrough's answers, by topic (11 November 2026). */}
          {wtRecord.map((group) => (
            <section
              key={group.topic}
              className="ur-record-topic"
              aria-labelledby={`ur-record-${group.topic}`}
            >
              <h4 id={`ur-record-${group.topic}`}>{group.label}</h4>
              <ul>
                {group.needs.map((need) => (
                  <li key={need.key}>
                    <span className="ur-record-q">
                      {need.question || need.label}
                    </span>
                    <span className="ur-record-a">
                      <strong>{answerDisplay(need) || "Not applicable"}</strong>
                      {SOURCE_WORDS[need.source] !== "" ? (
                        <small>{SOURCE_WORDS[need.source]}</small>
                      ) : null}
                      {canAct ? (
                        <button
                          type="button"
                          className="cs-link"
                          onClick={() => openTopic(need)}
                        >
                          Change
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </details>
      ) : null}
    </>
  );

  /** The foot of a step: where it stands, and Back with the step's own action. */
  const foot = (primary: ReactNode, skip: boolean) => (
    <div className="ur-foot">
      <p className="ur-foot-where">
        {plan.length > 1 ? `Step ${at + 1} of ${plan.length}` : null}
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
    const copy = carriedCopy(interview, waiting.length);
    return (
      <>
        <div className="ur-kicker">
          <span className="ur-chip is-accent">{copy.chip}</span>
        </div>
        <h3 className="ur-q" id="ur-q">
          {copy.title}
        </h3>
        <p className="ur-hint">{copy.hint}</p>
        <ul className="ur-carried">
          {items.map((need) => {
            const done = need.status === "CONFIRMED";
            const from = done ? "" : carriedSource(interview, need);
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
                  {from !== "" ? (
                    <span className="ai-mark is-rules">{from}</span>
                  ) : null}
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
    // More than one answer (12 November 2026): tick chips, composed into one English list.
    const multiple = need.multiple && need.options.length > 0;
    const other = !multiple && (choice === OTHER || need.options.length === 0);
    const text =
      typed[need.key] ??
      (choice === OTHER && !need.options.includes(preset) ? preset : "");
    const answer = multiple
      ? multipleAnswer(need, multiPicked[need.key])
      : other
        ? text.trim()
        : choice;
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
        {need.source === "SYSTEM" && !onFile ? (
          <span className="ur-chip is-accent">{sameSystemLabel(need)}</span>
        ) : null}
        {need.source === "OTHER_SYSTEM" && !onFile ? (
          <span className="ur-chip is-accent">{otherSystemLabel(need)}</span>
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
    // A question the agents raised is answered here, from its own choices; the planner's
    // conversation stays one click away (12 November 2026).
    const asked =
      need.kind === "QUESTION"
        ? agentQuestions(issues.filter((issue) => issue.id === need.key))[0]
        : undefined;
    if (asked !== undefined && asked.source !== "RECORDED") {
      return (
        <AgentQuestionPoint
          key={need.key}
          row={asked}
          canAct={canAct}
          busy={busy}
          saving={saving === need.key}
          chips={chips}
          title={title}
          why={why}
          foot={(primary) => foot(primary, true)}
          onAnswer={(picks) => void answerQuestion(need, asked, picks)}
          onTalk={onTalk}
        />
      );
    }
    if (need.kind === "DOCUMENT") {
      return policyPoint(need, chips, title, why);
    }
    if (need.kind !== "ANSWER") {
      const lead =
        need.kind === "QUESTION"
          ? "The planner asks it as a short interview, with a proposed answer to confirm."
          : need.kind === "PROCESS"
            ? "The process understanding is confirmed in its own screen: the steps, the hand-offs and where this control sits."
            : need.source === "SYSTEM" && need.value !== ""
              ? `"${need.value}" governs this system's other controls. Optional: choose the governing policy for this control in D&I Evidence.`
              : need.source === "OTHER_SYSTEM" && need.value !== ""
                ? `"${need.value}" governs the same control on another system. Optional: choose the governing policy for this control in D&I Evidence.`
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
        ? "Selected from usual practice. Confirm it holds for this organization, or choose another."
        : need.source === "PRIOR_YEAR"
          ? "Last year's answer is selected. Confirm it still holds."
          : need.source === "SYSTEM"
            ? "The answer used on this system's other controls is selected. Confirm it holds for this control, or choose another."
            : need.source === "OTHER_SYSTEM"
              ? "The answer given for the same control on another system is selected. Confirm it holds here, or choose another."
              : need.status === "PROPOSED"
                ? "A proposed answer is selected. Confirm it, or choose another."
                : "";
    const hintLine = multiple
      ? `${hint.replace(/, or choose another\.$/, ", or change it.")}${hint !== "" ? " " : ""}Choose all that apply.`
      : hint;
    const tagFor = (option: string) =>
      option !== need.value || onFile
        ? ""
        : need.source === "USUAL"
          ? "Usual"
          : need.source === "PRIOR_YEAR"
            ? "Last year"
            : need.source === "SYSTEM"
              ? "This system"
              : need.source === "OTHER_SYSTEM"
                ? "Other system"
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
        {hintLine !== "" ? (
          <p className="ur-hint" id="ur-hint">
            {hintLine}
          </p>
        ) : null}
        {multiple ? (
          multipleChoices(need, name, {
            labelledBy: "ur-q",
            describedBy: "ur-hint",
          })
        ) : need.options.length > 0 ? (
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
            placeholder="Type the organization's answer"
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

  /** A step as the end's list names it. */
  const stepLabel = (key: string, need: Need | undefined): string => {
    const named = stepTopic(key);
    if (named !== null) {
      return `Walkthrough: ${topicName(review, named)}`;
    }
    return need?.question || need?.label || key;
  };

  /** What the person has chosen on a walkthrough question, or its proposal untouched. */
  const pickFor = (need: Need): string[] =>
    wtPicks[need.key] ?? proposedPick(need);

  const setPick = (need: Need, pick: string[]) =>
    setWtPicks((was) => ({ ...was, [need.key]: pick }));

  const toggleShown = (id: string) =>
    setWtShown((was) => ({ ...was, [id]: was[id] !== true }));

  /** One walkthrough question: its words, the reason on request, the control for its kind,
   * and where a proposed answer comes from. A proposal is selected but marked as not yet
   * anyone's answer. */
  const walkthroughQuestion = (need: Need) => {
    const wt = need.walkthrough;
    if (wt === undefined) {
      return null;
    }
    const id = `ur-wt-${need.key}`;
    const pick = pickFor(need);
    const touched = need.key in wtPicks;
    const onFile = need.status === "CONFIRMED";
    const proposal = need.status === "PROPOSED" && need.value !== "";
    // Where the proposal comes from: last year's, another system's, or the agents'.
    const mark = proposalMark(need);
    // A selection still the proposal's, not the person's: styled as a proposal.
    const tone = proposal && !touched ? " is-proposed" : "";
    const reason = [need.why, drivesLine(wt.drives)]
      .filter((part) => part !== "")
      .join(" ");
    const whyOpen = wtShown[`${need.key}:why`] === true;
    const quoteOpen = wtShown[`${need.key}:quote`] === true;
    const locked = !canAct || busy;
    const multi = wt.answerKind === "MULTI";
    // The question's Other answer (11 November 2026): its words when chosen, null otherwise.
    const other = wt.allowsOther ? otherText(pick) : null;
    const draft = wtOther[need.key] ?? otherText(proposedPick(need)) ?? "";
    const otherIssue = pickProblem(need, pick);
    // Quiet until the person has typed or tried to save.
    const otherError =
      other !== null &&
      otherIssue !== "" &&
      (other !== "" || wtShown[`${need.key}:tried`] === true);
    // Yes or No (product owner, 11 November 2026: "Feels cheap"): one pill-shaped track
    // with two equal segments and a raised thumb that slides to the one chosen. Native
    // radios underneath, so the arrow keys move between them. An untouched proposal keeps
    // the proposal's look on the thumb, with a word beside it: never shown as confirmed.
    const yesNoAt =
      wt.answerKind === "YES_NO" && pick.length === 1
        ? need.options.indexOf(pick[0] ?? "")
        : -1;
    const yesNo = (
      <div className="ur-wt-seg-row">
        <fieldset className={`ur-wt-seg${tone}`} aria-labelledby={`${id}-q`}>
          <span
            className={`ur-wt-thumb${yesNoAt < 0 ? " is-none" : ""}`}
            data-at={yesNoAt < 0 ? undefined : yesNoAt}
            aria-hidden="true"
          />
          {need.options.map((option) => {
            const on = pick.includes(option);
            return (
              <label key={option} className={`ur-wt-chip${on ? " is-on" : ""}`}>
                <input
                  type="radio"
                  name={id}
                  value={option}
                  checked={on}
                  disabled={locked}
                  onChange={() => setPick(need, [option])}
                />
                <UiIcon name={option === "No" ? "x" : "check"} size={14} />
                <span>{option}</span>
              </label>
            );
          })}
        </fieldset>
        {tone !== "" && yesNoAt >= 0 ? (
          <span className="ur-wt-seg-tag">Proposed</span>
        ) : null}
      </div>
    );
    const control =
      wt.answerKind === "YES_NO" ? (
        yesNo
      ) : wt.answerKind === "TEXT" ? (
        <textarea
          className="ur-wt-text"
          rows={3}
          maxLength={WALKTHROUGH_TEXT_MAX}
          value={pick[0] ?? ""}
          disabled={locked}
          placeholder="Type the organization's answer"
          aria-labelledby={`${id}-q`}
          onChange={(event) => setPick(need, [event.target.value])}
        />
      ) : (
        <fieldset className={`ur-wt-chips${tone}`} aria-labelledby={`${id}-q`}>
          {need.options.map((option) => {
            const on = pick.includes(option);
            return (
              <label key={option} className={`ur-wt-chip${on ? " is-on" : ""}`}>
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={id}
                  value={option}
                  checked={on}
                  disabled={locked}
                  onChange={() =>
                    setPick(
                      need,
                      multi
                        ? on
                          ? pick.filter((each) => each !== option)
                          : [...pick, option]
                        : [option],
                    )
                  }
                />
                {multi ? (
                  <span className="ur-wt-box" aria-hidden="true">
                    {on ? <UiIcon name="check" size={11} /> : null}
                  </span>
                ) : null}
                <span>{option}</span>
              </label>
            );
          })}
          {wt.allowsOther ? (
            <label
              className={`ur-wt-chip is-other${other !== null ? " is-on" : ""}`}
            >
              <input
                type={multi ? "checkbox" : "radio"}
                name={id}
                value="Other"
                checked={other !== null}
                disabled={locked}
                aria-controls={other !== null ? `${id}-other` : undefined}
                onChange={() =>
                  setPick(
                    need,
                    withOther(
                      wt.answerKind,
                      pick,
                      other !== null ? null : draft,
                    ),
                  )
                }
              />
              {multi ? (
                <span className="ur-wt-box" aria-hidden="true">
                  {other !== null ? <UiIcon name="check" size={11} /> : null}
                </span>
              ) : null}
              <span>Other</span>
            </label>
          ) : null}
        </fieldset>
      );
    // The Other answer's words, right below the chips while Other is chosen.
    const otherField =
      other === null ? null : (
        <div className="ur-wt-other">
          <label className="ur-wt-other-label" htmlFor={`${id}-other`}>
            Describe it
          </label>
          <input
            id={`${id}-other`}
            className="ur-other ur-wt-other-input"
            type="text"
            maxLength={OTHER_MAX}
            value={other}
            disabled={locked}
            placeholder="How it works at this organization"
            aria-describedby={`${id}-other-hint`}
            aria-invalid={otherError}
            onChange={(event) => {
              const words = event.target.value;
              setWtOther((was) => ({ ...was, [need.key]: words }));
              setPick(need, withOther(wt.answerKind, pick, words));
            }}
            onKeyDown={(event) => {
              // Enter does not save the topic from here: it checks these words.
              if (event.key === "Enter") {
                event.preventDefault();
                setWtShown((was) => ({ ...was, [`${need.key}:tried`]: true }));
              }
            }}
          />
          <p
            className={`ur-wt-other-hint${otherError ? " is-error" : ""}`}
            id={`${id}-other-hint`}
            aria-live="polite"
          >
            {otherError ? otherIssue : OTHER_RULE}
          </p>
        </div>
      );
    return (
      <li
        key={need.key}
        // A follow-up comes in with the step's own entry motion (.ur-step: 200 ms, off under
        // reduced motion) when its parent's pick opens it; it leaves at once when it stops.
        className={`ur-wt-item${wt.whenKey !== "" ? " ur-step" : ""}`}
      >
        <div className="ur-wt-head">
          <p className="ur-wt-q" id={`${id}-q`}>
            {need.question || need.label}
          </p>
          <span className="ur-wt-tags">
            {!need.required ? <span className="ur-chip">Optional</span> : null}
            {onFile ? <span className="ur-chip is-ok">On record</span> : null}
            {reason !== "" ? (
              <button
                type="button"
                className="ur-wt-info"
                aria-expanded={whyOpen}
                aria-controls={`${id}-why`}
                aria-label="Why this is asked"
                title="Why this is asked"
                onClick={() => toggleShown(`${need.key}:why`)}
              >
                <UiIcon name="info" size={15} />
              </button>
            ) : null}
          </span>
        </div>
        {reason !== "" ? (
          <p className="ur-wt-why" id={`${id}-why`} hidden={!whyOpen}>
            {reason}
          </p>
        ) : null}
        {control}
        {otherField}
        {proposal || (!need.required && !onFile) ? (
          <div className="ur-wt-foot">
            {proposal && !mark.agent ? (
              <span className="ai-mark is-rules">{mark.text}</span>
            ) : proposal ? (
              <span className="ai-mark">
                <UiIcon name="sparkles" size={11} />
                {mark.text}
              </span>
            ) : null}
            {proposal && wt.quote !== "" ? (
              <button
                type="button"
                className="cs-link"
                aria-expanded={quoteOpen}
                aria-controls={`${id}-quote`}
                onClick={() => toggleShown(`${need.key}:quote`)}
              >
                {quoteOpen ? "Hide the source" : "Show the source"}
              </button>
            ) : null}
            {!need.required && !onFile ? (
              <button
                type="button"
                className="ur-skip ur-wt-na"
                disabled={locked}
                onClick={() => void notApplicable(need)}
              >
                {saving === need.key ? "Saving…" : "Mark not applicable"}
              </button>
            ) : null}
          </div>
        ) : null}
        {proposal && wt.quote !== "" ? (
          <blockquote
            className="ur-wt-quote"
            id={`${id}-quote`}
            hidden={!quoteOpen}
          >
            {wt.quote}
          </blockquote>
        ) : null}
      </li>
    );
  };

  /** A walkthrough topic as one step: its open questions together, one save for them all. */
  const topicStepView = (named: WalkthroughTopic) => {
    const all = topicQuestions(review, named);
    const asked = topicAsks(review, named, reopened);
    // What the step shows now: a follow-up only while its parent's pick opens it.
    const shown = topicShown(asked, wtPicks, review.needs);
    const label = topicName(review, named);
    const onFile = all.filter(
      (need) =>
        need.status === "CONFIRMED" &&
        !reopened.includes(need.key) &&
        followUpShown(need, asked, wtPicks, review.needs),
    ).length;
    const count = Object.keys(topicSave(asked, wtPicks, review.needs)).length;
    const blocked = topicBlocked(asked, wtPicks, review.needs);
    const blockedOn =
      blocked === null
        ? undefined
        : shown.find((need) => need.key === blocked.key);
    const done = topicDone(review, named);
    const left = topicLeft(asked, wtPicks, review.needs);
    const position = wtSteps.indexOf(topicStep(named)) + 1;
    const mine = saving === topicStep(named);
    return (
      <form
        className="ur-point"
        autoComplete="off"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void saveTopic(named, asked);
        }}
      >
        <div className="ur-kicker">
          <span className="ur-chip is-accent">Walkthrough</span>
          {wtSteps.length > 1 && position > 0 ? (
            <span className="ur-chip">
              Topic {position} of {wtSteps.length}
            </span>
          ) : null}
          {done && shown.length > 0 ? (
            <span className="ur-chip is-ok">Required answers on record</span>
          ) : null}
        </div>
        <h3 className="ur-q" id="ur-q">
          {label}
        </h3>
        <p className="ur-hint" id="ur-wt-hint">
          {topicHint(shown, label)}
        </p>
        {shown.length > 0 ? (
          <ol className="ur-wt">{shown.map(walkthroughQuestion)}</ol>
        ) : null}
        {onFile > 0 && shown.length > 0 ? (
          <p className="ur-wt-onfile">
            {onFile} {onFile === 1 ? "answer" : "answers"} on this topic{" "}
            {onFile === 1 ? "is" : "are"} on record.{" "}
            <button
              type="button"
              className="cs-link"
              onClick={() => {
                setRecordOpen(true);
                setDocOpen(true);
              }}
            >
              See on record
            </button>
          </p>
        ) : null}
        {blocked !== null ? (
          <p className="ur-wt-left" id="ur-wt-left">
            Saving waits on the Other answer to “
            {blockedOn?.question || blockedOn?.label}”: {blocked.problem}
          </p>
        ) : left > 0 && count === 0 ? (
          <p className="ur-wt-left" id="ur-wt-left">
            Answer the required {left === 1 ? "question" : "questions"} to
            continue, or skip for now.
          </p>
        ) : null}
        {foot(
          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              !canAct || busy || blocked !== null || (count === 0 && !done)
            }
            aria-describedby={
              blocked !== null || (left > 0 && count === 0)
                ? "ur-wt-left"
                : undefined
            }
          >
            {mine ? (
              <span className="spinner small" aria-hidden="true" />
            ) : null}
            {mine ? "Saving…" : count === 0 ? "Continue" : "Save and continue"}
            <UiIcon name="arrow" size={14} />
          </button>,
          !done,
        )}
      </form>
    );
  };

  // What still holds the understanding back: a walkthrough topic with only optional
  // questions left is not listed.
  const openSteps = plan
    .map((key, index) => ({ key, index }))
    .filter((item) => stepRequired(review, interview, item.key));
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
          {nextAfterUnderstanding(review) === "attributes" &&
          attributesHref !== null ? (
            <a className="btn btn-primary" href={attributesHref}>
              Finalize the attributes <UiIcon name="arrow" size={14} />
            </a>
          ) : documentsHref !== null ? (
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
                      ? carriedCopy(interview, 0).step
                      : stepLabel(item.key, need)}
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

  /** The quiet line on where the answers start from: a sentence while another system's
   * answers are proposed, and the choice of system (a compact select, or a quiet link when
   * there is only one). Choosing only reads the review again; nothing is written. */
  const startBanner = (shown: NonNullable<typeof banner>) => {
    const choose = shown.choose;
    const starting = saving === STARTING;
    return (
      <div
        className={`ur-start${shown.text === "" ? " is-off" : ""}`}
        aria-busy={starting}
      >
        {shown.text !== "" ? (
          <p className="ur-start-text">
            <UiIcon name="server" size={14} />
            <span>{shown.text}</span>
          </p>
        ) : null}
        {choose.kind === "select" ? (
          <label className="ur-start-pick">
            <span>Start from:</span>
            <select
              value={startPending ?? choose.value}
              disabled={busy}
              onChange={(event) => void startFrom(event.target.value)}
            >
              {choose.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <button
            type="button"
            className="ur-skip ur-start-link"
            disabled={busy}
            onClick={() => void startFrom(choose.value)}
          >
            {choose.label}
          </button>
        )}
        {starting ? (
          <small className="ur-start-status" role="status">
            {startPending === START_NONE
              ? "Removing the proposals…"
              : "Reading the answers…"}
          </small>
        ) : null}
      </div>
    );
  };

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
              : `${draftedFrom(groups, interview)}. Confirm it, so the D&I evidence can be requested and the attributes finalized.`}
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
        {banner !== null ? startBanner(banner) : null}
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
              : topic !== null
                ? topicStepView(topic)
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
          description="Paste notes or an email from the organization. The planner proposes answers, each with the words it rests on. Nothing is saved until you choose."
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
                  placeholder="Paste walkthrough notes or an email from the organization about this control"
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
                  {notesFailureLine(found) ?? notesSummary(found)}
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
