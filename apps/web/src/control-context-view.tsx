"use client";

import Link from "next/link";
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
import { AttributeAssumptions, CriteriaTrail } from "./attribute-assumptions";
import { AcceptAllCriteria, TailoredCriteria } from "./attribute-criteria";
import { setLine } from "./attributes-handoff-model";
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
  acceptAllRows,
  acceptableRows,
  acceptItems,
  agentRan,
  attributeLetter,
  attributesSummary,
  attributesWorking,
  BASIS_LABELS,
  basisLines,
  CLASSIFICATIONS,
  type Classification,
  CONFIDENCE_LABELS,
  CONFLICT_HOLDS,
  type Confidence,
  type ContextIssue,
  type ControlContext,
  contextProblem,
  criteriaToAccept,
  criteriaToWrite,
  type Design,
  DOCUMENT_KINDS,
  type DocumentKind,
  decidedNote,
  FREQUENCY_LABELS,
  firstUnifiedToDecide,
  GONE_CHIPS,
  type GoneRow,
  heldRow,
  historyWords,
  holdWords,
  JUST_DECIDED,
  type LibraryUpdate,
  listBasisLine,
  listCount,
  NATURE_LABELS,
  offersAgentRun,
  PROCEDURE_PHASES,
  type ProcessStep,
  pendingCriteriaLine,
  removeQuestion,
  reviewedWords,
  reviewList,
  reviewProgress,
  reviewUnfinished,
  rowOffer,
  rowOriginLine,
  runFailureLine,
  SECTION_HEADINGS,
  SET_CONFLICT_HOLDS,
  SOURCE_LABELS,
  selectionPlan,
  settledRunLine,
  type Testing,
  TYPE_LABELS,
  UNIFIED_CHIPS,
  type Understanding,
  type UnifiedRow,
  type UnifiedState,
  unifiedRows,
  unifiedState,
} from "./control-context-model";
import { attributeAnchor, attributeFromHash } from "./design-points-model";
import { planningHref } from "./planning-model";
import {
  type NarrativeAttribute,
  NarrativeSources,
  NarrativeUses,
  ProcessNarrative,
} from "./process-narrative";
import { RecordDialog } from "./record-dialog";
import { RowMenu, type RowMenuItem } from "./row-menu";
import { type IconName, UiIcon } from "./ui-icon";
import { DRAFTED_ONCE_COMPLETE } from "./understanding-once-model";
import {
  acceptAllNote,
  acceptAllWords,
  notYetAccepted,
} from "./understanding-specialist-model";
import { isTopmostDialog, useFocusTrap } from "./use-focus-trap";

type Ids = { organizationId: string; projectId: string; controlId: string };

/** The Attributes step's card, which its list carries (Review attributes, product owner, 19
 * November 2026, approved prototype): the review with its progress while a row waits on a
 * person, or the set attributes with the one way on. */
export type AttributesHeading =
  | { kind: "review"; title: string; line: string }
  | {
      kind: "set";
      title: string;
      /** What follows the counts ("D&I Evidence and Scope & Sampling can start."). */
      follows: string;
      label: string;
      href: string;
      gap: string;
    };

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
  // The control's attribute is removed by the update (product owner, 19 November 2026:
  // "Remove", never "Retire", for a control's attribute).
  RETIRE: "Remove",
};

/** What the current library version changes on a control copied from an older one, for
 * a person to adopt. Nothing changes until they do. */
