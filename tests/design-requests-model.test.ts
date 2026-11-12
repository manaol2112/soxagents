import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ACCEPT_FIRST,
  ACCEPT_MAX,
  ADD_KINDS,
  type DesignRequestsState,
  DRAFTING_WINDOW_MS,
  EXCEPTION_REASON_MAX,
  EXCEPTION_REASON_MIN,
  firstToAccept,
  LIST_CHANGED,
  NOT_CONFIRMED,
  POLL_EVERY_MS,
  POLL_LIMIT_MS,
  parseDesignRequests,
  parseRequestAcceptance,
  pollingOver,
  REQUEST_CHIPS,
  REQUESTS_STATUS,
  type RequestsInput,
  type RequestsView,
  readsAgain,
  reasonCheck,
  requestReady,
  requestsFallback,
  requestsNeed,
  requestsProblem,
  requestsStanding,
  requestsView,
  requestsWrite,
  SETTLED_LINE,
  STALLED_LINE,
  waitingOnOf,
  withAttribute,
} from "../apps/web/src/design-requests-model.ts";
import { parsePlan } from "../apps/web/src/evidence-plan-model.ts";
import {
  parsePhaseProgress,
  planningWrite,
} from "../apps/web/src/planning-model.ts";

// The D&I requests list (product owner, 12 November 2026): "Why do I need to have the
// release button? Simplify the workflow. After the attributes approval, list down the
// evidences so that I can add, modify or update, or delete. Similar to how I do in the
// attributes." and "Agent proposes, the human approves. For each request, I want to show
// which specific attributes it is addressing to make sure I get coverage."

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D] = [uuid(1), uuid(2), uuid(3), uuid(4)] as const;
const [POLICY, WALK, CONFIG, GONE] = [
  uuid(11),
  uuid(12),
  uuid(13),
  uuid(14),
] as const;

const approved = [
  {
    id: A,
    text: "Access is requested through a ticket.",
    sourceKind: "LIBRARY",
  },
  {
    id: B,
    text: "The user's manager approves before access is granted.",
    sourceKind: "LIBRARY",
  },
  {
    id: C,
    text: "Access granted matches what was approved.",
    sourceKind: "AGENT",
  },
  { id: D, text: "Access is granted within two days.", sourceKind: "MANUAL" },
];

type Requirement = RequestsInput["requirements"][number];

const requirement = (extra: Partial<Requirement> = {}): Requirement => ({
  id: POLICY,
  phase: "DESIGN",
  title: "Access provisioning policy",
  description: "The approved policy for granting access.",
  objective: "How access is meant to be approved.",
  categories: ["PROCESS_DOCUMENTATION"],
  necessity: "REQUIRED",
  state: "NOT_GENERATED",
  origin: "AGENT",
  pendingChange: null,
  version: 3,
  requestId: null,
  attributeIds: [B],
  accepted: false,
  acceptedBy: null,
  acceptedAt: null,
  toAccept: true,
  personEdited: false,
  procedureIds: null,
  ...extra,
});

const policy = requirement();
const walkthrough = requirement({
  id: WALK,
  title: "One access request, end to end",
  description: "One request traced from ticket to access granted.",
  objective: "One instance, start to finish.",
  categories: ["CONTROL_EXECUTION", "PROCESS_DOCUMENTATION"],
  version: 5,
  // Sent in any order, and with an attribute since retired: shown in the attributes' order.
  attributeIds: [C, uuid(99), A],
  accepted: true,
  acceptedBy: "Dana Reyes",
  acceptedAt: "2026-11-12T09:30:00Z",
  toAccept: false,
});

const summary = (
  extra: Partial<DesignRequestsState> = {},
): DesignRequestsState => ({
  settled: false,
  released: false,
  toAccept: 1,
  uncovered: [D],
  exceptions: [],
  waitingFor: "",
  working: null,
  drafting: null,
  ...extra,
});

const NOW = Date.parse("2026-11-12T10:00:00Z");

const input = (extra: Partial<RequestsInput> = {}): RequestsInput => ({
  status: {
    step: "WAITING",
    waitingOn: "REQUESTS",
    waitingFor: "1 request waits to be accepted.",
    releasedAt: null,
  },
  approved,
  requirements: [policy, walkthrough],
  summary: summary(),
  working: false,
  procedures: { [POLICY]: [uuid(21)], [WALK]: [uuid(21), uuid(22)] },
  now: NOW,
  ...extra,
});

/** A header's pill: its tone and status, without the step's line. */
function pill(header: { tone: string; status: string } | null) {
  return header === null ? null : { tone: header.tone, status: header.status };
}

function listOf(view: RequestsView) {
  if (view.mode !== "list" && view.mode !== "drafting") {
    throw new Error(`expected the list, got ${view.mode}`);
  }
  return view;
}

describe("the D&I requests list: rows", () => {
  const view = listOf(requestsView(input()));

  it("lists the live D&I requests, each with its kind, origin and letters", () => {
    assert.equal(view.mode, "list");
    assert.equal(view.title, "2 requests");
    assert.deepEqual(
      view.rows.map((row) => [
        row.title,
        row.icon,
        row.line,
        row.originLine,
        row.letters,
        row.state,
      ]),
      [
        [
          "Access provisioning policy",
          "file",
          "Policy or procedure",
          "Proposed by the agent",
          ["B"],
          "TO_ACCEPT",
        ],
        // Its first category the list names decides its kind; its letters follow the
        // approved attributes' order, and an attribute no longer approved is not shown.
        [
          "One access request, end to end",
          "list",
          "Walkthrough instance",
          "Proposed by the agent",
          ["A", "C"],
          "ACCEPTED",
        ],
      ],
    );
    assert.deepEqual(view.rows[1]?.attributeIds, [A, C]);
    assert.equal(view.rows[0]?.addresses, "addresses attribute B");
    assert.equal(view.rows[1]?.addresses, "addresses attributes A and C");
    assert.equal(view.rows[0]?.shows, "How access is meant to be approved.");
    assert.deepEqual(REQUEST_CHIPS.TO_ACCEPT, {
      label: "To accept",
      tone: "ai",
    });
    assert.deepEqual(REQUEST_CHIPS.ACCEPTED, {
      label: "Accepted",
      tone: "success",
    });
  });

  it("says who accepted a request, and keeps the procedures it serves", () => {
    assert.equal(view.rows[1]?.acceptedBy, "Dana Reyes");
    assert.equal(view.rows[1]?.acceptedAt, "2026-11-12T09:30:00Z");
    assert.deepEqual(view.rows[1]?.procedureIds, [uuid(21), uuid(22)]);
    // The test plan was not read: the links cannot be changed without losing them.
    const unread = listOf(requestsView(input({ procedures: null })));
    assert.equal(unread.rows[0]?.procedureIds, null);
    // Read, and the request serves no procedure.
    const none = listOf(requestsView(input({ procedures: {} })));
    assert.deepEqual(none.rows[0]?.procedureIds, []);
  });

  it("words the origin from who wrote the request as it reads", () => {
    const rows = listOf(
      requestsView(
        input({
          requirements: [
            policy,
            requirement({ id: WALK, origin: "RULES" }),
            requirement({ id: CONFIG, origin: "AGENT", personEdited: true }),
            requirement({ id: GONE, origin: "PERSON", personEdited: true }),
          ],
        }),
      ),
    ).rows;
    assert.deepEqual(
      rows.map((row) => [row.origin, row.originLine]),
      [
        ["AGENT", "Proposed by the agent"],
        ["AGENT", "Proposed by the agent"],
        ["EDITED", "Edited by the team"],
        ["ADDED", "Added by the team"],
      ],
    );
  });

  it("marks an optional request, and one that addresses no attribute", () => {
    const row = listOf(
      requestsView(
        input({
          requirements: [
            requirement({
              necessity: "OPTIONAL",
              categories: [],
              attributeIds: [],
            }),
          ],
        }),
      ),
    ).rows[0];
    assert.equal(row?.line, "Supporting evidence · Optional");
    assert.deepEqual(row?.letters, []);
    assert.equal(row?.addresses, "addresses no attribute");
  });

  it("leaves out other phases and requests no longer in the plan", () => {
    const rows = listOf(
      requestsView(
        input({
          requirements: [
            policy,
            requirement({ id: WALK, phase: "INTERIM" }),
            requirement({ id: CONFIG, state: "NOT_APPLICABLE" }),
            requirement({ id: GONE, state: "REMOVED" }),
            requirement({ id: uuid(15), state: "CANCELLED" }),
          ],
        }),
      ),
    ).rows;
    assert.deepEqual(
      rows.map((row) => row.id),
      [POLICY],
    );
  });
});

