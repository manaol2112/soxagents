import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  annotationChoices,
  annotationOf,
  type CheckDigest,
  checkDigest,
  DECIDE,
  DIGEST_NOTHING,
  DIGEST_TICKMARKED,
  draftFrom,
  ENDING_WORDS,
  EXCEPTION_RECORDED,
  endingLine,
  FINDING_TO_DECIDE,
  ONLY_EXCEPTION,
  TICKMARK_WORDS,
  tickedToStart,
  tickmarkFields,
  tickmarkOffer,
  tickmarkProblems,
  verdictAccepted,
  verdictExceptions,
  verdictNotApplicable,
  verdictOnReview,
} from "../apps/web/src/check-digest-model.ts";
import { lettersSpan } from "../apps/web/src/design-evidence-model.ts";
import {
  matrixOf,
  matterWords,
  parseDesignWorkpaper,
  stateOf,
  tickmarkLegend,
  tickmarkOf,
  tilesOf,
} from "../apps/web/src/design-workpaper-model.ts";
import { parseAnnotations } from "../apps/web/src/evidence-annotations-model.ts";
import {
  ASSURANCE_INTENTS,
  acceptNote,
  assuranceRow,
  assuranceWrite,
  DISPOSITION_KINDS,
  dispositionProblem,
  type Lettered,
  parseAssurance,
  type RequestCheck,
  type RowFile,
  requestCheck,
} from "../apps/web/src/evidence-assurance-model.ts";

// Tickmarks: a person's disposition of an attribute (docs/evidence-assurance.md, section
// 10.13), on the web. What must hold: what the server sends is read strictly (a kind this
// page does not know never closes anything); an attribute a person closed leaves "Needs
// attention" and is said on the quiet line in its own words, never as "shown" and never
// green; a person's exception keeps its item and says so; the verdict says each count
// apart; "Nothing needs your attention." is never said while an exception stands or
// while a tickmark stands in for evidence; only what the server takes is offered; and
// the workpaper words the new states, its tickmark and its matters. Every input goes
// through the real parser and requestCheck, as the screen's does. Synthetic data only.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D] = [uuid(1), uuid(2), uuid(3), uuid(4)] as const;
const REQUEST = uuid(11);
const [FILE, SECOND] = [uuid(31), uuid(32)] as const;
const [ORG, PROJECT, CONTROL] = [uuid(51), uuid(52), uuid(53)] as const;
const TICKET: RowFile = { id: FILE, name: "Ticket_4711.pdf" };
const SHEET: RowFile = { id: SECOND, name: "Account_list.xlsx" };

const lettered: Lettered[] = [A, B, C, D].map((id, at) => ({
  id,
  letter: "ABCD".charAt(at),
  text: `Attribute ${"ABCD".charAt(at)} wording.`,
}));

const passage = () => ({
  quote: "approved by the line manager",
  file_id: FILE,
  location: { label: "Page 3", page: 3 },
});

function attribute(over: Record<string, unknown> = {}) {
  return {
    attribute_id: A,
    code: "A",
    expected: true,
    verdict: "SUPPORTED",
    result: "MET",
    shows: "IMPLEMENTATION",
    summary: "The ticket shows line-manager approval before access.",
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
  attribute({
    attribute_id: id,
    code,
    verdict: "ISSUE",
    result: "NOT_MET",
    shows: null,
    summary: `Nothing shows attribute ${code}.`,
    passages: [],
    absent: [`The record that shows ${code}.`],
    assessment: "NOT_DEMONSTRATED",
    ...over,
  });

/** The records contradict it: an exception a record shows, as the server sends it
 * (2b3887f): `contradicted` on the attribute. Changed 14 November 2026 (review fix 2).
 * Old: the fixture fed an element `deviation: true`, from which the page worked the
 * contradiction out itself; the server never sends an element's deviation (ElementBody
 * has none), so the page could not tell a first-engine contradiction. New: the server's
 * own `contradicted`, and no element deviation. */
const contradicted = (over: Record<string, unknown> = {}) =>
  gap(B, "B", {
    result: "NOT_MET",
    assessment: "CONTRADICTED",
    absent: [],
    summary: "A second account of the leaver signed in after the termination.",
    elements: [
      {
        key: "b1",
        text: "Every account shows disabled.",
        result: "NOT_MET",
        absent: [],
        passages: [passage()],
      },
    ],
    contradicted: true,
    ...over,
  });

const disposition = (over: Record<string, unknown> = {}) => ({
  id: uuid(900),
  kind: "NOT_AVAILABLE",
  reason: "The ticket system was retired in 2026.",
  relied_on: "The HR leaver report.",
  annotation_id: null,
  recorded_by_name: "Dana Lee",
  recorded_at: "2026-11-14T09:30:00Z",
  version: 1,
  ...over,
});

const ended = (over: Record<string, unknown> = {}) => ({
  ...disposition({ id: uuid(901), version: 2 }),
  ended_at: "2026-11-14T10:00:00Z",
  ended_by_name: "Dana Lee",
  ended_as: "REOPENED",
  ended_reason: "Recorded on the wrong attribute.",
  ...over,
});

const followUp = (key: string, codes: string[], ids: string[]) => ({
  key,
  attribute_ids: ids,
  codes,
  elements: [],
  missing: "The record.",
  why: "It is needed.",
  request: `Provide the record that shows ${codes.join(" and ")}.`,
  alternatives: "",
  kind: "EVIDENCE",
  priority: "HIGH",
  raised_by: ["ASSESSOR", "REVIEWER"],
  status: "OPEN",
});

function review(over: Record<string, unknown> = {}) {
  return {
    overall: "ADDITIONAL_EVIDENCE",
    explanation: "1 of 4 requested attributes is supported.",
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
    ...over,
  };
}

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
    attributes: [attribute()],
    out_of_date: [],
    finished_at: "2026-11-14T10:00:00Z",
    note: "",
    engine_version: 2,
    review: review(),
    ...over,
  };
}

function check(over: Record<string, unknown> = {}): RequestCheck {
  const [request] = parseAssurance({ requests: [entry(over)] })?.requests ?? [];
  assert.ok(request !== undefined);
  return requestCheck(request, lettered, [TICKET], (letters) =>
    lettersSpan(
      letters,
      lettered.map((item) => item.letter),
    ),
  );
}

