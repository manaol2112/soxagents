import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  activitiesOn,
  askAbout,
  contextRows,
  lowestConfidence,
} from "../apps/web/src/control-rail-model.ts";

// The control workspace's side panels (decided by the product owner, 25 October 2026):
// the section menu, the AI assistant's suggestions from the records, and the context.

describe("the AI assistant's suggestions from the records", () => {
  it("asks the agent about this control in plain words", () => {
    assert.equal(
      askAbout("ITGC-AC-01", "User access provisioning", "  Who approves? "),
      "About ITGC-AC-01 User access provisioning: Who approves?",
    );
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
  it("shows the audit trail only from History, and the classification under the facts", () => {
    const view = readFileSync("apps/web/src/controls-view.tsx", "utf8");
    const plan = readFileSync("apps/web/src/planning-view.tsx", "utf8");
    assert.ok(view.includes("{showActivity ? ("));
    assert.ok(!view.includes("open={showActivity}"));
    // Rewritten 9 November 2026 (cleanup after the step panels). Before: the documents
    // card's actions (<DocumentActions>) sat in the assistant rail beside the plan. Now the
    // rail is retired and the governing documents are asked in Control Understanding's
    // documents step, so the view no longer carries the card.
    assert.ok(!view.includes("<GoverningDocumentsCard"));
    assert.ok(view.includes("classification: ("));
    // The plan no longer repeats the process understanding and the documents.
    assert.ok(!plan.includes("workspace.more"));
    assert.ok(plan.includes("workspace?.classification"));
  });

  // Rewritten 2 November 2026 for the product owner's tabbed workspace. Before: the
  // steps carried Needs you, the trace and the sign-offs, and only the Request step left
  // out the summary blocks (summary={step !== "REQUEST"}). Now: the steps show progress on
  // every tab (summary={false}), and the sign-offs are on Approvals. The Request list
  // still has no drafts line. The same day the product owner removed the Needs-you
  // banner from the Overview ("I don't need this"): the header's Needs you opens the
  // action, and the agent's note and what is outstanding fold into AI insights
  // (AgentNotes).
  // Rewritten 8 November 2026 for the product owner's workflow: "I only want the Node WF to
  // be the main workspace and only the workspace for my controls". Before: the control page
  // showed the steps (<ControlStepper ... summary={false}>) above the tabs, and the
  // Overview folded the agent's note in (<AgentNotes>). Now: the 14-step workflow replaces
  // both the steps and the tabs, each step showing where it stands and the next step
  // marked; the stepper's own parts are unchanged and still checked below.
  it("shows the workflow in place of the steps, with no banner", () => {
    const view = readFileSync("apps/web/src/controls-view.tsx", "utf8");
    // Rewritten 9 November 2026 (cleanup): the stepper (control-stepper.tsx) and its
    // banner and agent notes are removed with it, so only the view is read. Before: the
    // stepper's own parts were checked here too.
    assert.ok(view.includes("<ControlWorkflow"));
    assert.ok(!view.includes("<ControlStepper"));
    assert.ok(!view.includes("<NeedsBanner"));
    assert.ok(view.includes('className="cw-needs-badge"'));
    assert.ok(view.includes("receiptText(item)"));
    assert.ok(
      !view.includes("Nothing goes to the owner until a person approves it."),
    );
  });
});

// The Test step's next best actions (product owner's reference, 30 October 2026): the
// viewer's next actions as the assistant lists them, each opening where it is done.
