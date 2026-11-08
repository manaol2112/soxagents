"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AgentAvatar } from "./agent-avatar";
import { useAction } from "./control-context-view";
import {
  agentQuestions,
  answerChoices,
  choiceTag,
  confirmPlan,
  type Draft,
  documentChoices,
  firstToAnswer,
  introHeadline,
  longChoices,
  NO_DOCUMENT,
  nextScreen,
  type Pick,
  type Prefill,
  prefillAnswers,
  questionsLeft,
  type Screen,
  type SetupInput,
  type SetupIssue,
  type SetupStep,
  type SetupStepKey,
  STEP_BRIEF,
  saveOne,
  screensFor,
  setupBegunKey,
  setupDraftKey,
  setupState,
  setupSteps,
  summaryRows,
} from "./control-setup-model";
import { RecordDialog } from "./record-dialog";
import { acceptProposal, controlProposals } from "./references-view";
import { layerIcon } from "./system-layer";
import { UiIcon } from "./ui-icon";

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

/** What each step is for, under its title. */
const STEP_HELP: Record<SetupStepKey, string> = {
  answers: "",
  process:
    "How the business process runs and where this control sits in it. The agent drafts the steps from the answers; confirm them or correct them.",
  attributes:
    "What the test checks on each item. Decide each one the agent proposes: approved attributes become the testing criteria.",
  documents:
    "Policies, procedures, narratives or diagrams that govern this control, where the client has them. The agent reads them to sharpen the plan and the evidence requests.",
  plan: "The test plan the agent drafted from everything above: procedures, attributes and the evidence each needs. Once a person approves it, evidence can be requested.",
};

