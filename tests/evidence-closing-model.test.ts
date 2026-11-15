import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as digestModel from "../apps/web/src/check-digest-model.ts";
import * as workflowModel from "../apps/web/src/control-workflow-model.ts";
import * as conclusionModel from "../apps/web/src/design-conclusion-model.ts";
import * as listModel from "../apps/web/src/design-evidence-model.ts";
import * as assuranceModel from "../apps/web/src/evidence-assurance-model.ts";
import * as panelModel from "../apps/web/src/step-panel-model.ts";

// Closing a request with tickmarks; exceptions carried to the workpaper
// (docs/evidence-assurance.md, section 10.15), on the web. The product owner: "if I add
// tickmark to these attributes that were not addressed by any evidence it will close the
// evidence request. Any issue will be dealt with as exception in the workpaper analysis
// ... Otherwise, it will never move to the next phase."
//
// What must hold: a request's attributes are settled only where each one it asks for is
// supported by the check (by an instance's records or by the documented design, the rule
// the server ends a tickmark by) or carries a standing tickmark (an exception included);
// the offer to accept is made only where recording a tickmark settles the last one on a
// request that can be accepted and is not, and starts ticked only where nothing else
// waits on the request; the finding's dismissal is offered for a closing kind on a
// proposed finding only; the first line says a settled request is to accept, and never
// says more than the records do; the coverage, the row's chips and the step's counts
// read tickmarks in their own words, never as evidenced, and a closing tickmark only
// from an accepted request that no other request's check disputes; the step is not done
// while an accepted request has an attribute whose own tickmark no longer stands, and
// only then; an exception that holds the D&I sign-off is said as such, never as a
// verdict awaiting sign-off; and the kept and earlier-check lines are said. Every input goes through the real parser, as the
// screen's does. Synthetic data only. The modules are read as namespaces so that each
// test fails on its own where the feature is missing.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C] = [uuid(1), uuid(2), uuid(3)] as const;
const [REQUEST, OTHER] = [uuid(11), uuid(12)] as const;
const CARRIER = uuid(21);
const FILE = uuid(31);
const NOW = Date.parse("2026-11-15T12:00:00Z");
const TICKET = { id: FILE, name: "Ticket_4711.pdf" };

const lettered = [A, B, C].map((id, at) => ({
  id,
  letter: "ABC".charAt(at),
  text: `Attribute ${"ABC".charAt(at)} wording.`,
}));
const span = (letters: readonly string[]) =>
  listModel.lettersSpan(
    letters,
    lettered.map((item) => item.letter),
  );

const passage = () => ({
  quote: "approved by the line manager",
  file_id: FILE,
  location: { label: "Page 3", page: 3 },
});

/** Shown: supported by the records of an instance, which accepting marks as evidenced. */
function shown(id: string, code: string, over: Record<string, unknown> = {}) {
  return {
    attribute_id: id,
    code,
    expected: true,
    verdict: "SUPPORTED",
    result: "MET",
    shows: "IMPLEMENTATION",
    summary: `The ticket shows attribute ${code}.`,
    passages: [passage()],
    absent: [],
    views: [],
    finding_id: null,
    finding_status: null,
    assessment: "SATISFIED",
    checks: [],
    ...over,
  };
}

/** Not shown: the request asks for it and the files do not show it. */
const gap = (id: string, code: string, over: Record<string, unknown> = {}) =>
  shown(id, code, {
    verdict: "ISSUE",
    result: "NOT_MET",
    shows: null,
    summary: `Nothing shows attribute ${code}.`,
    passages: [],
    absent: [`The record that shows ${code}.`],
    assessment: "NOT_DEMONSTRATED",
    ...over,
  });

/** Left to the person's judgment: the two readings do not agree. */
const judgment = (
  id: string,
  code: string,
  over: Record<string, unknown> = {},
) =>
  gap(id, code, {
    verdict: "UNSETTLED",
    result: null,
    absent: [],
    summary: "The two readings read the files differently.",
    assessment: "INDETERMINATE",
    ...over,
  });

const tickmark = (kind: string, over: Record<string, unknown> = {}) => ({
  id: uuid(900),
  kind,
  reason: "The ticket system was retired in 2026.",
  relied_on: "",
  annotation_id: kind === "SHOWN_ON_REVIEW" ? uuid(203) : null,
  recorded_by_name: "Dana Lee",
  recorded_at: "2026-11-15T09:30:00Z",
  version: 1,
  ...over,
});

const ended = (as: string, over: Record<string, unknown> = {}) => ({
  ...tickmark("NOT_AVAILABLE", { id: uuid(901), version: 2 }),
  ended_at: "2026-11-15T10:00:00Z",
  ended_by_name: as === "REOPENED" ? "Dana Lee" : null,
  ended_as: as,
  ended_reason: "",
  ...over,
});

const review = () => ({
  overall: "ADDITIONAL_EVIDENCE",
  explanation: "1 of 2 requested attributes is supported.",
  completeness: { state: "COMPLETE", reasons: [] },
  context_thin: false,
  files: [],
  confirmations: [],
  concerns: [],
  follow_ups: [],
  follow_ups_more: 0,
  follow_ups_dropped: 0,
  resolved: [],
  considerations: [],
});

function entry(over: Record<string, unknown> = {}) {
  return {
    requirement_id: REQUEST,
    run_id: uuid(62),
    status: "REVIEWED",
    stage: "DONE",
    held: null,
    held_files: [],
    file_ids: [FILE],
    lens: "INSTANCE_RECORD",
    read_in_part: false,
    attributes: [shown(A, "A"), gap(B, "B")],
    out_of_date: [],
    finished_at: "2026-11-15T10:00:00Z",
    note: "",
    engine_version: 2,
    review: review(),
    ...over,
  };
}

const assuranceOf = (...entries: Array<Record<string, unknown>>) => {
  const read = assuranceModel.parseAssurance({ requests: entries });
  assert.ok(read !== null);
  return read;
};

function check(attributes: unknown[], over: Record<string, unknown> = {}) {
  const [request] = assuranceOf(entry({ attributes, ...over })).requests;
  assert.ok(request !== undefined);
  return assuranceModel.requestCheck(request, lettered, [TICKET], span);
}

const lineOf = (made: ReturnType<typeof check>, id: string) => {
  const line = [
    ...made.attributes,
    ...made.notAddressed,
    ...made.notAsked,
  ].find((each) => each.attributeId === id);
  assert.ok(line !== undefined);
  return line;
};

function digest(
  attributes: unknown[],
  findings: Array<{ id: string; status: string }> = [],
  over: Record<string, unknown> = {},
) {
  const made = digestModel.checkDigest(check(attributes, over), findings, [
    TICKET,
  ]);
  assert.ok(made !== null);
  return made;
}

/** Supported by the documented design alone: what a policy shows. */
const design = (id: string, code: string, over: Record<string, unknown> = {}) =>
  shown(id, code, { shows: "DESIGN", ...over });

const element = (key: string, result: string, quoted: boolean) => ({
  key,
  text: `Element ${key}.`,
  result,
  absent: quoted ? [] : [`What shows element ${key}.`],
  passages: quoted ? [passage()] : [],
});

/** Shown in part by the documented design: the shape of attributes B and E of a policy
 * request, whose elements the policy only half states. */
const partlyDesign = (
  id: string,
  code: string,
  over: Record<string, unknown> = {},
) =>
  shown(id, code, {
    verdict: "PARTLY_SUPPORTED",
    result: "SHOWN_IN_PART",
    shows: "DESIGN",
    assessment: "PARTIALLY_SUPPORTED",
    passages: [],
    elements: [
      element(`${code}1`, "PARTLY_MET", false),
      element(`${code}2`, "NOT_MET", false),
    ],
    ...over,
  });

/** What recording a tickmark on an attribute may also do, as the row asks it: with the
 * first screen's own facts of the same check. */
function after(
  made: ReturnType<typeof check>,
  id: string,
  facts: { canAccept: boolean; findingStatus: string | null },
  findings: Array<{ id: string; status: string }> = [],
) {
  const read = digestModel.checkDigest(made, findings, [TICKET]);
  assert.ok(read !== null);
  return digestModel.tickmarkAfter(made, lineOf(made, id), {
    ...facts,
    open: read.facts,
  });
}

const TO_ACCEPT = { accepted: false, canAccept: true };
const ACCEPTED = { accepted: true, canAccept: false };

// The list

const requirementFile = (over: Record<string, unknown> = {}) => ({
  fileId: FILE,
  name: TICKET.name,
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
  ...over,
});

const requirement = (over: Record<string, unknown> = {}) => ({
  id: REQUEST,
  phase: "DESIGN",
  title: "One access request traced from request to grant",
  description: "One request, traced.",
  categories: ["CONTROL_EXECUTION"],
  necessity: "REQUIRED",
  state: "RECEIVED",
  pendingChange: null,
  version: 3,
  requestId: CARRIER,
  files: [requirementFile()],
  assessment: { proposal: "NONE", reason: "", followUps: [] },
  sufficiencyNote: "",
  sufficiencyBy: null,
  waiveReason: "",
  periodLabel: "",
  attributeIds: [A, B],
  procedureIds: [],
  accepted: true,
  acceptedBy: "Daniel Osei",
  acceptedAt: "2026-11-12T08:00:00Z",
  ...over,
});

function list(
  attributes: unknown[],
  over: {
    requirement?: Record<string, unknown>;
    entry?: Record<string, unknown>;
    more?: Array<{ requirement: Record<string, unknown>; entry?: unknown }>;
    approved?: string[];
    summary?: Record<string, number>;
  } = {},
) {
  const more = over.more ?? [];
  const read = assuranceModel.parseAssurance({
    requests: [
      entry({ attributes, ...over.entry }),
      ...more.flatMap((each) => (each.entry === undefined ? [] : [each.entry])),
    ],
    ...(over.summary === undefined ? {} : { summary: over.summary }),
  });
  assert.ok(read !== null);
  return listModel.evidenceList({
    requirements: [
      requirement(over.requirement),
      ...more.map((each) => requirement(each.requirement)),
    ] as never,
    approved: (over.approved ?? [A, B]).map((id) => ({
      id,
      text: "Attribute wording.",
      sourceKind: "LIBRARY",
    })),
    requests: [
      {
        id: CARRIER,
        kind: "EVIDENCE",
        status: "SENT",
        dueAt: "2026-11-26",
        delivery: { mode: "EMAIL", at: "2026-11-12T09:00:00Z", by: null },
      },
    ],
    owner: { name: "Maria Keller", role: "IT Access Manager" },
    exceptions: [],
    liveEmail: null,
    procedures: null,
    period: "The control as currently designed",
    now: NOW,
    assurance: read,
  });
}

