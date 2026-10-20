import type { ControlJourney, Step } from "./control-journey-model.ts";
import type { ActivityItem } from "./control-workspace-model.ts";
import type { AgentRuns, Deficiency } from "./engagement-model.ts";
import type { EvidencePlan } from "./evidence-plan-model.ts";
import { type Automation, executionOf } from "./execution-model.ts";
import type { ImpactAssessment } from "./impact-model.ts";
import type { ControlReview } from "./review-model.ts";
import type { TestSheet } from "./sheet-model.ts";

/**
 * The one agent block of the control workspace (Milestone 1c, tightened in 1d): what the
 * agents actually did on the step, what they propose, why, which records support it,
 * and whether a person's decision is pending. Everything comes from the records the
 * workspace already loads. A proposal is always worded as a proposal; an execution state
 * comes from the run record and the automation status (execution-model), never from the
 * sheet's workflow state; when the records give no basis the block says so instead of
 * recommending. The default view is short: the long reason and the references sit
 * behind "Details".
 */
export type AgentRef = { label: string; href: string | null };

export type AgentSays = {
  /** What the agents did, as facts from the records, newest first. */
  did: string[];
  /** The agents' proposal, worded as a proposal; null when they propose nothing. */
  recommends: string | null;
  /** Why, in plain English and at most a sentence or two; "" when nothing was recorded. */
  because: string;
  /** The full recorded reason when `because` had to be shortened; "" otherwise. */
  becauseFull: string;
  /** The records the proposal rests on: attributes, evidence, assessments, notes. */
  supports: AgentRef[];
  /** The decision a person still has to make, and whose it is; null when none. */
  decision: string | null;
  /** When the records give no basis for a recommendation, why. */
  insufficient: string | null;
  /** The agent's execution state on this step, when a run record exists. */
  execution: { label: string; detail: string } | null;
};

export type AgentInput = {
  step: Step;
  journey: ControlJourney | null;
  controlRef: string;
  sheet: TestSheet | null;
  review: ControlReview | null;
  impact: ImpactAssessment[];
  plan: EvidencePlan | null;
  activity: ActivityItem[];
  deficiencies: Deficiency[];
  hrefs: Record<Step, string>;
  automation: Automation | null;
  agents?: AgentRuns | null;
};

const RESULT_WORDS: Record<string, string> = {
  EFFECTIVE: "effective",
  NOT_EFFECTIVE: "not effective",
  INCOMPLETE: "incomplete",
};

const SEVERITY_WORDS: Record<string, string> = {
  MUST_FIX: "must fix",
  SHOULD_FIX: "should fix",
  CONSIDER: "consider",
};

/** How much of a recorded reason the default view shows. */
export const BECAUSE_LENGTH = 180;

