import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  type Carrier,
  carriersOf,
  daysOverdue,
  deliveryLabel,
  EVIDENCE_CHIPS,
  type EvidenceInput,
  evidenceActivity,
  evidenceList,
  fileMeta,
  IN_HAND_REFUSALS,
  lettersSpan,
  NOTHING_RECEIVED,
  type Requirement,
  readSeam,
  rereadsRequests,
  rowMenu,
  sentReason,
} from "../apps/web/src/design-evidence-model.ts";
import {
  type Assessment,
  parsePlan,
  type RequirementFile,
} from "../apps/web/src/evidence-plan-model.ts";

// The D&I Evidence step once its requests are drafted (product owner, 12 November 2026):
// "This view is again so heavy and a lot of duplicates labels and purpose. Just simplify
// this where the user can easily edit the request, add another evidence request, and can
// easily upload any evidence that was received. Still keep the option to send out the
// request to the process owners." One list, one row per request, in the vocabulary the
// owner approved: To send, In hand, With owner, Overdue, Reading…, To review, Follow-up
// sent, Evidence accepted.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D, E] = [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5)] as const;
const [POLICY, WALK] = [uuid(11), uuid(12)] as const;
const REQUEST = uuid(21);
const FOLLOW = uuid(22);
// 14 November 2026, noon UTC: before the due date of 26 November.
const NOW = Date.parse("2026-11-14T12:00:00Z");

const approved = [A, B, C, D, E].map((id, at) => ({
  id,
  text: `Attribute ${at + 1} wording.`,
  sourceKind: at < 4 ? "LIBRARY" : "AGENT",
}));

function file(overrides: Partial<RequirementFile> = {}): RequirementFile {
  return {
    fileId: uuid(31),
    name: "SAP_Access_Provisioning_Procedure_v3.2.pdf",
    via: "REQUEST",
    sharedFrom: null,
    linkId: null,
    linkedBy: null,
    reason: "",
    linkVersion: null,
    readStatus: "READY",
    readBy: "MODEL",
    kind: null,
    kindConfirmed: false,
    coverage: "COVERED",
    note: "",
    period: "",
    gaps: [],
    ...overrides,
  };
}

function requirement(overrides: Partial<Requirement> = {}): Requirement {
  return {
    id: POLICY,
    phase: "DESIGN",
    title: "User access management policy and provisioning procedure",
    description: "The policy and procedure for granting access, in force.",
    categories: ["PROCESS_DOCUMENTATION"],
    necessity: "REQUIRED",
    state: "DRAFT",
    pendingChange: null,
    version: 3,
    requestId: REQUEST,
    files: [],
    assessment: { proposal: "NONE", reason: "", followUps: [] },
    sufficiencyNote: "",
    sufficiencyBy: null,
    waiveReason: "",
    periodLabel: "",
    attributeIds: [A, B, C, D],
    procedureIds: [],
    accepted: true,
    acceptedBy: "Daniel Osei",
    acceptedAt: "2026-11-12T08:00:00Z",
    ...overrides,
  } as Requirement;
}

const walk = (overrides: Partial<Requirement> = {}) =>
  requirement({
    id: WALK,
    title: "One access request traced from request to grant",
    categories: ["CONTROL_EXECUTION"],
    attributeIds: [A, B, C, D, E],
    ...overrides,
  });

function carrier(overrides: Partial<Carrier> = {}): Carrier {
  return {
    id: REQUEST,
    kind: "EVIDENCE",
    status: "DRAFT",
    dueAt: "2026-11-26",
    recipient: "maria.keller@example.com",
    ...overrides,
  };
}

const SENT = { mode: "EMAIL", at: "2026-11-12T09:00:00Z", by: null } as const;
const sufficient: Assessment = {
  proposal: "SUFFICIENT",
  reason:
    "Version 3.2, approved 3 Mar 2026, requires line-manager approval before provisioning",
  followUps: [],
};

function list(overrides: Partial<EvidenceInput> = {}) {
  return evidenceList({
    requirements: [requirement(), walk()],
    approved,
    requests: [carrier()],
    owner: { name: "Maria Keller", role: "IT Access Manager" },
    exceptions: [],
    liveEmail: null,
    procedures: null,
    period: "The control as currently designed",
    now: NOW,
    ...overrides,
  });
}

const line = (view: ReturnType<typeof list>) => view.groups[0]?.line;
const chips = (view: ReturnType<typeof list>) =>
  view.rows.map((row) => row.chip.label);

describe("the server seam, read in one place", () => {
  it("falls back to the cautious reading for anything missing or malformed", () => {
    assert.deepEqual(readSeam(undefined), {
      inHand: false,
      delivery: null,
      liveEmail: null,
    });
    assert.deepEqual(
      readSeam({ in_hand: "yes", delivery: "EMAIL", live_email: 1 }),
      { inHand: false, delivery: null, liveEmail: null },
    );
    // A delivery whose mode is not one the page knows is not a delivery.
    assert.equal(
      readSeam({ delivery: { mode: "FAX", at: "2026-11-12" } }).delivery,
      null,
    );
  });

  it("reads in_hand, the delivery and whether live email is on", () => {
    assert.deepEqual(
      readSeam({
        in_hand: true,
        live_email: false,
        delivery: {
          mode: "HANDED_OVER",
          at: "2026-11-12T09:00:00Z",
          by: "Daniel Osei",
        },
      }),
      {
        inHand: true,
        liveEmail: false,
        delivery: {
          mode: "HANDED_OVER",
          at: "2026-11-12T09:00:00Z",
          by: "Daniel Osei",
        },
      },
    );
    // Sent, with no time or name on record: the mode stands, the rest is unknown.
    assert.deepEqual(
      readSeam({ delivery: { mode: "EMAIL", at: "" } }).delivery,
      {
        mode: "EMAIL",
        at: null,
        by: null,
      },
    );
  });

  it("reaches the plan's requirements and the control's requests through their parsers", () => {
    const requirements =
      parsePlan({
        control_id: uuid(40),
        phases: [
          {
            phase: "DESIGN",
            requirements: [
              { id: POLICY, phase: "DESIGN", in_hand: true },
              { id: WALK, phase: "DESIGN" },
            ],
          },
        ],
      })?.phases.find((phase) => phase.phase === "DESIGN")?.requirements ?? [];
    assert.equal(requirements[0]?.inHand, true);
    // Absent where the server did not say: the requirement reads as before.
    assert.equal(
      requirements[1] !== undefined && "inHand" in requirements[1],
      false,
    );
    const plan = parsePlan({
      control_id: uuid(40),
      live_email: false,
      phases: [
        {
          phase: "DESIGN",
          requests: [
            {
              id: REQUEST,
              reference: "PBC-1",
              status: "APPROVAL_PENDING",
              recipient: "maria.keller@example.com",
              due_at: "2026-11-26T00:00:00Z",
              version: 4,
              delivery: { mode: "HANDED_OVER", at: "2026-11-12", by: "Dana" },
            },
            { id: FOLLOW, reference: "PBC-2", status: "DRAFT", delivery: null },
            { id: uuid(23), reference: "PBC-3", status: "SENT" },
          ],
        },
      ],
    });
    const listed = plan?.phases.find((phase) => phase.phase === "DESIGN");
    assert.deepEqual(listed?.requests[0], {
      id: REQUEST,
      reference: "PBC-1",
      status: "APPROVAL_PENDING",
      recipient: "maria.keller@example.com",
      dueAt: "2026-11-26T00:00:00Z",
      version: 4,
      delivery: { mode: "HANDED_OVER", at: "2026-11-12", by: "Dana" },
    });
    // The server said there was none: null. It did not say: the field is absent.
    assert.equal(listed?.requests[1]?.delivery, null);
    assert.deepEqual(listed?.requests[2], {
      id: uuid(23),
      reference: "PBC-3",
      status: "SENT",
    });
    assert.equal(plan?.liveEmail, false);
    const silent = parsePlan({ control_id: uuid(40), phases: [] });
    assert.equal(silent !== null && "liveEmail" in silent, false);
  });
});