describe("the D&I requests list: acceptance", () => {
  it("sends Accept all every row that waits, at the version shown", () => {
    const view = listOf(requestsView(input()));
    assert.deepEqual(view.accept, [{ requirement_id: POLICY, version: 3 }]);
    assert.equal(firstToAccept(view.rows), POLICY);
    const settled = listOf(
      requestsView(
        input({
          requirements: [walkthrough],
          summary: summary({ toAccept: 0, uncovered: [] }),
        }),
      ),
    );
    assert.deepEqual(settled.accept, []);
    assert.equal(firstToAccept(settled.rows), null);
  });

  it("never reads a request as accepted on a guess", () => {
    const state = (extra: Partial<Requirement>) =>
      listOf(requestsView(input({ requirements: [requirement(extra)] })))
        .rows[0]?.state;
    // The server's word, with no change waiting.
    assert.equal(state({ accepted: true, toAccept: false }), "ACCEPTED");
    // The server did not say whether it waits: accepted, with no change, stands.
    assert.equal(state({ accepted: true, toAccept: null }), "ACCEPTED");
    assert.equal(state({ accepted: false, toAccept: null }), "TO_ACCEPT");
    // Not accepted, whatever else was sent.
    assert.equal(state({ accepted: false, toAccept: false }), "TO_ACCEPT");
    // The server says it waits.
    assert.equal(state({ accepted: true, toAccept: true }), "TO_ACCEPT");
    // A change the planner proposes to an accepted request waits on a person again.
    assert.equal(
      state({
        accepted: true,
        toAccept: false,
        pendingChange: { remove: false, title: "New", description: "" },
      }),
      "TO_ACCEPT",
    );
  });

  it("shows what the planner would change on an accepted request", () => {
    const change = (pendingChange: Requirement["pendingChange"]) =>
      listOf(
        requestsView(
          input({
            requirements: [
              requirement({ accepted: true, toAccept: true, pendingChange }),
            ],
          }),
        ),
      ).rows[0]?.change;
    assert.equal(change(null), null);
    assert.deepEqual(
      change({
        remove: false,
        title: "Access policy, current version",
        description: "The approved policy for granting access.",
      }),
      {
        add: false,
        remove: false,
        title: "Access policy, current version",
        // The description would not change, so it is not shown as a change.
        description: "",
        summary: "The agent proposes new wording for this request.",
        line: "Agent proposes a change",
      },
    );
    assert.deepEqual(change({ remove: true, title: "", description: "" }), {
      add: false,
      remove: true,
      title: "",
      description: "",
      summary: "The agent proposes removing this request.",
      line: "Agent proposes removing it",
    });
    // Neither wording changes: what it must show, or its attributes, would.
    assert.equal(
      change({ remove: false, title: "", description: "" })?.summary,
      "The agent proposes a change to what this request must show.",
    );
  });

  // Review finding 5 (12 November 2026). Old behaviour: `pending_change.add` was dropped,
  // so a request the planner proposed as a new one read "Agent proposes a change" and
  // offered "Keep the accepted request", which deleted it. New: it reads as a proposed
  // request, accepted or rejected, and nothing else until then.
  it("shows a request the agent proposes as a new one, to accept or reject", () => {
    const proposal = requirement({
      id: CONFIG,
      title: "Provisioning configuration",
      categories: ["CONFIGURATION"],
      attributeIds: [D],
      // However the plan holds it until it is accepted: removed with the proposal on it.
      state: "REMOVED",
      pendingChange: { remove: false, title: "", description: "", add: true },
    });
    const view = listOf(
      requestsView(input({ requirements: [policy, walkthrough, proposal] })),
    );
    const row = view.rows.find((each) => each.id === CONFIG);
    assert.ok(row !== undefined);
    assert.deepEqual(row.change, {
      add: true,
      remove: false,
      title: "",
      description: "",
      summary: "The agent proposes this request.",
      line: "Agent proposes this request",
    });
    assert.equal(row.state, "TO_ACCEPT");
    // In the list and in Accept all, not in the history of deleted requests.
    assert.deepEqual(view.history, []);
    assert.ok(view.accept.some((each) => each.requirement_id === CONFIG));
    assert.equal(view.title, "3 requests");
    // The same, where the plan holds it as a planned item.
    const planned = listOf(
      requestsView(
        input({ requirements: [{ ...proposal, state: "NOT_GENERATED" }] }),
      ),
    );
    assert.equal(planned.rows[0]?.change?.add, true);
    // A change or a removal the planner proposes on an accepted request is not one.
    assert.equal(
      listOf(
        requestsView(
          input({
            requirements: [
              requirement({
                accepted: true,
                pendingChange: { remove: true, title: "", description: "" },
              }),
            ],
          }),
        ),
      ).rows[0]?.change?.add,
      false,
    );
    assert.equal(ACCEPT_FIRST, "Accept the request first.");
  });

  it("counts a proposed request toward no attribute until a person accepts it", () => {
    const proposal = requirement({
      id: CONFIG,
      attributeIds: [D],
      pendingChange: { remove: false, title: "", description: "", add: true },
    });
    // The plan's summary was not sent: the page still does not read D as addressed.
    const view = listOf(
      requestsView(
        input({ requirements: [policy, walkthrough, proposal], summary: null }),
      ),
    );
    assert.deepEqual(
      view.coverage.map((chip) => [chip.letter, chip.state, chip.requests]),
      [
        ["A", "COVERED", 1],
        ["B", "COVERED", 1],
        ["C", "COVERED", 1],
        ["D", "UNCOVERED", 0],
      ],
    );
    // The attribute's line says a proposed request would address it: no reason is
    // recorded for it until that request is accepted or rejected.
    assert.deepEqual(
      view.uncovered.map((item) => [item.letter, item.proposed]),
      [["D", true]],
    );
    assert.deepEqual(
      listOf(requestsView(input())).uncovered.map((item) => item.proposed),
      [false],
    );
  });

  it("reads the addition from the plan body, and nothing where it is not said", () => {
    const requirements = (pending: unknown) =>
      parsePlan({
        control_id: uuid(40),
        phases: [
          {
            phase: "DESIGN",
            requirements: [
              { id: POLICY, phase: "DESIGN", pending_change: pending },
            ],
          },
        ],
      })?.phases.find((phase) => phase.phase === "DESIGN")?.requirements ?? [];
    assert.equal(requirements({ add: true })[0]?.pendingChange?.add, true);
    // Only the server's own true: a change or a removal carries no such mark.
    assert.deepEqual(requirements({ remove: true })[0]?.pendingChange, {
      remove: true,
      title: "",
      description: "",
    });
    assert.equal(
      requirements({ add: "yes" })[0]?.pendingChange?.add,
      undefined,
    );
    assert.equal(requirements(null)[0]?.pendingChange, null);
    assert.equal(
      listOf(requestsView(input({ requirements: requirements({ add: true }) })))
        .rows[0]?.change?.line,
      "Agent proposes this request",
    );
  });

  it("holds every acceptance while the planner works", () => {
    const view = listOf(requestsView(input({ working: true })));
    assert.equal(view.working, true);
    assert.deepEqual(
      view.rows.map((row) => row.state),
      // What a person accepted stays accepted: the planner never overwrites it.
      ["UPDATING", "ACCEPTED"],
    );
    assert.deepEqual(view.accept, []);
    assert.equal(firstToAccept(view.rows), null);
    assert.equal(REQUEST_CHIPS.UPDATING.label, "Updating…");
  });
});

