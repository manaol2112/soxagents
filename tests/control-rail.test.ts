import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { Design } from "../apps/web/src/control-context-model.ts";
import {
  activitiesOn,
  askAbout,
  contextRows,
  controlDocuments,
  exampleAnswers,
  governingDocuments,
  informationSources,
  lowestConfidence,
  openSection,
  parseChallenges,
  relatedControls,
  SECTION_MENU,
  stepPosition,
} from "../apps/web/src/control-rail-model.ts";

// The control workspace's side panels (decided by the product owner, 25 October 2026):
// the section menu, the AI assistant's suggestions from the records, and the context.

function design(extra: Partial<Design> = {}): Design {
  return {
    text: "",
    risk: "",
    itRisk: "",
    principle: "",
    assertions: [],
    controlType: "",
    nature: "",
    frequency: "",
    operator: "",
    reviewer: "",
    owner: "",
    authority: "",
    judgment: "",
    judgmentNote: "",
    precision: "",
    investigation: "",
    information: [
      { name: "User access listing", kind: "REPORT", elements: [], ipe: "" },
    ],
    itgcs: ["ITGC-AC-01", "ITGC-CM-01", "ITGC-AC-01"],
    evidence: "",
    appliesWhen: "",
    slots: [
      {
        key: "approver",
        label: "approver",
        kind: "ROLE",
        why: "",
        example: "",
        blocks: true,
        value: "",
        automatic: false,
        filledBy: null,
        filledAt: "",
        version: 1,
        options: ["IT manager", "System owner"],
        question: "Who approves access?",
        hint: "",
      },
      {
        key: "tool",
        label: "tool",
        kind: "TEXT",
        why: "",
        example: "",
        blocks: false,
        value: "",
        automatic: false,
        filledBy: null,
        filledAt: "",
        version: 1,
        options: [],
        question: "Where are requests raised?",
        hint: "",
      },
    ],
    missing: [],
    ...extra,
  };
}

describe("the control's section menu", () => {
  it("lists the overview, the five steps, and the history", () => {
    assert.deepEqual(
      SECTION_MENU.map((item) => item.label),
      [
        "Overview",
        "Test plan",
        "Evidence requests",
        "Test results",
        "Conclusions",
        "Review & sign-off",
        "History",
      ],
    );
  });

  it("opens the step an address names, the history on request, else the overview", () => {
    assert.equal(openSection(null, false), "OVERVIEW");
    assert.equal(openSection("plan", false), "PLAN");
    assert.equal(openSection("review", false), "REVIEW");
    assert.equal(openSection("plan", true), "HISTORY");
    assert.equal(openSection("history", false), "OVERVIEW");
    assert.equal(openSection("nonsense", false), "OVERVIEW");
  });

  it("says which of the five steps the control is on, for the bar that stays in view", () => {
    assert.equal(stepPosition("PLAN"), "Step 1 of 5 · Test plan");
    assert.equal(stepPosition("review"), "Step 5 of 5 · Review & sign-off");
    assert.equal(stepPosition("HISTORY"), "");
    assert.equal(stepPosition(""), "");
  });
});

describe("the AI assistant's suggestions from the records", () => {
  it("names the information the control uses, then the RCM's evidence, once each", () => {
    assert.deepEqual(
      informationSources(design(), [
        "Access request tickets",
        "Access request tickets",
      ]),
      ["User access listing (report)", "Access request tickets"],
    );
    assert.deepEqual(informationSources(null, []), []);
  });

  it("gives the usual answers only for questions that have them", () => {
    assert.deepEqual(exampleAnswers(design()), [
      {
        question: "Who approves access?",
        answers: ["IT manager", "System owner"],
      },
    ]);
  });

  it("links the controls it relies on, the same system's first", () => {
    const related = relatedControls(
      design(),
      [
        { id: "other", controlRef: "ITGC-AC-01", applicationName: "Oracle" },
        { id: "same", controlRef: "itgc-ac-01", applicationName: "SAP" },
      ],
      "SAP",
    );
    assert.deepEqual(related, [
      { ref: "ITGC-AC-01", id: "same" },
      { ref: "ITGC-CM-01", id: null },
    ]);
  });

  it("asks the agent about this control in plain words", () => {
    assert.equal(
      askAbout("ITGC-AC-01", "User access provisioning", "  Who approves? "),
      "About ITGC-AC-01 User access provisioning: Who approves?",
    );
  });

  it("reads the planning agent's challenges and says whether it drafted them", () => {
    assert.deepEqual(
      parseChallenges({
        challenges: [{ title: "Listings", detail: "Incomplete." }, { x: 1 }],
        source: "MODEL",
        note: "Guidance only.",
      }),
      {
        challenges: [{ title: "Listings", detail: "Incomplete." }],
        drafted: true,
        note: "Guidance only.",
      },
    );
    assert.equal(
      parseChallenges({ challenges: [], source: "NONE", note: "" })?.drafted,
      false,
    );
    assert.equal(parseChallenges(null), null);
  });
});

describe("the control's context", () => {
  it("states what the records hold and says when they do not", () => {
    assert.deepEqual(
      contextRows({
        applicationName: "SAP S/4HANA",
        category: "it",
        categoryLabel: "IT controls",
        area: "User access management",
        ownerName: "",
        ownerEmail: "",
        environment: "PRODUCTION",
      }).map((row) => `${row.label}: ${row.value}`),
      [
        "System: SAP S/4HANA",
        "Process: IT controls",
        "Control area: User access management",
        "Owner: Not stated",
        "Environment: Production",
      ],
    );
  });
});