describe("requests drafted: approve and send", () => {
  const view = list();

  it("shows one row per request, each To send, with its kind and no file yet", () => {
    assert.equal(view.title, "Requests · 2");
    assert.deepEqual(chips(view), ["To send", "To send"]);
    assert.deepEqual(
      view.rows.map((row) => row.chip.tone),
      ["ai", "ai"],
    );
    assert.deepEqual(
      view.rows.map((row) => row.sub),
      [
        "Policy or procedure · No file yet",
        "Walkthrough instance · No file yet",
      ],
    );
    assert.deepEqual(
      view.rows.map((row) => row.icon),
      ["file", "list"],
    );
    assert.deepEqual(view.rows[0]?.letters, ["A", "B", "C", "D"]);
    assert.equal(
      view.rows[1]?.addresses,
      "addresses attributes A, B, C, D and E",
    );
    // Nothing waits on a person inside a row: the bar holds the action.
    assert.equal(view.open, null);
    assert.equal(view.rows[0]?.uploadBlocked, null);
  });

  it("says so once, in the pill, the decision line and the agent's line", () => {
    assert.equal(view.header.standing, "SEND");
    assert.equal(view.header.tone, "attention");
    assert.equal(view.header.status, "2 requests to send");
    assert.deepEqual(view.header.need, {
      kind: "act",
      title: "Approve and send 2 requests.",
      detail:
        "Nothing reaches the process owner until you approve. Evidence already in hand? Upload it on its row.",
    });
    assert.equal(
      view.header.agent.did,
      "Drafted 2 requests from the control's understanding and its attributes.",
    );
    assert.deepEqual(view.send, {
      show: true,
      handover: false,
      label: "Approve and send",
    });
    assert.equal(
      list({ requirements: [walk()] }).header.status,
      "1 request to send",
    );
  });

  it("names who they go to and that nothing was sent", () => {
    assert.equal(view.groups.length, 1);
    assert.deepEqual(view.groups[0], {
      key: REQUEST,
      rowIds: [POLICY, WALK],
      label: "",
      line: {
        action: null,
        preview: "Preview the request",
        pending: null,
        requestId: REQUEST,
        to: "Maria Keller",
        role: "IT Access Manager",
        due: "Due Nov 26, 2026",
        status: "Not sent",
        tone: "neutral",
        canChange: true,
        out: false,
        quiet: false,
      },
    });
    // No owner name on the control: the request's own recipient, and no role claimed.
    const unnamed = list({ owner: { name: "", role: "IT Access Manager" } });
    assert.equal(line(unnamed)?.to, "maria.keller@example.com");
    assert.equal(line(unnamed)?.role, "");
    assert.equal(
      list({
        owner: { name: "", role: "" },
        requests: [carrier({ recipient: "" })],
      }).groups[0]?.line.to,
      "No recipient yet",
    );
  });

  it("shows every attribute requested and none evidenced", () => {
    assert.deepEqual(
      view.coverage.map((chip) => chip.state),
      ["REQUESTED", "REQUESTED", "REQUESTED", "REQUESTED", "REQUESTED"],
    );
    assert.equal(
      view.coverageLine,
      "Every attribute is requested · none evidenced yet",
    );
    assert.equal(
      view.activityLine,
      "Requests accepted by Daniel Osei, Nov 12, 2026",
    );
    assert.equal(
      view.sources,
      "the control library and the agent, approved by the team",
    );
  });

  it("holds the send while the request waits for someone else's approval, or is not drafted", () => {
    const pending = list({
      requests: [carrier({ status: "APPROVAL_PENDING" })],
    });
    assert.equal(pending.header.standing, "AWAITING_APPROVAL");
    assert.equal(pending.header.status, "2 awaiting approval");
    assert.equal(pending.header.need.kind, "wait");
    assert.equal(pending.send.show, false);
    assert.equal(line(pending)?.status, "Awaiting approval");
    const none = list({
      requirements: [
        requirement({ state: "NOT_GENERATED", requestId: null }),
        walk({ state: "NOT_GENERATED", requestId: null }),
      ],
      requests: [],
    });
    assert.equal(none.header.standing, "NOT_DRAFTED");
    assert.equal(none.send.show, false);
    assert.equal(line(none)?.status, "Not drafted yet");
    assert.equal(line(none)?.canChange, false);
    assert.match(none.rows[0]?.uploadBlocked ?? "", /not drafted yet/);
  });
});

describe("sent, nothing back", () => {
  const sent = () =>
    list({
      requirements: [requirement({ state: "SENT" }), walk({ state: "SENT" })],
      requests: [carrier({ status: "SENT", delivery: SENT })],
    });

  it("reads With owner, and waits quietly", () => {
    const view = sent();
    assert.deepEqual(chips(view), ["With owner", "With owner"]);
    assert.equal(view.rows[0]?.chip.tone, "info");
    assert.equal(view.header.standing, "WITH_OWNER");
    assert.equal(view.header.tone, "active");
    assert.equal(view.header.status, "2 with the owner");
    assert.deepEqual(view.header.need, {
      kind: "wait",
      title: "With the owner",
      detail:
        "With Maria Keller since Nov 12, 2026, due Nov 26, 2026. Upload what you receive on its row.",
    });
    assert.equal(view.header.agent.did, "Reads each file as it arrives.");
    assert.equal(view.send.show, false);
    assert.equal(line(view)?.status, "Sent Nov 12, 2026");
    assert.equal(line(view)?.tone, "success");
    assert.equal(view.activityLine, "Sent Nov 12, 2026");
    // A row still takes what the owner sends back.
    assert.equal(view.rows[0]?.uploadBlocked, null);
  });

  it("says Sent without a date where the server gives no delivery", () => {
    const view = list({
      requirements: [requirement({ state: "SENT" }), walk({ state: "SENT" })],
      requests: [carrier({ status: "SENT" })],
    });
    assert.equal(line(view)?.status, "Sent");
    assert.equal(
      view.header.need.detail,
      "With Maria Keller, due Nov 26, 2026. Upload what you receive on its row.",
    );
  });

  it("says Overdue, by how many days", () => {
    const late = Date.parse("2026-11-29T12:00:00Z");
    const view = list({
      requirements: [
        requirement({ state: "OVERDUE" }),
        walk({ state: "SENT" }),
      ],
      requests: [carrier({ status: "OVERDUE", delivery: SENT })],
      now: late,
    });
    assert.deepEqual(chips(view), ["Overdue", "Overdue"]);
    assert.equal(view.rows[0]?.chip.tone, "danger");
    assert.equal(view.header.status, "2 overdue");
    assert.equal(line(view)?.status, "Sent Nov 12, 2026 · Overdue by 3 days");
    assert.equal(line(view)?.tone, "danger");
    assert.match(view.header.need.detail, /\(overdue by 3 days\)/);
    assert.equal(daysOverdue("2026-11-26", late), 3);
    assert.equal(daysOverdue("2026-11-26", NOW), 0);
    assert.equal(daysOverdue("", late), 0);
    // The due day itself is not late.
    assert.equal(
      daysOverdue("2026-11-26", Date.parse("2026-11-26T18:00:00Z")),
      0,
    );
    assert.equal(
      daysOverdue("2026-11-26", Date.parse("2026-11-27T00:30:00Z")),
      1,
    );
  });
});

