import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  changes,
  checkDraft,
  draftFrom,
  engagementLine,
  FREQUENCIES,
  methodologyProblem,
  methodologyReadPath,
  methodologyWrite,
  parseEngagement,
  parseMethodology,
  provenance,
  type Rules,
  rulesBody,
  standing,
} from "../apps/web/src/methodology-model.ts";
import {
  SETTINGS_FIRM_FROM,
  SETTINGS_TAB_LABELS,
  SETTINGS_TABS,
} from "../apps/web/src/routes.ts";

const ORG = "0195f2a0-0000-7000-8000-000000000001";
const PROJECT = "0195f2a0-0000-7000-8000-000000000002";
const VERSION = "0195f2a0-0000-7000-8000-000000000003";

const apiRules = {
  sample_sizes: {
    ANNUAL: 1,
    QUARTERLY: 2,
    MONTHLY: 2,
    WEEKLY: 5,
    DAILY: 20,
    RECURRING: 25,
    EVENT_DRIVEN: 25,
  },
  rollforward_sizes: {
    ANNUAL: 1,
    QUARTERLY: 1,
    MONTHLY: 1,
    WEEKLY: 2,
    DAILY: 5,
    RECURRING: 10,
    EVENT_DRIVEN: 10,
  },
  retest: {
    ANNUAL: { size: 1, days: 0 },
    QUARTERLY: { size: 2, days: 180 },
    MONTHLY: { size: 2, days: 60 },
    WEEKLY: { size: 5, days: 35 },
    DAILY: { size: 20, days: 28 },
    RECURRING: { size: 25, days: 20 },
    EVENT_DRIVEN: { size: 25, days: 30 },
  },
  tolerance: "ZERO",
  automated: "TEST_OF_ONE",
};

const version = (over: Record<string, unknown> = {}) => ({
  id: VERSION,
  number: 1,
  status: "PLATFORM_DEFAULT",
  rules: apiRules,
  rationale: "The platform's default rules.",
  based_on: null,
  proposed_by: "",
  proposed_by_id: null,
  proposed_at: null,
  decided_by: "",
  decided_at: null,
  decision_note: "",
  engagements: 3,
  version: 1,
  ...over,
});

const firm = (over: Record<string, unknown> = {}) =>
  parseMethodology({
    current: version(),
    pending: null,
    history: [version()],
    frequencies: [...FREQUENCIES],
    can_propose: true,
    can_decide: false,
    can_withdraw: false,
    independence: true,
    max_sample: 200,
    max_wait_days: 365,
    ...over,
  });