const WAS_ACCEPTED = { state: "ACCEPTED", sufficiencyBy: "Dana Lee" };

describe("the settled rule (section 10.15, item 1)", () => {
  it("settles an attribute by the check's support, by an instance or by the design, or by a standing tickmark of any kind", () => {
    const made = check([
      shown(A, "A"),
      gap(B, "B", { disposition: tickmark("EXCEPTION") }),
      gap(C, "C"),
    ]);
    assert.equal(
      assuranceModel.attributeSettled(lineOf(made, A)),
      true,
      "supported by the check",
    );
    assert.equal(
      assuranceModel.attributeSettled(lineOf(made, B)),
      true,
      "an exception settles it here: it is carried to the workpaper",
    );
    assert.equal(assuranceModel.attributeSettled(lineOf(made, C)), false);
    // Rewritten 15 November 2026 (independent review of 408f4ce, item 2).
    // Old: support by the documented design alone did not settle an attribute
    // (`attributeSettled` was false for it: only AttributeLine.evidenced, an instance's
    // records showing it whole, settled one).
    // New: the check's support settles it whatever shows it (verdict SUPPORTED).
    // Why: the server ends a tickmark as "no longer needed" on any supported verdict, so
    // under the old rule a policy request never settled, and an attribute supported by
    // the design waited for a tickmark the next check ended, without end. What kind of
    // support it is stays said by the coverage and the accept note: `evidenced` is
    // unchanged, and narrower.
    const policy = check([design(A, "A")], { lens: "DESIGN_DOCUMENT" });
    assert.equal(
      assuranceModel.attributeSettled(lineOf(policy, A)),
      true,
      "supported by the design",
    );
    assert.equal(lineOf(policy, A).evidenced, false);
    // Supported by an instance without every element under a passage of its own: not
    // evidenced, and settled all the same.
    const loose = check([
      shown(A, "A", { elements: [element("a1", "MET", false)] }),
    ]);
    assert.equal(lineOf(loose, A).evidenced, false);
    assert.equal(assuranceModel.attributeSettled(lineOf(loose, A)), true);
    // Nothing else settles one without a tickmark: shown in part, not met, a decided
    // issue, a judgment, not addressed, waiting on a file.
    const open: Array<[string, unknown]> = [
      ["shown in part", partlyDesign(A, "A")],
      ["not met", gap(A, "A")],
      [
        "an issue decided by dismissal",
        gap(A, "A", { finding_id: uuid(71), finding_status: "DISMISSED" }),
      ],
      ["a judgment", judgment(A, "A")],
      [
        "not addressed",
        gap(A, "A", { verdict: "NOT_ADDRESSED", result: "NOT_ADDRESSED" }),
      ],
      ["waiting on a file", judgment(A, "A", { pending: "FILE_NOT_READ" })],
    ];
    for (const [name, attribute] of open) {
      const one = check([attribute]);
      assert.equal(
        assuranceModel.attributeSettled(lineOf(one, A)),
        false,
        name,
      );
      assert.equal(assuranceModel.requestSettled(one), false, name);
      // With a tickmark of any kind it is.
      const marked = check([
        { ...(attribute as object), disposition: tickmark("NOT_AVAILABLE") },
      ]);
      assert.equal(
        assuranceModel.attributeSettled(lineOf(marked, A)),
        true,
        name,
      );
    }
    // A tickmark that ended settles nothing.
    const reopened = check([
      gap(A, "A", { disposition_history: [ended("REOPENED")] }),
    ]);
    assert.equal(assuranceModel.attributeSettled(lineOf(reopened, A)), false);
  });

  it("settles a policy request whose attributes the design supports, and one shown in part by a tickmark", () => {
    // The shape of a policy request (the product owner's AC-01, where B and E are
    // shown in part by the design): A supported by the documented design, B and C
    // shown in part by it.
    const policy = (
      b: Record<string, unknown> = {},
      c: Record<string, unknown> = {},
    ) =>
      check(
        [design(A, "A"), partlyDesign(B, "B", b), partlyDesign(C, "C", c)],
        {
          lens: "DESIGN_DOCUMENT",
        },
      );
    const before = policy();
    assert.equal(assuranceModel.requestSettled(before), false);
    // Two are left: neither tickmark is the last one yet.
    assert.equal(assuranceModel.settlesLast(before, lineOf(before, B)), false);
    const one = policy({ disposition: tickmark("NOT_AVAILABLE") });
    assert.equal(assuranceModel.requestSettled(one), false);
    // With B tickmarked, C is the last one: a tickmark on it settles the request.
    // Before the rewrite it never did (A, supported by the design, was counted as not
    // settled, so no tickmark could close a policy request).
    assert.equal(assuranceModel.settlesLast(one, lineOf(one, C)), true);
    assert.equal(assuranceModel.settlesLast(one, lineOf(one, A)), false);
    for (const kind of assuranceModel.DISPOSITION_KINDS) {
      assert.equal(
        assuranceModel.requestSettled(
          policy(
            { disposition: tickmark("NOT_AVAILABLE") },
            { disposition: tickmark(kind, { id: uuid(902) }) },
          ),
        ),
        true,
        kind,
      );
    }
    // Every attribute supported by the design alone: settled with no tickmark at all,
    // and said as supported by the check, never as shown.
    const all = digest([design(A, "A"), design(B, "B")], [], {
      lens: "DESIGN_DOCUMENT",
    });
    assert.equal(all.settled, true);
    assert.equal(all.supportedOnly, true);
    assert.equal(
      digestModel.closingStatus(all, TO_ACCEPT),
      "The check supports every attribute. Accept the evidence to close this request.",
    );
    assert.match(all.verdict, /shown in design|in design/i);
  });

  it("settles a request when every attribute it asks for is settled, each kind included", () => {
    for (const kind of assuranceModel.DISPOSITION_KINDS) {
      assert.equal(
        assuranceModel.requestSettled(
          check([shown(A, "A"), gap(B, "B", { disposition: tickmark(kind) })]),
        ),
        true,
        kind,
      );
    }
    assert.equal(
      assuranceModel.requestSettled(check([shown(A, "A"), gap(B, "B")])),
      false,
    );
    // An attribute the request does not ask for does not hold it open.
    assert.equal(
      assuranceModel.requestSettled(
        check([shown(A, "A"), gap(B, "B", { expected: false })]),
      ),
      true,
    );
    // One the evidence does not bear on, and the request asks for, does.
    assert.equal(
      assuranceModel.requestSettled(
        check([
          shown(A, "A"),
          gap(B, "B", { verdict: "NOT_ADDRESSED", result: "NOT_ADDRESSED" }),
        ]),
      ),
      false,
    );
    // Nothing asked for: nothing was shown and nothing was decided.
    assert.equal(
      assuranceModel.requestSettled(
        check([shown(A, "A", { expected: false })]),
      ),
      false,
    );
  });

  it("is never settled without a finished, current check", () => {
    for (const over of [
      { status: "OUT_OF_DATE", out_of_date: ["A file was added."] },
      { status: "FAILED" },
      { status: "CHECKING" },
      { status: "HELD", held: { code: "KIND_UNSURE", reason: "" } },
    ]) {
      const made = check(
        [
          shown(A, "A"),
          gap(B, "B", { disposition: tickmark("NOT_AVAILABLE") }),
        ],
        over,
      );
      assert.equal(assuranceModel.requestSettled(made), false, over.status);
    }
  });

  it("says a tickmark settles the last one only where every other attribute asked for is settled", () => {
    const last = check([shown(A, "A"), gap(B, "B")]);
    assert.equal(assuranceModel.settlesLast(last, lineOf(last, B)), true);
    // The attribute already settled is not "the last one": nothing is left to settle.
    assert.equal(assuranceModel.settlesLast(last, lineOf(last, A)), false);
    const two = check([shown(A, "A"), gap(B, "B"), gap(C, "C")]);
    assert.equal(assuranceModel.settlesLast(two, lineOf(two, B)), false);
    const other = check([
      shown(A, "A"),
      gap(B, "B"),
      gap(C, "C", { disposition: tickmark("NOT_APPLICABLE") }),
    ]);
    assert.equal(assuranceModel.settlesLast(other, lineOf(other, B)), true);
    // Changing a tickmark that stands settles nothing new.
    const standing = check([
      shown(A, "A"),
      gap(B, "B", { disposition: tickmark("NOT_AVAILABLE") }),
    ]);
    assert.equal(
      assuranceModel.settlesLast(standing, lineOf(standing, B)),
      false,
    );
    // An attribute the request does not ask for is never the last one.
    const unasked = check([shown(A, "A"), gap(B, "B", { expected: false })]);
    assert.equal(
      assuranceModel.settlesLast(unasked, lineOf(unasked, B)),
      false,
    );
  });
});