describe("a file came back: review it", () => {
  const review = () =>
    list({
      requirements: [
        requirement({
          state: "RECEIVED",
          files: [file()],
          assessment: sufficient,
        }),
        walk({ state: "SENT" }),
      ],
      requests: [carrier({ status: "PARTIALLY_RECEIVED", delivery: SENT })],
    });

  it("reads To review on its row and opens that row", () => {
    const view = review();
    assert.deepEqual(chips(view), ["To review", "With owner"]);
    assert.equal(
      view.rows[0]?.sub,
      "Policy or procedure · 1 file · Agent: sufficient",
    );
    assert.equal(view.open, POLICY);
    assert.equal(view.rows[0]?.canAccept, true);
    assert.equal(view.rows[1]?.canAccept, false);
    assert.deepEqual(view.rows[0]?.agent, {
      lead: "Agent proposes: sufficient.",
      // The reader's note is kept to a length, so one cut mid-sentence says so.
      text: "Version 3.2, approved 3 Mar 2026, requires line-manager approval before provisioning…",
      followUps: [],
    });
  });

  it("asks for the review once, and accepts nothing by itself", () => {
    const view = review();
    assert.equal(view.header.standing, "REVIEW");
    assert.equal(view.header.status, "1 file to review");
    assert.deepEqual(view.header.need, {
      kind: "act",
      title: "Review 1 file.",
      detail:
        "The agent read it and proposes: sufficient. Nothing is accepted until you accept it.",
    });
    assert.equal(view.header.agent.did, "Read 1 file: 1 sufficient.");
    assert.equal(view.send.show, false);
    assert.equal(
      view.coverageLine,
      "0 of 5 attributes evidenced · accepting this file covers A to D",
    );
    assert.ok(view.coverage.every((chip) => chip.state === "REQUESTED"));
    assert.equal(view.activityLine, "Sent Nov 12, 2026 · 1 file received");
  });

  it("words several files and mixed proposals", () => {
    const view = list({
      requirements: [
        requirement({
          state: "RECEIVED",
          files: [file()],
          assessment: sufficient,
        }),
        walk({
          state: "RECEIVED",
          files: [file({ fileId: uuid(32) }), file({ fileId: uuid(33) })],
          assessment: {
            proposal: "FOLLOW_UP",
            reason: "The approval email is missing.",
            followUps: ["Send the line manager's approval."],
          },
        }),
      ],
      requests: [carrier({ status: "RECEIVED", delivery: SENT })],
    });
    assert.equal(view.header.status, "3 files to review");
    assert.equal(
      view.header.need.detail,
      "The agent read them and proposes: 1 sufficient, 1 a follow-up. Nothing is accepted until you accept it.",
    );
    assert.equal(
      view.header.agent.did,
      "Read 3 files: 1 sufficient, 1 a follow-up.",
    );
    assert.equal(
      view.rows[1]?.sub,
      "Walkthrough instance · 2 files · Agent: a follow-up",
    );
    assert.equal(
      view.coverageLine,
      "0 of 5 attributes evidenced · accepting these files covers A to E",
    );
  });

  it("reads Reading… while the agent reads, and offers no Accept yet", () => {
    const view = list({
      requirements: [
        requirement({
          state: "RECEIVED",
          files: [file({ readStatus: "WORKING", coverage: null })],
        }),
        walk({ state: "SENT" }),
      ],
      requests: [carrier({ status: "PARTIALLY_RECEIVED", delivery: SENT })],
    });
    assert.deepEqual(chips(view), ["Reading…", "With owner"]);
    assert.equal(
      view.rows[0]?.sub,
      "Policy or procedure · 1 file · Agent is reading",
    );
    assert.equal(view.rows[0]?.canAccept, false);
    assert.equal(view.header.standing, "READING");
    assert.equal(view.header.need.kind, "agent");
    assert.equal(view.header.status, "Reading 1 file");
  });

  it("never claims With owner for a request marked received that was not sent", () => {
    // Before the server tells in-hand evidence apart, an upload on one row marks the
    // whole request received. The other row has no file and was never sent: it says so.
    const view = list({
      requirements: [
        requirement({
          state: "RECEIVED",
          files: [file()],
          assessment: sufficient,
        }),
        walk({ state: "RECEIVED" }),
      ],
      requests: [carrier({ status: "RECEIVED", delivery: null })],
    });
    assert.deepEqual(chips(view), ["To review", "No file yet"]);
    assert.equal(line(view)?.status, "Not sent");
    assert.equal(line(view)?.canChange, false);
    assert.equal(view.rows[1]?.canAccept, false);
    // Where the server says it went out, the owner still has the other row.
    const out = list({
      requirements: [
        requirement({
          state: "RECEIVED",
          files: [file()],
          assessment: sufficient,
        }),
        walk({ state: "RECEIVED" }),
      ],
      requests: [carrier({ status: "RECEIVED", delivery: SENT })],
    });
    assert.deepEqual(chips(out), ["To review", "With owner"]);
  });
});

describe("a follow-up, and a decision against the evidence", () => {
  const asked = (requests: Carrier[]) =>
    list({
      requirements: [
        requirement({
          state: "FOLLOW_UP_REQUIRED",
          files: [file()],
          assessment: sufficient,
          sufficiencyNote: "Send the approved version.",
          sufficiencyBy: "Daniel Osei",
        }),
        walk({ state: "ACCEPTED", files: [file({ fileId: uuid(32) })] }),
      ],
      requests,
    });

  it("reads Follow-up sent only once a follow-up request went out", () => {
    const view = asked([
      carrier({ status: "RECEIVED", delivery: SENT }),
      carrier({
        id: FOLLOW,
        kind: "FOLLOW_UP",
        status: "SENT",
        delivery: { mode: "EMAIL", at: "2026-11-15T10:00:00Z", by: null },
      }),
    ]);
    assert.deepEqual(chips(view), ["Follow-up sent", "Evidence accepted"]);
    assert.equal(view.rows[0]?.chip.tone, "warning");
    assert.equal(view.header.status, "1 follow-up open");
    assert.deepEqual(view.header.need, {
      kind: "wait",
      title: "Follow-up sent",
      detail: "Follow-up sent Nov 15, 2026. Waiting on Maria Keller.",
    });
    assert.equal(
      view.rows[0]?.sub,
      "Policy or procedure · 1 file · Follow-up asked by Daniel Osei",
    );
    assert.equal(
      view.rows[0]?.note,
      "Send the approved version. (Daniel Osei)",
    );
    assert.equal(view.rows[0]?.agent?.lead, "Agent proposed: sufficient.");
  });

  it("does not say sent while nothing went out for it", () => {
    const view = asked([carrier({ status: "RECEIVED", delivery: SENT })]);
    assert.deepEqual(chips(view), ["Follow-up to send", "Evidence accepted"]);
    assert.equal(view.header.status, "1 follow-up open");
    assert.equal(view.header.need.kind, "act");
    assert.doesNotMatch(view.header.need.detail, /Follow-up sent/);
    assert.equal(view.send.show, false);
    // A drafted follow-up request waits to be approved and sent, from the bar.
    const drafted = asked([
      carrier({ status: "RECEIVED", delivery: SENT }),
      carrier({ id: FOLLOW, kind: "FOLLOW_UP", status: "DRAFT" }),
    ]);
    assert.deepEqual(chips(drafted), [
      "Follow-up to send",
      "Evidence accepted",
    ]);
    assert.equal(drafted.send.show, true);
    assert.match(drafted.header.need.detail, /until you approve and send it/);
  });

  it("reads Insufficient, and blocks the step", () => {
    const view = list({
      requirements: [
        requirement({
          state: "INSUFFICIENT",
          files: [file()],
          sufficiencyNote: "A draft, not approved.",
          sufficiencyBy: "Daniel Osei",
        }),
      ],
      requests: [carrier({ status: "RECEIVED", delivery: SENT })],
    });
    assert.deepEqual(chips(view), ["Insufficient"]);
    assert.equal(view.header.tone, "blocked");
    assert.equal(view.header.status, "1 insufficient");
    assert.equal(
      view.rows[0]?.sub,
      "Policy or procedure · 1 file · Marked insufficient by Daniel Osei",
    );
  });
});