const when = (iso: string | null): string => {
  if (iso === null || iso === "") {
    return "";
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : ` on ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
};

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** A reason cut at a sentence end near the limit, with the whole kept aside. */
export function shorten(text: string): { short: string; full: string } {
  const trimmed = text.trim();
  if (trimmed.length <= BECAUSE_LENGTH) {
    return { short: trimmed, full: "" };
  }
  const head = trimmed.slice(0, BECAUSE_LENGTH);
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("; "));
  const short =
    stop > 60
      ? `${head.slice(0, stop + 1)}`
      : `${head.replace(/\s+\S*$/, "")}…`;
  return { short, full: trimmed };
}

/** The sheet's latest results, one per item and attribute: the person's decision when
 * there is one, else the agent's proposal. */
function results(sheet: TestSheet): {
  tested: number;
  exceptions: number;
  unable: number;
  review: number;
  files: string[];
  citations: number;
  exceptionCodes: string[];
  pendingReview: number;
} {
  const files = new Set<string>();
  const codes = new Set<string>();
  let citations = 0;
  let exceptions = 0;
  let unable = 0;
  let review = 0;
  let pendingReview = 0;
  for (const item of sheet.items) {
    for (const cell of item.cells) {
      const result = cell.final ?? cell.proposed;
      if (result === "EXCEPTION") {
        exceptions += 1;
        codes.add(`A${cell.index + 1}`);
      } else if (result === "UNABLE") {
        unable += 1;
      } else if (result === "REVIEW") {
        review += 1;
        if (cell.final === null) {
          pendingReview += 1;
        }
      }
      for (const citation of cell.citations) {
        citations += 1;
        if (citation.fileName !== "") {
          files.add(citation.fileName);
        }
      }
    }
  }
  return {
    tested: sheet.counts.tested,
    exceptions,
    unable,
    review,
    files: [...files],
    citations,
    exceptionCodes: [...codes].sort(),
    pendingReview,
  };
}

const empty = (): AgentSays => ({
  did: [],
  recommends: null,
  because: "",
  becauseFull: "",
  supports: [],
  decision: null,
  insufficient: null,
  execution: null,
});

function withReason(says: AgentSays, reason: string): void {
  const cut = shorten(reason);
  says.because = cut.short;
  says.becauseFull = cut.full;
}

function agentDid(activity: ActivityItem[], categories: string[]): string[] {
  return activity
    .filter((item) => item.by === "agent" && categories.includes(item.category))
    .slice(0, 3)
    .map(
      (item) =>
        `${item.title}${item.detail !== "" ? `: ${item.detail}` : ""}${when(item.at)}`,
    );
}

function planStep(input: AgentInput): AgentSays {
  const says = empty();
  const plan = input.plan;
  const pending = input.impact.find((item) => item.status === "PENDING");
  if (plan !== null && plan.runs.length > 0) {
    const run = plan.runs[plan.runs.length - 1];
    if (run !== undefined) {
      says.did.push(
        `Drafted the test plan from ${run.source.toLowerCase()}${when(run.createdAt)}: ${plural(run.added, "requirement")} added, ${run.updated} updated, ${run.flagged} flagged for review`,
      );
    }
  }
  if (pending !== undefined) {
    says.did.push(
      `Compared plan revision ${pending.fromRevision ?? "(not recorded)"} with revision ${pending.toRevision} item by item: ${plural(pending.recommendation.changes.length, "change")} found`,
    );
    const advice = pending.recommendation;
    if (advice.decision === null) {
      says.insufficient =
        advice.rationale !== ""
          ? `No recommendation: ${advice.rationale}`
          : "No recommendation: the revisions could not be compared from the records.";
    } else {
      says.recommends =
        advice.decision === "VALID"
          ? "Proposes that the signed-off results stand under the revised plan (VALID)"
          : "Proposes that the testing is re-performed under the revised plan (REPERFORM)";
      withReason(says, advice.rationale);
      for (const change of advice.changes.slice(0, 4)) {
        says.supports.push({
          label: `${change.section.toLowerCase()} ${change.code} ${change.change.toLowerCase()}`,
          href: input.hrefs.PLAN ?? null,
        });
      }
    }
    says.supports.push({
      label: `Impact assessment on the ${pending.roundKind === null ? "interim" : pending.roundKind.toLowerCase()} results`,
      href: input.hrefs.PLAN ?? null,
    });
    says.decision = pending.viewerCanDecide
      ? "Your decision as the independent reviewer: the agent never decides."
      : "The independent reviewer decides; the person who signed the testing may not.";
    return says;
  }
  if (plan !== null && plan.status === "PROPOSED") {
    const phases = plan.phases.filter((phase) => phase.requirements.length > 0);
    const procedures = phases.reduce((n, p) => n + p.procedures.length, 0);
    const items = phases.reduce((n, p) => n + p.requirements.length, 0);
    says.recommends = "Proposes this test plan for approval";
    // Plain English, not the plan's summary (which restates the control): what the plan
    // is built from and how much it asks for.
    withReason(
      says,
      `it was built ${plan.source !== null && plan.source !== "" ? `from ${plan.source.toLowerCase()} ` : ""}for ${plan.controlType !== "" ? `a ${plan.controlType.toLowerCase()} control` : "this control"}: ${plural(procedures, "procedure")} and ${plural(items, "evidence item")} across ${plural(phases.length, "phase")}${plan.assumptions.length > 0 ? `, with ${plural(plan.assumptions.length, "assumption")} stated` : ""}.`,
    );
    for (const phase of phases.slice(0, 3)) {
      says.supports.push({
        label: `${phase.label}: ${plural(phase.procedures.length, "procedure")}, ${plural(phase.requirements.length, "evidence item")}`,
        href: input.hrefs.PLAN ?? null,
      });
    }
    if (plan.missingInformation.length > 0) {
      says.insufficient = `${plural(plan.missingInformation.length, "piece of information", "pieces of information")} the plan still needs: ${plan.missingInformation.slice(0, 2).join("; ")}`;
    }
    says.decision =
      "Approval of the test plan by a person; nothing is requested before.";
    return says;
  }
  if (says.did.length === 0) {
    says.did.push(...agentDid(input.activity, ["planning", "design"]));
  }
  return says;
}

function requestStep(input: AgentInput): AgentSays {
  const says = empty();
  const plan = input.plan;
  const phase =
    plan?.phases.find((item) => item.phase === input.journey?.stepPhase) ??
    null;
  if (phase !== null) {
    const files = phase.requirements.flatMap((item) => item.files);
    const read = files.filter((file) => file.readStatus === "READ");
    if (read.length > 0) {
      says.did.push(
        `Read ${plural(read.length, "evidence file")} for ${phase.label.toLowerCase()} (${read.filter((f) => f.readBy === "MODEL").length} by the model, ${read.filter((f) => f.readBy === "RULES").length} by rules)`,
      );
    }
    const flagged = phase.requirements.filter((item) => item.needsReview);
    if (flagged.length > 0) {
      says.recommends = `Flags ${plural(flagged.length, "evidence requirement")} for a person's review`;
      withReason(
        says,
        flagged
          .map((item) => item.coverageNote || item.sufficiencyNote)
          .filter((note) => note !== "")
          .slice(0, 2)
          .join(" "),
      );
      for (const item of flagged.slice(0, 4)) {
        says.supports.push({
          label: item.title,
          href: input.hrefs.REQUEST ?? null,
        });
      }
    }
  }
  const agents = input.agents ?? null;
  if (agents !== null && (agents.reading > 0 || agents.readFailed > 0)) {
    const run = executionOf({
      agent: "reader",
      run: agents.reading > 0 ? "QUEUED" : "IDLE",
      automation: input.automation,
      failed: agents.readFailed > 0,
    });
    says.execution = { label: run.label, detail: run.detail };
  }
  says.did.push(...agentDid(input.activity, ["evidence"]));
  says.decision =
    "Approving and sending an evidence request is a person's action; drafts go nowhere until then.";
  return says;
}

