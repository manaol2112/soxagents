import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_DEMO } from "../apps/web/src/demo-model.ts";
import {
  DEFAULT_TOUR,
  demoNavEntry,
  moveOutcome,
  nextStage,
  offersResume,
  onStagePage,
  parseTour,
  previousStage,
  progressLabel,
  STAGE_KEYS,
  STAGES,
  secondExampleHref,
  showsGuide,
  showsWelcome,
  stageHref,
  stageOf,
  WELCOME_COPY,
} from "../apps/web/src/demo-tour-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONTROL = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";
const D001 = "55555555-5555-4555-8555-555555555555";
const D003 = "66666666-6666-4666-8666-666666666666";

const answer = {
  available: true,
  reason: "",
  project_id: PROJECT,
  stage: "testing",
  status: "IN_PROGRESS",
  stale: false,
  version: 3,
  stages: [...STAGE_KEYS],
  anchors: {
    control_ref: "NS-AC-02",
    control_id: CONTROL,
    request_id: REQUEST,
    sheet_id: "77777777-7777-4777-8777-777777777777",
    failed_sample: "TRM-27-0412",
    workpaper_id: null,
    review_id: null,
    retest_round_id: null,
    deficiency_ids: { "D-001": D001, "D-003": D003, bad: "nope" },
    export_ids: { status_report: "88888888-8888-4888-8888-888888888888" },
  },
};
const trial = { state: "TRIAL", planType: "TRIAL", trialExpiresAt: null };
const readyDemo = {
  ...DEFAULT_DEMO,
  eligible: true,
  state: "READY",
  projectId: PROJECT,
  datasetComplete: true,
};