describe("everything accepted", () => {
  const done = list({
    requirements: [
      requirement({
        state: "ACCEPTED",
        files: [file()],
        assessment: sufficient,
        sufficiencyBy: "Daniel Osei",
      }),
      walk({
        state: "ACCEPTED",
        files: [
          file({ fileId: uuid(32) }),
          file({ fileId: uuid(33) }),
          file({ fileId: uuid(34) }),
        ],
        assessment: sufficient,
        sufficiencyBy: "Daniel Osei",
      }),
    ],
    requests: [carrier({ status: "RECEIVED", delivery: SENT })],
  });

  it("reads Evidence accepted, never Accepted alone", () => {
    assert.deepEqual(chips(done), ["Evidence accepted", "Evidence accepted"]);
    assert.equal(done.rows[0]?.chip.tone, "success");
    assert.deepEqual(
      done.rows.map((row) => row.sub),
      [
        "Policy or procedure · 1 file · Accepted by Daniel Osei",
        "Walkthrough instance · 3 files · Accepted by Daniel Osei",
      ],
    );
    // Before the requests are drafted "Accepted" means the request itself was accepted.
    for (const chip of Object.values(EVIDENCE_CHIPS)) {
      assert.notEqual(chip.label, "Accepted");
    }
    assert.match(done.rows[0]?.uploadBlocked ?? "", /Reopen the decision/);
    assert.equal(done.rows[0]?.canAccept, false);
    assert.equal(done.open, null);
  });

  it("needs nothing from the person", () => {
    assert.equal(done.header.standing, "DONE");
    assert.equal(done.header.tone, "done");
    assert.equal(done.header.status, "2 of 2 accepted");
    assert.equal(done.header.need.kind, "done");
    assert.equal(
      done.header.agent.did,
      "Read 4 files; all accepted by a person.",
    );
    assert.equal(done.send.show, false);
    assert.equal(line(done)?.status, "Sent Nov 12, 2026 · complete");
    assert.equal(line(done)?.canChange, false);
    assert.equal(done.coverageLine, "5 of 5 attributes evidenced");
    assert.ok(done.coverage.every((chip) => chip.state === "EVIDENCED"));
    assert.equal(done.coverage[0]?.label, "Attribute A: evidence accepted");
    assert.equal(
      done.activityLine,
      "Sent Nov 12, 2026 · 4 files received · 2 accepted",
    );
  });

  it("evidences only the attributes of the accepted requests", () => {
    const part = list({
      requirements: [
        requirement({ state: "ACCEPTED", files: [file()] }),
        walk({ state: "SENT" }),
      ],
      requests: [carrier({ status: "PARTIALLY_RECEIVED", delivery: SENT })],
    });
    assert.deepEqual(
      part.coverage.map((chip) => chip.state),
      ["EVIDENCED", "EVIDENCED", "EVIDENCED", "EVIDENCED", "REQUESTED"],
    );
    assert.equal(part.coverageLine, "4 of 5 attributes evidenced");
    // An attribute no request addresses, with or without a recorded reason.
    const gaps = list({
      requirements: [requirement({ attributeIds: [A, B] })],
      exceptions: [
        {
          attributeId: C,
          reason: "Tested on each operating-effectiveness sample instead.",
          recordedBy: "Daniel Osei",
          recordedAt: "2026-11-12T08:30:00Z",
        },
      ],
    });
    assert.deepEqual(
      gaps.coverage.map((chip) => chip.state),
      ["REQUESTED", "REQUESTED", "EXCEPTED", "UNCOVERED", "UNCOVERED"],
    );
    assert.equal(
      gaps.coverageLine,
      "0 of 5 attributes evidenced · C not evidenced at D&I, with a recorded reason · D and E not addressed by any request",
    );
  });
});

describe("live email off: handed over, never sent", () => {
  it("words the send as a handover before it happens", () => {
    const view = list({ liveEmail: false });
    assert.deepEqual(view.send, {
      show: true,
      handover: true,
      label: "Approve and mark as handed over",
    });
    assert.equal(view.header.need.title, "Approve and hand over 2 requests.");
    assert.match(view.header.need.detail, /nothing is emailed/);
    assert.doesNotMatch(view.header.need.title, /send/i);
    // Where the server does not say, or says email is on, the wording stays.
    assert.equal(list({ liveEmail: true }).send.handover, false);
    assert.equal(list().send.handover, false);
  });

  it("reads Handed over on the rows, the line and the pill, once it has", () => {
    const view = list({
      requirements: [
        requirement({ state: "APPROVAL_PENDING" }),
        walk({ state: "APPROVAL_PENDING" }),
      ],
      liveEmail: false,
      requests: [
        carrier({
          status: "APPROVAL_PENDING",
          delivery: {
            mode: "HANDED_OVER",
            at: "2026-11-12T09:00:00Z",
            by: "Daniel Osei",
          },
        }),
      ],
    });
    assert.deepEqual(chips(view), ["Handed over", "Handed over"]);
    assert.equal(line(view)?.status, "Handed over Nov 12, 2026 by Daniel Osei");
    assert.equal(line(view)?.tone, "info");
    assert.equal(view.header.status, "2 handed over");
    assert.equal(
      view.header.need.detail,
      "Handed over to Maria Keller on Nov 12, 2026, due Nov 26, 2026. Upload what you receive on its row.",
    );
    assert.equal(view.activityLine, "Handed over Nov 12, 2026 by Daniel Osei");
    for (const text of [
      ...chips(view),
      line(view)?.status ?? "",
      view.header.status,
      view.header.need.title,
      view.header.need.detail,
    ]) {
      assert.doesNotMatch(
        text,
        /With owner|With the owner|Sent|Not sent|To send|Awaiting approval/,
      );
    }
    // Out, so its wording is no longer edited; nothing waits to be sent.
    assert.equal(view.rows[0]?.sent, true);
    assert.equal(view.send.show, false);
    assert.equal(line(view)?.out, true);
  });
});