describe("the D&I requests list: coverage", () => {
  it("gives every approved attribute a chip: covered, or not addressed", () => {
    const view = listOf(requestsView(input()));
    assert.deepEqual(
      view.coverage.map((chip) => [chip.letter, chip.state, chip.requests]),
      [
        ["A", "COVERED", 1],
        ["B", "COVERED", 1],
        ["C", "COVERED", 1],
        ["D", "UNCOVERED", 0],
      ],
    );
    assert.equal(
      view.coverage[0]?.label,
      "Attribute A: addressed by 1 request",
    );
    assert.equal(
      view.coverage[3]?.label,
      "Attribute D: not addressed by any request",
    );
    assert.equal(view.coverageLine, "3 of 4 attributes addressed");
  });

  it("raises the one exception: the attribute no request addresses", () => {
    const view = listOf(requestsView(input()));
    assert.deepEqual(view.uncovered, [
      {
        attributeId: D,
        letter: "D",
        text: "Access is granted within two days.",
        line: "Attribute D is not addressed by any request",
        proposed: false,
      },
    ]);
    assert.deepEqual(view.exceptions, []);
  });

  it("takes a recorded reason in place of a request", () => {
    const view = listOf(
      requestsView(
        input({
          summary: summary({
            uncovered: [],
            exceptions: [
              {
                attributeId: D,
                reason: "Tested on each operating-effectiveness sample.",
                recordedBy: "Dana Reyes",
                recordedAt: "2026-11-12T09:45:00Z",
              },
            ],
          }),
        }),
      ),
    );
    assert.deepEqual(
      view.coverage.map((chip) => chip.state),
      ["COVERED", "COVERED", "COVERED", "EXCEPTION"],
    );
    assert.equal(
      view.coverage[3]?.label,
      "Attribute D: not evidenced at D&I, with a recorded reason",
    );
    assert.deepEqual(view.uncovered, []);
    assert.deepEqual(view.exceptions, [
      {
        attributeId: D,
        reason: "Tested on each operating-effectiveness sample.",
        recordedBy: "Dana Reyes",
        recordedAt: "2026-11-12T09:45:00Z",
        letter: "D",
        text: "Access is granted within two days.",
      },
    ]);
    assert.equal(
      view.coverageLine,
      "3 of 4 attributes addressed, 1 with a recorded reason",
    );
  });

  it("never shows an attribute as addressed against the server or the records", () => {
    // The server says B is not covered, whatever the page's rows show.
    const flagged = listOf(
      requestsView(input({ summary: summary({ uncovered: [B, D] }) })),
    );
    assert.deepEqual(
      flagged.uncovered.map((item) => item.letter),
      ["B", "D"],
    );
    // The summary was not sent: an attribute with no request and no reason is uncovered.
    const derived = listOf(requestsView(input({ summary: null })));
    assert.deepEqual(
      derived.uncovered.map((item) => item.letter),
      ["D"],
    );
    // The server lists none, and the page sees no request for D and no reason either.
    const silent = listOf(
      requestsView(input({ summary: summary({ uncovered: [] }) })),
    );
    assert.deepEqual(
      silent.uncovered.map((item) => item.letter),
      ["D"],
    );
  });

  it("lists the attributes it is tested against, and where they came from", () => {
    const view = listOf(requestsView(input()));
    assert.deepEqual(
      view.attributes.map((item) => [item.letter, item.source]),
      [
        ["A", "Library"],
        ["B", "Library"],
        ["C", "Agent · approved"],
        ["D", "Team"],
      ],
    );
    assert.equal(
      view.sources,
      "the control library, the agent, approved by the team and the team",
    );
    const none = listOf(requestsView(input({ approved: [] })));
    assert.deepEqual(none.coverage, []);
    assert.equal(none.coverageLine, "No approved attributes");
    assert.deepEqual(none.rows[0]?.letters, []);
  });

  it("adds an attribute to a request without losing the ones it has", () => {
    const view = listOf(requestsView(input()));
    const row = view.rows[1];
    assert.ok(row !== undefined);
    assert.deepEqual(withAttribute(row, D), [A, C, D]);
    assert.deepEqual(withAttribute(row, A), [A, C]);
  });
});

describe("the D&I requests list: history", () => {
  it("keeps deleted requests, each restorable at its version", () => {
    const view = listOf(
      requestsView(
        input({
          requirements: [
            policy,
            requirement({
              id: GONE,
              title: "Prior-year memo",
              categories: [],
              state: "REMOVED",
              version: 7,
            }),
            requirement({ id: CONFIG, phase: "INTERIM", state: "REMOVED" }),
          ],
        }),
      ),
    );
    assert.deepEqual(view.history, [
      {
        id: GONE,
        version: 7,
        title: "Prior-year memo",
        kind: "Supporting evidence",
      },
    ]);
    assert.deepEqual(listOf(requestsView(input())).history, []);
  });
});

