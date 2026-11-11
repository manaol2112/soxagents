"use client";

import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";
import {
  ClientWalkthrough,
  WALK_ASK_EVENT,
  WALK_POINTS_EVENT,
} from "./client-walkthrough";
import {
  type WalkDocument,
  walkPoints,
  walkSettled,
} from "./client-walkthrough-model";
import {
  ATTRIBUTE_MAX,
  type Attribute,
  type AttributeDecisionKind,
  type AttributeDefinition,
  attributeLetter,
  attributesSummary,
  BASIS_LABELS,
  CLASSIFICATIONS,
  type Classification,
  CONFIDENCE_LABELS,
  type Confidence,
  type ContextIssue,
  type ControlContext,
  contextProblem,
  type Design,
  DOCUMENT_KINDS,
  type DocumentKind,
  decidedNote,
  FREQUENCY_LABELS,
  type LibraryUpdate,
  NATURE_LABELS,
  PROCEDURE_PHASES,
  type ProcessStep,
  SECTION_HEADINGS,
  SOURCE_LABELS,
  selectionPlan,
  type Testing,
  TYPE_LABELS,
  type Understanding,
} from "./control-context-model";
import {
  type NarrativeAttribute,
  NarrativeSources,
  NarrativeUses,
  ProcessNarrative,
} from "./process-narrative";
import { RecordDialog } from "./record-dialog";
import { RowMenu, type RowMenuItem } from "./row-menu";
import { type IconName, UiIcon } from "./ui-icon";
import { isTopmostDialog, useFocusTrap } from "./use-focus-trap";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** One call to the context route; refreshes the page's data when it succeeds. */
export function useAction(ids: Ids) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState("");
  async function run(
    label: string,
    fields: Record<string, unknown>,
  ): Promise<boolean> {
    setBusy(label);
    setProblem(null);
    let status = 0;
    let detail = "";
    let answer = "";
    try {
      const response = await fetch("/workspace/control-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          ...fields,
        }),
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
        context?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
      const context = body.context as { note?: unknown } | null;
      answer =
        context !== null && typeof context?.note === "string"
          ? context.note
          : "";
    } catch {
      status = 0;
    }
    setBusy("");
    const message = contextProblem(status, detail);
    setProblem(message);
    setNote(answer);
    if (message === null) {
      startTransition(() => router.refresh());
    }
    return message === null;
  }
  return {
    run,
    busy,
    pending: pending || busy !== "",
    problem,
    note,
    setProblem,
  };
}

function Problem({ text }: { text: string | null }) {
  return text === null ? null : (
    <p className="cc-problem" role="alert">
      {text}
    </p>
  );
}

// Readiness

// Attributes

function Badge({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`cc-badge ${tone}`}>{children}</span>;
}

function Rule({ label, text }: { label: string; text: string }) {
  return text === "" ? null : (
    <>
      <dt>{label}</dt>
      <dd>{text}</dd>
    </>
  );
}

/** How one attribute is tested, as its rules. */
function DefinitionRules({ definition }: { definition: AttributeDefinition }) {
  return (
    <dl className="cc-def-list">
      <Rule label="Applies when" text={definition.condition} />
      <Rule label="Why" text={definition.why} />
      <Rule label="Evidence" text={definition.evidence.join("; ")} />
      <Rule label="Read from it" text={definition.extract.join("; ")} />
      <Rule label="Compare" text={definition.compare} />
      <Rule label="Pass" text={definition.passes} />
      <Rule label="Exception" text={definition.fails} />
      <Rule label="Insufficient evidence" text={definition.insufficient} />
      <Rule label="Human review" text={definition.review} />
      <Rule label="Do not infer" text={definition.notInfer} />
      <Rule label="Basis" text={definition.basis.join("; ")} />
      <Rule label="Open question" text={definition.question} />
    </dl>
  );
}

const CHANGE_WORDS: Record<LibraryUpdate["items"][number]["change"], string> = {
  KEEP: "Keep",
  REWORD: "Reword",
  ADD: "Add",
  PROPOSE: "Propose",
  RETIRE: "Retire",
};

/** What the current library version changes on a control copied from an older one, for
 * a person to adopt. Nothing changes until they do. */
