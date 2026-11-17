/**
 * What every step's panel says around its own work (product owner, 8 November 2026: each
 * panel decision-first). What the step needs from the person now, what it is based on, and
 * the step that follows, all read from the workflow, so a panel never disagrees with its node.
 */

import {
  STEPS,
  type StepKey,
  type Tone,
  type WorkflowInput,
  type WorkflowStep,
  workflowLayout,
} from "./control-workflow-model.ts";
import {
  CONCLUSION_WORDS,
  type DesignVerdict,
  EXCEPTION_TO_RESOLVE,
  exceptionHolds,
  standingWords,
} from "./design-conclusion-model.ts";
import { requestsNeed } from "./design-requests-model.ts";
import { STEP_DRAFT, STEP_RETURNED } from "./review-request-model.ts";

export type PanelNeed = {
  /** act: a person decides; agent: an agent is working; wait: an earlier step holds it;
   * flag: recorded out of order; done; skipped: not performed. */
  kind: "act" | "agent" | "wait" | "done" | "skipped" | "flag";
  title: string;
  detail: string;
  /** The one action: a part of this panel, or the step it waits on. */
  action?: { label: string; anchor?: string; step?: StepKey };
};

export type PanelLink = {
  key: StepKey;
  number: number;
  title: string;
  status: string;
  tone: Tone;
};

export type PanelFrame = {
  key: StepKey;
  title: string;
  need: PanelNeed;
  basedOn: PanelLink[];
  /** The steps that follow; where a step decides, each with the outcome it follows on. */
  next: Array<PanelLink & { when: string }>;
};

/** What a person does on each step, as the bar's title when the step is theirs. */
const ACTION: Record<StepKey, { title: string; label: string; why: string }> = {
  setup: {
    title: "Complete the control's details",
    label: "Edit details",
    why: "The methodology needs these details before the control is planned.",
  },
  understanding: {
    title: "Answer the agent's questions",
    label: "Answer",
    why: "Each question has a proposed answer from the records; confirm or change it.",
  },
  attributes: {
    title: "Decide the attributes",
    label: "Decide the attributes",
    why: "The D&I evidence is requested against them, and each OE sample is tested against them. The standard's come approved; decide what the agent proposed from the understanding.",
  },
  designevidence: {
    title: "Decide the D&I evidence",
    label: "Review evidence",
    why: "Each file is read on arrival; accept it, or ask for what is missing.",
  },
  // One D&I step (docs/design-workpaper.md, section 3.8): prepared, sent for review and
  // signed off in section 6.
  designassessment: {
    title: "Prepare the design workpaper",
    label: "Review the assessment",
    why: "The walkthrough and each design attribute are drafted; review them, record the conclusion, then sign and send it for review in section 6. A reviewer who did not prepare it signs it off there, and an effective sign-off clears OE.",
  },
  testdesign: {
    title: "Approve scope and sampling",
    label: "Review scope and sampling",
    why: "The phases, the sample and the periods OE is tested over. The D&I evidence does not wait for them.",
  },
  oeevidence: {
    title: "Decide the OE evidence",
    label: "Review evidence",
    why: "Each file is read on arrival; accept the population before samples are drawn.",
  },
  oetesting: {
    title: "Decide the test results",
    label: "Review results",
    why: "Every result cites its evidence; decide the ones flagged for a person, then sign off.",
  },
  conclusion: {
    title: "Rate the deficiencies and confirm the conclusion",
    label: "Review the conclusion",
    why: "The conclusion is proposed from the records, with a severity suggested for each deficiency.",
  },
  review: {
    title: "Review and sign off the control",
    label: "Open the review",
    why: "A reviewer who did not prepare the work decides each note and signs the control off.",
  },
  workpaper: {
    title: "Finalise the workpaper",
    label: "Review the workpaper",
    why: "The design and testing workpapers make up the control's workpaper.",
  },
};

/** D&I Assessment once its workpaper is prepared: the reviewer's sign-off in section 6
 * (section 3.8; before, the "D&I Conclusion and Review" step's). */