function digest(over: Record<string, unknown> = {}): CheckDigest {
  const made = checkDigest(check(over), [], [TICKET]);
  assert.ok(made !== null);
  return made;
}

const attributesOf = (over: Record<string, unknown>) =>
  parseAssurance({ requests: [entry(over)] })?.requests[0]?.attributes ?? [];

/** The four attributes of the owner's case: A shown; B, C, D not shown. */
const FOUR = (b: unknown = null, c: unknown = null, d: unknown = null) => [
  attribute(),
  gap(B, "B", b === null ? {} : { disposition: b }),
  gap(C, "C", c === null ? {} : { disposition: c }),
  gap(D, "D", d === null ? {} : { disposition: d }),
];

describe("reading a person's disposition (section 10.13)", () => {
  it("reads what stands and what ended as the contract shapes them", () => {
    const [read] = attributesOf({
      attributes: [
        gap(A, "A", {
          disposition: disposition(),
          disposition_history: [
            ended(),
            ended({
              id: uuid(902),
              ended_as: "SUPERSEDED_BY_CHECK",
              ended_by_name: null,
            }),
          ],
        }),
      ],
    });
    // Changed 15 November 2026 (section 10.15, item 9). Old: a disposition read as
    // `{id, kind, reason, reliedOn, annotationId, recordedBy, recordedAt, version}`.
    // New: it also carries `onCurrentCheck`, true unless the server says it was recorded
    // on an earlier check (`on_current_check: false`); the shape grew, and the
    // assertion is otherwise unchanged.
    assert.deepEqual(read?.disposition, {
      id: uuid(900),
      kind: "NOT_AVAILABLE",
      reason: "The ticket system was retired in 2026.",
      reliedOn: "The HR leaver report.",
      annotationId: null,
      recordedBy: "Dana Lee",
      recordedAt: "2026-11-14T09:30:00Z",
      version: 1,
      onCurrentCheck: true,
    });
    assert.deepEqual(
      read?.history.map((item) => [item.id, item.endedAs, item.endedBy]),
      [
        [uuid(901), "REOPENED", "Dana Lee"],
        [uuid(902), "SUPERSEDED_BY_CHECK", null],
      ],
    );
    assert.equal(
      read?.history[0]?.endedReason,
      "Recorded on the wrong attribute.",
    );
  });

  it("takes nothing it cannot read as it stands: an unknown kind never closes an attribute", () => {
    for (const bad of [
      disposition({ kind: "ACCEPTED" }),
      disposition({ kind: "not_available" }),
      disposition({ id: "not-an-id" }),
      disposition({ version: 0 }),
      disposition({ version: 1.5 }),
      disposition({ version: "1" }),
      // "Shown, on my review" rests on an annotation, or it is not one.
      disposition({ kind: "SHOWN_ON_REVIEW", annotation_id: null }),
      "NOT_AVAILABLE",
      [disposition()],
    ]) {
      const [read] = attributesOf({
        attributes: [gap(A, "A", { disposition: bad })],
      });
      assert.equal(read?.disposition, null, JSON.stringify(bad));
      // It waits on the person as the check left it.
      const made = digest({ attributes: [gap(A, "A", { disposition: bad })] });
      assert.equal(made.attention[0]?.mark, "A", JSON.stringify(bad));
      assert.equal(
        made.quiet.some((item) => item.kind === "TICKMARK"),
        false,
      );
    }
  });

  it("keeps only what each kind takes", () => {
    const [read] = attributesOf({
      attributes: [
        gap(A, "A", {
          disposition: disposition({
            kind: "NOT_APPLICABLE",
            relied_on: "Should not be kept.",
            annotation_id: uuid(203),
          }),
        }),
      ],
    });
    assert.equal(read?.disposition?.reliedOn, "");
    assert.equal(read?.disposition?.annotationId, null);
    const [shown] = attributesOf({
      attributes: [
        gap(A, "A", {
          disposition: disposition({
            kind: "SHOWN_ON_REVIEW",
            annotation_id: uuid(203),
          }),
        }),
      ],
    });
    assert.equal(shown?.disposition?.annotationId, uuid(203));
    assert.equal(shown?.disposition?.reliedOn, "");
  });

  it("drops an ended one it cannot read, keeps an unknown ending as no longer standing, and bounds the history", () => {
    const [read] = attributesOf({
      attributes: [
        gap(A, "A", {
          disposition_history: [
            ended({ kind: "WHATEVER" }),
            ended({ id: uuid(903), ended_as: "SOMETHING_NEW" }),
            ...Array.from({ length: 14 }, (_, at) =>
              ended({ id: uuid(910 + at) }),
            ),
          ],
        }),
      ],
    });
    assert.equal(read?.history.length, 10);
    assert.equal(read?.history[0]?.endedAs, "OTHER");
    assert.equal(ENDING_WORDS.OTHER, "No longer stands");
  });

  // Changed 14 November 2026 (review fix 2). Old: "reads a contradiction as the server
  // does: its assessment, or for the first engine the same table", worked out on the
  // page from the run's assessment and from an element's `deviation`, which the server
  // never sends, so a first-engine contradiction was offered the kinds the server
  // refuses. New: only the server's own `contradicted` (attribute_dispositions
  // .contradicted, for a run of either engine) decides; nothing is worked out here.
  it("reads a contradiction only from the server's own contradicted, for either engine", () => {
    const [two] = attributesOf({ attributes: [contradicted()] });
    assert.equal(two?.contradicted, true);
    const [plain] = attributesOf({ attributes: [gap(A, "A")] });
    assert.equal(plain?.contradicted, false);
    // A first-engine run with no assessment and no element deviation: the server's
    // answer stands.
    const first = (over: Record<string, unknown>) =>
      attributesOf({
        engine_version: 1,
        attributes: [contradicted({ assessment: undefined, ...over })],
      })[0]?.contradicted;
    assert.equal(first({}), true);
    assert.equal(first({ verdict: "UNSETTLED", result: null }), true);
    // Whatever the page might read into the rest, without the server's true it is not
    // a contradiction: never derived from an assessment or an element.
    for (const over of [
      { contradicted: false },
      { contradicted: undefined },
      { contradicted: "true" },
      {
        contradicted: undefined,
        elements: [
          {
            key: "b1",
            text: "Every account shows disabled.",
            result: "NOT_MET",
            deviation: true,
            absent: [],
            passages: [passage()],
          },
        ],
      },
    ]) {
      assert.equal(
        attributesOf({ attributes: [contradicted(over)] })[0]?.contradicted,
        false,
        JSON.stringify(over),
      );
      assert.equal(first(over), false, JSON.stringify(over));
    }
    // And what is offered follows it alone.
    const offered = (over: Record<string, unknown>) => {
      const made = check({ attributes: [contradicted(over)] });
      const found = [...made.attributes, ...made.notAddressed][0];
      assert.ok(found !== undefined);
      return tickmarkOffer(made, found, true)?.kinds;
    };
    assert.deepEqual(offered({}), ["EXCEPTION"]);
    assert.deepEqual(offered({ contradicted: false }), [...DISPOSITION_KINDS]);
  });
});

