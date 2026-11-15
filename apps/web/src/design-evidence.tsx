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
import { HeldPicker, PolicyPicker } from "./add-evidence-menu";
import type {
  DigestAddEvidence,
  DigestTickmarkAction,
  DigestTickmarkRead,
} from "./attribute-tickmark";
import { AutoRefresh } from "./auto-refresh";
import {
  CheckDigestView,
  type DigestAcceptAction,
  type DigestAskAction,
} from "./check-digest";
import {
  type Closing,
  checkDigest,
  type DigestExtra,
  fileRef,
  tickmarkAfter,
  tickmarkOffer,
} from "./check-digest-model";
import { ControlSend } from "./control-send";
import type { ActivityItem } from "./control-workspace-model";
import {
  COVERAGE_TICKMARKS,
  type EvidenceList,
  type EvidenceRow,
  evidenceActivity,
  fileMeta,
  type MenuKey,
  REQUESTS_CHANGED_EVENT,
  rowMenu,
} from "./design-evidence-model";
import {
  AttributesDialog,
  RequestDialog,
  useRequestAction,
} from "./design-requests";
import type { RequestRow as RequestsRow } from "./design-requests-model";
import {
  type AboutContext,
  type FileOpen,
  FileViewer,
  fileOpenFor,
  filesOf,
} from "./evidence-about";
import {
  type AnnotationAsk,
  type AnnotationSet,
  annotationsQuery,
  parseAnnotations,
} from "./evidence-annotations-model";
import {
  type AttributeLine,
  assuranceProblem,
  type CheckAction,
  CONSIDERATIONS_TITLE,
  checkPollDelay,
  dispositionProblem,
  FILES_TITLE,
  offeredAction,
  RESOLVED_TITLE,
  REVIEW_FOR,
  REVIEW_TITLE,
  type RequestCheck,
  type ReviewView,
  type RowFile,
  reliabilityProblem,
  rereadProblem,
  type ShownPassage,
  STILL_CHECKING,
  UPGRADE_BODY,
  UPGRADE_CONFIRM,
  UPGRADE_DONE,
  UPGRADE_TITLE,
  UPGRADE_WAIT,
} from "./evidence-assurance-model";
import { centerHref, DEFAULT_QUERY } from "./evidence-center-model";
import { type DialogOpen, EvidenceDialog } from "./evidence-dialog";
import {
  type EvidenceFinding,
  SENDABLE_STATUSES,
} from "./evidence-findings-model";
import {
  decideFinding,
  FindingRecords,
  FollowUpComposer,
  useFindingsAction,
} from "./evidence-findings-view";
import { evidenceHref } from "./evidence-flow";
import type { Picked } from "./evidence-intake";
import type { Intelligence } from "./evidence-intelligence-view";
import type {
  EvidencePlan,
  PlanRequirement,
  RequirementFile,
} from "./evidence-plan-model";
import {
  type Action,
  type FileForm,
  Problem,
  usePlanAction,
} from "./evidence-plan-view";
import { formatOf, wordingOf } from "./evidence-requests-model";
import {
  carriesFiles,
  droppedFiles,
  EvidenceWizard,
  useEvidenceWizard,
  WizardProgress,
} from "./evidence-wizard";
import { wizardItems } from "./evidence-wizard-model";
import type { HeldFile } from "./evidence-workspace-model";
import { linkableFiles } from "./evidence-workspace-model";
import { fileLine } from "./evidence-workspace-view";
import type { ReliabilityAction } from "./file-reliability";
import { reliabilityOffer } from "./file-reliability-model";
import { formatDate } from "./format";
import { LocalTime } from "./local-time";
import {
  choosable,
  type PolicyEvidence,
  proposalsFor,
} from "./policy-evidence-model";
import { PolicyCheck, PolicyOnFile, usePolicyEvidence } from "./policy-on-file";
import { RowMenu, type RowMenuItem } from "./row-menu";
import { type Trace, traceHeading, tracesSample } from "./sample-trace-model";
import { SampleTrace, useSampleTrace } from "./sample-trace-view";
import { type IconName, UiIcon } from "./ui-icon";

type Ids = {
  organizationId: string;
  projectId: string;
  controlId: string;
  /** The workflow step the file forms post from, so the page comes back to it. */
  step?: string | null;
};

/** Why nothing is offered right after an upload: rows may have moved to another
 * request, so the plan is read again first. */
const LOCKED = "The list is being read again after the upload. One moment.";
/** Why nothing is offered while a write of the list is on its way (not an upload). */
const SAVING = "Saving. One moment.";

/** Why Accept is off while the row's own form is open (a follow-up, a reason): one
 * decision at a time. */
const ASKING_FIRST = "Record or cancel the form under the result first.";
/** Said where an acceptance or a dismissal a tickmark asked for was refused and the
 * server gave no sentence of its own. */
const ACCEPT_REFUSED =
  "The server did not accept it. Try again from the summary.";
const FINDING_NOT_SHOWN =
  "The finding could not be read here, so it was not dismissed.";
const DISMISS_REFUSED =
  "The server did not dismiss it. Decide the finding itself.";

/** What of the row waits on the person beside a finished check, as its first screen
 * says it (docs/evidence-assurance.md, section 10.12): the sample the trace proposes or
 * asks for, and what a file hides behind "N files". The check's own model places each
 * (check-digest-model, DigestExtra): an item under "Needs attention", or a caveat. */
const EXTRA_TRACE = "TRACE";
const EXTRA_FILE = "ROW_FILE:";
const TRACE_WORDS = {
  PROPOSED: "Confirm the sample the agent proposed.",
  CHOOSE: "Pick the sample this request walks through.",
  view: "Review the sample",
  /** On the quiet line: what must not be lost of a trace that asks nothing. */
  failed: "The sample trace could not be loaded",
  points: (count: number) =>
    `${count} point${count === 1 ? "" : "s"} to settle in the sample`,
  late: (count: number) =>
    `${count} date${count === 1 ? "" : "s"} in the sample past the control's limit`,
} as const;
const FILE_WORDS = {
  application: "Set the application this file comes from.",
  applicationOf: (name: string) => `${name} names no application yet.`,
  view: "Show the file",
  unread: (count: number) =>
    `${count} file${count === 1 ? "" : "s"} could not be read`,
  reading: (count: number) =>
    `${count} file${count === 1 ? " is" : "s are"} still being read`,
} as const;

/** A confirmed sample's points still to settle, or its dates past the control's limit:
 * a caveat on the quiet line, so the first screen is never calm beside them. */
function tracePoints(trace: Trace): DigestExtra[] {
  const late = trace.files.flatMap((file) =>
    file.dates.filter((when) => when.over),
  ).length;
  const said =
    trace.observations.length > 0
      ? TRACE_WORDS.points(trace.observations.length)
      : late > 0
        ? TRACE_WORDS.late(late)
        : "";
  return said === ""
    ? []
    : [
        {
          key: "TRACE:POINTS",
          mark: "",
          headline: said,
          context: "",
          label: "",
          caveat: true,
        },
      ];
}

type ListDialog =
  | { mode: "add" }
  | { mode: "edit"; row: RequestsRow }
  | { mode: "attributes"; row: RequestsRow };

/** What a person is asked to say before a judgment or a change is recorded. */
type Asking =
  | { kind: "FOLLOW_UP_REQUIRED" | "INSUFFICIENT" | "NOT_REVIEWED" | "WAIVE" }
  | { kind: "UNLINK"; file: RequirementFile };

const MENU_ICONS: Record<MenuKey, IconName> = {
  edit: "compose",
  attributes: "tag",
  upload: "upload",
  policy: "file",
  held: "layers",
  upgrade: "retry",
  "follow-up": "message",
  insufficient: "risk",
  waive: "minus",
  restore: "retry",
  reopen: "retry",
  delete: "trash",
};

/**
 * "Check again" on a request whose check failed or is out of date, and "Check again
 * with the current engine" on one an earlier engine finished (docs/evidence-assurance.md,
 * section 10.10): one call, as the list's other actions make theirs.
 * Success is said only once the server has answered, and the checks are then read again
 * in place (no reload; open rows and filters stay). A refusal because the check changed
 * under the person (409) reads them again too.
 */
function useAssuranceAction(ids: Ids) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // A second press while the first is on its way sends nothing.
  const sending = useRef(false);
  // Any call of the list's checks on its way (a check, or a file read again), known at
  // once rather than at the next render.
  const out = useRef("");
  async function run(
    requirementId: string,
    intent: "rerun" | "upgrade" = "rerun",
  ): Promise<boolean> {
    if (sending.current) {
      return false;
    }
    sending.current = true;
    out.current = requirementId;
    setBusy(requirementId);
    setProblem(null);
    let status = 0;
    let detail = "";
    try {
      const response = await fetch("/workspace/evidence-assurance", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          intent,
          requirement_id: requirementId,
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
    out.current = "";
    sending.current = false;
    const message = assuranceProblem(status, detail);
    setProblem(message);
    if (message === null || status === 409) {
      startTransition(() => router.refresh());
    }
    return message === null;
  }
  /** Reads a file again whose reading failed: the reader's own re-read, through the
   * evidence dialog's route, so nothing reloads. */
  async function reread(
    fileId: string,
    analysis: { id: string; version: number },
  ): Promise<boolean> {
    setBusy(`reread-${fileId}`);
    out.current = `reread-${fileId}`;
    setProblem(null);
    let status = 0;
    try {
      const response = await fetch("/workspace/evidence-dialog", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          intent: "reanalyze",
          analysis_id: analysis.id,
          version: analysis.version,
        }),
      });
      const body = (await response.json()) as { status?: unknown };
      status = typeof body.status === "number" ? body.status : 0;
    } catch {
      status = 0;
    }
    setBusy("");
    out.current = "";
    const message = rereadProblem(status);
    setProblem(message);
    if (message === null || status === 409) {
      startTransition(() => router.refresh());
    }
    return message === null;
  }
  /** "busy" where another call of the list's checks is still on its way: nothing was
   * sent, and the person is told so rather than left with a dialog that closed. */
  async function upgrade(
    requirementId: string,
  ): Promise<"done" | "refused" | "busy"> {
    if (sending.current || out.current !== "") {
      return "busy";
    }
    return (await run(requirementId, "upgrade")) ? "done" : "refused";
  }
  return {
    run,
    upgrade,
    reread,
    busy,
    pending: pending || busy !== "",
    problem,
  };
}

/**
 * A person's tickmark on an attribute of a finished check (docs/evidence-assurance.md,
 * section 10.13): recorded, or reopened, through the same route as a check
 * (/workspace/evidence-assurance, intents "disposition" and "reopen-disposition", which
 * assuranceWrite checks). It answers the server's refusal in one sentence, or null only
 * once the server has confirmed it; the list is then read again in place (no reload).
 * A refusal because something changed under the person (409) reads it again too, and is
 * kept (`refused`) so that the row still says it should the list read again no longer
 * show the attribute (the check is now out of date, or checking). Each act names the
 * disposition the person saw: a recording the one it replaces (`replaces`, null for
 * none), a reopening the one it reopens (`id`).
 */