describe("what recording a tickmark may also do (items 1 and 2)", () => {
  const last = () =>
    check([shown(A, "A"), gap(B, "B", { finding_id: uuid(72) })]);

  it("offers the acceptance only for the last one, on a request that can be accepted and is not", () => {
    const made = last();
    assert.deepEqual(
      after(made, B, { canAccept: true, findingStatus: "PROPOSED" }),
      { accept: true, dismiss: true, left: "" },
    );
    // Accepted already, or not this person's to accept: `canAccept` is false.
    assert.equal(
      after(made, B, { canAccept: false, findingStatus: "PROPOSED" }).accept,
      false,
    );
    // Not the last one.
    const two = check([shown(A, "A"), gap(B, "B"), gap(C, "C")]);
    assert.equal(
      after(two, B, { canAccept: true, findingStatus: null }).accept,
      false,
    );
    // Already settled: Accept is the first screen's, not the form's.
    const settled = check([
      shown(A, "A"),
      gap(B, "B", { disposition: tickmark("NOT_AVAILABLE") }),
    ]);
    assert.equal(
      after(settled, B, { canAccept: true, findingStatus: null }).accept,
      false,
    );
  });

  it("starts the acceptance unticked, with what is left, while anything else waits on the request", () => {
    // Independent review of 408f4ce, item 9: the box started ticked whatever else was
    // open, so one press accepted a request with a finding still to decide and a file's
    // reliability undecided. Now it starts ticked (`left` is "") only where nothing else
    // waits; otherwise `left` says what does, and the person may still tick it.
    const [findingA, findingB] = [uuid(71), uuid(72)];
    const proposed = [
      { id: findingA, status: "PROPOSED" },
      { id: findingB, status: "PROPOSED" },
    ];
    const reliability = {
      file_reliability: [
        {
          file_id: FILE,
          question: "Its completeness is not established.",
          decision: null,
          history: [],
        },
      ],
      review: {
        ...review(),
        completeness: {
          state: "RELIABILITY_UNRESOLVED",
          reasons: ["Its completeness is not established."],
        },
      },
    };
    // A carries a tickmark and its finding is still proposed; B is the last attribute.
    const busy = check(
      [
        gap(A, "A", {
          disposition: tickmark("NOT_APPLICABLE"),
          finding_id: findingA,
          finding_status: "PROPOSED",
        }),
        gap(B, "B", { finding_id: findingB, finding_status: "PROPOSED" }),
      ],
      reliability,
    );
    const offered = after(
      busy,
      B,
      { canAccept: true, findingStatus: "PROPOSED" },
      proposed,
    );
    assert.equal(offered.accept, true, "still offered: the person may tick it");
    assert.equal(
      offered.left,
      "Still open on this request: finding to decide on A, reliability of Ticket_4711.pdf.",
    );
    // The attribute's own finding is the form's other box, not "something else".
    assert.equal(offered.left.includes(" B"), false);
    // Another attribute's finding alone.
    const finding = check([
      gap(A, "A", {
        disposition: tickmark("NOT_APPLICABLE"),
        finding_id: findingA,
        finding_status: "PROPOSED",
      }),
      gap(B, "B"),
    ]);
    assert.equal(
      after(finding, B, { canAccept: true, findingStatus: null }, proposed)
        .left,
      "Still open on this request: finding to decide on A.",
    );
    // Two other attributes' findings are said together.
    const three = check([
      gap(A, "A", {
        disposition: tickmark("NOT_APPLICABLE"),
        finding_id: findingA,
        finding_status: "PROPOSED",
      }),
      gap(B, "B", {
        disposition: tickmark("NOT_AVAILABLE", { id: uuid(902) }),
        finding_id: findingB,
        finding_status: "PROPOSED",
      }),
      gap(C, "C"),
    ]);
    assert.equal(
      after(three, C, { canAccept: true, findingStatus: null }, proposed).left,
      "Still open on this request: findings to decide on A and B.",
    );
    // A file's reliability alone.
    const file = check([shown(A, "A"), gap(B, "B")], reliability);
    assert.equal(
      after(file, B, { canAccept: true, findingStatus: null }).left,
      "Still open on this request: reliability of Ticket_4711.pdf.",
    );
    // A file's type to confirm.
    const typed = check([shown(A, "A"), gap(B, "B")], {
      review: {
        ...review(),
        confirmations: [
          {
            file_id: FILE,
            code: "KIND_UNSURE",
            reason: "The reader is not sure what kind of evidence it is.",
          },
        ],
      },
    });
    assert.equal(
      after(typed, B, { canAccept: true, findingStatus: null }).left,
      "Still open on this request: type of E1 to confirm.",
    );
    // A file left out that has an action.
    const leftOut = check([shown(A, "A"), gap(B, "B")], {
      held_files: [
        {
          file_id: FILE,
          code: "KIND_UNSURE",
          reason: "Its type is not confirmed",
        },
      ],
    });
    assert.match(
      after(leftOut, B, { canAccept: true, findingStatus: null }).left,
      /^Still open on this request: .+\.$/,
    );
    // Nothing else left: ticked to start. A caveat nobody can act on (read in part) and
    // a person's exception on another attribute (carried to the workpaper) are not
    // "something else that waits".
    const calm = check([shown(A, "A"), gap(B, "B")], { read_in_part: true });
    assert.equal(
      after(calm, B, { canAccept: true, findingStatus: null }).left,
      "",
    );
    const carried = check([
      gap(A, "A", { disposition: tickmark("EXCEPTION") }),
      gap(B, "B"),
    ]);
    assert.equal(
      after(carried, B, { canAccept: true, findingStatus: null }).left,
      "",
    );
    // Where the acceptance is not offered, nothing is said of what is left.
    assert.deepEqual(
      after(busy, B, { canAccept: false, findingStatus: "PROPOSED" }, proposed),
      { accept: false, dismiss: true, left: "" },
    );
  });

  it("offers the dismissal only for a proposed finding, and only with a closing kind", () => {
    const made = last();
    for (const status of ["ACCEPTED", "SENT", "ANSWERED", "DISMISSED", null]) {
      assert.equal(
        after(made, B, { canAccept: true, findingStatus: status }).dismiss,
        false,
        String(status),
      );
    }
    // No finding on the attribute: nothing to dismiss, whatever status is said.
    const none = check([shown(A, "A"), gap(B, "B")]);
    assert.equal(
      after(none, B, { canAccept: true, findingStatus: "PROPOSED" }).dismiss,
      false,
    );
    const both = { accept: true, dismiss: true, left: "" };
    assert.equal(digestModel.dismissOffered(both, "NOT_APPLICABLE"), true);
    assert.equal(digestModel.dismissOffered(both, "NOT_AVAILABLE"), true);
    assert.equal(digestModel.dismissOffered(both, "SHOWN_ON_REVIEW"), true);
    // An exception leaves the finding to the person; so does no kind chosen yet.
    assert.equal(digestModel.dismissOffered(both, "EXCEPTION"), false);
    assert.equal(digestModel.dismissOffered(both, null), false);
    assert.equal(
      digestModel.dismissOffered(
        { accept: true, dismiss: false, left: "" },
        "NOT_APPLICABLE",
      ),
      false,
    );
  });

  it("words the two boxes as the contract does", () => {
    assert.equal(digestModel.ACCEPT_NOW, "Accept this request's evidence now");
    assert.equal(
      digestModel.ACCEPT_NOW_HINT,
      "Every attribute will then be shown or carry a tickmark.",
    );
    assert.equal(
      digestModel.DISMISS_FINDING,
      "Dismiss the check's proposed finding with this reason",
    );
  });
});

describe("the first line of a settled request (item 1)", () => {
  const settled = () =>
    digest([
      shown(A, "A"),
      gap(B, "B", { disposition: tickmark("NOT_AVAILABLE") }),
    ]);

  it("says every attribute is shown or carries a tickmark, and to accept to close", () => {
    const made = settled();
    assert.equal(made.settled, true);
    assert.equal(
      digestModel.closingStatus(made, TO_ACCEPT),
      "Every attribute is shown or carries your tickmark. Accept the evidence to close this request.",
    );
    assert.equal(
      digestModel.withClosing(made, TO_ACCEPT).status,
      "Every attribute is shown or carries your tickmark. Accept the evidence to close this request.",
    );
    // Everything else of the digest is the check's, untouched.
    assert.deepEqual(
      { ...digestModel.withClosing(made, TO_ACCEPT), status: made.status },
      made,
    );
  });

  it("asks for the press only where the row offers Accept, and says accepted once it is", () => {
    const made = settled();
    assert.equal(
      digestModel.closingStatus(made, { accepted: false, canAccept: false }),
      "Every attribute is shown or carries your tickmark.",
    );
    assert.equal(
      digestModel.closingStatus(made, ACCEPTED),
      "Evidence accepted. Every attribute is shown or carries your tickmark.",
    );
    // Where the row does not say where the request stands: the status of 10.14.
    assert.equal(digestModel.closingStatus(made, null), made.status);
    assert.equal(made.status, "Your tickmark settles B. Nothing waits on you.");
  });

  it("carries a person's exception to the workpaper, and still offers to accept", () => {
    const one = digest([
      shown(A, "A"),
      gap(B, "B", { disposition: tickmark("EXCEPTION") }),
    ]);
    assert.equal(one.settled, true);
    assert.equal(
      digestModel.closingStatus(one, TO_ACCEPT),
      "Every attribute is shown or carries your tickmark. 1 exception is carried to the workpaper. Accept the evidence to close this request.",
    );
    assert.equal(
      digestModel.closingStatus(one, ACCEPTED),
      "Evidence accepted. Every attribute is shown or carries your tickmark. 1 exception is carried to the workpaper.",
    );
    const two = digest([
      gap(A, "A", { disposition: tickmark("EXCEPTION") }),
      gap(B, "B", { disposition: tickmark("EXCEPTION", { id: uuid(902) }) }),
    ]);
    assert.match(
      digestModel.closingStatus(two, TO_ACCEPT),
      / 2 exceptions are carried to the workpaper\. /,
    );
    assert.equal(
      digestModel.exceptionsCarried(1),
      "1 exception is carried to the workpaper.",
    );
    // The exception keeps its item, marked: it is never ticked away.
    assert.equal(one.attention.length, 1);
    assert.equal(one.attention[0]?.tickmark?.label, "Exception recorded");
  });

  it("never says more than the records: what is not settled keeps the status of 10.14", () => {
    const open = digest([shown(A, "A"), gap(B, "B")]);
    assert.equal(open.settled, false);
    assert.equal(digestModel.closingStatus(open, TO_ACCEPT), open.status);
    assert.equal(open.status, "Still open: attribute B.");
    assert.equal(
      digestModel
        .closingStatus(open, TO_ACCEPT)
        .includes("Accept the evidence"),
      false,
    );
  });

  it("still says what else is left: a finding to decide, a caveat", () => {
    const finding = uuid(72);
    const waits = digest(
      [
        shown(A, "A"),
        gap(B, "B", {
          finding_id: finding,
          finding_status: "PROPOSED",
          disposition: tickmark("NOT_AVAILABLE"),
        }),
      ],
      [{ id: finding, status: "PROPOSED" }],
    );
    assert.equal(
      digestModel.closingStatus(waits, TO_ACCEPT),
      "Every attribute is shown or carries your tickmark. Still open: finding to decide on B. Accept the evidence to close this request.",
    );
    const part = digest(
      [shown(A, "A"), gap(B, "B", { disposition: tickmark("NOT_APPLICABLE") })],
      [],
      { read_in_part: true },
    );
    assert.equal(
      digestModel.closingStatus(part, ACCEPTED),
      "Evidence accepted. Every attribute is shown or carries your tickmark. Still open: read in part.",
    );
  });

  it("does not speak of a tickmark where the check alone shows every attribute", () => {
    const all = digest([shown(A, "A"), shown(B, "B")]);
    assert.equal(all.settled, true);
    assert.equal(all.tickmarked, false);
    assert.equal(
      digestModel.closingStatus(all, TO_ACCEPT),
      "Every attribute is shown. Accept the evidence to close this request.",
    );
    assert.equal(
      digestModel.closingStatus(all, ACCEPTED),
      "Evidence accepted. Every attribute is shown.",
    );
  });
});

