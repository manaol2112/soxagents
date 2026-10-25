/**
 * The setup agent on the New engagement page (decided by the product owner): the guided
 * tour and the agent panel, worded from the page's own data and the values entered so
 * far, and the onboarding cycle (client and scope here, then the team, then launch; the
 * systems, controls, and templates are set up in Controls after launch). No model is
 * called; the copy is the product's own, in its neutral voice.
 */

import { periodRange } from "./new-engagement-model.ts";
import { METHODOLOGIES } from "./onboarding-model.ts";

export type GuideClient = {
  id: string;
  name: string;
  /** The client's earlier engagements. */
  engagements: Array<{ id: string; name: string; periodEnd: string | null }>;
};

/** What the guide knows: the page's data and the form as it stands. */
export type GuideFacts = {
  clients: readonly GuideClient[];
  /** The client chosen: one of the firm's (its id), a new one by name, or none yet. */
  client:
    | { kind: "existing"; id: string }
    | { kind: "new"; name: string }
    | null;
  /** The earlier engagement to start from; "" for a fresh setup. */
  startFrom: string;
  name: string;
  periodEnd: string;
  leadName: string;
  /** The methodology chosen; "" when none yet. */
  methodology: string;
  scope: string;
};

export type GuideStepId =
  | "welcome"
  | "client"
  | "name"
  | "period"
  | "lead"
  | "methodology"
  | "scope"
  | "create";

export type GuideStep = {
  id: GuideStepId;
  /** The parts of the page the step points at; none for the welcome. */
  targets: readonly string[];
  title: string;
  body: string[];
  /** Whether what the step asks for is in place. */
  done: boolean;
};

const TARGETS: Record<GuideStepId, readonly string[]> = {
  welcome: [],
  client: [".client-picker > label", ".client-start"],
  name: ['label[for="create-name"]'],
  period: ['label[for="create-period"]'],
  lead: ['label[for="create-owner"]'],
  methodology: ['label[for="create-methodology"]'],
  scope: ['label[for="create-scope"]'],
  create: [".ne-actions"],
};

/** What comes after this page, as the agent says it. */
const AFTER_CREATE =
  "After it is created, the team is named and the engagement is launched. The systems, controls, and workpaper templates are set up in Controls once it runs.";

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function chosenClient(facts: GuideFacts): GuideClient | null {
  const choice = facts.client;
  return choice?.kind === "existing"
    ? (facts.clients.find((client) => client.id === choice.id) ?? null)
    : null;
}

/** The client's name as chosen or typed; "" when none yet. */
export function clientName(facts: GuideFacts): string {
  const choice = facts.client;
  if (choice === null) {
    return "";
  }
  return choice.kind === "new"
    ? choice.name.trim()
    : (chosenClient(facts)?.name ?? "");
}

function methodologyLabel(id: string): string {
  return METHODOLOGIES.find((item) => item.id === id)?.label ?? "";
}

/** The client's earlier engagement with the latest period, whatever the list order. */
function latestEarlier(client: GuideClient | null) {
  return client === null
    ? undefined
    : [...client.engagements].sort((a, b) =>
        (b.periodEnd ?? "").localeCompare(a.periodEnd ?? ""),
      )[0];
}

function clientBody(facts: GuideFacts): string[] {
  const existing = chosenClient(facts);
  const choice = facts.client;
  if (existing !== null) {
    const earlier = existing.engagements;
    if (earlier.length === 0) {
      return [
        `${existing.name}: the first engagement for this client, so the setup starts fresh.`,
      ];
    }
    const from = earlier.find((item) => item.id === facts.startFrom);
    if (from !== undefined) {
      return [
        `Starting from ${from.name}. Its scope, systems, controls, team, and templates are copied in for review; testing, evidence, and results are never copied.`,
        "The period end is proposed a year after the earlier engagement's.",
      ];
    }
    const latest = latestEarlier(existing);
    return [
      `${existing.name} has ${plural(earlier.length, "earlier engagement")}.`,
      latest === undefined
        ? ""
        : `Under Start from, ${latest.name} can be the starting point: its scope, systems, controls, team, and templates are copied in for review.`,
    ].filter((line) => line !== "");
  }
  if (choice?.kind === "new") {
    return choice.name.trim() === ""
      ? ["Enter the new client's company name."]
      : [
          `${choice.name.trim()} is added to the firm's clients when the engagement is created.`,
        ];
  }
  return facts.clients.length === 0
    ? ["Enter the client's company name. It is added to the firm's clients."]
    : [
        `Choose one of the firm's ${plural(facts.clients.length, "client")}, or add a new one.`,
        "For a client audited before, an earlier engagement can be the starting point.",
      ];
}