describe("the first screen with tickmarks", () => {
  it("takes a closed attribute off Needs attention and says it on the quiet line in its own words, never green", () => {
    const made = digest({
      attributes: FOUR(
        disposition(),
        null,
        disposition({ kind: "NOT_APPLICABLE", relied_on: "" }),
      ),
    });
    assert.deepEqual(
      made.attention.map((item) => item.mark),
      ["C"],
    );
    const quiet = made.quiet.filter((item) => item.attributeKey !== null);
    assert.deepEqual(
      quiet.map((item) => [item.text, item.kind, item.tone]),
      [
        ["A shown", "SHOWN", "success"],
        ["B accepted without evidence", "TICKMARK", "neutral"],
        ["D not applicable", "TICKMARK", "neutral"],
      ],
    );
    // Each opens its attribute, and the steps still reach every one.
    assert.deepEqual([...made.steps].sort(), [A, B, C, D].sort());
  });

  it("says a shown-on-review in its own words, never the plain 'Shown'", () => {
    const made = digest({
      attributes: FOUR(
        disposition({ kind: "SHOWN_ON_REVIEW", annotation_id: uuid(203) }),
      ),
    });
    const b = made.quiet.find((item) => item.attributeKey === B);
    assert.equal(b?.text, "B shown, your judgment");
    assert.equal(b?.tone, "neutral");
    assert.equal(b?.kind, "TICKMARK");
    for (const kind of DISPOSITION_KINDS) {
      assert.notEqual(TICKMARK_WORDS[kind].tone, "success", kind);
      assert.notEqual(TICKMARK_WORDS[kind].shown, "Shown", kind);
      assert.notEqual(TICKMARK_WORDS[kind].label, "Shown", kind);
    }
  });

  it("says each count apart in the verdict, never inside 'shown', and the counts equal the lists", () => {
    const made = digest({
      attributes: FOUR(
        disposition({ kind: "SHOWN_ON_REVIEW", annotation_id: uuid(203) }),
        disposition(),
        disposition({ kind: "NOT_APPLICABLE", relied_on: "" }),
      ),
    });
    assert.equal(
      made.verdict,
      "1 of 4 attributes is shown. 1 shown on your review. 1 accepted without evidence. 1 not applicable.",
    );
    assert.equal(made.attention.length, 0);
    assert.equal(
      made.quiet.filter((item) => item.kind === "TICKMARK").length,
      3,
    );
    assert.equal(made.quiet.filter((item) => item.kind === "SHOWN").length, 1);
    assert.equal(verdictOnReview(2), "2 shown on your review.");
    assert.equal(verdictAccepted(1), "1 accepted without evidence.");
    assert.equal(verdictNotApplicable(3), "3 not applicable.");
    assert.equal(verdictExceptions(2), "2 exceptions recorded.");
  });

  it("never says 'Nothing needs your attention.' where a tickmark stands in for the evidence", () => {
    const made = digest({
      review: review({ overall: "SUFFICIENT" }),
      attributes: [attribute(), gap(B, "B", { disposition: disposition() })],
    });
    assert.equal(made.attention.length, 0);
    assert.notEqual(made.calm, DIGEST_NOTHING);
    assert.equal(made.calm, DIGEST_TICKMARKED);
    // With a caveat, the caveat is said after it.
    const caveat = digest({
      review: review({
        completeness: {
          state: "RELIABILITY_UNRESOLVED",
          reasons: ["A report."],
        },
      }),
      attributes: [attribute(), gap(B, "B", { disposition: disposition() })],
    });
    assert.ok(caveat.calm.startsWith(DIGEST_TICKMARKED));
    assert.ok(caveat.calm.length > DIGEST_TICKMARKED.length);
    // Every attribute shown by the check itself: as before.
    const shown = digest({ review: review({ overall: "SUFFICIENT" }) });
    assert.equal(shown.calm, DIGEST_NOTHING);
  });

  it("keeps a person's exception under Needs attention, marked, whatever the check found", () => {
    for (const attributes of [
      // On an attribute not shown,
      [
        attribute(),
        gap(B, "B", {
          disposition: disposition({ kind: "EXCEPTION", relied_on: "" }),
        }),
      ],
      // and on one the check shows.
      [
        attribute({
          disposition: disposition({ kind: "EXCEPTION", relied_on: "" }),
        }),
      ],
    ]) {
      const made = digest({
        review: review({ overall: "SUFFICIENT" }),
        attributes,
      });
      const item = made.attention.find(
        (each) => each.tickmark?.label === EXCEPTION_RECORDED,
      );
      assert.ok(item !== undefined);
      assert.equal(item.tickmark?.tone, "danger");
      assert.equal(made.calm, "");
      assert.notEqual(made.calm, DIGEST_NOTHING);
      assert.ok(made.verdict.includes("1 exception recorded."), made.verdict);
      // Never counted as shown.
      assert.ok(
        made.verdict.startsWith(
          `${attributes.length - 1} of ${attributes.length}`,
        ),
        made.verdict,
      );
    }
  });

  it("lets the check's own shown stand before a closing tickmark", () => {
    const made = digest({
      attributes: [
        attribute({
          disposition: disposition({ kind: "NOT_APPLICABLE", relied_on: "" }),
        }),
      ],
    });
    assert.equal(made.verdict, "1 of 1 attribute is shown.");
    assert.equal(made.quiet[0]?.text, "A shown");
  });

  // Changed 14 November 2026 (review fix 3). Old: the closing tickmark took B off
  // "Needs attention" and the waiting finding was only a suffix on the quiet line ("B
  // accepted without evidence, finding to decide"), while the calm line could say
  // "Nothing else waits on you here". New: a finding that waits keeps the attribute's
  // item, said as "Finding to decide", whatever the tickmark.
  it("keeps a finding that waits on the person under Needs attention, whatever the tickmark", () => {
    for (const kind of ["NOT_AVAILABLE", "NOT_APPLICABLE", "SHOWN_ON_REVIEW"]) {
      const made = checkDigest(
        check({
          review: review({ overall: "SUFFICIENT" }),
          attributes: [
            attribute(),
            gap(B, "B", {
              finding_id: uuid(41),
              finding_status: "PROPOSED",
              disposition: disposition({
                kind,
                relied_on: kind === "NOT_AVAILABLE" ? "The HR report." : "",
                annotation_id: kind === "SHOWN_ON_REVIEW" ? uuid(203) : null,
              }),
            }),
          ],
        }),
        [{ id: uuid(41), status: "PROPOSED" }],
        [TICKET],
      );
      assert.ok(made !== null);
      const item = made.attention.find((each) => each.attributeKey === B);
      assert.ok(item !== undefined, kind);
      assert.equal(item.headline, FINDING_TO_DECIDE, kind);
      assert.deepEqual(item.control, { type: "OPEN", label: DECIDE }, kind);
      assert.equal(
        item.tickmark?.label,
        TICKMARK_WORDS[kind as keyof typeof TICKMARK_WORDS].shown,
        kind,
      );
      assert.notEqual(item.tickmark?.tone, "success", kind);
      // Not on the quiet line, and nothing calm while it waits.
      assert.equal(
        made.quiet.some((each) => each.attributeKey === B),
        false,
        kind,
      );
      assert.equal(made.calm, "", kind);
      assert.notEqual(made.calm, DIGEST_TICKMARKED, kind);
      assert.ok(made.verdict.endsWith("1 needs your attention."), made.verdict);
    }
    // Decided, it no longer waits: the tickmark closes the attribute as before.
    const decided = checkDigest(
      check({
        review: review({ overall: "SUFFICIENT" }),
        attributes: [
          attribute(),
          gap(B, "B", {
            finding_id: uuid(41),
            finding_status: "DISMISSED",
            disposition: disposition(),
          }),
        ],
      }),
      [{ id: uuid(41), status: "DISMISSED" }],
      [TICKET],
    );
    assert.equal(decided?.attention.length, 0);
    assert.equal(decided?.calm, DIGEST_TICKMARKED);
  });

  it("asks nothing for an attribute a person closed: its follow-ups stay in its view, unticked, not on the first screen", () => {
    const made = digest({
      attributes: FOUR(disposition()),
      review: review({
        follow_ups: [
          followUp("only-b", ["B"], [B]),
          followUp("b-and-c", ["B", "C"], [B, C]),
          followUp("general", [], []),
        ],
      }),
    });
    const general = made.attention
      .filter((item) => item.kind === "GENERAL")
      .map((item) => item.key);
    assert.deepEqual(general, ["GENERAL:general"]);
    const ticked = tickedToStart(made);
    assert.equal(ticked.has("only-b"), false);
    assert.equal(ticked.has("b-and-c"), true);
    assert.equal(ticked.has("general"), true);
    // Still listed under B in its own view.
    assert.deepEqual(
      made.attributes.find((row) => row.key === B)?.asks.map((ask) => ask.key),
      ["only-b", "b-and-c"],
    );
  });
});