describe("evidence in hand before sending", () => {
  it("reads In hand on the server's word, and leaves the row out of what is sent", () => {
    const view = list({
      requirements: [
        requirement({ state: "DRAFT", files: [file()], inHand: true }),
        walk(),
      ],
    });
    assert.deepEqual(chips(view), ["In hand", "To send"]);
    assert.equal(view.rows[0]?.chip.tone, "neutral");
    assert.equal(view.header.status, "1 request to send");
    assert.equal(view.header.need.title, "Approve and send 1 request.");
    assert.equal(view.send.show, true);
    // It was not sent, so it is still edited and deleted like a draft.
    assert.equal(view.rows[0]?.sent, false);
  });

  it("does not guess In hand from a file alone", () => {
    const view = list({
      requirements: [requirement({ state: "DRAFT", files: [file()] }), walk()],
    });
    assert.deepEqual(chips(view), ["To send", "To send"]);
    assert.equal(view.header.status, "2 requests to send");
  });

  it("offers the review of in-hand evidence while the others wait to be sent", () => {
    const view = list({
      requirements: [
        requirement({
          state: "RECEIVED",
          files: [file()],
          assessment: sufficient,
          inHand: true,
        }),
        walk(),
      ],
    });
    assert.deepEqual(chips(view), ["In hand", "To send"]);
    assert.equal(view.rows[0]?.canAccept, true);
    assert.equal(view.open, POLICY);
    assert.equal(view.header.standing, "SEND");
    assert.match(
      view.header.need.detail,
      /1 file in hand waits for your review/,
    );
    // Once the others are out, it is reviewed like any file.
    const out = list({
      requirements: [
        requirement({
          state: "RECEIVED",
          files: [file()],
          assessment: sufficient,
          inHand: true,
        }),
        walk({ state: "SENT" }),
      ],
      requests: [carrier({ status: "SENT", delivery: SENT })],
    });
    assert.deepEqual(chips(out), ["To review", "With owner"]);
    assert.equal(out.header.standing, "REVIEW");
  });
});

describe("a row's menu", () => {
  const facts = { policies: 1, held: 2, attributes: 5 };
  const labels = [
    "Edit",
    "Change attributes",
    "Upload a file",
    "Use a policy on file",
    "Use a file the control holds",
    "Ask a follow-up",
    "Mark insufficient",
    "Mark not applicable",
    "Reopen decision",
    "Delete",
  ];
  const off = (entries: ReturnType<typeof rowMenu>) =>
    Object.fromEntries(
      entries
        .filter((entry) => entry.unavailable !== null)
        .map((entry) => [entry.label, entry.unavailable]),
    );

  it("lists every action in order, and before sending leaves the draft's open", () => {
    const row = list().rows[0];
    assert.ok(row !== undefined);
    const menu = rowMenu(row, facts);
    assert.deepEqual(
      menu.map((entry) => entry.label),
      labels,
    );
    assert.deepEqual(off(menu), {
      "Ask a follow-up": NOTHING_RECEIVED,
      "Mark insufficient": NOTHING_RECEIVED,
      "Reopen decision": "No decision is recorded on it yet.",
    });
    assert.equal(menu.find((entry) => entry.key === "delete")?.danger, true);
    // What the control does not hold is said, not hidden.
    assert.deepEqual(
      off(rowMenu(row, { policies: 0, held: 0, attributes: 0 })),
      {
        "Change attributes": "The control has no approved attributes.",
        "Use a policy on file":
          "No policy or procedure on file applies to this control.",
        "Use a file the control holds": "The control holds no other file yet.",
        "Ask a follow-up": NOTHING_RECEIVED,
        "Mark insufficient": NOTHING_RECEIVED,
        "Reopen decision": "No decision is recorded on it yet.",
      },
    );
  });

  it("turns Edit and Delete off after sending, with the date, and opens the judgments", () => {
    const view = list({
      requirements: [
        requirement({
          state: "RECEIVED",
          files: [file()],
          assessment: sufficient,
          procedureIds: [uuid(51)],
        }),
      ],
      requests: [carrier({ status: "RECEIVED", delivery: SENT })],
    });
    const row = view.rows[0];
    assert.ok(row !== undefined);
    const reason = "Already sent Nov 12, 2026. Ask a follow-up instead.";
    assert.deepEqual(off(rowMenu(row, facts)), {
      Edit: reason,
      "Reopen decision": "No decision is recorded on it yet.",
      Delete: reason,
    });
    assert.equal(sentReason(SENT, "RECEIVED"), reason);
    assert.equal(
      sentReason({ mode: "HANDED_OVER", at: "2026-11-12", by: "Dana" }, "SENT"),
      "Already handed over Nov 12, 2026. Ask a follow-up instead.",
    );
    // No delivery on record: sent is said only where the plan's own state says so.
    assert.equal(
      sentReason(null, "SENT"),
      "Already sent. Ask a follow-up instead.",
    );
    assert.equal(
      sentReason(null, "RECEIVED"),
      "It is no longer a draft. Ask a follow-up instead.",
    );
  });

  it("reopens a decision, and restores a request set aside", () => {
    const view = list({
      requirements: [
        requirement({ state: "ACCEPTED", files: [file()], procedureIds: [] }),
        walk({
          state: "NOT_APPLICABLE",
          waiveReason: "Covered by the policy.",
          procedureIds: [],
        }),
      ],
      requests: [carrier({ status: "RECEIVED", delivery: SENT })],
    });
    const [accepted, waived] = view.rows;
    assert.ok(accepted !== undefined && waived !== undefined);
    assert.equal(
      rowMenu(accepted, facts).find((entry) => entry.key === "reopen")
        ?.unavailable,
      null,
    );
    assert.match(
      rowMenu(accepted, facts).find((entry) => entry.key === "upload")
        ?.unavailable ?? "",
      /Reopen the decision/,
    );
    // Set aside: out of the count, shown with why, and restored from its menu.
    assert.equal(view.title, "Requests · 1");
    assert.equal(view.header.status, "1 of 1 accepted");
    assert.equal(waived.chip.label, "Not applicable");
    assert.equal(waived.aside, true);
    assert.equal(
      waived.sub,
      "Walkthrough instance · Not applicable: Covered by the policy.",
    );
    const menu = rowMenu(waived, facts);
    assert.deepEqual(
      menu.map((entry) => entry.label),
      labels.map((label) =>
        label === "Mark not applicable" ? "Restore" : label,
      ),
    );
    assert.equal(
      menu.find((entry) => entry.key === "restore")?.unavailable,
      null,
    );
    assert.match(
      menu.find((entry) => entry.key === "edit")?.unavailable ?? "",
      /Restore it first/,
    );
  });

  it("asks for a proposed change to be decided before the request is edited", () => {
    const view = list({
      requirements: [
        requirement({
          pendingChange: { remove: false, title: "New title", description: "" },
        }),
      ],
    });
    const row = view.rows[0];
    assert.ok(row !== undefined);
    assert.equal(row.chip.label, "To accept");
    assert.equal(view.open, POLICY);
    assert.deepEqual(row.change, {
      remove: false,
      title: "New title",
      description: "",
    });
    assert.equal(
      rowMenu(row, facts).find((entry) => entry.key === "edit")?.unavailable,
      "Decide the proposed change first.",
    );
  });
});

