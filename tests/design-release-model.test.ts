import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkMark,
  EARLY_REASON_MIN,
  earlyRelease,
  itemKind,
  itemsHeading,
  releaseView,
} from "../apps/web/src/design-release-model.ts";
import type { PhaseStatus } from "../apps/web/src/planning-model.ts";

const status = (extra: Partial<PhaseStatus> = {}): PhaseStatus => ({
  phase: "DESIGN",
  label: "Design",
  applicability: "APPLICABLE",
  complete: false,
  step: "READY",
  stepLabel: "Ready to release",
  releasedBy: null,
  releasedAt: null,
  early: false,
  reason: "",
  waitingFor: "",
  waitingOn: "",
  ...extra,
});

const approved = [
  { text: "Access is requested through a ticket.", sourceKind: "LIBRARY" },
  {
    text: "The user's manager approves before access is granted.",
    sourceKind: "LIBRARY",
  },
  { text: "Access granted matches what was approved.", sourceKind: "AGENT" },
];

const [policy, walkthrough, gone] = [
  {
    id: "policy",
    title: "Access provisioning policy",
    attributes: ["The user's manager approves before access is granted."],
    necessity: "REQUIRED",
    state: "PLANNED",
  },
  {
    id: "walkthrough",
    title: "One instance, end to end",
    // Wording as the plan holds it: matched however it is spaced or cased.
    attributes: [
      "access granted matches what was  approved.",
      "Access is requested through a ticket.",
      "The user's manager approves before access is granted.",
    ],
    necessity: "REQUIRED",
    state: "PLANNED",
  },
  {
    id: "gone",
    title: "Removed item",
    attributes: [],
    necessity: "OPTIONAL",
    state: "REMOVED",
  },
] as const;
const items = [policy, walkthrough, gone];

describe("the D&I release card (product owner, 11 November 2026)", () => {
  it("is ready once understood and settled: what is requested, against which attributes", () => {
    const view = releaseView({
      status: status(),
      approved,
      proposed: 0,
      items,
    });
    assert.equal(view.mode, "ready");
    if (view.mode !== "ready") {
      return;
    }
    assert.equal(view.title, "Release the D&I evidence");
    assert.match(
      view.lead,
      /^2 requests will be drafted for approval, tested against 3 attributes\./,
    );
    assert.match(
      view.lead,
      /Nothing goes to the client until each request is approved\.$/,
    );
    // Rewritten (approved preview, 11 November 2026). Old: "Control understood". New:
    // "Understood". Why: the checks now sit inline under the release's title, which names
    // the control's step; the approved row reads "Understood · 3 attributes settled · 2
    // items planned". The not-done wording is unchanged.
    assert.deepEqual(
      view.checks.map((check) => [check.label, check.done]),
      [
        ["Understood", true],
        ["3 attributes settled", true],
        ["2 items planned", true],
      ],
    );
    // Removed items are not requested; each item names the attributes it evidences.
    assert.deepEqual(
      view.items.map((item) => [item.title, item.tests]),
      [
        ["Access provisioning policy", ["B"]],
        ["One instance, end to end", ["A", "B", "C"]],
      ],
    );
    assert.deepEqual(
      view.attributes.map((item) => [item.letter, item.source]),
      [
        ["A", "Library"],
        ["B", "Library"],
        ["C", "Agent · approved"],
      ],
    );
    assert.equal(
      view.sources,
      "the control library and the agent, approved by the team",
    );
    assert.equal(view.resolve, null);
  });

  it("waits for the attributes, pointing to the Attributes step, with an early release offered", () => {
    const view = releaseView({
      status: status({
        step: "WAITING",
        waitingOn: "ATTRIBUTES",
        waitingFor:
          "The attributes are not settled: 1 proposed attribute waits for a decision.",
      }),
      approved,
      proposed: 1,
      items,
    });
    assert.equal(view.mode, "early");
    if (view.mode !== "early") {
      return;
    }
    assert.equal(view.title, "Settle the attributes first");
    assert.match(
      view.lead,
      /^The attributes are not settled: 1 proposed attribute waits/,
    );
    assert.match(view.lead, /You can release it early, with a reason\.$/);
    assert.deepEqual(view.resolve, {
      step: "attributes",
      label: "Decide the attributes",
    });
    const attributes = view.checks.find((check) => check.key === "attributes");
    assert.equal(attributes?.done, false);
    assert.equal(attributes?.label, "1 attribute to decide");
    assert.equal(
      view.checks.find((check) => check.key === "understanding")?.done,
      true,
    );
  });

  it("names Control Understanding first when that is what it waits on", () => {
    const view = releaseView({
      status: status({
        step: "WAITING",
        waitingOn: "UNDERSTANDING",
        waitingFor:
          "Control Understanding is not complete: 2 questions are open.",
      }),
      approved,
      proposed: 0,
      items,
    });
    assert.equal(view.mode, "early");
    if (view.mode !== "early") {
      return;
    }
    assert.equal(view.title, "Complete Control Understanding first");
    assert.deepEqual(view.resolve, {
      step: "understanding",
      label: "Open Control Understanding",
    });
    assert.equal(view.checks[0]?.done, false);
    assert.equal(
      view.checks[0]?.detail,
      "Control Understanding is not complete: 2 questions are open.",
    );
  });

  it("is hidden once released, complete, or not planned", () => {
    for (const step of [
      "RELEASED",
      "COMPLETE",
      "AWAITING_PLAN",
      "NOT_APPLICABLE",
    ] as const) {
      assert.equal(
        releaseView({ status: status({ step }), approved, proposed: 0, items })
          .mode,
        "hidden",
      );
    }
    assert.equal(
      releaseView({ status: null, approved, proposed: 0, items }).mode,
      "hidden",
    );
  });
});