function testStep(input: AgentInput): AgentSays {
  const says = empty();
  const sheet = input.sheet;
  if (sheet === null) {
    says.insufficient = "No test sheet yet: nothing has been tested.";
    return says;
  }
  const found = results(sheet);
  const stopped = !sheet.running && sheet.runNote !== "";
  const run = executionOf({
    agent: "tester",
    run: sheet.runState,
    automation: input.automation,
    done: sheet.counts.items > 0 && found.tested === sheet.counts.items,
    failed: stopped,
  });
  if (sheet.status === "OPEN") {
    says.execution = stopped
      ? {
          label: run.label,
          detail: `${sheet.runNote} Results already recorded stand; exceptions among them are testing findings, not this.`,
        }
      : { label: run.label, detail: run.detail };
  }
  if (found.tested > 0) {
    says.did.push(
      `Tested ${found.tested} of ${plural(sheet.counts.items, "sample")} against ${plural(sheet.attributes.length, "attribute")}, citing ${plural(found.citations, "passage")} in ${plural(found.files.length, "evidence file")}`,
    );
  } else if (run.state !== "RUNNING") {
    says.insufficient = "No results yet: nothing to propose.";
    says.decision =
      run.state === "UNAVAILABLE"
        ? "No agent can run here; a person tests the samples or configures a worker."
        : null;
    return says;
  }
  if (sheet.status === "OPEN" && found.tested > 0) {
    const word = RESULT_WORDS[sheet.proposedConclusion] ?? "incomplete";
    says.recommends = `Proposes a conclusion of ${word}`;
    withReason(
      says,
      `${plural(found.exceptions, "exception")}, ${found.unable} with insufficient evidence, ${found.review} needing a person's review, across ${found.tested} tested samples.`,
    );
  } else if (sheet.status === "SIGNED_OFF") {
    says.did.push(
      `A person signed the testing off${sheet.signedBy !== null ? ` (${sheet.signedBy})` : ""}${when(sheet.signedAt)}; the agent's results stand as recorded`,
    );
  }
  for (const code of found.exceptionCodes.slice(0, 4)) {
    says.supports.push({
      label: `Attribute ${code}: exception`,
      href: input.hrefs.TEST ?? null,
    });
  }
  for (const file of found.files.slice(0, 3)) {
    says.supports.push({ label: file, href: input.hrefs.TEST ?? null });
  }
  if (found.citations === 0 && found.tested > 0) {
    says.insufficient =
      "The results cite no evidence passages; treat them as unsupported until a person checks them.";
  }
  if (sheet.status === "OPEN") {
    says.decision =
      found.pendingReview > 0
        ? `${plural(found.pendingReview, "result")} need${found.pendingReview === 1 ? "s" : ""} a person's decision; then a person signs the testing off.`
        : "A person decides the open results and signs the testing off.";
  }
  return says;
}