// The control's Plan step as the product owner's reference (26 October 2026): the plan's
// confidence, the governing documents it cites, and the context's frequency and key.
describe("the Plan step's figures and side cards", () => {
  it("states the plan's confidence as its weakest attribute definition", () => {
    assert.equal(lowestConfidence(["HIGH", "MODERATE", "HIGH"]), "MODERATE");
    assert.equal(lowestConfidence(["HIGH", null, "HIGH"]), "HIGH");
    assert.equal(
      lowestConfidence(["LOW", "NOT_ESTABLISHED"]),
      "NOT_ESTABLISHED",
    );
    // None stated: no figure, never a guess.
    assert.equal(lowestConfidence([null, "UNKNOWN"]), null);
    assert.equal(lowestConfidence([]), null);
  });

  it("lists the policies, procedures, narratives and diagrams, not other documents", () => {
    assert.deepEqual(
      governingDocuments([
        {
          id: "a",
          kind: "POLICY",
          title: "Information Security Policy",
          fileName: "isp.pdf",
        },
        {
          id: "b",
          kind: "WALKTHROUGH",
          title: "Walkthrough",
          fileName: "w.docx",
        },
        { id: "c", kind: "FLOWCHART", title: "", fileName: "flow.png" },
      ]),
      [
        {
          id: "a",
          title: "Information Security Policy",
          detail: "Policy · isp.pdf",
        },
        { id: "c", title: "flow.png", detail: "Flow diagram · flow.png" },
      ],
    );
  });

  it("adds the frequency and whether it is key when the page states them", () => {
    const rows = contextRows({
      applicationName: "SAP S/4HANA",
      category: "it",
      categoryLabel: "IT controls",
      area: "User access management",
      ownerName: "",
      ownerEmail: "",
      environment: "",
      frequencyLabel: "",
      keyControl: true,
    }).map((row) => `${row.label}: ${row.value}`);
    assert.deepEqual(rows.slice(-3), [
      "Environment: Not stated",
      "Frequency: Not stated",
      "Key control: Yes",
    ]);
  });
});

describe("the History figures", () => {
  it("counts the activities of one day in UTC", () => {
    const items = [
      { at: "2026-10-15T23:59:00Z" },
      { at: "2026-10-15T00:01:00Z" },
      { at: "2026-10-16T00:00:00Z" },
    ];
    assert.equal(activitiesOn(items, new Date("2026-10-15T12:00:00Z")), 2);
    assert.equal(activitiesOn([], new Date("2026-10-15T12:00:00Z")), 0);
  });
});

// The Plan step without its repeated sections (product owner, 26 October 2026: "do i need
// these here?"): the process understanding card and the Activity panel are gone, the
// documents and their review move to the assistant's documents card.
describe("one place for each part of the Plan step", () => {
  it("lists every document, governing then supporting, with what waits for review", () => {
    const card = controlDocuments([
      {
        id: "a",
        kind: "POLICY",
        title: "Access Standard",
        fileName: "iss.pdf",
        reviewed: false,
      },
      {
        id: "b",
        kind: "WALKTHROUGH",
        title: "",
        fileName: "notes.docx",
        reviewed: true,
      },
      {
        id: "c",
        kind: "FLOWCHART",
        title: "Flow",
        fileName: "flow.png",
        reviewed: true,
      },
    ]);
    assert.deepEqual(
      card.governing.map((item) => [item.id, item.reviewed]),
      [
        ["a", false],
        ["c", true],
      ],
    );
    assert.deepEqual(card.supporting, [
      {
        id: "b",
        title: "notes.docx",
        detail: "Walkthrough notes · notes.docx",
        reviewed: true,
      },
    ]);
    assert.equal(card.unreviewed, 1);
  });

  it("shows the audit trail only from History, and the classification under the facts", () => {
    const view = readFileSync("apps/web/src/controls-view.tsx", "utf8");
    const plan = readFileSync("apps/web/src/planning-view.tsx", "utf8");
    assert.ok(view.includes("{showActivity ? ("));
    assert.ok(!view.includes("open={showActivity}"));
    assert.ok(view.includes("<DocumentActions"));
    assert.ok(view.includes("classification: ("));
    // The plan no longer repeats the process understanding and the documents.
    assert.ok(!plan.includes("workspace.more"));
    assert.ok(plan.includes("workspace?.classification"));
  });

  it("leaves the Request step to its own list, without the summary blocks or the drafts line", () => {
    const view = readFileSync("apps/web/src/controls-view.tsx", "utf8");
    const stepper = readFileSync("apps/web/src/control-stepper.tsx", "utf8");
    assert.ok(view.includes('summary={step !== "REQUEST"}'));
    assert.ok(
      !view.includes("Nothing goes to the owner until a person approves it."),
    );
    // Needs you, the agent, outstanding and the trace each give way; the sign-offs stay.
    assert.equal((stepper.match(/!simple && summary/g) ?? []).length, 3);
    assert.ok(stepper.includes("{simple || !summary ? null : ("));
    assert.ok(stepper.includes("{receipts.length > 0 ? ("));
  });
});
