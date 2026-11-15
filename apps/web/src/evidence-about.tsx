"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";

import {
  EVIDENCE_KIND_LABELS,
  EVIDENCE_KINDS,
  type EvidenceKind,
} from "./analysis-model";
import { AutoRefresh } from "./auto-refresh";
import type { ControlFiles } from "./engagement-model";
import type { AboutPlace, AboutTab, PanelTab } from "./evidence-annotations";
import type { AnnotationAsk } from "./evidence-annotations-model";
import { FileChanges } from "./evidence-change";
import {
  instanceFor,
  interimPopulationOf,
  kindLabel,
  type ReadState,
  readableReason,
  type SuggestionAction,
  sampleSize,
  sizeChoices,
  suggestionFor,
  type WalkthroughInstance,
  walkthroughItemOf,
} from "./evidence-dialog-model";
import type { EvidenceFinding } from "./evidence-findings-model";
import { findingsForFile } from "./evidence-findings-model";
import { useFindingsAction } from "./evidence-findings-view";
import {
  insightOf,
  navigatorOf,
  phaseOfItem,
} from "./evidence-intelligence-model";
import { Analysis, Details, Trace } from "./evidence-intelligence-view";
import type { EvidenceMappingRun } from "./evidence-mapping-model";
import { AnnotatedDialog } from "./evidence-opener";
import type { EvidencePlan, PlanRequirement } from "./evidence-plan-model";
import { Problem, usePlanAction } from "./evidence-plan-view";
import type { EvidenceCitation } from "./evidence-preview-model";
import { DataTable } from "./population-table";
import type { ControlTest } from "./testing-model";
import { UiIcon } from "./ui-icon";

/**
 * "About this file" (docs/evidence-annotations.md, section 5b): what the evidence reviewer
 * held, moved into the one viewer as the second tab of its side panel. The reader's
 * classification, with "Confirm the type" and "Change"; the reading's state and a failed
 * read's "Read again"; the data of a spreadsheet or a population, with picking the
 * walkthrough instance where it is offered; population checks, samples and the instance;
 * the file's findings with their actions; "Remove from this request"; the file's history.
 *
 * Each action keeps the server call, form and confirmation it had in the reviewer, and
 * nothing is shown as done before the server has answered. Opening the tab writes
 * nothing: it is drawn from what the page already holds, and the file's rows are read
 * (GET) only when a person asks for them. The upload mode of the evidence dialog
 * (evidence-dialog.tsx) shows a file it has just taken with these same pieces.
 */

type Ids = { organizationId: string; projectId: string; controlId: string };

/** What the page holds about the control's evidence, from which the tab is drawn. */
export type AboutContext = {
  ids: Ids;
  plan: EvidencePlan;
  register: ControlFiles | null;
  mapping: EvidenceMappingRun | null;
  attributes: ReadonlyArray<{ code: string; text: string }>;
  controlRef: string;
  canAct: boolean;
  findings: EvidenceFinding[] | null;
  tests: ControlTest[] | null;
  instances: WalkthroughInstance[] | null;
  /** Uploads the walkthrough instance's evidence: the screen's own upload on that item. */
  onUpload?: ((itemId: string) => void) | undefined;
  /** A file withdrawn from its request (the server confirmed it): the screen says so on
   * its list and closes the viewer, since the file no longer serves the request. */
  onWithdrawn?: ((message: string) => void) | undefined;
};

/** What the reviewer's own calls answer, and what is in progress: its route, unchanged. */
export function useDialogAction(ids: Ids) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  async function run(
    label: string,
    fields: Record<string, unknown>,
  ): Promise<boolean> {
    setBusy(label);
    setProblem(null);
    let status = 0;
    let detail = "";
    try {
      const response = await fetch("/workspace/evidence-dialog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          ...fields,
        }),
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
    } catch {
      status = 0;
    }
    setBusy("");
    if (status === 200) {
      // Success shows once the server has answered and the page holds the new state.
      startTransition(() => router.refresh());
      return true;
    }
    setProblem(
      status === 403
        ? "You do not have permission to do this on this engagement."
        : status === 409 && detail !== ""
          ? `${detail.charAt(0).toUpperCase()}${detail.slice(1)}.`
          : status === 422
            ? "That was not accepted. Check the choice and try again."
            : "The action did not complete. Try again in a moment.",
    );
    return false;
  }
  return { run, busy, pending, problem };
}