function concludeStep(input: AgentInput): AgentSays {
  const says = empty();
  const sheet = input.sheet;
  says.did.push(...agentDid(input.activity, ["findings", "design"]));
  const agents = input.agents ?? null;
  if (agents !== null && agents.drafting !== "IDLE") {
    const run = executionOf({
      agent: "drafter",
      run: agents.drafting,
      automation: input.automation,
      failed: agents.stopped.includes("drafting"),
    });
    says.execution = { label: run.label, detail: run.detail };
  } else if (agents?.stopped.includes("drafting")) {
    const run = executionOf({
      agent: "drafter",
      run: "IDLE",
      automation: input.automation,
      failed: true,
    });
    says.execution = { label: run.label, detail: run.detail };
  }
  if (sheet?.proposal !== null && sheet?.proposal !== undefined) {
    const proposal = sheet.proposal;
    const severity =
      SEVERITY_WORDS[proposal.severity] ?? proposal.severity.toLowerCase();
    if (sheet.proposalStatus === "PROPOSED") {
      says.recommends = `Proposes a deficiency: ${proposal.title} (${severity})`;
      withReason(
        says,
        [proposal.condition, proposal.severityReason]
          .filter((text) => text !== "")
          .join(" "),
      );
      says.supports.push(
        {
          label: `Criteria: ${proposal.criteria}`,
          href: input.hrefs.TEST ?? null,
        },
        ...results(sheet).exceptionCodes.map((code) => ({
          label: `Attribute ${code}: exception`,
          href: input.hrefs.TEST ?? null,
        })),
      );
      says.decision =
        "A person logs the deficiency or dismisses it with a reason; the agent cannot.";
    } else {
      says.did.push(
        `Proposed a deficiency (${proposal.title}); a person ${sheet.proposalStatus === "LOGGED" ? "logged it" : "dismissed it"}${sheet.proposalReason !== "" ? `: ${sheet.proposalReason}` : ""}`,
      );
    }
  }
  const open = input.deficiencies.filter((item) => item.status !== "CLOSED");
  for (const item of open.slice(0, 3)) {
    says.supports.push({
      label: `${item.reference}: ${item.title}`,
      href: input.hrefs.CONCLUDE ?? null,
    });
  }
  if (
    says.recommends === null &&
    says.did.length === 0 &&
    says.execution === null
  ) {
    says.insufficient =
      "No workpaper draft or deficiency proposal on record for this step.";
  }
  return says;
}