describe("the coverage (item 4)", () => {
  const coverageOf = (view: ReturnType<typeof list>, id: string) => {
    const chip = view.coverage.find((each) => each.attributeId === id);
    assert.ok(chip !== undefined);
    return chip;
  };

  it("words an attribute settled by a tickmark by its kind, never as evidenced", () => {
    const cases: Array<[string, string, string]> = [
      ["NOT_APPLICABLE", "B not applicable, your tickmark", "Not applicable"],
      [
        "NOT_AVAILABLE",
        "B accepted without evidence, your tickmark",
        "Accepted without evidence",
      ],
      ["SHOWN_ON_REVIEW", "B shown on your review", "On your review"],
      ["EXCEPTION", "B exception recorded", "Exception recorded"],
    ];
    for (const [kind, words, chipWords] of cases) {
      const view = list(
        [shown(A, "A"), gap(B, "B", { disposition: tickmark(kind) })],
        { requirement: WAS_ACCEPTED },
      );
      const chip = coverageOf(view, B);
      assert.equal(chip.state, "TICKMARK", kind);
      assert.equal(chip.tickmark, kind);
      assert.equal(chip.label, `Attribute B: ${words.slice(2)}`);
      assert.equal(
        view.coverageLine,
        `1 of 2 attributes evidenced · ${words}`,
        kind,
      );
      assert.equal(/evidenced|evidence accepted/.test(chip.label), false);
      assert.equal(
        listModel.COVERAGE_TICKMARKS[kind as "EXCEPTION"].chip,
        chipWords,
      );
      // Only the check's own evidence counts.
      assert.equal(coverageOf(view, A).state, "EVIDENCED");
      assert.equal(coverageOf(view, A).tickmark, null);
    }
  });

  it("no longer says 'accepted without support from the check', nor 'still not shown', of one that carries a tickmark", () => {
    const elements = {
      elements: [
        {
          key: "b1",
          text: "Every account is listed.",
          result: "NOT_MET",
          absent: [],
          passages: [],
        },
      ],
    };
    const before = list([shown(A, "A"), gap(B, "B", elements)], {
      requirement: WAS_ACCEPTED,
    });
    assert.equal(
      before.coverageLine,
      "1 of 2 attributes evidenced · B accepted without support from the check",
    );
    assert.equal(coverageOf(before, B).unsupported, true);
    assert.deepEqual(coverageOf(before, B).missing, [
      "Every account is listed.",
    ]);
    const after = list(
      [
        shown(A, "A"),
        gap(B, "B", { ...elements, disposition: tickmark("NOT_AVAILABLE") }),
      ],
      { requirement: WAS_ACCEPTED },
    );
    assert.equal(after.coverageLine.includes("without support"), false);
    assert.equal(coverageOf(after, B).unsupported, false);
    assert.deepEqual(coverageOf(after, B).missing, []);
    assert.equal(
      after.coverage.some((chip) => chip.missing.length > 0),
      false,
    );
  });

  it("puts a person's exception over the check's own evidence, and a closing tickmark under it", () => {
    const exception = list(
      [shown(A, "A", { disposition: tickmark("EXCEPTION") }), shown(B, "B")],
      { requirement: WAS_ACCEPTED },
    );
    assert.equal(coverageOf(exception, A).state, "TICKMARK");
    assert.equal(
      exception.coverageLine,
      "1 of 2 attributes evidenced · A exception recorded",
    );
    const closing = list(
      [
        shown(A, "A", { disposition: tickmark("NOT_APPLICABLE") }),
        shown(B, "B"),
      ],
      { requirement: WAS_ACCEPTED },
    );
    assert.equal(coverageOf(closing, A).state, "EVIDENCED");
    assert.equal(closing.coverageLine, "2 of 2 attributes evidenced");
  });

  it("says several of a kind together, and nothing of a tickmark on a check that is not current", () => {
    const both = list(
      [
        gap(A, "A", { disposition: tickmark("NOT_APPLICABLE") }),
        gap(B, "B", {
          disposition: tickmark("NOT_APPLICABLE", { id: uuid(902) }),
        }),
      ],
      { requirement: WAS_ACCEPTED },
    );
    assert.equal(
      both.coverageLine,
      "0 of 2 attributes evidenced · A and B not applicable, your tickmarks",
    );
    const stale = list(
      [shown(A, "A"), gap(B, "B", { disposition: tickmark("NOT_APPLICABLE") })],
      {
        requirement: WAS_ACCEPTED,
        entry: { status: "OUT_OF_DATE", out_of_date: ["A file was added."] },
      },
    );
    assert.equal(coverageOf(stale, B).state, "REQUESTED");
    assert.equal(stale.coverageLine.includes("tickmark"), false);
  });
});

describe("whose tickmark the coverage takes (independent review of 408f4ce, item 8)", () => {
  const coverageOf = (view: ReturnType<typeof list>, id: string) => {
    const chip = view.coverage.find((each) => each.attributeId === id);
    assert.ok(chip !== undefined);
    return chip;
  };
  const NOT_APPLICABLE = () => [
    shown(A, "A"),
    gap(B, "B", { disposition: tickmark("NOT_APPLICABLE") }),
  ];
  /** A second request of the control that addresses B, with its own check. */
  const second = (
    attribute: unknown,
    requirement: Record<string, unknown> = {},
    over: Record<string, unknown> = {},
  ) => ({
    requirement: {
      id: OTHER,
      title: "Second request",
      attributeIds: [B],
      ...requirement,
    },
    entry: entry({
      requirement_id: OTHER,
      run_id: uuid(63),
      attributes: [attribute],
      ...over,
    }),
  });
  const contradicted = () =>
    gap(B, "B", { contradicted: true, assessment: "CONTRADICTED" });

  it("takes a closing kind only from a request a person accepted", () => {
    // Before: a tickmark on a request nobody had accepted read "B accepted without
    // evidence, your tickmark" in the coverage. A tickmark alone closes nothing.
    for (const kind of ["NOT_APPLICABLE", "NOT_AVAILABLE", "SHOWN_ON_REVIEW"]) {
      const waiting = list([
        shown(A, "A"),
        gap(B, "B", { disposition: tickmark(kind) }),
      ]);
      const chip = coverageOf(waiting, B);
      assert.equal(chip.state, "REQUESTED", kind);
      assert.equal(chip.tickmark, null, kind);
      assert.equal(
        chip.label,
        "Attribute B: requested, no evidence accepted yet",
        kind,
      );
      assert.equal(
        /tickmark|accepted without evidence|on your review|not applicable/.test(
          waiting.coverageLine,
        ),
        false,
        waiting.coverageLine,
      );
      // What the check says, as before tickmarks: the same line as with no tickmark.
      assert.equal(
        waiting.coverageLine,
        list([shown(A, "A"), gap(B, "B")]).coverageLine,
        kind,
      );
      // Once the request is accepted, it is said.
      assert.equal(
        coverageOf(
          list([shown(A, "A"), gap(B, "B", { disposition: tickmark(kind) })], {
            requirement: WAS_ACCEPTED,
          }),
          B,
        ).tickmark,
        kind,
      );
    }
    // A person's exception is said wherever it stands, accepted or not.
    const exception = list([
      shown(A, "A"),
      gap(B, "B", { disposition: tickmark("EXCEPTION") }),
    ]);
    assert.equal(coverageOf(exception, B).state, "TICKMARK");
    assert.equal(coverageOf(exception, B).tickmark, "EXCEPTION");
  });

  it("does not let one request's closing tickmark outrank what another request's check found", () => {
    // Before: B read "not applicable, your tickmark" although the second request's
    // current check has the records contradict B.
    for (const [name, other] of [
      ["contradicted", contradicted()],
      ["left to a person", judgment(B, "B")],
    ] as const) {
      for (const state of [WAS_ACCEPTED, { state: "RECEIVED" }]) {
        const view = list(NOT_APPLICABLE(), {
          requirement: WAS_ACCEPTED,
          more: [second(other, state)],
        });
        const chip = coverageOf(view, B);
        assert.equal(chip.tickmark, null, name);
        assert.notEqual(chip.state, "TICKMARK", name);
        assert.equal(view.coverageLine.includes("tickmark"), false, name);
        // What the checks say, as before tickmarks: the line without the tickmark.
        assert.equal(
          view.coverageLine,
          list([shown(A, "A"), gap(B, "B")], {
            requirement: WAS_ACCEPTED,
            more: [second(other, state)],
          }).coverageLine,
          name,
        );
      }
    }
    // The other request's check finds B not shown, without a contradiction and not
    // left to a person: the accepted request's tickmark is the coverage's word.
    const plain = list(NOT_APPLICABLE(), {
      requirement: WAS_ACCEPTED,
      more: [second(gap(B, "B"))],
    });
    assert.equal(coverageOf(plain, B).tickmark, "NOT_APPLICABLE");
    // A judgment the person has themselves settled with a tickmark on that request is
    // no longer left to them.
    const decided = list(NOT_APPLICABLE(), {
      requirement: WAS_ACCEPTED,
      more: [
        second(
          judgment(B, "B", {
            disposition: tickmark("NOT_APPLICABLE", { id: uuid(902) }),
          }),
          WAS_ACCEPTED,
        ),
      ],
    });
    assert.equal(coverageOf(decided, B).tickmark, "NOT_APPLICABLE");
    // Only a current check disputes: one that is out of date says nothing now.
    const stale = list(NOT_APPLICABLE(), {
      requirement: WAS_ACCEPTED,
      more: [
        second(
          contradicted(),
          {},
          { status: "OUT_OF_DATE", out_of_date: ["A file was added."] },
        ),
      ],
    });
    assert.equal(coverageOf(stale, B).tickmark, "NOT_APPLICABLE");
    // A second request with no check at all leaves the tickmark its word.
    const unchecked = list(NOT_APPLICABLE(), {
      requirement: WAS_ACCEPTED,
      more: [
        {
          requirement: {
            id: OTHER,
            title: "Second request",
            state: "SENT",
            files: [],
            attributeIds: [B],
          },
        },
      ],
    });
    assert.equal(coverageOf(unchecked, B).tickmark, "NOT_APPLICABLE");
    // A person's exception outranks everything, another request's finding included.
    const exception = list(
      [shown(A, "A"), gap(B, "B", { disposition: tickmark("EXCEPTION") })],
      { requirement: WAS_ACCEPTED, more: [second(contradicted())] },
    );
    assert.equal(coverageOf(exception, B).tickmark, "EXCEPTION");
    // The exception may stand on the request that is not accepted, over the accepted
    // one's closing tickmark.
    const over = list(NOT_APPLICABLE(), {
      requirement: WAS_ACCEPTED,
      more: [
        second(
          contradicted(),
          {},
          {
            attributes: [
              {
                ...(contradicted() as object),
                disposition: tickmark("EXCEPTION", { id: uuid(902) }),
              },
            ],
          },
        ),
      ],
    });
    assert.equal(coverageOf(over, B).tickmark, "EXCEPTION");
  });
});