/** The file shown, as the reviewer read it from the page, and what may be done with it. */
export type FileAbout = ReturnType<typeof useFileAbout>;

/**
 * Everything the reviewer worked out for one file: its reading, type, item and phase, the
 * agent's suggestion, its sample plan and instance, its findings; and the actions, each
 * by its existing call (moved from evidence-dialog.tsx). `onPickStart` and
 * `onUploadInstance` are where the screen shows the rows to pick from, and the upload.
 */
export function useFileAbout(
  context: AboutContext,
  fileId: string | null,
  ui: {
    onPickStart: () => void;
    onUploadInstance: (itemId: string) => void;
  },
) {
  const { ids, plan, register, mapping, attributes, controlRef } = context;
  const phases = useMemo(() => navigatorOf(plan, register), [plan, register]);
  const items = phases.flatMap((entry) => entry.items);
  const [routed, setRouted] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [changingKind, setChangingKind] = useState(false);
  const [size, setSize] = useState<number | null>(null);
  const dialog = useDialogAction(ids);
  const plan$ = usePlanAction(ids);
  const findingsAction = useFindingsAction(ids);

  const insight =
    fileId === null
      ? null
      : insightOf(fileId, phases, register, mapping, attributes, controlRef);
  const fileItem =
    insight === null
      ? null
      : (items.find(
          (entry) => entry.requirement.id === insight.file.requirementId,
        ) ?? null);
  const phase = phaseOfItem(phases, fileItem?.requirement.id ?? null);
  const analysis = insight?.analysis ?? null;
  const read: ReadState =
    fileId === null
      ? "none"
      : analysis === null ||
          analysis.status === "PENDING" ||
          analysis.status === "WORKING"
        ? "reading"
        : analysis.status === "FAILED"
          ? "failed"
          : "ready";
  const kind: EvidenceKind | null =
    analysis?.confirmedKind ?? analysis?.classification?.kind ?? null;
  const table =
    analysis !== null && analysis.rows !== null && analysis.columns.length > 0;
  const population = read === "ready" && kind === "population" && table;
  const test =
    fileId === null
      ? null
      : ((context.tests ?? []).find(
          (entry) => entry.populationFileId === fileId,
        ) ?? null);
  const instance =
    fileId === null ? null : instanceFor(context.instances, fileId);
  const walkItem = walkthroughItemOf(phases, fileItem);
  const interimItem = interimPopulationOf(phases);
  const suggestion =
    phase === null
      ? null
      : suggestionFor({
          read,
          kind,
          confirmed: analysis?.confirmedKind != null,
          phase,
          itemTitle: fileItem?.requirement.title ?? "",
          table,
          interimPopulation: interimItem !== null,
          populationAccepted: fileItem?.requirement.state === "ACCEPTED",
          samples:
            test === null
              ? null
              : { status: test.status, count: test.samples.length },
          instance:
            instance === null
              ? null
              : { key: instance.keyValue, rowNumber: instance.rowNumber },
          linkedToInterim:
            interimItem?.files.some((file) => file.id === fileId) ?? false,
        });
  const records =
    context.findings === null || fileId === null
      ? null
      : findingsForFile(context.findings, fileId);
  const findingCount =
    (records?.length ?? 0) +
    (insight?.findings.filter((finding) => finding.source === "REVIEW")
      .length ?? 0);
  const chosenSize = size ?? test?.sampleSize ?? 1;
  // Picking the walkthrough instance is offered where the reviewer offered it.
  const canPick = context.canAct && walkItem !== null && table;

  const confirm = (chosen: EvidenceKind) =>
    analysis === null
      ? Promise.resolve(false)
      : dialog.run("confirm", {
          intent: "confirm-kind",
          analysis_id: analysis.id,
          version: analysis.version,
          kind: chosen,
        });

  /** A failed read, read again: the reader's own re-read, by the reviewer's route. */
  const reread = () =>
    analysis === null
      ? Promise.resolve(false)
      : dialog.run("reread", {
          intent: "reanalyze",
          analysis_id: analysis.id,
          version: analysis.version,
        });

  /** A row of the population picked as the walkthrough instance, once the server has
   * recorded it. */
  const pickRow = async (row: number): Promise<boolean> => {
    if (walkItem === null || insight === null) {
      return false;
    }
    const ok = await dialog.run("pick", {
      intent: "pick-instance",
      control_id: ids.controlId,
      requirement_id: walkItem.requirement.id,
      file_id: insight.file.id,
      row_number: row,
    });
    if (ok) {
      setPicking(false);
    }
    return ok;
  };

  const act = async (action: SuggestionAction) => {
    if (action === "confirm-population") {
      await confirm("population");
    } else if (action === "confirm-kind" && kind !== null) {
      await confirm(kind);
    } else if (action === "change-kind") {
      setChangingKind(true);
    } else if (action === "pick-one") {
      setPicking(true);
      ui.onPickStart();
    } else if (action === "route-interim" && interimItem !== null && fileId) {
      const ok = await plan$.run(`link-${interimItem.requirement.id}`, {
        intent: "link",
        requirement_id: interimItem.requirement.id,
        file_id: fileId,
        reason:
          "Routed from Design & Implementation as the population for interim testing.",
        version: interimItem.requirement.version,
      });
      if (ok) {
        setRouted("Linked to interim testing. Its samples are chosen there.");
      }
    } else if (action === "keep-design") {
      if (analysis?.confirmedKind == null) {
        await confirm("population");
      }
      setRouted("Kept in Design & Implementation.");
    } else if (action === "upload-instance" && walkItem !== null) {
      setPicking(false);
      ui.onUploadInstance(walkItem.requirement.id);
    } else if (action === "accept-population" && fileItem !== null) {
      await plan$.run(`judge-${fileItem.requirement.id}`, {
        intent: "sufficiency",
        requirement_id: fileItem.requirement.id,
        sufficiency: "ACCEPTED",
        note: "",
        version: fileItem.requirement.version,
      });
    } else if (action === "choose-samples" && fileId !== null) {
      await dialog.run("propose", {
        intent: "propose-samples",
        file_id: fileId,
        sample_size: chosenSize,
      });
    } else if (action === "approve-samples" && test !== null) {
      await dialog.run("approve", {
        intent: "approve-samples",
        test_id: test.id,
        version: test.version,
      });
    }
  };
  const actionLabel = (action: SuggestionAction, label: string) =>
    action === "choose-samples"
      ? `${label === "Draw again" ? "Draw again" : "Select"} ${chosenSize} sample${chosenSize === 1 ? "" : "s"}`
      : label;

  return {
    phases,
    items,
    insight,
    fileItem,
    phase,
    analysis,
    read,
    kind,
    table,
    population,
    test,
    instance,
    walkItem,
    suggestion,
    records,
    findingCount,
    chosenSize,
    setSize,
    routed,
    setRouted,
    picking,
    setPicking,
    canPick,
    changingKind,
    setChangingKind,
    dialog,
    plan$,
    findingsAction,
    confirm,
    reread,
    pickRow,
    act,
    actionLabel,
  };
}