const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * The scope the page drafts until someone writes their own: what the engagement is, for
 * whom, and for which period, worded for the methodology chosen. The systems and controls
 * follow in Controls after launch.
 */
export function scopeDraft(input: {
  client: string;
  periodEnd: string;
  methodology: string;
}): string {
  const client =
    input.client.trim() === "" ? "the client" : input.client.trim();
  const end = /^\d{4}-\d{2}-\d{2}$/.test(input.periodEnd)
    ? new Date(`${input.periodEnd}T00:00:00Z`)
    : null;
  const period =
    end === null || Number.isNaN(end.getTime())
      ? ""
      : ` for the period ending ${LONG_DATE.format(end)}`;
  const opening =
    input.methodology === "EXTERNAL_ICFR"
      ? `Integrated audit of ${client}'s internal control over financial reporting${period}, covering the IT general controls and the business process controls.`
      : input.methodology === "MANAGEMENT_404"
        ? `Testing of ${client}'s internal control over financial reporting in support of management's SOX 404 assessment${period}, covering the IT general controls and the business process controls.`
        : input.methodology === "INTERNAL_AUDIT"
          ? `Internal audit of ${client}'s IT general controls and business process controls${period}.`
          : `SOX testing of ${client}'s IT general controls and business process controls${period}.`;
  return `${opening} The in-scope systems and controls are set up after launch.`;
}

/** What the engagement still needs before it can be created. */
export function missingForCreate(facts: GuideFacts): string[] {
  const missing: string[] = [];
  if (clientName(facts) === "") {
    missing.push("the client");
  }
  if (facts.name.trim() === "") {
    missing.push("the engagement name");
  }
  if (facts.leadName === "") {
    missing.push("the engagement lead");
  }
  if (facts.methodology === "") {
    missing.push("the methodology");
  }
  if (facts.scope.trim() === "") {
    missing.push("the scope");
  }
  return missing;
}

/** The guide's steps, worded from what is on the page now. */
export function guideSteps(facts: GuideFacts): GuideStep[] {
  const range = periodRange(facts.periodEnd);
  const missing = missingForCreate(facts);
  const name = facts.name.trim();
  const methodology = methodologyLabel(facts.methodology);
  const steps: Array<Omit<GuideStep, "targets">> = [
    {
      id: "welcome",
      title: "Set up a new engagement",
      body: [
        "This guide walks through what a new engagement needs: the client, the period, who leads it, the methodology, and the scope. It takes about two minutes.",
        AFTER_CREATE,
      ],
      done: true,
    },
    {
      id: "client",
      title: "Choose the client",
      body: clientBody(facts),
      done: clientName(facts) !== "",
    },
    {
      id: "name",
      title: "Name the engagement",
      body:
        name === ""
          ? [
              "Use the name the team and the reports will use, for example SOX FY27.",
            ]
          : [`Named ${name}. It appears to the team and on every report.`],
      done: name !== "",
    },
    {
      id: "period",
      title: "Confirm the audit period",
      body:
        range === ""
          ? [
              "Enter the last day the controls are tested through.",
              "Left blank, the planner proposes a period from the name.",
            ]
          : [`Audit period ${range}.`],
      done: true,
    },
    {
      id: "lead",
      title: "Assign the engagement lead",
      body:
        facts.leadName === ""
          ? ["Choose who leads the engagement and approves the kickoff plan."]
          : [
              `${facts.leadName} leads the engagement and approves the kickoff plan.`,
              "The rest of the team is added next.",
            ],
      done: facts.leadName !== "",
    },
    {
      id: "methodology",
      title: "Choose the methodology",
      body:
        methodology === ""
          ? [
              "How the engagement is run. Every methodology needs an independent reviewer; nobody reviews their own work.",
            ]
          : [
              `${methodology}. Every methodology needs an independent reviewer; nobody reviews their own work.`,
            ],
      done: methodology !== "",
    },
    {
      id: "scope",
      title: "Confirm the scope",
      body: [
        "What the engagement covers, in a sentence or two. A draft follows the client, the period, and the methodology until it is edited.",
      ],
      done: facts.scope.trim() !== "",
    },
    {
      id: "create",
      title: "Create the engagement",
      body:
        missing.length > 0
          ? [`Still needed: ${missing.join(", ")}.`]
          : [
              `${name !== "" ? name : "The engagement"}${clientName(facts) !== "" ? ` for ${clientName(facts)}` : ""} is ready to create.`,
              "Next: the team, then launch.",
            ],
      done: missing.length === 0,
    },
  ];
  return steps.map((step) => ({ ...step, targets: TARGETS[step.id] }));
}