const BENEFITS = [
  "A client-specific process narrative",
  "Tailored test procedures",
  "Focused evidence requests",
];

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
  controlRef,
  input,
  readinessBlocked,
  holds,
  slots,
  issues,
  documents,
  panels,
  hrefs,
  controlTitle,
  systemName,
  systemLayer = null,
}: {
  ids: Ids;
  controlRef: string;
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
  hrefs: { evidence: string; design: string; risk: string };
  /** For the introduction's context: the control's title and its system. */
  controlTitle: string;
  systemName: string;
  /** The system's type, for its icon on the introduction (system-layer.ts). */
  systemLayer?: string | null;
}) {
  const steps = useMemo(() => setupSteps(input), [input]);
  const state = setupState(steps, readinessBlocked);
  const [open, setOpen] = useState(state.opensForViewer);
  const [current, setCurrent] = useState<SetupStepKey | null>(state.first);
  // The introduction comes first when the setup opens on its own, until the person
  // begins it in this browser (product owner, 2 November 2026). Undecided until the
  // browser is read, so the server and the first render agree.
  const [intro, setIntro] = useState<boolean | null>(null);
  const opensOnItsOwn = state.opensForViewer;
  const begunKey = setupBegunKey(ids.controlId);
  useEffect(() => {
    let begun = false;
    try {
      begun = window.localStorage.getItem(begunKey) === "1";
    } catch {
      begun = false;
    }
    setIntro(opensOnItsOwn && !begun);
  }, [begunKey, opensOnItsOwn]);
  const begin = () => {
    try {
      window.localStorage.setItem(begunKey, "1");
    } catch {
      // Without storage the introduction shows again next visit; nothing else changes.
    }
    setCurrent(state.first);
    setIntro(false);
  };
  const can = input.canAct || input.canApprove;

  if (!can || (state.complete && !open)) {
    return null;
  }
  const index = Math.max(
    0,
    steps.findIndex((step) => step.key === current),
  );
  const step = steps[index] ?? null;
  const showReady = state.complete;
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
  return (
    <>
      <button
        type="button"
        className={`cs-resume${state.opensForViewer ? " is-mine" : ""}`}
        onClick={() => {
          setCurrent(state.first);
          setIntro(false);
          setOpen(true);
        }}
        title={state.waitingOn || "Open the guided setup"}
      >
        <UiIcon name="sparkles" size={14} />
        {state.waitingOn !== "" ? state.waitingOn : "Resume setup"}
      </button>
      {open && intro === true && !state.complete ? (
        <SetupIntro
          controlRef={controlRef}
          controlTitle={controlTitle}
          systemName={systemName}
          systemLayer={systemLayer}
          steps={steps}
          questions={questionsLeft(input)}
          onBegin={begin}
          onLater={() => setOpen(false)}
        />
      ) : open && intro !== null ? (
        <RecordDialog
          icon={
            showReady ? (
              <AgentAvatar
                state="done"
                size={58}
                label="Audit Agent"
                says="This control is ready for evidence gathering."
              />
            ) : (
              <UiIcon name="layers" size={26} />
            )
          }
          eyebrow={`Control setup · ${controlRef}`}
          title={
            showReady ? "Ready for evidence" : "Build control understanding"
          }
          description={
            showReady
              ? "The control is understood and its test plan is approved. Evidence can now be requested from the client."
              : "Provide a few key details so the agent can tailor the procedures, attributes, and evidence requests for this control."
          }
          closeHref=""
          className={`cs-dialog${showReady ? " is-ready" : ""}`}
          onClose={() => setOpen(false)}
        >
          <div className="cs-layout">
            <aside className="cs-rail" aria-label="Setup steps">
              <ol className="cs-steps">
                {steps.map((each, at) => (
                  <li
                    key={each.key}
                    className={`${each.done ? "is-done" : ""}${!showReady && each.key === step?.key ? " is-on" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => setCurrent(each.key)}
                      disabled={showReady}
                      aria-current={
                        !showReady && each.key === step?.key
                          ? "step"
                          : undefined
                      }
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
              <section className="cs-gets" aria-labelledby="cs-gets-title">
                <h3 id="cs-gets-title">
                  <UiIcon name="sparkles" size={16} />
                  What you'll get
                </h3>
                <ul>
                  {BENEFITS.map((text) => (
                    <li key={text}>
                      <UiIcon name="check" size={13} />
                      {text}
                    </li>
                  ))}
                </ul>
              </section>
            </aside>

            <div className="cs-main">
              {showReady ? (
                <>
                  <section className="cs-card cs-ready">
                    <span className="cs-ready-mark" aria-hidden="true">
                      <UiIcon name="check" size={26} />
                    </span>
                    <h3>The control is ready for evidence gathering</h3>
                    <ul className="cs-ready-list">
                      {steps
                        .filter((each) => each.done)
                        .map((each) => (
                          <li key={each.key}>
                            <UiIcon name="check" size={13} />
                            {each.title}
                            <small>{each.summary}</small>
                          </li>
                        ))}
                    </ul>
                  </section>
                  <div className="cs-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setOpen(false)}
                    >
                      Stay here
                    </button>
                    <Link
                      className="btn"
                      href={hrefs.evidence}
                      scroll={false}
                      onClick={() => setOpen(false)}
                    >
                      Go to evidence
                      <UiIcon name="arrow" size={14} />
                    </Link>
                  </div>
                </>
              ) : (
                <>
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
                      onSkip={() => setOpen(false)}
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
                            <span className="cs-waiting">
                              Waits on someone else
                            </span>
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
                          {step.key === "plan" &&
                          holds.length > 0 &&
                          !step.done ? (
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
                        <div className="cs-card-foot">
                          <Link
                            className="cs-link"
                            href={
                              step.key === "documents"
                                ? hrefs.risk
                                : hrefs.design
                            }
                            scroll={false}
                            onClick={() => setOpen(false)}
                          >
                            Open on the page
                          </Link>
                          <button
                            type="button"
                            className="cs-link"
                            onClick={() => setOpen(false)}
                          >
                            Skip for now
                          </button>
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
                          <button
                            type="button"
                            className="btn"
                            onClick={goNext}
                          >
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
                </>
              )}
            </div>
          </div>
        </RecordDialog>
      ) : null}
    </>
  );
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
}: {
  ids: Ids;
  slots: Slot[];
  issues: readonly SetupIssue[];
  canAct: boolean;
  onDone: () => void;
  /** The step before, when there is one. */
  onBack: (() => void) | null;
  onSkip: () => void;
}) {
  const action = useAction(ids);
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
    onDone();
  }

  // A question raised while the summary is open is asked before it is confirmed.
  const current = screenAt ?? firstToAnswer(rows, draft);
  if (current === null) {
    const summary = summaryRows(rows, draft);
    const pending = Object.keys(confirmPlan(rows, draft).settled).length;
    return (
      <>
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
          <div className="cs-card-foot">
            <span />
            <button type="button" className="cs-link" onClick={onSkip}>
              Skip for now
            </button>
          </div>
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

  async function next() {
    if (row === undefined || screen === undefined) {
      return;
    }
    const value = isWriting ? words.trim() : chosen;
    if (answeredAlready) {
      goForward(draft, position);
      return;
    }
    if (value === "") {
      setProblem("Choose an answer, or type one.");
      return;
    }
    setProblem(null);
    const pick: Pick = isWriting ? { other: value } : { label: value };
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

  return (
    <>
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
            placeholder="Type the client's answer"
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
            <button type="button" className="cs-link" onClick={onSkip}>
              Skip for now
            </button>
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
                ? "Recorded: the client has no formal document. The control is tested against its established practice."
                : current === ""
                  ? choices.length > 0
                    ? "Choose the linked document that answers this, or record that there is none."
                    : "Link or upload the document below, or record that the client has none."
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

/** Each step's mark on the introduction. */
const STEP_ICON: Record<SetupStepKey, Parameters<typeof UiIcon>[0]["name"]> = {
  answers: "layers",
  process: "flow",
  attributes: "chart",
  documents: "file",
  plan: "folder",
};

const GETS: ReadonlyArray<{
  icon: Parameters<typeof UiIcon>[0]["name"];
  text: string;
}> = [
  { icon: "layers", text: "Client-specific control understanding" },
  { icon: "file", text: "Tailored test procedures" },
  { icon: "inbox", text: "Focused evidence requests" },
];

/** What the setup produces, opened on request from the introduction. */
const CREATES = [
  "A process narrative for this client, drafted from the answers.",
  "Test procedures tailored to how the client runs the control.",
  "Approved test attributes: what each sample is checked for.",
  "Evidence requests for the client, prepared from the approved plan.",
];

/**
 * The introduction before the guided setup (product owner, 2 November 2026, to the
 * owner's reference): what the control is and where it sits, what the setup gives, what
 * the person is asked to do, and the steps it covers. Let's begin opens the wizard; I'll
 * do this later closes it for the visit, as Skip for now does.
 */
function SetupIntro({
  controlRef,
  controlTitle,
  systemName,
  systemLayer,
  steps,
  questions,
  onBegin,
  onLater,
}: {
  controlRef: string;
  controlTitle: string;
  systemName: string;
  systemLayer: string | null;
  steps: SetupStep[];
  questions: number;
  onBegin: () => void;
  onLater: () => void;
}) {
  const [more, setMore] = useState(false);
  const name = [controlRef, controlTitle].filter(Boolean).join(" ");
  const where =
    systemName !== ""
      ? ` is mapped to the ${systemName} system`
      : " is in scope";
  const context = `${name}${where}. The agent understands the control objective and its current structure, but needs a few client-specific details to tailor the procedures, attributes, and evidence requests for this control.`;
  return (
    <RecordDialog
      icon={
        <AgentAvatar
          state="attention"
          size={60}
          label="Audit Agent"
          says="A few details about this control are needed before evidence can be requested."
        />
      }
      eyebrow={
        <>
          <span className="cs-agent-name">Audit Agent</span>{" "}
          <span className="cs-setup-badge">Setup required</span>
        </>
      }
      title="Let's set up this control"
      description={context}
      closeHref=""
      className="cs-dialog cs-intro"
      onClose={onLater}
    >
      <div className="cs-intro-hero" aria-hidden="true">
        <span className="cs-hero-card is-back" />
        <span className="cs-hero-card is-mid" />
        <span className="cs-hero-card is-front">
          <UiIcon name={layerIcon(systemLayer)} size={30} />
          {systemName !== "" ? <small>{systemName}</small> : null}
        </span>
        <span className="cs-hero-shield">
          <UiIcon name="shield" size={34} />
          <UiIcon name="check" size={16} />
        </span>
      </div>
      <div className="cs-intro-body">
        <ul className="cs-intro-gets">
          {GETS.map((item) => (
            <li key={item.text}>
              <span className="cs-intro-gets-icon" aria-hidden="true">
                <UiIcon name={item.icon} size={20} />
              </span>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
        <div className="cs-intro-note">
          <span className="cs-intro-note-icon" aria-hidden="true">
            <UiIcon name="info" size={20} />
          </span>
          <p>
            <strong>{introHeadline(questions)}</strong>
            <span>
              You'll review and approve the results before anything is used.
            </span>
          </p>
        </div>
        <section className="cs-intro-plan" aria-labelledby="cs-intro-steps">
          <h3 id="cs-intro-steps">
            This setup will cover {steps.length} steps
          </h3>
          <ol className="cs-intro-steps">
            {steps.map((step) => (
              <li key={step.key} className={step.done ? "is-done" : undefined}>
                <span className="cs-intro-mark" aria-hidden="true">
                  <UiIcon
                    name={step.done ? "check" : STEP_ICON[step.key]}
                    size={18}
                  />
                </span>
                <span className="cs-intro-card">
                  <strong>{step.title}</strong>
                  <small>{STEP_BRIEF[step.key]}</small>
                  <span className="cs-intro-chip">
                    {step.done ? `Done · ${step.summary}` : "Upcoming"}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>
        {more ? (
          <section
            className="cs-intro-more"
            id="cs-intro-creates"
            aria-label="What this setup creates"
          >
            <ul>
              {CREATES.map((text) => (
                <li key={text}>
                  <UiIcon name="check" size={13} />
                  {text}
                </li>
              ))}
            </ul>
            <p>
              Nothing is requested from the client until a person approves the
              test plan.
            </p>
          </section>
        ) : null}
      </div>
      <footer className="cs-intro-foot">
        <button
          type="button"
          className="cs-link"
          aria-expanded={more}
          aria-controls="cs-intro-creates"
          onClick={() => setMore((now) => !now)}
        >
          {more
            ? "Hide what this setup creates"
            : "Learn what this setup creates"}
          <UiIcon name="chevron" size={13} />
        </button>
        <div className="cs-intro-actions cs-actions">
          <button type="button" className="btn-secondary" onClick={onLater}>
            I'll do this later
          </button>
          <button type="button" className="btn" onClick={onBegin}>
            Let's begin
            <UiIcon name="arrow" size={14} />
          </button>
        </div>
      </footer>
    </RecordDialog>
  );
}
