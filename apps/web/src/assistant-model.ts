/**
 * The control assistant: what the agents have done on a control, what needs the person
 * who opened it, and what waits on someone else. Derived from the records the control
 * record already loads, so the assistant never says anything the page cannot show.
 */

import type { ContextIntent, ControlContext } from "./control-context-model.ts";
import type { ControlRow, DetailTab, PlanTask } from "./engagement-model.ts";
import type { EvidenceAction, EvidenceTarget } from "./evidence-flow.ts";
import type { ControlReview } from "./review-model.ts";
import type { TestSheet } from "./sheet-model.ts";
import type { ControlTest } from "./testing-model.ts";

export type AssistantAction = {
  /** Stable for the same piece of work, so a dismissal holds until something changes. */
  key: string;
  title: string;
  detail: string;
  tab: DetailTab;
  /** The step on that tab, as its anchor. */
  anchor: string;
  /** On the Evidence tab: the view and the record it opens (evidence-flow.ts). */
  target?: EvidenceTarget;
  /** Work the agent can do right now, on the person's word. */
  quick: { intent: ContextIntent; label: string } | null;
  urgent: boolean;
};

export type AssistantBrief = {
  agent: string;
  headline: string;
  done: string[];
  actions: AssistantAction[];
  waiting: string[];
  /** Changes whenever the work that needs the person changes. */
  signature: string;
};

export type AssistantInput = {
  control: ControlRow;
  context: ControlContext | null;
  test: ControlTest | null;
  sheet: TestSheet | null;
  review: ControlReview | null;
  tasks: PlanTask[];
  /** Evidence files of this control the agents have read. */
  filesRead: number;
  /** Interim population items not yet accepted on the evidence plan, which hold back
   * the samples (evidence-plan-model populationWaiting). */
  populationToAccept?: Array<{ id: string; version: number; title: string }>;
  /** What a person does next on the evidence, one item per record (evidence-flow.ts). */
  evidence?: EvidenceAction[];
};