/** The reader's confidence, or "Confirmed" once a person confirmed the type. */
export function ConfidencePill({ about }: { about: FileAbout }) {
  const { read, analysis } = about;
  if (read !== "ready" || !analysis?.classification) {
    return null;
  }
  const confirmed = analysis.confirmedKind != null;
  const confidence = analysis.classification.confidence;
  return (
    <span className={`ed-confidence is-${confirmed ? "high" : confidence}`}>
      {confirmed
        ? "Confirmed"
        : `${confidence.charAt(0).toUpperCase()}${confidence.slice(1)} confidence`}
    </span>
  );
}

/**
 * The reader's classification and what to do with it (the reviewer's "AI classification"
 * side): the detected type, why, the agent's suggestion with its actions, the form to
 * change the type, and the sample size for a population.
 */
export function Classification({
  about,
  canAct,
  onFindings,
  findingsIn = "",
}: {
  about: FileAbout;
  canAct: boolean;
  /** "Review N findings": where the file's findings are. */
  onFindings: () => void;
  /** Where they are, said after the count (" in Details"), or nothing. */
  findingsIn?: string;
}) {
  const {
    read,
    analysis,
    kind,
    table,
    suggestion,
    routed,
    findingCount,
    dialog,
    plan$,
    changingKind,
    setChangingKind,
    population,
    test,
    phase,
    chosenSize,
    setSize,
  } = about;
  return (
    <>
      <div className="ed-fact">
        <span className="ed-fact-icon is-type" aria-hidden="true">
          <UiIcon name={table ? "table" : "file"} size={20} />
        </span>
        <div>
          <small>Detected file type</small>
          <strong className="ed-fact-type">
            {read === "ready"
              ? kind === "population"
                ? "Population"
                : kindLabel(kind)
              : read === "failed"
                ? "Not read"
                : "Reading the file…"}
          </strong>
        </div>
      </div>
      {read === "ready" && analysis?.classification?.reason ? (
        <div className="ed-fact">
          <span className="ed-fact-icon is-why" aria-hidden="true">
            <UiIcon name="eye" size={18} />
          </span>
          <div>
            <small>Why it was classified this way</small>
            <p>{readableReason(analysis.classification.reason)}</p>
          </div>
        </div>
      ) : null}

      {suggestion !== null ? (
        <section className="ed-suggest" aria-label="What the agent suggests">
          <div className="ed-suggest-head">
            <span className="ed-suggest-icon" aria-hidden="true">
              <UiIcon name="target" size={22} />
            </span>
            <div>
              <strong>{routed ?? suggestion.title}</strong>
              {routed === null ? <p>{suggestion.question}</p> : null}
            </div>
          </div>
          {canAct && routed === null && suggestion.actions.length > 0 ? (
            <div className="ed-suggest-actions">
              {suggestion.actions.map((entry) => (
                <button
                  key={entry.action}
                  type="button"
                  className={entry.primary ? "btn" : "btn-secondary"}
                  disabled={
                    dialog.busy !== "" || dialog.pending || plan$.pending
                  }
                  onClick={() => void about.act(entry.action)}
                >
                  {about.actionLabel(entry.action, entry.label)}
                </button>
              ))}
            </div>
          ) : null}
          {read === "ready" && findingCount > 0 ? (
            <button
              type="button"
              className="ed-findings-link"
              onClick={onFindings}
            >
              Review {findingCount} finding
              {findingCount === 1 ? "" : "s"}
              {findingsIn}
            </button>
          ) : null}
          <Problem text={dialog.problem ?? plan$.problem} />
        </section>
      ) : null}

      {changingKind && analysis !== null && canAct ? (
        <form
          className="ed-panel"
          autoComplete="off"
          onSubmit={async (event) => {
            event.preventDefault();
            const chosen = new FormData(event.currentTarget).get("kind");
            const next = EVIDENCE_KINDS.find((each) => each === chosen);
            if (next !== undefined && (await about.confirm(next))) {
              setChangingKind(false);
            }
          }}
        >
          <label>
            <span>What the file is</span>
            <select name="kind" defaultValue={kind ?? "other"}>
              {EVIDENCE_KINDS.map((each) => (
                <option key={each} value={each}>
                  {EVIDENCE_KIND_LABELS[each]}
                </option>
              ))}
            </select>
          </label>
          <div className="ed-panel-actions">
            <button type="submit" className="btn btn-sm">
              Confirm the type
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setChangingKind(false)}
            >
              Cancel
            </button>
          </div>
          {suggestion === null ? <Problem text={dialog.problem} /> : null}
        </form>
      ) : null}

      {population && test?.status !== "APPROVED" ? (
        <SampleSize
          planSize={test?.sampleSize ?? null}
          design={phase === "DESIGN"}
          value={chosenSize}
          onChange={setSize}
          disabled={!canAct}
        />
      ) : null}
    </>
  );
}