describe("the list's small readings", () => {
  it("leaves removed requests and other phases out", () => {
    const view = list({
      requirements: [
        requirement(),
        walk({ state: "REMOVED" }),
        requirement({ id: uuid(13), phase: "INTERIM" }),
      ],
    });
    assert.deepEqual(
      view.rows.map((row) => row.id),
      [POLICY],
    );
    const empty = list({ requirements: [] });
    assert.equal(empty.title, "Requests · 0");
    assert.equal(empty.header.standing, "EMPTY");
    assert.equal(empty.header.need.title, "Add a request.");
  });

  it("takes the period from the request, else the phase's window", () => {
    const view = list({
      requirements: [
        requirement({ periodLabel: "In force during FY2026" }),
        walk(),
      ],
    });
    assert.equal(view.rows[0]?.period, "In force during FY2026");
    assert.equal(view.rows[1]?.period, "The control as currently designed");
  });

  it("takes a request's procedures from the test plan where it carries none", () => {
    const view = list({
      requirements: [requirement({ procedureIds: null })],
      procedures: { [POLICY]: [uuid(51)] },
    });
    assert.deepEqual(view.rows[0]?.procedureIds, [uuid(51)]);
    assert.equal(
      list({ requirements: [requirement({ procedureIds: null })] }).rows[0]
        ?.procedureIds,
      null,
    );
  });

  it("says letters as a person does", () => {
    const all = ["A", "B", "C", "D", "E"];
    assert.equal(lettersSpan(["A", "B", "C", "D"], all), "A to D");
    assert.equal(lettersSpan(["A", "C", "E"], all), "A, C and E");
    assert.equal(lettersSpan(["B", "C"], all), "B and C");
    assert.equal(lettersSpan(["E"], all), "E");
  });

  it("says when a file came, its size, and who uploaded it, each only where known", () => {
    const on = { via: "REQUEST", linkedBy: null, sharedFrom: null };
    assert.equal(
      fileMeta(
        {
          createdAt: "2026-11-14T10:00:00Z",
          sizeBytes: 421888,
          addedBy: "Daniel Osei",
        },
        on,
      ),
      "Nov 14, 2026 · 412 KB · uploaded by Daniel Osei",
    );
    assert.equal(fileMeta(undefined, on), "");
    assert.equal(
      fileMeta(
        { createdAt: "2026-11-14" },
        { ...on, via: "LINK", linkedBy: "Dana" },
      ),
      "Nov 14, 2026 · linked by Dana",
    );
  });

  it("keeps the evidence and approval activity, newest first", () => {
    const items = [
      { id: "1", at: "2026-11-12T09:00:00Z", category: "evidence" },
      { id: "2", at: "2026-11-14T09:00:00Z", category: "approval" },
      { id: "3", at: "2026-11-13T09:00:00Z", category: "planning" },
    ];
    assert.deepEqual(
      evidenceActivity(items).map((item) => item.id),
      ["2", "1"],
    );
    assert.deepEqual(evidenceActivity(null), []);
  });
});