describe("the D&I requests list: where it stands", () => {
  const header = (extra: Partial<RequestsInput>) =>
    pill(listOf(requestsView(input(extra))).header);
  const covered = [
    walkthrough,
    requirement({
      accepted: true,
      toAccept: false,
      attributeIds: [B, D],
      acceptedBy: "Dana Reyes",
    }),
  ];
  const nothingLeft = summary({ toAccept: 0, uncovered: [] });

  it("says how many requests wait to be accepted", () => {
    assert.deepEqual(header({}), { tone: "attention", status: "1 to accept" });
    assert.deepEqual(
      header({
        requirements: [policy, requirement({ id: WALK, attributeIds: [A] })],
      }),
      { tone: "attention", status: "2 to accept" },
    );
  });

  it("names the attribute no request addresses once all are accepted", () => {
    assert.deepEqual(
      header({
        requirements: [walkthrough],
        summary: summary({ toAccept: 0, uncovered: [B, D] }),
      }),
      { tone: "attention", status: "2 attributes not addressed" },
    );
    assert.deepEqual(
      header({
        requirements: [
          walkthrough,
          requirement({ accepted: true, toAccept: false }),
        ],
        summary: summary({ toAccept: 0 }),
      }),
      { tone: "attention", status: "Attribute D is not addressed" },
    );
  });

  it("says the planner is at work, and holds the list", () => {
    assert.deepEqual(header({ working: true }), {
      tone: "active",
      status: "Being updated",
    });
    const planning = listOf(
      requestsView(input({ working: true, requirements: [] })),
    );
    assert.deepEqual(pill(planning.header), {
      tone: "active",
      status: "Being planned",
    });
    assert.equal(planning.title, "No requests yet");
    assert.equal(planning.empty, "The planner is preparing the requests.");
  });

  it("asks for a request when none is planned", () => {
    const view = listOf(
      requestsView(input({ requirements: [], summary: summary() })),
    );
    assert.deepEqual(pill(view.header), {
      tone: "attention",
      status: "No requests yet",
    });
    assert.match(view.empty, /Add one/);
    assert.equal(view.settled, false);
    // The empty list is the one exception: each attribute's chip says it is not
    // addressed, without a line for every one of them.
    assert.deepEqual(
      view.coverage.map((chip) => chip.state),
      ["UNCOVERED", "UNCOVERED", "UNCOVERED", "UNCOVERED"],
    );
    assert.deepEqual(view.uncovered, []);
  });

  // Product owner, 12 November 2026: "Yes. I don't want a separate D&I release." The server
  // releases a settled list itself (when the planner finishes, if it is still at work),
  // so the page never offers to draft or release it.
  // Old expectation: a settled list not yet released read "Requests accepted" as work for
  // a person (tone attention), and `settled` meant "offer Draft the requests", which
  // called the D&I release. New: it is at rest (tone idle), nothing is offered, and the
  // page waits for the server.
  it("is settled once every request is accepted and every attribute addressed", () => {
    const view = listOf(
      requestsView(
        input({
          status: {
            step: "READY",
            waitingOn: "",
            waitingFor: "",
            releasedAt: null,
          },
          requirements: covered,
          summary: summary({ ...nothingLeft, settled: true }),
        }),
      ),
    );
    assert.equal(view.mode, "list");
    assert.equal(view.settled, true);
    assert.equal(view.working, false);
    assert.deepEqual(view.accept, []);
    // The server gives no sentence: the step says the requests are drafted next.
    assert.equal(view.header.line, "");
    assert.deepEqual(pill(view.header), {
      tone: "idle",
      status: "Requests accepted",
    });
    // Not settled while a request waits or an attribute is uncovered.
    assert.equal(listOf(requestsView(input())).settled, false);
    assert.equal(
      listOf(
        requestsView(
          input({ requirements: covered, summary: summary({ toAccept: 0 }) }),
        ),
      ).settled,
      false,
    );
  });

  // Old expectation: with the planner at work the list never read settled. New: a list a
  // person finished accepting while the planner still works is settled and waiting, with
  // every action off; the server releases it when the planner finishes.
  it("waits for the planner on a list accepted while it is still at work", () => {
    const view = listOf(
      requestsView(
        input({
          requirements: covered,
          summary: summary({
            ...nothingLeft,
            working: true,
            waitingFor: "The planner is still working on the plan.",
          }),
        }),
      ),
    );
    assert.equal(view.settled, true);
    assert.equal(view.working, true);
    assert.deepEqual(pill(view.header), {
      tone: "active",
      status: "Requests accepted",
    });
    // Said only because the server says the planner is at work.
    assert.equal(
      view.header.line,
      "Drafting starts when the planner finishes. Each request is approved before it goes to the client.",
    );
    assert.deepEqual(
      view.rows.map((row) => row.state),
      ["ACCEPTED", "ACCEPTED"],
    );
  });

  // Review finding 4 (12 November 2026). Old expectation: an accepted list with nothing
  // at work read "Drafting starts when the planner finishes" on the step, and the
  // server's sentence sat under the list (`holds`). New: the step's one line is the
  // server's own sentence; the planner is named only while the server says it works.
  it("says what the server waits for on an accepted list, as the step's one line", () => {
    const view = listOf(
      requestsView(
        input({
          requirements: covered,
          summary: summary({
            ...nothingLeft,
            working: false,
            waitingFor:
              "The requests wait for a person who may accept them to accept the list.",
          }),
        }),
      ),
    );
    assert.equal(view.settled, true);
    assert.equal(view.working, false);
    assert.deepEqual(view.header, {
      tone: "idle",
      status: "Requests accepted",
      line: "The requests wait for a person who may accept them to accept the list.",
    });
    const need = requestsNeed(
      view.header.status,
      view.header.tone,
      view.header.line,
    );
    assert.equal(need?.kind, "wait");
    assert.equal(
      need?.detail,
      "The requests wait for a person who may accept them to accept the list.",
    );
    assert.doesNotMatch(need?.detail ?? "", /planner/);
    // No sentence from the plan: the phase's own, then the step's plain words.
    assert.equal(
      listOf(
        requestsView(
          input({
            status: {
              step: "WAITING",
              waitingOn: "REQUESTS",
              waitingFor: "The list waits for a person to accept it.",
              releasedAt: null,
            },
            requirements: covered,
            summary: summary({ ...nothingLeft }),
          }),
        ),
      ).header.line,
      "The list waits for a person to accept it.",
    );
    assert.equal(
      requestsNeed("Requests accepted", "idle")?.detail,
      SETTLED_LINE,
    );
    assert.doesNotMatch(SETTLED_LINE, /planner/);
  });

  it("offers the acceptance again where the server lists accepted rows to accept", () => {
    // The person whose acceptance stood no longer may accept: the server asks again.
    const again = listOf(
      requestsView(
        input({
          requirements: covered.map((item) => ({ ...item, toAccept: true })),
          summary: summary({
            toAccept: 2,
            uncovered: [],
            working: false,
            waitingFor: "The requests wait for a person to accept them again.",
          }),
        }),
      ),
    );
    assert.equal(again.settled, false);
    assert.deepEqual(
      again.rows.map((row) => row.state),
      ["TO_ACCEPT", "TO_ACCEPT"],
    );
    assert.equal(again.accept.length, 2);
    assert.deepEqual(again.header, {
      tone: "attention",
      status: "2 to accept",
      line: "The requests wait for a person to accept them again.",
    });
    const need = requestsNeed(
      again.header.status,
      again.header.tone,
      again.header.line,
    );
    assert.equal(need?.kind, "act");
    assert.equal(need?.title, "Accept the D&I requests");
    assert.equal(
      need?.detail,
      "The requests wait for a person to accept them again.",
    );
    // Requests the agent proposed, not yet accepted by anyone, keep the plain words.
    assert.equal(listOf(requestsView(input())).header.line, "");
    assert.match(
      requestsNeed("1 to accept", "attention")?.detail ?? "",
      /The agent proposes what to request/,
    );
  });

  it("shows the list at rest while the requests are drafted, then gives way", () => {
    const released = (at: string | null, requirements = covered) =>
      requestsView(
        input({
          status: {
            step: "RELEASED",
            waitingOn: "",
            waitingFor: "",
            releasedAt: at,
          },
          requirements,
          summary: summary({ ...nothingLeft, settled: true, released: true }),
        }),
      );
    const drafting = listOf(released("2026-11-12T09:59:30Z"));
    assert.equal(drafting.mode, "drafting");
    assert.equal(drafting.working, true);
    assert.equal(drafting.settled, false);
    assert.deepEqual(drafting.accept, []);
    assert.deepEqual(pill(drafting.header), {
      tone: "active",
      status: "Requests accepted",
    });
    assert.deepEqual(
      drafting.rows.map((row) => row.state),
      ["ACCEPTED", "ACCEPTED"],
    );
    // A request drafted: the evidence workspace takes over.
    assert.equal(
      released("2026-11-12T09:59:30Z", [
        walkthrough,
        requirement({ state: "DRAFT", requestId: uuid(31), accepted: true }),
      ]).mode,
      "hidden",
    );
    // Long after the release nothing is waited on: the workspace shows what is there.
    assert.equal(
      released(new Date(NOW - DRAFTING_WINDOW_MS).toISOString()).mode,
      "hidden",
    );
    // A release with no time, a time not read, or one well ahead of the clock is not
    // waited on; one a few seconds ahead is the release just made, on another clock.
    assert.equal(released(null).mode, "hidden");
    assert.equal(released("not a date").mode, "hidden");
    assert.equal(released("2026-11-12T10:05:00Z").mode, "hidden");
    assert.equal(released("2026-11-12T10:00:05Z").mode, "drafting");
    // Nothing to draft.
    assert.equal(released("2026-11-12T09:59:30Z", []).mode, "hidden");
  });

  it("waits, in one line, while an earlier step holds it", () => {
    const waiting = (waitingOn: "UNDERSTANDING" | "ATTRIBUTES") =>
      requestsView(
        input({
          status: {
            step: "WAITING",
            waitingOn,
            waitingFor: "",
            releasedAt: null,
          },
        }),
      );
    const understanding = waiting("UNDERSTANDING");
    assert.equal(understanding.mode, "waiting");
    assert.match(
      understanding.mode === "waiting" ? understanding.line : "",
      /Control Understanding is complete/,
    );
    const attributes = waiting("ATTRIBUTES");
    assert.equal(attributes.mode, "waiting");
    assert.match(
      attributes.mode === "waiting" ? attributes.line : "",
      /once the attributes are settled/,
    );
  });

  it("is hidden where the step is not the list's", () => {
    assert.equal(requestsView(input({ status: null })).mode, "hidden");
    for (const step of ["NOT_APPLICABLE", "AWAITING_PLAN", "COMPLETE"]) {
      assert.equal(
        requestsView(
          input({
            status: { step, waitingOn: "", waitingFor: "", releasedAt: null },
          }),
        ).mode,
        "hidden",
        step,
      );
    }
  });
});