describe("what is offered", () => {
  const line = (over: Record<string, unknown>) => {
    const made = check({ attributes: [over] });
    const found = [...made.attributes, ...made.notAddressed][0];
    assert.ok(found !== undefined);
    return { made, found };
  };

  it("offers the four kinds on a finished, current check to a person who may act", () => {
    const { made, found } = line(gap(A, "A"));
    assert.deepEqual(tickmarkOffer(made, found, true), {
      kinds: [
        "SHOWN_ON_REVIEW",
        "NOT_APPLICABLE",
        "NOT_AVAILABLE",
        "EXCEPTION",
      ],
      note: "",
    });
  });

  it("offers only the exception where the records contradict the attribute, and says why", () => {
    const { made, found } = line(contradicted());
    assert.deepEqual(tickmarkOffer(made, found, true), {
      kinds: ["EXCEPTION"],
      note: ONLY_EXCEPTION,
    });
    assert.equal(
      ONLY_EXCEPTION,
      "The records contradict this attribute, so only Exception can be recorded.",
    );
  });

  it("offers nothing to a person who cannot act, or where the check is not finished and current", () => {
    const { made, found } = line(gap(A, "A"));
    assert.equal(tickmarkOffer(made, found, false), null);
    for (const standing of [
      "NOT_CHECKED",
      "CHECKING",
      "HELD",
      "FAILED",
      "OUT_OF_DATE",
    ] as const) {
      assert.equal(tickmarkOffer({ standing }, found, true), null, standing);
    }
    // A check out of date as sent reads as out of date: nothing is offered.
    const stale = check({ out_of_date: ["A file was added."] });
    assert.equal(stale.standing, "OUT_OF_DATE");
    assert.equal(tickmarkOffer(stale, found, true), null);
    // Nor on an attribute without an id to record against.
    assert.equal(
      tickmarkOffer(made, { attributeId: "", contradicted: false }, true),
      null,
    );
  });
});