function LibraryUpdatePanel({
  ids,
  update,
  canAct,
}: {
  ids: Ids;
  update: LibraryUpdate;
  canAct: boolean;
}) {
  const action = useAction(ids);
  const changes = update.items.filter((item) => item.change !== "KEEP");
  return (
    <section className="cc-update" aria-label="Library update">
      <div className="cc-update-head">
        <h4>
          Library version {update.currentVersion} is available{" "}
          <span className="num">{changes.length}</span>
        </h4>
        {canAct ? (
          <button
            type="button"
            className="btn-sm"
            disabled={action.pending}
            onClick={() => action.run("adopt", { intent: "library-adopt" })}
          >
            {action.busy === "adopt"
              ? "Adopting…"
              : `Adopt version ${update.currentVersion}`}
          </button>
        ) : null}
      </div>
      <p className="form-hint">
        This control was copied from version {update.libraryVersion}.{" "}
        {update.note} Low-confidence attributes come in as proposals and are not
        tested until you approve them.
      </p>
      {update.fields.length > 0 ? (
        <dl className="cc-def-list">
          {update.fields.map((item) => (
            <Rule
              key={item.field}
              label={item.field === "activity" ? "Description" : item.field}
              text={item.now}
            />
          ))}
        </dl>
      ) : null}
      {update.splits.length > 0 ? (
        <ul className="cc-list">
          {update.splits.map((item) => (
            <li key={item.controlRef} className="cc-item is-proposed">
              <Badge tone="is-proposal">New control</Badge>
              <div className="cc-item-body">
                <p className="cc-text">
                  {item.controlRef} {item.title}
                </p>
                <p className="cc-why">{item.reason}</p>
              </div>
              <span />
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="cc-list">
        {changes.map((item) => (
          <li key={item.key + item.was} className="cc-item is-proposed">
            <Badge
              tone={item.change === "RETIRE" ? "is-conflict" : "is-proposal"}
            >
              {CHANGE_WORDS[item.change]}
            </Badge>
            <div className="cc-item-body">
              {item.was !== "" ? (
                <p className="cc-replaces">{item.was}</p>
              ) : null}
              {item.text !== "" ? <p className="cc-text">{item.text}</p> : null}
              <p className="cc-why">{item.reason}</p>
            </div>
            <span />
          </li>
        ))}
      </ul>
      <Problem text={action.problem} />
    </section>
  );
}

/** The library's testing procedures for this control, by phase. */
function TestingProcedures({ testing }: { testing: Testing }) {
  return (
    <details className="cc-history cc-testing">
      <summary>
        How this control is tested{" "}
        <span className="num">{testing.procedures.length}</span>
      </summary>
      <dl className="cc-def-list">
        <Rule label="Objective" text={testing.objective} />
        <Rule label="Population" text={testing.population} />
        <Rule label="Sampling" text={testing.sampling} />
        <Rule label="Confirm the design" text={testing.designConfirmation} />
      </dl>
      <ol className="cc-procedures">
        {testing.procedures.map((procedure) => (
          <li key={procedure.key}>
            <Badge>{PROCEDURE_PHASES[procedure.phase]}</Badge>
            <p className="cc-text">{procedure.action}</p>
            <p className="cc-why">
              <span>Objective</span> {procedure.objective}
            </p>
            {procedure.evidence.length > 0 ? (
              <p className="cc-why">
                <span>Evidence</span> {procedure.evidence.join("; ")}
              </p>
            ) : null}
            {procedure.attributes.length > 0 ? (
              <p className="cc-why">
                <span>Attributes</span> {procedure.attributes.join("; ")}
              </p>
            ) : null}
            {procedure.limitation !== "" ? (
              <p className="cc-why">
                <span>Limitation</span> {procedure.limitation}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
      {testing.questions.length > 0 ||
      testing.assumptions.length > 0 ||
      testing.notApplicable.length > 0 ? (
        <dl className="cc-def-list">
          <Rule label="Questions" text={testing.questions.join(" ")} />
          <Rule label="Assumptions" text={testing.assumptions.join(" ")} />
          <Rule label="Not applicable" text={testing.notApplicable.join(" ")} />
        </dl>
      ) : null}
    </details>
  );
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The control's statement: what the control is, as its design documentation states it,
 * with the client's values in place and a form to fill the ones still missing. In the
 * Plan step the process narrative stands in for the design narrative, which is not shown
 * there (product owner, 26 October 2026). */
export function DesignPanel({
  ids,
  design,
  canAct,
  narrative = true,
  walkthrough = null,
}: {
  ids: Ids;
  design: Design;
  canAct: boolean;
  /** The narrative above the questions; the Plan step shows it in the control's
   * understanding instead. */
  narrative?: boolean;
  /** The walkthrough's surroundings: the control's documents, where they are read, who is
   * answering, where a question goes, and the process narrative drafted from the answers. */
  walkthrough?: {
    documents: WalkDocument[];
    policiesHref: string;
    askHref: string;
    viewer: string;
    understanding: Understanding | null;
    attributes: NarrativeAttribute[];
    /** The control's issues: the questions the narrative's agents raised among them. */
    issues: ContextIssue[];
    /** The system and the control, under the narrative's title. */
    subtitle?: string;
    /** The control's reference, shown on the flow where it operates. */
    controlRef?: string;
  } | null;
}) {
  const action = useAction(ids);
  const fillable = design.slots.filter((slot) => !slot.automatic);
  const [everywhere, setEverywhere] = useState(true);
  const questionOf = (slot: (typeof fillable)[number]) =>
    slot.question || sentence(slot.label);
  const waiting = walkPoints(walkthrough?.issues ?? [], SECTION_HEADINGS);
  // Once the narrative is approved and nothing waits, the conversation folds to one line
  // and the narrative leads (product owner, 27 October 2026); the answers stay on record.
  const standing = walkSettled(
    fillable.map((slot) => ({
      question: questionOf(slot),
      value: slot.value,
      filledAt: slot.filledAt,
    })),
    walkthrough?.understanding ?? { status: "NONE", confirmedAt: "" },
    waiting.length,
  );
  const [showAnswers, setShowAnswers] = useState(false);
  const folded = walkthrough !== null && standing.settled && !showAnswers;
  const walkRef = useRef<HTMLDivElement>(null);
  // An answer opened from the narrative's sources, or the points it sends back, open the
  // conversation again.
  useEffect(() => {
    const open = () => {
      setShowAnswers(true);
      window.setTimeout(() => {
        walkRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      }, 50);
    };
    document.addEventListener(WALK_ASK_EVENT, open);
    document.addEventListener(WALK_POINTS_EVENT, open);
    return () => {
      document.removeEventListener(WALK_ASK_EVENT, open);
      document.removeEventListener(WALK_POINTS_EVENT, open);
    };
  }, []);
  const facts: Array<[string, string]> = [
    ["Risk", design.risk],
    ["IT risk", design.itRisk],
    ["COSO principle", design.principle],
    ["Assertions", design.assertions.join(", ")],
    [
      "Type",
      [
        TYPE_LABELS[design.controlType] ?? design.controlType,
        NATURE_LABELS[design.nature] ?? design.nature,
        FREQUENCY_LABELS[design.frequency] ?? design.frequency,
      ].join(" · "),
    ],
    ["Performed by", design.operator],
    ["Reviewed by", design.reviewer],
    ["Owner", design.owner],
    ["Authority", design.authority],
    [
      "Judgment",
      `${sentence(design.judgment.toLowerCase())}: ${design.judgmentNote}`,
    ],
    ["Precision", design.precision],
    ["Outliers", design.investigation],
    ["Relies on", design.itgcs.join(", ")],
    ["Evidence", design.evidence],
    ["Applies when", design.appliesWhen],
  ];
  return (
    <section className="cc-design" aria-busy={action.pending}>
      {narrative ? <p className="cc-statement">{design.text}</p> : null}
      {narrative && design.missing.length > 0 ? (
        <p className="cc-design-missing">
          <UiIcon name="risk" size={13} />
          <span>
            Testing waits for{" "}
            {design.missing.length === 1 ? "this value" : "these values"}:{" "}
            {design.missing.join("; ")}.
          </span>
        </p>
      ) : null}
      {fillable.length > 0 ? (
        <div className="cc-values cc-walk">
          {/* The client's answers as a conversation, and the process narrative drafted
              from them beside it (decided by the product owner on 26 October 2026). */}
          <div className="cc-walk-main">
            {walkthrough !== null && standing.settled ? (
              <div className="wt-settled">
                <span className="wt-settled-icon" aria-hidden="true">
                  <UiIcon name="check" size={16} />
                </span>
                <div>
                  <h4>Client-specific information</h4>
                  <p>
                    {standing.answered}{" "}
                    {standing.answered === 1 ? "answer" : "answers"} confirmed.
                    The approved narrative and the test plan use them.
                    {standing.changed.length > 0 ? (
                      <span className="wt-settled-changed">
                        {" "}
                        {standing.changed.length === 1
                          ? "1 answer changed"
                          : `${standing.changed.length} answers changed`}{" "}
                        since the narrative was approved.
                      </span>
                    ) : null}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  aria-expanded={showAnswers}
                  onClick={() => setShowAnswers(!showAnswers)}
                >
                  {showAnswers ? "Hide answers" : "View or change answers"}
                </button>
              </div>
            ) : null}
            <div ref={walkRef} className="cc-walk-body" hidden={folded}>
              <ClientWalkthrough
                ids={ids}
                slots={fillable.map((slot) => ({
                  key: slot.key,
                  question: questionOf(slot),
                  hint: slot.hint,
                  example: slot.example,
                  options: slot.options,
                  blocks: slot.blocks,
                  value: slot.value,
                  filledBy: slot.filledBy,
                  kind: slot.kind,
                  label: slot.label,
                }))}
                // The facts the narrative's agents still need, as points to confirm together
                // (decided by the product owner on 26 October 2026).
                points={waiting}
                onConfirmPoints={(items) =>
                  action.run("points", { intent: "process-points", items })
                }
                canAct={canAct}
                documents={walkthrough?.documents ?? []}
                policiesHref={walkthrough?.policiesHref ?? "/"}
                askHref={walkthrough?.askHref ?? "/"}
                viewer={walkthrough?.viewer ?? ""}
                everywhere={everywhere}
                onEverywhere={setEverywhere}
                onSave={(key, value) =>
                  action.run("values", {
                    intent: "values-set",
                    values: { [key]: value },
                    everywhere,
                  })
                }
                // Context added to an answer: a walkthrough note on this control, which
                // the narrative's agents read (28 October 2026).
                onNote={(question, text) =>
                  action.run("note", {
                    intent: "document-write",
                    kind: "WALKTHROUGH",
                    title: `Walkthrough note: ${question}`.slice(0, 200),
                    body: text,
                    control_ids: [ids.controlId],
                  })
                }
                onAttach={(file) => attachToControl(ids, file)}
                onComplete={() => {
                  // Every question answered: the narrative is drafted and reviewed in the
                  // background.
                  if (canAct) {
                    void action.run("narrate", { intent: "process-narrate" });
                  }
                }}
                problem={action.busy === "process" ? null : action.problem}
                busy={action.pending}
              />
            </div>
            <details className="cc-def wt-design">
              <summary>How the control is designed</summary>
              <dl>
                {facts
                  .filter(([, text]) => text.trim() !== "")
                  .map(([label, text]) => (
                    <Rule key={label} label={label} text={text} />
                  ))}
                {design.information.length > 0 ? (
                  <>
                    <dt>Information used</dt>
                    <dd>
                      <ul className="cc-info">
                        {design.information.map((item) => (
                          <li key={item.name}>
                            {item.name}
                            {item.ipe !== "" ? <Badge>{item.ipe}</Badge> : null}
                            <span className="cc-by">
                              {" "}
                              · {item.elements.join(", ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </>
                ) : null}
              </dl>
            </details>
          </div>
          {walkthrough !== null ? (
            <div className="cc-walk-side">
              <ProcessNarrative
                ids={ids}
                subtitle={walkthrough.subtitle ?? ""}
                controlRef={walkthrough.controlRef ?? ""}
                understanding={walkthrough.understanding}
                attributes={walkthrough.attributes}
                canAct={canAct}
                busy={action.pending}
                problem={action.busy === "" ? action.problem : null}
                run={action.run}
                points={waiting.length > 0}
                changed={standing.changed}
              />
              <NarrativeSources
                sources={[
                  ...fillable
                    .filter((slot) => slot.value.trim() !== "")
                    .map((slot) => ({
                      key: `answer-${slot.key}`,
                      kind: "answer" as const,
                      title: slot.value,
                      detail: `Client-specific answer · ${slot.question || sentence(slot.label)}`,
                      slotKey: slot.key,
                    })),
                  ...walkthrough.documents.map((item) => ({
                    key: `document-${item.id}`,
                    kind: "document" as const,
                    title: item.title,
                    detail: item.detail,
                    href: walkthrough.policiesHref,
                  })),
                ]}
              />
              <NarrativeUses />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** The control's attributes: approved, proposed by the agent, and their history. */
/** Where an attribute's wording came from, as an icon beside its label. */
const SOURCE_ICONS: Record<Attribute["sourceKind"], IconName> = {
  LIBRARY: "layers",
  RCM: "table",
  MANUAL: "user",
  AGENT: "sparkles",
  DOCUMENT: "file",
};

const CONFIDENCE_LEVELS: Record<Confidence, number> = {
  HIGH: 4,
  MODERATE: 3,
  LOW: 2,
  NOT_ESTABLISHED: 1,
};

const CONFIDENCE_CHIPS: Record<Confidence, string> = {
  HIGH: "is-high",
  MODERATE: "is-moderate",
  LOW: "is-low",
  NOT_ESTABLISHED: "is-none",
};

/** Four bars, as many filled as the confidence is high. */
function ConfidenceBars({ confidence }: { confidence: Confidence }) {
  const level = CONFIDENCE_LEVELS[confidence];
  return (
    <svg
      className="ta-bars"
      width="14"
      height="12"
      viewBox="0 0 14 12"
      aria-hidden="true"
    >
      {[0, 1, 2, 3].map((bar) => (
        <rect
          key={bar}
          x={bar * 3.6}
          y={9 - bar * 3}
          width="2.4"
          height={3 + bar * 3}
          rx="0.8"
          fill="currentColor"
          opacity={bar < level ? 1 : 0.3}
        />
      ))}
    </svg>
  );
}

function SourceChip({ attribute }: { attribute: Attribute }) {
  return (
    <span className="ta-chip">
      <UiIcon name={SOURCE_ICONS[attribute.sourceKind]} size={13} />
      {attribute.sourceTitle || SOURCE_LABELS[attribute.sourceKind]}
    </span>
  );
}

function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  return (
    <span className={`ta-chip ${CONFIDENCE_CHIPS[confidence]}`}>
      <ConfidenceBars confidence={confidence} />
      {CONFIDENCE_LABELS[confidence]}
    </span>
  );
}

/** What an attribute is drawn from and how firmly it is established. */
function AttributeChips({ attribute }: { attribute: Attribute }) {
  return (
    <span className="ta-chips">
      <SourceChip attribute={attribute} />
      {attribute.basis === "INFERRED" ? (
        <span className="ta-chip is-inferred">Inferred</span>
      ) : null}
      {attribute.definition !== null ? (
        <ConfidenceChip confidence={attribute.definition.confidence} />
      ) : null}
    </span>
  );
}

type AttributeDialogState =
  | { mode: "add" }
  | { mode: "edit" | "review"; attribute: Attribute; letter: string };

/**
 * One attribute in a dialog (product owner, 2 November 2026): its wording to change, and
 * what the records hold about it. The source and the confidence are shown, never edited:
 * the source records where the wording came from (new wording is the team's), and the
 * confidence comes from the library's testing definition.
 */
function AttributeDialog({
  ids,
  state,
  replaced,
  onClose,
  onDone,
}: {
  ids: Ids;
  state: AttributeDialogState;
  /** The approved attribute a proposed change or retirement names, with its letter. */
  replaced: { letter: string; text: string } | null;
  onClose: () => void;
  onDone: (note: string) => void;
}) {
  const action = useAction(ids);
  const id = useId();
  const attribute = state.mode === "add" ? null : state.attribute;
  const [text, setText] = useState(attribute?.text ?? "");
  const wording = text.trim();
  const changed = wording !== (attribute?.text ?? "");
  const definition = attribute?.definition ?? null;
  const letter = state.mode === "add" ? "" : state.letter;
  const title =
    state.mode === "add"
      ? "Add attribute"
      : state.mode === "review"
        ? "Review proposed attribute"
        : "Edit attribute";
  const description =
    state.mode === "add"
      ? "Add one testable condition the test checks on each item."
      : state.mode === "review"
        ? "Decide the attribute the agent proposes for this control."
        : "Update the testing attribute for this control.";
  const note =
    state.mode === "add"
      ? "Recorded as written by the team. It joins the testing criteria when it is added."
      : state.mode === "edit"
        ? "New wording is recorded as written by the team. The current wording stays in the history."
        : replaced !== null
          ? `Approving replaces attribute ${replaced.letter}; its wording stays in the history. A change to the wording before approving is recorded.`
          : "Approving adds it to the testing criteria. A change to the wording before approving is recorded.";

  async function submit(decision: "APPROVE" | "REJECT" | null) {
    if (state.mode === "add") {
      if (
        await action.run("save", { intent: "attribute-add", text: wording })
      ) {
        onDone("Attribute added.");
      }
      return;
    }
    if (state.mode === "edit") {
      if (
        await action.run("save", {
          intent: "attribute-edit",
          attribute_id: state.attribute.id,
          text: wording,
          version: state.attribute.version,
        })
      ) {
        onDone(`Attribute ${letter} updated.`);
      }
      return;
    }
    const verdict = decision ?? "APPROVE";
    if (
      await action.run(verdict === "APPROVE" ? "save" : "reject", {
        intent: "attribute-decide",
        attribute_id: state.attribute.id,
        decision: verdict,
        version: state.attribute.version,
        ...(verdict === "APPROVE" && changed ? { text: wording } : {}),
      })
    ) {
      onDone(decidedNote(verdict, 1));
    }
  }

  const canSave =
    !action.pending && wording !== "" && (state.mode === "review" || changed);
  return (
    <RecordDialog
      icon={
        <UiIcon name={state.mode === "add" ? "plus" : "compose"} size={24} />
      }
      eyebrow={
        state.mode === "add"
          ? "New attribute"
          : state.mode === "review"
            ? "Proposed attribute"
            : `Attribute ${letter}`
      }
      title={title}
      description={description}
      closeHref=""
      className="tae-dialog"
      onClose={onClose}
    >
      <form
        autoComplete="off"
        className="tae-form"
        aria-busy={action.pending}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSave) {
            void submit(null);
          }
        }}
      >
        {replaced !== null ? (
          <p className="tae-replaces">
            <span>Replaces {replaced.letter}</span> {replaced.text}
          </p>
        ) : null}
        <div className="tae-field">
          <label htmlFor={`${id}-text`}>
            Testing attribute
            <span className="tae-required" aria-hidden="true">
              *
            </span>
          </label>
          <textarea
            id={`${id}-text`}
            value={text}
            rows={3}
            required
            maxLength={ATTRIBUTE_MAX}
            disabled={action.pending}
            aria-describedby={`${id}-count ${id}-note`}
            placeholder="One testable condition, such as who approves and by when"
            onChange={(event) => setText(event.target.value)}
          />
          <p className="tae-count" id={`${id}-count`}>
            {text.length} / {ATTRIBUTE_MAX}
          </p>
        </div>
        {attribute !== null ? (
          <dl className="tae-facts">
            <div>
              <dt>Source</dt>
              <dd>
                <SourceChip attribute={attribute} />
                {attribute.basis === "INFERRED" ? (
                  <span className="ta-chip is-inferred">Inferred</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>
                {definition !== null ? (
                  <ConfidenceChip confidence={definition.confidence} />
                ) : (
                  <span className="tae-none">
                    Not rated: no library testing definition
                  </span>
                )}
              </dd>
            </div>
          </dl>
        ) : null}
        {attribute !== null && attribute.sourceQuote !== "" ? (
          <blockquote className="tae-quote">
            <q>{attribute.sourceQuote}</q>
          </blockquote>
        ) : null}
        {attribute !== null &&
        attribute.note !== "" &&
        state.mode === "review" ? (
          <p className="tae-why">{attribute.note}</p>
        ) : null}
        <p className="tae-note" id={`${id}-note`}>
          {note}
        </p>
        {definition !== null ? (
          <details className="tae-how">
            <summary>
              <UiIcon name="info" size={18} />
              <span>
                <strong>How it is tested</strong>
                <small>{definition.compare || definition.condition}</small>
              </span>
              <span className="tae-how-caret" aria-hidden="true">
                <UiIcon name="chevron" size={16} />
              </span>
            </summary>
            <DefinitionRules definition={definition} />
          </details>
        ) : null}
        <Problem text={action.problem} />
        <footer className="tae-foot">
          <button
            type="button"
            className="btn-secondary"
            disabled={action.pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <span className="tae-foot-main">
            {state.mode === "review" ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={action.pending}
                onClick={() => void submit("REJECT")}
              >
                {action.busy === "reject" ? "Rejecting…" : "Reject"}
              </button>
            ) : null}
            <button type="submit" className="btn" disabled={!canSave}>
              {action.busy === "save" ? (
                <span className="spinner small" aria-hidden="true" />
              ) : (
                <UiIcon name="check" size={16} />
              )}
              {action.busy === "save"
                ? "Saving…"
                : state.mode === "add"
                  ? "Add attribute"
                  : state.mode === "review"
                    ? changed
                      ? "Approve with changes"
                      : "Approve"
                    : "Save changes"}
            </button>
          </span>
        </footer>
      </form>
    </RecordDialog>
  );
}

export function AttributesPanel({
  ids,
  context,
  canAct,
  compact = false,
  showQuestions = true,
}: {
  ids: Ids;
  context: ControlContext;
  canAct: boolean;
  /** Off in the guided setup, which asks the open questions on its own step. */
  showQuestions?: boolean;
  /** Inside the test plan, whose attribute table is the one list of the attributes (and
   * whose Procedures tab already says how each is tested): only what waits on a decision,
   * the agent's proposals and the history are shown here. */
  compact?: boolean;
}) {
  const action = useAction(ids);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<AttributeDialogState | null>(null);
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const [about, setAbout] = useState(false);
  const [done, setDone] = useState("");
  const aboutId = useId();
  const letters = new Map(
    context.approved.map((item, index) => [item.id, attributeLetter(index)]),
  );
  // Only what is still on the list stays chosen after a refresh.
  const live = new Set(
    [...context.approved, ...context.proposed].map((item) => item.id),
  );
  const selected = new Set([...chosen].filter((each) => live.has(each)));
  const plan = selectionPlan(selected, context);
  const issues = context.issues.filter((item) => item.origin !== "PROCESS");
  const lastOne = context.approved.length <= 1;

  function toggle(set: ReadonlySet<string>, each: string): Set<string> {
    const next = new Set(set);
    if (next.has(each)) {
      next.delete(each);
    } else {
      next.add(each);
    }
    return next;
  }

  async function decideMany(
    decision: AttributeDecisionKind,
    items: Attribute[],
  ) {
    setDone("");
    if (
      await action.run(`many-${decision}`, {
        intent: "attributes-decide",
        items: items.map((item) => ({
          attribute_id: item.id,
          decision,
          version: item.version,
        })),
      })
    ) {
      setChosen(new Set());
      setDone(decidedNote(decision, items.length));
    }
  }

  async function decideOne(decision: AttributeDecisionKind, item: Attribute) {
    setDone("");
    const ok =
      decision === "RETIRE"
        ? await action.run(`retire-${item.id}`, {
            intent: "attribute-retire",
            attribute_id: item.id,
            version: item.version,
          })
        : await action.run(`decide-${item.id}`, {
            intent: "attribute-decide",
            attribute_id: item.id,
            decision,
            version: item.version,
          });
    if (ok) {
      setDone(decidedNote(decision, 1));
    }
  }

  function row(item: Attribute, letter: string | null) {
    const proposed = item.status === "PROPOSED";
    const target =
      item.replacesId !== null
        ? (context.approved.find((each) => each.id === item.replacesId) ?? null)
        : null;
    const targetLetter = target !== null ? (letters.get(target.id) ?? "") : "";
    const open = shown.has(item.id);
    const name = letter !== null ? `attribute ${letter}` : "the proposal";
    const statusItems: RowMenuItem[] = proposed
      ? [
          {
            label:
              item.proposal === "RETIRE" ? "Approve the retirement" : "Approve",
            icon: "check",
            onSelect: () => void decideOne("APPROVE", item),
          },
          {
            label: "Reject",
            icon: "x",
            onSelect: () => void decideOne("REJECT", item),
          },
        ]
      : [
          {
            label: "Retire attribute",
            icon: "trash",
            danger: true,
            unavailable: lastOne
              ? "A control keeps at least one attribute."
              : null,
            onSelect: () => void decideOne("RETIRE", item),
          },
        ];
    const moreItems: RowMenuItem[] = [
      ...(item.definition !== null
        ? [
            {
              label: open ? "Hide how it is tested" : "Show how it is tested",
              icon: "info" as IconName,
              onSelect: () => setShown(toggle(shown, item.id)),
            },
          ]
        : []),
      ...(canAct ? statusItems : []),
    ];
    const editable = canAct && item.proposal !== "RETIRE";
    return (
      <li
        key={item.id}
        className={`ta-row${selected.has(item.id) ? " is-selected" : ""}${proposed ? " is-proposed" : ""}`}
      >
        {canAct ? (
          <input
            type="checkbox"
            className="ta-check"
            checked={selected.has(item.id)}
            disabled={action.pending}
            aria-label={`Select ${name}`}
            onChange={() => setChosen(toggle(selected, item.id))}
          />
        ) : null}
        <span className="ta-letter" aria-hidden={letter === null}>
          {letter ?? <UiIcon name="sparkles" size={15} />}
        </span>
        <div className="ta-main">
          {target !== null ? (
            <p className="ta-replaces">
              <span>
                {item.proposal === "RETIRE" ? "Retires" : "Replaces"}{" "}
                {targetLetter}
              </span>{" "}
              {target.text}
            </p>
          ) : null}
          <p className="ta-text">{item.text}</p>
          <AttributeChips attribute={item} />
          {item.sourceQuote !== "" ? (
            <q className="ta-quote">{item.sourceQuote}</q>
          ) : null}
          {proposed && item.note !== "" ? (
            <p className="ta-why">{item.note}</p>
          ) : null}
          {open && item.definition !== null ? (
            <div className="ta-how">
              <p className="ta-how-title">How it is tested</p>
              <DefinitionRules definition={item.definition} />
            </div>
          ) : null}
        </div>
        <div className="ta-side">
          {canAct ? (
            <RowMenu
              label={`Status of ${name}`}
              items={statusItems}
              trigger={
                proposed
                  ? {
                      label: "Proposed",
                      icon: "sparkles",
                      className: "ta-status is-proposed",
                    }
                  : {
                      label: "Approved",
                      icon: "check",
                      className: "ta-status is-approved",
                    }
              }
            />
          ) : (
            <span
              className={`ta-status ${proposed ? "is-proposed" : "is-approved"}`}
            >
              <UiIcon name={proposed ? "sparkles" : "check"} size={15} />
              {proposed ? "Proposed" : "Approved"}
            </span>
          )}
          {editable ? (
            <button
              type="button"
              className="ta-icon-button"
              disabled={action.pending}
              aria-label={proposed ? `Review ${name}` : `Edit ${name}`}
              title={proposed ? "Review" : "Edit"}
              onClick={() =>
                setDialog({
                  mode: proposed ? "review" : "edit",
                  attribute: item,
                  letter: letter ?? "proposed",
                })
              }
            >
              <UiIcon name="compose" size={16} />
            </button>
          ) : canAct ? (
            <span className="ta-icon-gap" aria-hidden="true" />
          ) : null}
          {moreItems.length > 0 ? (
            <RowMenu label={name} items={moreItems} />
          ) : (
            <span className="ta-icon-gap" aria-hidden="true" />
          )}
        </div>
      </li>
    );
  }

  const busyMany = action.busy.startsWith("many-");
  const dialogTarget =
    dialog !== null && dialog.mode !== "add"
      ? (context.approved.find(
          (each) => each.id === dialog.attribute.replacesId,
        ) ?? null)
      : null;
  return (
    <div className="cc-attributes ta" aria-busy={action.pending}>
      {context.libraryUpdate !== null ? (
        <LibraryUpdatePanel
          ids={ids}
          update={context.libraryUpdate}
          canAct={canAct}
        />
      ) : null}
      {compact ? null : (
        <section className="ta-reco" aria-labelledby={`${aboutId}-reco`}>
          <span className="ta-reco-icon" aria-hidden="true">
            <UiIcon name="sparkles" size={20} />
          </span>
          <div>
            <h4 id={`${aboutId}-reco`}>Agent recommendation</h4>
            <p>{attributesSummary(context)}</p>
            {about ? (
              <p className="ta-about" id={`${aboutId}-about`}>
                Approved attributes are the testing criteria: the test checks
                each one on every item. A proposal changes nothing until a
                person approves it, and a changed or retired attribute keeps its
                earlier wording in the history.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="ta-icon-button ta-about-button"
            aria-label="About testing attributes"
            aria-expanded={about}
            aria-controls={`${aboutId}-about`}
            onClick={() => setAbout(!about)}
          >
            <UiIcon name="info" size={18} />
          </button>
        </section>
      )}
      {compact ? null : (
        <div className="ta-head">
          <h4>
            Testing attributes{" "}
            <span className="ta-count">({context.approved.length})</span>
          </h4>
          {canAct ? (
            <span className="ta-head-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={action.pending}
                onClick={() =>
                  action.run("generate", { intent: "attributes-generate" })
                }
              >
                <UiIcon name="sparkles" size={15} />
                {action.busy === "generate"
                  ? "Reading the sources…"
                  : "Propose with the agent"}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={action.pending}
                onClick={() => setDialog({ mode: "add" })}
              >
                <UiIcon name="plus" size={15} />
                Add attribute
              </button>
            </span>
          ) : null}
        </div>
      )}
      {canAct && compact ? (
        <p className="cc-propose">
          <span>
            The agent can read the sources and the approved narrative and
            propose attributes to add, change or retire.
          </span>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={action.pending}
            onClick={() =>
              action.run("generate", { intent: "attributes-generate" })
            }
          >
            <UiIcon name="sparkles" size={13} />{" "}
            {action.busy === "generate"
              ? "Reading the sources…"
              : "Propose with the agent"}
          </button>
        </p>
      ) : null}
      {canAct && selected.size > 0 ? (
        <fieldset className="ta-bulk">
          <legend className="sr-only">Selected attributes</legend>
          <span className="ta-bulk-count">{selected.size} selected</span>
          <span className="ta-bulk-actions">
            {plan.proposals.length > 0 ? (
              <>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={action.pending}
                  onClick={() => void decideMany("APPROVE", plan.proposals)}
                >
                  {action.busy === "many-APPROVE"
                    ? "Approving…"
                    : `Approve ${plan.proposals.length}`}
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={action.pending}
                  onClick={() => void decideMany("REJECT", plan.proposals)}
                >
                  {action.busy === "many-REJECT"
                    ? "Rejecting…"
                    : `Reject ${plan.proposals.length}`}
                </button>
              </>
            ) : null}
            {plan.approved.length > 0 ? (
              <button
                type="button"
                className="btn-secondary btn-sm ta-retire"
                disabled={action.pending || plan.retireBlocked}
                title={
                  plan.retireBlocked
                    ? "A control keeps at least one attribute."
                    : undefined
                }
                onClick={() => void decideMany("RETIRE", plan.approved)}
              >
                {action.busy === "many-RETIRE"
                  ? "Retiring…"
                  : `Retire ${plan.approved.length}`}
              </button>
            ) : null}
            <button
              type="button"
              className="btn-ghost btn-sm"
              disabled={busyMany}
              onClick={() => setChosen(new Set())}
            >
              Clear
            </button>
          </span>
          {plan.retireBlocked ? (
            <small className="ta-bulk-hint">
              A control keeps at least one attribute.
            </small>
          ) : null}
        </fieldset>
      ) : null}
      <p className="ta-done" role="status">
        {done !== "" && action.problem === null ? (
          <>
            <UiIcon name="check" size={14} />
            {done}
          </>
        ) : null}
      </p>
      {action.note !== "" && action.problem === null ? (
        <p className="cc-note">{action.note}</p>
      ) : null}
      <Problem text={action.problem} />
      {compact ? null : (
        <ol className="ta-list" aria-label="Testing attributes">
          {context.approved.map((item, index) =>
            row(item, attributeLetter(index)),
          )}
          {context.approved.length === 0 ? (
            <li className="ta-empty">No approved attributes yet.</li>
          ) : null}
        </ol>
      )}
      {context.proposed.length > 0 ? (
        <section className="ta-waiting" aria-label="Proposed changes">
          <h4>
            Waiting on a decision{" "}
            <span className="ta-count">({context.proposed.length})</span>
          </h4>
          <p className="form-hint">
            The approved attributes stay as they are until a change is approved.
            Each proposal says whether a source states it or it is inferred.
          </p>
          <ul className="ta-list">
            {context.proposed.map((item) => row(item, null))}
          </ul>
        </section>
      ) : null}
      {dialog !== null ? (
        <AttributeDialog
          key={dialog.mode === "add" ? "add" : dialog.attribute.id}
          ids={ids}
          state={dialog}
          replaced={
            dialogTarget !== null
              ? {
                  letter: letters.get(dialogTarget.id) ?? "",
                  text: dialogTarget.text,
                }
              : null
          }
          onClose={() => setDialog(null)}
          onDone={(note) => {
            setDialog(null);
            setChosen(new Set());
            setDone(note);
          }}
        />
      ) : null}
      {showQuestions ? (
        <IssuesList
          ids={ids}
          issues={issues}
          canAct={canAct}
          title="Open questions"
        />
      ) : null}
      {context.history.length > 0 ? (
        <details className="cc-history">
          <summary>
            History <span className="num">{context.history.length}</span>
          </summary>
          <ul>
            {context.history.map((attribute) => (
              <li key={attribute.id}>
                <Badge>{attribute.status.toLowerCase()}</Badge>{" "}
                <span>{attribute.text}</span>
                {attribute.decidedBy !== null ? (
                  <span className="cc-by"> · {attribute.decidedBy}</span>
                ) : null}
                {attribute.note !== "" ? (
                  <span className="cc-by"> · {attribute.note}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {context.testing !== null && !compact ? (
        <TestingProcedures testing={context.testing} />
      ) : null}
    </div>
  );
}

// Issues

export function IssuesList({
  ids,
  issues,
  canAct,
  title,
}: {
  ids: Ids;
  issues: ContextIssue[];
  canAct: boolean;
  title: string;
}) {
  const action = useAction(ids);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const open = issues.filter((issue) => issue.status === "OPEN");
  const settled = issues.filter((issue) => issue.status !== "OPEN");
  if (issues.length === 0) {
    return null;
  }
  return (
    <section className="cc-issues" aria-label={title}>
      {open.length > 0 ? (
        <>
          <h4>
            {title} <span className="num">{open.length}</span>
          </h4>
          <ul>
            {open.map((issue) => (
              <li
                key={issue.id}
                className={`cc-issue is-${issue.kind.toLowerCase()}`}
              >
                <div className="cc-issue-head">
                  <Badge
                    tone={
                      issue.kind === "CONFLICT" ? "is-conflict" : "is-question"
                    }
                  >
                    {issue.kind === "CONFLICT"
                      ? "Conflict"
                      : issue.kind === "MISSING"
                        ? "Missing"
                        : "Unclear"}
                  </Badge>
                  <strong>{issue.topic}</strong>
                  <span className="cc-by">
                    {issue.raisedBy === "AGENT"
                      ? "Raised by the agent"
                      : "Raised by the checks"}
                  </span>
                </div>
                <p>{issue.detail}</p>
                {issue.why !== "" ? (
                  <p className="cc-why">
                    <span>Why it matters</span> {issue.why}
                  </p>
                ) : null}
                {issue.resolve !== "" ? (
                  <p className="cc-why">
                    <span>To resolve</span> {issue.resolve}
                  </p>
                ) : null}
                {issue.quotes.map((quote) => (
                  <p
                    key={`${quote.source}-${quote.quote}`}
                    className="cc-cited"
                  >
                    <q className="cc-quote">{quote.quote}</q>{" "}
                    <span>{quote.title}</span>
                  </p>
                ))}
                {canAct ? (
                  <div className="cc-resolve">
                    <input
                      autoComplete="off"
                      aria-label="How it was settled"
                      placeholder="How it was settled, and with whom"
                      maxLength={1000}
                      value={notes[issue.id] ?? ""}
                      onChange={(event) =>
                        setNotes({ ...notes, [issue.id]: event.target.value })
                      }
                    />
                    {(["RESOLVED", "DISMISSED"] as const).map((status) => (
                      <button
                        key={status}
                        type="button"
                        className={
                          status === "RESOLVED"
                            ? "btn-sm"
                            : "btn btn-secondary btn-sm"
                        }
                        disabled={
                          action.pending ||
                          (notes[issue.id] ?? "").trim() === ""
                        }
                        onClick={() =>
                          action.run(status, {
                            intent: "issue-resolve",
                            issue_id: issue.id,
                            status,
                            note: notes[issue.id] ?? "",
                            version: issue.version,
                          })
                        }
                      >
                        {status === "RESOLVED" ? "Resolve" : "Dismiss"}
                      </button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <Problem text={action.problem} />
        </>
      ) : null}
      {settled.length > 0 ? (
        <details className="cc-history">
          <summary>
            Settled <span className="num">{settled.length}</span>
          </summary>
          <ul>
            {settled.map((issue) => (
              <li key={issue.id}>
                <Badge>{issue.status.toLowerCase()}</Badge>{" "}
                <span>{issue.topic}:</span> <span>{issue.resolutionNote}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

// Process understanding

type Draft = ProcessStep & { id: string };

function drafts(steps: ProcessStep[]): Draft[] {
  return steps.map((step, index) => ({
    ...step,
    id: `${step.key || "s"}-${index}`,
  }));
}

/** The process map of a business process control: its steps, how each is known, and the
 * step where the control operates. Built by the agent or the reviewed rules, edited and
 * confirmed by the team. */
export function ProcessPanel({
  ids,
  context,
  canAct,
  showQuestions = true,
}: {
  ids: Ids;
  context: ControlContext;
  canAct: boolean;
  /** Off in the guided setup, which asks the open questions on its own step. */
  showQuestions?: boolean;
}) {
  const action = useAction(ids);
  const understanding = context.understanding;
  const [summary, setSummary] = useState(understanding.summary);
  const [steps, setSteps] = useState<Draft[]>(drafts(understanding.steps));
  const counter = useRef(0);
  useEffect(() => {
    setSummary(understanding.summary);
    setSteps(drafts(understanding.steps));
  }, [understanding.summary, understanding.steps]);
  const change = (id: string, patch: Partial<ProcessStep>) =>
    setSteps(
      steps.map((step) => (step.id === id ? { ...step, ...patch } : step)),
    );
  const save = (confirm: boolean) =>
    action.run(confirm ? "confirm" : "save", {
      intent: "process-save",
      summary,
      steps,
      version: understanding.version,
      confirm,
    });
  if (!context.processRequired) {
    return (
      <div className="cc-process">
        <p className="form-hint">
          Not needed for this control: its own criteria and configuration define
          it. Add supporting documents if they help the walkthrough.
        </p>
        <Classifications ids={ids} context={context} canAct={canAct} />
      </div>
    );
  }
  const proposed = understanding.proposedSteps;
  return (
    <div className="cc-process" aria-busy={action.pending}>
      <div className="cc-process-head">
        <span
          className={`cx-status ${
            understanding.status === "CONFIRMED"
              ? "tone-success"
              : understanding.status === "DRAFT"
                ? "tone-warning"
                : ""
          }`}
        >
          {understanding.status === "CONFIRMED"
            ? `Confirmed${understanding.confirmedBy !== null ? ` by ${understanding.confirmedBy}` : ""}`
            : understanding.status === "DRAFT"
              ? "Draft"
              : "Not started"}
        </span>
        {canAct ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={action.pending}
            onClick={() => action.run("build", { intent: "process-build" })}
          >
            <UiIcon name="sparkles" size={13} />{" "}
            {action.busy === "build"
              ? "Building the map…"
              : steps.length === 0
                ? "Build the map from the sources"
                : "Rebuild from the sources"}
          </button>
        ) : null}
      </div>
      {action.note !== "" && action.problem === null ? (
        <p className="cc-note">{action.note}</p>
      ) : null}
      {proposed !== null ? (
        <section className="cc-proposed-map" aria-label="Proposed map">
          <p>
            <strong>The agent proposed an updated map</strong> after reading the
            sources again. Your map stays until you take this one.
          </p>
          <ol>
            {proposed.map((step) => (
              <li key={`${step.key}-${step.description}`}>
                {step.description}{" "}
                <Badge tone={step.basis === "INFERRED" ? "is-inferred" : ""}>
                  {BASIS_LABELS[step.basis]}
                </Badge>
              </li>
            ))}
          </ol>
          {canAct ? (
            <button
              type="button"
              className="btn-sm"
              disabled={action.pending}
              onClick={() =>
                action.run("adopt", {
                  intent: "process-adopt",
                  version: understanding.version,
                })
              }
            >
              Use the proposed map
            </button>
          ) : null}
        </section>
      ) : null}
      <label className="cc-field">
        Summary
        <textarea
          autoComplete="off"
          value={summary}
          rows={3}
          maxLength={20000}
          disabled={!canAct}
          placeholder="How the process runs, in a short paragraph"
          onChange={(event) => setSummary(event.target.value)}
        />
      </label>
      <ol className="cc-steps">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={`cc-step${step.controlPoint ? " is-control" : ""}`}
          >
            <span className="cc-index">{index + 1}</span>
            <div className="cc-step-fields">
              <textarea
                autoComplete="off"
                aria-label={`Step ${index + 1}`}
                value={step.description}
                rows={2}
                maxLength={400}
                disabled={!canAct}
                onChange={(event) =>
                  change(step.id, { description: event.target.value })
                }
              />
              <div className="cc-step-meta">
                <input
                  autoComplete="off"
                  aria-label="Who"
                  placeholder="Who"
                  value={step.actor}
                  maxLength={120}
                  disabled={!canAct}
                  onChange={(event) =>
                    change(step.id, { actor: event.target.value })
                  }
                />
                <input
                  autoComplete="off"
                  aria-label="System"
                  placeholder="System"
                  value={step.system}
                  maxLength={120}
                  disabled={!canAct}
                  onChange={(event) =>
                    change(step.id, { system: event.target.value })
                  }
                />
                <label className="cc-check-label">
                  <input
                    type="checkbox"
                    checked={step.controlPoint}
                    disabled={!canAct}
                    onChange={(event) =>
                      change(step.id, { controlPoint: event.target.checked })
                    }
                  />
                  The control
                </label>
              </div>
              <span className="cc-source">
                <Badge tone={step.basis === "INFERRED" ? "is-inferred" : ""}>
                  {BASIS_LABELS[step.basis]}
                </Badge>
                {step.sourceTitle !== "" ? (
                  <Badge>{step.sourceTitle}</Badge>
                ) : null}
                {step.quote !== "" ? (
                  <q className="cc-quote">{step.quote}</q>
                ) : null}
              </span>
            </div>
            {canAct ? (
              <button
                type="button"
                className="btn-ghost btn-sm"
                aria-label={`Remove step ${index + 1}`}
                onClick={() =>
                  setSteps(steps.filter((item) => item.id !== step.id))
                }
              >
                <UiIcon name="x" size={13} />
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {canAct ? (
        <div className="cc-process-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={steps.length >= 15}
            onClick={() => {
              counter.current += 1;
              setSteps([
                ...steps,
                {
                  id: `new-${counter.current}`,
                  key: "",
                  description: "",
                  actor: "",
                  system: "",
                  controlPoint: false,
                  basis: "TEAM",
                  source: "",
                  sourceTitle: "",
                  quote: "",
                  attributes: [],
                  title: "",
                  kind: "STEP",
                  yes: 0,
                  no: 0,
                  evidence: [],
                },
              ]);
            }}
          >
            <UiIcon name="plus" size={13} /> Add a step
          </button>
          <span className="cc-spacer" />
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={action.pending}
            onClick={() => save(false)}
          >
            {action.busy === "save" ? "Saving…" : "Save as draft"}
          </button>
          <button
            type="button"
            className="btn-sm"
            disabled={
              action.pending || steps.every((step) => !step.controlPoint)
            }
            title={
              steps.every((step) => !step.controlPoint)
                ? "Mark the step where the control operates first."
                : undefined
            }
            onClick={() => save(true)}
          >
            <UiIcon name="check" size={13} />{" "}
            {action.busy === "confirm"
              ? "Confirming…"
              : "Confirm the understanding"}
          </button>
        </div>
      ) : null}
      <Problem text={action.problem} />
      {showQuestions ? (
        <IssuesList
          ids={ids}
          issues={context.issues.filter((item) => item.origin === "PROCESS")}
          canAct={canAct}
          title="Open questions on the process"
        />
      ) : null}
      <Classifications ids={ids} context={context} canAct={canAct} />
    </div>
  );
}

/** How the control is classified, and changing it. */
export function Classifications({
  ids,
  context,
  canAct,
}: {
  ids: Ids;
  context: ControlContext;
  canAct: boolean;
}) {
  const action = useAction(ids);
  const [chosen, setChosen] = useState<Classification[]>(
    context.classifications,
  );
  useEffect(
    () => setChosen(context.classifications),
    [context.classifications],
  );
  const labels = new Map<string, string>(CLASSIFICATIONS);
  return (
    <details className="cc-classify">
      <summary>
        Classified as{" "}
        {context.classifications
          .map((item) => labels.get(item) ?? item)
          .join(", ")}
        {context.classificationsOverridden ? " (set by the team)" : ""}
      </summary>
      <p className="form-hint">
        The area and nature set this. A control that spans categories can carry
        several; a business process control is tested against an understanding
        of its process.
      </p>
      <div className="cc-classes">
        {CLASSIFICATIONS.map(([key, label]) => (
          <label key={key} className="cc-check-label">
            <input
              type="checkbox"
              disabled={!canAct}
              checked={chosen.includes(key)}
              onChange={(event) =>
                setChosen(
                  event.target.checked
                    ? [...chosen, key]
                    : chosen.filter((item) => item !== key),
                )
              }
            />
            {label}
          </label>
        ))}
      </div>
      {canAct ? (
        <div className="cc-process-actions">
          <button
            type="button"
            className="btn-sm"
            disabled={action.pending || chosen.length === 0}
            onClick={() =>
              action.run("classify", {
                intent: "classify",
                classifications: chosen,
              })
            }
          >
            Save the classification
          </button>
          {context.classificationsOverridden ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={action.pending}
              onClick={() =>
                action.run("reset", { intent: "classify", classifications: [] })
              }
            >
              Use what the area implies
            </button>
          ) : null}
        </div>
      ) : null}
      <Problem text={action.problem} />
    </details>
  );
}

// Supporting documents

export type ControlChoice = { id: string; label: string };

/** The documents that support the control, any of which may support others too. */
export function DocumentsPanel({
  ids,
  context,
  canAct,
  controls,
}: {
  ids: Ids;
  context: ControlContext;
  canAct: boolean;
  /** The engagement's other controls, to link a document to several at once. */
  controls: ControlChoice[];
}) {
  const action = useAction(ids);
  const [open, setOpen] = useState(false);
  const kinds = new Map<string, string>(DOCUMENT_KINDS);
  const unreviewed = context.documents.filter(
    (document) => !document.reviewed,
  ).length;
  return (
    <div className="cc-documents" aria-busy={action.pending}>
      {context.documents.length === 0 ? (
        <p className="form-hint">
          No supporting documents. None is required: add a narrative, policy,
          procedure, flowchart, or walkthrough notes when they help define or
          understand the control.
        </p>
      ) : (
        <ul className="cc-docs">
          {context.documents.map((document) => (
            <li key={document.id}>
              <span className="cc-doc-icon" aria-hidden="true">
                <UiIcon name="file" size={14} />
              </span>
              <div>
                <strong>{document.title}</strong>
                <span className="cc-by">
                  {kinds.get(document.kind) ?? document.kind}
                  {document.fileName !== "" ? ` · ${document.fileName}` : ""}
                  {document.controlIds.length > 1
                    ? ` · supports ${document.controlIds.length} controls`
                    : ""}
                  {document.createdBy !== null
                    ? ` · added by ${document.createdBy}`
                    : ""}
                </span>
              </div>
              {document.reviewed ? (
                <Badge tone="is-reviewed">Reviewed</Badge>
              ) : (
                <Badge tone="is-question">Not reviewed yet</Badge>
              )}
              {canAct ? (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  disabled={action.pending}
                  onClick={() =>
                    action.run("unlink", {
                      intent: "document-unlink",
                      document_id: document.id,
                    })
                  }
                >
                  Unlink
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canAct ? (
        <div className="cc-process-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setOpen(true)}
          >
            <UiIcon name="plus" size={13} /> Add documentation
          </button>
          {context.documents.length > 0 ? (
            <button
              type="button"
              className={unreviewed > 0 ? "btn-sm" : "btn btn-secondary btn-sm"}
              disabled={action.pending}
              onClick={() => action.run("review", { intent: "review" })}
            >
              <UiIcon name="sparkles" size={13} />{" "}
              {action.busy === "review"
                ? "Reviewing against the sources…"
                : unreviewed > 0
                  ? `Review ${unreviewed} new document${unreviewed === 1 ? "" : "s"}`
                  : "Review again"}
            </button>
          ) : null}
        </div>
      ) : null}
      {action.note !== "" && action.problem === null ? (
        <p className="cc-note">{action.note}</p>
      ) : null}
      <Problem text={action.problem} />
      {open ? (
        <DocumentDialog
          ids={ids}
          controls={controls}
          onClose={() => setOpen(false)}
          onAdded={async () => {
            setOpen(false);
            await action.run("review", { intent: "review" });
          }}
        />
      ) : null}
    </div>
  );
}

function DocumentDialog({
  ids,
  controls,
  onClose,
  onAdded,
}: {
  ids: Ids;
  controls: ControlChoice[];
  onClose: () => void;
  onAdded: () => Promise<void>;
}) {
  const id = useId();
  const dialog = useRef<HTMLDivElement>(null);
  useFocusTrap(dialog);
  const [mode, setMode] = useState<"upload" | "write">("upload");
  const [kind, setKind] = useState<DocumentKind>("NARRATIVE");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [also, setAlso] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const others = controls.filter((item) => item.id !== ids.controlId);
  const shown = others
    .filter((item) =>
      item.label.toLowerCase().includes(filter.trim().toLowerCase()),
    )
    .slice(0, 50);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isTopmostDialog(dialog.current)) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("has-dialog");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("has-dialog");
      previous?.focus();
    };
  }, [onClose]);

  async function submit() {
    setBusy(true);
    setProblem(null);
    const linked = [ids.controlId, ...also];
    let status = 0;
    let note = "";
    try {
      if (mode === "upload") {
        const data = new FormData();
        data.set("organization_id", ids.organizationId);
        data.set("project_id", ids.projectId);
        data.set("kind", kind);
        data.set("title", title);
        for (const control of linked) {
          data.append("control_id", control);
        }
        if (file !== null) {
          data.set("content", file);
        }
        const response = await fetch("/workspace/control-context/upload", {
          method: "POST",
          body: data,
        });
        const answer = (await response.json()) as {
          status?: unknown;
          upload?: { readable?: unknown; note?: unknown } | null;
        };
        status = typeof answer.status === "number" ? answer.status : 0;
        if (status === 200 && answer.upload?.readable !== true) {
          status = 422;
          note =
            typeof answer.upload?.note === "string" ? answer.upload.note : "";
        }
      } else {
        const response = await fetch("/workspace/control-context", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organization_id: ids.organizationId,
            project_id: ids.projectId,
            intent: "document-write",
            kind,
            title,
            body,
            control_ids: linked,
          }),
        });
        const answer = (await response.json()) as { status?: unknown };
        status = typeof answer.status === "number" ? answer.status : 0;
      }
    } catch {
      status = 0;
    }
    setBusy(false);
    if (status !== 200) {
      setProblem(note || contextProblem(status));
      return;
    }
    await onAdded();
  }

  const ready =
    mode === "upload"
      ? file !== null
      : title.trim() !== "" && body.trim() !== "";
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: the backdrop closes; Escape and the buttons do too.
    <div
      className="preview-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialog}
        className="nw-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-busy={busy}
        tabIndex={-1}
      >
        <header className="nw-head">
          <div>
            <h2 id={`${id}-title`}>Add supporting documentation</h2>
            <p className="nw-lede">
              A narrative, policy, procedure, flowchart, walkthrough notes, or
              system documentation. It is optional: the agent reviews it against
              the control and proposes changes for you to approve; nothing
              approved changes on its own.
            </p>
          </div>
          <button
            type="button"
            className="nw-close"
            onClick={onClose}
            aria-label="Close"
          >
            <UiIcon name="x" size={16} />
          </button>
        </header>
        <div className="nw-body">
          <div className="cc-segment" role="tablist" aria-label="How to add it">
            {(["upload", "write"] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={mode === item}
                className={mode === item ? "is-on" : ""}
                onClick={() => setMode(item)}
              >
                {item === "upload"
                  ? "Upload a file"
                  : "Paste or write the text"}
              </button>
            ))}
          </div>
          <div className="cc-form-grid">
            <label className="cc-field">
              Kind
              <select
                value={kind}
                onChange={(event) =>
                  setKind(event.target.value as DocumentKind)
                }
              >
                {DOCUMENT_KINDS.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="cc-field">
              Title
              <input
                autoComplete="off"
                value={title}
                maxLength={200}
                placeholder={
                  mode === "upload"
                    ? "The file's name, if left empty"
                    : "Credit note policy"
                }
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          </div>
          {mode === "upload" ? (
            <label className="cc-field">
              File
              <input
                type="file"
                accept=".docx,.pdf,.txt,.md,.xlsx,.csv"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <span className="form-hint">
                Word, PDF, Excel, or text, under 5 MB. Its text is kept; the
                file is not.
              </span>
            </label>
          ) : (
            <label className="cc-field">
              Text
              <textarea
                autoComplete="off"
                value={body}
                rows={9}
                maxLength={100000}
                onChange={(event) => setBody(event.target.value)}
              />
            </label>
          )}
          {others.length > 0 ? (
            <details className="cc-also">
              <summary>
                Also supports other controls
                {also.length > 0 ? ` (${also.length})` : ""}
              </summary>
              <input
                autoComplete="off"
                className="cc-filter"
                placeholder="Find a control"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              />
              <div className="cc-also-list">
                {shown.map((item) => (
                  <label key={item.id} className="cc-check-label">
                    <input
                      type="checkbox"
                      checked={also.includes(item.id)}
                      onChange={(event) =>
                        setAlso(
                          event.target.checked
                            ? [...also, item.id]
                            : also.filter((other) => other !== item.id),
                        )
                      }
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </details>
          ) : null}
          {problem !== null ? (
            <p className="nw-problem" role="alert">
              {problem}
            </p>
          ) : null}
          <footer className="nw-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <span className="nw-spacer" />
            <button
              type="button"
              className="btn-sm"
              disabled={busy || !ready}
              onClick={submit}
            >
              <UiIcon name="check" size={14} />{" "}
              {busy ? "Adding…" : "Add and review"}
            </button>
          </footer>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A supporting file attached to the control from the walkthrough, as its walkthrough
 * notes: read, kept as text, and linked to the control. Null once attached, else why not. */
async function attachToControl(ids: Ids, file: File): Promise<string | null> {
  const data = new FormData();
  data.set("organization_id", ids.organizationId);
  data.set("project_id", ids.projectId);
  data.set("kind", "WALKTHROUGH");
  data.set("title", file.name.slice(0, 200));
  data.append("control_id", ids.controlId);
  data.set("content", file);
  try {
    const response = await fetch("/workspace/control-context/upload", {
      method: "POST",
      body: data,
    });
    const answer = (await response.json()) as {
      status?: unknown;
      upload?: { readable?: unknown; note?: unknown } | null;
    };
    if (answer.status === 413) {
      return "The file is larger than 5 MB.";
    }
    if (answer.status !== 200) {
      return "The file could not be attached. Try again.";
    }
    if (answer.upload?.readable !== true) {
      return typeof answer.upload?.note === "string" &&
        answer.upload.note !== ""
        ? answer.upload.note
        : "The file could not be read.";
    }
    return null;
  } catch {
    return "The file could not be attached. Try again.";
  }
}