function reviewStep(input: AgentInput): AgentSays {
  const says = empty();
  const review = input.review;
  if (review === null) {
    says.insufficient =
      "No independent review has opened: it opens when the testing is signed off and the workpaper is prepared.";
    return says;
  }
  const agentNotes = review.notes.filter((note) => note.raisedBy === "AGENT");
  if (review.status === "OPEN") {
    const run = executionOf({
      agent: "reviewer",
      run: review.reperformState,
      automation: input.automation,
      done: review.reperformedAt !== null,
      failed: (input.agents?.stopped ?? []).includes("reviewing"),
    });
    if (run.state !== "READY" || review.reperformedAt === null) {
      says.execution = { label: run.label, detail: run.detail };
    }
  }
  if (review.reperformedAt !== null) {
    says.did.push(
      `Re-performed the testing from the evidence (${review.reperformSource === "MODEL" ? "the model" : "rules only"})${when(review.reperformedAt)}; raised ${plural(agentNotes.length, "review note")}`,
    );
  }
  const proposed = agentNotes.filter((note) => note.status === "PROPOSED");
  if (proposed.length > 0) {
    const severities = proposed.reduce<Record<string, number>>((acc, note) => {
      acc[note.severity] = (acc[note.severity] ?? 0) + 1;
      return acc;
    }, {});
    says.recommends = `Proposes ${plural(proposed.length, "review note")} (${Object.entries(
      severities,
    )
      .map(([key, n]) => `${n} ${SEVERITY_WORDS[key] ?? key.toLowerCase()}`)
      .join(", ")})`;
    withReason(
      says,
      proposed
        .slice(0, 2)
        .map((note) => `#${note.number}: ${note.text}`)
        .join(" "),
    );
    for (const note of proposed.slice(0, 4)) {
      const codes = note.indexes.map((index) => `A${index + 1}`).join(", ");
      says.supports.push({
        label: `Note #${note.number}${codes !== "" ? ` on ${codes}` : ""}${note.citations.length > 0 ? `, citing ${note.citations.map((c) => c.fileName).join(", ")}` : ""}`,
        href: input.hrefs.REVIEW ?? null,
      });
    }
    if (proposed.every((note) => note.citations.length === 0)) {
      says.insufficient =
        "The notes cite no evidence passages; the reviewer weighs them on their own reading.";
    }
  }
  if (review.status === "SIGNED_OFF") {
    says.did.push(
      `The review was signed off by ${review.signedBy ?? "the reviewer"}${when(review.signedAt)}; the agent re-performed, a person concluded`,
    );
  } else {
    says.decision = review.viewerIsReviewer
      ? "You accept or dismiss each note and sign the review off; the agent cannot sign."
      : "The independent reviewer decides each note and signs off; the agent cannot sign.";
  }
  if (
    says.did.length === 0 &&
    says.recommends === null &&
    says.execution === null
  ) {
    says.insufficient =
      "The reviewer agent has not re-performed the testing yet; there is nothing to weigh.";
  }
  return says;
}

export function agentSays(input: AgentInput): AgentSays {
  switch (input.step) {
    case "PLAN":
      return planStep(input);
    case "REQUEST":
      return requestStep(input);
    case "TEST":
      return testStep(input);
    case "CONCLUDE":
      return concludeStep(input);
    default:
      return reviewStep(input);
  }
}

/** The sheet the step is about: the round's when the journey is at a roll-forward or
 * retest, else the control's own. */
export function sheetForStep(
  sheets: readonly TestSheet[],
  rounds: readonly { id: string; kind: string; sheetId: string | null }[],
  journey: ControlJourney | null,
): TestSheet | null {
  const phase = journey?.stepPhase ?? null;
  if (phase === "ROLLFORWARD" || phase === "RETEST") {
    const round = rounds.find((item) => item.kind === phase);
    const found = sheets.find(
      (sheet) => round !== undefined && sheet.id === round.sheetId,
    );
    if (found !== undefined) {
      return found;
    }
  }
  return sheets.find((sheet) => (sheet.testRoundId ?? null) === null) ?? null;
}

/** The review the step is about: the round's review when the journey is at a round with
 * one, else the control's own; without one, a round's review still open (the step's
 * work), else the latest round review on record. */
export function reviewForStep(
  reviews: readonly ControlReview[],
  journey: ControlJourney | null,
): ControlReview | null {
  const phase = journey?.stepPhase ?? null;
  if (phase === "ROLLFORWARD" || phase === "RETEST") {
    const found = reviews.find((review) => review.roundKind === phase);
    if (found !== undefined) {
      return found;
    }
  }
  return (
    reviews.find((review) => (review.testRoundId ?? null) === null) ??
    reviews.find((review) => review.status === "OPEN") ??
    reviews[reviews.length - 1] ??
    null
  );
}