describe("the form", () => {
  it("says what is missing in the server's own sentences, by field", () => {
    assert.deepEqual(tickmarkProblems(draftFrom(null)), {
      kind: "Choose what to record.",
      reason: "Give the reason in a sentence of at least 10 characters.",
    });
    assert.deepEqual(
      tickmarkProblems({
        kind: "NOT_AVAILABLE",
        reason: "x".repeat(1001),
        reliedOn: "y".repeat(601),
        annotationId: "",
      }),
      {
        reason: "The reason can be at most 1000 characters.",
        reliedOn: "What was relied on instead can be at most 600 characters.",
      },
    );
    assert.deepEqual(
      tickmarkProblems({
        kind: "SHOWN_ON_REVIEW",
        reason: "The Okta screen shows it.",
        reliedOn: "",
        annotationId: "",
      }),
      {
        annotation:
          "Choose an annotation on the evidence that names this attribute, or add one.",
      },
    );
    // Space alone is no reason.
    assert.ok(
      tickmarkProblems({
        kind: "EXCEPTION",
        reason: "   a     b   ",
        reliedOn: "",
        annotationId: "",
      }).reason !== undefined,
    );
  });

  it("sends only what its kind takes", () => {
    const base = {
      reason: "  The ticket   system was retired.  ",
      reliedOn: " The HR report. ",
      annotationId: uuid(203),
    };
    assert.deepEqual(tickmarkFields({ ...base, kind: "NOT_AVAILABLE" }), {
      kind: "NOT_AVAILABLE",
      reason: "The ticket system was retired.",
      relied_on: "The HR report.",
    });
    assert.deepEqual(tickmarkFields({ ...base, kind: "SHOWN_ON_REVIEW" }), {
      kind: "SHOWN_ON_REVIEW",
      reason: "The ticket system was retired.",
      annotation_id: uuid(203),
    });
    assert.deepEqual(tickmarkFields({ ...base, kind: "EXCEPTION" }), {
      kind: "EXCEPTION",
      reason: "The ticket system was retired.",
    });
  });

  it("starts 'Change' from what stands", () => {
    const [read] = attributesOf({
      attributes: [gap(A, "A", { disposition: disposition() })],
    });
    assert.deepEqual(draftFrom(read?.disposition ?? null), {
      kind: "NOT_AVAILABLE",
      reason: "The ticket system was retired in 2026.",
      reliedOn: "The HR leaver report.",
      annotationId: "",
    });
  });

  it("offers only annotations a person reviewed that name the attribute, in the row's file order", () => {
    const set = (fileId: string, notes: Array<Record<string, unknown>>) =>
      parseAnnotations({
        file_id: fileId,
        requirement_id: REQUEST,
        positions: false,
        pages: [],
        can_edit: true,
        attributes: [
          { id: A, code: "A", text: "A", annotation_ids: [] },
          { id: B, code: "B", text: "B", annotation_ids: [] },
        ],
        annotations: notes,
      });
    const note = (n: number, over: Record<string, unknown>) => ({
      id: uuid(200 + n),
      kind: "SHOWS",
      label: `Note ${n}`,
      statement: `Statement ${n}.`,
      quote: "",
      attribute_ids: [A],
      status: "CONFIRMED",
      origin: "AGENT",
      version: 1,
      decided_by_name: "Dana Lee",
      ...over,
    });
    const sets = [
      set(SECOND, [note(4, { status: "EDITED" })]),
      set(FILE, [
        note(1, {}),
        note(2, { status: "PROPOSED" }),
        note(3, { attribute_ids: [B] }),
        note(5, { status: "REMOVED" }),
      ]),
    ].filter((each) => each !== null);
    const choices = annotationChoices(sets, A, [TICKET, SHEET]);
    assert.deepEqual(
      choices.map((each) => [each.id, each.ref, each.number]),
      [
        [uuid(201), "E1", 1],
        [uuid(204), "E2", 1],
      ],
    );
  });
});