describe("the firm's testing methodology", () => {
  it("reads the version in force and says it is not approved until the firm approves one", () => {
    const read = firm();
    assert.ok(read !== null);
    assert.equal(read.current.rules.sampleSizes.QUARTERLY, 2);
    assert.equal(read.current.rules.retest.QUARTERLY.days, 180);
    assert.deepEqual(standing(read.current), {
      label: "Platform default, not approved by the firm",
      tone: "warning",
    });
    assert.match(provenance(read.current), /No auditing standard prescribes/);
    const approved = parseMethodology({
      ...{
        current: version({
          number: 2,
          status: "APPROVED",
          proposed_by: "Ava Lin",
          proposed_at: "2026-11-08T10:00:00Z",
          decided_by: "Morgan Lee",
          decided_at: "2026-11-09T10:00:00Z",
        }),
      },
      history: [],
    });
    assert.ok(approved !== null);
    assert.equal(standing(approved.current).label, "Approved");
    assert.equal(
      provenance(approved.current),
      "Proposed by Ava Lin on Nov 8, 2026; approved by Morgan Lee on Nov 9, 2026.",
    );
    // Nothing to read is not mistaken for a methodology.
    assert.equal(parseMethodology({}), null);
    assert.equal(parseEngagement({}), null);
  });

  it("checks a draft as the API will, and says what is wrong in words", () => {
    const read = firm();
    assert.ok(read !== null);
    const base = read.current.rules;
    const limits = { maxSample: 200, maxWaitDays: 365 };
    const draft = draftFrom(base);
    // Unchanged.
    assert.deepEqual(
      checkDraft(
        { ...draft, rationale: "Manual 4.2, larger samples." },
        base,
        limits,
      ),
      {
        ok: false,
        problems: ["The draft changes nothing yet."],
      },
    );
    // No reason.
    const changed = {
      ...draft,
      sampleSizes: { ...draft.sampleSizes, QUARTERLY: "3" },
    };
    const unexplained = checkDraft(changed, base, limits);
    assert.equal(unexplained.ok, false);
    assert.match(
      unexplained.ok ? "" : (unexplained.problems[0] ?? ""),
      /Say why/,
    );
    // Out of range, or not a whole number.
    for (const bad of ["0", "201", "2.5", "", "abc"]) {
      const result = checkDraft(
        {
          ...draft,
          sampleSizes: { ...draft.sampleSizes, DAILY: bad },
          rationale: "Manual 4.2.",
        },
        base,
        limits,
      );
      assert.equal(result.ok, false, bad);
      assert.match(
        result.ok ? "" : (result.problems[0] ?? ""),
        /Sample for daily controls must be a whole number from 1 to 200/,
      );
    }
    const waits = checkDraft(
      {
        ...draft,
        retestDays: { ...draft.retestDays, MONTHLY: "400" },
        rationale: "Manual 4.2.",
      },
      base,
      limits,
    );
    assert.match(waits.ok ? "" : (waits.problems[0] ?? ""), /from 0 to 365/);
    // A good change: counted, and only the cells it changes are marked.
    const good = checkDraft(
      { ...changed, rationale: "Manual 4.2, larger samples." },
      base,
      limits,
    );
    assert.ok(good.ok);
    assert.equal(good.changed, 1);
    assert.deepEqual([...changes(base, good.rules)], ["sampleSizes:QUARTERLY"]);
    // The body is the API's shape.
    assert.deepEqual(Object.keys(rulesBody(good.rules)), [
      "sample_sizes",
      "rollforward_sizes",
      "retest",
      "tolerance",
      "automated",
    ]);
    assert.equal(
      (rulesBody(good.rules).sample_sizes as Rules["sampleSizes"]).QUARTERLY,
      3,
    );
  });

  it("forwards only well-formed requests, to the testing methodology paths", () => {
    assert.equal(
      methodologyReadPath(new URLSearchParams({ organization: ORG })),
      `/organizations/${ORG}/testing-methodology`,
    );
    assert.equal(
      methodologyReadPath(
        new URLSearchParams({ organization: ORG, project: PROJECT }),
      ),
      `/organizations/${ORG}/projects/${PROJECT}/testing-methodology`,
    );
    assert.equal(
      methodologyReadPath(new URLSearchParams({ organization: "x" })),
      null,
    );
    assert.equal(
      methodologyReadPath(
        new URLSearchParams({ organization: ORG, project: "../x" }),
      ),
      null,
    );
    assert.deepEqual(
      methodologyWrite({
        organization_id: ORG,
        intent: "decide",
        version_id: VERSION,
        version: 1,
        decision: "APPROVE",
        note: "",
      }),
      {
        ok: true,
        path: `/organizations/${ORG}/testing-methodology/versions/${VERSION}/decision`,
        method: "POST",
        body: { decision: "APPROVE", note: "", version: 1 },
      },
    );
    assert.deepEqual(
      methodologyWrite({
        organization_id: ORG,
        intent: "move",
        project_id: PROJECT,
        version_id: VERSION,
        reason: "Adopted the 2027 manual.",
      }),
      {
        ok: true,
        path: `/organizations/${ORG}/projects/${PROJECT}/testing-methodology`,
        method: "PUT",
        body: { version_id: VERSION, reason: "Adopted the 2027 manual." },
      },
    );
    for (const bad of [
      {
        organization_id: ORG,
        intent: "decide",
        version_id: VERSION,
        version: 1,
        decision: "MAYBE",
      },
      {
        organization_id: ORG,
        intent: "propose",
        based_on: VERSION,
        rationale: "",
        rules: {},
      },
      {
        organization_id: ORG,
        intent: "withdraw",
        version_id: VERSION,
        version: 0,
      },
      { organization_id: ORG, intent: "delete" },
      {
        organization_id: "x",
        intent: "withdraw",
        version_id: VERSION,
        version: 1,
      },
    ]) {
      assert.deepEqual(
        methodologyWrite(bad),
        { ok: false },
        JSON.stringify(bad),
      );
    }
  });

  it("explains a refusal so the person knows what to do", () => {
    assert.match(
      methodologyProblem(
        403,
        "the person who proposed a change cannot approve it",
      ),
      /Another Owner or Admin decides it/,
    );
    assert.match(
      methodologyProblem(403, "not allowed"),
      /Only an Owner or Admin/,
    );
    assert.equal(
      methodologyProblem(409, "a proposal is already waiting for a decision"),
      "A proposal is already waiting for a decision.",
    );
    assert.match(methodologyProblem(0, ""), /could not be reached/);
  });

  it("is the first of the firm's Settings tabs, named apart from the audit framework", () => {
    assert.equal(SETTINGS_FIRM_FROM, "methodology");
    assert.ok(
      SETTINGS_TABS.indexOf("methodology") < SETTINGS_TABS.indexOf("workforce"),
    );
    // "Methodology" alone is the engagement profile's audit framework (migration 0074).
    assert.equal(SETTINGS_TAB_LABELS.methodology, "Testing methodology");
    const view = readFileSync("apps/web/src/methodology-view.tsx", "utf8");
    assert.match(view, /once the server confirms it/);
  });
});

describe("an engagement's version", () => {
  it("says which version it follows and what that means, in plain words", () => {
    const engagement = parseEngagement({
      applied: version(),
      label: "Firm methodology v1: platform default, not approved by the firm",
      pinned: true,
      choices: [version({ id: VERSION, number: 2, status: "APPROVED" })],
      can_move: true,
    });
    assert.ok(engagement !== null);
    assert.equal(
      engagementLine(engagement),
      "Follows version 1, the platform default, not approved by the firm. It keeps this version; tests already sized keep their size.",
    );
    const draft = {
      ...engagement,
      pinned: false,
      applied: {
        ...engagement.applied,
        number: 2,
        status: "APPROVED" as const,
      },
    };
    assert.equal(
      engagementLine(draft),
      "Follows version 2, approved by the firm. It takes the version in force when it launches.",
    );
  });
});
