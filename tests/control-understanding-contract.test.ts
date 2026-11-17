/**
 * The Control Understanding contract, the web's half (B1j, B1k, B1l; the second fix round of
 * B1k, 16 November 2026, after the re-check found the web posting to routes the API does not
 * have and reading fields the API does not send, with tests on both sides green). The one list
 * is tests/contracts/control-understanding.json; services/api/tests/
 * test_control_understanding_contract.py proves the API's half against the same list (each
 * route exists there with that body, each field is on that model). Here: every write the
 * contract names is built by contextWrite as listed, and every field it names is read by the
 * page's parsers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  CONFLICT_HOLDS,
  contextWrite,
  parseContext,
  parseQuestionReview,
  parseReviewRequest,
  SET_CONFLICT_HOLDS,
} from "../apps/web/src/control-context-model.ts";
import { parseReview } from "../apps/web/src/understanding-chat-model.ts";
import { updatedFromLine } from "../apps/web/src/understanding-once-model.ts";

type Route = {
  intent: string;
  method: string;
  path: string;
  fields: Record<string, unknown>;
  body: string[];
  sent?: Record<string, unknown>;
};
type Contract = {
  control: string;
  routes: Route[];
  fields: Record<string, string[]>;
  absent: Record<string, string[]>;
  values: {
    review_not_run: string[];
    need_status: string[];
    question_pass: string[];
    review_request_status: string[];
    set_held_sentence: string;
    held_sentence: string;
    reopened_cause_prefix: string;
  };
};

const CONTRACT: Contract = JSON.parse(
  readFileSync(
    new URL("./contracts/control-understanding.json", import.meta.url),
    "utf8",
  ),
);
const ORG = "018f0000-0000-7000-8000-000000000001";
const PROJECT = "018f0000-0000-7000-8000-000000000002";
const CONTROL = "018f0000-0000-7000-8000-000000000003";
const IDS = { organization_id: ORG, project_id: PROJECT, control_id: CONTROL };

function concrete(path: string, fields: Record<string, unknown>): string {
  return (CONTRACT.control + path)
    .replace("{organization_id}", ORG)
    .replace("{project_id}", PROJECT)
    .replace("{control_id}", CONTROL)
    .replace(/\{(\w+)\}/g, (_all, name: string) => String(fields[name]));
}

describe("Every write the contract names is built as the API takes it", () => {
  for (const route of CONTRACT.routes) {
    it(`${route.intent}: ${route.method} ${route.path}`, () => {
      const write = contextWrite({
        ...IDS,
        intent: route.intent,
        ...route.fields,
      });
      assert.ok(!("error" in write), `${route.intent} was refused`);
      assert.equal(write.method, route.method);
      assert.equal(write.path, concrete(route.path, route.fields));
      assert.deepEqual(Object.keys(write.body).sort(), [...route.body].sort());
      if (route.sent !== undefined) {
        assert.deepEqual(write.body, route.sent);
      }
    });
  }

  it("never builds a route the contract retired", () => {
    // Old (the first fix round): the web posted review-ensure to .../understanding/review/
    // ensure, and the not-knowns to .../walkthrough-answers/{key}/not-known and
    // .../values/{key}/not-known with {note}: none of them exists on the API.
    assert.ok("error" in contextWrite({ ...IDS, intent: "review-ensure" }));
    const source = readFileSync(
      new URL("../apps/web/src/control-context-model.ts", import.meta.url),
      "utf8",
    );
    const key = ["$", "{key}"].join("");
    for (const gone of [
      "/understanding/review/ensure",
      `/walkthrough-answers/${key}/not-known`,
      `/values/${key}/not-known`,
    ]) {
      assert.ok(!source.includes(gone), gone);
    }
  });

  it("refuses a not-known key the API's table would refuse", () => {
    for (const [intent, key] of [
      ["walkthrough-not-known", "change-tool"],
      ["value-not-known", "Change_Tool"],
      ["value-not-known", "x".repeat(42)],
    ] as const) {
      assert.ok("error" in contextWrite({ ...IDS, intent, key, note: "" }));
    }
  });
});

describe("Every field the contract names is read where the API sends it", () => {
  const attribute = {
    id: "018f0000-0000-7000-8000-0000000000a1",
    position: 1,
    text: "Each patch is approved before it is applied.",
    status: "APPROVED",
    basis: "DOCUMENTED",
    source_kind: "LIBRARY",
    version: 1,
    code: "A2",
    held_by_conflict: false,
    assumptions: [],
    criteria_updated_from: "Reopened: Patch approver",
    criteria_versions: 1,
  };
  const body = (extra: Record<string, unknown> = {}) => ({
    control_id: CONTROL,
    attributes: {
      approved: [attribute],
      proposed: [],
      history: [],
      set_held_by_conflict: true,
    },
    issues: [],
    documents: [],
    understanding: {},
    question_pass: "CHECKING",
    understanding_completed_at: null,
    set_assumptions: [],
    review: null,
    review_request: null,
    review_not_run: "",
    review_due: true,
    ...extra,
  });

  it("reads the set's hold on the attributes, and the context's other fields", () => {
    for (const field of CONTRACT.fields.ContextBody ?? []) {
      assert.ok(field in body(), field);
    }
    for (const field of CONTRACT.absent.ContextBody ?? []) {
      assert.ok(!(field in body()), field);
    }
    const parsed = parseContext(body());
    assert.ok(parsed !== null);
    assert.equal(parsed.setHeldByConflict, true);
    assert.equal(parsed.approved[0]?.heldBySet, true);
    assert.equal(parsed.approved[0]?.code, "A2");
    assert.equal(parsed.reviewDue, true);
    assert.equal(parsed.questionPass, "CHECKING");
    // The hold is read on the attributes only: a top-level flag is not the API's.
    const off = body({ set_held_by_conflict: true });
    (off.attributes as Record<string, unknown>).set_held_by_conflict = false;
    assert.equal(parseContext(off)?.setHeldByConflict, false);
  });

  it("reads every reason a review was not run", () => {
    for (const reason of CONTRACT.values.review_not_run) {
      const parsed = parseContext(body({ review_not_run: reason }));
      assert.equal(parsed?.reviewNotRun, reason === "" ? null : reason);
    }
  });

  it("reads the review's not-reviewed items and a request's status", () => {
    const review = parseQuestionReview({
      id: "018f0000-0000-7000-8000-0000000000c1",
      status: "READY",
      round: 1,
      narrative: "The questions answered establish how the control operates.",
      marked: [],
      not_reviewed: ["A2", "APPROVER"],
      not_reviewed_items: [
        {
          key: "A2",
          kind: "ATTRIBUTE",
          attribute_id: attribute.id,
          code: "A2",
          text: attribute.text,
        },
        {
          key: "APPROVER",
          kind: "FACT",
          attribute_id: null,
          code: null,
          text: "Who approves or reviews it",
        },
      ],
      open_questions: 0,
      reviewed_at: "2026-11-16T10:00:00Z",
      failure: "",
    });
    assert.deepEqual(
      review?.notReviewedItems?.map((item) => item.attributeId),
      [attribute.id, null],
    );
    for (const status of CONTRACT.values.review_request_status) {
      assert.equal(
        parseReviewRequest({ status, failure: "x." })?.status,
        status,
      );
    }
  });

  it("reads a need left as not known, with its note, out of the course", () => {
    assert.ok(CONTRACT.values.need_status.includes("NOT_KNOWN"));
    const parsed = parseReview({
      control_ref: "ITGC-CM-06",
      system: "SAP",
      other_systems: [],
      statement: [],
      needs: [
        {
          key: "wt-cm06-approver",
          kind: "WALKTHROUGH",
          label: "Approval",
          question: "Who approves each patch?",
          value: "",
          options: [],
          why: "",
          status: "NOT_KNOWN",
          source: "NONE",
          needed_for: ["EVIDENCE"],
          not_known_note: "Asked the CAB chair.",
        },
        {
          key: "auth-settings",
          kind: "AUTH",
          label: "Sign-in settings",
          question: "How do users sign in?",
          value: "",
          options: [],
          why: "",
          status: "NOT_KNOWN",
          source: "NONE",
          needed_for: ["EVIDENCE"],
          not_known_note: "",
        },
      ],
      evidence: { ready: true, missing: [] },
      attributes: { ready: true, missing: [] },
    });
    assert.deepEqual(parsed?.needs, []);
    assert.deepEqual(
      parsed?.notKnown?.map((item) => [item.key, item.kind, item.note]),
      [
        ["wt-cm06-approver", "WALKTHROUGH", "Asked the CAB chair."],
        ["auth-settings", "AUTH", ""],
      ],
    );
  });

  it("words the holds and a reopened acceptance as the API does", () => {
    assert.equal(SET_CONFLICT_HOLDS, CONTRACT.values.set_held_sentence);
    assert.equal(CONFLICT_HOLDS, CONTRACT.values.held_sentence);
    assert.equal(
      updatedFromLine(`${CONTRACT.values.reopened_cause_prefix}Patch approver`),
      "Reopened for acceptance: you changed the assumption on Patch approver",
    );
  });

  it("reads no upholds on an assumption: the API sends none", () => {
    assert.deepEqual(CONTRACT.absent.AssumptionBody, ["upholds"]);
    const source = readFileSync(
      new URL("../apps/web/src/control-context-model.ts", import.meta.url),
      "utf8",
    );
    assert.ok(!source.includes("value.upholds"));
  });
});