describe("the D&I requests list: what the server says over the page's own reading", () => {
  const covered = [
    walkthrough,
    requirement({
      accepted: true,
      toAccept: false,
      attributeIds: [B, D],
      acceptedBy: "Dana Reyes",
    }),
  ];
  const nothingLeft = summary({ toAccept: 0, uncovered: [] });

  it("takes the planner at work from the plan, and the test plan's state only without it", () => {
    const working = (flag: boolean | null, fallback: boolean) =>
      listOf(
        requestsView(
          input({ summary: summary({ working: flag }), working: fallback }),
        ),
      ).working;
    assert.equal(working(true, false), true);
    // The plan says the planner is not at work, whatever the test plan's state reads.
    assert.equal(working(false, true), false);
    // Not said: the test plan's state decides, as before the server sent it.
    assert.equal(working(null, true), true);
    assert.equal(working(null, false), false);
    assert.equal(
      listOf(requestsView(input({ summary: null, working: true }))).working,
      true,
    );
  });

  it("takes the drafting from the plan, and the release's time only without it", () => {
    const view = (
      drafting: boolean | null,
      step: string,
      releasedAt: string | null,
    ) =>
      requestsView(
        input({
          status: { step, waitingOn: "", waitingFor: "", releasedAt },
          requirements: covered,
          summary: summary({ ...nothingLeft, released: true, drafting }),
        }),
      );
    // The server says so: no clock is read, however long ago the release was.
    const said = view(true, "RELEASED", "2026-11-12T08:00:00Z");
    assert.equal(said.mode, "drafting");
    assert.deepEqual(pill(listOf(said).header), {
      tone: "active",
      status: "Requests accepted",
    });
    assert.equal(listOf(said).working, true);
    assert.equal(listOf(said).settled, false);
    // The server says it is not: the workspace, even seconds after the release.
    assert.equal(
      view(false, "RELEASED", "2026-11-12T09:59:50Z").mode,
      "hidden",
    );
    // Not said: the release's time decides, as before the server sent it.
    assert.equal(
      view(null, "RELEASED", "2026-11-12T09:59:50Z").mode,
      "drafting",
    );
    assert.equal(view(null, "RELEASED", "2026-11-12T08:00:00Z").mode, "hidden");
    // Drafting, with the phase's own read a moment behind: still the list at rest.
    assert.equal(view(true, "READY", null).mode, "drafting");
  });

  it("keeps the procedures a request serves from the plan, the test plan's only without them", () => {
    const row = (
      procedureIds: string[] | null,
      procedures: RequestsInput["procedures"],
    ) =>
      listOf(
        requestsView(
          input({ requirements: [requirement({ procedureIds })], procedures }),
        ),
      ).rows[0]?.procedureIds;
    // The plan carries them: the test plan need not be read at all.
    assert.deepEqual(row([uuid(21)], null), [uuid(21)]);
    assert.deepEqual(row([], { [POLICY]: [uuid(22)] }), []);
    // Not sent: the test plan's record, and nothing where it was not read either.
    assert.deepEqual(row(null, { [POLICY]: [uuid(22)] }), [uuid(22)]);
    assert.equal(row(null, null), null);
  });
});

describe("the D&I Evidence step's pill and decision row", () => {
  it("reads the list's standing back from its header", () => {
    const cases: Array<[string, string, string | null]> = [
      ["3 to accept", "attention", "TO_ACCEPT"],
      [REQUESTS_STATUS.toAccept, "attention", "TO_ACCEPT"],
      ["Attribute D is not addressed", "attention", "UNCOVERED"],
      ["Attribute AB is not addressed", "attention", "UNCOVERED"],
      ["2 attributes not addressed", "attention", "UNCOVERED"],
      [REQUESTS_STATUS.uncovered, "attention", "UNCOVERED"],
      [REQUESTS_STATUS.empty, "attention", "EMPTY"],
      [REQUESTS_STATUS.planning, "active", "PLANNING"],
      [REQUESTS_STATUS.updating, "active", "PLANNING"],
      [REQUESTS_STATUS.accepted, "active", "DRAFTING"],
      // Accepted and not being drafted yet: settled, whatever tone it is drawn in.
      [REQUESTS_STATUS.accepted, "idle", "SETTLED"],
      [REQUESTS_STATUS.accepted, "attention", "SETTLED"],
      // The step's statuses once its requests are drafted are not the list's.
      ["2 items to request", "attention", null],
      ["1 of 2 accepted", "done", null],
      ["Waiting on the attributes", "idle", null],
    ];
    for (const [status, tone, standing] of cases) {
      assert.equal(requestsStanding(status, tone), standing, status);
    }
  });

  it("asks for the acceptance, with no action of its own and no release", () => {
    const need = requestsNeed("3 to accept", "attention");
    assert.equal(need?.kind, "act");
    assert.equal(need?.title, "Accept the D&I requests");
    assert.match(need?.detail ?? "", /still approved before it is sent/);
    assert.equal(need !== null && "action" in need, false);
    for (const status of [
      "3 to accept",
      "Attribute D is not addressed",
      REQUESTS_STATUS.empty,
    ]) {
      const each = requestsNeed(status, "attention");
      assert.doesNotMatch(`${each?.title} ${each?.detail}`, /release/i);
    }
  });

  it("names the uncovered attribute and both ways to resolve it", () => {
    const need = requestsNeed("Attribute D is not addressed", "attention");
    assert.equal(need?.kind, "act");
    assert.equal(need?.title, "Attribute D is not addressed");
    assert.match(need?.detail ?? "", /Add it to a request, or record why/);
  });

  it("says one quiet line while the planner works or the requests are drafted", () => {
    const planning = requestsNeed(REQUESTS_STATUS.updating, "active");
    assert.equal(planning?.kind, "agent");
    assert.match(planning?.detail ?? "", /planner is preparing the requests/);
    const drafting = requestsNeed(REQUESTS_STATUS.accepted, "active");
    assert.equal(drafting?.kind, "agent");
    assert.match(drafting?.detail ?? "", /^Drafting the requests\./);
    assert.match(
      drafting?.detail ?? "",
      /approved before it goes to the client/,
    );
  });

  // Product owner, 12 November 2026: "Yes. I don't want a separate D&I release." The server
  // releases a settled list itself (when the planner finishes, if it is still at work),
  // so the page never offers to draft or release it.
  // Old expectation: a settled list asked the person to "Draft the D&I requests" (kind
  // act); then, after "I don't want a separate D&I release.", it read "Drafting starts
  // when the planner finishes" in every settled state. New (review finding 4): that is
  // said only where the list's own line says the planner is at work; otherwise the step
  // waits in plain words, or in the server's sentence. No action in any of them.
  it("only waits on a settled list: no draft and no release is ever asked for", () => {
    const settled = requestsNeed(REQUESTS_STATUS.accepted, "idle");
    assert.equal(settled?.kind, "wait");
    assert.equal(settled?.title, "Requests accepted");
    assert.equal(settled?.detail, SETTLED_LINE);
    assert.equal(settled !== null && "action" in settled, false);
    // The planner still at work: the list's own line, with the reading treatment.
    const finishing = requestsNeed(
      REQUESTS_STATUS.accepted,
      "active",
      "Drafting starts when the planner finishes. Each request is approved before it goes to the client.",
    );
    assert.equal(finishing?.kind, "agent");
    assert.match(
      finishing?.detail ?? "",
      /^Drafting starts when the planner finishes\./,
    );
    const statuses: Array<[string, string]> = [
      ["3 to accept", "attention"],
      ["Attribute D is not addressed", "attention"],
      [REQUESTS_STATUS.empty, "attention"],
      [REQUESTS_STATUS.updating, "active"],
      [REQUESTS_STATUS.accepted, "active"],
      [REQUESTS_STATUS.accepted, "idle"],
      [REQUESTS_STATUS.accepted, "attention"],
    ];
    for (const [status, tone] of statuses) {
      const need = requestsNeed(status, tone);
      assert.ok(need !== null, status);
      assert.doesNotMatch(
        `${need.title} ${need.detail}`,
        /Draft the D&I requests|release|planner finishes/i,
        status,
      );
    }
    assert.equal(requestsNeed(REQUESTS_STATUS.empty, "attention")?.kind, "act");
    assert.equal(requestsNeed("2 items to request", "attention"), null);
  });

  it("falls back to the phase's own state where the plan was not read", () => {
    // Old: tone attention, a settled list being a person's to draft. New: at rest.
    assert.deepEqual(pill(requestsFallback("READY", "")), {
      tone: "idle",
      status: "Requests accepted",
    });
    assert.deepEqual(pill(requestsFallback("WAITING", "REQUESTS")), {
      tone: "attention",
      status: "Requests to accept",
    });
    assert.deepEqual(pill(requestsFallback("WAITING", "EVIDENCE")), {
      tone: "attention",
      status: "Attributes not addressed",
    });
    assert.deepEqual(pill(requestsFallback("WAITING", undefined)), {
      tone: "attention",
      status: "Requests to accept",
    });
    assert.equal(requestsFallback("RELEASED", ""), null);
    assert.equal(requestsFallback("COMPLETE", ""), null);
  });
});