describe("the D&I release card's criteria check (11 November 2026)", () => {
  it("names the attributes still without criteria tailored to the control", () => {
    const view = releaseView({
      status: status({
        step: "WAITING",
        waitingOn: "ATTRIBUTES",
        waitingFor:
          "The attributes are not settled: 2 attributes need criteria tailored to this control.",
      }),
      approved,
      proposed: 0,
      untailored: 2,
      items,
    });
    assert.equal(view.mode, "early");
    if (view.mode !== "early") {
      return;
    }
    const check = view.checks.find((item) => item.key === "attributes");
    assert.equal(check?.label, "2 attributes need criteria");
    assert.equal(check?.done, false);
    assert.match(check?.detail ?? "", /criteria tailored to this control/);
  });

  // Regression (independent review, 11 November 2026, M3): while the server waits on the
  // understanding, the card worded the attributes as settled from approved and proposed
  // alone, ticking "settled" while two attributes had no criteria.
  it("never ticks the attributes settled while criteria are missing, even waiting on understanding", () => {
    const waiting = status({
      step: "WAITING",
      waitingOn: "UNDERSTANDING",
      waitingFor:
        "Control Understanding is not complete: 4 walkthrough questions are not answered.",
    });
    const view = releaseView({
      status: waiting,
      approved,
      proposed: 0,
      untailored: 2,
      items,
    });
    assert.equal(view.mode, "early");
    if (view.mode !== "early") {
      return;
    }
    const check = view.checks.find((item) => item.key === "attributes");
    assert.equal(check?.done, false);
    assert.equal(check?.label, "2 attributes need criteria");
    // Each with criteria: settled, as before.
    const tailored = releaseView({
      status: waiting,
      approved,
      proposed: 0,
      untailored: 0,
      items,
    });
    assert.equal(
      tailored.mode !== "hidden" &&
        tailored.checks.find((item) => item.key === "attributes")?.done,
      true,
    );
  });
});

