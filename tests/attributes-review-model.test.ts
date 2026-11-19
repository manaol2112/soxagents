/**
 * Review attributes (product owner, 19 November 2026, approved prototype): the Attributes
 * step's card ("Reviewed n/N"), its rows' chips and lines, what each row offers, "Accept all"
 * and the assumptions it takes with it, the row that opens next, the footer, the set card,
 * and "Remove" in place of "Retire" for a control's attribute. Pure models; the view's
 * wiring is checked from its source at the end.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  SET_TITLE,
  setLine,
} from "../apps/web/src/attributes-handoff-model.ts";
import {
  type Assumption,
  type Attribute,
  acceptAllRows,
  firstUnifiedToDecide,
  GONE_CHIPS,
  type GoneRow,
  historyWords,
  JUST_DECIDED,
  KEEPS_ONE,
  listBasisLine,
  listCount,
  nextToReview,
  removeQuestion,
  reviewedWords,
  reviewList,
  reviewProgress,
  rowAssumptionWords,
  rowOffer,
  rowOriginLine,
  UNIFIED_CHIPS,
  unifiedRows,
} from "../apps/web/src/control-context-model.ts";
import {
  reviewCount,
  type WorkflowStep,
} from "../apps/web/src/control-workflow-model.ts";
import {
  attributesFooter,
  type PanelFrame,
} from "../apps/web/src/step-panel-model.ts";
import {
  acceptAllNote,
  acceptAllWords,
  assumptionRowWords,
  notYetAccepted,
} from "../apps/web/src/understanding-specialist-model.ts";

const tailored = {
  objective: "",
  condition: "The approval date is compared with the grant date.",
  passCriteria: "Approved on or before the grant.",
  failCriteria: "Granted before it was approved.",
  judgmentRequired: false,
  automatable: null,
  phases: [],
  origin: "AGENT" as const,
  acceptedBy: "",
  acceptedAt: "",
  owned: false,
};

function attribute(id: string, overrides: Partial<Attribute> = {}): Attribute {
  return {
    id,
    position: 0,
    text: `Attribute ${id}`,
    status: "APPROVED",
    basis: "DOCUMENTED",
    sourceKind: "LIBRARY",
    sourceDocumentId: null,
    sourceTitle: "",
    sourceQuote: "",
    note: "",
    proposal: null,
    replacesId: null,
    decidedBy: null,
    version: 1,
    definition: null,
    criteria: tailored,
    review: null,
    ...overrides,
  };
}

function assumption(id: string, over: Partial<Assumption> = {}): Assumption {
  return {
    id,
    matter: "Role mapping",
    assumed: "The client maps the request's terms to roles.",
    status: "OPEN",
    answer: "",
    decidedBy: null,
    decidedAt: null,
    attributeCodes: ["A"],
    version: 1,
    kind: "ASSUMPTION",
    ...over,
  };
}

const accepted = attribute("a", {
  criteria: { ...tailored, owned: true, acceptedBy: "Dana Reyes" },
});
const assuming = attribute("b", { assumptions: [assumption("s1")] });
const plain = attribute("c");
const held = attribute("d", { heldByConflict: true });

describe("the rows' words", () => {
  it("reads 'To review' for agent output not yet decided, never 'To accept'", () => {
    assert.deepEqual(UNIFIED_CHIPS.TO_ACCEPT, {
      label: "To review",
      tone: "ai",
    });
    assert.equal(UNIFIED_CHIPS.ACCEPTED.label, "Accepted");
    // The states the prototype did not show keep their words, in the same style.
    assert.equal(UNIFIED_CHIPS.MISSING.label, "Needs criteria");
    assert.equal(UNIFIED_CHIPS.UPDATING.label, "Updating…");
    assert.ok(
      Object.values(UNIFIED_CHIPS).every((chip) => chip.label !== "To accept"),
    );
    assert.deepEqual(GONE_CHIPS, {
      REMOVED: { label: "Removed" },
      NOT_ADDED: { label: "Not added" },
    });
    assert.deepEqual(JUST_DECIDED, {
      ACCEPTED: "Accepted just now",
      REMOVED: "Removed just now",
      NOT_ADDED: "Not added just now",
    });
  });

  it("says the source, who tailored it, and an assumption no person confirmed", () => {
    const [, second, third] = unifiedRows({
      approved: [accepted, assuming, plain],
      proposed: [],
    });
    assert.equal(
      second && rowOriginLine(second),
      "Library standard · tailored by the agent · 1 assumption",
    );
    assert.equal(
      third && rowOriginLine(third),
      "Library standard · tailored by the agent",
    );
    // Confirmed or changed by a person: no longer counted; a conflict is said as one.
    assert.equal(
      rowAssumptionWords({
        assumptions: [
          assumption("x", { status: "CONFIRMED" }),
          assumption("y", { kind: "CONFLICT" }),
          assumption("z", { status: "ACCEPTED_WITH_ATTRIBUTE" }),
        ],
      }),
      // The number and its noun never part at a line end.
      "1 assumption · 1 conflict",
    );
  });

  it("states an assumption as a row of the criteria, its state in one word", () => {
    assert.deepEqual(assumptionRowWords(assumption("s")), {
      label: "Assumes",
      text: "The client maps the request's terms to roles.",
      state: "Unconfirmed",
    });
    assert.equal(
      assumptionRowWords(assumption("s", { kind: "CONFLICT" })).state,
      "To decide",
    );
    assert.equal(
      assumptionRowWords(assumption("s", { kind: "NOT_KNOWN" })).label,
      "Not known",
    );
  });

  it("names where the list came from, beside its count", () => {
    assert.equal(
      listBasisLine(unifiedRows({ approved: [plain], proposed: [] })),
      "Tailored from the library standard",
    );
    assert.equal(
      listBasisLine(
        unifiedRows({
          approved: [attribute("m", { sourceKind: "MANUAL" })],
          proposed: [],
        }),
      ),
      "Prepared from the understanding",
    );
    assert.equal(listBasisLine([]), "");
  });
});

describe("Reviewed n/N", () => {
  const rows = unifiedRows({
    approved: [accepted, assuming, plain],
    proposed: [],
  });
  const gone: GoneRow[] = [
    { id: "gone", text: "Removed one", at: 1, outcome: "REMOVED" },
  ];

  it("counts the list's own entries: accepted and removed are reviewed", () => {
    const entries = reviewList(rows, gone);
    // The removed row keeps its place, between A and the rest.
    assert.deepEqual(
      entries.map((entry) =>
        entry.kind === "row" ? entry.row.item.id : entry.gone.id,
      ),
      ["a", "gone", "b", "c"],
    );
    const progress = reviewProgress(entries);
    assert.deepEqual(progress.marks, ["ACCEPTED", "REMOVED", "OPEN", "OPEN"]);
    assert.deepEqual(
      [progress.reviewed, progress.total, progress.accepted, progress.removed],
      [2, 4, 1, 1],
    );
    assert.deepEqual(reviewedWords(progress), {
      value: "2/4",
      label: "2 of 4 attributes reviewed",
    });
  });

  it("never counts a removed row as one of the control's attributes", () => {
    assert.equal(listCount(2, 1), "2 attributes, 1 removed");
    assert.equal(listCount(1, 0), "1 attribute");
    assert.equal(listCount(0, 0), "No attributes yet");
  });

  it("counts a row the server confirmed before the page reads it again, once", () => {
    const entries = reviewList(rows, []);
    assert.equal(reviewProgress(entries, new Set(["b"])).reviewed, 2);
    // A removed row the page still lists is not shown twice.
    const removed = reviewList(rows, [
      { id: "b", text: "Attribute b", at: 1, outcome: "REMOVED" },
    ]);
    assert.equal(removed.length, 3);
    assert.equal(reviewProgress(removed).removed, 1);
  });
});

describe("the row that opens", () => {
  const rows = unifiedRows({
    approved: [accepted, assuming, plain],
    proposed: [],
  });

  it("opens the first row to review, then the next once one is decided", () => {
    assert.equal(firstUnifiedToDecide(rows), "b");
    // Accepted (server confirmed) but not read again yet: the next one opens.
    assert.equal(firstUnifiedToDecide(rows, new Set(["b"])), "c");
    assert.equal(firstUnifiedToDecide(rows, new Set(["b", "c"])), null);
  });

  it("after a decision, opens the next row below it, then wraps to the top", () => {
    const four = unifiedRows({
      approved: [assuming, plain, attribute("e"), attribute("f")],
      proposed: [],
    });
    // A quick Accept on the third row: the fourth is next, not the first.
    assert.equal(nextToReview(four, "e", new Set(["e"])), "f");
    // On the last row: back to the first still to review.
    assert.equal(nextToReview(four, "f", new Set(["f"])), "b");
    assert.equal(nextToReview(four, "f", new Set(["b", "c", "e", "f"])), null);
  });
});

describe("what a row offers", () => {
  const [approved] = unifiedRows({ approved: [assuming, plain], proposed: [] });
  const proposal = (kind: "ADD" | "CHANGE" | "RETIRE") =>
    attribute(`p-${kind}`, {
      status: "PROPOSED",
      proposal: kind,
      replacesId: kind === "ADD" ? null : "b",
    });

  it("offers Accept, one Edit and Remove, Remove asked inline first", () => {
    assert.ok(approved !== undefined);
    // One Edit (design review, 19 November 2026): on an approved attribute it edits the
    // criteria under review; the wording is the quiet "Edit wording" link.
    assert.deepEqual(rowOffer(approved, { held: false, lastOne: false }), {
      primary: "ACCEPT",
      edit: "CRITERIA",
      editWording: true,
      decline: { label: "Remove", decision: "RETIRE", confirm: true },
      acceptsRemoval: false,
      keepsOne: false,
    });
    assert.equal(removeQuestion("B"), "Remove attribute B from this control?");
  });

  it("offers only what can succeed: no Remove for the last, no Accept while held", () => {
    assert.ok(approved !== undefined);
    const last = rowOffer(approved, { held: false, lastOne: true });
    assert.equal(last.decline, null);
    // Said in its place, not left to disappear.
    assert.equal(last.keepsOne, true);
    assert.equal(KEEPS_ONE, "A control keeps at least one attribute.");
    assert.equal(
      rowOffer(approved, { held: true, lastOne: false }).primary,
      null,
    );
    const [missing] = unifiedRows({
      approved: [attribute("m", { criteria: { ...tailored, origin: null } })],
      proposed: [],
    });
    assert.ok(missing !== undefined);
    const offer = rowOffer(missing, { held: false, lastOne: true });
    assert.equal(offer.primary, "WRITE");
    // "Write criteria" is the way into the editor: no second Edit beside it.
    assert.equal(offer.edit, null);
    assert.equal(offer.editWording, true);
  });

  it("keeps the agent's proposals' approve and reject, in plain words", () => {
    const rows = unifiedRows({
      approved: [assuming, plain],
      proposed: [proposal("ADD"), proposal("CHANGE")],
    });
    const reworded = rows.find((row) => row.kind === "REWORDED");
    const added = rows.find((row) => row.kind === "ADDED");
    assert.ok(reworded !== undefined && added !== undefined);
    assert.deepEqual(rowOffer(added, { held: false, lastOne: false }).decline, {
      label: "Don't add",
      decision: "REJECT",
      confirm: false,
    });
    assert.equal(
      rowOffer(reworded, { held: false, lastOne: false }).decline?.label,
      "Keep current wording",
    );
    // A proposal's Edit is its proposed wording, with no second link.
    for (const row of [added, reworded]) {
      const offer = rowOffer(row, { held: false, lastOne: false });
      assert.equal(offer.edit, "WORDING");
      assert.equal(offer.editWording, false);
    }
    const [removal] = unifiedRows({
      approved: [assuming, plain],
      proposed: [proposal("RETIRE")],
    });
    assert.ok(removal !== undefined && removal.kind === "REMOVAL");
    const offer = rowOffer(removal, { held: false, lastOne: false });
    assert.equal(offer.acceptsRemoval, true);
    assert.equal(offer.decline?.label, "Keep");
    assert.equal(
      rowOffer(removal, { held: false, lastOne: true }).acceptsRemoval,
      false,
    );
  });
});

describe("Accept all", () => {
  it("reads 'Accept all', then 'Accept remaining n', with its assumptions beside it", () => {
    const rows = unifiedRows({
      approved: [accepted, assuming, plain, held],
      proposed: [],
    });
    const all = acceptAllRows(rows);
    assert.deepEqual(
      all.map((row) => row.item.id),
      ["b", "c"],
    );
    const before = acceptAllWords(all, 1, { remaining: notYetAccepted(rows) });
    assert.equal(before.label, "Accept all");
    assert.equal(
      acceptAllNote(before),
      "1 left out: a conflict to decide · 1 unconfirmed assumption",
    );
    const after = acceptAllWords(all, 1, { reviewed: 1 });
    assert.equal(after.label, "Accept remaining 2");
    // Nothing unconfirmed goes with it: no count is said.
    const third = rows[2];
    assert.ok(third !== undefined);
    assert.equal(acceptAllWords([third], 0).includes, "");
  });
});

describe("the step around the list", () => {
  it("counts each row to review once, as the node and the agent's line say it", () => {
    assert.equal(reviewCount({ approved: 3, proposed: 0, toReview: 3 }), 3);
    assert.equal(
      reviewCount({ approved: 3, proposed: 1, untailored: 2, toAccept: 2 }),
      3,
    );
  });

  it("says in the footer what each branch waits on here, then Ready", () => {
    const step = (key: string, status: string, tone: string) =>
      ({
        key,
        number: 4,
        title: key,
        status,
        tone,
      }) as PanelFrame["next"][number] & Pick<WorkflowStep, "tone">;
    const frame = {
      key: "attributes",
      title: "Attributes",
      need: { kind: "act", title: "Review attributes", detail: "" },
      basedOn: [],
      next: [
        {
          ...step("designevidence", "Waiting on the attributes", "waiting"),
          when: "",
        },
        { ...step("testdesign", "Not started", "idle"), when: "" },
      ],
    } as PanelFrame;
    assert.deepEqual(
      attributesFooter(frame, 3).next.map((item) => item.status),
      ["3 to review", "Ready"],
    );
    // Another step's footer is left as it is.
    const other = { ...frame, key: "testdesign" } as PanelFrame;
    assert.equal(attributesFooter(other, 3), other);
  });

  it("says the set attributes in counts, then what can start", () => {
    assert.equal(SET_TITLE, "Attributes set");
    assert.equal(
      setLine(4, 1, "D&I Evidence and Scope & Sampling can start."),
      "4 accepted, 1 removed. D&I Evidence and Scope & Sampling can start.",
    );
    assert.equal(setLine(5, 0, ""), "5 accepted.");
  });

  it("keeps each part of a row's top line in its own column", () => {
    // Design review, 19 November 2026: with no quick Accept (an open, accepted or removed
    // row) the chip fell into the quick Accept's column and the caret into the chip's.
    const css = readFileSync("apps/web/app/attribute-list.css", "utf8");
    const at = css.indexOf("Each part keeps its own column");
    assert.ok(at > 0);
    const block = css.slice(at, css.indexOf("@media (max-width: 640px)", at));
    for (const [part, column] of [
      ["tar-head", "1"],
      ["tar-quick", "2"],
      ["tar-chip", "3"],
      ["tar-caret", "4"],
    ] as const) {
      const rule = `.ta.is-embedded .tar-top > .${part} {`;
      const found = block.indexOf(rule);
      assert.ok(found >= 0, part);
      const body = block.slice(found, block.indexOf("}", found));
      assert.ok(body.includes(`grid-column: ${column};`), part);
    }
  });
});

describe("Remove, never Retire, for a control's attribute", () => {
  it("words a removed attribute's history row, keeping what is stored", () => {
    assert.deepEqual(
      historyWords({ status: "RETIRED", note: "Retired by the team." }),
      { badge: "removed", note: "Removed by the team." },
    );
    assert.deepEqual(
      historyWords({ status: "RETIRED", note: "Retired on review." }),
      { badge: "removed", note: "Removed on review." },
    );
    // A wording replaced by a newer one is not removed: the attribute stands.
    assert.equal(
      historyWords({ status: "RETIRED", note: "Reworded by the team." }).badge,
      "replaced",
    );
    assert.equal(
      historyWords({ status: "REJECTED", note: "" }).badge,
      "rejected",
    );
  });
});

describe("the old words do not come back on this step", () => {
  const view = readFileSync("apps/web/src/control-context-view.tsx", "utf8");
  const start = view.indexOf("function EmbeddedAttributes(");
  const end = view.indexOf("// Issues", start);
  const step = view.slice(start, end);
  const model = readFileSync("apps/web/src/control-context-model.ts", "utf8");
  const panel = readFileSync("apps/web/src/step-panel-model.ts", "utf8");

  it("has no 'To accept' row chip, no 'Retire', no decision eyebrow", () => {
    assert.ok(start > 0 && end > start);
    for (const old of [
      /Retire attribute/,
      /"Retire"/,
      /Your decision is needed/i,
      /YOUR DECISION/,
      /Decide the attributes/,
      /label: "To accept"/,
    ]) {
      assert.doesNotMatch(step, old);
      assert.doesNotMatch(panel, old);
    }
    assert.doesNotMatch(model, /label: "To accept"/);
    // Every visible word for retiring a control's attribute is "Remove".
    assert.doesNotMatch(view, /"Retire attribute"|`Retire \$\{|"Retiring…"/);
  });

  it("shows a decision's success only once the server confirmed it", () => {
    // The row settles only after the call resolved true; never before it is sent.
    assert.match(step, /if \(await onAccept\(\[each\]\)\) \{\s*settle\(/);
    assert.match(step, /if \(await onDecide\(decision, each\.item\)\) \{/);
    assert.doesNotMatch(step, /Undo/);
  });

  it("offers Run again once the attributes are set only where it would do something", () => {
    // Design review, 19 November 2026 (P11).
    assert.match(
      step,
      /heading\?\.kind !== "set" \|\| context\.attributesRerunUseful === true/,
    );
    // Accept all and its note are kept together when the bar wraps (design review).
    assert.match(step, /<span className="tar-all">/);
  });
});