function LibraryUpdatePanel({
  ids,
  update,
  canAct,
  bare = false,
}: {
  ids: Ids;
  update: LibraryUpdate;
  canAct: boolean;
  /** Inside a fold whose line already names the version: no heading of its own. */
  bare?: boolean;
}) {
  const action = useAction(ids);
  const changes = update.items.filter((item) => item.change !== "KEEP");
  return (
    <section
      className={`cc-update${bare ? " is-bare" : ""}`}
      aria-label="Library update"
    >
      <div className="cc-update-head">
        {bare ? null : (
          <h4>
            Library version {update.currentVersion} is available{" "}
            <span className="num">{changes.length}</span>
          </h4>
        )}
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
    /** Whether the control needs a process narrative (B1j): an ITGC needs none, so the page
     * never asks for one there. Absent: as before. */
    processRequired?: boolean;
  } | null;
}) {
  const action = useAction(ids);
  const fillable = design.slots.filter((slot) => !slot.automatic);
  // B1j: never a narrative for a control that needs none.
  const narrates = walkthrough?.processRequired !== false;
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
                  <h4>Organization-specific information</h4>
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
                  // background, for a control that needs one (B1j: never for an ITGC).
                  if (canAct && narrates) {
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
                drafts={narrates}
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
                      detail: `Organization-specific answer · ${slot.question || sentence(slot.label)}`,
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
  context: given,
  canAct,
  compact = false,
  showQuestions = true,
  embedded = false,
  heading = null,
  agent = null,
}: {
  ids: Ids;
  context: ControlContext;
  canAct: boolean;
  /** The Attributes step's card, carried by the embedded list (Review attributes, 19
   * November 2026); null where the step's frame says what the step needs. */
  heading?: AttributesHeading | null;
  /** What the agent did and found, as the embedded list's "How". */
  agent?: { did: string; found: string[] } | null;
  /** Off in the guided setup, which asks the open questions in Control Understanding. Once
   * the understanding is complete nothing here sends the person back to it (B1j, 16 November
   * 2026: the warning banner that linked back to it is gone). */
  showQuestions?: boolean;
  /** Inside the Attributes step's panel (product owner, 11 November 2026, approved
   * preview): the panel's frame gives the title, the status, the decision and the agent's
   * line, so this is the work alone: one list of rows that open on request, the first that
   * waits on a person already open, and the rest folded below. */
  embedded?: boolean;
  /** Inside the test plan, whose attribute table is the one list of the attributes (and
   * whose Procedures tab already says how each is tested): only what waits on a decision,
   * the agent's proposals and the history are shown here. */
  compact?: boolean;
}) {
  const action = useAction(ids);
  // The context an assumption decision answered with (B1j), shown at once in place of the
  // page's until the page's own data catches up: a newer read always wins.
  const [answered, setAnswered] = useState<{
    base: ControlContext;
    next: ControlContext;
  } | null>(null);
  const context =
    answered !== null && answered.base === given ? answered.next : given;
  const onContext = (next: ControlContext) =>
    setAnswered({ base: given, next });
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<AttributeDialogState | null>(null);
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const [about, setAbout] = useState(false);
  // The rows the person opened or closed; until then the first that waits on them is open.
  const [opened, setOpened] = useState<ReadonlySet<string> | null>(null);
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
  const approvable = plan.proposals.filter(
    (item) =>
      !heldRow({
        item,
        target:
          context.approved.find((each) => each.id === item.replacesId) ?? null,
      }),
  );
  const issues = context.issues.filter((item) => item.origin !== "PROCESS");
  const lastOne = context.approved.length <= 1;
  // The agents are updating the attributes (a redraft of the understanding included, as the
  // D&I release reads it): nothing is decided meanwhile; the server refuses it too.
  const updating =
    attributesWorking(context.attributesRun, context.attributesStage) !== null;

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

  // True once the server has recorded it. The Attributes step's rows say it on the row
  // itself (quiet: no note above the list).
  async function decideOne(
    decision: AttributeDecisionKind,
    item: Attribute,
    quiet = false,
  ): Promise<boolean> {
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
    if (ok && !quiet) {
      setDone(decidedNote(decision, 1));
    }
    return ok;
  }

  // One decision per row, or one for the set: the agent's change is approved and its
  // criteria accepted in one call. Done is said only once the server has recorded it.
  async function acceptRows(
    rows: UnifiedRow[],
    quiet = false,
  ): Promise<boolean> {
    setDone("");
    // A row a conflict holds is never sent (B1l point 6): the server refuses the whole call.
    const items = acceptItems(rows);
    if (items.length === 0) {
      return false;
    }
    const ok = await action.run(
      rows.length === 1 ? `accept-${rows[0]?.item.id ?? ""}` : "accept-all",
      { intent: "attributes-accept", items },
    );
    if (ok && !quiet) {
      setDone(
        items.length === 1
          ? "Accepted."
          : `${items.length} attributes accepted.`,
      );
    }
    return ok;
  }

  function row(item: Attribute, letter: string | null) {
    const proposed = item.status === "PROPOSED";
    const target =
      item.replacesId !== null
        ? (context.approved.find((each) => each.id === item.replacesId) ?? null)
        : null;
    const targetLetter = target !== null ? (letters.get(target.id) ?? "") : "";
    const held = heldRow({ item, target });
    const open = shown.has(item.id);
    const name = letter !== null ? `attribute ${letter}` : "the proposal";
    const statusItems: RowMenuItem[] = proposed
      ? [
          {
            label:
              item.proposal === "RETIRE" ? "Approve the removal" : "Approve",
            icon: "check",
            // B1l point 6: a conflict on it is decided first.
            unavailable: held ? holdWords(item) : null,
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
            label: "Remove attribute",
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
              label: open
                ? "Hide the standard's requirement"
                : "Show the standard's requirement",
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
        id={attributeAnchor(item.id)}
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
                {item.proposal === "RETIRE" ? "Removes" : "Replaces"}{" "}
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
          {/* The criteria tailored to this control, what the testers judge evidence
              against (11 November 2026); the standard's requirement opens on request. */}
          {!proposed && !compact ? (
            <TailoredCriteria ids={ids} item={item} canAct={canAct} />
          ) : null}
          {/* What the agent assumed on it after the understanding was complete, and where
              its criteria came from (B1j). */}
          {item.proposal !== "RETIRE" ? (
            <>
              <AttributeAssumptions
                ids={ids}
                items={item.assumptions}
                canAct={canAct}
                locked={action.pending || updating}
                onContext={onContext}
                label={`The agent's assumptions on ${name}`}
              />
              <CriteriaTrail
                ids={ids}
                attributeId={item.id}
                updatedFrom={item.criteriaUpdatedFrom}
                versions={item.criteriaVersions}
              />
            </>
          ) : null}
          {open && item.definition !== null ? (
            <div className="ta-how">
              <p className="ta-how-title">The standard's requirement</p>
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
              disabled={action.pending || updating}
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
  const dialogView =
    dialog !== null ? (
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
    ) : null;
  const historyView =
    context.history.length > 0 ? (
      <details className={embedded ? "cc-history ta-fold" : "cc-history"}>
        <summary>
          History <span className="num">{context.history.length}</span>
        </summary>
        <ul>
          {context.history.map((attribute) => {
            const words = historyWords(attribute);
            return (
              <li key={attribute.id}>
                <Badge>{words.badge}</Badge> <span>{attribute.text}</span>
                {attribute.decidedBy !== null ? (
                  <span className="cc-by"> · {attribute.decidedBy}</span>
                ) : null}
                {words.note !== "" ? (
                  <span className="cc-by"> · {words.note}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </details>
    ) : null;
  if (embedded && !compact) {
    return (
      <EmbeddedAttributes
        ids={ids}
        context={context}
        canAct={canAct}
        onContext={onContext}
        busy={action.pending}
        busyKey={action.busy}
        open={opened}
        onOpen={(next) => setOpened(next)}
        shown={shown}
        onShow={(next) => setShown(next)}
        onDecide={(decision, item) => decideOne(decision, item, true)}
        onAccept={(rows) => acceptRows(rows, true)}
        heading={heading}
        agent={agent}
        onDialog={setDialog}
        onGenerate={(force = false) =>
          void action.run("generate", {
            intent: "attributes-generate",
            ...(force ? { force: true } : {}),
          })
        }
        status={
          <>
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
          </>
        }
        folds={
          <>
            {context.libraryUpdate !== null ? (
              <details className="ta-fold">
                <summary>
                  Library version {context.libraryUpdate.currentVersion} is
                  available{" "}
                  <span className="num">
                    {
                      context.libraryUpdate.items.filter(
                        (item) => item.change !== "KEEP",
                      ).length
                    }
                  </span>
                </summary>
                <LibraryUpdatePanel
                  ids={ids}
                  update={context.libraryUpdate}
                  canAct={canAct}
                  bare
                />
              </details>
            ) : null}
            {historyView}
            {context.testing !== null ? (
              <TestingProcedures testing={context.testing} />
            ) : null}
          </>
        }
        after={
          <>
            {dialogView}
            {showQuestions ? (
              <IssuesList
                ids={ids}
                issues={issues}
                canAct={canAct}
                title="Open questions"
              />
            ) : null}
          </>
        }
      />
    );
  }
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
                person approves it, and a changed or removed attribute keeps its
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
      {/* The agent's assumptions on the whole set (B1j). */}
      <AttributeAssumptions
        ids={ids}
        items={context.setAssumptions}
        canAct={canAct}
        locked={action.pending || updating}
        onContext={onContext}
        label="The agent's assumptions on the attributes as a set"
      />
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
                disabled={action.pending || updating}
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
            propose attributes to add, change or remove.
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
                {/* A proposal a conflict holds is left out of the approval (B1l point 6). */}
                {approvable.length > 0 ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={action.pending || updating}
                    title={
                      approvable.length < plan.proposals.length
                        ? context.setHeldByConflict === true
                          ? SET_CONFLICT_HOLDS
                          : CONFLICT_HOLDS
                        : undefined
                    }
                    onClick={() => void decideMany("APPROVE", approvable)}
                  >
                    {action.busy === "many-APPROVE"
                      ? "Approving…"
                      : `Approve ${approvable.length}`}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={action.pending || updating}
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
                disabled={action.pending || updating || plan.retireBlocked}
                title={
                  plan.retireBlocked
                    ? "A control keeps at least one attribute."
                    : undefined
                }
                onClick={() => void decideMany("RETIRE", plan.approved)}
              >
                {action.busy === "many-RETIRE"
                  ? "Removing…"
                  : `Remove ${plan.approved.length}`}
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
      {compact || !canAct ? null : (
        <AcceptAllCriteria ids={ids} items={criteriaToAccept(context)} />
      )}
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
      {dialogView}
      {showQuestions ? (
        <IssuesList
          ids={ids}
          issues={issues}
          canAct={canAct}
          title="Open questions"
        />
      ) : null}
      {historyView}
      {context.testing !== null && !compact ? (
        <TestingProcedures testing={context.testing} />
      ) : null}
    </div>
  );
}

/**
 * The Attributes step's work area: Review attributes (product owner, 19 November 2026,
 * approved prototype; first built 11 November 2026). The step's card says what the step is
 * for and how far the review has come (Reviewed n/N, one segment per attribute), or, once
 * nothing is left to review, that the attributes are set, with the one way on. Under it, one
 * list: each attribute a row that opens on request, the first that waits on a person open;
 * a row to review is accepted, edited or removed, and once the server has confirmed the
 * decision the row says so and the next one opens. The agent's proposals sit in the same
 * list, decided in the same pattern. Every decision is the panel's own, so the same server
 * calls, versions and audit apply, and each shows success only once the server confirmed it.
 */
function EmbeddedAttributes({
  ids,
  context,
  canAct,
  onContext,
  busy,
  busyKey,
  open,
  onOpen,
  shown,
  onShow,
  onDecide,
  onAccept,
  onDialog,
  onGenerate,
  heading,
  agent,
  status,
  folds,
  after,
}: {
  ids: Ids;
  context: ControlContext;
  canAct: boolean;
  /** The context an assumption decision answered with, shown until the page catches up. */
  onContext: (next: ControlContext) => void;
  busy: boolean;
  busyKey: string;
  /** The rows the person opened, or null until they open or close one: the first row that
   * waits on them is open until then. */
  open: ReadonlySet<string> | null;
  onOpen: (next: Set<string> | null) => void;
  /** The rows whose standard's requirement, or previous wording, is shown. */
  shown: ReadonlySet<string>;
  onShow: (next: Set<string>) => void;
  /** Rejects an agent's change, or removes an approved attribute; true once the server
   * recorded it. */
  onDecide: (
    decision: AttributeDecisionKind,
    item: Attribute,
  ) => Promise<boolean>;
  /** One decision per row: approves the agent's change and accepts its criteria; true once
   * the server recorded it. */
  onAccept: (rows: UnifiedRow[]) => Promise<boolean>;
  onDialog: (state: AttributeDialogState) => void;
  /** Asks the agent to read the sources and propose attributes. */
  onGenerate: (force?: boolean) => void;
  /** The step's card, when this list carries it. */
  heading: AttributesHeading | null;
  /** What the agent did and found: the list header's "How". */
  agent: { did: string; found: string[] } | null;
  status: ReactNode;
  folds: ReactNode;
  after: ReactNode;
}) {
  const id = useId();
  const router = useRouter();
  const approved = context.approved.length;
  const rows = unifiedRows(context);
  const working = attributesWorking(
    context.attributesRun,
    context.attributesStage,
  );
  const running = working !== null;
  // A run that ended without a usable answer: one sentence, with its ways on beside it
  // (run again, or write the criteria the run did not write). Never "Needs criteria" on
  // the rows and nothing else.
  const failure = runFailureLine(context);
  // The run could not be used, but every attribute has its criteria: a quiet line.
  const settledRun = settledRunLine(context);
  // The first attribute whose criteria a person writes: not one whose criteria wait in a
  // change to the test plan, which the step links to instead.
  const toWrite = criteriaToWrite(context)[0]?.item ?? null;
  const pending = pendingCriteriaLine(context);
  // The row whose criteria form "Write criteria" opened.
  const [writing, setWriting] = useState<string | null>(null);
  // What this visit decided, once the server confirmed it: the rows accepted (said on the
  // row until the page reads the list again, and after), the rows taken off the list (kept
  // in their places, struck through), the row whose removal is being asked, the "How" open.
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(new Set());
  const [gone, setGone] = useState<readonly GoneRow[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [howOpen, setHowOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming !== null) {
      cancelRef.current?.focus();
    }
  }, [confirming]);
  // Once the row's criteria are written (or nothing is missing), its form opens only on
  // the person's own Edit again.
  const toWriteId = toWrite?.id ?? null;
  useEffect(() => {
    if (writing !== null && toWriteId !== writing) {
      setWriting(null);
    }
  }, [writing, toWriteId]);
  function writeCriteria(item: Attribute) {
    setWriting(item.id);
    const next = new Set(opened);
    next.add(item.id);
    onOpen(next);
    window.requestAnimationFrame(() =>
      document
        .getElementById(`${id}-${item.id}`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  }
  // While the agents work, the page reads the attributes again every few seconds, in
  // place; it stops by itself when the run ends.
  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = window.setInterval(() => router.refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [running, router]);
  const locked = busy || running;
  const entries = reviewList(rows, gone);
  const progress = reviewProgress(entries, accepted);
  const reviewed = reviewedWords(progress);
  // The rows still to decide are the live ones not accepted in this visit.
  const live = entries.flatMap((entry) =>
    entry.kind === "row" && !accepted.has(entry.row.item.id) ? [entry.row] : [],
  );
  const toAccept = acceptableRows(live);
  // "Accept all" leaves out a row a conflict holds, and says so, and how many assumptions not
  // confirmed go with it (B1l point 6), beside it.
  const allRows = acceptAllRows(live);
  // Each unconfirmed assumption counted once, and the set's too when the acceptance leaves
  // nothing else to accept (the server accepts those with it); a conflict on the set holds
  // every row, and the line says so.
  const setHeldNow = context.setHeldByConflict === true;
  const allWords = acceptAllWords(allRows, toAccept.length - allRows.length, {
    assumptions: context.setAssumptions ?? [],
    remaining: notYetAccepted(live),
    held: setHeldNow,
    reviewed: progress.reviewed,
  });
  const allNote = acceptAllNote(allWords);
  const offersAll = allRows.length >= 2 && confirming === null;
  // Shown beside Accept all whenever it is, and on its own when a conflict on the set holds
  // everything (Accept all is then not offered).
  const showAllNote =
    allNote !== "" && (offersAll || (setHeldNow && toAccept.length > 0));
  // Before the understanding is complete (B1j): said quietly, with no warning and no way
  // back; once it is, nothing on this step sends the person to Control Understanding.
  // From the completion alone (q_ui4, 19 November 2026): the pass reads DONE while questions
  // are still open, held or failed, and the understanding is not complete then either. A
  // body from before B1j (no pass at all) says nothing.
  const beforeComplete =
    (context.understandingCompletedAt ?? null) === null &&
    context.questionPass !== null &&
    context.questionPass !== undefined;
  const unreviewed = reviewUnfinished(context.reviewSummary);
  const decided = new Set([...accepted, ...gone.map((item) => item.id)]);
  const first = running ? null : firstUnifiedToDecide(rows, decided);
  const opened = open ?? new Set(first !== null ? [first] : []);
  // A link to an attribute (the D&I point's "Confirm or change the assumption", B1l point
  // 6) opens its row once and brings it into view, where its assumption is decided.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current) {
      return;
    }
    const target = attributeFromHash(window.location.hash);
    if (target === null || !rows.some((row) => row.item.id === target)) {
      return;
    }
    linked.current = true;
    const next = new Set(opened);
    next.add(target);
    onOpen(next);
    window.requestAnimationFrame(() =>
      document
        .getElementById(attributeAnchor(target))
        ?.scrollIntoView({ block: "start" }),
    );
  }, [rows, opened, onOpen]);
  // A control keeps at least one attribute: the last cannot be removed. Each row but an
  // addition stands for one approved attribute (a rewording or a removal, for the one it
  // names), and a row removed in this visit no longer does.
  const lastOne =
    entries.filter(
      (entry) => entry.kind === "row" && entry.row.kind !== "ADDED",
    ).length <= 1;
  const flip = (set: ReadonlySet<string>, each: string): Set<string> => {
    const next = new Set(set);
    if (next.has(each)) {
      next.delete(each);
    } else {
      next.add(each);
    }
    return next;
  };
  // The decided row's buttons close with it: the focus moves to the row that opens next
  // (its wording), or to the list's count once nothing is left to review, never to the page.
  const [moved, setMoved] = useState(0);
  const countRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (moved === 0) {
      return;
    }
    const next =
      first !== null
        ? document
            .getElementById(attributeAnchor(first))
            ?.querySelector<HTMLButtonElement>("button.tar-head")
        : null;
    (next ?? countRef.current)?.focus();
  }, [moved, first]);

  // Once the server confirmed a decision: the row says so, and the next to review opens
  // (the list's first that waits, past the rows decided in this visit).
  function settle(each: UnifiedRow, outcome: "ACCEPTED" | GoneRow["outcome"]) {
    const at = entries.findIndex(
      (entry) => entry.kind === "row" && entry.row.item.id === each.item.id,
    );
    if (outcome === "ACCEPTED") {
      setAccepted((before) => new Set([...before, each.item.id]));
    } else {
      setGone((before) => [
        ...before,
        {
          id: each.item.id,
          text:
            each.kind === "REMOVAL" && each.target !== null
              ? each.target.text
              : each.item.text,
          at: Math.max(at, 0),
          outcome,
        },
      ]);
    }
    setConfirming(null);
    setSaid(
      `Attribute ${each.letter}: ${JUST_DECIDED[outcome].toLowerCase()}.`,
    );
    onOpen(null);
    setMoved((count) => count + 1);
  }
  async function accept(each: UnifiedRow) {
    if (await onAccept([each])) {
      settle(each, each.kind === "REMOVAL" ? "REMOVED" : "ACCEPTED");
    }
  }
  async function decline(each: UnifiedRow, decision: "RETIRE" | "REJECT") {
    if (await onDecide(decision, each.item)) {
      if (decision === "RETIRE") {
        settle(each, "REMOVED");
      } else if (each.kind === "ADDED") {
        settle(each, "NOT_ADDED");
      } else {
        // The agent's change is rejected: the attribute stands as it was.
        setConfirming(null);
        setSaid(`Attribute ${each.letter}: kept as it was.`);
        onOpen(null);
        setMoved((count) => count + 1);
      }
    }
  }
  async function acceptAll() {
    const sent = allRows;
    if (await onAccept(sent)) {
      setAccepted(
        (before) => new Set([...before, ...sent.map((row) => row.item.id)]),
      );
      setConfirming(null);
      setSaid(`${sent.length} attributes accepted.`);
      onOpen(new Set());
      setMoved((count) => count + 1);
    }
  }

  function goneRow(item: GoneRow) {
    return (
      <li key={item.id} className="tar is-gone">
        <div className="tar-top">
          <span className="tar-head is-static">
            <span className="tar-letter" aria-hidden="true">
              <UiIcon name="x" size={12} />
            </span>
            <span className="tar-name">
              <span className="tar-text">{item.text}</span>
              <span className="tar-source">{JUST_DECIDED[item.outcome]}</span>
            </span>
          </span>
          <span className="tar-chip tone-neutral">
            {GONE_CHIPS[item.outcome].label}
          </span>
          <span className="tar-caret is-empty" aria-hidden="true" />
        </div>
      </li>
    );
  }

  function row(each: UnifiedRow) {
    const { item, kind, target, letter } = each;
    const justAccepted = accepted.has(item.id);
    const state: UnifiedState = justAccepted
      ? "ACCEPTED"
      : unifiedState(each, running);
    const held = heldRow(each);
    const chip = UNIFIED_CHIPS[state];
    const isOpen = opened.has(item.id);
    const standardShown = shown.has(item.id) && item.definition !== null;
    const previousKey = `${item.id}:previous`;
    const previousShown = shown.has(previousKey);
    const name = `attribute ${letter}`;
    const bodyId = `${id}-${item.id}`;
    const offer = rowOffer(each, { held, lastOne });
    const acting = canAct && !running && !justAccepted;
    const asking = confirming === item.id;
    const origin = `${rowOriginLine(each)}${justAccepted ? ` · ${JUST_DECIDED.ACCEPTED}` : ""}`;
    // What the agent followed in the confirmed understanding and what it set aside: shown,
    // never silent (12 November 2026).
    const basis =
      kind === "REMOVAL" ? null : basisLines(item.understandingBasis);
    // What the agent assumed on the attribute after the understanding was complete, as rows
    // of its criteria ("Assumes … Unconfirmed"), and where its criteria came from (B1j).
    const notes =
      kind === "REMOVAL" ? null : (
        <>
          <AttributeAssumptions
            ids={ids}
            items={item.assumptions}
            canAct={canAct}
            locked={locked}
            onContext={onContext}
            label={`The agent's assumptions on ${name}`}
            layout="row"
          />
          <CriteriaTrail
            ids={ids}
            attributeId={item.id}
            updatedFrom={item.criteriaUpdatedFrom}
            versions={item.criteriaVersions}
          />
        </>
      );
    const criteria = item.criteria;
    const stated =
      criteria.condition !== "" ||
      criteria.passCriteria !== "" ||
      criteria.failCriteria !== "";
    const standardLink =
      item.definition !== null ? (
        <button
          type="button"
          className="tar-link"
          aria-expanded={standardShown}
          aria-controls={`${bodyId}-standard`}
          onClick={() => onShow(flip(shown, item.id))}
        >
          {standardShown ? "Hide the standard" : "Compare with standard"}
        </button>
      ) : null;
    const previousLink =
      kind === "REWORDED" && target !== null ? (
        <button
          type="button"
          className="tar-link"
          aria-expanded={previousShown}
          aria-controls={`${bodyId}-previous`}
          onClick={() => onShow(flip(shown, previousKey))}
        >
          {previousShown ? "Hide the previous wording" : "Previous wording"}
        </button>
      ) : null;
    const removing = busyKey === `retire-${item.id}`;
    const accepting = busyKey === `accept-${item.id}`;
    // The row's one action row: Accept, Edit, Remove, then the quiet links on the right; or,
    // while a removal is asked, the question with Cancel and Remove.
    const acts = (
      criteriaForm: { edit: () => void; formId: string } | null,
    ) => {
      if (!acting) {
        return standardLink !== null || previousLink !== null ? (
          <div className="tar-acts">
            <span className="tar-acts-gap" />
            {previousLink}
            {standardLink}
          </div>
        ) : null;
      }
      if (asking) {
        return (
          <fieldset
            className="tar-acts tar-confirm"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setConfirming(null);
              }
            }}
          >
            <legend className="tar-confirm-text">
              {removeQuestion(letter)}
            </legend>
            <span className="tar-confirm-acts">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={locked}
                // Focus lands on the question's safe answer.
                ref={cancelRef}
                onClick={() => setConfirming(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={locked}
                onClick={() =>
                  void (kind === "REMOVAL"
                    ? accept(each)
                    : decline(each, "RETIRE"))
                }
              >
                {removing || accepting ? "Removing…" : "Remove"}
              </button>
            </span>
          </fieldset>
        );
      }
      return (
        <>
          {held ? <p className="tc-held">{holdWords(item)}</p> : null}
          <div className="tar-acts">
            {offer.primary === "ACCEPT" ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={locked}
                onClick={() => void accept(each)}
              >
                {accepting ? "Accepting…" : "Accept"}
              </button>
            ) : null}
            {offer.primary === "WRITE" && criteriaForm !== null ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={locked}
                aria-controls={criteriaForm.formId}
                onClick={criteriaForm.edit}
              >
                Write criteria
              </button>
            ) : null}
            {offer.acceptsRemoval ? (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={locked}
                onClick={() => setConfirming(item.id)}
              >
                Remove
              </button>
            ) : null}
            {offer.edit ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={locked}
                onClick={() =>
                  onDialog({
                    mode: kind === "APPROVED" ? "edit" : "review",
                    attribute: item,
                    letter,
                  })
                }
              >
                Edit
              </button>
            ) : null}
            {offer.decline !== null ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={locked}
                onClick={() => {
                  const choice = offer.decline;
                  if (choice === null) {
                    return;
                  }
                  if (choice.confirm) {
                    setConfirming(item.id);
                  } else {
                    void decline(each, choice.decision);
                  }
                }}
              >
                {busyKey === `decide-${item.id}`
                  ? "Saving…"
                  : offer.decline.label}
              </button>
            ) : null}
            <span className="tar-acts-gap" />
            {offer.editCriteria && criteriaForm !== null ? (
              <button
                type="button"
                className="tar-link"
                disabled={locked}
                aria-controls={criteriaForm.formId}
                onClick={criteriaForm.edit}
              >
                Edit criteria
              </button>
            ) : null}
            {previousLink}
            {standardLink}
          </div>
        </>
      );
    };
    const quickAccept =
      acting && !isOpen && state === "TO_ACCEPT" && offer.primary === "ACCEPT";
    return (
      <li
        key={item.id}
        id={attributeAnchor(item.id)}
        className={`tar is-${state.toLowerCase()}${kind === "REMOVAL" ? " is-removal" : ""}${isOpen ? " is-open" : ""}`}
      >
        <div className="tar-top">
          <button
            type="button"
            className="tar-head"
            aria-expanded={isOpen}
            aria-controls={bodyId}
            onClick={() => {
              setConfirming(null);
              onOpen(flip(opened, item.id));
            }}
          >
            <span className="tar-letter" aria-hidden="true">
              {letter}
            </span>
            <span className="tar-name">
              <span className="sr-only">{`Attribute ${letter}: `}</span>
              <span className="tar-text">
                {kind === "REMOVAL" && target !== null
                  ? target.text
                  : item.text}
              </span>
              <span className="tar-source">
                <span
                  className={kind !== "APPROVED" ? "tar-origin" : undefined}
                >
                  {origin}
                </span>
              </span>
            </span>
          </button>
          {quickAccept ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm tar-quick"
              disabled={locked}
              aria-label={`Accept attribute ${letter}`}
              onClick={() => void accept(each)}
            >
              {accepting ? "Accepting…" : "Accept"}
            </button>
          ) : null}
          <span className={`tar-chip tone-${chip.tone}`}>{chip.label}</span>
          <span className="tar-caret" aria-hidden="true">
            <UiIcon name="chevron" size={14} />
          </span>
        </div>
        {isOpen ? (
          <div className="tar-body" id={bodyId}>
            {kind === "REWORDED" && target !== null && previousShown ? (
              <p className="ta-replaces" id={`${bodyId}-previous`}>
                <span>Previous wording</span> {target.text}
              </p>
            ) : null}
            {kind !== "APPROVED" && item.sourceQuote !== "" ? (
              <q className="ta-quote">{item.sourceQuote}</q>
            ) : null}
            {kind !== "APPROVED" && item.note !== "" ? (
              <p className="ta-why">{item.note}</p>
            ) : null}
            {basis !== null ? (
              <div className="ta-basis">
                <p>
                  <span>Follows the understanding</span> {basis.follows}
                </p>
                {basis.setsAside.map((line) => (
                  <p key={line}>
                    <span>Sets aside</span> {line}
                  </p>
                ))}
              </div>
            ) : null}
            {kind === "APPROVED" ? (
              <TailoredCriteria
                key={writing === item.id ? "writing" : "shown"}
                ids={ids}
                item={item}
                canAct={canAct && !running}
                startEditing={writing === item.id}
                flat
                notes={notes}
                actions={(form) => acts(form)}
              />
            ) : (
              <div className="tc is-flat">
                {kind === "REMOVAL" ? null : stated ||
                  criteria.judgmentRequired === true ? (
                  <dl className="tc-rules">
                    {criteria.condition !== "" ? (
                      <div>
                        <dt>Tested</dt>
                        <dd>{criteria.condition}</dd>
                      </div>
                    ) : null}
                    <div className="is-pass">
                      <dt>Passes</dt>
                      <dd>{criteria.passCriteria || "Not stated"}</dd>
                    </div>
                    <div className="is-fail">
                      <dt>Fails</dt>
                      <dd>{criteria.failCriteria || "Not stated"}</dd>
                    </div>
                    {criteria.judgmentRequired === true ? (
                      <div>
                        <dt>Judgment</dt>
                        <dd>Professional judgment required</dd>
                      </div>
                    ) : null}
                  </dl>
                ) : (
                  <p className="tc-missing">
                    The agent stated no criteria a tester could apply. Write
                    them once the attribute is accepted.
                  </p>
                )}
                {notes}
                {acts(null)}
              </div>
            )}
            {standardShown && item.definition !== null ? (
              <div className="ta-how" id={`${bodyId}-standard`}>
                <p className="ta-how-title">
                  The standard's requirement{" "}
                  <ConfidenceChip confidence={item.definition.confidence} />
                </p>
                <DefinitionRules definition={item.definition} />
              </div>
            ) : null}
          </div>
        ) : null}
      </li>
    );
  }

  const basisLine = listBasisLine(rows);
  const howId = `${id}-how`;
  const removedNow = gone.filter((item) => item.outcome === "REMOVED").length;
  return (
    <div className="cc-attributes ta is-embedded" aria-busy={locked}>
      {heading !== null && heading.kind === "review" ? (
        <section className="tar-review" aria-labelledby={`${id}-review`}>
          <div className="tar-review-text">
            <h3 id={`${id}-review`}>{heading.title}</h3>
            <p>{heading.line}</p>
          </div>
          {progress.total > 0 ? (
            <div className="tar-progress">
              <p className="tar-progress-line">
                <span>Reviewed</span>
                <span className="tar-progress-value">{reviewed.value}</span>
              </p>
              <div
                className="tar-segments"
                role="img"
                aria-label={reviewed.label}
                style={{
                  gridTemplateColumns: `repeat(${progress.total}, minmax(0, 1fr))`,
                }}
              >
                {progress.marks.map((mark, index) => (
                  <span
                    // The bar's segments are its entries' places, in order.
                    // biome-ignore lint/suspicious/noArrayIndexKey: one per place
                    key={index}
                    className={`is-${mark.toLowerCase()}`}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
      {heading !== null && heading.kind === "set" ? (
        <>
          <section className="tar-review is-set" aria-labelledby={`${id}-set`}>
            <span className="tar-review-tick" aria-hidden="true">
              <UiIcon name="check" size={15} />
            </span>
            <div className="tar-review-text">
              <h3 id={`${id}-set`}>{heading.title}</h3>
              <p>{setLine(approved, removedNow, heading.follows)}</p>
            </div>
            <Link
              className="btn btn-primary tar-review-act"
              href={heading.href}
              scroll={false}
            >
              {heading.label}
              <UiIcon name="arrow" size={14} />
            </Link>
          </section>
          {heading.gap !== "" ? (
            <p className="ah-coverage is-gap">
              <UiIcon name="risk" size={13} />
              <span>{heading.gap}</span>
            </p>
          ) : null}
        </>
      ) : null}
      <div className="ta-bar">
        <div className="tar-bar-title">
          <h4 className="tar-count" ref={countRef} tabIndex={-1}>
            {listCount(
              entries.filter((entry) => entry.kind === "row").length,
              removedNow,
            )}
          </h4>
          {basisLine !== "" || agent !== null ? (
            <span className="tar-basis">
              {basisLine}
              {agent !== null ? (
                <>
                  {basisLine !== "" ? " · " : ""}
                  <button
                    type="button"
                    className="tas-link"
                    aria-expanded={howOpen}
                    aria-controls={howId}
                    onClick={() => setHowOpen((value) => !value)}
                  >
                    How
                  </button>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
        {canAct ? (
          <span className="ta-bar-acts">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={locked}
              onClick={() => onDialog({ mode: "add" })}
            >
              <UiIcon name="plus" size={13} />
              Add
            </button>
            {offersAgentRun(
              agentRan(context),
              context.attributesRerunUseful,
            ) ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={locked}
                onClick={() => onGenerate()}
              >
                <UiIcon name="sparkles" size={13} />
                {busyKey === "generate"
                  ? "Reading the sources…"
                  : agentRan(context)
                    ? "Run again"
                    : "Propose with the agent"}
              </button>
            ) : null}
            {showAllNote ? (
              <span
                className="tar-all-note"
                id={`ta-accept-note-${ids.controlId}`}
              >
                {allNote}
              </span>
            ) : null}
            {offersAll ? (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={locked}
                aria-describedby={
                  showAllNote ? `ta-accept-note-${ids.controlId}` : undefined
                }
                onClick={() => void acceptAll()}
              >
                {busyKey === "accept-all" ? "Accepting…" : allWords.label}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {agent !== null ? (
        <div className="tar-how" id={howId} hidden={!howOpen}>
          <p>{agent.did}</p>
          {agent.found.length > 0 ? (
            <ul>
              {agent.found.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {working !== null ? (
        <p className="ta-working">
          <small className="ep-reading" role="status">
            {working}
            <span className="ep-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </small>
        </p>
      ) : failure !== null ? (
        <div className="ta-run-note tone-warning has-acts" role="status">
          <UiIcon name="info" size={13} />
          <span>{failure}</span>
          {canAct ? (
            <span className="ta-run-acts">
              {/* One "Run again" on the step: here only where the bar above does not
                  offer it (nothing the agents read changed), and then on purpose all
                  the same (force), since the run did not do its work. */}
              {!offersAgentRun(
                agentRan(context),
                context.attributesRerunUseful,
              ) ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={locked}
                  onClick={() => onGenerate(true)}
                >
                  <UiIcon name="retry" size={13} />
                  {busyKey === "generate" ? "Starting…" : "Run again"}
                </button>
              ) : null}
              {toWrite !== null ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={locked}
                  onClick={() => writeCriteria(toWrite)}
                >
                  <UiIcon name="compose" size={13} />
                  Write criteria
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : settledRun !== null ? (
        <p className="ta-run-note" role="status">
          <UiIcon name="info" size={13} />
          <span>{settledRun}</span>
        </p>
      ) : unreviewed !== null ? (
        <p className="ta-run-note tone-warning" role="status">
          <UiIcon name="info" size={13} />
          {unreviewed}
        </p>
      ) : null}
      {beforeComplete && working === null ? (
        <p className="ta-run-note" role="status">
          <UiIcon name="info" size={13} />
          <span>{DRAFTED_ONCE_COMPLETE}</span>
        </p>
      ) : null}
      {!running && pending !== null ? (
        // The planner's criteria were written into a change to the approved test plan:
        // said, with where that change is decided (the Test plans page's "Accept the
        // planner's revision"), never as criteria nobody wrote.
        <p className="ta-run-note tone-warning has-acts" role="status">
          <UiIcon name="info" size={13} />
          <span>{pending}</span>
          <span className="ta-run-acts">
            <a
              className="btn btn-ghost btn-sm"
              href={planningHref(ids.organizationId, ids.projectId, {
                control: ids.controlId,
                tab: "attributes",
              })}
            >
              Review the change
            </a>
          </span>
        </p>
      ) : null}
      {status}
      {/* What a decision on a row did, once the server confirmed it, for assistive
          technology; the row itself says it on screen. */}
      <p className="sr-only" role="status">
        {said}
      </p>
      {/* The agent's assumptions on the whole set (B1j), above the list, in the same form. */}
      <AttributeAssumptions
        ids={ids}
        items={context.setAssumptions}
        canAct={canAct}
        locked={locked}
        onContext={onContext}
        label="The agent's assumptions on the attributes as a set"
      />
      <ul className="tar-list" aria-label="Testing attributes">
        {entries.map((entry) =>
          entry.kind === "row" ? row(entry.row) : goneRow(entry.gone),
        )}
        {entries.length === 0 ? (
          <li className="tar-empty">
            {running
              ? "The agents are preparing the attributes."
              : "No approved attributes yet. Propose them with the agent, or add one."}
          </li>
        ) : null}
      </ul>
      <div className="ta-folds">
        <details className="ta-fold">
          <summary>How attributes work</summary>
          <p>
            Approved attributes are the testing criteria: the test checks each
            one on every item, against its pass and fail criteria. The agents
            prepare them from the understanding and a reviewer agent checks
            them; nothing they wrote counts until a person accepts its row, and
            a changed or removed attribute keeps its earlier wording in the
            history.
          </p>
          {canAct &&
          !offersAgentRun(agentRan(context), context.attributesRerunUseful) ? (
            <p>
              Nothing the agents read has changed since their last run, so
              running them again is not offered above.{" "}
              <button
                type="button"
                className="ur-skip"
                disabled={locked}
                onClick={() => onGenerate(true)}
              >
                Run the agents again anyway
              </button>
            </p>
          ) : null}
        </details>
        {folds}
      </div>
      {after}
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
                {/* B1l: a question left as not known is never read as settled by an answer. */}
                <Badge>
                  {issue.status === "NOT_KNOWN"
                    ? "not known yet"
                    : issue.status.toLowerCase()}
                </Badge>{" "}
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
                accept=".docx,.pdf,.txt,.md,.xlsx,.csv,.png,.jpg,.jpeg,image/png,image/jpeg"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <span className="form-hint">
                Word, PDF, Excel, text, or an image (PNG or JPEG), under 5 MB.
                An image is read by OCR. Its text is kept; the file is not.
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
