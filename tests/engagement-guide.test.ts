import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agentBrief,
  firstNameFrom,
  type GuideFacts,
  guideSteps,
  missingForCreate,
  onboardingCycle,
  scopeDraft,
} from "../apps/web/src/engagement-guide-model.ts";
import { SETUP_STEPS } from "../apps/web/src/onboarding-model.ts";

// The onboarding flow (decided by the product owner, 25 October 2026): the client and
// scope on the New engagement page, then the team, then launch. The frameworks the
// earlier page chose are gone; systems, controls, and templates are set up in Controls.

const clients = [
  {
    id: "c1",
    name: "Northwind Traders",
    // Listed oldest period first: the guide still offers the latest period.
    engagements: [
      { id: "e1", name: "SOX 2025", periodEnd: "2025-12-31" },
      { id: "e2", name: "SOX 2026", periodEnd: "2026-12-31" },
    ],
  },
  { id: "c2", name: "Contoso Ltd", engagements: [] },
];

const blank: GuideFacts = {
  clients,
  client: null,
  startFrom: "",
  name: "",
  periodEnd: "",
  leadName: "Avery Brooks",
  methodology: "",
  scope: "",
};

const complete: GuideFacts = {
  ...blank,
  client: { kind: "existing", id: "c2" },
  name: "SOX FY27",
  methodology: "MANAGEMENT_404",
  scope: "SOX testing of Contoso Ltd.",
};

const step = (facts: GuideFacts, id: string) => {
  const found = guideSteps(facts).find((item) => item.id === id);
  assert.ok(found, id);
  return found;
};