describe("the write (assuranceWrite)", () => {
  const ids = {
    organization_id: ORG,
    project_id: PROJECT,
    control_id: CONTROL,
    requirement_id: REQUEST,
  };
  const base = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/evidence-assurance/${REQUEST}`;

  it("knows the check's intents and the two tickmark intents, and nothing else", () => {
    // Changed 14 November 2026 (docs/evidence-assurance.md, section 10.14, B). Old: these
    // four. New: also "file-reliability" and "reopen-file-reliability", a person's
    // decision on a file's reliability, whose bodies assuranceWrite checks as the
    // contract shapes them (file-reliability-model.test.ts). Kept: any other intent is
    // not sent.
    assert.deepEqual(ASSURANCE_INTENTS, [
      "rerun",
      "upgrade",
      "disposition",
      "reopen-disposition",
      "file-reliability",
      "reopen-file-reliability",
    ]);
    assert.deepEqual(assuranceWrite({ ...ids, intent: "rerun" }), {
      path: `${base}/rerun`,
    });
    assert.deepEqual(assuranceWrite({ ...ids, intent: "delete" }), {
      error: "invalid",
    });
  });

  it("records a disposition with the body the contract shapes", () => {
    assert.deepEqual(
      assuranceWrite({
        ...ids,
        intent: "disposition",
        attribute_id: B,
        kind: "NOT_AVAILABLE",
        reason: "  The ticket system was retired.  ",
        relied_on: "The HR report.",
        replaces: null,
      }),
      {
        path: `${base}/attributes/${B}/disposition`,
        body: {
          kind: "NOT_AVAILABLE",
          reason: "The ticket system was retired.",
          relied_on: "The HR report.",
          replaces: null,
        },
      },
    );
    assert.deepEqual(
      assuranceWrite({
        ...ids,
        intent: "disposition",
        attribute_id: B,
        kind: "SHOWN_ON_REVIEW",
        reason: "The Okta screen shows it.",
        annotation_id: uuid(203),
        replaces: uuid(900),
      }),
      {
        path: `${base}/attributes/${B}/disposition`,
        body: {
          kind: "SHOWN_ON_REVIEW",
          reason: "The Okta screen shows it.",
          annotation_id: uuid(203),
          replaces: uuid(900),
        },
      },
    );
  });

  // Added 14 November 2026 (review fix 1): the server at 2b3887f refuses a recording
  // that replaces a disposition the person did not see, by `replaces`.
  it("records naming what the person saw standing: replaces, a UUID or null, always sent", () => {
    const good = {
      ...ids,
      intent: "disposition",
      attribute_id: B,
      kind: "EXCEPTION",
      reason: "A second account was active.",
    };
    // Change: the id seen standing. Tickmark: null, none seen.
    for (const replaces of [uuid(900), null]) {
      const write = assuranceWrite({ ...good, replaces });
      assert.ok("path" in write);
      assert.deepEqual(write.body, {
        kind: "EXCEPTION",
        reason: "A second account was active.",
        replaces,
      });
    }
    // Never left unsaid, and never anything but an id or null.
    for (const replaces of [undefined, "", "900", 900, { id: uuid(900) }]) {
      assert.deepEqual(
        assuranceWrite({ ...good, replaces }),
        { error: "invalid" },
        JSON.stringify(replaces),
      );
    }
    // Only the contract's fields go on: a version or an id from the page does not.
    const write = assuranceWrite({
      ...good,
      replaces: null,
      version: 1,
      id: uuid(900),
    });
    assert.ok("path" in write);
    assert.deepEqual(Object.keys(write.body ?? {}).sort(), [
      "kind",
      "reason",
      "replaces",
    ]);
  });

  it("sends nothing the server would refuse for its shape", () => {
    const good = {
      ...ids,
      intent: "disposition",
      attribute_id: B,
      kind: "NOT_APPLICABLE",
      reason: "It does not apply here.",
      replaces: null,
    };
    assert.ok("path" in assuranceWrite(good));
    for (const bad of [
      { attribute_id: "B" },
      { kind: "ACCEPTED" },
      { reason: "short" },
      { reason: "x".repeat(1001) },
      { reason: 42 },
      { relied_on: "Only with not available." },
      { annotation_id: uuid(203) },
      { kind: "SHOWN_ON_REVIEW" },
      { kind: "SHOWN_ON_REVIEW", annotation_id: "not-an-id" },
      { kind: "NOT_AVAILABLE", relied_on: "y".repeat(601) },
      { requirement_id: "x" },
    ]) {
      assert.deepEqual(
        assuranceWrite({ ...good, ...bad }),
        { error: "invalid" },
        JSON.stringify(bad),
      );
    }
  });

  // Changed 14 November 2026 (review fix 1). Old: "reopens with {version, reason}
  // only"; every standing disposition has version 1, so the version could not tell the
  // one seen from the one that replaced it, and the server at 2b3887f answers 422 to it.
  // New: {id, reason}, `id` the disposition the person saw standing; the version is
  // never sent.
  it("reopens with {id, reason} only: the disposition the person saw", () => {
    assert.deepEqual(
      assuranceWrite({
        ...ids,
        intent: "reopen-disposition",
        attribute_id: B,
        id: uuid(900),
        version: 2,
        reason: "The HR report was found.",
        kind: "EXCEPTION",
        replaces: uuid(901),
      }),
      {
        path: `${base}/attributes/${B}/disposition/reopen`,
        body: { id: uuid(900), reason: "The HR report was found." },
      },
    );
    for (const id of [undefined, null, "", "900", 900]) {
      assert.deepEqual(
        assuranceWrite({
          ...ids,
          intent: "reopen-disposition",
          attribute_id: B,
          id,
          version: 1,
          reason: "The HR report was found.",
        }),
        { error: "invalid" },
        JSON.stringify(id),
      );
    }
  });

  it("shows the server's sentence on a refusal, and success only on its answer", () => {
    assert.equal(dispositionProblem(200), null);
    assert.equal(
      dispositionProblem(
        409,
        "The check finds the records contradict this attribute, so only “Exception” can be recorded here.",
      ),
      "The check finds the records contradict this attribute, so only “Exception” can be recorded here.",
    );
    // The server's stale sentences, as they are.
    for (const stale of [
      "This tickmark changed since the page loaded, so refresh and try again.",
      "A tickmark was recorded on this attribute since the page loaded, so refresh and try again.",
    ]) {
      assert.equal(dispositionProblem(409, stale), stale);
    }
    for (const status of [0, 403, 404, 409, 422, 500]) {
      const said = dispositionProblem(status);
      assert.ok(said !== null && said.length > 0, String(status));
      assert.equal(/the client/i.test(said), false);
    }
  });
});

describe("the workpaper (docs/evidence-assurance.md, section 10.13)", () => {
  const sample = (): Record<string, unknown> =>
    JSON.parse(
      readFileSync("tests/fixtures/design-workpaper/sample.json", "utf8"),
    ) as Record<string, unknown>;
  type RawAttribute = Record<string, unknown>;
  const withStates = (
    states: Array<[string, string, Record<string, string>?]>,
    over: Record<string, unknown> = {},
  ) => {
    const raw = sample();
    const attributes = raw.attributes as RawAttribute[];
    raw.attributes = attributes.map((item, at) => {
      const [state, tickmark, marks] = states[at] ?? [
        String(item.state),
        String(item.tickmark),
      ];
      return {
        ...item,
        state,
        tickmark,
        ...(marks === undefined ? {} : { marks }),
      };
    });
    const paper = parseDesignWorkpaper({ ...raw, ...over });
    assert.ok(paper !== null);
    return paper;
  };

  it("words the three states in their own words, never as shown, never green", () => {
    const paper = withStates([
      ["SHOWN_ON_REVIEW", "REVIEWED"],
      ["NOT_APPLICABLE", "NONE"],
      ["NOT_AVAILABLE", "NONE"],
    ]);
    assert.deepEqual(
      paper.attributes.slice(0, 3).map((item) => stateOf(item)),
      [
        { words: "Shown, auditor's judgment", tone: "neutral" },
        { words: "Not applicable to this instance", tone: "neutral" },
        { words: "Evidence not available, accepted", tone: "neutral" },
      ],
    );
  });

  it("gives the † tickmark only to 'Shown, auditor's judgment', and never agreed or compared to a disposition", () => {
    const paper = withStates([
      ["SHOWN_ON_REVIEW", "REVIEWED"],
      ["NOT_AVAILABLE", "REVIEWED"],
      ["SHOWN_ON_REVIEW", "AGREED"],
      ["SHOWN", "REVIEWED"],
    ]);
    assert.deepEqual(
      paper.attributes.map((item) => item.tickmark),
      ["REVIEWED", "NONE", "NONE", "NONE"],
    );
    assert.deepEqual(tickmarkOf({ tickmarks: [] }, "REVIEWED"), {
      symbol: "†",
      meaning: "On the auditor's review, with the reason recorded.",
    });
  });

  it("lists † in the legend only where an attribute carries it", () => {
    const reviewed = {
      mark: "REVIEWED",
      symbol: "†",
      meaning: "On the auditor's review, with the reason recorded.",
    };
    const base = sample().tickmarks as unknown[];
    const used = withStates([["SHOWN_ON_REVIEW", "REVIEWED"]], {
      tickmarks: [...base, reviewed],
    });
    assert.ok(tickmarkLegend(used).some((item) => item.mark === "REVIEWED"));
    const unused = withStates([], { tickmarks: [...base, reviewed] });
    assert.equal(
      tickmarkLegend(unused).some((item) => item.mark === "REVIEWED"),
      false,
    );
    // Without the server's legend, from the marks in use.
    const own = withStates([["SHOWN_ON_REVIEW", "REVIEWED"]], {
      tickmarks: [],
    });
    assert.ok(tickmarkLegend(own).some((item) => item.symbol === "†"));
    const none = withStates([], { tickmarks: [] });
    assert.equal(
      tickmarkLegend(none).some((item) => item.symbol === "†"),
      false,
    );
  });

  it("marks the file the auditor's judgment rests on as Reviewed, never as Shows", () => {
    const paper = withStates([
      ["SHOWN_ON_REVIEW", "REVIEWED", { E4: "REVIEWED" }],
    ]);
    const cell = matrixOf(paper).rows[0]?.cells.find(
      (each) => each.ref === "E4",
    );
    assert.equal(cell?.mark, "REVIEWED");
    assert.equal(cell?.word, "Reviewed");
    assert.equal(cell?.symbol, "†");
    assert.notEqual(cell?.tone, "success");
  });

  it("never counts a disposition as shown in the tiles", () => {
    const paper = withStates([
      ["SHOWN_ON_REVIEW", "REVIEWED"],
      ["NOT_AVAILABLE", "NONE"],
      ["SHOWN", "COMPARED"],
      ["NOT_APPLICABLE", "NONE"],
    ]);
    const tile = tilesOf(paper).find((each) => each.key === "attributes");
    assert.equal(tile?.value, "1 of 4 shown");
    assert.equal(
      tile?.note,
      "1 on the auditor's judgment, 1 accepted without evidence, 1 not applicable",
    );
    assert.equal(tile?.tone, "neutral");
  });

  it("words a disposition as a matter for the reviewer; a person's exception is open", () => {
    assert.deepEqual(matterWords({ state: "NOTED", kind: "DISPOSITION" }), {
      state: "Noted",
      tone: "neutral",
      kind: "Tickmark",
    });
    assert.deepEqual(matterWords({ state: "OPEN", kind: "DISPOSITION" }), {
      state: "Open",
      tone: "warning",
      kind: "Tickmark",
    });
  });
});

describe("the words", () => {
  it("never say 'the client', and keep the contract's words for each kind", () => {
    const words = [
      ...Object.values(TICKMARK_WORDS).flatMap((each) => [
        each.label,
        each.shown,
        each.hint,
        each.quiet,
      ]),
      ...Object.values(ENDING_WORDS),
      ONLY_EXCEPTION,
      DIGEST_TICKMARKED,
    ];
    for (const said of words) {
      assert.equal(/the client/i.test(said), false, said);
      assert.equal(said.includes("—"), false, said);
    }
    assert.deepEqual(
      DISPOSITION_KINDS.map((kind) => TICKMARK_WORDS[kind].label),
      [
        "Shown, on my review",
        "Not applicable to this instance",
        "Evidence not available, accepted",
        "Exception",
      ],
    );
    assert.equal(
      TICKMARK_WORDS.SHOWN_ON_REVIEW.shown,
      "Shown, auditor's judgment",
    );
  });
});

// Review fixes, 14 November 2026 (docs/evidence-assurance.md, section 10.13), each with
// the server at 2b3887f. Each failed against the page before its fix.

describe("the history (review fix 6)", () => {
  it("says the server's reason for every ending, under a neutral label of its own", () => {
    assert.deepEqual(ENDING_WORDS, {
      REPLACED: "Replaced",
      REOPENED: "Reopened",
      SUPERSEDED_BY_CHECK: "Ended by a later check",
      OVERTAKEN_BY_CHECK: "Ended by a later check",
      ANNOTATION_GONE:
        "Ended: its annotation changed or its file is no longer in force",
      OTHER: "No longer stands",
    });
    const [read] = attributesOf({
      attributes: [
        gap(A, "A", {
          disposition_history: [
            ended({
              id: uuid(911),
              ended_as: "OVERTAKEN_BY_CHECK",
              ended_by_name: null,
              ended_reason:
                "A later check of the request found the records contradict this attribute.",
            }),
            ended({
              id: uuid(912),
              ended_as: "ANNOTATION_GONE",
              ended_reason:
                "The annotation it rests on no longer names this attribute.",
            }),
            ended({ id: uuid(913), ended_as: "REPLACED", ended_reason: "" }),
            ended({ id: uuid(914) }),
          ],
        }),
      ],
    });
    const lines = (read?.history ?? []).map((item) => endingLine(item));
    assert.equal(lines.length, 4);
    assert.match(
      lines[0] ?? "",
      /^Ended by a later check \(The check · .+\): A later check of the request found the records contradict this attribute\.$/,
    );
    assert.match(
      lines[1] ?? "",
      /^Ended: its annotation changed or its file is no longer in force \(Dana Lee · .+\): The annotation it rests on no longer names this attribute\.$/,
    );
    assert.match(lines[2] ?? "", /^Replaced \(Dana Lee · .+\)\.$/);
    assert.match(
      lines[3] ?? "",
      /^Reopened \(Dana Lee · .+\): Recorded on the wrong attribute\.$/,
    );
    // No label claims more than the ending: a check that ended a tickmark never says
    // the attribute is shown.
    for (const words of Object.values(ENDING_WORDS)) {
      assert.equal(/shown|contradict|removed/i.test(words), false, words);
    }
  });
});

describe("the accept note with tickmarks (review fix 7)", () => {
  const row = (attributes: unknown[]) => {
    const assurance = parseAssurance({ requests: [entry({ attributes })] });
    const made = assuranceRow({
      requirementId: REQUEST,
      files: [TICKET],
      assurance,
      attributes: lettered,
      span: (letters) =>
        lettersSpan(
          letters,
          lettered.map((item) => item.letter),
        ),
    });
    assert.ok(made !== null);
    return made.acceptNote;
  };
  const judgment = (over: Record<string, unknown> = {}) =>
    attribute({
      attribute_id: B,
      code: "B",
      verdict: "UNSETTLED",
      result: null,
      shows: null,
      assessment: "INDETERMINATE",
      summary: "The two readings read the files differently.",
      passages: [],
      views: [
        { role: "ASSESSOR", result: "MET", reason: "Shown." },
        { role: "REVIEWER", result: "NOT_MET", reason: "Not shown." },
      ],
      ...over,
    });

  it("cautions where a person's exception stands: accepting does not settle it", () => {
    const note = row([
      attribute({
        disposition: disposition({ kind: "EXCEPTION", relied_on: "" }),
      }),
    ]);
    assert.ok(
      note.startsWith("Accepting marks attribute A as evidenced."),
      note,
    );
    assert.ok(
      note.includes(
        "An exception is recorded on A; accepting does not settle it.",
      ),
      note,
    );
    // Said for each, together.
    assert.equal(
      acceptNote({
        standing: "REVIEWED",
        implemented: [],
        design: [],
        unstated: [],
        issues: [],
        judged: [],
        decided: [],
        excepted: ["A", "C"],
        leftOut: 0,
        span: (letters) => letters.join(" and "),
      }),
      "Accepting marks no attribute as evidenced: the two readings find no record of an instance that shows one. Exceptions are recorded on A and C; accepting does not settle them.",
    );
  });

  it("says a closing tickmark carries the person's tickmark, never that a judgment is needed there", () => {
    const before = row([attribute(), judgment()]);
    assert.ok(before.includes("Your judgment is needed on B."), before);
    const note = row([attribute(), judgment({ disposition: disposition() })]);
    assert.equal(note.includes("Your judgment is needed on B"), false, note);
    assert.ok(
      note.includes(
        "B carries your tickmark, so it is not marked as evidenced.",
      ),
      note,
    );
    // Never counted as evidenced.
    assert.ok(
      note.startsWith("Accepting marks attribute A as evidenced."),
      note,
    );
    assert.equal(note.includes("You can still accept"), false, note);
    // Every other caution stays: an issue on a tickmarked attribute is still said.
    const issue = row([
      attribute(),
      gap(B, "B", { disposition: disposition() }),
    ]);
    assert.ok(issue.includes("Both readings found an issue on B."), issue);
    assert.ok(issue.includes("B carries your tickmark"), issue);
    // The check's own evidenced shown stands before a closing tickmark: nothing said.
    const shown = row([
      attribute({
        disposition: disposition({ kind: "NOT_APPLICABLE", relied_on: "" }),
      }),
    ]);
    assert.equal(shown.includes("tickmark"), false, shown);
  });
});

describe("what 'Shown, on my review' may rest on (review fix 8)", () => {
  const set = (notes: Array<Record<string, unknown>>) =>
    parseAnnotations({
      file_id: FILE,
      requirement_id: REQUEST,
      positions: false,
      pages: [],
      can_edit: true,
      attributes: [{ id: A, code: "A", text: "A", annotation_ids: [] }],
      annotations: notes,
    });
  const note = (n: number, kind: string) => ({
    id: uuid(300 + n),
    kind,
    label: `Note ${n}`,
    statement: `Statement ${n}.`,
    quote: "",
    attribute_ids: [A],
    status: "CONFIRMED",
    origin: "PERSON",
    version: 1,
    decided_by_name: "Dana Lee",
  });

  it("offers only an annotation that shows the attribute, and says each one's kind", () => {
    const sets = [
      set([
        note(1, "SHOWS"),
        note(2, "EXCEPTION"),
        note(3, "IDENTIFIES"),
        note(4, "SOURCE"),
      ]),
    ].filter((each) => each !== null);
    const choices = annotationChoices(sets, A, [TICKET]);
    assert.deepEqual(
      choices.map((each) => [each.id, each.kind, each.kindWords]),
      [[uuid(301), "SHOWS", "Shows attribute A"]],
    );
    // A standing one is still named by its id whatever its kind (recorded before the
    // rule, it stands as it was).
    assert.equal(annotationOf(sets, uuid(302), [TICKET])?.label, "Note 2");
    assert.equal(annotationOf(sets, uuid(399), [TICKET]), null);
    assert.equal(annotationOf(sets, null, [TICKET]), null);
  });
});

describe("the workpaper's exception recorded by the auditor (review fix 9b)", () => {
  const paperWith = (states: Array<[string, string]>) => {
    const raw = JSON.parse(
      readFileSync("tests/fixtures/design-workpaper/sample.json", "utf8"),
    ) as Record<string, unknown>;
    const attributes = raw.attributes as Array<Record<string, unknown>>;
    raw.attributes = attributes.map((item, at) => {
      const [state, tickmark] = states[at] ?? [
        String(item.state),
        String(item.tickmark),
      ];
      return { ...item, state, tickmark };
    });
    const paper = parseDesignWorkpaper(raw);
    assert.ok(paper !== null);
    return paper;
  };

  it("words EXCEPTION_RECORDED in its own words, with no tickmark, never as shown", () => {
    const paper = paperWith([
      ["EXCEPTION_RECORDED", "AGREED"],
      ["SHOWN", "AGREED"],
      ["SHOWN", "AGREED"],
      ["SHOWN", "AGREED"],
    ]);
    const [first] = paper.attributes;
    assert.ok(first !== undefined);
    assert.equal(first.state, "EXCEPTION_RECORDED");
    // Rewritten 15 November 2026 (product owner): was "Exception recorded by the
    // auditor"; the Result now reads "Exceptions noted". Still never as shown.
    assert.deepEqual(stateOf(first), {
      words: "Exceptions noted",
      tone: "danger",
    });
    assert.equal(first.tickmark, "NONE");
    const tiles = tilesOf(paper);
    const attributes = tiles.find((each) => each.key === "attributes");
    assert.equal(attributes?.value, `3 of ${paper.attributes.length} shown`);
    assert.equal(attributes?.note.includes("1 exception recorded"), true);
    assert.notEqual(attributes?.note, "Every attribute is shown");
    assert.notEqual(attributes?.tone, "success");
    const exceptions = tiles.find((each) => each.key === "exceptions");
    assert.ok(
      exceptions?.note.includes("1 recorded by the auditor"),
      exceptions?.note,
    );
    assert.equal(exceptions?.tone, "danger");
  });
});