const DESIGN_SIGN_OFF = {
  title: "Sign off the D&I conclusion",
  label: "Review and sign off",
  why: "A reviewer who did not prepare the design workpaper signs it off in section 6, or returns it to the preparer. An effective sign-off clears OE.",
};

const link = (step: WorkflowStep): PanelLink => ({
  key: step.key,
  number: step.number,
  title: step.title,
  status: step.status,
  tone: step.tone,
});

const OUT_OF_ORDER = ["Started before D&I sign-off", "Not relied on"];

/** The status that says the agents are updating a step a person decides (the attributes,
 * while the D&I release holds them for the agents). Not "Plan being drafted": the team
 * drafts Scope & Sampling, and approving it stays the next step. */
const AGENTS_AT_WORK = /^Being updated$/;

function needOf(step: WorkflowStep, steps: readonly WorkflowStep[]): PanelNeed {
  if (step.tone === "skipped") {
    return {
      kind: "skipped",
      title: "Not performed",
      detail:
        "The design is signed off as not effective, so operating effectiveness is not tested. The control concludes on the design deficiency.",
    };
  }
  if (step.status === OUT_OF_ORDER[0]) {
    return {
      kind: "flag",
      title: "Recorded before the D&I sign-off",
      detail:
        "This work is kept as recorded, and it is relied on only once a reviewer signs off the design as effective.",
      action: { label: "Open the D&I sign-off", step: "designassessment" },
    };
  }
  if (step.status === OUT_OF_ORDER[1]) {
    return {
      kind: "flag",
      title: "Not relied on",
      detail:
        "The design is signed off as not effective, so this work is kept on record but not relied on.",
    };
  }
  if (step.status.startsWith("Waiting on")) {
    // The step that holds it: back along the edges, past steps that are themselves only
    // waiting, to the first one with work in hand.
    const { edges } = workflowLayout();
    const before = (key: StepKey) =>
      edges
        .filter((edge) => edge.target === key)
        .map((edge) => steps.find((item) => item.key === edge.source))
        .filter((item): item is WorkflowStep => item !== undefined)
        .find((item) => item.tone !== "done" && item.tone !== "skipped");
    let into = before(step.key);
    for (
      let hop = 0;
      into?.status.startsWith("Waiting on") && hop < STEPS.length;
      hop += 1
    ) {
      into = before(into.key) ?? into;
      if (!into.status.startsWith("Waiting on")) {
        break;
      }
    }
    return {
      kind: "wait",
      title: step.status,
      detail:
        into === undefined
          ? "It starts once the step before it is done."
          : `It starts once ${into.title} is done, which stands at: ${into.status}.`,
      ...(into !== undefined
        ? { action: { label: `Open ${into.title}`, step: into.key } }
        : {}),
    };
  }
  // D&I Evidence once its requests are drafted (product owner, 12 November 2026: one
  // list): the list's own decision line, with no button in it. The list holds the one
  // primary action (Approve and send), and each row its own (Upload, Accept), so the
  // panel never offers a "Review evidence" jump to what is already under it.
  if (step.key === "designevidence" && step.need !== undefined) {
    return step.need;
  }
  // D&I Evidence before its requests are drafted (12 November 2026): the panel says what
  // its one list needs, in the list's words: requests to accept, an attribute no request
  // addresses, the planner at work, or the requests being drafted. No Release button.
  const requests =
    step.key === "designevidence"
      ? requestsNeed(step.status, step.tone, step.note ?? "")
      : null;
  if (requests !== null) {
    return requests;
  }
  if (step.agent) {
    return {
      kind: "agent",
      title: `${step.status}`,
      detail:
        "The agent is preparing this step. Its work shows here for a decision when it is done.",
    };
  }
  // An exception a person recorded holds the D&I sign-off (docs/evidence-assurance.md,
  // section 10.15, item 5): the conclusion waits on it, and never calls for a sign-off
  // the server refuses; the assessment says what resolves it.
  if (step.status === EXCEPTION_TO_RESOLVE) {
    // The D&I sign-off is in D&I Assessment (section 3.8): the one step says what resolves
    // it.
    return {
      kind: "act",
      title: "Resolve the recorded exception",
      detail:
        "An exception is recorded on an attribute, and the D&I conclusion cannot be signed off over it. Log a design deficiency for the attribute, or change its tickmark in D&I Evidence with a reason.",
      action: { label: "Open D&I Evidence", step: "designevidence" },
    };
  }
  if (step.tone === "done") {
    return { kind: "done", title: step.status, detail: "" };
  }
  // A step a person decides, while the agents update or draft it (product owner, 14 November
  // 2026: "if the attributes are still being updated, they should not be accepted"): the
  // agents' line, never a call to decide what is about to change.
  if (step.tone === "active" && AGENTS_AT_WORK.test(step.status)) {
    return {
      kind: "agent",
      title: step.status,
      detail:
        "The agents are updating this step from the latest answers. It is ready to decide once they finish.",
    };
  }
  // D&I Assessment carries the reviewer's sign-off (docs/design-workpaper.md, section
  // 3.8): once the workpaper is prepared, what it needs is that sign-off, in section 6.
  const action =
    step.key === "designassessment" &&
    step.status !== STEP_DRAFT &&
    step.status !== STEP_RETURNED
      ? DESIGN_SIGN_OFF
      : ACTION[step.key];
  return {
    kind: "act",
    title: action.title,
    detail: action.why,
    // Scope & Sampling's own plan review holds its one primary action (Approve plan): the
    // decision row only says what is needed, so the step never shows two (11 November 2026).
    ...(step.key === "testdesign"
      ? {}
      : { action: { label: action.label, anchor: "stp-work" } }),
  };
}

