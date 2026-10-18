import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type AssistantInput,
  assistantBrief,
  stepAnchor,
} from "../apps/web/src/assistant-model.ts";
import type { ControlContext } from "../apps/web/src/control-context-model.ts";
import {
  type ControlRow,
  parseControls,
} from "../apps/web/src/engagement-model.ts";
import {
  parsePlan,
  populationWaiting,
} from "../apps/web/src/evidence-plan-model.ts";

function row(overrides: Partial<ControlRow>): ControlRow {
  return {
    ...(parseControls([
      { id: "c1", control_ref: "OTC-01", included: true },
    ])?.[0] as ControlRow),
    ...overrides,
  };
}

function context(overrides: Partial<ControlContext>): ControlContext {
  return {
    controlId: "c1",
    classifications: ["BUSINESS_PROCESS"],
    derivedClassifications: ["BUSINESS_PROCESS"],
    classificationsOverridden: false,
    processRequired: true,
    readiness: null,
    approved: [],
    proposed: [],
    history: [],
    issues: [],
    documents: [],
    understanding: {
      status: "NONE",
      summary: "",
      steps: [],
      builtBy: "PERSON",
      proposedSummary: "",
      proposedSteps: null,
      proposedNote: "",
      confirmedBy: null,
      version: 0,
    },
    note: "",
    testing: null,
    libraryUpdate: null,
    design: null,
    ...overrides,
  };
}

const input = (parts: Partial<AssistantInput>): AssistantInput => ({
  control: row({}),
  context: null,
  test: null,
  sheet: null,
  review: null,
  tasks: [],
  filesRead: 0,
  ...parts,
});

const attribute = {
  id: "a1",
  position: 0,
  text: "Approved before posting",
  status: "APPROVED" as const,
  basis: "DOCUMENTED" as const,
  sourceKind: "RCM" as const,
  sourceDocumentId: null,
  sourceTitle: "",
  sourceQuote: "",
  note: "",
  proposal: null,
  definition: null,
  replacesId: null,
  decidedBy: null,
  version: 1,
};

