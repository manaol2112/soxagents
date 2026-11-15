import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as digestModel from "../apps/web/src/check-digest-model.ts";
import * as workflowModel from "../apps/web/src/control-workflow-model.ts";
import * as conclusionModel from "../apps/web/src/design-conclusion-model.ts";
import * as listModel from "../apps/web/src/design-evidence-model.ts";
import * as assuranceModel from "../apps/web/src/evidence-assurance-model.ts";

// Closing a request with tickmarks; exceptions carried to the workpaper
// (docs/evidence-assurance.md, section 10.15), on the web. The product owner: "if I add
// tickmark to these attributes that were not addressed by any evidence it will close the
// evidence request. Any issue will be dealt with as exception in the workpaper analysis
// ... Otherwise, it will never move to the next phase."
//
// What must hold: a request's attributes are settled only where each one it asks for is
// evidenced by the check or carries a standing tickmark (an exception included); the
// offer to accept is made only where recording a tickmark settles the last one on a
// request that can be accepted and is not; the finding's dismissal is offered for a
// closing kind on a proposed finding only; the first line says a settled request is to
// accept, and never says more than the records do; the coverage, the row's chips and the
// step's counts read tickmarks in their own words, never as evidenced; the step is not
// done while an accepted request has an attribute that waits again; and the kept and
// earlier-check lines are said. Every input goes through the real parser, as the
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
  it("settles an attribute only by the check's own evidence or a standing tickmark of any kind", () => {
    const made = check([
      shown(A, "A"),
      gap(B, "B", { disposition: tickmark("EXCEPTION") }),
      gap(C, "C"),
    ]);
    assert.equal(
      assuranceModel.attributeSettled(lineOf(made, A)),
      true,
      "evidenced by the check",
    );
    assert.equal(
      assuranceModel.attributeSettled(lineOf(made, B)),
      true,
      "an exception settles it here: it is carried to the workpaper",
    );
    assert.equal(assuranceModel.attributeSettled(lineOf(made, C)), false);
    // Support by the documented design alone is not the check's evidence.
    const design = check([shown(A, "A", { shows: "DESIGN" })]);
    assert.equal(
      assuranceModel.attributeSettled(lineOf(design, A)),
      false,
      "design only",
    );
    // A tickmark that ended settles nothing.
    const reopened = check([
      gap(A, "A", { disposition_history: [ended("REOPENED")] }),
    ]);
    assert.equal(assuranceModel.attributeSettled(lineOf(reopened, A)), false);
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
    const b = lineOf(made, B);
    assert.deepEqual(
      digestModel.tickmarkAfter(made, b, {
        canAccept: true,
        findingStatus: "PROPOSED",
      }),
      { accept: true, dismiss: true },
    );
    // Accepted already, or not this person's to accept: `canAccept` is false.
    assert.equal(
      digestModel.tickmarkAfter(made, b, {
        canAccept: false,
        findingStatus: "PROPOSED",
      }).accept,
      false,
    );
    // Not the last one.
    const two = check([shown(A, "A"), gap(B, "B"), gap(C, "C")]);
    assert.equal(
      digestModel.tickmarkAfter(two, lineOf(two, B), {
        canAccept: true,
        findingStatus: null,
      }).accept,
      false,
    );
    // Already settled: Accept is the first screen's, not the form's.
    const settled = check([
      shown(A, "A"),
      gap(B, "B", { disposition: tickmark("NOT_AVAILABLE") }),
    ]);
    assert.equal(
      digestModel.tickmarkAfter(settled, lineOf(settled, B), {
        canAccept: true,
        findingStatus: null,
      }).accept,
      false,
    );
  });

  it("offers the dismissal only for a proposed finding, and only with a closing kind", () => {
    const made = last();
    const b = lineOf(made, B);
    for (const status of ["ACCEPTED", "SENT", "ANSWERED", "DISMISSED", null]) {
      assert.equal(
        digestModel.tickmarkAfter(made, b, {
          canAccept: true,
          findingStatus: status,
        }).dismiss,
        false,
        String(status),
      );
    }
    // No finding on the attribute: nothing to dismiss, whatever status is said.
    const none = check([shown(A, "A"), gap(B, "B")]);
    assert.equal(
      digestModel.tickmarkAfter(none, lineOf(none, B), {
        canAccept: true,
        findingStatus: "PROPOSED",
      }).dismiss,
      false,
    );
    const after = { accept: true, dismiss: true };
    assert.equal(digestModel.dismissOffered(after, "NOT_APPLICABLE"), true);
    assert.equal(digestModel.dismissOffered(after, "NOT_AVAILABLE"), true);
    assert.equal(digestModel.dismissOffered(after, "SHOWN_ON_REVIEW"), true);
    // An exception leaves the finding to the person; so does no kind chosen yet.
    assert.equal(digestModel.dismissOffered(after, "EXCEPTION"), false);
    assert.equal(digestModel.dismissOffered(after, null), false);
    assert.equal(
      digestModel.dismissOffered(
        { accept: true, dismiss: false },
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
      "One access request traced from request to grant: attribute B waits on you again. A tickmark on it no longer stands, or a later check does not show it. Open the request to record a tickmark or add evidence.",
    );
    assert.deepEqual(view.rows[0]?.again, ["B"]);
    assert.match(view.rows[0]?.sub ?? "", / · B to look at again$/);
    // It points at the row: the one that opens.
    assert.equal(view.open, REQUEST);
  });

  it("is not done once a later check ended a tickmark, or no longer evidences an attribute", () => {
    for (const as of ["OVERTAKEN_BY_CHECK", "ANNOTATION_GONE"]) {
      const view = again([
        shown(A, "A"),
        gap(B, "B", { disposition_history: [ended(as)] }),
      ]);
      assert.equal(view.header.standing, "AGAIN", as);
    }
    // A check ran since the tickmarks were recorded (B's stands from an earlier check),
    // and it no longer evidences A, which carries no tickmark.
    const later = again([
      gap(A, "A"),
      gap(B, "B", {
        disposition: tickmark("NOT_AVAILABLE", { on_current_check: false }),
      }),
    ]);
    assert.equal(later.header.standing, "AGAIN");
    assert.deepEqual(later.rows[0]?.again, ["A"]);
    // A check ended a tickmark on B by finding it supported, and A is not evidenced.
    const superseded = again([
      gap(A, "A"),
      shown(B, "B", { disposition_history: [ended("SUPERSEDED_BY_CHECK")] }),
    ]);
    assert.deepEqual(superseded.rows[0]?.again, ["A"]);
    // Recorded again, it no longer waits.
    const recorded = again([
      shown(A, "A"),
      gap(B, "B", {
        disposition: tickmark("NOT_APPLICABLE"),
        disposition_history: [ended("REOPENED")],
      }),
    ]);
    assert.equal(recorded.header.standing, "DONE");
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

  it("is never done from '1 accepted, 1 later' while the later one has a file to accept", () => {
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
    const step = (
      requirements: workflowModel.WorkflowInput["requirements"],
    ) => {
      const found = workflowModel
        .workflowOf({ ...base, requirements })
        .find((each) => each.key === "designevidence");
      return [found?.tone, found?.status];
    };
    assert.deepEqual(
      step([
        { phase: "DESIGN", state: "ACCEPTED", files: 2 },
        { phase: "DESIGN", state: "AWAITING_DEPENDENCY", files: 1 },
      ]),
      ["attention", "1 item to review"],
    );
    // With no file of its own it is later, as before; and as before where the files
    // were not read.
    assert.deepEqual(
      step([
        { phase: "DESIGN", state: "ACCEPTED", files: 2 },
        { phase: "DESIGN", state: "AWAITING_DEPENDENCY", files: 0 },
      ]),
      ["done", "1 accepted · 1 later"],
    );
    assert.deepEqual(
      step([
        { phase: "DESIGN", state: "ACCEPTED" },
        { phase: "DESIGN", state: "AWAITING_DEPENDENCY" },
      ]),
      ["done", "1 accepted · 1 later"],
    );
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

  it("keeps the out-of-date reason as the server sends it", () => {
    assert.deepEqual(
      parse({
        status: "OUT_OF_DATE",
        out_of_date: ["a tickmark changed after the sign-off"],
      }).outOfDate,
      ["a tickmark changed after the sign-off"],
    );
  });
});