/** The panel's frame for a step: its need, what it is based on, and what follows. */
export function panelFrame(
  key: StepKey,
  steps: readonly WorkflowStep[],
  verdict: DesignVerdict | null,
): PanelFrame {
  const step = steps.find((item) => item.key === key);
  const meta = STEPS.find((item) => item.key === key);
  if (step === undefined || meta === undefined) {
    throw new Error(`no step ${key}`);
  }
  const { edges } = workflowLayout();
  const find = (target: StepKey) =>
    steps.find((item) => item.key === target) as WorkflowStep;
  const basedOn = edges
    .filter((edge) => edge.target === key)
    .map((edge) => link(find(edge.source)));
  const next = edges
    .filter((edge) => edge.source === key)
    // Where the D&I conclusion decides, the signed verdict picks the way on.
    .filter(
      (edge) =>
        edge.label === undefined ||
        verdict === null ||
        (verdict === "EFFECTIVE") === (edge.label === "Effective"),
    )
    .map((edge) => ({
      ...link(find(edge.target)),
      when:
        edge.label === undefined
          ? ""
          : verdict === null
            ? `If ${edge.label.toLowerCase()}`
            : edge.label,
    }));
  return {
    key,
    title: step.title,
    need: needOf(step, steps),
    basedOn,
    next,
  };
}

/** The title over each step's own work. */
export const PREPARED_TITLE: Record<StepKey, string> = {
  setup: "The control as recorded",
  understanding: "What is understood",
  attributes: "The control's attributes",
  designevidence: "D&I evidence",
  designassessment: "The design assessment",
  testdesign: "Scope and sampling",
  oeevidence: "OE evidence",
  oetesting: "OE testing",
  conclusion: "The control's conclusion",
  review: "The independent review",
  workpaper: "The workpaper",
};

const count = (n: number, word: string, many = `${word}s`) =>
  `${n} ${n === 1 ? word : many}`;

const GONE = ["CANCELLED", "REMOVED", "NOT_APPLICABLE"];
const TO_DECIDE = ["PARTIALLY_RECEIVED", "RECEIVED", "UNDER_REVIEW"];
const STALLED = ["INSUFFICIENT", "FOLLOW_UP_REQUIRED", "OVERDUE"];

/** What the agent did on a step and what it found, from the records the workflow reads:
 * the agent's strip in the step's panel. Never an instruction, and never a claim the
 * records do not show. */