describe("the row's chips and the step's counts (item 4)", () => {
  const rowOf = (view: ReturnType<typeof list>) => {
    const row = view.rows.find((each) => each.id === REQUEST);
    assert.ok(row !== undefined && row.assurance !== null);
    return row;
  };

  it("leaves an attribute with a closing tickmark out of the row's chips, and counts an exception as an issue", () => {
    const before = rowOf(
      list([shown(A, "A"), gap(B, "B"), judgment(C, "C")], {
        requirement: { attributeIds: [A, B, C] },
        approved: [A, B, C],
      }),
    );
    assert.deepEqual(
      before.assurance?.states.map((group) => group.label),
      ["A supported (implementation)", "B issue", "C your judgment needed"],
    );
    for (const kind of ["NOT_APPLICABLE", "NOT_AVAILABLE", "SHOWN_ON_REVIEW"]) {
      const after = rowOf(
        list(
          [
            shown(A, "A"),
            gap(B, "B", { disposition: tickmark(kind) }),
            judgment(C, "C", {
              disposition: tickmark(kind, { id: uuid(902) }),
            }),
          ],
          { requirement: { attributeIds: [A, B, C] }, approved: [A, B, C] },
        ),
      );
      assert.deepEqual(
        after.assurance?.states.map((group) => group.label),
        ["A supported (implementation)"],
        kind,
      );
      assert.equal(after.assurance?.spoken, "A supported (implementation)");
    }
    const excepted = rowOf(
      list([
        shown(A, "A", { disposition: tickmark("EXCEPTION") }),
        judgment(B, "B", {
          disposition: tickmark("EXCEPTION", { id: uuid(902) }),
        }),
      ]),
    );
    assert.deepEqual(
      excepted.assurance?.states.map((group) => group.label),
      ["A and B issue"],
    );
  });

  it("counts for the step what waits: not what a closing tickmark closed, and an exception as an issue", () => {
    const counts = (attributes: unknown[], summary?: Record<string, number>) =>
      assuranceModel.assuranceCounts(
        assuranceModel.parseAssurance({
          requests: [entry({ attributes })],
          ...(summary === undefined ? {} : { summary }),
        }),
      );
    const open = counts([gap(A, "A"), judgment(B, "B")]);
    assert.deepEqual([open.issues, open.unsettled], [1, 1]);
    const closed = counts([
      gap(A, "A", { disposition: tickmark("NOT_AVAILABLE") }),
      judgment(B, "B", {
        disposition: tickmark("NOT_APPLICABLE", { id: uuid(902) }),
      }),
    ]);
    assert.deepEqual([closed.issues, closed.unsettled], [0, 0]);
    // The server's summary may still count them: what the tickmarks close is taken off.
    const said = counts(
      [
        gap(A, "A", { disposition: tickmark("NOT_AVAILABLE") }),
        judgment(B, "B", {
          disposition: tickmark("NOT_APPLICABLE", { id: uuid(902) }),
        }),
      ],
      { issues: 1, unsettled: 1 },
    );
    assert.deepEqual([said.issues, said.unsettled], [0, 0]);
    // A summary that already leaves them out is not taken below what the page shows.
    const already = counts(
      [gap(A, "A"), gap(B, "B", { disposition: tickmark("NOT_AVAILABLE") })],
      { issues: 1, unsettled: 0 },
    );
    assert.equal(already.issues, 1);
    // An exception is an issue whatever the check found, counted once.
    const exception = counts([
      shown(A, "A", { disposition: tickmark("EXCEPTION") }),
      judgment(B, "B", {
        disposition: tickmark("EXCEPTION", { id: uuid(902) }),
      }),
      gap(C, "C", { disposition: tickmark("EXCEPTION", { id: uuid(903) }) }),
    ]);
    assert.deepEqual([exception.issues, exception.unsettled], [3, 0]);
  });

  it("says so on the step's pill while the files wait to be reviewed", () => {
    const view = list([
      shown(A, "A"),
      gap(B, "B", { disposition: tickmark("EXCEPTION") }),
    ]);
    assert.equal(view.header.status, "1 file to review · 1 issue");
    const closed = list([
      shown(A, "A"),
      gap(B, "B", { disposition: tickmark("NOT_AVAILABLE") }),
    ]);
    assert.equal(closed.header.status, "1 file to review");
  });
});