describe("the D&I evidence screen", () => {
  const read = (path: string) =>
    readFileSync(new URL(`../apps/web/${path}`, import.meta.url), "utf8");
  const view = read("src/design-evidence.tsx");
  const controls = read("src/controls-view.tsx");

  it("is one list: no detail pane, tabs, bulk actions, numbering or progress meter", () => {
    assert.doesNotMatch(
      view,
      /role="tab"|Bulk actions|er-panel|er-num|er-meter|View mapping|Request groups|Coverage by/,
    );
    assert.doesNotMatch(view, /EvidenceRequests|RequirementRow/);
    assert.match(controls, /<DesignEvidence/);
    // OE Evidence, and a D&I phase the list is not read for, keep the workspace.
    assert.match(controls, /<EvidenceWorkspace/);
  });

  it("sends through the existing review and confirmation, and says success only after the server", () => {
    assert.match(
      view,
      /<ControlSend ids=\{ids\} handover=\{view\.send\.handover\} \/>/,
    );
    const send = read("src/control-send.tsx");
    assert.match(send, /I have reviewed the recipient and request details/);
    assert.match(send, /disabled=\{!reviewed\}/);
    assert.match(send, /Approve and mark as handed over/);
    // Accepted, uploaded and recorded are said only once the call came back confirmed.
    assert.match(view, /if \(ok\) \{\s*onDone\("Evidence accepted\."\)/);
    assert.doesNotMatch(view, /location\.reload|window\.location\.href =/);
  });

  it("keeps the deep links: a request by its address, a file, and the row's anchor", () => {
    assert.match(view, /evidenceHref\(stepHref, \{/);
    assert.match(view, /intelligence\.focusFile != null/);
    assert.match(view, /id=\{`req-\$\{item\.id\}`\}/);
    assert.match(controls, /stepHref=\{stepHrefsWf\.designevidence\}/);
  });
});

describe("several requests: evidence in hand splits one, a follow-up is its own", () => {
  const NEW = uuid(24);
  // After an upload on the policy's row of an unsent request: the policy stays on the
  // old request (received, provided directly), the walkthrough moved to a new draft.
  const split = () =>
    list({
      requirements: [
        requirement({
          state: "RECEIVED",
          files: [file()],
          assessment: sufficient,
          inHand: true,
        }),
        walk({ requestId: NEW }),
      ],
      requests: [
        carrier({ status: "RECEIVED", delivery: null }),
        carrier({ id: NEW, status: "DRAFT", delivery: null }),
      ],
    });

  it("groups the rows by the request they travel in, what waits to be sent first", () => {
    const view = split();
    assert.deepEqual(
      view.groups.map((group) => [group.key, group.rowIds, group.line.status]),
      [
        [NEW, [WALK], "Not sent"],
        [REQUEST, [POLICY], "In hand · nothing to send"],
      ],
    );
    const [send, inHand] = view.groups;
    assert.equal(send?.line.requestId, NEW);
    assert.equal(send?.line.canChange, true);
    assert.equal(send?.line.quiet, false);
    // The in-hand line names no recipient and offers no change: nothing goes anywhere.
    assert.deepEqual(inHand?.line, {
      requestId: REQUEST,
      to: "",
      role: "",
      due: "",
      status: "In hand · nothing to send",
      tone: "neutral",
      canChange: false,
      out: false,
      quiet: true,
      action: null,
      preview: "",
      pending: null,
    });
    assert.deepEqual(chips(view), ["In hand", "To send"]);
    assert.equal(view.header.status, "1 request to send");
    assert.equal(view.send.show, true);
    // Every row is in exactly one group.
    assert.deepEqual(
      view.groups.flatMap((group) => group.rowIds).sort(),
      [POLICY, WALK].sort(),
    );
  });

  it("orders the groups: to send, with the owner, complete, in hand", () => {
    const [OUT, DONE] = [uuid(25), uuid(26)];
    const view = list({
      requirements: [
        requirement({
          id: uuid(14),
          state: "ACCEPTED",
          files: [file({ fileId: uuid(35) })],
          inHand: true,
        }),
        requirement({
          id: uuid(15),
          requestId: DONE,
          state: "ACCEPTED",
          files: [file({ fileId: uuid(36) })],
        }),
        requirement({ id: uuid(16), requestId: OUT, state: "SENT" }),
        walk({ requestId: NEW }),
      ],
      requests: [
        carrier({ status: "RECEIVED", delivery: null }),
        carrier({ id: DONE, status: "RECEIVED", delivery: SENT }),
        carrier({ id: OUT, status: "SENT", delivery: SENT }),
        carrier({ id: NEW, status: "DRAFT", delivery: null }),
      ],
    });
    assert.deepEqual(
      view.groups.map((group) => [group.key, group.line.status]),
      [
        [NEW, "Not sent"],
        [OUT, "Sent Nov 12, 2026"],
        [DONE, "Sent Nov 12, 2026 · complete"],
        [REQUEST, "In hand · complete"],
      ],
    );
  });

  it("puts rows no request is drafted for under their own line", () => {
    const view = list({
      requirements: [
        requirement({ state: "SENT" }),
        walk({ state: "NOT_GENERATED", requestId: null }),
      ],
      requests: [carrier({ status: "SENT", delivery: SENT })],
    });
    assert.deepEqual(
      view.groups.map((group) => [group.key, group.line.status]),
      [
        ["none", "Not drafted yet"],
        [REQUEST, "Sent Nov 12, 2026"],
      ],
    );
    // The step's waiting line is about the request the owner has.
    assert.equal(view.header.standing, "NOT_DRAFTED");
    const waiting = list({
      requirements: [
        requirement({ state: "SENT" }),
        walk({
          requestId: NEW,
          state: "ACCEPTED",
          files: [file()],
          inHand: true,
        }),
      ],
      requests: [
        carrier({ id: NEW, status: "RECEIVED", delivery: null }),
        carrier({ status: "SENT", delivery: SENT }),
      ],
    });
    assert.match(
      waiting.header.need.detail,
      /^With Maria Keller since Nov 12, 2026, due Nov 26, 2026\./,
    );
    assert.equal(
      waiting.activityLine,
      "Sent Nov 12, 2026 · 1 file received · 1 accepted",
    );
  });

  it("reads a handed-over request beside a new draft, each as it is", () => {
    const view = list({
      liveEmail: false,
      requirements: [
        requirement({ state: "APPROVAL_PENDING" }),
        walk({ requestId: NEW }),
      ],
      requests: [
        carrier({
          status: "APPROVAL_PENDING",
          delivery: {
            mode: "HANDED_OVER",
            at: "2026-11-12",
            by: "Daniel Osei",
          },
        }),
        carrier({ id: NEW, status: "DRAFT", delivery: null }),
      ],
    });
    assert.deepEqual(chips(view), ["Handed over", "To send"]);
    assert.deepEqual(
      view.groups.map((group) => group.line.status),
      ["Not sent", "Handed over Nov 12, 2026 by Daniel Osei"],
    );
    assert.equal(view.header.need.title, "Approve and hand over 1 request.");
  });

  it("merges the plan's requests with the kinds the control's list gives", () => {
    const merged = carriersOf(
      [
        {
          id: REQUEST,
          status: "APPROVAL_PENDING",
          recipient: "maria.keller@example.com",
          dueAt: "2026-11-26",
          delivery: SENT,
        },
        { id: FOLLOW, status: "DRAFT", delivery: null },
        { id: NEW, status: "SENT" },
      ],
      [
        carrier({ status: "DRAFT", recipient: "old@example.com" }),
        carrier({ id: FOLLOW, kind: "FOLLOW_UP", dueAt: "2026-12-01" }),
        carrier({ id: uuid(27), kind: "SAMPLES" }),
      ],
    );
    assert.deepEqual(merged, [
      {
        id: REQUEST,
        kind: "EVIDENCE",
        // The plan's own word for the status, the recipient and the delivery.
        status: "APPROVAL_PENDING",
        dueAt: "2026-11-26",
        recipient: "maria.keller@example.com",
        delivery: SENT,
      },
      {
        id: FOLLOW,
        kind: "FOLLOW_UP",
        status: "DRAFT",
        dueAt: "2026-12-01",
        recipient: "maria.keller@example.com",
        delivery: null,
      },
      // Neither said how it went: the field stays absent.
      { id: NEW, kind: "EVIDENCE", status: "SENT", dueAt: "", recipient: "" },
      carrier({ id: uuid(27), kind: "SAMPLES" }),
    ]);
  });

  it("reads the requests again after a refusal that changed them", () => {
    for (const sentence of IN_HAND_REFUSALS) {
      assert.equal(rereadsRequests(sentence), true);
    }
    assert.equal(
      rereadsRequests("this item is not one the request asks for"),
      true,
    );
    assert.equal(rereadsRequests("requester cannot approve"), false);
    assert.equal(rereadsRequests(""), false);
  });
});

describe("the record under the list", () => {
  it("keeps deleted requests in the history, each restorable at its version", () => {
    const view = list({
      requirements: [
        requirement(),
        walk({ state: "REMOVED", version: 7 }),
        // Proposed by the planner and never accepted: not a deleted request.
        requirement({
          id: uuid(17),
          state: "REMOVED",
          pendingChange: {
            remove: false,
            title: "",
            description: "",
            add: true,
          },
        }),
        requirement({ id: uuid(18), phase: "INTERIM", state: "REMOVED" }),
      ],
    });
    assert.deepEqual(view.history, [
      {
        id: WALK,
        version: 7,
        title: "One access request traced from request to grant",
        kind: "Walkthrough instance",
      },
    ]);
    assert.deepEqual(list().history, []);
  });

  it("keeps the reason an attribute is not evidenced at D&I readable", () => {
    const view = list({
      requirements: [requirement({ attributeIds: [A, B] })],
      exceptions: [
        {
          attributeId: C,
          reason: "Tested on each operating-effectiveness sample instead.",
          recordedBy: "Daniel Osei",
          recordedAt: "2026-11-12T08:30:00Z",
        },
      ],
    });
    assert.deepEqual(view.exceptions, [
      {
        attributeId: C,
        letter: "C",
        text: "Attribute 3 wording.",
        reason: "Tested on each operating-effectiveness sample instead.",
        recordedBy: "Daniel Osei",
        recordedAt: "2026-11-12T08:30:00Z",
      },
    ]);
    assert.equal(
      view.coverage[2]?.reason,
      "Tested on each operating-effectiveness sample instead.",
    );
    assert.equal(view.coverage[0]?.reason, "");
    assert.deepEqual(list().exceptions, []);
  });

  it("shows the history and the reasons on the screen, and locks after an upload", () => {
    const screen = readFileSync(
      new URL("../apps/web/src/design-evidence.tsx", import.meta.url),
      "utf8",
    );
    assert.match(screen, /<strong>History<\/strong>/);
    assert.match(screen, /aria-label=\{`Restore \$\{item\.title\}`\}/);
    assert.match(screen, /Not evidenced at D&amp;I/);
    assert.match(screen, /view\.groups\.map/);
    // After an upload nothing else is offered until the plan is read again.
    assert.match(screen, /settling === plan/);
    assert.match(screen, /onUploaded=\{\(\) => setSettling\(plan\)\}/);
  });
});

describe("what the independent review found (12 November 2026)", () => {
  const NEW = uuid(24);
  const HANDED = {
    mode: "HANDED_OVER",
    at: "2026-11-15T10:00:00Z",
    by: "Daniel Osei",
  } as const;
  const followedUp = (delivery: Carrier["delivery"]) =>
    list({
      requirements: [
        requirement({
          state: "FOLLOW_UP_REQUIRED",
          files: [file()],
          sufficiencyNote: "Send the approved version.",
        }),
      ],
      requests: [
        carrier({ status: "RECEIVED", delivery: SENT }),
        carrier({
          id: FOLLOW,
          kind: "FOLLOW_UP",
          status: "APPROVAL_PENDING",
          title: "Follow-up: the approved version of the policy",
          ...(delivery !== undefined ? { delivery } : {}),
        }),
      ],
    });

  it("W1: a handed-over follow-up never reads as sent", () => {
    const view = followedUp(HANDED);
    assert.deepEqual(chips(view), ["Follow-up handed over"]);
    assert.deepEqual(view.header.need, {
      kind: "wait",
      title: "Follow-up handed over",
      detail:
        "Follow-up handed over Nov 15, 2026 by Daniel Osei. Waiting on Maria Keller.",
    });
    assert.doesNotMatch(
      `${chips(view).join(" ")} ${view.header.need.title} ${view.header.need.detail}`,
      /sent/i,
    );
    // Emailed, it is sent; with no delivery on a request awaiting approval, neither.
    assert.deepEqual(chips(followedUp(SENT)), ["Follow-up sent"]);
    assert.deepEqual(chips(followedUp(null)), ["Follow-up to send"]);
    assert.deepEqual(chips(followedUp(undefined)), ["Follow-up to send"]);
  });

  it("W3: every request of the phase has a place, with or without rows", () => {
    const view = followedUp(HANDED);
    assert.deepEqual(
      view.groups.map((group) => [
        group.key,
        group.rowIds,
        group.label,
        group.line.status,
      ]),
      [
        [REQUEST, [POLICY], "", "Sent Nov 12, 2026"],
        [
          FOLLOW,
          [],
          "Follow-up request · Follow-up: the approved version of the policy",
          "Handed over Nov 15, 2026 by Daniel Osei",
        ],
      ],
    );
    assert.equal(view.groups[1]?.line.requestId, FOLLOW);
    // A drafted samples request leads (it waits to be sent); an untitled one is named
    // by its kind; a cancelled, empty one has no card: it asks for nothing.
    const more = list({
      requirements: [requirement({ state: "SENT" })],
      requests: [
        carrier({ status: "SENT", delivery: SENT }),
        carrier({ id: NEW, kind: "SAMPLES", status: "DRAFT", delivery: null }),
        carrier({ id: uuid(28), status: "CANCELLED", delivery: null }),
        carrier({ id: uuid(29), status: "RECEIVED", delivery: SENT }),
      ],
    });
    assert.deepEqual(
      more.groups.map((group) => [group.key, group.label, group.line.status]),
      [
        [NEW, "Samples request", "Not sent"],
        [REQUEST, "", "Sent Nov 12, 2026"],
        [uuid(29), "Request", "Sent Nov 12, 2026 · complete"],
      ],
    );
    assert.equal(more.title, "Requests · 1");
  });

  it("W4: approved is not sent, and a failed send says so, with the way on", () => {
    const pending = (
      approval: string | null,
      liveEmail: boolean | null = null,
    ) =>
      list({
        liveEmail,
        requirements: [
          requirement({ state: "APPROVAL_PENDING" }),
          walk({ state: "APPROVAL_PENDING" }),
        ],
        requests: [
          carrier({ status: "APPROVAL_PENDING", delivery: null, approval }),
        ],
      });
    const read = (view: ReturnType<typeof list>) => [
      line(view)?.status,
      line(view)?.action,
      view.header.standing,
      view.header.status,
    ];
    assert.deepEqual(read(pending("PENDING")), [
      "Awaiting approval",
      null,
      "AWAITING_APPROVAL",
      "2 awaiting approval",
    ]);
    assert.deepEqual(read(pending("APPROVED")), [
      "Approved, not sent",
      "Send",
      "APPROVED_UNSENT",
      "2 approved, not sent",
    ]);
    assert.deepEqual(read(pending("RESEND")), [
      "Approved, not sent",
      "Send again",
      "APPROVED_UNSENT",
      "2 approved, not sent",
    ]);
    const failed = pending("FAILED");
    assert.deepEqual(read(failed), [
      "Send failed",
      "Try again",
      "SEND_FAILED",
      "Send failed",
    ]);
    assert.equal(line(failed)?.tone, "danger");
    assert.equal(failed.header.need.kind, "act");
    assert.deepEqual(read(pending("EXPIRED")), [
      "Approval expired",
      "Submit again",
      "AWAITING_APPROVAL",
      "2 awaiting approval",
    ]);
    // None reads as submitted for approval once it is approved, nor as sent.
    for (const approval of ["APPROVED", "FAILED", "RESEND"]) {
      const view = pending(approval);
      assert.doesNotMatch(view.header.need.detail, /submitted for approval/);
      assert.deepEqual(chips(view), ["To send", "To send"]);
      assert.equal(view.send.show, false);
    }
    // Email off, approved by a person who may not send: no hand-over is recorded, and
    // a person who may send completes it. Never "sent", never "handed over" as done.
    for (const approval of ["APPROVED", "FAILED"]) {
      const off = pending(approval, false);
      assert.deepEqual(read(off), [
        "Approved, not handed over",
        "Hand over",
        "APPROVED_UNSENT",
        "2 approved, not handed over",
      ]);
      assert.equal(off.header.need.title, "Hand over 2 approved requests.");
      assert.match(off.header.need.detail, /no hand-over is recorded/);
      assert.match(off.header.need.detail, /A person who may send completes/);
    }
    // A draft returned by the approver says so.
    assert.equal(
      line(
        list({ requests: [carrier({ delivery: null, approval: "REJECTED" })] }),
      )?.status,
      "Returned for changes",
    );
  });

  it("lows: the request is opened under words that are true of it", () => {
    assert.equal(line(list())?.preview, "Preview the request");
    const sent = list({
      requirements: [requirement({ state: "SENT" })],
      requests: [carrier({ status: "SENT", delivery: SENT })],
    });
    assert.equal(line(sent)?.preview, "Preview the email");
    const handed = list({
      requirements: [requirement({ state: "APPROVAL_PENDING" })],
      requests: [carrier({ status: "APPROVAL_PENDING", delivery: HANDED })],
    });
    assert.equal(line(handed)?.preview, "The request as handed over");
    assert.equal(line(handed)?.action, null);
    assert.equal(
      deliveryLabel(HANDED),
      "Handed over Nov 15, 2026 by Daniel Osei",
    );
    assert.equal(deliveryLabel(SENT), "Sent Nov 12, 2026");
    assert.equal(deliveryLabel(null), null);
    assert.equal(deliveryLabel(undefined), null);
  });

  it("carries a request's title and approval from the control's list", () => {
    const merged = carriersOf(
      [{ id: REQUEST, status: "APPROVAL_PENDING", delivery: null }],
      [carrier({ title: "D&I evidence", approval: "APPROVED" })],
    );
    assert.equal(merged[0]?.title, "D&I evidence");
    assert.equal(merged[0]?.approval, "APPROVED");
  });

  it("W5 and lows: the screen closes the pane on a split, locks menus and drops, and keeps Add evidence", () => {
    const read = (path: string) =>
      readFileSync(new URL(`../apps/web/src/${path}`, import.meta.url), "utf8");
    const pane = read("request-review.tsx");
    // The pane hands the sentence to the list and closes back to it, only where the
    // list took it; nothing is guessed about which request to open instead.
    assert.match(pane, /new CustomEvent\(REQUESTS_CHANGED_EVENT/);
    assert.match(
      pane,
      /taken \? router\.replace\(closeHref, \{ scroll: false \}\) : router\.refresh\(\)/,
    );
    assert.match(
      pane,
      /delivery\?\.mode === "HANDED_OVER" && reached !== null \? reached : life\.label/,
    );
    const screen = read("design-evidence.tsx");
    assert.match(screen, /addEventListener\(REQUESTS_CHANGED_EVENT/);
    assert.match(screen, /unavailable: locked \? LOCKED : entry\.unavailable/);
    assert.match(screen, /onDropCapture=\{/);
    assert.match(screen, /Add a file that fits no request/);
    assert.match(screen, /label: group\.line\.preview/);
    assert.doesNotMatch(screen, /"Preview the email"|the request as sent/);
    // One primary in the bar: the added entry is a menu item.
    assert.equal(screen.match(/<ControlSend /g)?.length, 1);
  });
});