describe("the tour as the server says it stands", () => {
  it("reads the answer, keeps only well-formed ids, and defaults to nothing", () => {
    const tour = parseTour(answer);
    assert.equal(tour.available, true);
    assert.equal(tour.stage, "testing");
    assert.equal(tour.status, "IN_PROGRESS");
    assert.equal(tour.version, 3);
    assert.equal(tour.anchors?.controlId, CONTROL);
    assert.equal(tour.anchors?.failedSample, "TRM-27-0412");
    assert.deepEqual(tour.anchors?.deficiencyIds, {
      "D-001": D001,
      "D-003": D003,
    });
    assert.deepEqual(parseTour(null), DEFAULT_TOUR);
    assert.equal(
      parseTour({ stage: "finale", status: "LOST" }).stage,
      "overview",
    );
    assert.equal(
      parseTour({ stage: "finale", status: "LOST" }).status,
      "NOT_STARTED",
    );
    assert.equal(parseTour({ ...answer, anchors: "none" }).anchors, null);
  });

  it("has eight stages in the audit's order, each with words and a page target", () => {
    assert.equal(STAGES.length, 8);
    assert.deepEqual(
      STAGES.map((stage) => stage.key),
      [...STAGE_KEYS],
    );
    for (const [index, stage] of STAGES.entries()) {
      assert.equal(stage.number, index + 1);
      assert.ok(stage.title && stage.lead && stage.action, stage.key);
      assert.ok(
        stage.points.length >= 3 && stage.targets.length >= 1,
        stage.key,
      );
      // Neutral, client-facing words: no first person for the agent.
      assert.doesNotMatch(stage.lead, /\bI\b|\bI'll\b|\bwe\b/i, stage.key);
    }
    assert.equal(stageOf("review").title, "Independent review");
    assert.equal(nextStage("overview"), "planning");
    assert.equal(nextStage("reporting"), null);
    assert.equal(previousStage("overview"), null);
    assert.equal(previousStage("remediation"), "review");
    assert.equal(progressLabel("testing"), "Stage 5 of 8");
    assert.match(WELCOME_COPY.title, /AI Audit Workspace/);
    assert.match(WELCOME_COPY.detail, /synthetic/);
  });
});

describe("where each stage opens", () => {
  const anchors = parseTour(answer).anchors;

  it("deep-links by the records the server resolved, never by name", () => {
    const planning = new URL(
      stageHref("planning", ORG, PROJECT, anchors),
      "http://x",
    );
    assert.equal(planning.searchParams.get("section"), "controls");
    assert.equal(planning.searchParams.get("control"), CONTROL);
    assert.equal(planning.searchParams.get("step"), "plan");
    assert.equal(planning.searchParams.get("tour"), "planning");
    const evidence = new URL(
      stageHref("evidence", ORG, PROJECT, anchors),
      "http://x",
    );
    assert.equal(evidence.searchParams.get("step"), "request");
    assert.equal(evidence.searchParams.get("ev"), "requests");
    assert.equal(evidence.searchParams.get("request"), REQUEST);
    const testing = new URL(
      stageHref("testing", ORG, PROJECT, anchors),
      "http://x",
    );
    assert.equal(testing.searchParams.get("step"), "test");
    const review = new URL(
      stageHref("review", ORG, PROJECT, anchors),
      "http://x",
    );
    assert.equal(review.searchParams.get("step"), "review");
    const remediation = new URL(
      stageHref("remediation", ORG, PROJECT, anchors),
      "http://x",
    );
    assert.equal(remediation.searchParams.get("section"), "reports");
    assert.equal(remediation.searchParams.get("view"), "deficiencies");
    assert.equal(remediation.searchParams.get("deficiency"), D001);
    const reporting = new URL(
      stageHref("reporting", ORG, PROJECT, anchors),
      "http://x",
    );
    assert.equal(reporting.searchParams.get("view"), "status");
    assert.equal(
      new URL(
        stageHref("overview", ORG, PROJECT, anchors),
        "http://x",
      ).searchParams.get("section"),
      "overview",
    );
    // Without the records, a control stage falls back to the controls page.
    const bare = new URL(stageHref("testing", ORG, PROJECT, null), "http://x");
    assert.equal(bare.searchParams.get("section"), "controls");
    assert.equal(bare.searchParams.get("control"), null);
    assert.match(
      secondExampleHref(ORG, PROJECT, anchors) ?? "",
      new RegExp(D003),
    );
    assert.equal(secondExampleHref(ORG, PROJECT, null), null);
  });

  it("knows when the page open is the stage's page", () => {
    const at = (href: string) => new URL(href, "http://x").searchParams;
    for (const key of STAGE_KEYS) {
      assert.equal(
        onStagePage(key, at(stageHref(key, ORG, PROJECT, anchors)), anchors),
        true,
        key,
      );
    }
    assert.equal(
      onStagePage(
        "testing",
        at(stageHref("review", ORG, PROJECT, anchors)),
        anchors,
      ),
      false,
    );
    assert.equal(
      onStagePage(
        "overview",
        at(stageHref("reporting", ORG, PROJECT, anchors)),
        anchors,
      ),
      false,
    );
    // The second remediation example counts as the remediation stage's page.
    assert.equal(
      onStagePage(
        "remediation",
        at(secondExampleHref(ORG, PROJECT, anchors) ?? ""),
        anchors,
      ),
      true,
    );
    // Moving within a stage's page (another tab) stays on it.
    const tabbed = at(stageHref("planning", ORG, PROJECT, anchors));
    tabbed.set("tab", "activity");
    assert.equal(onStagePage("planning", tabbed, anchors), true);
  });
});

describe("when the welcome, the guide and the entry show", () => {
  const started = parseTour(answer);
  const fresh = parseTour({
    ...answer,
    stage: "overview",
    status: "NOT_STARTED",
  });
  const skipped = parseTour({ ...answer, status: "SKIPPED" });

  it("welcomes once, inside the demo, never over another dialog, again when stale", () => {
    assert.equal(
      showsWelcome(fresh, { inDemo: true, dialogOpen: false }),
      true,
    );
    assert.equal(
      showsWelcome(fresh, { inDemo: false, dialogOpen: false }),
      false,
    );
    assert.equal(
      showsWelcome(fresh, { inDemo: true, dialogOpen: true }),
      false,
    );
    assert.equal(
      showsWelcome(started, { inDemo: true, dialogOpen: false }),
      false,
    );
    assert.equal(
      showsWelcome(skipped, { inDemo: true, dialogOpen: false }),
      false,
    );
    assert.equal(
      showsWelcome(parseTour({ ...answer, stale: true }), {
        inDemo: true,
        dialogOpen: false,
      }),
      true,
    );
    assert.equal(
      showsWelcome(
        parseTour({ ...answer, available: false, status: "NOT_STARTED" }),
        {
          inDemo: true,
          dialogOpen: false,
        },
      ),
      false,
    );
  });

  it("shows the guide while the tour runs, and offers to resume a skipped one", () => {
    assert.equal(showsGuide(started, true), true);
    assert.equal(showsGuide(started, false), false);
    assert.equal(showsGuide(skipped, true), false);
    assert.equal(offersResume(skipped, true), true);
    assert.equal(
      offersResume(parseTour({ ...answer, status: "COMPLETED" }), true),
      true,
    );
    assert.equal(offersResume(started, true), false);
    assert.equal(offersResume(fresh, true), false);
  });

  it("gives the top bar one entry: explore, resume, or the way back", () => {
    const outside = { inDemo: false, organizationId: ORG, ownProjectId: "own" };
    const explore = demoNavEntry(readyDemo, trial, fresh, outside);
    assert.equal(explore?.kind, "explore");
    assert.match(explore?.href ?? "", new RegExp(`project=${PROJECT}`));
    const resume = demoNavEntry(readyDemo, trial, started, outside);
    assert.equal(resume?.kind, "resume");
    assert.match(resume?.href ?? "", /step=test/);
    const back = demoNavEntry(readyDemo, trial, started, {
      ...outside,
      inDemo: true,
    });
    assert.equal(back?.kind, "back");
    assert.match(back?.href ?? "", /project=own/);
    const noOwn = demoNavEntry(readyDemo, trial, started, {
      ...outside,
      inDemo: true,
      ownProjectId: null,
    });
    assert.match(noOwn?.href ?? "", /section=projects/);
    // No entry for a paid firm, or before the demo exists.
    assert.equal(
      demoNavEntry(
        readyDemo,
        { ...trial, planType: "PAID", state: "ACTIVE" },
        started,
        outside,
      ),
      null,
    );
    assert.equal(demoNavEntry(DEFAULT_DEMO, trial, fresh, outside), null);
  });

  it("says what a refused move means", () => {
    assert.equal(moveOutcome(200, null), null);
    assert.match(moveOutcome(403, null) ?? "", /members of the demo/);
    assert.match(moveOutcome(422, null) ?? "", /not part of the tour/);
    assert.match(moveOutcome(0, null) ?? "", /connection/);
    assert.equal(
      moveOutcome(500, { detail: "database away" }),
      "database away",
    );
  });
});
