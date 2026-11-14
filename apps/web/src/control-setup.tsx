"use client";

import { useRouter } from "next/navigation";
import {
  type FormEvent,
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAction } from "./control-context-view";
import {
  agentQuestions,
  answerChoices,
  choiceTag,
  confirmPlan,
  type Draft,
  documentChoices,
  firstToAnswer,
  longChoices,
  NO_DOCUMENT,
  nextScreen,
  type Pick,
  type Prefill,
  prefillAnswers,
  type Screen,
  type SetupInput,
  type SetupIssue,
  type SetupStepKey,
  saveOne,
  screensFor,
  setupDraftKey,
  setupState,
  setupSteps,
  summaryRows,
} from "./control-setup-model";
import { acceptProposal, controlProposals } from "./references-view";
import { UiIcon } from "./ui-icon";
import {
  AGENT_NAME,
  answeredTurns,
  type CopyTargets,
  copiedNote,
  copyOffer,
  greeting,
  parseReading,
  parseTargets,
} from "./understanding-chat-model";
import { UnderstandingReview } from "./understanding-review";

type Ids = { organizationId: string; projectId: string; controlId: string };

type Slot = {
  key: string;
  question: string;
  label: string;
  value: string;
  blocks: boolean;
  options: string[];
  hint: string;
  /** Asks which policy, procedure or standard governs the control: answered from a
   * linked document on Governing documents, never typed apart from it. */
  document: boolean;
};

type GoverningDocument = { id: string; title: string; kind: string };

/** Control Understanding as a conversation (product owner, 9 November 2026): who the
 * planner greets, and the control it talks about. */
export type Conversation = {
  firstName: string;
  /** The control as the panel names it: reference and system. */
  control: string;
  /** Documents on file for the control, named in the greeting. */
  documents: number;
  /** Where the governing documents are linked (D&I Evidence), for a policy question. */
  documentsHref?: string | null;
  /** Where the attributes are decided (the Attributes step), the step after the understanding. */
  attributesHref?: string | null;
};

/** What each step is for, under its title. */
const STEP_HELP: Record<SetupStepKey, string> = {
  answers: "",
  process:
    "How the business process runs and where this control sits in it. The agent drafts the steps from the answers; confirm them or correct them.",
  attributes:
    "What the test checks on each item. Decide each one the agent proposes: approved attributes become the testing criteria.",
  documents:
    "Policies, procedures, narratives or diagrams that govern this control, where the organization has them. The agent reads them to sharpen the plan and the evidence requests.",
  plan: "The test plan the agent drafted from everything above: procedures, attributes and the evidence each needs. Once a person approves it, evidence can be requested.",
};

/**
 * The guided setup of a control's understanding (product owner, 2 November 2026; laid
 * out to the owner's reference): a step list on the left with what the setup gives, and
 * the step on the right, one client-specific question at a time with the agent's answer
 * already chosen. It opens on its own until the control is ready for evidence gathering,
 * for whoever can do the next part; Skip for now closes it for this visit and Resume
 * setup in the header opens it again. Each step uses the page's own panels and actions,
 * so the same rules, approvals and audit apply. The last screen opens Evidence.
 */