describe("the control assistant", () => {
  it("anchors each step by its title", () => {
    assert.equal(
      stepAnchor("Definition and attributes"),
      "step-definition-and-attributes",
    );
    assert.equal(
      stepAnchor("Test results and sign-off"),
      "step-test-results-and-sign-off",
    );
  });

  it("puts what blocks testing first, and offers to do what the agent can", () => {
    const brief = assistantBrief(
      input({
        filesRead: 2,
        tasks: [
          {
            id: "t1",
            kind: "test",
            status: "READY",
            agent: "Business process controls tester",
          } as unknown as AssistantInput["tasks"][number],
        ],
        context: context({
          approved: [attribute],
          proposed: [
            {
              ...attribute,
              id: "p1",
              status: "PROPOSED",
              sourceKind: "AGENT",
              proposal: "ADD",
            },
          ],
          documents: [
            {
              id: "d1",
              kind: "POLICY",
              title: "Policy",
              fileName: "",
              origin: "WRITTEN",
              characters: 10,
              excerpt: "",
              createdBy: null,
              controlIds: ["c1"],
              reviewed: false,
            },
          ],
          issues: [
            {
              id: "i1",
              origin: "SOURCES",
              kind: "CONFLICT",
              topic: "Frequency",
              detail: "The RCM says monthly; the policy says quarterly.",
              why: "",
              resolve: "",
              quotes: [],
              raisedBy: "RULES",
              status: "OPEN",
              resolutionNote: "",
              version: 1,
            },
          ],
        }),
      }),
    );
    assert.equal(brief.agent, "Business process controls tester");
    assert.equal(brief.headline, "OTC-01: 4 items require your attention.");
    assert.deepEqual(
      brief.actions.map((item) => [
        item.title,
        item.urgent,
        item.quick?.intent ?? null,
      ]),
      [
        ["Resolve 1 conflict between sources", true, null],
        ["Build the process understanding", true, "process-build"],
        ["Decide 1 proposed attribute change", false, null],
        ["Review 1 new document against the control", false, "review"],
      ],
    );
    assert.equal(brief.actions[0]?.anchor, "step-definition-and-attributes");
    assert.equal(brief.actions[1]?.tab, "design");
    assert.deepEqual(brief.done, [
      "2 evidence files read and classified for this control.",
      "1 attribute change proposed from the source documents.",
    ]);
  });

  it("says when nothing needs the person, and what waits on others", () => {
    const brief = assistantBrief(
      input({
        control: row({
          waitingOn: "OWNER",
          ownerName: "Dana",
          evidenceReceived: 1,
          evidenceRequests: 3,
        }),
        context: context({ processRequired: false, approved: [attribute] }),
      }),
    );
    assert.deepEqual(brief.actions, []);
    assert.equal(
      brief.headline,
      "No action is required on OTC-01 at this time.",
    );
    assert.equal(brief.signature, "");
    assert.match(
      brief.waiting[0] ?? "",
      /Awaiting evidence from Dana: 1 of 3 requests received/,
    );
  });

  it("follows testing: samples to approve, results to decide, then sign-off", () => {
    const test = {
      id: "t1",
      status: "PROPOSED",
      version: 2,
      samples: [{}, {}],
    } as unknown as AssistantInput["test"];
    const ready = context({
      processRequired: false,
      approved: [attribute],
      readiness: {
        state: "READY",
        label: "Ready to test",
        processRequired: false,
        checks: [],
      },
    });
    const samples = assistantBrief(input({ context: ready, test }));
    assert.deepEqual(
      samples.actions.map((item) => [item.title, item.tab, item.anchor]),
      [["Approve the samples", "testing", "step-population-and-sample"]],
    );
    // A population not yet accepted on the evidence plan comes first: the approval
    // would be refused until it is.
    const plan = parsePlan({
      control_id: "c1",
      status: "PROPOSED",
      phases: [
        {
          phase: "INTERIM",
          applicability: "APPLICABLE",
          state: "RECEIVED_NOT_VALIDATED",
          requirements: [
            {
              id: "q1",
              phase: "INTERIM",
              title: "Every change in the window",
              categories: ["POPULATION"],
              necessity: "REQUIRED",
              state: "RECEIVED",
              depends_on_title: null,
              version: 3,
            },
          ],
        },
      ],
    });
    const first = assistantBrief(
      input({
        context: ready,
        test,
        populationToAccept: populationWaiting(plan, "INTERIM"),
      }),
    );
    // It opens the Evidence tab's requirements, where the population is accepted; the
    // old interim evidence plan step no longer exists on the page.
    assert.deepEqual(
      first.actions.map((item) => [item.title, item.tab, item.target]),
      [["Accept the population", "evidence", { view: "requirements" }]],
    );
    assert.match(first.actions[0]?.detail ?? "", /Every change in the window/);
    // A blocked control does not offer the approval it would refuse.
    const blocked = assistantBrief(
      input({
        test,
        context: context({
          ...ready,
          readiness: {
            state: "NEEDS_INFORMATION",
            label: "Needs information",
            processRequired: false,
            checks: [],
          },
        }),
      }),
    );
    assert.equal(
      blocked.actions.some((item) => item.title === "Approve the samples"),
      false,
    );
    const sheet = {
      id: "s1",
      status: "OPEN",
      version: 4,
      counts: {
        items: 3,
        tested: 3,
        noEvidence: 0,
        exceptions: 1,
        // Insufficient evidence and human review both wait for a person.
        unable: 1,
        review: 1,
        unplaced: 0,
      },
    } as unknown as AssistantInput["sheet"];
    const decide = assistantBrief(
      input({
        context: ready,
        sheet,
        control: row({ sheetLeft: "DECIDE", sheetStatus: "OPEN" }),
      }),
    );
    assert.equal(
      decide.actions[0]?.title,
      "Decide 2 results requiring judgment",
    );
    assert.equal(
      decide.done.at(-1),
      "3 of 3 items tested; 1 exception identified.",
    );
    // The signature changes with the work, so a dismissal holds only until then.
    assert.notEqual(decide.signature, samples.signature);
  });
});

describe("the control assistant's evidence requests", () => {
  it("names the request it drafted and who it goes to", () => {
    const brief = assistantBrief(
      input({
        control: row({
          waitingOn: "TEAM",
          nextStep: "Submit the evidence request",
          ownerName: "Bianca Torres",
          requests: [
            {
              id: "r1",
              kind: "EVIDENCE",
              title: "Access",
              status: "DRAFT",
              dueAt: "",
              version: 1,
              phase: "INTERIM",
            },
          ],
        }),
        context: context({ processRequired: false, approved: [attribute] }),
      }),
    );
    assert.equal(
      brief.actions[0]?.title,
      "Review the 1 drafted evidence request",
    );
    assert.match(
      brief.actions[0]?.detail ?? "",
      /asks Bianca Torres .* Nothing is sent until it is approved/,
    );
    assert.equal(
      brief.done[0],
      "1 evidence request drafted for Bianca Torres.",
    );
  });
});