/** The guide opens by itself the first time; afterwards it waits to be asked. */
export const GUIDE_SEEN_KEY = "aw.guide.new-engagement";

export type CycleState = "done" | "current" | "next" | "upcoming";

export type CycleStage = {
  id: string;
  title: string;
  detail: string;
  /** On this page, or in guided setup once the engagement exists. */
  where: "here" | "setup";
  state: CycleState;
};

/** The setup steps the cycle continues into, in their own words (onboarding-model). */
export type SetupStage = { id: string; title: string; detail: string };

/** The steps onboarding finishes with: the team, then launch (decided by the product
 * owner); systems, controls, and templates are set up in Controls after launch. */
export const ONBOARDING_SETUP_STEPS = ["team", "launch"] as const;

/**
 * The onboarding cycle, as the agent shows it on this page: the client and scope here,
 * then the team and launch. The client and scope are done once everything this page
 * needs is entered; the team is next then.
 */
export function onboardingCycle(
  facts: GuideFacts,
  setup: readonly SetupStage[],
): CycleStage[] {
  const done = missingForCreate(facts).length === 0;
  return [
    {
      id: "scope",
      title: "Client and scope",
      detail: "Client, period, lead, methodology, and scope",
      where: "here",
      state: done ? "done" : "current",
    },
    ...ONBOARDING_SETUP_STEPS.flatMap((id) =>
      setup.filter((stage) => stage.id === id),
    ).map((stage, at) => ({
      ...stage,
      where: "setup" as const,
      state: (done && at === 0 ? "next" : "upcoming") as CycleState,
    })),
  ];
}

export type AgentBrief = {
  greeting: string;
  /** What the agent says about the engagement as it stands. */
  lines: string[];
  /** An earlier engagement of the client to start from, when none is chosen yet. */
  startFrom: { id: string; name: string } | null;
  /** What follows this page. */
  after: string;
  tip: string;
};

/** A first name from a sign-in address, when it reads as a name ("avery.brooks@" gives
 * Avery); "" when any part of it is not letters, or the first part is one letter. */
export function firstNameFrom(email: string): string {
  const parts = (email.split("@")[0] ?? "")
    .split(/[._-]+/)
    .filter((part) => part !== "");
  const first = parts[0] ?? "";
  return first.length >= 2 && parts.every((part) => /^[A-Za-z]+$/.test(part))
    ? `${first.charAt(0).toUpperCase()}${first.slice(1).toLowerCase()}`
    : "";
}

/** What the agent panel says beside the form: worded from the form as it stands. */
export function agentBrief(facts: GuideFacts, firstName: string): AgentBrief {
  const client = clientName(facts);
  const existing = chosenClient(facts);
  const earlier = latestEarlier(existing);
  const from = existing?.engagements.find(
    (item) => item.id === facts.startFrom,
  );
  const methodology = methodologyLabel(facts.methodology);
  const missing = missingForCreate(facts);
  const lines =
    client === ""
      ? ["Choose the client to begin."]
      : [
          `Setting up an engagement for ${client}${methodology !== "" ? `: ${methodology}` : ""}.`,
          from !== undefined
            ? `Starting from ${from.name}: its scope, systems, controls, team, and templates are copied in for review.`
            : "",
          missing.length > 0
            ? `Still needed: ${missing.join(", ")}.`
            : "Everything this page needs is in place.",
        ].filter((line) => line !== "");
  return {
    greeting: firstName === "" ? "Welcome." : `Welcome, ${firstName}.`,
    lines,
    startFrom:
      earlier !== undefined && facts.startFrom === ""
        ? { id: earlier.id, name: earlier.name }
        : null,
    after: AFTER_CREATE,
    tip:
      existing !== null && existing.engagements.length > 0
        ? `${existing.name} has been audited before. Starting from an earlier engagement reuses its scope, systems, controls, team, and templates; testing, evidence, and results are never copied.`
        : "For a client audited before, an earlier engagement can be the starting point: its scope, systems, controls, team, and templates are copied in for review.",
  };
}