describe("an accepted request with an attribute to look at again (item 4)", () => {
  const again = (attributes: unknown[], over: Record<string, unknown> = {}) =>
    list(attributes, { requirement: WAS_ACCEPTED, ...over });

  it("is done where every accepted request is as it was accepted", () => {
    const settled = again([
      shown(A, "A"),
      gap(B, "B", { disposition: tickmark("NOT_AVAILABLE") }),
    ]);
    assert.equal(settled.header.standing, "DONE");
    assert.equal(settled.header.status, "1 of 1 accepted");
    assert.deepEqual(settled.rows[0]?.again, []);
    // Accepted over an open issue, with no tickmark ever recorded on the request: the
    // page has no record that the attribute was looked at before, so it does not say
    // "again" (the accept note said what accepting does not settle).
    const legacy = again([shown(A, "A"), gap(B, "B")]);
    assert.equal(legacy.header.standing, "DONE");
    assert.deepEqual(legacy.rows[0]?.again, []);
  });

  it("is not done once a tickmark is reopened, and says which request and attribute", () => {
    const view = again([
      shown(A, "A"),
      gap(B, "B", { disposition_history: [ended("REOPENED")] }),
    ]);
    assert.equal(view.header.standing, "AGAIN");
    assert.equal(view.header.tone, "attention");
    assert.equal(
      view.header.status,
      "1 accepted request has an attribute to look at again",
    );
    assert.equal(view.header.need.kind, "act");
    assert.equal(
      view.header.need.title,
      "1 accepted request has an attribute to look at again.",
    );
    assert.equal(
      view.header.need.detail,
      "One access request traced from request to grant: attribute B waits on you again. A tickmark on it no longer stands. Open the request to record a tickmark or add evidence.",
    );
    assert.deepEqual(view.rows[0]?.again, ["B"]);
    assert.match(view.rows[0]?.sub ?? "", / · B to look at again$/);
    // It points at the row: the one that opens.
    assert.equal(view.open, REQUEST);
  });

  it("is not done once a later check overtook a tickmark or its annotation is gone, for that attribute only", () => {
    for (const as of ["OVERTAKEN_BY_CHECK", "ANNOTATION_GONE"]) {
      const view = again([
        shown(A, "A"),
        gap(B, "B", { disposition_history: [ended(as)] }),
      ]);
      assert.equal(view.header.standing, "AGAIN", as);
      assert.deepEqual(view.rows[0]?.again, ["B"], as);
    }
    // Rewritten 15 November 2026 (independent review of 408f4ce, item 2).
    // Old: once any tickmark of the request came from an earlier check, or a check had
    // ended one, every attribute the new check did not evidence was "to look at again":
    // `later` below gave AGAIN with ["A"], and `superseded` gave ["A"], for an attribute
    // that never carried a tickmark and was accepted as it is.
    // New: only an attribute whose OWN most recent tickmark ended as reopened, overtaken
    // by a check or with its annotation, and that carries none now, waits again.
    // Why: the old rule fired on attributes that never waited, and never stopped on a
    // request re-checked after its tickmarks (the server keeps them; the page had no way
    // to clear "again" but to tickmark what was accepted without one).
    const later = again([
      gap(A, "A"),
      gap(B, "B", {
        disposition: tickmark("NOT_AVAILABLE", { on_current_check: false }),
      }),
    ]);
    assert.equal(later.header.standing, "DONE");
    assert.deepEqual(later.rows[0]?.again, []);
    // The same facts with the tickmark recorded on the current check read the same:
    // which check a standing tickmark is from changes nothing for another attribute.
    const current = again([
      gap(A, "A"),
      gap(B, "B", { disposition: tickmark("NOT_AVAILABLE") }),
    ]);
    assert.equal(current.header.standing, later.header.standing);
    assert.equal(current.header.status, later.header.status);
    // A check ended B's tickmark by finding B supported: B never waited, and A never
    // carried one.
    const superseded = again([
      gap(A, "A"),
      shown(B, "B", { disposition_history: [ended("SUPERSEDED_BY_CHECK")] }),
    ]);
    assert.equal(superseded.header.standing, "DONE");
    assert.deepEqual(superseded.rows[0]?.again, []);
    // A tickmark another replaced did not end the person's conclusion.
    const replaced = again([
      shown(A, "A"),
      gap(B, "B", {
        disposition: tickmark("NOT_APPLICABLE"),
        disposition_history: [ended("REPLACED")],
      }),
    ]);
    assert.equal(replaced.header.standing, "DONE");
    // Recorded again, it no longer waits.
    const recorded = again([
      shown(A, "A"),
      gap(B, "B", {
        disposition: tickmark("NOT_APPLICABLE"),
        disposition_history: [ended("REOPENED")],
      }),
    ]);
    assert.equal(recorded.header.standing, "DONE");
    // The most recent ending decides, whatever came before it, in whatever order the
    // history is sent.
    const [early, late] = ["2026-11-14T08:00:00Z", "2026-11-15T11:00:00Z"];
    const history = (first: string, then: string) => [
      ended(then, { id: uuid(911), ended_at: late }),
      ended(first, { id: uuid(910), ended_at: early }),
    ];
    for (const sent of [
      history("SUPERSEDED_BY_CHECK", "REOPENED"),
      history("SUPERSEDED_BY_CHECK", "REOPENED").reverse(),
    ]) {
      assert.deepEqual(
        again([shown(A, "A"), gap(B, "B", { disposition_history: sent })])
          .rows[0]?.again,
        ["B"],
      );
    }
    for (const sent of [
      history("REOPENED", "SUPERSEDED_BY_CHECK"),
      history("REOPENED", "SUPERSEDED_BY_CHECK").reverse(),
    ]) {
      assert.deepEqual(
        again([shown(A, "A"), gap(B, "B", { disposition_history: sent })])
          .rows[0]?.again,
        [],
      );
    }
    // Reopened, and the check now supports it: nothing waits.
    assert.deepEqual(
      again([
        shown(A, "A"),
        design(B, "B", { disposition_history: [ended("REOPENED")] }),
      ]).rows[0]?.again,
      [],
    );
  });

  it("stays done on a policy request, and does not loop on an attribute the design supports", () => {
    // The shape of the product owner's policy request: two attributes shown in part by
    // the design, one of them tickmarked, the request accepted.
    const policy = (over: Record<string, unknown> = {}) =>
      again(
        [
          partlyDesign(A, "A"),
          partlyDesign(B, "B", {
            disposition: tickmark("NOT_AVAILABLE", over),
          }),
        ],
        { entry: { lens: "DESIGN_DOCUMENT" } },
      );
    assert.equal(policy().header.standing, "DONE");
    // Checked again: the tickmark stands from the earlier check. A never carried one,
    // so it does not wait "again" (before, it did, on every request re-checked).
    const rechecked = policy({ on_current_check: false });
    assert.equal(rechecked.header.standing, "DONE");
    assert.equal(rechecked.header.status, "1 of 1 accepted");
    assert.deepEqual(rechecked.rows[0]?.again, []);
    // A, supported by the design, was tickmarked and the request accepted; the next
    // check supports A again, so the server ends the tickmark as no longer needed.
    // Before: A was "not settled" (design only) and its tickmark gone, so the step went
    // back to "to look at again", and tickmarking A again only repeated it.
    const attributes = [
      design(A, "A", {
        disposition_history: [ended("SUPERSEDED_BY_CHECK")],
      }),
      shown(B, "B"),
    ];
    const looped = again(attributes, { entry: { lens: "DESIGN_DOCUMENT" } });
    assert.equal(looped.header.standing, "DONE");
    assert.equal(looped.header.status, "1 of 1 accepted");
    assert.deepEqual(looped.rows[0]?.again, []);
    assert.equal(/look at again/.test(looped.rows[0]?.sub ?? ""), false);
    const made = check(attributes, { lens: "DESIGN_DOCUMENT" });
    assert.equal(assuranceModel.requestSettled(made), true);
    assert.deepEqual(assuranceModel.waitingAgain(made), []);
    assert.equal(
      digestModel.closingStatus(digest(attributes), ACCEPTED),
      "Evidence accepted. The check supports every attribute.",
    );
  });

  it("counts the requests, and gives way to files still to review", () => {
    const second = {
      requirement: { id: OTHER, title: "Second request", ...WAS_ACCEPTED },
      entry: entry({
        requirement_id: OTHER,
        attributes: [
          gap(A, "A", { disposition_history: [ended("REOPENED")] }),
          shown(B, "B"),
        ],
      }),
    };
    const two = again(
      [
        shown(A, "A"),
        gap(B, "B", { disposition_history: [ended("REOPENED")] }),
      ],
      { more: [second] },
    );
    assert.equal(
      two.header.status,
      "2 accepted requests have attributes to look at again",
    );
    assert.match(two.header.need.detail, / 1 more request has the same\.$/);
    assert.equal(
      listModel.lookAgainStatus(1),
      "1 accepted request has an attribute to look at again",
    );
    // A request that is not accepted is reviewed first: its row already waits.
    const review = list([
      shown(A, "A"),
      gap(B, "B", { disposition_history: [ended("REOPENED")] }),
    ]);
    assert.equal(review.header.standing, "REVIEW");
    assert.deepEqual(review.rows[0]?.again, []);
  });

  it("says the same on the workflow, from the list's header and from the items alone", () => {
    const base: workflowModel.WorkflowInput = {
      details: [{ label: "Description", filled: true }],
      setup: [],
      attributes: { approved: 2, proposed: 0 },
      plan: { exists: true, approved: true, pendingReview: false },
      requirements: [],
      designRelease: { step: "RELEASED" },
      sheet: null,
      rounds: [],
      findings: [],
      reviewStatus: "",
      conclusion: "NOT_CONCLUDED",
      proposedConclusion: null,
      designPaper: null,
      designConclusion: null,
      effectivenessPaper: null,
      busy: new Set(),
    };
    const step = (over: Partial<workflowModel.WorkflowInput>) => {
      const found = workflowModel
        .workflowOf({ ...base, ...over })
        .find((each) => each.key === "designevidence");
      return [found?.tone, found?.status];
    };
    const view = again([
      shown(A, "A"),
      gap(B, "B", { disposition_history: [ended("REOPENED")] }),
    ]);
    const said = [
      "attention",
      "1 accepted request has an attribute to look at again",
    ];
    assert.deepEqual(
      step({
        requirements: [{ phase: "DESIGN", state: "ACCEPTED" }],
        designEvidence: view.header,
      }),
      said,
    );
    // The fallback, where the list's header was not read: never "done" while it holds.
    assert.deepEqual(
      step({
        requirements: [{ phase: "DESIGN", state: "ACCEPTED", again: true }],
      }),
      said,
    );
    assert.deepEqual(
      step({
        requirements: [{ phase: "DESIGN", state: "ACCEPTED", again: false }],
      }),
      ["done", "1 of 1 accepted"],
    );
    assert.deepEqual(
      step({
        requirements: [
          { phase: "DESIGN", state: "ACCEPTED", again: true },
          { phase: "DESIGN", state: "ACCEPTED", again: true },
        ],
      }),
      ["attention", "2 accepted requests have attributes to look at again"],
    );
    // What reads the rule for the fallback is the rows' own rule.
    const read = assuranceOf(
      entry({
        attributes: [
          shown(A, "A"),
          gap(B, "B", { disposition_history: [ended("REOPENED")] }),
        ],
      }),
    );
    assert.deepEqual(
      [
        ...listModel.requestsToLookAgain(
          [requirement(WAS_ACCEPTED), requirement({ id: OTHER })] as never,
          read,
        ),
      ],
      [REQUEST],
    );
    assert.equal(
      listModel.requestsToLookAgain([requirement(WAS_ACCEPTED)] as never, null)
        .size,
      0,
    );
  });

  it("says of the items only what the server says: never 'to review' of one nobody can accept", () => {
    const base: workflowModel.WorkflowInput = {
      details: [{ label: "Description", filled: true }],
      setup: [],
      attributes: { approved: 2, proposed: 0 },
      plan: { exists: true, approved: true, pendingReview: false },
      requirements: [],
      designRelease: { step: "RELEASED" },
      sheet: null,
      rounds: [],
      findings: [],
      reviewStatus: "",
      conclusion: "NOT_CONCLUDED",
      proposedConclusion: null,
      designPaper: null,
      designConclusion: null,
      effectivenessPaper: null,
      busy: new Set(),
    };
    const stepOf = (
      key: string,
      over: Partial<workflowModel.WorkflowInput>,
    ) => {
      const found = workflowModel
        .workflowOf({ ...base, ...over })
        .find((each) => each.key === key);
      return [found?.tone, found?.status];
    };
    const step = (requirements: workflowModel.WorkflowInput["requirements"]) =>
      stepOf("designevidence", { requirements });
    // Rewritten 15 November 2026 (independent review of 408f4ce, item 7).
    // Old: an item not requested yet (planned, or waiting for an earlier one) was
    // counted "to review" whenever its count of files was above zero:
    // `{ state: "AWAITING_DEPENDENCY", files: 1 }` gave ["attention", "1 item to
    // review"]. The count included a file only shared by a sibling control, which
    // nobody can accept, and every OE item with a file.
    // New: the fallback reads the state the server gives and nothing else. An item that
    // waited for an earlier one and has a file of its own comes as RECEIVED (section
    // 10.15, item 3), and is to review; one that still waits is later.
    assert.deepEqual(
      step([
        { phase: "DESIGN", state: "ACCEPTED" },
        { phase: "DESIGN", state: "RECEIVED" },
      ]),
      ["attention", "1 item to review"],
    );
    for (const state of ["AWAITING_DEPENDENCY", "NOT_GENERATED"] as const) {
      assert.deepEqual(
        step([
          { phase: "DESIGN", state: "ACCEPTED" },
          { phase: "DESIGN", state },
        ]),
        ["done", "1 accepted · 1 later"],
        state,
      );
      // A count of files that a caller still passes changes nothing.
      assert.deepEqual(
        step([
          { phase: "DESIGN", state: "ACCEPTED" },
          { phase: "DESIGN", state, files: 1 } as never,
        ]),
        ["done", "1 accepted · 1 later"],
        state,
      );
    }
    // The same for OE evidence: items not requested yet are not "to review".
    assert.deepEqual(
      stepOf("oeevidence", {
        designConclusion: {
          status: "SIGNED_OFF",
          proposed: "EFFECTIVE",
          signed: "EFFECTIVE",
        },
        requirements: [
          { phase: "DESIGN", state: "ACCEPTED" },
          { phase: "INTERIM", state: "NOT_GENERATED", files: 1 } as never,
          { phase: "INTERIM", state: "NOT_GENERATED" },
        ],
      })[1] === "1 item to review",
      false,
    );
    // The list itself never offers Accept for an item that waits with a sibling's file
    // only, so the workflow must not say it is to review.
    const waiting = list([shown(A, "A"), gap(B, "B")], {
      requirement: {
        state: "AWAITING_DEPENDENCY",
        requestId: null,
        files: [requirementFile({ via: "SHARED", sharedFrom: "SAP" })],
      },
    });
    assert.equal(waiting.rows[0]?.canAccept, false);
  });
});