/** The readiness states that stop testing (control-context-model.ts). */
const BLOCKING: readonly string[] = [
  "NEEDS_INFORMATION",
  "PLAN_NOT_APPROVED",
  "PROCESS_UNDERSTANDING_INCOMPLETE",
  "CONFLICT_REQUIRES_REVIEW",
];

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/** The step anchors on the record, from their titles (control-phases.tsx). */
export function stepAnchor(title: string): string {
  return `step-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

const STEP = {
  attributes: stepAnchor("Definition and attributes"),
  process: stepAnchor("Process understanding"),
  documents: stepAnchor("Supporting documents"),
  plan: stepAnchor("Population and sample"),
  sheet: stepAnchor("Test results and sign-off"),
  workpaper: stepAnchor("Interim workpaper"),
  review: stepAnchor("Review"),
};

/** The agent carrying the control now: the first of its tasks not finished. */
function agentFor(tasks: PlanTask[]): string {
  const order = ["walkthrough", "evidence", "test", "review"];
  const open = [...tasks]
    .filter(
      (task) => task.status !== "SUCCEEDED" && task.status !== "CANCELLED",
    )
    .sort((a, b) => order.indexOf(a.kind ?? "") - order.indexOf(b.kind ?? ""));
  return open[0]?.agent ?? tasks[0]?.agent ?? "Your audit agent";
}

export function assistantBrief(input: AssistantInput): AssistantBrief {
  const { control, context, test, sheet, review } = input;
  const done: string[] = [];
  const actions: AssistantAction[] = [];
  const waiting: string[] = [];

  // What the agents did.
  if (input.filesRead > 0) {
    done.push(
      `${plural(input.filesRead, "evidence file")} read and classified for this control.`,
    );
  }
  if (context !== null) {
    const reviewed = context.documents.filter((item) => item.reviewed).length;
    if (reviewed > 0) {
      done.push(
        `${plural(reviewed, "supporting document")} reviewed against the control.`,
      );
    }
    const mine = context.proposed.filter(
      (item) => item.sourceKind === "AGENT" || item.sourceKind === "DOCUMENT",
    ).length;
    if (mine > 0) {
      done.push(
        `${plural(mine, "attribute change")} proposed from the source documents.`,
      );
    }
    if (
      context.understanding.builtBy === "AGENT" &&
      context.understanding.steps.length > 0
    ) {
      done.push(
        `Process map drafted: ${plural(context.understanding.steps.length, "step")}, each marked as documented or inferred.`,
      );
    } else if (
      context.understanding.builtBy === "RULES" &&
      context.understanding.steps.length > 0
    ) {
      done.push(
        "Process map started from the RCM record and standard practice.",
      );
    }
  }
  const drafted = control.requests.filter((item) => item.status === "DRAFT");
  const toApprove = control.requests.filter(
    (item) => item.status === "APPROVAL_PENDING",
  );
  if (drafted.length + toApprove.length > 0) {
    done.push(
      `${plural(drafted.length + toApprove.length, "evidence request")} drafted for ${control.ownerName || "the control owner"}.`,
    );
  }
  if (test !== null && test.status === "PROPOSED") {
    done.push(
      `Population checked; ${plural(test.samples.length, "sample")} selected for approval.`,
    );
  }
  if (sheet !== null && sheet.counts.tested > 0) {
    done.push(
      `${sheet.counts.tested} of ${plural(sheet.counts.items, "item")} tested` +
        (sheet.counts.exceptions > 0
          ? `; ${plural(sheet.counts.exceptions, "exception")} identified.`
          : " against every attribute, with supporting citations."),
    );
  }
  if (review !== null && review.reperformedAt !== null) {
    done.push("The independent reviewer re-performed the testing.");
  }

  const add = (
    action: Omit<AssistantAction, "quick" | "urgent"> &
      Partial<AssistantAction>,
  ) => actions.push({ quick: null, urgent: false, ...action });

  // What needs the person, most pressing first.
  if (context !== null) {
    const open = context.issues.filter((item) => item.status === "OPEN");
    const conflicts = open.filter((item) => item.kind === "CONFLICT");
    if (conflicts.length > 0) {
      add({
        key: `conflicts-${conflicts.map((item) => item.id).join(".")}`,
        title: `Resolve ${plural(conflicts.length, "conflict")} between sources`,
        detail: `${conflicts[0]?.detail ?? ""} Testing cannot begin until this is resolved.`,
        tab: "design",
        anchor:
          conflicts[0]?.origin === "PROCESS" ? STEP.process : STEP.attributes,
        urgent: true,
      });
    }
    if (context.approved.length === 0) {
      add({
        key: "no-attributes",
        title: "Define the test attributes",
        detail:
          "No test attributes have been approved for this control, so testing cannot begin. Attributes can be proposed from the RCM and the supporting documents.",
        tab: "design",
        anchor: STEP.attributes,
        quick: { intent: "attributes-generate", label: "Propose attributes" },
        urgent: true,
      });
    }
    if (context.proposed.length > 0) {
      add({
        key: `proposals-${context.proposed.map((item) => item.id).join(".")}`,
        title: `Decide ${plural(context.proposed.length, "proposed attribute change")}`,
        detail:
          "Each proposal indicates whether it is stated in a source or inferred. No change is applied until approved.",
        tab: "design",
        anchor: STEP.attributes,
      });
    }
    const questions = open.filter((item) => item.kind !== "CONFLICT");
    if (questions.length > 0) {
      add({
        key: `questions-${questions.map((item) => item.id).join(".")}`,
        title: `Answer ${plural(questions.length, "open question")}`,
        detail: questions[0]?.detail ?? "",
        tab: "design",
        anchor: questions.every((item) => item.origin === "PROCESS")
          ? STEP.process
          : STEP.attributes,
      });
    }
    const understanding = context.understanding;
    if (context.processRequired && understanding.status !== "CONFIRMED") {
      if (understanding.steps.length === 0) {
        add({
          key: "process-build",
          title: "Build the process understanding",
          detail:
            "As a business process control, it is tested against how its process operates. A process map can be drafted from the RCM and supporting documents, with inferred steps identified for review.",
          tab: "design",
          anchor: STEP.process,
          quick: { intent: "process-build", label: "Draft process map" },
          urgent: true,
        });
      } else {
        add({
          key: `process-confirm-${understanding.version}`,
          title: "Review and confirm the process map",
          detail:
            "Review each step, particularly those marked as inferred, identify where the control operates, and confirm the map. Testing cannot begin until it is confirmed.",
          tab: "design",
          anchor: STEP.process,
          urgent: true,
        });
      }
    }
    if (understanding.proposedSteps !== null) {
      add({
        key: `process-proposal-${understanding.version}`,
        title: "Review the updated process map",
        detail:
          "The sources were re-read and a revised map is proposed. The current map remains in effect until the revision is accepted.",
        tab: "design",
        anchor: STEP.process,
      });
    }
    const unreviewed = context.documents.filter(
      (item) => !item.reviewed,
    ).length;
    if (unreviewed > 0) {
      add({
        key: `documents-${unreviewed}`,
        title: `Review ${plural(unreviewed, "new document")} against the control`,
        detail:
          "Each document can be assessed against the test attributes and the process, with any resulting changes proposed for approval.",
        tab: "design",
        anchor: STEP.documents,
        quick: { intent: "review", label: "Review documents" },
      });
    }
  }

  const blocked =
    context?.readiness !== null &&
    context?.readiness !== undefined &&
    BLOCKING.includes(context.readiness.state);
  const unaccepted = test === null ? [] : (input.populationToAccept ?? []);
  if (
    test !== null &&
    test.status === "PROPOSED" &&
    !blocked &&
    unaccepted.length > 0
  ) {
    add({
      key: `population-${unaccepted.map((item) => `${item.id}.${item.version}`).join("-")}`,
      title: "Accept the population",
      detail: `Samples are drawn only from a population assessed as complete and accurate. Review ${unaccepted.map((item) => item.title).join(" and ")} in the interim evidence plan, then approve the samples.`,
      tab: "evidence",
      anchor: "",
      target: { view: "requirements" },
    });
  } else if (test !== null && test.status === "PROPOSED" && !blocked) {
    add({
      key: `samples-${test.id}-${test.version}`,
      title: "Approve the samples",
      detail: `Review the population checks and the ${plural(test.samples.length, "selected sample")}, then approve them to begin testing.`,
      tab: "testing",
      anchor: STEP.plan,
    });
  }
  if (sheet !== null && sheet.status === "OPEN") {
    const open = sheet.counts.unable + sheet.counts.review;
    if (control.sheetLeft === "DECIDE" || open > 0) {
      add({
        key: `decide-${sheet.id}-${sheet.version}`,
        title: `Decide ${plural(open, "result")} requiring judgment`,
        detail:
          "These results could not be concluded automatically: the evidence was insufficient, no supporting passage could be cited, or professional judgment is required.",
        tab: "testing",
        anchor: STEP.sheet,
        urgent: true,
      });
    } else if (control.sheetLeft === "PLACE") {
      add({
        key: `place-${sheet.id}-${sheet.version}`,
        title: `Assign ${plural(sheet.counts.unplaced, "file")} to samples`,
        detail:
          "These files could not be matched to a sample. Assign each file to its sample so it can be tested.",
        tab: "testing",
        anchor: STEP.sheet,
      });
    } else if (control.sheetLeft === "SIGN_OFF") {
      add({
        key: `signoff-${sheet.id}-${sheet.version}`,
        title: "Sign off the testing",
        detail:
          "All items are tested and decided. Review the conclusion and sign off the testing.",
        tab: "testing",
        anchor: STEP.sheet,
        urgent: true,
      });
    }
  }
  if (control.sheetLeft === "DEFICIENCY") {
    add({
      key: `deficiency-${sheet?.id ?? control.id}`,
      title: "Decide the proposed deficiency",
      detail:
        "Testing identified an exception. Log the deficiency, or dismiss it with a documented reason.",
      tab: "testing",
      anchor: STEP.sheet,
      urgent: true,
    });
  }
  if (
    control.sheetStatus === "SIGNED_OFF" &&
    control.sheetLeft === null &&
    control.reviewLeft === null
  ) {
    add({
      key: `workpaper-${control.id}`,
      title: "Prepare the workpaper",
      detail:
        "Testing is signed off. Preparing the workpaper sends it for independent review.",
      tab: "testing",
      anchor: STEP.workpaper,
    });
  }
  if (review !== null && review.status === "OPEN") {
    const notes = review.notes.filter(
      (note) =>
        note.status === "PROPOSED" ||
        note.status === "OPEN" ||
        note.status === "RESPONDED",
    ).length;
    if (
      control.reviewLeft === "DECIDE" ||
      control.reviewLeft === "ADDRESS" ||
      control.reviewLeft === "CLEAR"
    ) {
      add({
        key: `review-${review.id}-${notes}-${control.reviewLeft}`,
        title:
          control.reviewLeft === "DECIDE"
            ? `Decide the reviewer's ${plural(notes, "note")}`
            : control.reviewLeft === "ADDRESS"
              ? `Address the reviewer's ${plural(notes, "note")}`
              : "Clear the reviewer's notes",
        detail:
          "The independent reviewer raised points on the testing or the workpaper.",
        tab: "review",
        anchor: STEP.review,
      });
    } else if (control.reviewLeft === "SIGN") {
      add({
        key: `review-sign-${review.id}`,
        title: "Sign off the review",
        detail:
          "All review notes are cleared. Signing off concludes the review of this control.",
        tab: "review",
        anchor: STEP.review,
        urgent: true,
      });
    }
  }
  // The evidence: each record that needs this person, so each opens the right one.
  const evidence = (input.evidence ?? []).filter((item) => item.mine);
  for (const item of evidence.slice(0, 5)) {
    add({
      key: item.key,
      title: item.title,
      detail: item.detail,
      tab: "evidence",
      anchor: "",
      target: item.target,
      urgent: item.kind === "approve" || item.kind === "revise",
    });
  }
  if (evidence.length > 5) {
    add({
      key: `evidence-more-${evidence.length}`,
      title: `${evidence.length - 5} further evidence items`,
      detail: "Each is listed with its request on the Evidence tab.",
      tab: "evidence",
      anchor: "",
      target: { view: "requests" },
    });
  }
  if (
    input.evidence === undefined &&
    actions.length === 0 &&
    control.waitingOn === "TEAM" &&
    control.nextStep !== ""
  ) {
    const owner = control.ownerName || "the control owner";
    add({
      key: `next-${control.nextStep}-${drafted.length}-${toApprove.length}`,
      title:
        drafted.length > 0
          ? `Review the ${plural(drafted.length, "drafted evidence request")}`
          : toApprove.length > 0
            ? `Approve the ${plural(toApprove.length, "evidence request")} before it goes out`
            : control.nextStep,
      detail:
        drafted.length > 0
          ? `The request asks ${owner} for the evidence this control requires. Nothing is sent until it is approved.`
          : toApprove.length > 0
            ? `Once approved, it is sent to ${owner}; reminders follow the engagement's schedule.`
            : "This is the next step on the control.",
      tab: "evidence",
      anchor: "",
      target: { view: "requests" },
    });
  }

  // What waits on someone else.
  if (control.waitingOn === "OWNER") {
    waiting.push(
      `Awaiting evidence from ${control.ownerName || "the control owner"}: ${control.evidenceReceived} of ${control.evidenceRequests} requests received. Reminders follow the engagement's schedule.`,
    );
  } else if (control.waitingOn === "AGENT" && control.nextStep !== "") {
    waiting.push(`${control.nextStep}: in progress.`);
  }
  if (
    context?.readiness?.state === "EVIDENCE_PENDING" &&
    control.waitingOn !== "OWNER"
  ) {
    waiting.push(
      "The control is defined. Testing begins when its evidence is received.",
    );
  }

  const ordered = [
    ...actions.filter((item) => item.urgent),
    ...actions.filter((item) => !item.urgent),
  ];
  const headline =
    ordered.length > 0
      ? `${control.controlRef}: ${plural(ordered.length, "item")} require${ordered.length === 1 ? "s" : ""} your attention.`
      : `No action is required on ${control.controlRef} at this time.`;
  return {
    agent: agentFor(input.tasks),
    headline,
    done,
    actions: ordered,
    waiting,
    signature: ordered.map((item) => item.key).join("|"),
  };
}