describe("the D&I requests list: what the server sends", () => {
  it("reads a requirement's acceptance and the attributes it addresses", () => {
    assert.deepEqual(
      parseRequestAcceptance({
        attribute_ids: [A, C, A],
        accepted: true,
        accepted_by: "Dana Reyes",
        accepted_at: "2026-11-12T09:30:00Z",
        to_accept: false,
        person_edited: true,
        procedure_ids: [uuid(21), uuid(21), uuid(22)],
      }),
      {
        attributeIds: [A, C],
        accepted: true,
        acceptedBy: "Dana Reyes",
        acceptedAt: "2026-11-12T09:30:00Z",
        toAccept: false,
        personEdited: true,
        procedureIds: [uuid(21), uuid(22)],
      },
    );
    // Sent, and empty: it serves no procedure, which is not the same as not sent.
    assert.deepEqual(
      parseRequestAcceptance({ procedure_ids: [] }).procedureIds,
      [],
    );
  });

  it("falls back to not accepted for anything missing or of the wrong type", () => {
    const cautious = {
      attributeIds: [],
      accepted: false,
      acceptedBy: null,
      acceptedAt: null,
      toAccept: null,
      personEdited: false,
      procedureIds: null,
    };
    assert.deepEqual(parseRequestAcceptance({}), cautious);
    assert.deepEqual(
      parseRequestAcceptance({
        attribute_ids: "all",
        accepted: "true",
        accepted_by: 7,
        accepted_at: "",
        to_accept: "no",
        person_edited: 1,
        procedure_ids: "none",
      }),
      cautious,
    );
    assert.deepEqual(
      parseRequestAcceptance({ attribute_ids: [A, 3, null, "", B] })
        .attributeIds,
      [A, B],
    );
  });

  it("reads the plan's summary, or none", () => {
    assert.deepEqual(
      parseDesignRequests({
        settled: false,
        released: false,
        to_accept: 2,
        uncovered: [D],
        exceptions: [
          {
            attribute_id: C,
            reason: "Tested on each operating-effectiveness sample.",
            recorded_by: "Dana Reyes",
            recorded_at: "2026-11-12T09:45:00Z",
          },
          { reason: "no attribute named" },
          "not a record",
        ],
        waiting_for: "2 requests wait to be accepted.",
        working: true,
        drafting: false,
      }),
      {
        settled: false,
        released: false,
        toAccept: 2,
        uncovered: [D],
        exceptions: [
          {
            attributeId: C,
            reason: "Tested on each operating-effectiveness sample.",
            recordedBy: "Dana Reyes",
            recordedAt: "2026-11-12T09:45:00Z",
          },
        ],
        waitingFor: "2 requests wait to be accepted.",
        working: true,
        drafting: false,
      },
    );
    for (const missing of [undefined, null, "settled", [], 3]) {
      assert.equal(parseDesignRequests(missing), null);
    }
    // Settled and released only on the server's own true; whether the planner works or
    // the requests are drafted is not known unless the server says so.
    assert.deepEqual(
      parseDesignRequests({
        settled: "yes",
        released: 1,
        to_accept: -2,
        working: "yes",
        drafting: 1,
      }),
      {
        settled: false,
        released: false,
        toAccept: 0,
        uncovered: [],
        exceptions: [],
        waitingFor: "",
        working: null,
        drafting: null,
      },
    );
  });

  it("carries them on the parsed evidence plan", () => {
    const plan = parsePlan({
      control_id: uuid(40),
      status: "PROPOSED",
      phases: [
        {
          phase: "DESIGN",
          requirements: [
            {
              id: POLICY,
              phase: "DESIGN",
              title: "Access provisioning policy",
              state: "NOT_GENERATED",
              origin: "AGENT",
              version: 3,
              attribute_ids: [B],
              accepted: true,
              accepted_by: "Dana Reyes",
              accepted_at: "2026-11-12T09:30:00Z",
              to_accept: false,
            },
            // An older body, without the list's fields: never read as accepted.
            { id: WALK, phase: "DESIGN", title: "One instance", version: 1 },
          ],
        },
      ],
      design_requests: {
        settled: false,
        released: false,
        to_accept: 1,
        uncovered: [A],
        exceptions: [],
        waiting_for: "1 request waits to be accepted.",
      },
    });
    const design = plan?.phases.find((phase) => phase.phase === "DESIGN");
    assert.deepEqual(
      design?.requirements.map((item) => [
        item.attributeIds,
        item.accepted,
        item.acceptedBy,
        item.toAccept,
      ]),
      [
        [[B], true, "Dana Reyes", false],
        [[], false, null, null],
      ],
    );
    assert.equal(plan?.designRequests?.toAccept, 1);
    assert.deepEqual(plan?.designRequests?.uncovered, [A]);
    // A plan body without the summary.
    assert.equal(
      parsePlan({ control_id: uuid(40), phases: [] })?.designRequests,
      null,
    );
    // The parsed plan feeds the list as it is.
    const view = listOf(
      requestsView(
        input({
          requirements: design?.requirements ?? [],
          summary: plan?.designRequests ?? null,
          procedures: null,
        }),
      ),
    );
    assert.deepEqual(
      view.rows.map((row) => row.state),
      ["ACCEPTED", "TO_ACCEPT"],
    );
  });

  it("reads what the D&I phase waits on, REQUESTS and EVIDENCE included", () => {
    assert.equal(waitingOnOf("REQUESTS"), "REQUESTS");
    assert.equal(waitingOnOf("EVIDENCE"), "EVIDENCE");
    assert.equal(waitingOnOf("UNDERSTANDING"), "UNDERSTANDING");
    assert.equal(waitingOnOf("ATTRIBUTES"), "ATTRIBUTES");
    for (const other of ["", "requests", "RELEASE", null, undefined, 4]) {
      assert.equal(waitingOnOf(other), "");
    }
    const phases = (waitingOn: unknown) =>
      parsePhaseProgress({
        controls: [
          {
            control_id: uuid(40),
            phases: [
              { phase: "DESIGN", step: "WAITING", waiting_on: waitingOn },
            ],
          },
        ],
      })?.controls[0]?.phases[0]?.waitingOn;
    assert.equal(phases("REQUESTS"), "REQUESTS");
    assert.equal(phases("EVIDENCE"), "EVIDENCE");
    assert.equal(phases("SOMETHING_NEW"), "");
  });
});