/** The population's own checks, as the sample plan recorded them. */
export function PopulationChecks({ test }: { test: ControlTest | null }) {
  if (test === null || test.checks.length === 0) {
    return null;
  }
  return (
    <section className="ed-panel" aria-label="Population checks">
      <small className="ed-kicker">Population checks</small>
      <ul className="ed-checks">
        {test.checks.map((check) => (
          <li key={check.check} className={`is-${check.result.toLowerCase()}`}>
            <UiIcon
              name={
                check.result === "OK"
                  ? "check"
                  : check.result === "ISSUE"
                    ? "risk"
                    : "info"
              }
              size={13}
            />
            {check.detail}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The samples drawn from the population, proposed or approved. */
export function Samples({ test }: { test: ControlTest | null }) {
  if (test === null || test.samples.length === 0) {
    return null;
  }
  return (
    <section className="ed-panel" aria-label="Samples">
      <small className="ed-kicker">
        {test.status === "APPROVED" ? "Approved samples" : "Proposed samples"} ·{" "}
        {test.samples.length} of {test.frameRows.toLocaleString()}
      </small>
      <ol className="ed-samples">
        {test.samples.map((sample) => (
          <li key={sample.position}>
            <span>{sample.keyValue || `Row ${sample.rowNumber}`}</span>
            <small>row {sample.rowNumber}</small>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The walkthrough instance picked from the population, and who picked it. */
export function Instance({
  instance,
}: {
  instance: WalkthroughInstance | null;
}) {
  if (instance === null) {
    return null;
  }
  return (
    <section className="ed-panel" aria-label="Walkthrough instance">
      <small className="ed-kicker">Walkthrough instance</small>
      <dl className="ed-instance">
        {instance.columns.slice(0, 8).map((column, index) => (
          <div key={column}>
            <dt>{column}</dt>
            <dd>{instance.values[index] ?? ""}</dd>
          </div>
        ))}
      </dl>
      <small className="ed-quiet">
        Row {instance.rowNumber}, picked by {instance.selectedBy || "a person"}.
      </small>
    </section>
  );
}

/** The file's findings and its coverage, with their actions, and the mapping's trace. */
export function FileFindings({
  about,
  context,
  onShow,
  focused,
}: {
  about: FileAbout;
  context: AboutContext;
  onShow: (citation: EvidenceCitation | null) => void;
  focused: EvidenceCitation | null;
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [pickedRecords, setPickedRecords] = useState<Set<string>>(
    () => new Set(),
  );
  const { insight } = about;
  if (insight === null || about.read !== "ready") {
    return null;
  }
  return (
    <section
      id="ed-findings"
      className="ed-findings"
      aria-label="Findings and coverage"
    >
      <Analysis
        insight={insight}
        items={about.items}
        canAct={context.canAct}
        action={about.plan$}
        picked={picked}
        onPick={(key, on) => setPicked((current) => toggle(current, key, on))}
        onShow={onShow}
        focused={focused}
        records={about.records}
        findingsAction={about.findingsAction}
        pickedRecords={pickedRecords}
        onPickRecord={(key, on) =>
          setPickedRecords((current) => toggle(current, key, on))
        }
        controlRef={context.controlRef}
        controlTitle=""
      />
      <Trace
        insight={insight}
        ids={context.ids}
        onShow={onShow}
        focused={focused}
      />
    </section>
  );
}

/** The file's rows, paged and searchable; to pick the walkthrough instance from where a
 * person may. */
export function FileData({
  about,
  context,
  fileId,
  compact = false,
  onAll,
  onPicked,
}: {
  about: FileAbout;
  context: AboutContext;
  fileId: string;
  compact?: boolean;
  onAll?: () => void;
  /** The row the server recorded as the instance. */
  onPicked?: (row: number) => void;
}) {
  return (
    <DataTable
      key={`${fileId}-${compact ? "preview" : "data"}`}
      ids={context.ids}
      fileId={fileId}
      compact={compact}
      picking={!compact && about.picking && about.canPick}
      chosenRow={about.instance?.rowNumber ?? null}
      busy={!compact && about.dialog.busy === "pick"}
      onPick={async (row) => {
        if (await about.pickRow(row)) {
          onPicked?.(row);
        }
      }}
      onCancel={() => about.setPicking(false)}
      {...(onAll === undefined ? {} : { onAll })}
    />
  );
}

/** Withdrawing the file from its request: the existing form, asked once. */
export function WithdrawForm({
  context,
  fileId,
  fileName,
  onCancel,
  onDone,
}: {
  context: AboutContext;
  fileId: string;
  fileName: string;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  return (
    <div className="ed-withdraw">
      <FileChanges
        organizationId={context.ids.organizationId}
        projectId={context.ids.projectId}
        fileId={fileId}
        fileName={fileName}
        blocked={null}
        controlId={context.ids.controlId}
        keep={{ step: "request" }}
        start="withdraw"
        onCancel={onCancel}
        onDone={() =>
          onDone(
            `${fileName} was withdrawn. It is kept on record with who withdrew it, and can be restored.`,
          )
        }
      />
    </div>
  );
}

/** Whether "About this file" has anything to say: a file the page knows on a request. */
export function aboutApplies(context: AboutContext, fileId: string): boolean {
  const phases = navigatorOf(context.plan, context.register);
  return (
    insightOf(
      fileId,
      phases,
      context.register,
      context.mapping,
      context.attributes,
      context.controlRef,
    ) !== null
  );
}

/**
 * The tab for the viewer (AnnotatedDialog's `about`): for each file shown, "About this
 * file", or null where nothing about it applies. `start`: "pick" opens on the rows to
 * pick the walkthrough instance from, where that is offered (a check's "Pick the
 * walkthrough instance").
 */
export function aboutTabs(
  context: AboutContext,
  start?: "pick",
): (fileId: string) => AboutTab | null {
  return (fileId) =>
    aboutApplies(context, fileId)
      ? (place) => (
          <AboutThisFile
            key={fileId}
            context={context}
            fileId={fileId}
            place={place}
            start={start}
          />
        )
      : null;
}

/**
 * A file opened from a screen's list (section 5b): the file, the other files of the same
 * list for the viewer's switcher, the D&I request whose annotations are read where one is
 * known, and what the opener asked to see.
 */
export type FileOpen = {
  fileId: string;
  files: Array<{ id: string; fileName: string }>;
  /** The D&I request the file serves: its annotations are shown and reviewed. */
  requirementId?: string | undefined;
  /** The passage the file was opened to see, for an attribute (a "Shown" row). */
  annotation?: AnnotationAsk | undefined;
  /** The annotation to open on, by its id (a tickmark's "E2 · View"). */
  annotationId?: string | undefined;
  /** Opened to add an annotation for this attribute (a tickmark's "Add an annotation"). */
  add?: { attributeId: string } | undefined;
  /** "about": the file's details were asked for (a check's "Confirm the file's type"). */
  tab?: PanelTab | undefined;
  /** Opened to pick the walkthrough instance from the file's rows. */
  pick?: boolean | undefined;
  /** Run once the viewer closes: the screen that opened it carries on (the tickmark
   * form reads its annotations again). */
  onClosed?: (() => void) | undefined;
};

/** A request's files as the viewer's switcher lists them. */
export function filesOf(
  requirement: Pick<PlanRequirement, "files">,
): FileOpen["files"] {
  return requirement.files.map((file) => ({
    id: file.fileId,
    fileName: file.name,
  }));
}

/** A file a link names (?file=): opened on the request that holds it, with that
 * request's other files and, on a D&I request, its annotations; null where the plan
 * holds no request with the file. */
export function fileOpenFor(
  plan: EvidencePlan,
  fileId: string,
): FileOpen | null {
  for (const phase of plan.phases) {
    for (const requirement of phase.requirements) {
      if (requirement.files.some((file) => file.fileId === fileId)) {
        return {
          fileId,
          files: filesOf(requirement),
          ...(requirement.phase === "DESIGN"
            ? { requirementId: requirement.id }
            : {}),
        };
      }
    }
  }
  return null;
}

/**
 * An existing file opened from a screen's list: the one viewer, full size, with the
 * request's annotations where one is known and "About this file" beside them. The focus
 * goes back to what opened it when it closes (AnnotatedDialog).
 */
export function FileViewer({
  open,
  context,
  onClose,
}: {
  open: FileOpen;
  context: AboutContext;
  onClose: () => void;
}) {
  const about = useMemo(
    () => aboutTabs(context, open.pick === true ? "pick" : undefined),
    [context, open.pick],
  );
  // What the reader's mapping cites in these files: boxed as "Cited", as the reviewer's
  // preview showed them.
  const phases = navigatorOf(context.plan, context.register);
  const citations = open.files.flatMap(
    (file) =>
      insightOf(
        file.id,
        phases,
        context.register,
        context.mapping,
        context.attributes,
        context.controlRef,
      )?.citations ?? [],
  );
  return (
    <AnnotatedDialog
      organizationId={context.ids.organizationId}
      projectId={context.ids.projectId}
      files={open.files}
      startFileId={open.fileId}
      citations={citations}
      sourcesTitle="What the evidence mapping cites"
      annotations={
        open.requirementId === undefined
          ? undefined
          : {
              controlId: context.ids.controlId,
              requirementId: open.requirementId,
            }
      }
      startAnnotationId={open.annotationId}
      startAnnotationFor={open.annotation}
      startAdding={open.add?.attributeId}
      about={about}
      startTab={open.tab ?? (open.pick === true ? "about" : "annotations")}
      onClose={onClose}
    />
  );
}

type DataView = "rows" | "pick" | null;

/** "About this file": the reviewer's content, a section each, only what has something
 * to say, the decision the agent prepared first. */
function AboutThisFile({
  context,
  fileId,
  place,
  start,
}: {
  context: AboutContext;
  fileId: string;
  place: AboutPlace;
  start?: "pick" | undefined;
}) {
  const [data, setData] = useState<DataView>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [focused, setFocused] = useState<EvidenceCitation | null>(null);
  const findingsRef = useRef<HTMLDetailsElement>(null);
  const dataButton = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const about = useFileAbout(context, fileId, {
    onPickStart: () => {
      setPicked(null);
      setData("pick");
    },
    onUploadInstance: (itemId) => context.onUpload?.(itemId),
  });
  const { insight, read, table, test, instance, analysis } = about;
  const { onStage } = place;
  const shown = data !== null && table;
  useEffect(() => {
    onStage(shown);
  }, [shown, onStage]);
  // Opened to pick the instance: the rows, ready to pick from, where that is offered.
  const started = useRef(false);
  useEffect(() => {
    if (start === "pick" && !started.current && about.canPick) {
      started.current = true;
      about.setPicking(true);
      setData("pick");
    }
  }, [start, about.canPick, about.setPicking]);
  if (insight === null) {
    return null;
  }
  const name = insight.file.fileName;
  const show = (citation: EvidenceCitation | null) => {
    setFocused(citation);
    if (citation !== null) {
      place.show(citation);
    }
  };
  const closeData = () => {
    about.setPicking(false);
    setData(null);
    dataButton.current?.focus();
  };

  return (
    <div className="ea-about-body">
      {read === "reading" ? <AutoRefresh seconds={3} /> : null}
      {picked !== null ? (
        <p className="ep-done" role="status">
          <UiIcon name="check" size={14} />
          <span>{picked}</span>
        </p>
      ) : null}

      <section className="ea-sec" aria-labelledby={`${uid}-type`}>
        <h3 id={`${uid}-type`}>
          What the file is
          <small>
            <ConfidencePill about={about} />
          </small>
        </h3>
        {read === "failed" ? (
          <div className="ea-about-read">
            <p>
              The file could not be read, so its type and what it shows are not
              known.
            </p>
            {context.canAct && analysis !== null ? (
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={about.dialog.busy !== ""}
                onClick={() => void about.reread()}
              >
                {about.dialog.busy === "reread" ? "Starting…" : "Read again"}
              </button>
            ) : null}
            <Problem text={about.dialog.problem} />
          </div>
        ) : read === "reading" ? (
          <p className="ea-about-read" role="status">
            <span className="spinner small" aria-hidden="true" /> The agent is
            reading the file. Its type and the next step appear here when it is
            done.
          </p>
        ) : null}
        {read === "ready" || read === "failed" ? (
          <Classification
            about={about}
            canAct={context.canAct}
            onFindings={() => {
              const box = findingsRef.current;
              if (box !== null) {
                box.open = true;
                box.querySelector<HTMLElement>("summary")?.focus();
                box.scrollIntoView({ block: "nearest" });
              }
            }}
          />
        ) : null}
        {about.fileItem !== null ? (
          <p className="ea-about-item">
            <span>Serves</span> {about.fileItem.requirement.title}
          </p>
        ) : null}
      </section>

      {table ? (
        <section className="ea-sec" aria-labelledby={`${uid}-data`}>
          <h3 id={`${uid}-data`}>
            Data
            {analysis?.rows != null ? (
              <small>{analysis.rows.toLocaleString()} rows</small>
            ) : null}
          </h3>
          <div className="ea-about-acts">
            <button
              ref={dataButton}
              type="button"
              className="btn-secondary btn-sm"
              aria-pressed={data === "rows"}
              onClick={() => {
                about.setPicking(false);
                setData(data === "rows" ? null : "rows");
              }}
            >
              {data === "rows" ? "Back to the file" : "Show the rows"}
            </button>
          </div>
        </section>
      ) : null}

      {test !== null && (test.checks.length > 0 || test.samples.length > 0) ? (
        <section className="ea-sec" aria-labelledby={`${uid}-plan`}>
          <h3 id={`${uid}-plan`}>Sample plan</h3>
          <div className="ea-about-stack">
            <PopulationChecks test={test} />
            <Samples test={test} />
          </div>
        </section>
      ) : null}

      {instance !== null ? (
        <section className="ea-sec" aria-labelledby={`${uid}-instance`}>
          <h3 id={`${uid}-instance`}>Walkthrough instance</h3>
          <Instance instance={instance} />
        </section>
      ) : null}

      {read === "ready" ? (
        <details
          ref={findingsRef}
          className="ea-sec ea-about-more"
          open={about.findingCount > 0}
        >
          <summary>
            Findings and coverage
            {about.findingCount > 0 ? (
              <small>{about.findingCount}</small>
            ) : null}
          </summary>
          <FileFindings
            about={about}
            context={context}
            onShow={show}
            focused={focused}
          />
        </details>
      ) : null}

      <details className="ea-sec ea-about-more">
        <summary>History</summary>
        <Details insight={insight} ids={context.ids} canAct={context.canAct} />
      </details>

      {context.canAct ? (
        <section className="ea-sec ea-about-remove" aria-label="Remove">
          {withdrawing ? (
            <WithdrawForm
              context={context}
              fileId={insight.file.id}
              fileName={name}
              onCancel={() => setWithdrawing(false)}
              onDone={(message) => {
                setWithdrawing(false);
                context.onWithdrawn?.(message);
              }}
            />
          ) : (
            <button
              type="button"
              className="btn-ghost btn-sm is-danger"
              onClick={() => setWithdrawing(true)}
            >
              <UiIcon name="trash" size={14} />
              Remove from this request
            </button>
          )}
        </section>
      ) : null}

      {shown && place.stage !== null
        ? createPortal(
            <div className="ea-data-pane">
              <header className="ea-data-head">
                <strong>
                  {data === "pick" && about.picking
                    ? "Pick the walkthrough instance"
                    : `The rows of ${name}`}
                </strong>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={closeData}
                >
                  Back to the file
                </button>
              </header>
              <FileData
                about={about}
                context={context}
                fileId={insight.file.id}
                onPicked={(row) => {
                  setData(null);
                  setPicked(
                    `Row ${row} is the walkthrough instance. Upload its evidence on ${about.walkItem?.requirement.title ?? "the walkthrough item"}.`,
                  );
                }}
              />
              <Problem text={about.dialog.problem} />
            </div>,
            place.stage,
          )
        : null}
    </div>
  );
}

function toggle(current: Set<string>, key: string, on: boolean): Set<string> {
  const next = new Set(current);
  if (on) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
}

/** How many samples to draw (the reference's "Select sample size"): a free choice (the
 * product owner's decision), with the test plan's own size beside it. A walkthrough in
 * design uses one instance. */
function SampleSize({
  planSize,
  design,
  value,
  onChange,
  disabled,
}: {
  planSize: number | null;
  design: boolean;
  value: number;
  onChange: (size: number) => void;
  disabled: boolean;
}) {
  const choices = sizeChoices(planSize);
  const [typed, setTyped] = useState("");
  const listed = choices.some((choice) => choice.size === value);
  return (
    <section className="ed-size" aria-label="Sample size">
      <div className="ed-size-head">
        <span className="ed-fact-icon is-size" aria-hidden="true">
          <UiIcon name="chart" size={18} />
        </span>
        <div>
          <strong>
            Select sample size (optional)
            <span
              className="ed-size-help"
              title={
                design
                  ? "A walkthrough in Design & Implementation uses one instance; larger samples are drawn in interim testing."
                  : "The agent selects the samples at random from the population, reproducibly. A person approves them before they are tested."
              }
            >
              <UiIcon name="info" size={14} />
            </span>
          </strong>
          <p>
            {design
              ? "The walkthrough is performed on one instance picked from the population."
              : `The agent randomly selects items from the population for testing.${planSize !== null ? ` The test plan sets ${planSize}.` : ""}`}
          </p>
        </div>
      </div>
      <div
        className="ed-size-choices"
        role="radiogroup"
        aria-label="Sample size"
      >
        {choices.map((choice) => {
          const off = disabled || (design && choice.size !== 1);
          return (
            // biome-ignore lint/a11y/useSemanticElements: a chip that reads as one choice of a group.
            <button
              key={choice.size}
              type="button"
              role="radio"
              aria-checked={value === choice.size}
              disabled={off}
              title={
                design && choice.size !== 1
                  ? "A walkthrough uses one instance."
                  : undefined
              }
              className={value === choice.size ? "is-on" : undefined}
              onClick={() => {
                onChange(choice.size);
                setTyped("");
              }}
            >
              <strong>{choice.size}</strong>
              <small>{choice.plan ? "Test plan" : choice.label}</small>
            </button>
          );
        })}
      </div>
      {design ? null : (
        <label className="ed-size-custom">
          <span>Or another number</span>
          <input
            inputMode="numeric"
            value={listed && typed === "" ? "" : typed || String(value)}
            placeholder="e.g. 25"
            disabled={disabled}
            onChange={(event) => {
              const text = event.target.value.replace(/[^0-9]/g, "");
              setTyped(text);
              const parsed = sampleSize(text);
              if (parsed !== null) {
                onChange(parsed);
              }
            }}
          />
        </label>
      )}
    </section>
  );
}