function useTickmarkAction(ids: Ids) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // A second press while the first is on its way sends nothing.
  const sending = useRef(false);
  const [refused, setRefused] = useState<string | null>(null);
  async function send(fields: Record<string, unknown>): Promise<string | null> {
    if (sending.current) {
      return "The last tickmark is still being recorded. Wait for it, then try again.";
    }
    sending.current = true;
    setRefused(null);
    let status = 0;
    let detail = "";
    try {
      const response = await fetch("/workspace/evidence-assurance", {
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
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
    } catch {
      status = 0;
    }
    sending.current = false;
    const problem = dispositionProblem(status, detail);
    if (problem === null || status === 409) {
      startTransition(() => router.refresh());
    }
    if (status === 409) {
      setRefused(problem);
    }
    return problem;
  }
  return {
    record: (
      requirementId: string,
      attributeId: string,
      fields: Record<string, string>,
      replaces: string | null,
    ) =>
      send({
        intent: "disposition",
        requirement_id: requirementId,
        attribute_id: attributeId,
        ...fields,
        replaces,
      }),
    reopen: (
      requirementId: string,
      attributeId: string,
      id: string,
      reason: string,
    ) =>
      send({
        intent: "reopen-disposition",
        requirement_id: requirementId,
        attribute_id: attributeId,
        id,
        reason,
      }),
    /** The last 409 refusal, until the next act. */
    refused,
    clearRefused: () => setRefused(null),
  };
}

/**
 * A person's decision on a file's reliability (docs/evidence-assurance.md, section 10.14):
 * recorded, or reopened, through the same route as a check (/workspace/evidence-assurance,
 * intents "file-reliability" and "reopen-file-reliability", which assuranceWrite checks).
 * It answers the server's refusal in one sentence, or null only once the server has
 * confirmed it; the list is then read again in place (no reload), and after a refusal
 * because something changed under the person (409) too. Each act names the decision the
 * person saw: a recording the one it replaces (`replaces`, null for none), a reopening the
 * one it reopens (`id`). One for the list: the first screen and "About this file" share it.
 */
function useReliabilityAction(ids: Ids) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  // A second press while the first is on its way sends nothing.
  const sending = useRef(false);
  async function send(fields: Record<string, unknown>): Promise<string | null> {
    if (sending.current) {
      return "The last decision is still being recorded. Wait for it, then try again.";
    }
    sending.current = true;
    let status = 0;
    let detail = "";
    try {
      const response = await fetch("/workspace/evidence-assurance", {
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
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
    } catch {
      status = 0;
    }
    sending.current = false;
    const problem = reliabilityProblem(status, detail);
    if (problem === null || status === 409) {
      startTransition(() => router.refresh());
    }
    return problem;
  }
  return {
    record: (
      requirementId: string,
      fileId: string,
      fields: Record<string, string>,
      replaces: string | null,
    ) =>
      send({
        intent: "file-reliability",
        requirement_id: requirementId,
        file_id: fileId,
        ...fields,
        replaces,
      }),
    reopen: (
      requirementId: string,
      fileId: string,
      id: string,
      reason: string,
    ) =>
      send({
        intent: "reopen-file-reliability",
        requirement_id: requirementId,
        file_id: fileId,
        id,
        reason,
      }),
  };
}
type ReliabilityCalls = ReturnType<typeof useReliabilityAction>;

/** The calls for a decision on a request's file, as the request's check offers them:
 * only to a person who may act, on a finished, current check, for a file in force. */
function reliabilityFor(
  calls: ReliabilityCalls,
  requirementId: string,
  check: RequestCheck,
  canAct: boolean,
): ReliabilityAction | null {
  return canAct
    ? {
        offer: (line) => reliabilityOffer(check, line, canAct),
        record: (fileId, fields, replaces) =>
          calls.record(requirementId, fileId, fields, replaces),
        reopen: (fileId, seen, reason) =>
          calls.reopen(requirementId, fileId, seen, reason),
      }
    : null;
}

/** The annotations of a request's files, as the evidence reviewer reads them (the
 * annotations route): each file's own, or null where none could be read. Read only. */
async function readRequestAnnotations(
  ids: Ids,
  requirementId: string,
  fileIds: readonly string[],
): Promise<AnnotationSet[] | null> {
  const each = await Promise.all(
    fileIds.map(async (fileId) => {
      try {
        const response = await fetch(
          `/workspace/evidence-annotations?${annotationsQuery({
            organizationId: ids.organizationId,
            projectId: ids.projectId,
            controlId: ids.controlId,
            requirementId,
            fileId,
          })}`,
          { cache: "no-store" },
        );
        const body = (await response.json()) as {
          status?: unknown;
          result?: unknown;
        };
        if (body.status === 404 || body.status === 403) {
          // A file with no annotations for this request is not a fault.
          return null;
        }
        return body.status === 200 ? parseAnnotations(body.result) : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  if (each.some((set) => set === undefined)) {
    return null;
  }
  return each.filter(
    (set): set is AnnotationSet => set !== null && set !== undefined,
  );
}

/**
 * While a check works the list is read again in place until the run leaves the queue
 * and the readings: every 5 seconds for the first minute, then every 15, for up to 20
 * minutes (checkPollDelay). After that it stops and says so, rather than read for good.
 */
function CheckPolling() {
  const router = useRouter();
  const [over, setOver] = useState(false);
  useEffect(() => {
    const start = Date.now();
    let timer: number | undefined;
    const next = () => {
      const delay = checkPollDelay(Date.now() - start);
      if (delay === null) {
        setOver(true);
        return;
      }
      timer = window.setTimeout(() => {
        router.refresh();
        next();
      }, delay);
    };
    next();
    return () => window.clearTimeout(timer);
  }, [router]);
  return over ? (
    <p className="ta-run-note" role="status">
      {STILL_CHECKING}
    </p>
  ) : null;
}

/** A drag over a dialog the list renders (the evidence wizard, Review and send) is that
 * dialog's, never a drop on the list. */
function inDialog(event: { target: EventTarget }): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest("dialog, [role='dialog']") !== null
  );
}

/** A row as the pre-release list's dialogs read it (edit, change attributes). */
function asRequest(row: EvidenceRow): RequestsRow {
  return {
    id: row.id,
    version: row.version,
    title: row.title,
    description: row.description,
    shows: "",
    kind: row.kind,
    icon: row.icon,
    line: row.kind,
    origin: "AGENT",
    originLine: "",
    letters: row.letters,
    attributeIds: row.attributeIds,
    addresses: row.addresses,
    state: "ACCEPTED",
    change: null,
    acceptedBy: null,
    acceptedAt: null,
    procedureIds: row.procedureIds,
  };
}

/**
 * The D&I Evidence step once its requests are drafted (product owner, 12 November 2026:
 * "Just simplify this where the user can easily edit the request, add another evidence
 * request, and can easily upload any evidence that was received. Still keep the option to
 * send out the request to the process owners."). The one list of before, continued: who
 * the requests go to and whether they went, then one row per request with the attributes
 * it addresses, where it stands, Upload, and its menu; a row opens to its wording, the
 * evidence that came back, what the agent read in it, and Accept. Sending opens the same
 * review and confirmation as before (ControlSend); nothing shows as sent, uploaded or
 * accepted until the server confirms it. The step's frame carries the status, the one
 * decision line and the agent's line, so none of that is repeated here.
 */
export function DesignEvidence({
  ids,
  view,
  plan,
  canAct,
  files,
  applications,
  system,
  intelligence,
  controlRef,
  activity,
  head,
  library,
  otherFiles,
  documents,
  stepHref,
  focusView,
  about = { title: "", system: "", engagement: "" },
}: {
  ids: Ids;
  view: EvidenceList;
  plan: EvidencePlan;
  /** The person may change the control's plan and judge evidence. The server checks. */
  canAct: boolean;
  files: HeldFile[];
  applications: Array<{ id: string; name: string }>;
  system: string | null;
  intelligence: Intelligence;
  controlRef: string;
  activity: ActivityItem[] | null;
  /** Above the list: the request opened by its address (?request=), and why uploads
   * are held. */
  head: ReactNode;
  /** The control's files no request shows, with their actions. */
  library: ReactNode;
  /** How many files that is. */
  otherFiles: number;
  /** The optional governing documents, folded: their one line and their setup. */
  documents: { line: string; body: ReactNode };
  /** The step's own address: a request opens on it (?request=). */
  stepHref: string;
  /** The view a link names (?ev=): "files" opens the other files. */
  focusView: string | null;
  /** What the evidence wizard's header says of the control: its title, its system and
   * the engagement. */
  about?: { title: string; system: string; engagement: string };
}) {
  const id = useId();
  const router = useRouter();
  const action = usePlanAction(ids);
  const list = useRequestAction(ids);
  const policies = usePolicyEvidence(ids);
  const checks = useAssuranceAction(ids);
  const reliabilityCalls = useReliabilityAction(ids);
  const requirements = new Map(
    plan.phases
      .flatMap((phase) => phase.requirements)
      .map((item) => [item.id, item]),
  );
  // Evidence is added through the D&I evidence wizard (docs/evidence-wizard.md): the
  // header's Upload evidence, a row's Upload, and files dropped on the list open it.
  const wizard = useEvidenceWizard({
    ids,
    items: wizardItems(view.rows, [...requirements.values()]),
    attributes: view.attributes,
    context: {
      controlRef,
      controlTitle: about.title,
      system: about.system,
      engagement: about.engagement,
      requests: view.groups
        .filter((group) => group.rowIds.length > 0)
        .map((group) => ({
          to: group.line.quiet ? "" : group.line.to,
          role: group.line.role,
          due: group.line.due,
        })),
    },
    canAct,
    held: files,
    applications,
    system,
    // After an upload nothing else is offered until the plan is read again.
    onUploaded: () => setSettling(plan),
    analyses: intelligence.register?.analyses ?? [],
  });
  const [over, setOver] = useState(false);
  // The rows the person opened or closed; until then the first that waits on them is open.
  const [chosen, setChosen] = useState<ReadonlySet<string> | null>(null);
  const [dialog, setDialog] = useState<ListDialog | null>(null);
  const [done, setDone] = useState("");
  const [removed, setRemoved] = useState<{
    id: string;
    title: string;
    version: number;
  } | null>(null);
  // Evidence is added in the evidence dialog; a file already added opens in the one
  // viewer (docs/evidence-annotations.md, section 5b), on a file a link names too.
  const [evidence, setEvidence] = useState<DialogOpen | null>(() =>
    intelligence.focusFile == null && intelligence.openAdd === true
      ? { mode: "add", itemId: null }
      : null,
  );
  const [viewing, setViewing] = useState<FileOpen | null>(() =>
    intelligence.focusFile != null
      ? fileOpenFor(plan, intelligence.focusFile)
      : null,
  );
  // What "About this file" is drawn from: the page's own records, nothing read again.
  const aboutContext: AboutContext = {
    ids,
    plan,
    register: intelligence.register,
    mapping: intelligence.mapping,
    attributes: intelligence.attributes,
    controlRef,
    canAct,
    findings: intelligence.findings,
    tests: intelligence.tests ?? null,
    instances: intelligence.instances ?? null,
    // The walkthrough instance's evidence is uploaded where evidence is added.
    onUpload: (itemId) => {
      setViewing(null);
      setEvidence({ mode: "add", itemId });
    },
    // A withdrawal the server confirmed: said on the list, which is read again in place.
    onWithdrawn: (message) => {
      setViewing(null);
      setRemoved(null);
      setDone(message);
    },
    // A file's reliability on its request (section 10.14): what the request's finished
    // check raises, the decision that stands, and the same calls as the first screen.
    reliability: (requirementId, fileId) => {
      const row = view.rows.find((each) => each.id === requirementId);
      const check = row?.assurance?.check ?? null;
      const line =
        check === null || check.standing !== "REVIEWED"
          ? undefined
          : check.reliability.find((each) => each.fileId === fileId);
      if (check === null || line === undefined) {
        return null;
      }
      const held = (requirements.get(requirementId)?.files ?? []).map(
        (file) => ({ id: file.fileId, name: file.name }),
      );
      return {
        line,
        ref: fileRef(held, fileId),
        action: reliabilityFor(reliabilityCalls, requirementId, check, canAct),
      };
    },
  };
  const opened = chosen ?? new Set(view.open !== null ? [view.open] : []);
  const flip = (each: string) => {
    const next = new Set(opened);
    if (next.has(each)) {
      next.delete(each);
    } else {
      next.add(each);
    }
    setChosen(next);
  };
  const wording = new Map(view.attributes.map((item) => [item.id, item]));
  // An upload can move rows to another request (evidence in hand splits a request), so
  // after one nothing else is offered until the plan has been read again: the plan the
  // upload was made on is remembered, and the list is locked while it is still shown.
  const [settling, setSettling] = useState<EvidencePlan | null>(null);
  // The upload reads the plan again itself. Should that reading never arrive, the
  // lock lifts after a while rather than hold the list for good: the server still
  // refuses anything made on a request the row has left.
  useEffect(() => {
    if (settling === null) {
      return;
    }
    const timer = window.setTimeout(() => setSettling(null), 10000);
    return () => window.clearTimeout(timer);
  }, [settling]);
  const locked = action.pending || list.pending || settling === plan;
  // Said wherever the lock holds something back: the upload's own sentence only where an
  // upload is the cause.
  const lockedWhy = settling === plan ? LOCKED : SAVING;
  // The review pane closed because the requests changed under it (evidence in hand
  // split one): the server's sentence is shown here, over the groups as they now are.
  const [changed, setChanged] = useState<string | null>(null);
  useEffect(() => {
    const onChanged = (event: Event) => {
      const said = (event as CustomEvent<unknown>).detail;
      if (typeof said === "string" && said !== "") {
        // Taken: the pane may close, the list shows why.
        event.preventDefault();
        setChanged(said);
      }
    };
    window.addEventListener(REQUESTS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(REQUESTS_CHANGED_EVENT, onChanged);
  }, []);
  const problem = action.problem ?? list.problem ?? checks.problem;
  const events = evidenceActivity(activity);

  async function remove(row: EvidenceRow) {
    setDone("");
    const ok = await list.run(`remove-${row.id}`, "planning", {
      intent: "evidence-remove",
      requirement_id: row.id,
      version: row.version,
    });
    if (ok) {
      setRemoved({ id: row.id, title: row.title, version: row.version + 1 });
    }
  }

  async function restore(item: { id: string; version: number }) {
    setDone("");
    const ok = await list.run(`restore-${item.id}`, "planning", {
      intent: "evidence-restore",
      requirement_id: item.id,
      version: item.version,
    });
    if (ok) {
      setRemoved(null);
      setDone("Request restored.");
    }
  }

  return (
    // Files dropped anywhere on the list open the evidence wizard with them queued;
    // Upload evidence and each row's Upload do the same from the keyboard.
    <section
      className={`dq de${over ? " is-over" : ""}`}
      aria-label="D&I requests"
      aria-busy={locked}
      onDragOver={(event) => {
        if (canAct && !locked && carriesFiles(event) && !inDialog(event)) {
          event.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOver(false);
        }
      }}
      onDrop={(event) => {
        setOver(false);
        if (!canAct || locked || !carriesFiles(event) || inDialog(event)) {
          return;
        }
        event.preventDefault();
        void droppedFiles(event.dataTransfer).then((picked) =>
          wizard.startNew(null, picked),
        );
      }}
    >
      {head}
      <div className="ta-bar de-bar">
        <h4 className="ta-section-title">{view.title}</h4>
        {canAct ? (
          <span className="ta-bar-acts">
            <button
              type="button"
              className="btn btn-ghost btn-sm ta-quiet"
              disabled={locked}
              onClick={() => setDialog({ mode: "add" })}
            >
              <UiIcon name="plus" size={13} />
              Add request
            </button>
            {/* The evidence wizard: the files are sorted into the control's D&I items
                and checked against the attributes. One primary per area: it is
                secondary while requests wait to be sent. */}
            <button
              type="button"
              className={view.send.show ? "btn btn-secondary" : "btn"}
              disabled={locked}
              onClick={wizard.openFromList}
            >
              <UiIcon name="upload" size={14} />
              Upload evidence
            </button>
            {/* Approved and sent here, through the same check, review and confirmation
                as before: shown only while requests wait to be sent. */}
            {view.send.show ? (
              <ControlSend ids={ids} handover={view.send.handover} />
            ) : null}
            {/* A file that fits no request yet is still added here, in the evidence
                dialog, where the agent says which request it serves. */}
            <RowMenu
              label="the D&I evidence"
              items={[
                {
                  label: "Add a file that fits no request",
                  icon: "upload",
                  unavailable: locked ? lockedWhy : null,
                  onSelect: () => setEvidence({ mode: "add", itemId: null }),
                },
                {
                  label: "Open in the Evidence center",
                  icon: "inbox",
                  href: centerHref(ids, DEFAULT_QUERY, { q: controlRef }),
                },
              ]}
            />
          </span>
        ) : null}
      </div>
      <p className="ta-done" role="status">
        {done !== "" && problem === null ? (
          <>
            <UiIcon name="check" size={14} />
            {done}
          </>
        ) : null}
      </p>
      {removed !== null ? (
        <p className="pe-removed" role="status">
          <span>“{removed.title}” was deleted. It stays in the history.</span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            disabled={locked}
            onClick={() => void restore(removed)}
          >
            {list.busy === `restore-${removed.id}` ? "Restoring…" : "Undo"}
          </button>
        </p>
      ) : null}
      {action.note ? <p className="cc-note">{action.note}</p> : null}
      <Problem text={problem ?? changed} />
      {/* While a request's evidence is checked against the attributes, the list is read
          again with a backoff, until every check has left the queue and the readings. */}
      {view.rows.some((row) => row.assurance?.working === true) ? (
        <CheckPolling />
      ) : null}

      {view.groups.length === 0 ? <WizardProgress wizard={wizard} /> : null}
      {view.groups.map((group, at) => {
        const reviewHref =
          group.line.requestId === null
            ? null
            : evidenceHref(stepHref, {
                view: "requests",
                request: group.line.requestId,
              });
        return (
          <div className="de-card" key={group.key}>
            <div
              className={`de-delivery${group.line.quiet ? " is-quiet" : ""}`}
            >
              <UiIcon name={group.line.quiet ? "file" : "mail"} size={14} />
              {group.line.quiet ? (
                <span className="de-delivery-to">{group.line.status}</span>
              ) : (
                <>
                  <span className="de-delivery-to">
                    To <strong>{group.line.to}</strong>
                    {group.line.role !== "" ? ` · ${group.line.role}` : ""}
                    {group.line.due !== "" ? ` · ${group.line.due}` : ""}
                  </span>
                  <span
                    className={`de-delivery-status tone-${group.line.tone}`}
                  >
                    {group.line.status}
                  </span>
                </>
              )}
              {canAct && group.line.canChange && reviewHref !== null ? (
                <Link
                  className="de-change"
                  href={reviewHref}
                  scroll={false}
                  aria-label="Change the recipient and the due date"
                >
                  Change
                </Link>
              ) : null}
              {/* Approved and nothing went out, or the send failed: the request itself
                  holds the send the server allows, so the line opens it. */}
              {canAct && group.line.action !== null && reviewHref !== null ? (
                <Link
                  className="btn btn-secondary btn-sm"
                  href={reviewHref}
                  scroll={false}
                >
                  {group.line.action}
                </Link>
              ) : null}
              <RowMenu
                label={group.line.quiet ? "these requests" : "this request"}
                items={[
                  // Named for what it is: never "the email" for a draft or a hand-over.
                  ...(group.line.preview === "" || reviewHref === null
                    ? []
                    : [
                        {
                          label: group.line.preview,
                          icon: "eye" as const,
                          onSelect: () =>
                            router.push(reviewHref, { scroll: false }),
                        },
                      ]),
                  {
                    label: "Open in the Evidence center",
                    icon: "inbox" as const,
                    href: centerHref(ids, DEFAULT_QUERY, { q: controlRef }),
                  },
                ]}
              />
            </div>
            {/* The evidence wizard's session while its window is closed: where it
                stands, and the way back into it. */}
            {at === 0 ? <WizardProgress wizard={wizard} /> : null}
            {group.rowIds.length === 0 ? (
              // A request no row travels in (a follow-up, a samples request): its line
              // above says where it stands; this says what it is.
              <p className="de-lone">{group.label}</p>
            ) : (
              <ul
                className="tar-list"
                aria-label={
                  view.groups.length === 1
                    ? "D&I requests"
                    : `D&I requests: ${group.line.quiet ? group.line.status : `to ${group.line.to}, ${group.line.status}`}`
                }
              >
                {group.rowIds.map((rowId) => {
                  const row = view.rows.find((each) => each.id === rowId);
                  if (row === undefined) {
                    return null;
                  }
                  const item = requirements.get(row.id);
                  return item === undefined ? null : (
                    <Row
                      key={row.id}
                      ids={ids}
                      row={row}
                      item={item}
                      open={opened.has(row.id)}
                      onToggle={() => flip(row.id)}
                      canAct={canAct}
                      action={action}
                      locked={locked}
                      lockedWhy={lockedWhy}
                      onUpload={(picked) => wizard.startNew(row.id, picked)}
                      files={files}
                      applications={applications}
                      policies={policies.evidence}
                      onPolicyDecided={policies.reload}
                      wording={wording}
                      attributeCount={view.attributes.length}
                      onView={setViewing}
                      findings={intelligence.findings ?? null}
                      analyses={intelligence.register?.analyses ?? []}
                      controlRef={controlRef}
                      checks={checks}
                      reliabilityCalls={reliabilityCalls}
                      onCoverage={() =>
                        document
                          .getElementById(`${id}-coverage`)
                          ?.scrollIntoView({ block: "center" })
                      }
                      onEdit={() =>
                        setDialog({ mode: "edit", row: asRequest(row) })
                      }
                      onAttributes={() =>
                        setDialog({ mode: "attributes", row: asRequest(row) })
                      }
                      onRemove={() => void remove(row)}
                      onDone={(note) => {
                        setRemoved(null);
                        setDone(note);
                      }}
                    />
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
      {view.rows.length === 0 ? (
        <p className="dr-empty">
          No D&amp;I request is on the list. Add one, then choose the attributes
          it addresses.
        </p>
      ) : null}

      {/* While the agent reads a file the list is read again, in place, so the row
          moves from Reading… to To review by itself; it stops when the reading ends. */}
      {view.rows.some((row) => row.reading > 0) ? <AutoRefresh /> : null}

      {view.coverage.length > 0 ? (
        <section className="dq-coverage" aria-labelledby={`${id}-coverage`}>
          <div className="dq-cov-head">
            <h4 className="ta-section-title" id={`${id}-coverage`}>
              Coverage
            </h4>
            <span className="dq-cov-line">{view.coverageLine}</span>
          </div>
          <ul className="dq-cov-chips">
            {view.coverage.map((chip) => (
              <li
                key={chip.attributeId}
                className={`dq-cov ${
                  chip.state === "EVIDENCED"
                    ? "is-covered"
                    : chip.state === "REQUESTED" ||
                        chip.state === "DESIGN_ONLY" ||
                        chip.state === "PARTLY"
                      ? "is-requested"
                      : chip.state === "TICKMARK"
                        ? chip.tickmark === "EXCEPTION"
                          ? "is-flagged"
                          : "is-tickmark"
                        : chip.state === "EXCEPTED"
                          ? "is-exception"
                          : "is-uncovered"
                }`}
                title={`${chip.label}. ${chip.text}${chip.reason !== "" ? ` Reason: ${chip.reason}` : ""}`}
              >
                <span className="sr-only">{chip.label}</span>
                <span className="dq-cov-letter" aria-hidden="true">
                  {chip.letter}
                </span>
                {chip.state === "EVIDENCED" ? (
                  <span className="dq-cov-state" aria-hidden="true">
                    <UiIcon name="check" size={12} />
                    {/* Combined from several requests: said, never a plain check. */}
                    {chip.across >= 2
                      ? ` Shown across ${chip.across} requests`
                      : null}
                  </span>
                ) : chip.state === "REQUESTED" ? null : chip.state ===
                  "DESIGN_ONLY" ? (
                  <span className="dq-cov-state" aria-hidden="true">
                    Design documented
                  </span>
                ) : chip.state === "PARTLY" ? (
                  <span className="dq-cov-state" aria-hidden="true">
                    Shown in part
                  </span>
                ) : chip.tickmark !== null ? (
                  // A person's tickmark, in its own words: never the check mark.
                  <span className="dq-cov-state" aria-hidden="true">
                    {COVERAGE_TICKMARKS[chip.tickmark].chip}
                  </span>
                ) : (
                  <span className="dq-cov-state" aria-hidden="true">
                    {chip.state === "EXCEPTED"
                      ? "Reason recorded"
                      : "Not addressed"}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {/* Which elements are still not shown from an instance's records, by their
              text, for an attribute an accepted request does not fully evidence. */}
          {view.coverage.some((chip) => chip.missing.length > 0) ? (
            <ul className="dq-cov-missing">
              {view.coverage
                .filter((chip) => chip.missing.length > 0)
                .map((chip) => (
                  <li key={chip.attributeId}>
                    <span className="dr-code">{chip.letter}</span>
                    <span>
                      <span className="dq-cov-missing-lead">
                        Still not shown:
                      </span>{" "}
                      {chip.missing.join("; ")}
                    </span>
                  </li>
                ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <div className="dr-more">
        {/* The reason behind a "Reason recorded" chip, readable on request. */}
        {view.exceptions.length > 0 ? (
          <details className="dr-fold">
            <summary>
              <span>
                <strong>Not evidenced at D&amp;I</strong>
                <small>
                  {view.exceptions.length} attribute
                  {view.exceptions.length === 1 ? "" : "s"}, with the reason
                  recorded
                </small>
              </span>
              <UiIcon name="chevron" size={13} />
            </summary>
            <ul className="dq-reasons">
              {view.exceptions.map((item) => (
                <li key={item.attributeId}>
                  <span className="dr-code">{item.letter}</span>
                  <span className="dq-reason-text">
                    <span>{item.text}</span>
                    <q>{item.reason}</q>
                    <small>
                      {[
                        item.recordedBy,
                        item.recordedAt !== null
                          ? formatDate(item.recordedAt)
                          : "",
                      ]
                        .filter((part) => part !== "")
                        .join(" · ")}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {view.attributes.length > 0 ? (
          <details className="dr-fold">
            <summary>
              <span>
                <strong>
                  Tested against {view.attributes.length} attribute
                  {view.attributes.length === 1 ? "" : "s"}
                </strong>
                {view.sources !== "" ? (
                  <small>From {view.sources}</small>
                ) : null}
              </span>
              <UiIcon name="chevron" size={13} />
            </summary>
            <ol className="dr-attrs">
              {view.attributes.map((item) => (
                <li key={item.id}>
                  <span className="dr-code">{item.letter}</span>
                  <span className="dr-attr-text">{item.text}</span>
                  <small>{item.source}</small>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
        <details className="dr-fold">
          <summary>
            <span>
              <strong>Governing documents</strong>
              <small>{documents.line}</small>
            </span>
            <UiIcon name="chevron" size={13} />
          </summary>
          <div className="dr-fold-body">{documents.body}</div>
        </details>
        {/* Files of the control that no request shows (a file that arrived by email
            and is not filed yet, say): kept reachable, and only when there are any. */}
        {otherFiles > 0 || focusView === "files" ? (
          <details
            className="dr-fold"
            id="ev-files"
            open={focusView === "files" || undefined}
          >
            <summary>
              <span>
                <strong>Other files</strong>
                <small>
                  {otherFiles === 0 ? "None" : `${otherFiles} not on a request`}
                </small>
              </span>
              <UiIcon name="chevron" size={13} />
            </summary>
            <div className="dr-fold-body">{library}</div>
          </details>
        ) : null}
        {view.history.length > 0 ? (
          <details className="dr-fold">
            <summary>
              <span>
                <strong>History</strong>
                <small>
                  {view.history.length} deleted request
                  {view.history.length === 1 ? "" : "s"}
                </small>
              </span>
              <UiIcon name="chevron" size={13} />
            </summary>
            <ul className="dq-history">
              {view.history.map((item) => (
                <li key={item.id}>
                  <span className="dq-history-text">
                    <span>{item.title}</span>
                    <small>{item.kind} · Deleted</small>
                  </span>
                  {canAct ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={locked}
                      aria-label={`Restore ${item.title}`}
                      onClick={() => void restore(item)}
                    >
                      {list.busy === `restore-${item.id}`
                        ? "Restoring…"
                        : "Restore"}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <details className="dr-fold">
          <summary>
            <span>
              <strong>Activity</strong>
              <small>{view.activityLine}</small>
            </span>
            <UiIcon name="chevron" size={13} />
          </summary>
          <div className="dr-fold-body">
            {events.length === 0 ? (
              <p className="dr-empty">No activity on these requests yet.</p>
            ) : (
              <ol className="er-activity">
                {events.map((event) => (
                  <li key={event.id}>
                    <LocalTime at={event.at} />
                    <div>
                      <strong>{event.title}</strong>
                      <p className="er-sub">
                        {event.actor}
                        {event.detail ? ` · ${event.detail}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </details>
      </div>

      {dialog === null ? null : dialog.mode === "attributes" ? (
        <AttributesDialog
          key={dialog.row.id}
          ids={ids}
          row={dialog.row}
          attributes={view.attributes}
          onClose={() => setDialog(null)}
          onDone={(note) => {
            setDialog(null);
            setDone(note);
          }}
        />
      ) : (
        <RequestDialog
          key={dialog.mode === "add" ? "add" : dialog.row.id}
          ids={ids}
          row={dialog.mode === "edit" ? dialog.row : null}
          attributes={view.attributes}
          preset={[]}
          onClose={() => setDialog(null)}
          onDone={(note) => {
            setDialog(null);
            setRemoved(null);
            setDone(note);
          }}
        />
      )}
      {viewing !== null ? (
        <FileViewer
          key={`${viewing.fileId}-${viewing.tab ?? ""}-${viewing.annotationId ?? ""}`}
          open={viewing}
          context={aboutContext}
          onClose={() => {
            // What opened it carries on (a tickmark's form reads its annotations again).
            const after = viewing.onClosed;
            setViewing(null);
            after?.();
          }}
        />
      ) : null}
      {evidence !== null ? (
        <EvidenceDialog
          key={`add-${evidence.itemId ?? ""}`}
          open={evidence}
          onClose={() => setEvidence(null)}
          ids={ids}
          plan={plan}
          register={intelligence.register}
          mapping={intelligence.mapping}
          attributes={intelligence.attributes}
          controlRef={controlRef}
          canAct={canAct}
          findings={intelligence.findings}
          tests={intelligence.tests ?? null}
          instances={intelligence.instances ?? null}
        />
      ) : null}
      <EvidenceWizard wizard={wizard} />
    </section>
  );
}

/** One request: its line, its Upload and its menu; open, its wording and its evidence. */
function Row({
  ids,
  row,
  item,
  open,
  onToggle,
  canAct,
  action,
  locked,
  lockedWhy,
  onUpload,
  files,
  applications,
  policies,
  onPolicyDecided,
  wording,
  attributeCount,
  onView,
  findings,
  analyses,
  controlRef,
  checks,
  reliabilityCalls,
  onCoverage,
  onEdit,
  onAttributes,
  onRemove,
  onDone,
}: {
  ids: Ids;
  row: EvidenceRow;
  item: PlanRequirement;
  open: boolean;
  onToggle: () => void;
  canAct: boolean;
  action: Action;
  locked: boolean;
  /** Why it is locked, in words: the upload's, or a write being saved. */
  lockedWhy: string;
  /** Opens the evidence wizard on this request (the person's choice stands; the agent
   * only suggests a better fit), with files dropped on the row queued. */
  onUpload: (picked?: Picked[]) => void;
  files: HeldFile[];
  applications: Array<{ id: string; name: string }>;
  policies: PolicyEvidence;
  onPolicyDecided: () => void;
  wording: ReadonlyMap<string, { letter: string; text: string }>;
  attributeCount: number;
  /** Opens a file of the request in the one viewer (section 5b). */
  onView: (open: FileOpen) => void;
  /** The control's evidence findings: an issue the check found is one of them. */
  findings: EvidenceFinding[] | null;
  /** The control's readings of its files: a failed one is read again by its id. */
  analyses: ReadonlyArray<{ id: string; fileId: string; version: number }>;
  controlRef: string;
  /** "Check again" on a file of the row. */
  checks: ReturnType<typeof useAssuranceAction>;
  /** A person's decision on a file's reliability (section 10.14): the list's calls. */
  reliabilityCalls: ReliabilityCalls;
  /** Shows which attributes the requests cover (the coverage under the list). */
  onCoverage: () => void;
  onEdit: () => void;
  onAttributes: () => void;
  onRemove: () => void;
  /** Called once the server has confirmed, with what to say on the list. */
  onDone: (note: string) => void;
}) {
  const id = useId();
  const bodyId = `${id}-body`;
  // Files are dragged over the row: it shows it takes them.
  const [over, setOver] = useState(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  // "Check again with the current engine", asked once more before it runs: where it was
  // chosen from, so focus can come back to it.
  const [upgrading, setUpgrading] = useState<"action" | "menu" | null>(null);
  const rowRef = useRef<HTMLLIElement>(null);
  const [words, setWords] = useState("");
  const [picker, setPicker] = useState<"policy" | "held" | null>(null);
  const [fileForm, setFileForm] = useState<{
    fileId: string;
    form: FileForm;
  } | null>(null);
  // A change to one of its files, confirmed by the server.
  const [fileDone, setFileDone] = useState<string | null>(null);
  /** A file of the request, in the one viewer (section 5b; product owner, 14 November
   * 2026: "I still see the old reviewer when opening the file"): full size, the
   * request's other files in its switcher, on a D&I request with its annotations and
   * their review, on the annotation asked for where one is, and "About this file". */
  const openFile = (
    fileId: string,
    annotation?: AnnotationAsk,
    more: Omit<FileOpen, "fileId" | "files"> = {},
  ) =>
    onView({
      fileId,
      files: filesOf(item),
      ...(item.phase === "DESIGN"
        ? {
            requirementId: item.id,
            ...(annotation === undefined ? {} : { annotation }),
          }
        : {}),
      ...more,
    });
  // The assurance chain's check of the request, and the findings its issues are.
  const assured = row.assurance;
  const findingsAction = useFindingsAction(ids);
  const tickmarks = useTickmarkAction(ids);
  // "Use a file the control holds", chosen from an attribute's "Add evidence": the
  // picker opens under the check and takes the focus.
  const heldRef = useRef<HTMLDivElement>(null);
  const [heldAsked, setHeldAsked] = useState(false);
  useEffect(() => {
    if (picker === "held" && heldAsked) {
      const box = heldRef.current;
      box?.scrollIntoView({ block: "nearest" });
      box?.querySelector<HTMLElement>("select, input, button")?.focus();
      setHeldAsked(false);
    }
  }, [picker, heldAsked]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  // A finished check is the row's first screen (section 10.12): the request's wording
  // and its files open on request.
  const reviewed =
    assured !== null &&
    row.reading === 0 &&
    assured.check.standing === "REVIEWED";
  // Null until the person opens or closes them: until then they are open only while a
  // file has something to settle.
  const [filesOpen, setFilesOpen] = useState<boolean | null>(null);
  // The sample trace, revealed under what needs attention by its item.
  const [traceShown, setTraceShown] = useState(false);
  const issueIds = new Set(
    (assured?.check.attributes ?? []).flatMap((line) =>
      line.findingId === null ? [] : [line.findingId],
    ),
  );
  const toSend = (findings ?? []).filter(
    (finding) =>
      issueIds.has(finding.id) &&
      picked.has(finding.id) &&
      SENDABLE_STATUSES.includes(finding.status),
  );
  const held = linkableFiles(item, files);
  const documents = choosable(policies, item.id);
  const onFile = proposalsFor(policies, item.id);
  const uploads = canAct && row.uploadBlocked === null;
  // A design item that walks one instance through: its files are read together.
  const traced = open && item.files.length > 0 && tracesSample(item);
  const [trace, setTrace, traceFailed] = useSampleTrace(
    action.ids,
    item.id,
    traced,
    item.files
      .map(
        (file) =>
          `${file.fileId}:${file.readStatus === "PENDING" || file.readStatus === "WORKING" ? 1 : 0}`,
      )
      .join(","),
  );
  const ask = (next: Asking, prefill = "") => {
    setAsking(next);
    setWords(prefill);
    setPicker(null);
    if (!open) {
      onToggle();
    }
  };
  const followUp = () =>
    ask(
      { kind: "FOLLOW_UP_REQUIRED" },
      // The reader's own follow-up points start the text only where the chain has not
      // checked the row: they were never checked by a second reading.
      !row.readerShown
        ? ""
        : item.assessment.followUps.join("; ").slice(0, 1000),
    );

  /** "Ask owner for N items" on a finished check: the row's own follow-up form (`ask`),
   * started with the ticked requests. A form already open with words keeps them: the
   * requests are added after a blank line where they are not there yet and fit, and
   * the focus goes to the form either way. */
  const askOwner = (text: string) => {
    const typed = asking !== null ? words.trim() : "";
    if (asking === null || typed === "") {
      ask({ kind: "FOLLOW_UP_REQUIRED" }, text);
    } else if (
      asking.kind === "FOLLOW_UP_REQUIRED" &&
      !typed.includes(text) &&
      typed.length + 2 + text.length <= ASK_WORDS.FOLLOW_UP_REQUIRED.max
    ) {
      ask({ kind: "FOLLOW_UP_REQUIRED" }, `${typed}\n\n${text}`);
    }
    window.requestAnimationFrame(() => {
      const field =
        rowRef.current?.querySelector<HTMLTextAreaElement>(".de-ask textarea");
      field?.focus();
      field?.scrollIntoView({ block: "nearest" });
    });
  };

  async function checkAgain() {
    if (await checks.run(item.id)) {
      onDone("The check was started again.");
    }
  }

  /** The request's check made again by the current engine, once the person has
   * confirmed. The dialog stays open, its buttons off, until the server has answered,
   * so one click sends one request; then it closes. Success is said on the list once
   * the server confirmed, and a refusal is said there too (assuranceProblem), as for
   * "Check again". Where another check call was still on its way nothing is sent, and
   * the dialog stays open and says so. */
  async function upgradeCheck(): Promise<"done" | "refused" | "busy"> {
    const result = await checks.upgrade(item.id);
    if (result === "done") {
      onDone(UPGRADE_DONE);
    }
    return result;
  }

  /** The one action that clears a hold, or runs the check again. */
  const actOn = (act: CheckAction) => {
    if (act.kind === "RERUN") {
      void checkAgain();
    } else if (act.kind === "UPGRADE") {
      setUpgrading("action");
    } else if (act.fileId === null) {
      return;
    } else if (act.kind === "REREAD") {
      const analysis = analysisOf(act.fileId);
      if (analysis !== null) {
        void checks.reread(act.fileId, analysis).then((ok) => {
          if (ok) {
            onDone("The file is being read again.");
          }
        });
      }
    } else if (act.kind === "REPLACE") {
      setFileForm({ fileId: act.fileId, form: "replace" });
      setFileDone(null);
      // The file's own form is in the files list.
      setFilesOpen(true);
    } else {
      // The file's type is confirmed, and a walkthrough instance picked, under the
      // viewer's "About this file", which it opens on.
      openFile(act.fileId, undefined, {
        tab: "about",
        ...(act.kind === "PICK_INSTANCE" ? { pick: true } : {}),
      });
    }
  };
  const analysisOf = (fileId: string) =>
    analyses.find((each) => each.fileId === fileId) ?? null;
  const rowFiles: RowFile[] = item.files.map((file) => ({
    id: file.fileId,
    name: file.name,
  }));
  /** An action as this person is offered it. */
  const offer = (act: CheckAction | null) =>
    offeredAction(act, {
      canAct,
      replaceable: (fileId) => {
        const held = files.find((each) => each.id === fileId);
        return held !== undefined && (held.blocked ?? null) === null;
      },
      rereadable: (fileId) => analysisOf(fileId) !== null,
    });

  async function accept() {
    const ok = await action.run(`judge-${item.id}`, {
      intent: "sufficiency",
      requirement_id: item.id,
      sufficiency: "ACCEPTED",
      version: item.version,
    });
    if (ok) {
      onDone("Evidence accepted.");
    }
    return ok;
  }

  async function restore() {
    const ok = await action.run(`restore-${item.id}`, {
      intent: "restore",
      requirement_id: item.id,
      version: item.version,
    });
    if (ok) {
      onDone("Request restored.");
    }
  }

  async function submitAsk() {
    if (asking === null) {
      return;
    }
    const ok =
      asking.kind === "WAIVE"
        ? await action.run(`waive-${item.id}`, {
            intent: "waive",
            requirement_id: item.id,
            reason: words,
            version: item.version,
          })
        : asking.kind === "UNLINK"
          ? await action.run(`unlink-${item.id}`, {
              intent: "unlink",
              requirement_id: item.id,
              link_id: asking.file.linkId,
              reason: words,
              version: asking.file.linkVersion,
            })
          : await action.run(`judge-${item.id}`, {
              intent: "sufficiency",
              requirement_id: item.id,
              sufficiency: asking.kind,
              note: words,
              version: item.version,
            });
    if (ok) {
      onDone(
        asking.kind === "WAIVE"
          ? "Marked not applicable."
          : asking.kind === "UNLINK"
            ? "File unlinked."
            : asking.kind === "NOT_REVIEWED"
              ? "Decision reopened."
              : asking.kind === "INSUFFICIENT"
                ? "Marked insufficient."
                : "Follow-up recorded.",
      );
      setAsking(null);
      setWords("");
    }
  }

  const menuEntries = rowMenu(row, {
    policies: documents.length,
    held: held.length,
    attributes: attributeCount,
  });
  /** Why "Ask a follow-up" cannot be used on this row now, in its menu's own words;
   * null when it can. */
  const followUpOff = locked
    ? lockedWhy
    : (menuEntries.find((each) => each.key === "follow-up")?.unavailable ??
      null);
  const menuFor = (): RowMenuItem[] => {
    const run: Record<MenuKey, () => void> = {
      edit: onEdit,
      attributes: onAttributes,
      // The evidence wizard, opened on this request.
      upload: () => onUpload(),
      policy: () => {
        setPicker("policy");
        if (!open) {
          onToggle();
        }
      },
      held: () => {
        setPicker("held");
        if (!open) {
          onToggle();
        }
      },
      upgrade: () => setUpgrading("menu"),
      "follow-up": followUp,
      insufficient: () => ask({ kind: "INSUFFICIENT" }),
      waive: () => ask({ kind: "WAIVE" }),
      restore: () => void restore(),
      reopen: () => ask({ kind: "NOT_REVIEWED" }),
      delete: onRemove,
    };
    return (
      menuEntries
        // Nor a check again while another check call of the list is on its way.
        .map((entry) =>
          entry.key === "upgrade" && checks.pending
            ? { ...entry, unavailable: UPGRADE_WAIT }
            : entry,
        )
        .map((entry) => ({
          label: entry.label,
          icon: MENU_ICONS[entry.key],
          // After an upload nothing is offered until the plan is read again.
          unavailable: locked ? lockedWhy : entry.unavailable,
          ...(entry.danger === true ? { danger: true } : {}),
          onSelect: run[entry.key],
        }))
    );
  };

  const lines = new Map(
    item.files.map((file) => [
      file.fileId,
      fileLine(
        ids,
        file,
        files.find((each) => each.id === file.fileId),
        canAct,
        applications,
        fileForm?.fileId === file.fileId ? fileForm.form : null,
        (form, note) => {
          setFileForm(form === null ? null : { fileId: file.fileId, form });
          setFileDone(note ?? null);
        },
      ),
    ]),
  );
  const guide = wordingOf(item.description);
  const hasGuide =
    guide !== null || item.objective !== "" || item.rationale !== "";

  // The row's parts, said once: a finished check arranges them as its first screen
  // (section 10.12), and every other row as the list always has.
  const meta = (
    <span className="dq-meta">
      <span className="dq-letters">
        <span className="sr-only">{`, ${row.addresses}, `}</span>
        {row.letters.length > 0 ? (
          row.attributeIds.map((attributeId) => {
            const attribute = wording.get(attributeId);
            return (
              <span
                key={attributeId}
                className="dr-code"
                aria-hidden="true"
                title={
                  attribute !== undefined
                    ? `Addresses attribute ${attribute.letter}: ${attribute.text}`
                    : undefined
                }
              >
                {attribute?.letter ?? ""}
              </span>
            );
          })
        ) : (
          <span className="dq-none" aria-hidden="true">
            No attribute
          </span>
        )}
      </span>
      <span className={`tar-chip tone-${row.chip.tone}`}>{row.chip.label}</span>
    </span>
  );
  /** The request's wording, the attributes it addresses in full, and its format and
   * period: the rows of the open request, and of "All details" on a finished check. */
  const request = (
    <>
      <div>
        <dt>Request</dt>
        <dd>
          {guide !== null ? `${guide.lead}.` : item.description || "Not stated"}
          <span className="de-request-acts">
            {hasGuide ? (
              <details className="de-must">
                <summary>
                  What it must show
                  <UiIcon name="chevron" size={12} />
                </summary>
                <div className="er-guide de-guide">
                  {guide !== null ? (
                    <>
                      <ul>
                        {guide.include.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                      {guide.completeness ? (
                        <p>
                          <b>Complete when</b> {guide.completeness}
                        </p>
                      ) : null}
                      {guide.notSufficient ? (
                        <p>
                          <b>Not sufficient</b> {guide.notSufficient}
                        </p>
                      ) : null}
                      {guide.alternatives.length > 0 ? (
                        <p>
                          <b>If not available</b>{" "}
                          {guide.alternatives.join("; ")}
                        </p>
                      ) : null}
                    </>
                  ) : item.objective !== "" ? (
                    <p>{item.objective}</p>
                  ) : null}
                  {item.sampleSelection ? (
                    <p>
                      <b>Samples</b> {item.sampleSelection}
                    </p>
                  ) : null}
                  {item.rationale !== "" ? (
                    <p className="er-sub">
                      <b>Why</b> {item.rationale}
                    </p>
                  ) : null}
                </div>
              </details>
            ) : null}
            {canAct && !row.sent && row.change === null ? (
              <button
                type="button"
                className="de-link"
                disabled={locked}
                onClick={onEdit}
              >
                Edit
              </button>
            ) : null}
          </span>
        </dd>
      </div>
      <div>
        <dt>Addresses</dt>
        <dd>
          {row.attributeIds.length === 0 ? (
            "No attribute yet"
          ) : (
            <ul className="dq-addressed">
              {row.attributeIds.map((attributeId) => {
                const attribute = wording.get(attributeId);
                return attribute === undefined ? null : (
                  <li key={attributeId}>
                    <span className="dr-code">{attribute.letter}</span>
                    <span>{attribute.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </dd>
      </div>
      <div>
        <dt>Format · period</dt>
        <dd>
          {[formatOf(row.categories), row.period]
            .filter((part) => part !== "")
            .join(" · ")}
        </dd>
      </div>
    </>
  );
  /** The request's files, each with its own menu. */
  const fileList = (
    <>
      {fileDone !== null ? (
        <p className="ep-done" role="status">
          <UiIcon name="check" size={14} />
          <span>{fileDone}</span>
        </p>
      ) : null}
      {item.files.length === 0 ? (
        <p className="de-none">
          {row.state === "NO_FILE"
            ? "Its request is marked received, but no file serves this request. Upload the file, or use one the control already holds."
            : row.uploadBlocked === null
              ? "No file yet. Upload what you receive, or drop it on the row."
              : "No file yet."}
        </p>
      ) : (
        <ul className="de-files">
          {item.files.map((file) => {
            const line = lines.get(file.fileId);
            const reading =
              file.readStatus === "PENDING" || file.readStatus === "WORKING";
            const meta = fileMeta(
              files.find((each) => each.id === file.fileId),
              file,
            );
            const fileMenu: RowMenuItem[] = [
              // The file with the basis the agent proposed for it, to
              // review (docs/evidence-annotations.md): a file on a D&I
              // request only.
              ...(item.phase === "DESIGN"
                ? [
                    {
                      label: "Annotations",
                      onSelect: () => openFile(file.fileId),
                    },
                  ]
                : []),
              ...(line?.actions ?? []),
              ...(canAct && file.via === "LINK" && file.linkId !== null
                ? [
                    {
                      label: "Unlink from this request",
                      onSelect: () => ask({ kind: "UNLINK", file }),
                    },
                  ]
                : []),
            ];
            return (
              <li
                key={file.fileId}
                className={`de-file${reading ? " is-reading" : ""}`}
              >
                <div className="de-file-main">
                  <UiIcon name="file" size={15} />
                  <span className="de-file-text">
                    <button
                      type="button"
                      className="ep-file-name ep-file-open"
                      // The file in the one viewer, full size, on the request it
                      // is opened from (its annotations on a D&I request).
                      onClick={() => openFile(file.fileId)}
                    >
                      {file.name}
                    </button>
                    {meta !== "" ? <small>{meta}</small> : null}
                    {reading ? (
                      <small className="ep-reading" role="status">
                        Reading
                        <span className="ep-dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      </small>
                    ) : file.readStatus === "FAILED" ? (
                      <small>Could not be read</small>
                    ) : null}
                    {line?.flag ?? null}
                  </span>
                  {fileMenu.length > 0 ? (
                    <RowMenu label={file.name} items={fileMenu} />
                  ) : null}
                </div>
                {line?.form ?? null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
  // What of the row waits on the person beside the check, for its first screen.
  const tracePending =
    traced &&
    !traceFailed &&
    trace !== null &&
    (trace.status === "PROPOSED" || trace.status === "CHOOSE");
  // A file whose application a person has still to set, from the fact itself (fileLine's
  // own rule): its flag is not drawn while its form is open, but nothing is saved yet.
  const flagged = item.files.filter(
    (file) =>
      canAct &&
      files.find((each) => each.id === file.fileId)?.applicationUnknown ===
        true &&
      applications.length > 1,
  );
  // A file the check left out is said there; it is not counted again here.
  const leftOutIds = new Set(
    (assured?.check.leftOut ?? []).map((each) => each.fileId),
  );
  const unread = item.files.filter(
    (file) => file.readStatus === "FAILED" && !leftOutIds.has(file.fileId),
  );
  const beingRead = item.files.filter(
    (file) => file.readStatus === "PENDING" || file.readStatus === "WORKING",
  );
  const extras: DigestExtra[] = !reviewed
    ? []
    : [
        // The sample to confirm or pick: its item reveals the trace under the list.
        ...(tracePending && trace !== null
          ? [
              {
                key: EXTRA_TRACE,
                mark: "",
                headline:
                  trace.status === "CHOOSE"
                    ? TRACE_WORDS.CHOOSE
                    : TRACE_WORDS.PROPOSED,
                context: [
                  traceHeading(trace),
                  trace.observations.length > 0
                    ? `${trace.observations.length} point${trace.observations.length === 1 ? "" : "s"} to settle`
                    : "",
                ]
                  .filter((part) => part !== "")
                  .join(" · "),
                label: TRACE_WORDS.view,
                caveat: false,
              },
            ]
          : []),
        // What a trace that asks nothing still says: on the quiet line, never calm.
        ...(traced && traceFailed
          ? [
              {
                key: "TRACE:FAILED",
                mark: "",
                headline: TRACE_WORDS.failed,
                context: "",
                label: "",
                caveat: true,
              },
            ]
          : traced && trace !== null && trace.status === "CONFIRMED"
            ? tracePoints(trace)
            : []),
        // A file whose application a person has still to set: its item shows the file.
        // Where the check already has an item for the file, the two are one (the model
        // merges them by the file).
        ...flagged.map((file) => ({
          key: `${EXTRA_FILE}${file.fileId}`,
          mark: fileRef(rowFiles, file.fileId),
          headline: FILE_WORDS.application,
          context: FILE_WORDS.applicationOf(file.name),
          label: FILE_WORDS.view,
          caveat: false,
          fileId: file.fileId,
        })),
        // What is only to be known of the files, on the quiet line.
        ...(unread.length > 0
          ? [
              {
                key: "FILES:UNREAD",
                mark: "",
                headline: FILE_WORDS.unread(unread.length),
                context: unread.map((file) => file.name).join(", "),
                label: "",
                caveat: true,
              },
            ]
          : []),
        ...(beingRead.length > 0
          ? [
              {
                key: "FILES:READING",
                mark: "",
                headline: FILE_WORDS.reading(beingRead.length),
                context: beingRead.map((file) => file.name).join(", "),
                label: "",
                caveat: true,
              },
            ]
          : []),
      ];
  // The files are listed without being asked for only while one has something to
  // settle or could not be read, and always while a form is open in the list.
  const filesShown =
    fileForm !== null ||
    (filesOpen ??
      (flagged.length > 0 || unread.length > 0 || beingRead.length > 0));
  /** An item's "Review the sample" or "Show the file": what it is about is put in view,
   * in place, with the focus on it. */
  const viewExtra = (key: string) => {
    const fileAt = key.startsWith(EXTRA_FILE)
      ? item.files.findIndex(
          (file) => file.fileId === key.slice(EXTRA_FILE.length),
        )
      : -1;
    if (key === EXTRA_TRACE) {
      setTraceShown(true);
    } else if (fileAt >= 0) {
      setFilesOpen(true);
    } else {
      return;
    }
    window.requestAnimationFrame(() => {
      const root = rowRef.current;
      const file = root?.querySelectorAll<HTMLElement>(
        ".de-files-panel .de-file",
      )[fileAt];
      // The trace's card; or the file, on what it still needs where it says so.
      const target =
        key === EXTRA_TRACE
          ? root?.querySelector<HTMLElement>(".de-under")
          : (file?.querySelector<HTMLElement>(".ep-file-flag") ??
            file?.querySelector<HTMLElement>(".ep-file-open"));
      target?.scrollIntoView({ block: "nearest" });
      target?.focus();
    });
  };
  const traceView = (
    <>
      {traced ? (
        <SampleTrace
          ids={action.ids}
          requirementId={item.id}
          trace={trace}
          failed={traceFailed}
          canAct={canAct}
          onTrace={setTrace}
        />
      ) : null}
    </>
  );
  const agentSaid = (
    <>
      {row.agent !== null && row.reading === 0 ? (
        <div className="de-agent">
          <UiIcon name="sparkles" size={14} />
          <div>
            <p>
              <strong>{row.agent.lead}</strong> {row.agent.text}
            </p>
            {row.agent.followUps.length > 0 ? (
              <ul className="ep-follow">
                {row.agent.followUps.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
  const passedOver = (
    <>
      {item.passedOver.length > 0 ? (
        <p className="ep-passed">
          {item.passedOver.join(", ")} came in on its request, but the reader
          found {item.passedOver.length === 1 ? "it does" : "they do"} not cover
          this request.
          {canAct && held.length > 0 ? " Use it from the menu if it does." : ""}
        </p>
      ) : null}
    </>
  );
  const policyCheck = <PolicyCheck evidence={policies} item={item} />;
  const decided = (
    <>{row.note !== "" ? <p className="ep-note">{row.note}</p> : null}</>
  );
  /** What opens on the person's own choice, or waits on their decision: a policy on
   * file, the pickers, the few words a judgment needs, the findings' follow-up. */
  const forms = (
    <>
      {onFile.map((proposal) => (
        <PolicyOnFile
          key={proposal.id}
          ids={ids}
          proposal={proposal}
          canAct={canAct}
          onDecided={onPolicyDecided}
          onMapping={onCoverage}
        />
      ))}
      {picker === "policy" ? (
        <PolicyPicker
          ids={ids}
          itemId={item.id}
          documents={documents}
          onCancel={() => setPicker(null)}
          onFiled={() => {
            setPicker(null);
            onPolicyDecided();
          }}
        />
      ) : null}
      {picker === "held" ? (
        <div ref={heldRef}>
          <HeldPicker
            held={held}
            onCancel={() => setPicker(null)}
            onLink={async (fileId, reason) => {
              if (
                await action.run(`link-${item.id}`, {
                  intent: "link",
                  requirement_id: item.id,
                  file_id: fileId,
                  reason,
                  version: item.version,
                })
              ) {
                setPicker(null);
                onDone("File added to the request.");
              }
            }}
          />
        </div>
      ) : null}
      {canAct && asking !== null ? (
        <AskForm
          asking={asking}
          words={words}
          busy={locked}
          onWords={setWords}
          onCancel={() => setAsking(null)}
          onSubmit={() => void submitAsk()}
        />
      ) : null}
      {/* The follow-up a person sends from the issues' findings they
                      ticked: the findings' own, as in the evidence dialog. */}
      {canAct && item.requestId !== null ? (
        <FollowUpComposer
          findings={toSend}
          requestId={item.requestId}
          controlRef={controlRef}
          controlTitle=""
          action={findingsAction}
          onSent={() => setPicked(new Set())}
        />
      ) : null}
    </>
  );
  const change = (
    <>
      {row.change !== null ? (
        <div className="dq-change">
          <p className="ta-why">
            <span className="tar-origin">
              {row.change.remove
                ? "The agent proposes removing this request."
                : "The agent proposes a change to this request."}
            </span>{" "}
            It stays as it is until you accept the change.
          </p>
          {!row.change.remove && row.change.title !== "" ? (
            <p className="ta-replaces">
              <span>Proposed title</span> {row.change.title}
            </p>
          ) : null}
          {!row.change.remove && row.change.description !== "" ? (
            <p className="ta-replaces">
              <span>Proposed request</span> {row.change.description}
            </p>
          ) : null}
          {canAct ? (
            <div className="tc-row-acts">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={locked}
                onClick={async () => {
                  if (
                    await action.run(`change-${item.id}`, {
                      intent: "change",
                      requirement_id: item.id,
                      decision: "ACCEPT",
                      version: item.version,
                    })
                  ) {
                    onDone("Change accepted.");
                  }
                }}
              >
                Accept the change
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={locked}
                onClick={async () => {
                  if (
                    await action.run(`change-${item.id}`, {
                      intent: "change",
                      requirement_id: item.id,
                      decision: "DISMISS",
                      version: item.version,
                    })
                  ) {
                    onDone("Kept as it was.");
                  }
                }}
              >
                Keep as it is
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
  // What anyone who can see the row may read of a tickmark: the annotation a "Shown,
  // auditor's judgment" rests on (read only), and the one viewer on it.
  const tickmarkRead: DigestTickmarkRead | null =
    assured !== null
      ? {
          annotations: () =>
            readRequestAnnotations(
              ids,
              item.id,
              rowFiles.map((file) => file.id),
            ),
          openAnnotation: (fileId, annotationId) =>
            onView({
              fileId,
              files: filesOf(item),
              requirementId: item.id,
              annotationId,
            }),
        }
      : null;
  /** The finding that records an attribute's issue, where the list holds it. */
  const findingOf = (line: AttributeLine) =>
    line.findingId === null
      ? null
      : ((findings ?? []).find((each) => each.id === line.findingId) ?? null);
  // Why the row's Accept cannot be pressed now, as its button says it; read when an
  // acceptance a tickmark asked for comes due, not when the form was sent.
  const acceptOff = useRef<string | null>(null);
  acceptOff.current = locked
    ? lockedWhy
    : asking !== null
      ? ASKING_FIRST
      : null;
  // A person's tickmark on an attribute of the finished check, and the row's own ways
  // to add evidence from it (section 10.13): only for a person who may act.
  const tickmark: DigestTickmarkAction | null =
    canAct && assured !== null && tickmarkRead !== null
      ? {
          ...tickmarkRead,
          offer: (line) => tickmarkOffer(assured.check, line, canAct),
          record: (attributeId, fields, replaces) =>
            tickmarks.record(item.id, attributeId, fields, replaces),
          reopen: (attributeId, seen, reason) =>
            tickmarks.reopen(item.id, attributeId, seen, reason),
          addAnnotation: (fileId, attributeId, back) =>
            onView({
              fileId,
              files: filesOf(item),
              requirementId: item.id,
              add: { attributeId },
              onClosed: back,
            }),
          // What recording a tickmark may also do (section 10.15), as the model offers
          // it: the row's own Accept where it settles the last attribute, and the
          // dismissal of the check's proposed finding.
          after: (line) =>
            tickmarkAfter(assured.check, line, {
              canAccept: canAct && row.canAccept,
              findingStatus: findingOf(line)?.status ?? null,
            }),
          // The row's one Accept, the handler its button presses, with why it cannot
          // be pressed now where it cannot; the server's refusal in its own sentence.
          accept: async () => {
            const off = acceptOff.current;
            if (off !== null) {
              return off;
            }
            return (await accept())
              ? null
              : (action.refusal() ?? ACCEPT_REFUSED);
          },
          // The finding's own dismissal, with the tickmark's reason as its note.
          dismiss: async (line, note) => {
            const finding = findingOf(line);
            if (finding === null) {
              return FINDING_NOT_SHOWN;
            }
            return (await decideFinding(
              findingsAction,
              finding,
              "DISMISS",
              note,
            ))
              ? null
              : (findingsAction.refusal() ?? DISMISS_REFUSED);
          },
        }
      : null;
  // A tickmark refused because the request changed (409): where the list read again no
  // longer shows the attribute (the check is out of date, or checking), the row still
  // says why, on its check's line; once the check is finished again, it is gone.
  const standingNow = assured?.check.standing ?? null;
  const lostRefusal =
    tickmarks.refused !== null &&
    standingNow !== null &&
    standingNow !== "REVIEWED"
      ? tickmarks.refused
      : null;
  const refusalShown = useRef(false);
  const { clearRefused } = tickmarks;
  useEffect(() => {
    if (lostRefusal !== null) {
      refusalShown.current = true;
    } else if (refusalShown.current && standingNow === "REVIEWED") {
      refusalShown.current = false;
      clearRefused();
    }
  }, [lostRefusal, standingNow, clearRefused]);
  // A person's decision on a file's reliability (section 10.14): only for a person who may
  // act; anyone who can see the row reads the decisions.
  const fileReliability: ReliabilityAction | null =
    assured !== null
      ? reliabilityFor(reliabilityCalls, item.id, assured.check, canAct)
      : null;
  const unavailable = (key: MenuKey) =>
    menuEntries.find((each) => each.key === key)?.unavailable ?? null;
  const addEvidence: DigestAddEvidence | null = canAct
    ? {
        upload: () => onUpload(),
        uploadOff: locked ? lockedWhy : unavailable("upload"),
        held: () => {
          setPicker("held");
          setHeldAsked(true);
        },
        heldOff: locked ? lockedWhy : unavailable("held"),
      }
    : null;
  const check =
    assured !== null && row.reading === 0 ? (
      <CheckOfRequest
        check={assured.check}
        files={rowFiles}
        offer={offer}
        busy={checks.busy}
        requirementId={item.id}
        disabled={locked || checks.pending}
        onAct={actOn}
        findings={findings}
        findingsAction={findingsAction}
        canAct={canAct}
        title={row.title}
        about={
          reviewed ? (
            <div className="tc is-flat">
              <dl className="tc-rules">{request}</dl>
            </div>
          ) : null
        }
        more={
          reviewed ? (
            <>
              {/* A trace that waits on the person is on the first screen (its item
                  reveals it under the list); any other is here. */}
              {traceShown || tracePending ? null : traceView}
              {agentSaid}
              {passedOver}
              {policyCheck}
            </>
          ) : null
        }
        extras={extras}
        onView={viewExtra}
        under={
          reviewed && traceShown && traced ? (
            <div className="de-under" tabIndex={-1}>
              {traceView}
            </div>
          ) : null
        }
        onOpen={openFile}
        ask={
          canAct
            ? {
                // The path the menu's "Ask a follow-up" takes: the row's own form.
                onAsk: askOwner,
                unavailable: followUpOff,
              }
            : null
        }
        accept={
          canAct && row.canAccept
            ? {
                onAccept: () => void accept(),
                // Only the accept itself: a follow-up, an insufficient or a reopen
                // being recorded runs under the same key, with its form open.
                busy: asking === null && action.busy === `judge-${item.id}`,
                off: locked ? lockedWhy : asking !== null ? ASKING_FIRST : null,
              }
            : null
        }
        acceptNote={assured.acceptNote}
        tickmark={tickmark}
        addEvidence={addEvidence}
        read={tickmarkRead}
        reliability={fileReliability}
        closing={{
          accepted: item.state === "ACCEPTED",
          canAccept: canAct && row.canAccept,
        }}
        refused={lostRefusal}
        picked={picked}
        onPick={(findingId, on) =>
          setPicked((current) => {
            const next = new Set(current);
            if (on) {
              next.add(findingId);
            } else {
              next.delete(findingId);
            }
            return next;
          })
        }
      />
    ) : null;
  // "7 files" in the row's own line: on a finished check it opens the files in place.
  const filesWord = `${item.files.length} file${item.files.length === 1 ? "" : "s"}`;
  const filesAt = row.sub.indexOf(` · ${filesWord}`);
  const filesId = `${id}-files`;

  const content = (
    <div className="de-grid">
      {reviewed ? (
        // The head of a finished check: the title opens and closes the row, as the
        // whole head does everywhere else, and "7 files" beside it is its own button.
        <div className="tar-head dq-head de-head de-head-split">
          <span className="dr-tile" aria-hidden="true">
            <UiIcon name={row.icon} size={16} />
          </span>
          <span className="tar-name">
            <button
              type="button"
              className="de-head-toggle"
              aria-expanded={open}
              aria-controls={bodyId}
              // Its name is the title; the row's line, where each attribute stands,
              // the attributes it addresses and its state describe it, as when the
              // whole head was the one button.
              aria-describedby={`${id}-sub${!open && assured !== null && assured.states.length > 0 ? ` ${id}-states` : ""} ${id}-meta`}
              onClick={onToggle}
            >
              <span className="tar-text">{row.title}</span>
            </button>
            {open && item.files.length > 0 ? (
              <span className="tar-source de-subline" id={`${id}-sub`}>
                {filesAt < 0
                  ? `${row.sub} · `
                  : `${row.sub.slice(0, filesAt)} · `}
                <button
                  type="button"
                  className="de-link de-files-toggle"
                  aria-expanded={filesShown}
                  aria-controls={filesId}
                  onClick={() => setFilesOpen(!filesShown)}
                >
                  {filesWord}
                </button>
                {filesAt < 0
                  ? ""
                  : row.sub.slice(filesAt + 3 + filesWord.length)}
              </span>
            ) : (
              <span className="tar-source" id={`${id}-sub`}>
                {row.sub}
              </span>
            )}
            {/* Closed, the row says where each attribute stands; open, the verdict
                under it does. */}
            {!open && assured !== null && assured.states.length > 0 ? (
              <span className="de-states" id={`${id}-states`}>
                {assured.states.map((group) => (
                  <span
                    key={group.key}
                    className={`de-state tone-${group.tone}`}
                  >
                    <UiIcon name={group.icon} size={12} />
                    {group.label}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
          {/* The letters sit over the title's box so each keeps its own words for the
              pointer; a press on them opens the row, as a press anywhere on the head
              does. The title's button is the keyboard's way, and names all of it. */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer convenience over the title's own button, which the keyboard uses. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: the title's button is the keyboard's way to open the row. */}
          <span className="de-head-meta" id={`${id}-meta`} onClick={onToggle}>
            {meta}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="tar-head dq-head de-head"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="dr-tile" aria-hidden="true">
            <UiIcon name={row.icon} size={16} />
          </span>
          <span className="tar-name">
            <span className="tar-text">{row.title}</span>
            <span className="tar-source">{row.sub}</span>
            {assured !== null && assured.states.length > 0 ? (
              <span className="de-states">
                {assured.states.map((group) => (
                  <span
                    key={group.key}
                    className={`de-state tone-${group.tone}`}
                  >
                    <UiIcon name={group.icon} size={12} />
                    {group.label}
                  </span>
                ))}
              </span>
            ) : null}
          </span>
          {meta}
        </button>
      )}
      <span className="dq-menu de-acts">
        {uploads ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm de-upload"
            disabled={locked}
            aria-label={`Upload evidence for ${row.title}`}
            title="Opens the evidence wizard on this request. Files can be dropped on the row too."
            onClick={() => onUpload()}
          >
            <UiIcon name="upload" size={13} />
            <span className="de-upload-label">Upload</span>
          </button>
        ) : null}
        {canAct ? <RowMenu label={row.title} items={menuFor()} /> : null}
      </span>
      <button
        type="button"
        className="de-caret"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onToggle}
      >
        <UiIcon name="chevron" size={14} />
      </button>
      {open && reviewed ? (
        <div className="tar-body de-body de-reviewed" id={bodyId}>
          {change}
          <div
            id={filesId}
            className="de-files-panel"
            hidden={!filesShown && item.files.length > 0}
          >
            {filesShown || item.files.length === 0 ? fileList : null}
          </div>
          {check}
          {decided}
          {forms}
        </div>
      ) : open ? (
        <div className="tar-body de-body" id={bodyId}>
          {change}
          <div className="tc is-flat">
            <dl className="tc-rules">
              {request}
              <div>
                <dt>Evidence</dt>
                <dd className="de-evidence">
                  {fileList}
                  {check}
                  {traceView}
                  {agentSaid}
                  {passedOver}
                  {decided}
                  {policyCheck}
                  {forms}
                  {canAct && asking === null && row.canAccept ? (
                    <div className="de-accept">
                      {/* What accepting marks as evidenced, and what it leaves
                          open: it informs, and never holds the person back. */}
                      {assured !== null && assured.acceptNote !== "" ? (
                        <p className="de-accept-note">{assured.acceptNote}</p>
                      ) : null}
                      <div className="tc-row-acts">
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={locked}
                          onClick={() => void accept()}
                        >
                          {action.busy === `judge-${item.id}`
                            ? "Accepting…"
                            : "Accept"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={locked}
                          onClick={followUp}
                        >
                          Ask a follow-up
                        </button>
                      </div>
                    </div>
                  ) : null}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <li
      id={`req-${item.id}`}
      ref={rowRef}
      // While the list is locked (an upload just ended and the plan is being read
      // again) a drop is not taken: the row may travel in another request by now.
      onDropCapture={
        locked
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
            }
          : undefined
      }
      // Files dropped on the row open the evidence wizard on it, with them queued (a
      // policy on a control over several systems is asked about there).
      onDragOver={(event) => {
        if (uploads && !locked && carriesFiles(event)) {
          event.preventDefault();
          event.stopPropagation();
          setOver(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOver(false);
        }
      }}
      onDrop={(event) => {
        setOver(false);
        if (!uploads || locked || !carriesFiles(event)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        void droppedFiles(event.dataTransfer).then((picked) =>
          onUpload(picked),
        );
      }}
      className={`tar de-row is-${row.state.toLowerCase()}${open ? " is-open" : ""}${row.aside ? " is-aside" : ""}${over ? " is-over" : ""}`}
    >
      {content}
      {canAct && upgrading !== null ? (
        <UpgradeDialog
          busy={checks.busy === item.id}
          // The list is busy with another call: confirming waits, and says why.
          waiting={
            locked
              ? lockedWhy
              : checks.pending && checks.busy !== item.id
                ? UPGRADE_WAIT
                : null
          }
          onConfirm={() => upgradeCheck()}
          onClose={() => {
            const from = upgrading;
            setUpgrading(null);
            // Back to where it was chosen; the action is gone once the check is
            // current, so the row's own button is the next stop.
            window.requestAnimationFrame(() => {
              const root = rowRef.current;
              (from === "menu"
                ? root?.querySelector<HTMLElement>(".row-menu-button")
                : root?.querySelector<HTMLElement>(".de-check-upgrade")
              )?.focus();
              if (root !== null && root !== undefined) {
                if (!root.contains(document.activeElement)) {
                  root
                    .querySelector<HTMLElement>(
                      "button.de-head-toggle, button.de-head",
                    )
                    ?.focus();
                }
              }
            });
          }}
        />
      ) : null}
    </li>
  );
}

/**
 * "Check again with the current engine", asked once more (docs/evidence-assurance.md,
 * section 10.10): the confirmation dialog the list's other consequential actions use.
 * Only its confirm button sends; Escape, Cancel or a click outside closes it and nothing
 * is sent. It closes once the server has answered; while another check call of the list
 * is on its way, confirming is off and the dialog says why.
 */
function UpgradeDialog({
  busy,
  waiting,
  onConfirm,
  onClose,
}: {
  /** This request's call is on its way. */
  busy: boolean;
  /** Why it cannot be confirmed now (another call of the list is out); null otherwise. */
  waiting: string | null;
  /** Called once per press; the dialog closes when the server answered, and a refusal
   * is said on the list, as the list's other check actions say theirs. "busy": nothing
   * was sent, and the dialog stays open and says so. */
  onConfirm: () => Promise<"done" | "refused" | "busy">;
  onClose: () => void;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) {
      element.showModal();
    }
  }, []);
  const sent = useRef(false);
  const [held, setHeld] = useState<string | null>(null);
  const why = waiting ?? held;
  // Once the list's other call is done, what was said of it goes too.
  useEffect(() => {
    if (waiting === null) {
      setHeld(null);
    }
  }, [waiting]);
  const close = () => dialog.current?.close();
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop cancels; Escape and Cancel do too, through the dialog itself.
    <dialog
      ref={dialog}
      className="confirm-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-body`}
      onCancel={(event) => {
        // Not while the call is out: the answer is still to come.
        if (busy) {
          event.preventDefault();
        }
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) {
          close();
        }
      }}
    >
      <div className="confirm-dialog-body">
        <h2 id={`${id}-title`}>{UPGRADE_TITLE}</h2>
        <p id={`${id}-body`}>{UPGRADE_BODY}</p>
        {why !== null ? (
          <p className="confirm-impact-state" role="status">
            {why}
          </p>
        ) : null}
        <div className="confirm-dialog-actions">
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || waiting !== null}
            onClick={() => {
              // One press sends; a second one before the button is off sends nothing.
              if (!sent.current) {
                sent.current = true;
                setHeld(null);
                void onConfirm().then((result) => {
                  if (result === "busy") {
                    // Nothing was sent: said, and it can be confirmed again.
                    sent.current = false;
                    setHeld(UPGRADE_WAIT);
                  } else {
                    close();
                  }
                });
              }
            }}
          >
            {busy ? "Starting…" : UPGRADE_CONFIRM}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * A request's check by the assurance chain (docs/evidence-assurance.md, section 7): its
 * files are read together, as one walkthrough. One quiet line while it works; held,
 * failed or out of date, one line with the single action that clears it; a file left out
 * of the readings, named with why and its own action. Finished, it is the row's first
 * screen (section 10.12, check-digest.tsx): the verdict, only what needs the person's
 * attention, what is fine with every caveat, and the footer with the row's own Accept and
 * follow-up; an item opens its attribute alone, and "All details" the request and the
 * rest of the check. An issue is its evidence finding, with the finding's own actions.
 * Nothing of a check is shown before it ends.
 */
function CheckOfRequest({
  check,
  files,
  offer,
  busy,
  requirementId,
  disabled,
  onAct,
  findings,
  findingsAction,
  canAct,
  picked,
  onPick,
  title,
  about,
  more,
  extras,
  onView,
  under,
  onOpen,
  ask,
  accept,
  acceptNote,
  tickmark,
  addEvidence,
  read,
  reliability,
  closing,
  refused,
}: {
  check: RequestCheck;
  /** The row's in-force files. */
  files: RowFile[];
  /** An action as this person is offered it; null when there is none for them. */
  offer: (action: CheckAction | null) => CheckAction | null;
  /** What is at work: the request's id (its check), or reread-<file id>. */
  busy: string;
  requirementId: string;
  disabled: boolean;
  onAct: (action: CheckAction) => void;
  findings: EvidenceFinding[] | null;
  findingsAction: ReturnType<typeof useFindingsAction>;
  canAct: boolean;
  picked: Set<string>;
  onPick: (findingId: string, on: boolean) => void;
  /** The request's title, said over an attribute shown alone. */
  title: string;
  /** The request's wording, the attributes it addresses and its format and period, as
   * the row draws them: the head of "All details" on a finished check. */
  about: ReactNode;
  /** What else the row says of the request's evidence, at the end of "All details". */
  more: ReactNode;
  /** What of the row itself waits on the person or must be known beside the check: the
   * check's model places each on the first screen. */
  extras: DigestExtra[];
  /** Puts in view what an item of the row's own is about, by the item's key. */
  onView: (key: string) => void;
  /** What the row has put in view for such an item, under the list. */
  under: ReactNode;
  /** Opens a file of the row in the evidence reviewer, on the annotation asked for. */
  onOpen: (fileId: string, annotation?: AnnotationAsk) => void;
  /** The row's follow-up form, the path its menu's "Ask a follow-up" takes, and why it
   * cannot be used now; null for a person who may not act. */
  ask: DigestAskAction | null;
  /** The row's Accept; null where the row does not offer it to this person. */
  accept: DigestAcceptAction | null;
  /** The row's warning about accepting. */
  acceptNote: string;
  /** A person's tickmark on an attribute (section 10.13); null for one who may not act. */
  tickmark: DigestTickmarkAction | null;
  /** The row's own ways to add evidence; null for a person who may not act. */
  addEvidence: DigestAddEvidence | null;
  /** What anyone who can see the row may read of a tickmark. */
  read: DigestTickmarkRead | null;
  /** A person's decision on a file's reliability (section 10.14); null for one who may
   * not act. */
  reliability: ReliabilityAction | null;
  /** Where the request stands for closing (section 10.15): accepted, and whether this
   * person is offered Accept. The first line of a settled request says it. */
  closing: Closing;
  /** A tickmark refused (409) whose attribute the check no longer shows: said on the
   * check's line, so it is never lost unread; null otherwise. */
  refused: string | null;
}) {
  const action = offer(check.action);
  // The finished check as its first screen; null while it is anything else.
  const digest = checkDigest(check, findings ?? [], files, extras, acceptNote);
  // The tickmarks kept while the check is not current (section 10.15, item 8), on its
  // check line.
  const kept =
    check.kept !== "" ? (
      <p className="de-check-line de-check-kept">
        <UiIcon name="tag" size={13} />
        <span>{check.kept}</span>
      </p>
    ) : null;
  const actButton = (act: CheckAction, about: string) => (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      disabled={disabled}
      aria-label={`${act.label}: ${about}`}
      onClick={() => onAct(act)}
    >
      {act.kind === "RERUN" && busy === requirementId
        ? "Starting…"
        : act.kind === "REREAD" && busy === `reread-${act.fileId ?? ""}`
          ? "Reading…"
          : act.label}
    </button>
  );
  // A file named on its own line, with the one action that clears it: a file left out
  // of the readings, or one read with its type still to confirm.
  const fileLines = (items: RequestCheck["leftOut"], acts = true) =>
    items.length === 0 ? null : (
      <ul className="de-left-out">
        {items.map((item) => {
          const act = acts ? offer(item.action) : null;
          const name =
            files.find((file) => file.id === item.fileId)?.name ?? "the file";
          return (
            <li key={item.fileId} className="de-check-line">
              <UiIcon name="info" size={13} />
              <span>{item.line}</span>
              {act !== null ? actButton(act, name) : null}
            </li>
          );
        })}
      </ul>
    );
  const leftOut = fileLines(check.leftOut);
  if (check.standing === "CHECKING") {
    return (
      <div className="de-check is-checking">
        <p className="de-check-line">
          <UiIcon name="sparkles" size={13} />
          <span className="ep-reading" role="status">
            {check.line}
            {check.stage !== "" ? ` · ${check.stage}` : ""}
            <span className="ep-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </span>
        </p>
        {kept}
        <Problem text={refused} />
        {leftOut}
      </div>
    );
  }
  if (check.standing !== "REVIEWED" || digest === null) {
    return (
      <div className={`de-check is-${check.standing.toLowerCase()}`}>
        <div className="de-check-line">
          <UiIcon
            name={
              check.standing === "HELD" || check.standing === "NOT_CHECKED"
                ? "info"
                : "retry"
            }
            size={13}
          />
          <span>{check.line}</span>
          {action !== null
            ? actButton(
                action,
                files.find((file) => file.id === action.fileId)?.name ??
                  "this request",
              )
            : null}
        </div>
        {kept}
        <Problem text={refused} />
        {leftOut}
      </div>
    );
  }
  // A check an earlier engine made: checked again by the current one, asked once more
  // first (section 10.10). Quiet, under the verdict: the result is what is read.
  const upgrade =
    action !== null && action.kind === "UPGRADE" ? (
      <button
        type="button"
        className="btn btn-secondary btn-sm de-check-upgrade"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-label={`${action.label}: this request`}
        onClick={() => onAct(action)}
      >
        {busy === requirementId ? "Starting…" : action.label}
      </button>
    ) : null;
  // Behind "All details": the request, then what the check said before, moved, not
  // rewritten. Every file's line is here in full; one with an action has it on its item
  // under "Needs attention", once.
  const details = (
    <>
      {about}
      {check.review !== null ? (
        <CheckReview review={check.review} onOpen={onOpen} />
      ) : null}
      {check.notAsked.length > 0 ? (
        // Attributes the request does not ask for and the evidence does not bear on:
        // one folded line, never an issue or a judgment; both readings on open.
        <details className="de-unasked">
          <summary className="de-unaddressed">
            <span className="de-state tone-neutral">
              <UiIcon name="minus" size={12} />
              Not asked for by this request
            </span>
            {check.notAsked.map((line) => (
              <span key={line.key} className="dr-code">
                {line.letter}
              </span>
            ))}
            <span className="de-attr-caret" aria-hidden="true">
              <UiIcon name="chevron" size={12} />
            </span>
          </summary>
          <ul className="de-unasked-list">
            {check.notAsked.map((line) => (
              <li key={line.key}>
                <p>
                  <span className="dr-code">{line.letter}</span>{" "}
                  {line.summary !== "" ? line.summary : line.text}
                </p>
                {line.readings.length > 0 ? (
                  <div className="de-views">
                    {line.readings.map((reading) => (
                      <div key={reading.who} className="de-view">
                        <strong>{reading.who}</strong>
                        <span className="de-view-result">{reading.result}</span>
                        {reading.reason !== "" ? <p>{reading.reason}</p> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {fileLines(check.leftOut, false)}
      {fileLines(check.confirm, false)}
      <p className="de-check-line">
        <UiIcon name="shield" size={13} />
        <span>
          {check.line}
          {check.readInPart !== null ? (
            <strong className="de-check-part"> {check.readInPart}</strong>
          ) : null}
        </span>
      </p>
      {more}
    </>
  );
  return (
    <div className="de-check is-reviewed">
      <CheckDigestView
        digest={digest}
        title={title}
        files={files}
        upgrade={upgrade}
        passage={(passage, letter) => (
          <PassageLine
            key={`${passage.fileId ?? ""}-${passage.location}-${passage.quote}`}
            passage={passage}
            attributeId={
              check.attributes.find((line) => line.letter === letter)
                ?.attributeId ?? ""
            }
            onOpen={onOpen}
          />
        )}
        onEvidence={(evidence) =>
          onOpen(evidence.fileId, {
            attributeId: evidence.attributeId,
            quote: evidence.quote,
          })
        }
        finding={(line) => {
          if (line.findingId === null) {
            return null;
          }
          const finding =
            (findings ?? []).find((each) => each.id === line.findingId) ?? null;
          return finding !== null ? (
            // The issue is this finding: shown once, with the finding's own actions.
            <FindingRecords
              findings={[finding]}
              canAct={canAct}
              action={findingsAction}
              picked={picked}
              onPick={onPick}
              onShow={() => {}}
              focused={null}
              compact
            />
          ) : (
            <p className="de-absent">
              The finding that records this issue could not be shown here. Open
              its file to act on it.
            </p>
          );
        }}
        // An item's own action is the check's (a file's type, a file left out), offered
        // as every other: only to a person who may act, and only where it can be done.
        act={(own) => {
          const act = offer(own);
          return act === null
            ? null
            : actButton(
                act,
                files.find((file) => file.id === act.fileId)?.name ??
                  "the file",
              );
        }}
        onView={onView}
        under={under}
        ask={ask}
        accept={accept}
        acceptNote={acceptNote}
        details={details}
        tickmark={tickmark}
        addEvidence={addEvidence}
        read={read}
        reliability={reliability}
        closing={closing}
      />
    </div>
  );
}

/** A file's own words with where they sit, opening in the evidence reviewer on the
 * annotation that marks them where the file can be shown: the same line under an
 * attribute and under a consideration of the review. */
function PassageLine({
  passage,
  attributeId,
  onOpen,
}: {
  passage: ShownPassage;
  /** The attribute the passage is cited for; "" for a consideration's. */
  attributeId: string;
  onOpen: (fileId: string, annotation?: AnnotationAsk) => void;
}) {
  const fileId = passage.fileId;
  return (
    <li>
      <q>{passage.quote}</q>
      <span className="de-where">
        {passage.fileLabel !== "" ? (
          <span className="de-where-file">{passage.fileLabel}</span>
        ) : null}
        <span>
          {passage.location !== "" ? passage.location : "In the file"}
        </span>
        {passage.opens && fileId !== null ? (
          <button
            type="button"
            className="de-link"
            onClick={() =>
              onOpen(fileId, { attributeId, quote: passage.quote })
            }
          >
            Open in the file
          </button>
        ) : null}
      </span>
    </li>
  );
}

/**
 * The review of a request's evidence (docs/evidence-assurance.md, section 10) as
 * "Details of the check" holds it (section 10.11): why the evidence is or is not
 * sufficient, the completeness reasons, the attributes the request asks for in three
 * groups, and, folded, what else a careful reader would raise, what there is to say of
 * the files, and the follow-ups the new evidence resolved. The outcome and the caveat
 * are said on the answer line, and what to ask for under "Ask the owner". It is the
 * check's proposal: it approves and decides nothing, and holds no action but opening a
 * passage in its file. Accept and the findings' decisions stay on the row.
 */
function CheckReview({
  review,
  onOpen,
}: {
  review: ReviewView;
  /** Opens a passage's file in the evidence reviewer. */
  onOpen: (fileId: string, annotation?: AnnotationAsk) => void;
}) {
  const id = useId();
  return (
    <section className="de-review" aria-labelledby={`${id}-title`}>
      <div className="de-review-lead">
        <p className="de-review-head">
          <span className="de-review-title" id={`${id}-title`}>
            <UiIcon name="sparkles" size={12} />
            {REVIEW_TITLE}
          </span>
          <span className="de-review-for">{REVIEW_FOR}</span>
        </p>
        <p className="de-review-why">{review.explanation}</p>
        {review.completeness !== null ? (
          <p className="de-review-quiet">
            <strong>{review.completeness.label}:</strong>{" "}
            {review.completeness.reasons.join(" ")}
          </p>
        ) : null}
        {review.groups.length > 0 ? (
          <>
            {/* One line: each group in words with its mark, then its letters. Read
                out as the one sentence it is. */}
            <p className="sr-only">{`Attributes: ${review.countsLine}.`}</p>
            <ul className="de-review-groups" aria-hidden="true">
              {review.groups.map((group) => (
                <li key={group.key}>
                  <span className={`de-state tone-${group.tone}`}>
                    <UiIcon name={group.icon} size={12} />
                    {group.label}
                  </span>
                  {group.letters.map((letter) => (
                    <span key={letter} className="dr-code">
                      {letter}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      {review.considerations.length > 0 ? (
        <details className="de-fold">
          <summary>
            <span className="de-attr-caret" aria-hidden="true">
              <UiIcon name="chevron" size={12} />
            </span>
            {CONSIDERATIONS_TITLE}
            <span className="de-fold-count">
              {review.considerations.length}
            </span>
          </summary>
          <div className="de-fold-body">
            <p className="de-review-quiet">
              Observations only: none is an attribute or an issue.
            </p>
            <ul className="de-fold-list">
              {review.considerations.map((item) => (
                <li key={item.key} className="de-consider">
                  <span>{item.text}</span>
                  {item.passages.length > 0 ? (
                    <ul className="de-passages">
                      {item.passages.map((passage) => (
                        <PassageLine
                          key={`${passage.fileId ?? ""}-${passage.location}-${passage.quote}`}
                          passage={passage}
                          attributeId=""
                          onOpen={onOpen}
                        />
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}
      {review.concerns.length > 0 ||
      review.files.length > 0 ||
      review.contextThin !== null ? (
        <details className="de-fold">
          <summary>
            <span className="de-attr-caret" aria-hidden="true">
              <UiIcon name="chevron" size={12} />
            </span>
            {FILES_TITLE}
          </summary>
          <div className="de-fold-body">
            {review.concerns.length > 0 || review.files.length > 0 ? (
              <ul className="de-fold-list">
                {review.concerns.map((item) => (
                  <li key={item.key} className="de-consider">
                    {item.files !== "" ? (
                      <span className="de-where-file">{item.files}</span>
                    ) : null}
                    <span>{item.text}</span>
                  </li>
                ))}
                {review.files.map((file) => (
                  <li key={file.fileId} className="de-consider">
                    <span className="de-where-file">{file.name}</span>
                    <span>{file.notes.join(" ")}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {review.contextThin !== null ? (
              <p className="de-review-quiet">{review.contextThin}</p>
            ) : null}
          </div>
        </details>
      ) : null}
      {review.resolved.length > 0 ? (
        <details className="de-fold">
          <summary>
            <span className="de-attr-caret" aria-hidden="true">
              <UiIcon name="chevron" size={12} />
            </span>
            {RESOLVED_TITLE}
            <span className="de-fold-count">{review.resolved.length}</span>
          </summary>
          <ul className="de-fold-body de-fold-list">
            {review.resolved.map((item) => (
              <li key={item.key}>
                {item.letters.map((letter) => (
                  <span key={letter} className="dr-code">
                    {letter}
                  </span>
                ))}
                <span>{item.request}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

const ASK_WORDS: Record<
  Asking["kind"],
  { label: string; placeholder: string; save: string; min: number; max: number }
> = {
  FOLLOW_UP_REQUIRED: {
    label: "What to ask the owner for",
    placeholder: "What is missing or needs a follow-up",
    save: "Record the follow-up",
    min: 3,
    max: 1000,
  },
  INSUFFICIENT: {
    label: "What is missing",
    placeholder: "Why the evidence is not sufficient",
    save: "Mark insufficient",
    min: 3,
    max: 1000,
  },
  NOT_REVIEWED: {
    label: "Why the decision is reopened",
    placeholder: "Why the decision is reopened",
    save: "Reopen",
    min: 3,
    max: 1000,
  },
  WAIVE: {
    label: "Why it does not apply",
    placeholder: "Why this does not apply (scope, control, or methodology)",
    save: "Mark not applicable",
    min: 10,
    max: 1000,
  },
  UNLINK: {
    label: "Why it no longer serves it",
    placeholder: "Why the file no longer serves this request",
    save: "Unlink",
    min: 3,
    max: 500,
  },
};

/** The few words a judgment or a change needs before it is recorded. What was typed
 * stays if the server refuses. */
function AskForm({
  asking,
  words,
  busy,
  onWords,
  onCancel,
  onSubmit,
}: {
  asking: Asking;
  words: string;
  busy: boolean;
  onWords: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const id = useId();
  const copy = ASK_WORDS[asking.kind];
  const ready = words.trim().length >= copy.min;
  return (
    <form
      autoComplete="off"
      className="de-ask"
      aria-busy={busy}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !busy) {
          onSubmit();
        }
      }}
    >
      <label htmlFor={`${id}-words`}>{copy.label}</label>
      <textarea
        id={`${id}-words`}
        value={words}
        rows={2}
        maxLength={copy.max}
        placeholder={copy.placeholder}
        // biome-ignore lint/a11y/noAutofocus: the form opens on the person's own choice of this action, and typing is its only step.
        autoFocus
        onChange={(event) => onWords(event.target.value)}
      />
      <span className="tc-row-acts">
        <button type="submit" className="btn btn-sm" disabled={!ready || busy}>
          {busy ? "Saving…" : copy.save}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </span>
    </form>
  );
}