describe("the D&I requests list: forms", () => {
  it("offers the kinds of D&I evidence, the walkthrough instance first", () => {
    assert.equal(ADD_KINDS[0]?.label, "Walkthrough instance");
    assert.deepEqual(
      ADD_KINDS.map((kind) => kind.category),
      [
        "CONTROL_EXECUTION",
        "PROCESS_DOCUMENTATION",
        "CONFIGURATION",
        "REPORT_RELIABILITY",
        "OTHER",
      ],
    );
  });

  it("sends a new request or an edit only within the routes' lengths", () => {
    const good = {
      title: "Access policy",
      description: "The approved access policy.",
      shows: "How access is approved.",
    };
    assert.equal(requestReady(good, "add"), true);
    assert.equal(requestReady({ ...good, title: "ab" }, "add"), false);
    assert.equal(
      requestReady({ ...good, description: "too short" }, "add"),
      false,
    );
    assert.equal(requestReady({ ...good, shows: "short" }, "add"), false);
    assert.equal(
      requestReady({ title: good.title, description: good.description }, "add"),
      false,
    );
    assert.equal(requestReady({ ...good, title: "   ab   " }, "add"), false);
    // An edit changes the title and the description only, and its description runs longer.
    assert.equal(
      requestReady(
        { title: good.title, description: good.description },
        "edit",
      ),
      true,
    );
    const long = "x".repeat(1501);
    assert.equal(requestReady({ ...good, description: long }, "add"), false);
    assert.equal(requestReady({ ...good, description: long }, "edit"), true);
    assert.equal(
      requestReady({ ...good, description: "x".repeat(3001) }, "edit"),
      false,
    );
  });

  it("takes a coverage reason only when it is long enough to stand on its own", () => {
    assert.equal(EXCEPTION_REASON_MIN, 20);
    assert.equal(EXCEPTION_REASON_MAX, 500);
    const short = reasonCheck("Tested at OE");
    assert.equal(short.enabled, false);
    assert.equal(short.left, 8);
    assert.match(short.hint, /At least 8 more characters\./);
    assert.match(reasonCheck("x".repeat(19)).hint, /1 more character\./);
    // Spaces do not count.
    assert.equal(reasonCheck(`${" ".repeat(30)}short`).enabled, false);
    const enough = reasonCheck("It is tested on each operating sample.");
    assert.equal(enough.enabled, true);
    assert.equal(enough.hint, "Recorded with your name.");
    assert.equal(reasonCheck("x".repeat(501)).enabled, false);
  });
});