export function ControlSetup({
  ids,
  input,
  readinessBlocked,
  holds,
  slots,
  issues,
  documents,
  panels,
  only,
  conversation = null,
  embedded = false,
}: {
  ids: Ids;
  input: SetupInput;
  /** Readiness still holds evidence gathering. */
  readinessBlocked: boolean;
  /** What readiness says still holds it, in words. */
  holds: string[];
  slots: Slot[];
  /** The control's issues: the open ones are asked with the client-specific questions. */
  issues: readonly SetupIssue[];
  /** The control's governing documents, which answer the questions that name one. */
  documents: GoverningDocument[];
  panels: Partial<Record<SetupStepKey, ReactNode>>;
  /** The steps a workflow step's panel shows (product owner, 8 November 2026: the
   * setup is inline in the panels; its pop-up is retired). */
  only: readonly SetupStepKey[];
  /** The answers asked as a conversation with the engagement planner, the form behind
   * "Review all answers" (9 November 2026). Absent: the form, as before. */
  conversation?: Conversation | null;
  /** Inside a workflow step's panel whose frame already gives the title, the status, the
   * decision and the agent's line (product owner, 11 November 2026, approved preview): the
   * step's body alone, with no step header, done chip, description or step list. Used by
   * the Attributes and Scope & Sampling steps; Control Understanding is not embedded. */
  embedded?: boolean;
}) {
  const steps = useMemo(
    () => setupSteps(input).filter((step) => only.includes(step.key)),
    [input, only],
  );
  const state = setupState(steps, readinessBlocked);
  // The understanding opens on its review, which lists the process among its points.
  const [current, setCurrent] = useState<SetupStepKey | null>(
    conversation !== null &&
      conversation !== undefined &&
      steps.some((each) => each.key === "answers")
      ? "answers"
      : (state.first ?? steps[0]?.key ?? null),
  );
  const index = Math.max(
    0,
    steps.findIndex((step) => step.key === current),
  );
  // The understanding opens as the draft to review; the conversation is for the agents'
  // questions, or to talk it through (product owner, 9 November 2026).
  const [talking, setTalking] = useState(false);
  const step = steps[index] ?? null;
  // On to the next step not done; past the last, back to the first one left.
  const goNext = () => {
    const after = steps.slice(index + 1).find((each) => !each.done);
    setCurrent(after?.key ?? state.first ?? steps[index + 1]?.key ?? null);
  };
  const goBack = () => {
    const before = steps[index - 1];
    if (before !== undefined) {
      setCurrent(before.key);
    }
  };
  const left =
    state.first !== null && state.first !== step?.key
      ? (steps.find((each) => each.key === state.first) ?? null)
      : null;
  // The draft to review stands on its own: the agent strip above it already says who drafted
  // it, so no step list or progress bar is added around it. A business process control's
  // process opens from the review.
  const processStep = steps.some((each) => each.key === "process");
  if (step?.key === "answers" && conversation !== null && !talking) {
    return (
      <div className="cs-inline">
        <UnderstandingReview
          ids={ids}
          canAct={input.canAct}
          onTalk={() => setTalking(true)}
          onProcess={processStep ? () => setCurrent("process") : null}
          documentsHref={conversation.documentsHref ?? null}
          attributesHref={conversation.attributesHref ?? null}
          issues={issues}
        />
      </div>
    );
  }
  // Embedded, a step that is not on this control's list shows nothing rather than an empty
  // step header.
  if (embedded && step === null) {
    return null;
  }
  if (embedded && step !== null && step.key !== "answers") {
    return (
      <div className="cs-inline cs-embedded">
        {step.key === "documents" ? (
          <DocumentQuestions
            ids={ids}
            slots={slots.filter((slot) => slot.document)}
            documents={documents}
            canAct={input.canAct}
          />
        ) : null}
        {panels[step.key] ?? null}
        {step.key === "plan" && holds.length > 0 && !step.done ? (
          <section
            className="cs-holds-list"
            aria-labelledby={`cs-holds-${ids.controlId}`}
          >
            <h4 className="cs-section-title" id={`cs-holds-${ids.controlId}`}>
              Also holding evidence gathering
            </h4>
            <ul className="cs-list">
              {holds.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    );
  }
  const layout = (
    <div className="cs-layout">
      {steps.length > 1 ? (
        <aside className="cs-rail" aria-label="Setup steps">
          <ol className="cs-steps">
            {steps.map((each, at) => (
              <li
                key={each.key}
                className={`${each.done ? "is-done" : ""}${each.key === step?.key ? " is-on" : ""}`}
              >
                <button
                  type="button"
                  onClick={() => setCurrent(each.key)}
                  aria-current={each.key === step?.key ? "step" : undefined}
                >
                  <span className="cs-step-mark" aria-hidden="true">
                    {each.done ? <UiIcon name="check" size={14} /> : at + 1}
                  </span>
                  <span className="cs-step-name">
                    {each.title}
                    <small>{each.summary}</small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </aside>
      ) : null}

      <div className="cs-main">
        <div className="cs-progress">
          <span>
            Step {index + 1} of {steps.length}
            {step !== null ? ` · ${step.title}` : ""}
          </span>
          <ol aria-hidden="true">
            {steps.map((each, at) => (
              <li
                key={each.key}
                className={
                  at < index || each.done
                    ? "is-done"
                    : at === index
                      ? "is-on"
                      : undefined
                }
              />
            ))}
          </ol>
        </div>
        {step?.key === "answers" ? (
          <AnswersStep
            ids={ids}
            slots={slots.filter((slot) => !slot.document)}
            issues={issues}
            canAct={input.canAct}
            onDone={goNext}
            onBack={index > 0 ? goBack : null}
            onSkip={null}
            conversation={conversation}
            onDraft={conversation !== null ? () => setTalking(false) : null}
          />
        ) : step !== null ? (
          <>
            <section
              key={step.key}
              className="cs-card"
              aria-labelledby="cs-step-title"
            >
              <p className="cs-kicker">
                {step.done ? (
                  <span className="cs-done">
                    <UiIcon name="check" size={12} />
                    Done
                  </span>
                ) : step.optional ? (
                  <span className="cs-optional">Optional</span>
                ) : !step.mine ? (
                  <span className="cs-waiting">Waits on someone else</span>
                ) : null}
                <span>{step.summary}</span>
              </p>
              <h3 id="cs-step-title">{step.title}</h3>
              <p className="cs-help">{STEP_HELP[step.key]}</p>
              {step.key === "documents" ? (
                <DocumentQuestions
                  ids={ids}
                  slots={slots.filter((slot) => slot.document)}
                  documents={documents}
                  canAct={input.canAct}
                />
              ) : null}
              <div className="cs-panel">
                {panels[step.key] ?? null}
                {step.key === "plan" && holds.length > 0 && !step.done ? (
                  <div className="cs-holds">
                    <p>Also holding evidence gathering:</p>
                    <ul>
                      {holds.map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>
            <div className="cs-actions">
              {index > 0 ? (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={goBack}
                >
                  Back
                </button>
              ) : null}
              {index < steps.length - 1 ? (
                <button type="button" className="btn" onClick={goNext}>
                  Continue
                  <UiIcon name="arrow" size={14} />
                </button>
              ) : left !== null ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCurrent(left.key)}
                >
                  Next: {left.title}
                  <UiIcon name="arrow" size={14} />
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
  return <div className="cs-inline">{layout}</div>;
}

function readDraft(controlId: string): Draft {
  try {
    const saved = window.sessionStorage.getItem(setupDraftKey(controlId));
    const held: unknown = saved === null ? null : JSON.parse(saved);
    const draft = held as Partial<Draft> | null;
    return draft !== null &&
      typeof draft.picks === "object" &&
      draft.picks !== null &&
      Array.isArray(draft.dismissed)
      ? { picks: draft.picks, dismissed: draft.dismissed }
      : { picks: {}, dismissed: [] };
  } catch {
    return { picks: {}, dismissed: [] };
  }
}

function writeDraft(controlId: string, draft: Draft | null) {
  try {
    if (draft === null) {
      window.sessionStorage.removeItem(setupDraftKey(controlId));
    } else {
      window.sessionStorage.setItem(
        setupDraftKey(controlId),
        JSON.stringify(draft),
      );
    }
  } catch {
    // Without storage the answers last for this visit; nothing else changes.
  }
}

/**
 * The questions as an interview (product owner, 4 November 2026: "the same workflow as how
 * turbotax does it"): one short question on each screen, the next chosen by the answer, why it
 * is asked opening on request, and a summary with Edit before anything is confirmed. A
 * client-specific answer saves as it is given; an agent's question is held until the summary,
 * since it cannot be changed once resolved. The agent's answer is already chosen, and says
 * where it comes from.
 */
function AnswersStep({
  ids,
  slots,
  issues,
  canAct,
  onDone,
  onBack,
  onSkip,
  conversation,
  onDraft = null,
}: {
  ids: Ids;
  slots: Slot[];
  issues: readonly SetupIssue[];
  canAct: boolean;
  onDone: () => void;
  /** The step before, when there is one. */
  onBack: (() => void) | null;
  onSkip: (() => void) | null;
  conversation: Conversation | null;
  /** Back to the draft to review, from the conversation. */
  onDraft?: (() => void) | null;
}) {
  const action = useAction(ids);
  const router = useRouter();
  // The conversation, or the form it keeps behind "Review all answers".
  const [mode, setMode] = useState<"chat" | "form">(
    conversation !== null ? "chat" : "form",
  );
  // What was said in this visit around the questions: the person's own words and the
  // planner's replies, under the screen they were said on.
  const [notes, setNotes] = useState<
    Array<{ id: number; at: string; who: "agent" | "person"; text: string }>
  >([]);
  const said = useRef(0);
  const say = (at: string, who: "agent" | "person", text: string) => {
    said.current += 1;
    const id = said.current;
    setNotes((now) => [...now, { id, at, who, text }]);
  };
  const [message, setMessage] = useState("");
  const [reading, setReading] = useState<{ at: string; value: string } | null>(
    null,
  );
  const [asking, setAsking] = useState(false);
  // The same control on other systems, and the offer to copy the answers there.
  const [targets, setTargets] = useState<CopyTargets | null>(null);
  const [finished, setFinished] = useState(false);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [copying, setCopying] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  // Answers saved in this visit: the other systems are read again after each, so the offer
  // names what a copy would fill now, never what it would have at the start.
  const [saves, setSaves] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: read again after each save
  useEffect(() => {
    if (conversation === null) {
      return;
    }
    let alive = true;
    const query = new URLSearchParams({
      organization_id: ids.organizationId,
      project_id: ids.projectId,
      control_id: ids.controlId,
    });
    void fetch(`/workspace/understanding-chat?${query.toString()}`)
      .then((response) => response.json() as Promise<{ body?: unknown }>)
      .then((answer) => {
        if (alive) {
          setTargets(parseTargets(answer.body ?? null));
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [ids, conversation, saves, finished]);
  const offer = conversation === null ? null : copyOffer(targets);
  const log = useRef<HTMLOListElement>(null);
  // The greeting as the visit opened: it follows the records until the person first acts,
  // then stays as said while their answers are saved.
  const opening = useRef<string[] | null>(null);
  const [proposals, setProposals] = useState<
    Array<{ id: string; slotKey: string; value: string; status: string }>
  >([]);
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
              status: item.status,
            })),
        );
      }
    });
    return () => {
      alive = false;
    };
  }, [ids]);
  // Answered in this visit: kept in the list, read-only, so the summary can show them.
  const [settled, setSettled] = useState<Record<string, string>>({});
  const [draft, setDraftState] = useState<Draft>(() =>
    readDraft(ids.controlId),
  );
  const setDraft = (next: Draft) => {
    setDraftState(next);
    writeDraft(ids.controlId, next);
  };
  const rows = [
    ...prefillAnswers(slots, proposals),
    ...agentQuestions(issues, settled),
  ];
  // null: the summary. An edit returns to it once the answers are complete again.
  const [screenAt, setScreenAt] = useState<number | null>(() =>
    firstToAnswer(rows, draft),
  );
  const [editing, setEditing] = useState(false);
  // Something was saved in this visit, so the narrative is drafted again at the end.
  const [touched, setTouched] = useState(false);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [writing, setWriting] = useState<Record<string, boolean>>({});
  // Chosen on this screen and not yet continued from: an answer counts on Continue.
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const screens = screensFor(rows, draft);
  // The newest message stays in view as the conversation goes on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are what add a message
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [notes.length, screenAt, reading, finished, copyNote, asking]);

  function goForward(next: Draft, from: number) {
    const target = nextScreen(rows, next, from, editing);
    if (target === null) {
      setEditing(false);
    }
    setScreenAt(target);
  }

  /** Back to one question from the summary, to change it. */
  function edit(key: string) {
    const at = rows.findIndex((row) => row.key === key);
    const shown = screensFor(rows, draft).findIndex((item) => item.row === at);
    setProblem(null);
    setEditing(true);
    setScreenAt(shown < 0 ? 0 : shown);
  }

  async function confirm() {
    const plan = confirmPlan(rows, draft);
    setProblem(null);
    setSaving(true);
    let ok = true;
    if (plan.points.length > 0) {
      ok = await action.run("values", {
        intent: "process-points",
        items: plan.points,
      });
    }
    for (const item of [...plan.resolved, ...plan.dismissed]) {
      if (!ok) {
        break;
      }
      ok = await action.run("values", {
        intent: "issue-resolve",
        issue_id: item.issueId,
        status: plan.resolved.includes(item) ? "RESOLVED" : "DISMISSED",
        note: item.note,
        version: item.version,
      });
    }
    setSaving(false);
    if (!ok) {
      setProblem(
        "The answers could not all be saved. Refresh the page and try again.",
      );
      return;
    }
    setSettled((now) => ({ ...now, ...plan.settled }));
    writeDraft(ids.controlId, null);
    // Every question answered: the narrative is drafted from them in the background, as on
    // the page (DesignPanel).
    if (touched || Object.keys(plan.settled).length > 0) {
      void action.run("narrate", { intent: "process-narrate" });
    }
    // In the conversation, the planner offers the answers to the same control on other
    // systems before going on.
    if (mode === "chat" && offer !== null && copyNote === null) {
      setFinished(true);
      return;
    }
    onDone();
  }

  async function chatCall(
    fields: Record<string, unknown>,
  ): Promise<{ status: number; detail: string; body: unknown }> {
    try {
      const response = await fetch("/workspace/understanding-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          ...fields,
        }),
      });
      const answer = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
        body?: unknown;
      };
      return {
        status: typeof answer.status === "number" ? answer.status : 0,
        detail: typeof answer.detail === "string" ? answer.detail : "",
        body: answer.body ?? null,
      };
    } catch {
      return { status: 0, detail: "", body: null };
    }
  }

  async function copyAnswers() {
    if (offer === null) {
      return;
    }
    const chosenSystems = offer.systems.filter(
      (item) => picked[item.controlId] ?? true,
    );
    if (chosenSystems.length === 0) {
      setCopyNote("Fine. The answers stay on this system only.");
      return;
    }
    setCopying(true);
    setProblem(null);
    const answer = await chatCall({
      intent: "copy-out",
      targets: chosenSystems.map((item) => item.controlId),
    });
    setCopying(false);
    if (answer.status !== 200) {
      setProblem(
        answer.detail !== ""
          ? `The answers could not be copied: ${answer.detail}.`
          : "The answers could not be copied. Try again.",
      );
      return;
    }
    setTargets(parseTargets(answer.body));
    setCopyNote(
      copiedNote(chosenSystems.map((item) => item.system || "another system")),
    );
    router.refresh();
  }

  // The conversation's frame (9 November 2026): the planner's greeting, the points answered
  // so far with a way to change each, then what is asked now and the reply box.
  const chatFrame = (at: number, body: ReactNode, compose: ReactNode) => {
    const lines = greeting({
      firstName: conversation?.firstName ?? "",
      control: conversation?.control ?? "this control",
      priorYear: rows.filter((row) => row.source === "PRIOR_YEAR").length,
      documents: conversation?.documents ?? 0,
      open: rows.filter((row) => row.source !== "RECORDED").length,
      agentQuestions: rows.filter(
        (row) => row.issue !== undefined && row.source !== "RECORDED",
      ).length,
      answered: rows.filter((row) => row.source === "RECORDED").length,
    });
    const acted =
      touched || notes.length > 0 || Object.keys(settled).length > 0;
    if (!acted || opening.current === null) {
      opening.current = lines;
    }
    const spoken = opening.current;
    const turns = answeredTurns(rows, screens, draft, at);
    return (
      <section
        className="uc"
        aria-label={`Conversation with the ${AGENT_NAME.toLowerCase()}`}
      >
        <header className="uc-head">
          <span className="uc-avatar" aria-hidden="true">
            EP
          </span>
          <span className="uc-who">
            <strong>{AGENT_NAME}</strong>
            <small>Control Understanding</small>
          </span>
          {onDraft !== null ? (
            <button type="button" className="cs-link" onClick={onDraft}>
              Back to the draft
            </button>
          ) : (
            <button
              type="button"
              className="cs-link"
              onClick={() => setMode("form")}
            >
              Review all answers
            </button>
          )}
        </header>
        <ol className="uc-log" ref={log}>
          {spoken.map((line) => (
            <li key={line} className="uc-msg is-agent">
              {line}
            </li>
          ))}
          {turns.map((turn) => {
            const was = rows.find((row) => row.key === turn.row);
            const fixed =
              was === undefined ||
              (was.issue !== undefined && was.source === "RECORDED");
            return (
              <Fragment key={turn.key}>
                <li className="uc-msg is-agent is-past">{turn.question}</li>
                <li className="uc-msg is-person">
                  {turn.answer}
                  {canAct && !fixed ? (
                    <button
                      type="button"
                      className="uc-change"
                      aria-label={`Change the answer to: ${turn.question}`}
                      onClick={() => edit(turn.row)}
                    >
                      Change
                    </button>
                  ) : null}
                </li>
              </Fragment>
            );
          })}
          {body}
        </ol>
        {compose}
        {problem !== null || action.problem !== null ? (
          <p className="cc-problem" role="alert">
            {problem ?? action.problem}
          </p>
        ) : null}
      </section>
    );
  };

  // A question raised while the summary is open is asked before it is confirmed.
  const current = screenAt ?? firstToAnswer(rows, draft);
  if (current === null) {
    const summary = summaryRows(rows, draft);
    const pending = Object.keys(confirmPlan(rows, draft).settled).length;
    if (mode === "chat") {
      const ready = finished || pending === 0;
      return chatFrame(
        screens.length,
        !ready ? (
          <li className="uc-msg is-agent">
            <p>That covers every point. This is what will be recorded:</p>
            <ul className="uc-summary">
              {summary.map((item) => (
                <li key={item.key}>
                  <small>{item.title}</small>
                  <strong>{item.short}</strong>
                </li>
              ))}
            </ul>
            <div className="uc-actions">
              <button
                type="button"
                className="btn btn-sm"
                disabled={!canAct || saving}
                onClick={() => void confirm()}
              >
                {saving ? (
                  <span className="spinner small" aria-hidden="true" />
                ) : null}
                {saving ? "Saving…" : "Confirm the understanding"}
              </button>
            </div>
          </li>
        ) : (
          <>
            <li className="uc-msg is-agent">
              {finished
                ? "Recorded. The understanding is confirmed."
                : "Every point is on record."}
            </li>
            {offer !== null && copyNote === null ? (
              <li className="uc-msg is-agent">
                <p>{offer.text}</p>
                <fieldset className="uc-systems">
                  <legend className="sr-only">
                    Systems to copy the answers to
                  </legend>
                  {offer.systems.map((system) => (
                    <label key={system.controlId} className="uc-system">
                      <input
                        type="checkbox"
                        checked={picked[system.controlId] ?? true}
                        disabled={!canAct || copying}
                        onChange={(event) => {
                          const on = event.target.checked;
                          setPicked((now) => ({
                            ...now,
                            [system.controlId]: on,
                          }));
                        }}
                      />
                      <span>
                        {system.system || "Another system"}
                        <small>
                          {system.fills.length}{" "}
                          {system.fills.length === 1 ? "answer" : "answers"} to
                          fill
                          {system.differs.length > 0
                            ? ` · ${system.differs.length} kept as answered there`
                            : ""}
                        </small>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="uc-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={!canAct || copying}
                    onClick={() => void copyAnswers()}
                  >
                    {copying ? (
                      <span className="spinner small" aria-hidden="true" />
                    ) : null}
                    {copying ? "Copying…" : "Copy the answers"}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={copying}
                    onClick={() =>
                      setCopyNote("Fine. The answers stay on this system only.")
                    }
                  >
                    Not now
                  </button>
                </div>
              </li>
            ) : null}
            {copyNote !== null ? (
              <li className="uc-msg is-agent" role="status">
                {copyNote}
              </li>
            ) : null}
            {offer === null || copyNote !== null ? (
              <li className="uc-msg is-agent">
                <div className="uc-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={saving}
                    onClick={() => (finished ? onDone() : void confirm())}
                  >
                    {saving ? "Saving…" : "Continue"}
                    {saving ? null : <UiIcon name="arrow" size={14} />}
                  </button>
                </div>
              </li>
            ) : null}
          </>
        ),
        null,
      );
    }
    return (
      <>
        {conversation !== null ? (
          <p className="uc-back">
            <button
              type="button"
              className="cs-link"
              onClick={() => setMode("chat")}
            >
              Back to the conversation
            </button>
          </p>
        ) : null}
        <section
          className="cs-card cs-question"
          aria-labelledby="cs-summary-title"
        >
          <h3 id="cs-summary-title">Review the answers</h3>
          <p className="cs-help">
            {pending > 0
              ? "The open questions are saved when the answers are confirmed."
              : "Every answer is on record."}
          </p>
          <ul className="cs-summary">
            {summary.map((item) => (
              <li key={item.key}>
                <small>{item.title}</small>
                <strong>{item.short}</strong>
                {item.full !== "" ? <p>{item.full}</p> : null}
                {!item.locked && canAct ? (
                  <button
                    type="button"
                    className="cs-link"
                    aria-label={`Edit: ${item.title}`}
                    onClick={() => edit(item.key)}
                  >
                    Edit
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {problem !== null || action.problem !== null ? (
            <p className="cc-problem" role="alert">
              {problem ?? action.problem}
            </p>
          ) : null}
          {onSkip !== null ? (
            <div className="cs-card-foot">
              <span />
              <button type="button" className="cs-link" onClick={onSkip}>
                Skip for now
              </button>
            </div>
          ) : null}
        </section>
        <div className="cs-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setScreenAt(Math.max(0, screens.length - 1))}
          >
            Back
          </button>
          <button
            type="button"
            className="btn"
            disabled={!canAct || saving}
            onClick={() => void confirm()}
          >
            {saving ? (
              <span className="spinner small" aria-hidden="true" />
            ) : null}
            {saving ? "Saving…" : pending > 0 ? "Confirm answers" : "Continue"}
            {saving ? null : <UiIcon name="arrow" size={14} />}
          </button>
        </div>
      </>
    );
  }

  const position = Math.max(0, Math.min(current, screens.length - 1));
  const screen: Screen | undefined = screens[position];
  const row: Prefill | undefined =
    screen === undefined ? undefined : rows[screen.row];
  if (screen === undefined || row === undefined) {
    return null;
  }
  const step = row.steps?.find((item) => item.key === screen.step);
  const held = draft.picks[row.key]?.[screen.step];
  const keyOf = `${row.key}:${screen.step}`;
  const choices =
    step !== undefined
      ? step.answers.map((item) => item.label)
      : answerChoices(row);
  const proposed = step !== undefined ? step.usual : row.value;
  const isWriting =
    writing[keyOf] ??
    ((held !== undefined && "other" in held) || choices.length === 0);
  const chosen =
    selected[keyOf] ??
    (held !== undefined && "label" in held ? held.label : proposed);
  const words =
    typed[keyOf] ?? (held !== undefined && "other" in held ? held.other : "");
  const answeredAlready = row.issue !== undefined && row.source === "RECORDED";
  const locked = !canAct || answeredAlready;
  const hint = slots.find((slot) => slot.key === row.key)?.hint ?? "";
  const why = step !== undefined ? step.why : (row.why ?? "");
  const tag = choiceTag(row, step?.basis ?? "");
  const question = step?.question ?? row.question;
  const rowNumber = screen.row + 1;

  async function next(given?: { value: string; typed: boolean }) {
    if (row === undefined || screen === undefined) {
      return;
    }
    const value =
      given !== undefined
        ? given.value.trim()
        : isWriting
          ? words.trim()
          : chosen;
    const typedIn = given !== undefined ? given.typed : isWriting;
    if (answeredAlready) {
      goForward(draft, position);
      return;
    }
    if (value === "") {
      setProblem("Choose an answer, or type one.");
      return;
    }
    setProblem(null);
    const pick: Pick = typedIn ? { other: value } : { label: value };
    // A client-specific answer saves now, as it always has.
    if (row.issue === undefined) {
      setSaving(true);
      const plan = saveOne(row, value);
      let ok = true;
      if (plan.kind === "accept") {
        ok = await acceptProposal(ids, plan.proposalId);
      } else if (plan.kind === "value") {
        ok = await action.run("values", {
          intent: "values-set",
          values: { [row.key]: plan.value },
          everywhere: false,
        });
      }
      setSaving(false);
      if (!ok) {
        setProblem("The answer could not be saved. Try again.");
        return;
      }
      if (plan.kind !== "none") {
        setTouched(true);
        setSaves((count) => count + 1);
      }
    }
    const updated: Draft = {
      ...draft,
      dismissed: draft.dismissed.filter((key) => key !== row.key),
      picks: {
        ...draft.picks,
        [row.key]: {
          ...(draft.picks[row.key] ?? {}),
          [screen.step]: pick,
        },
      },
    };
    setDraft(updated);
    goForward(updated, position);
  }

  function setAside() {
    if (row === undefined) {
      return;
    }
    const updated: Draft = {
      ...draft,
      dismissed: [...draft.dismissed.filter((key) => key !== row.key), row.key],
    };
    setDraft(updated);
    goForward(updated, position);
  }

  /** A reply in the person's own words: read by the planner, shown back, never saved by
   * itself (understanding_chat.interpret). */
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (text === "" || row === undefined || asking) {
      return;
    }
    say(keyOf, "person", text);
    setMessage("");
    setReading(null);
    setAsking(true);
    const answer = await chatCall({
      intent: "interpret",
      key: row.issue !== undefined ? row.issue.id : row.key,
      step: step?.key ?? "",
      text,
    });
    setAsking(false);
    const read = answer.status === 200 ? parseReading(answer.body) : null;
    if (read === null) {
      say(
        keyOf,
        "agent",
        answer.status === 0
          ? "That took too long to read. Pick an answer, or send it again."
          : "That reply could not be read. Pick an answer, or say it another way.",
      );
      return;
    }
    if (read.intent === "ANSWER") {
      setReading({ at: keyOf, value: read.value });
    } else if (read.intent === "SKIP") {
      say(
        keyOf,
        "agent",
        "No problem. Your answers so far are kept, so this point waits for you. Pick an answer whenever you're ready.",
      );
    } else if (read.intent === "COPY") {
      say(
        keyOf,
        "agent",
        offer !== null
          ? `Yes. Once the points are confirmed, I'll offer these answers to ${offer.systems.map((item) => item.system || "the other system").join(", ")}.`
          : `${targets?.controlRef ?? "This control"} does not run on another system in this engagement, so there is nothing to copy.`,
      );
    } else {
      say(keyOf, "agent", read.reply || "Could you say a little more?");
    }
  }

  if (mode === "chat") {
    const here = notes.filter((note) => note.at === keyOf);
    return chatFrame(
      position,
      <>
        <li className="uc-msg is-agent is-ask">
          {row.topic !== undefined && row.topic !== "" ? (
            <small className="uc-topic">{row.topic}</small>
          ) : null}
          <p className="uc-question">
            {question}
            {row.required && row.issue === undefined ? (
              <em className="cs-required">Required</em>
            ) : null}
          </p>
          {hint !== "" ? <p className="uc-hint">{hint}</p> : null}
          {step === undefined &&
          row.context !== undefined &&
          row.context !== "" ? (
            <p className="uc-hint">{row.context}</p>
          ) : null}
          {row.source === "CONFLICT" ? (
            <p className="uc-hint">The sources disagree.</p>
          ) : null}
          {answeredAlready ? (
            <p className="uc-hint">This question is answered.</p>
          ) : null}
          {row.unchecked === true && !answeredAlready ? (
            <p className="cs-unchecked">
              The reviewer agent has not checked the wording of this question.
            </p>
          ) : null}
          {why !== "" ? (
            <details className="cs-why">
              <summary>Why this matters</summary>
              <p>{why}</p>
            </details>
          ) : null}
        </li>
        {here.map((note) => (
          <li
            key={note.id}
            className={`uc-msg ${note.who === "agent" ? "is-agent" : "is-person"}`}
          >
            {note.text}
          </li>
        ))}
        {reading !== null && reading.at === keyOf ? (
          <li className="uc-msg is-agent">
            <p>
              I&apos;ll record: <strong>{reading.value}</strong>
            </p>
            <div className="uc-actions">
              <button
                type="button"
                className="btn btn-sm"
                disabled={saving || !canAct}
                onClick={() => {
                  const value = reading.value;
                  setReading(null);
                  void next({ value, typed: !choices.includes(value) });
                }}
              >
                {saving ? "Saving…" : "Record it"}
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={saving}
                onClick={() => {
                  setMessage(reading.value);
                  setReading(null);
                }}
              >
                Change it
              </button>
            </div>
          </li>
        ) : null}
        {asking ? (
          <li className="uc-msg is-agent is-typing" role="status">
            <span className="sr-only">The planner is reading the reply.</span>
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </li>
        ) : null}
      </>,
      answeredAlready ? (
        <div className="uc-reply">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => goForward(draft, position)}
          >
            Continue
            <UiIcon name="arrow" size={14} />
          </button>
        </div>
      ) : locked ? null : (
        <div className="uc-reply">
          {choices.length > 0 ? (
            // biome-ignore lint/a11y/useSemanticElements: a row of answer buttons, not a fieldset
            <div
              className={`uc-chips${longChoices(choices) ? " is-long" : ""}`}
              role="group"
              aria-label="Suggested answers"
            >
              {choices.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`uc-chip${option === proposed ? " is-suggested" : ""}`}
                  disabled={saving || asking}
                  onClick={() => void next({ value: option, typed: false })}
                >
                  {option}
                  {option === proposed && tag !== "" ? (
                    <span className="cs-tag">{tag}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          <form
            className="uc-compose"
            autoComplete="off"
            onSubmit={(event) => void send(event)}
          >
            <input
              type="text"
              value={message}
              maxLength={600}
              disabled={saving || asking}
              placeholder={
                choices.length > 0
                  ? "Or reply in your own words"
                  : "Type the organization's answer"
              }
              aria-label={`Reply to: ${question}`}
              onChange={(event) => setMessage(event.target.value)}
            />
            <button
              type="submit"
              className="btn btn-sm"
              disabled={saving || asking || message.trim() === ""}
            >
              {asking ? "Reading…" : "Send"}
            </button>
          </form>
          {row.issue !== undefined ? (
            <button
              type="button"
              className="cs-link"
              disabled={saving}
              onClick={setAside}
            >
              {row.issue.conflict ? "Dismiss" : "Not applicable"}
            </button>
          ) : null}
        </div>
      ),
    );
  }

  return (
    <>
      {conversation !== null ? (
        <p className="uc-back">
          <button
            type="button"
            className="cs-link"
            onClick={() => setMode("chat")}
          >
            Back to the conversation
          </button>
        </p>
      ) : null}
      <section
        key={keyOf}
        className="cs-card cs-question"
        aria-labelledby="cs-q-title"
      >
        {row.topic !== undefined && row.topic !== "" ? (
          <p className="cs-topic">{row.topic}</p>
        ) : null}
        <h3 id="cs-q-title">
          {question}
          {row.required && row.issue === undefined ? (
            <em className="cs-required">Required</em>
          ) : null}
        </h3>
        {hint !== "" ? <p className="cs-help">{hint}</p> : null}
        {step === undefined &&
        row.context !== undefined &&
        row.context !== "" ? (
          <p className="cs-help">{row.context}</p>
        ) : null}
        {row.source === "CONFLICT" ? (
          <p className="cs-help">The sources disagree.</p>
        ) : null}
        {answeredAlready ? (
          <p className="cs-help">This question is answered.</p>
        ) : null}
        {row.unchecked === true && !answeredAlready ? (
          <p className="cs-unchecked">
            The reviewer agent has not checked the wording of this question.
          </p>
        ) : null}
        <fieldset
          className={`cs-options${longChoices(choices) ? " is-long" : ""}`}
        >
          <legend className="sr-only">{question}</legend>
          {choices.map((option) => (
            <label
              key={option}
              className={`cs-option${!isWriting && chosen === option ? " is-on" : ""}`}
            >
              <input
                type="radio"
                name={`cs-${keyOf}`}
                checked={!isWriting && chosen === option}
                disabled={locked}
                onChange={() => {
                  setWriting((now) => ({ ...now, [keyOf]: false }));
                  setSelected((now) => ({ ...now, [keyOf]: option }));
                }}
              />
              {option}
              {option === proposed && tag !== "" && !answeredAlready ? (
                <span className="cs-tag">{tag}</span>
              ) : null}
            </label>
          ))}
          {choices.length > 0 && !answeredAlready ? (
            <label className={`cs-option${isWriting ? " is-on" : ""}`}>
              <input
                type="radio"
                name={`cs-${keyOf}`}
                checked={isWriting}
                disabled={locked}
                onChange={() =>
                  setWriting((now) => ({ ...now, [keyOf]: true }))
                }
              />
              Other (specify)
            </label>
          ) : null}
        </fieldset>
        {isWriting ? (
          <input
            className="cs-other"
            type="text"
            maxLength={step !== undefined ? 140 : 300}
            value={words}
            disabled={locked}
            placeholder="Type the organization's answer"
            aria-label={`Answer to: ${question}`}
            onChange={(event) =>
              setTyped((now) => ({ ...now, [keyOf]: event.target.value }))
            }
          />
        ) : null}
        {why !== "" ? (
          <details className="cs-why">
            <summary>Why this matters</summary>
            <p>{why}</p>
          </details>
        ) : null}
        {problem !== null || action.problem !== null ? (
          <p className="cc-problem" role="alert">
            {problem ?? action.problem}
          </p>
        ) : null}
        <div className="cs-card-foot">
          <span>
            Topic {rowNumber} of {rows.length}
          </span>
          <span className="cs-card-links">
            {row.issue !== undefined && !locked ? (
              <button
                type="button"
                className="cs-link"
                disabled={saving}
                onClick={setAside}
              >
                {row.issue.conflict ? "Dismiss" : "Not applicable"}
              </button>
            ) : null}
            {onSkip !== null ? (
              <button type="button" className="cs-link" onClick={onSkip}>
                Skip for now
              </button>
            ) : null}
          </span>
        </div>
      </section>
      <div className="cs-actions">
        {position > 0 || onBack !== null ? (
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              position > 0 ? setScreenAt(position - 1) : onBack?.()
            }
          >
            Back
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          disabled={!canAct || saving}
          onClick={() => void next()}
        >
          {saving ? (
            <span className="spinner small" aria-hidden="true" />
          ) : null}
          {saving ? "Saving…" : "Continue"}
          {saving ? null : <UiIcon name="arrow" size={14} />}
        </button>
      </div>
    </>
  );
}

/**
 * The questions that ask which policy, procedure or standard governs the control,
 * answered with a document linked to it (product owner, 2 November 2026: one source, so
 * the name in the control's wording and the file never disagree). Choosing one saves its
 * title as the answer; with none linked, the documents panel below links or uploads it.
 */
function DocumentQuestions({
  ids,
  slots,
  documents,
  canAct,
}: {
  ids: Ids;
  slots: Slot[];
  documents: GoverningDocument[];
  canAct: boolean;
}) {
  const action = useAction(ids);
  const [saving, setSaving] = useState("");
  const choices = documentChoices(documents);
  if (slots.length === 0) {
    return null;
  }
  async function choose(slot: Slot, title: string) {
    if (title === slot.value.trim()) {
      return;
    }
    setSaving(slot.key);
    await action.run("values", {
      intent: "values-set",
      values: { [slot.key]: title },
      everywhere: false,
    });
    setSaving("");
  }
  return (
    <div className="cs-docq">
      {slots.map((slot) => {
        const current = slot.value.trim();
        const linked = choices.some((item) => item.title === current);
        return (
          <fieldset key={slot.key} className="cs-docq-item">
            <legend>
              {slot.question.trim() || slot.label}
              {slot.blocks ? <em className="cs-required">Required</em> : null}
            </legend>
            <p className="cs-source">
              <UiIcon name="sparkles" size={13} />
              {current === NO_DOCUMENT
                ? "Recorded: the organization has no formal document. The control is tested against its established practice."
                : current === ""
                  ? choices.length > 0
                    ? "Choose the linked document that answers this, or record that there is none."
                    : "Link or upload the document below, or record that the organization has none."
                  : linked
                    ? "Answered by the linked document selected."
                    : choices.length > 0
                      ? `On record as "${current}", which is not a linked document. Choose the document that governs the control.`
                      : `On record as "${current}". Link that document below so the answer rests on it.`}
            </p>
            <div className="cs-options">
              {choices.map((item) => (
                <label
                  key={item.id}
                  className={`cs-option${current === item.title ? " is-on" : ""}`}
                >
                  <input
                    type="radio"
                    name={`cs-doc-${slot.key}`}
                    checked={current === item.title}
                    disabled={!canAct || saving !== ""}
                    onChange={() => void choose(slot, item.title)}
                  />
                  <UiIcon name="file" size={13} />
                  {item.title}
                </label>
              ))}
              <label
                className={`cs-option${current === NO_DOCUMENT ? " is-on" : ""}`}
              >
                <input
                  type="radio"
                  name={`cs-doc-${slot.key}`}
                  checked={current === NO_DOCUMENT}
                  disabled={!canAct || saving !== ""}
                  onChange={() => void choose(slot, NO_DOCUMENT)}
                />
                {NO_DOCUMENT}
              </label>
              {saving === slot.key ? (
                <span
                  className="spinner small"
                  role="status"
                  aria-label="Saving"
                />
              ) : null}
            </div>
          </fieldset>
        );
      })}
      {action.problem !== null ? (
        <p className="cc-problem" role="alert">
          {action.problem}
        </p>
      ) : null}
    </div>
  );
}