describe("the setup agent's guide on the New engagement page", () => {
  it("walks the client and scope in order, each step pointing at its part of the page", () => {
    assert.deepEqual(
      guideSteps(blank).map((item) => item.id),
      [
        "welcome",
        "client",
        "name",
        "period",
        "lead",
        "methodology",
        "scope",
        "create",
      ],
    );
    assert.deepEqual(step(blank, "welcome").targets, []);
    assert.deepEqual(step(blank, "methodology").targets, [
      'label[for="create-methodology"]',
    ]);
    assert.match(
      step(blank, "welcome").body[1] ?? "",
      /set up in Controls once it runs/,
    );
  });

  it("speaks to the client chosen and its history", () => {
    assert.match(step(blank, "client").body[0] ?? "", /firm's 2 clients/);
    const earlier = step(
      { ...blank, client: { kind: "existing", id: "c1" } },
      "client",
    );
    assert.equal(
      earlier.body[0],
      "Northwind Traders has 2 earlier engagements.",
    );
    assert.match(earlier.body[1] ?? "", /SOX 2026 can be the starting point/);
    const from = step(
      { ...blank, client: { kind: "existing", id: "c1" }, startFrom: "e1" },
      "client",
    );
    assert.match(from.body[0] ?? "", /^Starting from SOX 2025\./);
  });

  it("names the period and the methodology from what is entered", () => {
    assert.equal(
      step({ ...blank, periodEnd: "2026-12-31" }, "period").body[0],
      "Audit period Jan 1, 2026 – Dec 31, 2026.",
    );
    assert.match(
      step({ ...blank, methodology: "EXTERNAL_ICFR" }, "methodology").body[0] ??
        "",
      /^External audit of ICFR\./,
    );
  });

  it("says what is still needed before the engagement can be created", () => {
    assert.deepEqual(missingForCreate(blank), [
      "the client",
      "the engagement name",
      "the methodology",
      "the scope",
    ]);
    assert.equal(
      step(blank, "create").body[0],
      "Still needed: the client, the engagement name, the methodology, the scope.",
    );
    assert.equal(step(complete, "create").done, true);
    assert.equal(
      step(complete, "create").body[0],
      "SOX FY27 for Contoso Ltd is ready to create.",
    );
    assert.equal(
      step(complete, "create").body[1],
      "Next: the team, then launch.",
    );
  });

  it("keeps the product's neutral voice", () => {
    const words = guideSteps({ ...complete, periodEnd: "2026-12-31" })
      .flatMap((item) => [item.title, ...item.body])
      .join(" ");
    assert.doesNotMatch(words, /\b(I|I'll|I'm|me|my|we|let's)\b/i);
  });
});

describe("the scope the page drafts", () => {
  it("follows the client, the period, and the methodology", () => {
    assert.equal(
      scopeDraft({
        client: "Contoso Ltd",
        periodEnd: "2027-12-31",
        methodology: "INTERNAL_AUDIT",
      }),
      "Internal audit of Contoso Ltd's IT general controls and business process controls for the period ending December 31, 2027. The in-scope systems and controls are set up after launch.",
    );
    assert.match(
      scopeDraft({ client: "", periodEnd: "", methodology: "" }),
      /^SOX testing of the client's IT general controls and business process controls\./,
    );
    assert.match(
      scopeDraft({
        client: "Contoso Ltd",
        periodEnd: "",
        methodology: "MANAGEMENT_404",
      }),
      /in support of management's SOX 404 assessment, covering/,
    );
  });
});

describe("the onboarding cycle the agent shows", () => {
  it("runs from the client and scope to the team and launch", () => {
    const cycle = onboardingCycle(blank, SETUP_STEPS);
    assert.deepEqual(
      cycle.map((stage) => `${stage.id}:${stage.where}:${stage.state}`),
      ["scope:here:current", "team:setup:upcoming", "launch:setup:upcoming"],
    );
  });

  it("points at the team once this page is complete", () => {
    assert.deepEqual(
      onboardingCycle(complete, SETUP_STEPS).map((stage) => stage.state),
      ["done", "next", "upcoming"],
    );
  });
});

describe("the agent panel beside the form", () => {
  it("greets by a first name only when the address reads as one", () => {
    assert.equal(firstNameFrom("avery.brooks@example.com"), "Avery");
    assert.equal(firstNameFrom("manaol2112@example.com"), "");
    assert.equal(firstNameFrom("ui-plan-ed3bc421@example.com"), "");
    assert.equal(firstNameFrom("j.doe@example.com"), "");
    assert.equal(agentBrief(blank, "").greeting, "Welcome.");
    assert.equal(agentBrief(blank, "Avery").greeting, "Welcome, Avery.");
  });

  it("speaks to the client and methodology, offers a start, and says what follows", () => {
    assert.match(agentBrief(blank, "").lines[0] ?? "", /^Choose the client/);
    const brief = agentBrief(
      {
        ...blank,
        client: { kind: "existing", id: "c1" },
        methodology: "EXTERNAL_ICFR",
      },
      "",
    );
    assert.equal(
      brief.lines[0],
      "Setting up an engagement for Northwind Traders: External audit of ICFR.",
    );
    assert.equal(
      brief.lines[1],
      "Still needed: the engagement name, the scope.",
    );
    // The latest period is the one offered to start from.
    assert.deepEqual(brief.startFrom, { id: "e2", name: "SOX 2026" });
    assert.match(brief.after, /set up in Controls once it runs\.$/);
    const started = agentBrief(
      { ...complete, client: { kind: "existing", id: "c1" }, startFrom: "e2" },
      "",
    );
    assert.match(started.lines[1] ?? "", /^Starting from SOX 2026/);
    assert.equal(started.lines[2], "Everything this page needs is in place.");
    assert.equal(started.startFrom, null);
  });

  it("keeps the product's neutral voice", () => {
    const brief = agentBrief(
      { ...blank, client: { kind: "existing", id: "c1" } },
      "Avery",
    );
    assert.doesNotMatch(
      [brief.greeting, ...brief.lines, brief.after, brief.tip].join(" "),
      /\b(I|I'll|I'm|me|my|we|let's)\b/i,
    );
  });
});