export function agentNote(
  step: WorkflowStep,
  input: WorkflowInput,
): { did: string; found: string[] } {
  const evidence = (phases: readonly string[]) => {
    const live = input.requirements.filter(
      (item) => phases.includes(item.phase) && !GONE.includes(item.state),
    );
    const accepted = live.filter((item) => item.state === "ACCEPTED").length;
    const review = live.filter((item) => TO_DECIDE.includes(item.state)).length;
    const stalled = live.filter((item) => STALLED.includes(item.state)).length;
    return [
      live.length === 0
        ? "No evidence items are planned yet."
        : `${count(live.length, "evidence item")} planned, ${accepted} accepted.`,
      ...(review > 0
        ? [`${count(review, "item")} received and read, to decide.`]
        : []),
      ...(stalled > 0
        ? [`${count(stalled, "item")} insufficient or overdue.`]
        : []),
    ];
  };
  // Before its requests are drafted nothing is requested, so no evidence is accepted yet
  // either: the requests are drafted once a person has accepted the list.
  const planned = (phases: readonly string[]) => {
    const live = input.requirements.filter(
      (item) => phases.includes(item.phase) && !GONE.includes(item.state),
    ).length;
    return live === 0
      ? "No requests are planned yet."
      : `${count(live, "request")} planned, drafted once the list is accepted.`;
  };
  const paper = (which: WorkflowInput["designPaper"], name: string) =>
    which === null
      ? `The ${name} is not started.`
      : which.drafting
        ? `The ${name} is being drafted.`
        : which.status === "PREPARED"
          ? `The ${name} is prepared.`
          : `The ${name} is drafted, ready for a person to prepare.`;
  switch (step.key) {
    case "setup": {
      const missing = input.details
        .filter((item) => !item.filled)
        .map((item) => item.label.toLowerCase());
      return {
        did: "Read the control from the organization's RCM.",
        found:
          missing.length === 0
            ? ["Every detail the methodology needs is recorded."]
            : [`Not in the RCM: ${missing.join(", ")}.`],
      };
    }
    case "understanding":
      return {
        did: "Drafted the understanding from the RCM, prior work and the documents on file, with an answer proposed for each question.",
        found: [`${step.status}.`],
      };
    case "designevidence":
      // Once its requests are drafted the evidence list words the agent's line itself,
      // for the state the rows are in (design-evidence-model).
      if (step.need !== undefined && (input.designEvidence ?? null) !== null) {
        return input.designEvidence?.agent ?? { did: "", found: [] };
      }
      // Before its requests are drafted: while the phase is unreleased, and while the
      // requests list is still the step's work (being drafted).
      return input.designRelease?.step === "READY" ||
        input.designRelease?.step === "WAITING" ||
        (input.designRequests ?? null) !== null
        ? {
            did: "Planned the D&I requests from the control's understanding, each against the attributes it addresses.",
            found: [planned(["DESIGN"])],
          }
        : {
            did: "Drafted the D&I evidence requests and read each file that came back.",
            found: evidence(["DESIGN"]),
          };
    case "designassessment": {
      // One D&I step (section 3.8): the workpaper, then the conclusion and its sign-off.
      const drafted = paper(input.designPaper, "design workpaper");
      const said = conclusionNote(input);
      return {
        did: `Drafted the design workpaper: the walkthrough of one instance and each design attribute. ${said.did}`,
        found: [drafted, ...said.found],
      };
    }
    case "attributes":
      return {
        did: "Started from the standard's attributes, proposed what the understanding changes, and tailored each one's pass/fail criteria to this control.",
        found: [
          `${count(input.attributes.approved, "attribute")} approved${input.attributes.proposed > 0 ? `, ${input.attributes.proposed} proposed to decide` : ""}.`,
          ...((input.attributes.questions ?? 0) > 0
            ? [
                `${count(input.attributes.questions ?? 0, "question")} on them open.`,
              ]
            : []),
          ...((input.attributes.untailored ?? 0) > 0
            ? [
                `${count(input.attributes.untailored ?? 0, "attribute")} without pass/fail criteria tailored to this control.`,
              ]
            : input.attributes.approved > 0
              ? ["Each approved attribute has tailored criteria a person owns."]
              : []),
        ],
      };
    case "testdesign":
      return {
        did: "Proposed the phases, the sample and the periods from the understanding and the firm's methodology.",
        found: [
          input.plan.approved
            ? "The test plan is approved."
            : input.plan.exists
              ? "The test plan awaits approval."
              : "The test plan is not drafted yet.",
        ],
      };
    case "oeevidence":
      return {
        did: "Drafts the OE requests, population first and then samples, once D&I is signed off effective, and reads each file that comes back.",
        found: evidence(["INTERIM", "ROLLFORWARD"]),
      };
    case "oetesting":
      return {
        did: "Tests each sample against the approved attributes, citing the evidence for every result.",
        found:
          input.sheet === null
            ? ["No samples are drawn yet."]
            : [
                `${input.sheet.tested} of ${input.sheet.items} tested.`,
                input.sheet.exceptions > 0
                  ? `${count(input.sheet.exceptions, "exception")} found.`
                  : "No exceptions found.",
              ],
      };
    case "conclusion": {
      const open = input.findings.filter(
        (item) => item.status !== "CLOSED",
      ).length;
      return {
        did: "Proposed the conclusion from the D&I verdict, the OE results and the deficiencies, with a severity suggested for each.",
        found: [
          open === 0
            ? "No deficiency stands against the control."
            : `${count(open, "deficiency", "deficiencies")} standing.`,
        ],
      };
    }
    case "review":
      return {
        did: "The reviewer agent re-performs the testing against the evidence and proposes review notes.",
        found: [`${step.status}.`],
      };
    case "workpaper":
      return {
        did: "Assembles the workpaper from the design and testing workpapers, with the evidence each cites.",
        found: [
          paper(input.designPaper, "design workpaper"),
          paper(input.effectivenessPaper, "testing workpaper"),
        ],
      };
  }
}