describe("an item that waited for an earlier one, with its own file (item 3)", () => {
  it("can be accepted as the server sends it: received, with no request of its own", () => {
    // The server sends such an item in the state a planned item with a file has
    // (RECEIVED). Nothing of the list hides Accept for it.
    const view = list([shown(A, "A"), gap(B, "B")], {
      requirement: { state: "RECEIVED", requestId: null },
    });
    const row = view.rows[0];
    assert.equal(row?.canAccept, true);
    assert.equal(row?.judgeable, true);
    assert.equal(row?.waits, true);
    assert.equal(row?.state, "TO_REVIEW");
    assert.equal(view.header.standing, "REVIEW");
    assert.equal(view.open, REQUEST);
  });
});

describe("tickmarks kept while a check is not current (item 8)", () => {
  it("says how many, on the check's line, singular handled", () => {
    assert.equal(
      assuranceModel.tickmarksKeptLine(3),
      "3 tickmarks kept. They apply again once the request is checked again.",
    );
    assert.equal(
      assuranceModel.tickmarksKeptLine(1),
      "1 tickmark kept. It applies again once the request is checked again.",
    );
    assert.equal(assuranceModel.tickmarksKeptLine(0), "");
    for (const over of [
      { status: "OUT_OF_DATE", out_of_date: ["A file was added."] },
      { status: "FAILED" },
      { status: "CHECKING" },
      { status: "QUEUED" },
      { status: "HELD", held: { code: "KIND_UNSURE", reason: "" } },
    ]) {
      const made = check([], { ...over, tickmarks_kept: 3 });
      assert.equal(
        made.kept,
        "3 tickmarks kept. They apply again once the request is checked again.",
        over.status,
      );
    }
  });

  it("says nothing on a current check, nor where the server sends no count it can read", () => {
    assert.equal(check([shown(A, "A")], { tickmarks_kept: 2 }).kept, "");
    for (const sent of [undefined, null, 0, -1, 1.5, "3"]) {
      const made = check([], {
        status: "OUT_OF_DATE",
        out_of_date: ["A file was added."],
        ...(sent === undefined ? {} : { tickmarks_kept: sent }),
      });
      assert.equal(made.kept, "", String(sent));
    }
    const [request] = assuranceOf(
      entry({ status: "FAILED", tickmarks_kept: 4 }),
    ).requests;
    assert.equal(request?.tickmarksKept, 4);
    assert.equal(assuranceModel.notChecked(REQUEST).tickmarksKept, 0);
  });
});

describe("a tickmark recorded on an earlier check (item 9)", () => {
  it("is read from the server's own answer, and tolerates its absence", () => {
    const read = (sent: unknown) =>
      lineOf(
        check([
          shown(A, "A"),
          gap(B, "B", {
            disposition: tickmark(
              "NOT_AVAILABLE",
              sent === undefined ? {} : { on_current_check: sent },
            ),
          }),
        ]),
        B,
      ).disposition;
    assert.equal(read(false)?.onCurrentCheck, false);
    for (const sent of [undefined, true, null, "false", 0]) {
      assert.equal(read(sent)?.onCurrentCheck, true, String(sent));
    }
    assert.equal(digestModel.fromEarlierCheck(read(false) ?? null), true);
    assert.equal(digestModel.fromEarlierCheck(read(undefined) ?? null), false);
    assert.equal(digestModel.fromEarlierCheck(null), false);
  });

  it("is said on the first screen's item for it, quietly", () => {
    assert.equal(
      digestModel.EARLIER_CHECK,
      "Recorded on an earlier check. Confirm it still holds.",
    );
    const quiet = digest([
      shown(A, "A"),
      gap(B, "B", {
        disposition: tickmark("NOT_AVAILABLE", { on_current_check: false }),
      }),
    ]).quiet;
    const item = quiet.find((each) => each.kind === "TICKMARK");
    assert.equal(item?.text, "B accepted without evidence");
    assert.equal(item?.note, digestModel.EARLIER_CHECK);
    assert.equal(quiet.find((each) => each.kind === "SHOWN")?.note, undefined);
    // An exception keeps its item under "Needs attention": said there.
    const [exception] = digest([
      shown(A, "A"),
      gap(B, "B", {
        disposition: tickmark("EXCEPTION", { on_current_check: false }),
      }),
    ]).attention;
    assert.equal(exception?.note, digestModel.EARLIER_CHECK);
    // Not of a tickmark on the current check.
    const current = digest([
      shown(A, "A"),
      gap(B, "B", { disposition: tickmark("NOT_AVAILABLE") }),
    ]);
    assert.equal(
      current.quiet.some((each) => each.note !== undefined),
      false,
    );
  });
});

describe("what holds the D&I sign-off (item 5, as the conclusion shows it)", () => {
  const SENTENCE =
    "An exception is recorded on attribute B. Log a design deficiency for it, or change the tickmark with your reason.";
  const parse = (over: Record<string, unknown> = {}) => {
    const parsed = conclusionModel.parseDesignConclusion({
      control_id: uuid(53),
      status: "TO_SIGN",
      proposed: "EFFECTIVE",
      workpaper: {
        id: uuid(60),
        status: "PREPARED",
        prepared_by: "Dana Lee",
        prepared_version: 2,
      },
      deficiencies: [],
      signed: null,
      out_of_date: [],
      blocking: [SENTENCE],
      viewer_is_reviewer: true,
      viewer_prepared: false,
      independence_required: true,
      can_sign: false,
      history: [],
      ...over,
    });
    assert.ok(parsed !== null);
    return parsed;
  };

  it("gives every sentence the server sends, whole, to every viewer", () => {
    assert.deepEqual(conclusionModel.signHolds(parse()), [SENTENCE]);
    // The person who must act on it is often not the reviewer.
    assert.deepEqual(
      conclusionModel.signHolds(parse({ viewer_is_reviewer: false })),
      [
        "A team member with the reviewer role signs off the D&I conclusion.",
        SENTENCE,
      ],
    );
    // A second sentence is never dropped behind the first.
    assert.deepEqual(
      conclusionModel.signHolds(
        parse({
          status: "NOT_READY",
          blocking: ["the design workpaper is not prepared", SENTENCE],
        }),
      ),
      ["The design workpaper is prepared first, in D&I Assessment.", SENTENCE],
    );
    const long =
      `${SENTENCE} ${"A further exception is recorded on another attribute. ".repeat(6)}`.trim();
    assert.deepEqual(conclusionModel.signHolds(parse({ blocking: [long] })), [
      long,
    ]);
  });

  it("says nothing where nothing holds it, or once it is signed off", () => {
    assert.deepEqual(
      conclusionModel.signHolds(parse({ blocking: [], can_sign: true })),
      [],
    );
    assert.deepEqual(
      conclusionModel.signHolds(
        parse({
          status: "SIGNED_OFF",
          blocking: ["the D&I conclusion is signed off"],
        }),
      ),
      [],
    );
  });

  it("keeps every out-of-date reason as the server sends it, whole", () => {
    assert.deepEqual(
      parse({
        status: "OUT_OF_DATE",
        out_of_date: ["a tickmark changed after the sign-off"],
      }).outOfDate,
      ["a tickmark changed after the sign-off"],
    );
    const reasons = [
      "a tickmark changed after the sign-off: Dana Lee recorded an exception on attribute B of “One access request traced from request to grant” on 15 November 2026",
      "an exception is recorded on an attribute and no design deficiency is logged for it",
    ];
    assert.deepEqual(
      parse({ status: "OUT_OF_DATE", out_of_date: reasons }).outOfDate,
      reasons,
    );
  });
});