describe("the D&I release as the approved decision row and list (11 November 2026)", () => {
  const ready = () => {
    const view = releaseView({
      status: status(),
      approved,
      proposed: 0,
      items: [
        { ...policy, categories: ["PROCESS_DOCUMENTATION"] },
        {
          ...walkthrough,
          categories: ["CONTROL_EXECUTION", "PROCESS_DOCUMENTATION"],
        },
        {
          id: "context",
          title: "Prior-year memo",
          attributes: [],
          necessity: "OPTIONAL",
          state: "PLANNED",
        },
      ],
    });
    assert.equal(view.mode, "ready");
    if (view.mode !== "ready") {
      throw new Error("expected a ready release");
    }
    return view;
  };

  it("gives each item to request its kind, icon and one secondary line", () => {
    assert.deepEqual(
      ready().items.map((item) => [item.title, item.icon, item.line]),
      [
        [
          "Access provisioning policy",
          "file",
          "Policy or procedure · how the control is meant to work",
        ],
        // Its first category the card names decides it: a walkthrough instance, not a policy.
        [
          "One instance, end to end",
          "list",
          "Walkthrough instance · one instance, start to finish",
        ],
        // No category named: supporting evidence, marked optional, with nothing invented.
        ["Prior-year memo", "file", "Supporting evidence · Optional"],
      ],
    );
    assert.equal(itemKind(["OTHER", "CONFIGURATION"]).kind, "Configuration");
    assert.equal(itemKind([]).kind, "Supporting evidence");
    assert.equal(itemKind().icon, "file");
  });

  it("marks each check done or open, in words a screen reader hears", () => {
    assert.deepEqual(
      ready().checks.map((check) => checkMark(check)),
      [
        { mark: "done", spoken: "Understood, done" },
        { mark: "done", spoken: "3 attributes settled, done" },
        { mark: "done", spoken: "3 items planned, done" },
      ],
    );
    assert.deepEqual(
      checkMark({ label: "1 attribute to decide", done: false }),
      { mark: "open", spoken: "1 attribute to decide, not done" },
    );
  });

  it("titles the list by the release's state and names who it goes to only when known", () => {
    assert.deepEqual(itemsHeading(ready(), "  Dana Lee "), {
      title: "Will be requested",
      note: "Requested from Dana Lee",
    });
    const early = releaseView({
      status: status({ step: "WAITING", waitingOn: "ATTRIBUTES" }),
      approved,
      proposed: 1,
      items,
    });
    if (early.mode !== "early") {
      throw new Error("expected an early release");
    }
    assert.deepEqual(itemsHeading(early, ""), { title: "Planned", note: "" });
  });

  it("offers the early release only while it waits and the person may release", () => {
    const base = { reason: "", pending: false };
    assert.equal(
      earlyRelease({ ...base, mode: "early", canRelease: true }).offered,
      true,
    );
    assert.equal(
      earlyRelease({ ...base, mode: "early", canRelease: false }).offered,
      false,
    );
    assert.equal(
      earlyRelease({ ...base, mode: "ready", canRelease: true }).offered,
      false,
    );
    assert.equal(
      earlyRelease({ ...base, mode: "hidden", canRelease: true }).offered,
      false,
    );
    const row = earlyRelease({ ...base, mode: "early", canRelease: true });
    assert.equal(row.summary, "Release early instead");
    assert.equal(row.line, "Only with a recorded reason");
  });

  it("keeps Release early disabled until the reason is long enough and nothing is pending", () => {
    const at = (reason: string, pending = false) =>
      earlyRelease({ mode: "early", canRelease: true, reason, pending });
    const none = at("");
    assert.equal(none.left, EARLY_REASON_MIN);
    assert.equal(none.enabled, false);
    assert.equal(
      none.hint,
      `Recorded with the release. At least ${EARLY_REASON_MIN} more characters.`,
    );
    // Spaces around the reason do not count toward it.
    const short = at(`   ${"x".repeat(EARLY_REASON_MIN - 1)}   `);
    assert.equal(short.left, 1);
    assert.equal(
      short.hint,
      "Recorded with the release. At least 1 more character.",
    );
    assert.equal(short.enabled, false);
    const enough = at("x".repeat(EARLY_REASON_MIN));
    assert.equal(enough.left, 0);
    assert.equal(enough.hint, "Recorded with the release.");
    assert.equal(enough.enabled, true);
    // While the release is with the server, it cannot be sent twice.
    assert.equal(at("x".repeat(EARLY_REASON_MIN), true).enabled, false);
  });
});