/** What the agent says of the D&I conclusion, under D&I Assessment (section 3.8: the
 * conclusion and its sign-off are in that step, section 6). */
function conclusionNote(input: WorkflowInput): {
  did: string;
  found: string[];
} {
  const design = input.findings.filter(
    (item) =>
      item.type === "DESIGN" &&
      item.status !== "REMEDIATED" &&
      item.status !== "CLOSED",
  );
  const proposed = input.designConclusion?.proposed ?? null;
  // An exception a person recorded holds the sign-off: said in place of a verdict
  // "proposed" that the server would refuse to sign.
  const held =
    input.designConclusion == null
      ? 0
      : exceptionHolds({
          status: input.designConclusion.status,
          blocking: input.designConclusion.blocking ?? [],
        }).length;
  const holdLine = `Not ready to sign: ${held === 1 ? "an exception is" : `${held} exceptions are`} recorded with no design deficiency logged.`;
  const deficiencyLines =
    design.length > 0
      ? [
          `Design deficiencies: ${design.map((item) => item.reference).join(", ")}.`,
        ]
      : [];
  // Section 3.6: on a body that names the conclusion, the strip says the one that
  // stands (signed, or the preparer's) and the agent's proposal as a proposal: never
  // the records' two-value verdict as the conclusion (independent review, 15
  // November 2026).
  const named = input.designConclusion?.named;
  if (named !== undefined) {
    const signedOff = input.designConclusion?.status === "SIGNED_OFF";
    return {
      did: "Proposed the D&I conclusion from the records; the preparer records it and sends the workpaper for review in section 6, and a reviewer signs it off there.",
      found: [
        ...(held > 0 ? [holdLine] : []),
        named.standing === null
          ? "No conclusion recorded yet: the preparer records it in section 6 of D&I Assessment."
          : `${signedOff ? "Signed off" : "Recorded by the preparer"}: ${standingWords(named.standing)}.`,
        ...(named.proposed !== null && !signedOff
          ? [`Proposed by the agent: ${CONCLUSION_WORDS[named.proposed]}.`]
          : []),
        ...deficiencyLines,
      ],
    };
  }
  return {
    did: "Proposed the D&I verdict from the prepared design workpaper and the design deficiencies.",
    found: [
      held > 0
        ? holdLine
        : proposed === null
          ? "No verdict yet: the design workpaper is not prepared."
          : `Proposed: ${proposed === "EFFECTIVE" ? "effective" : "not effective"}.`,
      ...(design.length > 0
        ? [
            `Design deficiencies: ${design.map((item) => item.reference).join(", ")}.`,
          ]
        : []),
    ],
  };
}