describe("an exception that holds the sign-off, as the conclusion reads (independent review of 408f4ce, item 6)", () => {
  const SENTENCE =
    "An exception is recorded on attribute B. Log a design deficiency for it, or change the tickmark with your reason.";
  const OTHER_SENTENCE =
    "An exception is recorded on attribute D. Log a design deficiency for it, or change the tickmark with your reason.";
  const parse = (over: Record<string, unknown> = {}) => {
    const parsed = conclusionModel.parseDesignConclusion({
      control_id: uuid(53),
      status: "TO_SIGN",
      proposed: "EFFECTIVE",
      workpaper: {
        id: uuid(60),
        status: "PREPARED",
        prepared_by: "Dana Lee",
        prepared_version: 2,
      },
      deficiencies: [],
      signed: null,
      out_of_date: [],
      blocking: [SENTENCE],
      viewer_is_reviewer: true,
      viewer_prepared: false,
      independence_required: true,
      can_sign: false,
      history: [],
      ...over,
    });
    assert.ok(parsed !== null);
    return parsed;
  };
  const MISLEADING =
    /Awaiting reviewer sign-off|Once signed off|cleared to proceed|Effective/;

  it("reads 'Exception recorded: not ready to sign', with the server's sentence and what the preparer does next", () => {
    // Before: the card read "Effective", in the green of effective, "Awaiting reviewer
    // sign-off" and "Once signed off, OE evidence and testing are cleared to proceed",
    // while the server refused every sign-off.
    const head = conclusionModel.conclusionHead(parse());
    assert.deepEqual(head, {
      heading: "D&I conclusion",
      status: "Exception recorded: not ready to sign",
      statusTone: "excepted",
      tone: "excepted",
      word: "Exception to resolve",
      effect: "",
      reasons: [SENTENCE],
      next: "What the preparer does next: log a design deficiency for the attribute, or change its tickmark on the request in D&I Evidence, with a reason. Until then no verdict can be signed off, and OE evidence and testing wait.",
    });
    assert.equal(MISLEADING.test(JSON.stringify(head)), false);
    // Every sentence, whole, once.
    assert.deepEqual(
      conclusionModel.conclusionHead(
        parse({ blocking: [SENTENCE, OTHER_SENTENCE, SENTENCE] }),
      ).reasons,
      [SENTENCE, OTHER_SENTENCE],
    );
    // A sign-off that no longer holds, over an exception: the same, never "to sign".
    const outdated = conclusionModel.conclusionHead(
      parse({
        status: "OUT_OF_DATE",
        out_of_date: [
          "an exception is recorded on an attribute and no design deficiency is logged for it",
        ],
      }),
    );
    assert.equal(outdated.status, "Exception recorded: not ready to sign");
    assert.equal(MISLEADING.test(JSON.stringify(outdated)), false);
    // The card gives the sentences, so they are not said again under it; the viewer's
    // own reason still is.
    assert.deepEqual(conclusionModel.holdsBelow(parse()), []);
    assert.deepEqual(
      conclusionModel.holdsBelow(parse({ viewer_is_reviewer: false })),
      ["A team member with the reviewer role signs off the D&I conclusion."],
    );
    // Nothing of what holds the sign-off is lost between the two places.
    for (const viewer of [true, false]) {
      const read = parse({ viewer_is_reviewer: viewer });
      assert.deepEqual(
        [
          ...conclusionModel.holdsBelow(read),
          ...conclusionModel.conclusionHead(read).reasons,
        ].sort(),
        [...conclusionModel.signHolds(read)].sort(),
      );
    }
  });

  it("reads as before where no exception holds it", () => {
    const toSign = conclusionModel.conclusionHead(
      parse({ blocking: [], can_sign: true }),
    );
    assert.deepEqual(toSign, {
      heading: "Proposed D&I conclusion",
      status: "Awaiting reviewer sign-off",
      statusTone: "to_sign",
      tone: "effective",
      word: "Effective",
      effect:
        "Once signed off, OE evidence and testing are cleared to proceed.",
      reasons: [],
      next: "",
    });
    // With a design deficiency logged the server sends no exception sentence: the
    // records propose not effective, to sign off.
    const answered = conclusionModel.conclusionHead(
      parse({ proposed: "NOT_EFFECTIVE", blocking: [], can_sign: true }),
    );
    assert.equal(answered.status, "Awaiting reviewer sign-off");
    assert.equal(answered.word, "Not effective");
    assert.equal(answered.tone, "not_effective");
    // Signed off, and before the workpaper is prepared: the conclusion's own status.
    const signed = conclusionModel.conclusionHead(
      parse({
        status: "SIGNED_OFF",
        blocking: ["the D&I conclusion is signed off"],
        signed: {
          id: uuid(80),
          verdict: "EFFECTIVE",
          workpaper_version: 2,
          signed_by: "Ravi Shah",
          signed_at: "2026-11-15T10:00:00Z",
        },
      }),
    );
    assert.equal(signed.status, "Signed off");
    assert.equal(
      signed.effect,
      "OE evidence and testing are cleared to proceed.",
    );
    const notReady = parse({
      status: "NOT_READY",
      proposed: null,
      blocking: ["the design workpaper is not prepared", SENTENCE],
    });
    assert.equal(conclusionModel.conclusionHead(notReady).status, "Not ready");
    assert.deepEqual(conclusionModel.exceptionHolds(notReady), []);
    assert.deepEqual(conclusionModel.holdsBelow(notReady), [
      "The design workpaper is prepared first, in D&I Assessment.",
      SENTENCE,
    ]);
    // A sentence that is not the exception's is never taken for one.
    assert.deepEqual(
      conclusionModel.exceptionHolds(
        parse({ blocking: ["A deficiency is being logged."] }),
      ),
      [],
    );
  });

  it("lists the exceptions the server sends, and tolerates their absence", () => {
    assert.deepEqual(parse().exceptions, []);
    for (const sent of [null, "none", {}, 3]) {
      assert.deepEqual(parse({ exceptions: sent }).exceptions, []);
    }
    const read = parse({
      exceptions: [
        {
          attribute_id: B,
          code: "B",
          requirement_id: REQUEST,
          recorded_by_name: "Dana Lee",
          recorded_at: "2026-11-15T09:30:00Z",
          reason: "The second account stayed active after the termination.",
          check_current: true,
        },
        {
          attribute_id: C,
          code: "C",
          requirement_id: OTHER,
          recorded_by_name: "Dana Lee",
          recorded_at: "",
          reason: "",
          check_current: false,
        },
        // Without `check_current`: read as current, as the list was before it.
        { attribute_id: A, code: "A", requirement_id: REQUEST },
        "not one",
      ],
    }).exceptions;
    assert.deepEqual(
      read.map((item) => [item.code, item.checkCurrent]),
      [
        ["B", true],
        ["C", false],
        ["A", true],
      ],
    );
    const date = (at: string) => `on:${at.slice(0, 10)}`;
    assert.deepEqual(
      read.map((item) => conclusionModel.exceptionLine(item, date)),
      [
        "Attribute B · Dana Lee on on:2026-11-15",
        "Attribute C · Dana Lee · its request is to be checked again",
        "Attribute A",
      ],
    );
    // The list decides nothing: without a sentence in `blocking`, nothing holds.
    assert.deepEqual(
      conclusionModel.exceptionHolds(
        parse({ blocking: [], exceptions: [{ attribute_id: B, code: "B" }] }),
      ),
      [],
    );
  });

  it("says 'Exception to resolve' on the workflow's D&I Assessment and D&I Conclusion, never 'Effective · to sign off'", () => {
    const base: workflowModel.WorkflowInput = {
      details: [{ label: "Description", filled: true }],
      setup: [],
      attributes: { approved: 2, proposed: 0 },
      plan: { exists: true, approved: true, pendingReview: false },
      requirements: [{ phase: "DESIGN", state: "ACCEPTED" }],
      designRelease: { step: "RELEASED" },
      sheet: null,
      rounds: [],
      findings: [],
      reviewStatus: "",
      conclusion: "NOT_CONCLUDED",
      proposedConclusion: null,
      designPaper: { status: "PREPARED", drafting: false },
      designConclusion: null,
      effectivenessPaper: null,
      busy: new Set(),
    };
    const steps = (
      conclusion: NonNullable<workflowModel.WorkflowInput["designConclusion"]>,
    ) => workflowModel.workflowOf({ ...base, designConclusion: conclusion });
    const said = (
      conclusion: NonNullable<workflowModel.WorkflowInput["designConclusion"]>,
    ) =>
      Object.fromEntries(
        steps(conclusion)
          .filter((step) =>
            ["designassessment", "designconclusion"].includes(step.key),
          )
          .map((step) => [step.key, `${step.tone}|${step.status}`]),
      );
    const held = {
      status: "TO_SIGN",
      proposed: "EFFECTIVE",
      signed: null,
      blocking: [SENTENCE],
    } as const;
    // Before: "attention|Effective · to sign off" and "done|Assessed", with the server
    // refusing every sign-off (the model never read `blocking`).
    assert.deepEqual(said(held), {
      designassessment: "attention|Exception to resolve",
      designconclusion: "blocked|Exception to resolve",
    });
    // Out of date over an exception: never "to sign again".
    assert.deepEqual(
      said({ ...held, status: "OUT_OF_DATE", signed: "EFFECTIVE" }),
      {
        designassessment: "attention|Exception to resolve",
        designconclusion: "blocked|Exception to resolve",
      },
    );
    for (const status of Object.values(
      said({ ...held, status: "OUT_OF_DATE", signed: "EFFECTIVE" }),
    )) {
      assert.equal(/to sign|Effective/.test(status), false);
    }
    // No exception sentence, or `blocking` not read: as before.
    for (const blocking of [[], undefined]) {
      assert.deepEqual(
        said({
          status: "TO_SIGN",
          proposed: "EFFECTIVE",
          signed: null,
          ...(blocking === undefined ? {} : { blocking }),
        }),
        {
          designassessment: "done|Assessed",
          designconclusion: "attention|Effective · to sign off",
        },
      );
    }
    // Signed off: the sign-off's own words.
    assert.deepEqual(
      said({
        status: "SIGNED_OFF",
        proposed: "EFFECTIVE",
        signed: "EFFECTIVE",
        blocking: ["the D&I conclusion is signed off"],
      }),
      {
        designassessment: "done|Assessed",
        designconclusion: "done|Effective · signed off",
      },
    );
    // The panels' decision lines agree: the conclusion waits on the exception and never
    // calls for a sign-off; the assessment says what resolves it.
    const workflow = steps(held);
    const conclusion = panelModel.panelFrame(
      "designconclusion",
      workflow,
      null,
    ).need;
    assert.equal(conclusion.kind, "wait");
    assert.equal(conclusion.title, "Exception to resolve");
    assert.equal(/Sign off the D&I conclusion/.test(conclusion.title), false);
    assert.deepEqual(conclusion.action, {
      label: "Open D&I Assessment",
      step: "designassessment",
    });
    const assessment = panelModel.panelFrame(
      "designassessment",
      workflow,
      null,
    ).need;
    assert.equal(assessment.kind, "act");
    assert.equal(assessment.title, "Resolve the recorded exception");
    assert.match(assessment.detail, /Log a design deficiency/);
    // The agent's line does not say a verdict is proposed for signing.
    const note = panelModel.agentNote(
      workflow.find((step) => step.key === "designconclusion") as never,
      { ...base, designConclusion: held },
    );
    assert.equal(
      note.found.some((line) => /^Proposed: effective/.test(line)),
      false,
    );
    assert.match(note.found[0] ?? "", /^Not ready to sign: an exception is/);
  });
});