describe("the D&I requests list: actions", () => {
  const ids = {
    organization_id: uuid(51),
    project_id: uuid(52),
    control_id: uuid(53),
  };
  const control = `/organizations/${uuid(51)}/projects/${uuid(52)}/controls/${uuid(53)}`;

  it("accepts the requests shown, each at its version, in one call", () => {
    assert.deepEqual(
      requestsWrite({
        ...ids,
        intent: "requests-accept",
        items: [
          { requirement_id: POLICY, version: 3 },
          { requirement_id: WALK, version: "5", ignored: true },
        ],
      }),
      {
        intent: "requests-accept",
        method: "POST",
        path: `${control}/design-requests/accept`,
        body: {
          items: [
            { requirement_id: POLICY, version: 3 },
            { requirement_id: WALK, version: 5 },
          ],
        },
      },
    );
  });

  it("refuses an acceptance that is empty, repeated, unversioned or too large", () => {
    const refused = (items: unknown) =>
      assert.deepEqual(
        requestsWrite({ ...ids, intent: "requests-accept", items }),
        { error: "invalid" },
      );
    refused(undefined);
    refused([]);
    refused("all");
    refused([{ requirement_id: POLICY }]);
    refused([{ requirement_id: POLICY, version: 0 }]);
    refused([{ requirement_id: POLICY, version: 1.5 }]);
    refused([{ requirement_id: "policy", version: 1 }]);
    // One bad item refuses the set: all or none.
    refused([{ requirement_id: POLICY, version: 3 }, "walkthrough"]);
    refused([
      { requirement_id: POLICY, version: 3 },
      { requirement_id: POLICY, version: 3 },
    ]);
    refused(
      Array.from({ length: ACCEPT_MAX + 1 }, (_, at) => ({
        requirement_id: uuid(1000 + at),
        version: 1,
      })),
    );
    assert.ok(
      !(
        "error" in
        requestsWrite({
          ...ids,
          intent: "requests-accept",
          items: Array.from({ length: ACCEPT_MAX }, (_, at) => ({
            requirement_id: uuid(1000 + at),
            version: 1,
          })),
        })
      ),
    );
  });

  it("records why an attribute is not evidenced at D&I", () => {
    assert.deepEqual(
      requestsWrite({
        ...ids,
        intent: "exception-record",
        attribute_id: D,
        reason: "  It is tested on each operating sample.  ",
      }),
      {
        intent: "exception-record",
        method: "PUT",
        path: `${control}/design-coverage/${D}/exception`,
        body: { reason: "It is tested on each operating sample." },
      },
    );
    const refused = (fields: Record<string, unknown>) =>
      assert.deepEqual(
        requestsWrite({ ...ids, intent: "exception-record", ...fields }),
        { error: "invalid" },
      );
    refused({ attribute_id: D, reason: "Too short a reason." });
    refused({ attribute_id: D, reason: "x".repeat(501) });
    refused({ attribute_id: "D", reason: "It is tested on each sample." });
    refused({ attribute_id: D });
    // No credential goes on the record.
    refused({
      attribute_id: D,
      reason: "The client sent password: hunter2 for the system.",
    });
  });

  it("adds a request with the attributes it addresses, in the same call", () => {
    const fields = {
      organization_id: uuid(51),
      project_id: uuid(52),
      control_id: uuid(53),
      intent: "evidence-add",
      phase: "DESIGN",
      category: "CONTROL_EXECUTION",
      title: "One access request, end to end",
      description: "One request traced from ticket to access granted.",
      objective: "One instance, start to finish.",
      necessity: "REQUIRED",
    };
    const added = planningWrite({ ...fields, attribute_ids: [A, D, A] });
    assert.ok(!("error" in added));
    assert.equal(added.method, "POST");
    assert.equal(added.path, `${control}/evidence-requirements`);
    assert.deepEqual(added.body, {
      phase: "DESIGN",
      title: "One access request, end to end",
      description: "One request traced from ticket to access granted.",
      categories: ["CONTROL_EXECUTION"],
      objective: "One instance, start to finish.",
      rationale: "One instance, start to finish.",
      necessity: "REQUIRED",
      attribute_ids: [A, D],
    });
    // None chosen, or the field left out: the call is what it was before.
    for (const none of [{ ...fields, attribute_ids: [] }, fields]) {
      const plain = planningWrite(none);
      assert.ok(!("error" in plain));
      assert.equal("attribute_ids" in plain.body, false);
    }
    assert.deepEqual(planningWrite({ ...fields, attribute_ids: ["D"] }), {
      error: "invalid",
    });
    assert.deepEqual(planningWrite({ ...fields, attribute_ids: "all" }), {
      error: "invalid",
    });
  });

  // Review finding 2 (12 November 2026). Old body: {attribute_ids, procedure_ids}. New,
  // from the D&I requests list: the requirement's version as shown goes with them, so
  // its attributes are never changed over a request that changed meanwhile.
  it("changes a request's attributes at the version the person saw", () => {
    const fields = {
      organization_id: uuid(51),
      project_id: uuid(52),
      control_id: uuid(53),
      intent: "evidence-links",
      requirement_id: WALK,
      attribute_ids: [A, C, D],
      procedure_ids: [uuid(21)],
    };
    const linked = planningWrite({ ...fields, version: 5 });
    assert.ok(!("error" in linked));
    assert.equal(linked.method, "PUT");
    assert.equal(linked.path, `${control}/master-plan/evidence/${WALK}/links`);
    assert.deepEqual(linked.body, {
      attribute_ids: [A, C, D],
      procedure_ids: [uuid(21)],
      version: 5,
    });
    // A version that is not one refuses the call; it is never sent without it.
    for (const version of [0, "five", 1.5, null]) {
      assert.deepEqual(planningWrite({ ...fields, version }), {
        error: "invalid",
      });
    }
    // The test plan's own review names no version, and its call is what it was.
    const plain = planningWrite(fields);
    assert.ok(!("error" in plain));
    assert.deepEqual(plain.body, {
      attribute_ids: [A, C, D],
      procedure_ids: [uuid(21)],
    });
    // Both of the list's dialogs send it.
    const view = readFileSync(
      new URL("../apps/web/src/design-requests.tsx", import.meta.url),
      "utf8",
    );
    assert.match(
      view,
      /version: row\.version,\s+\/\/ In the attributes' order/,
    );
    assert.match(
      view,
      /version: target\.version,\s+attribute_ids: withAttribute/,
    );
  });

  // Review finding 9 (12 November 2026). Old behaviour: the list was read again every 3
  // seconds for as long as the server said working or drafting, with its actions off.
  // New: for ten minutes; then it stops and says so, with "Check again".
  it("reads the list again for ten minutes at most while the work is on", () => {
    assert.equal(POLL_EVERY_MS, 3000);
    assert.equal(POLL_LIMIT_MS, 10 * 60 * 1000);
    assert.equal(pollingOver(0), false);
    assert.equal(pollingOver(POLL_LIMIT_MS - 1), false);
    assert.equal(pollingOver(POLL_LIMIT_MS), true);
    assert.equal(pollingOver(POLL_LIMIT_MS + POLL_EVERY_MS), true);
    assert.match(STALLED_LINE, /stopped checking/);
    const view = readFileSync(
      new URL("../apps/web/src/design-requests.tsx", import.meta.url),
      "utf8",
    );
    // The view's reading is the bounded one, and offers the one way to start it again.
    assert.match(view, /pollingOver\(Date\.now\(\) - started\)/);
    assert.match(view, /POLL_EVERY_MS/);
    assert.doesNotMatch(view, /setInterval\(\(\) => router\.refresh\(\)/);
    assert.match(view, /Check again/);
  });

  it("clears a recorded reason, with no body", () => {
    assert.deepEqual(
      requestsWrite({ ...ids, intent: "exception-clear", attribute_id: D }),
      {
        intent: "exception-clear",
        method: "DELETE",
        path: `${control}/design-coverage/${D}/exception`,
        body: null,
      },
    );
    assert.deepEqual(
      requestsWrite({ ...ids, intent: "exception-clear", attribute_id: "D" }),
      { error: "invalid" },
    );
  });

  it("refuses an unknown action, and one for no control", () => {
    assert.deepEqual(requestsWrite({ ...ids, intent: "phase-release" }), {
      error: "invalid",
    });
    assert.deepEqual(requestsWrite({ ...ids }), { error: "invalid" });
    assert.deepEqual(
      requestsWrite({
        ...ids,
        control_id: "the-control",
        intent: "exception-clear",
        attribute_id: D,
      }),
      { error: "invalid" },
    );
  });

  it("says the list changed on a stale answer, and reads it again", () => {
    assert.equal(requestsProblem(200), null);
    assert.equal(requestsProblem(409, "the requirement changed"), LIST_CHANGED);
    assert.equal(requestsProblem(409), LIST_CHANGED);
    assert.match(LIST_CHANGED, /list changed/);
    assert.match(LIST_CHANGED, /nothing was saved/);
    assert.equal(readsAgain(409), true);
    for (const status of [200, 403, 404, 422]) {
      assert.equal(readsAgain(status), false);
    }
  });

  it("claims nothing when no answer came back, and reads the list again", () => {
    // Whether the server saved it is not known: neither success nor "nothing changed".
    for (const status of [0, 500, 502, 504]) {
      assert.equal(requestsProblem(status), NOT_CONFIRMED);
      assert.equal(readsAgain(status), true);
    }
    assert.match(NOT_CONFIRMED, /could not be confirmed/);
    assert.match(NOT_CONFIRMED, /try again if it did not change/);
    assert.equal(requestsProblem(400), "That could not be saved. Try again.");
  });

  it("shows the server's own reason for a refusal, and how to recover otherwise", () => {
    // A refusal written for people is shown as it is.
    assert.equal(
      requestsProblem(
        409,
        "The D&I evidence waits: 1 proposed attribute waits for a decision.",
      ),
      "The D&I evidence waits: 1 proposed attribute waits for a decision.",
    );
    assert.match(
      requestsProblem(
        409,
        "it has already been requested from the client; waive it instead",
      ) ?? "",
      /already gone to the client/,
    );
    assert.match(
      requestsProblem(409, "link only the control's approved attributes") ?? "",
      /approved attributes/,
    );
    assert.match(requestsProblem(403) ?? "", /role/);
    assert.match(requestsProblem(404) ?? "", /role/);
    assert.match(requestsProblem(422) ?? "", /long enough/);
    // The list's routes word what is wrong in a sentence, on a 422 as on a 409.
    assert.equal(
      requestsProblem(422, "The reason needs at least 20 characters."),
      "The reason needs at least 20 characters.",
    );
    assert.match(requestsProblem(422, "string_too_short") ?? "", /long enough/);
    assert.match(
      requestsProblem(422, "the text must not contain credentials") ?? "",
      /credentials/,
    );
  });

  it("has a route for the calls the list makes, with each method it needs", () => {
    const view = readFileSync(
      new URL("../apps/web/src/design-requests.tsx", import.meta.url),
      "utf8",
    );
    assert.match(view, /requests: "\/workspace\/design-requests"/);
    assert.match(view, /planning: "\/workspace\/planning"/);
    assert.match(view, /plan: "\/workspace\/evidence-plan"/);
    for (const path of ["design-requests", "planning", "evidence-plan"]) {
      const route = new URL(
        `../apps/web/app/workspace/${path}/route.ts`,
        import.meta.url,
      );
      assert.ok(existsSync(route), path);
      assert.match(readFileSync(route, "utf8"), /export async function POST/);
    }
    const route = readFileSync(
      new URL(
        "../apps/web/app/workspace/design-requests/route.ts",
        import.meta.url,
      ),
      "utf8",
    );
    // The builder's method reaches the API: PUT and DELETE are not sent as POST.
    assert.match(route, /method: write\.method/);
    assert.match(route, /requestsWrite\(fields\)/);
  });

  it("shows no Release button and no early release on the step", () => {
    const view = readFileSync(
      new URL("../apps/web/src/design-requests.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(view, /Release early|>\s*Release\s*</);
    // Nor a draft button: the fallback that called the D&I release is gone ("I don't
    // want a separate D&I release.").
    assert.doesNotMatch(view, /Draft the requests|phase-release|canRelease/);
    const controls = readFileSync(
      new URL("../apps/web/src/controls-view.tsx", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(controls, /DesignReleaseCard|DesignReleaseItems/);
    assert.match(controls, /<DesignRequests/);
    assert.equal(
      existsSync(
        new URL("../apps/web/src/design-release.tsx", import.meta.url),
      ),
      false,
    );
  });
});
