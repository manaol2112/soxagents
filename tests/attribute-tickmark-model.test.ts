import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  annotationChoices,
  type CheckDigest,
  checkDigest,
  DIGEST_NOTHING,
  DIGEST_TICKMARKED,
  draftFrom,
  ENDING_WORDS,
  EXCEPTION_RECORDED,
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

/** The records contradict it: an exception a record shows. */
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
        deviation: true,
        absent: [],
        passages: [passage()],
      },
    ],
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
    assert.deepEqual(read?.disposition, {
      id: uuid(900),
      kind: "NOT_AVAILABLE",
      reason: "The ticket system was retired in 2026.",
      reliedOn: "The HR leaver report.",
      annotationId: null,
      recordedBy: "Dana Lee",
      recordedAt: "2026-11-14T09:30:00Z",
      version: 1,
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

  it("reads a contradiction as the server does: its assessment, or for the first engine the same table", () => {
    const [two] = attributesOf({ attributes: [contradicted()] });
    assert.equal(two?.contradicted, true);
    const [plain] = attributesOf({ attributes: [gap(A, "A")] });
    assert.equal(plain?.contradicted, false);
    // Engine 1 sends no assessment: an issue resting on a deviation, or on the result
    // CONTRADICTED, or an exception beside a file not read.
    const first = (over: Record<string, unknown>) =>
      attributesOf({
        engine_version: 1,
        attributes: [contradicted({ assessment: undefined, ...over })],
      })[0]?.contradicted;
    assert.equal(first({}), true);
    assert.equal(
      first({ elements: [], result: "CONTRADICTED", passages: [passage()] }),
      true,
    );
    assert.equal(first({ verdict: "UNSETTLED", result: null }), true);
    assert.equal(first({ elements: [], result: "NOT_MET" }), false);
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

  it("keeps a finding that waits on the person on the first screen beside the tickmark", () => {
    const made = checkDigest(
      check({
        attributes: [
          attribute(),
          gap(B, "B", {
            finding_id: uuid(41),
            finding_status: "PROPOSED",
            disposition: disposition(),
          }),
        ],
      }),
      [{ id: uuid(41), status: "PROPOSED" }],
      [TICKET],
    );
    assert.equal(
      made?.quiet.find((item) => item.attributeKey === B)?.text,
      "B accepted without evidence, finding to decide",
    );
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
    assert.deepEqual(ASSURANCE_INTENTS, [
      "rerun",
      "upgrade",
      "disposition",
      "reopen-disposition",
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
      }),
      {
        path: `${base}/attributes/${B}/disposition`,
        body: {
          kind: "NOT_AVAILABLE",
          reason: "The ticket system was retired.",
          relied_on: "The HR report.",
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
      }),
      {
        path: `${base}/attributes/${B}/disposition`,
        body: {
          kind: "SHOWN_ON_REVIEW",
          reason: "The Okta screen shows it.",
          annotation_id: uuid(203),
        },
      },
    );
  });

  it("sends nothing the server would refuse for its shape", () => {
    const good = {
      ...ids,
      intent: "disposition",
      attribute_id: B,
      kind: "NOT_APPLICABLE",
      reason: "It does not apply here.",
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

  it("reopens with {version, reason} only", () => {
    assert.deepEqual(
      assuranceWrite({
        ...ids,
        intent: "reopen-disposition",
        attribute_id: B,
        version: 2,
        reason: "The HR report was found.",
        kind: "EXCEPTION",
      }),
      {
        path: `${base}/attributes/${B}/disposition/reopen`,
        body: { version: 2, reason: "The HR report was found." },
      },
    );
    for (const version of [0, 1.5, "2", null]) {
      assert.deepEqual(
        assuranceWrite({
          ...ids,
          intent: "reopen-disposition",
          attribute_id: B,
          version,
          reason: "The HR report was found.",
        }),
        { error: "invalid" },
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
