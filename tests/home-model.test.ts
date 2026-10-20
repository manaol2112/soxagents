import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  idleMessage,
  type NextSteps,
  parseNextSteps,
  stepHref,
  stepsByStage,
} from "../apps/web/src/home-model.ts";

const ORG = "01a13253-ec1a-7604-8944-a06dd7633ce0";
const PROJECT = "01a155ff-992f-7342-bc45-127332b008f4";
const CONTROL = "01a12985-c94d-73f6-8007-7d6130692f22";

const stage = (key: string, status: string) => ({
  key,
  label: key,
  status,
  done: 0,
  total: 1,
  summary: "",
});

const body = (steps: unknown[]) => ({
  launched: true,
  current: "PLANS",
  stages: [
    stage("SETUP", "DONE"),
    stage("PLANS", "CURRENT"),
    stage("EVIDENCE", "UPCOMING"),
    stage("TESTING", "UPCOMING"),
    stage("REVIEW", "UPCOMING"),
    stage("CLOSE", "UPCOMING"),
  ],
  steps,
});

const planStep = {
  stage: "PLANS",
  kind: "plans_ready",
  title: "Approve 3 test plans",
  detail: "Nothing holds them.",
  blocks: false,
  section: "planning",
  query: { filter: "DRAFT_READY,PENDING_REVIEW" },
  control_ref: null,
  link: "",
  control_id: null,
  tab: null,
};

const consoleStep = {
  stage: "EVIDENCE",
  kind: "contacts",
  title: "2 drafted requests without a recipient",
  detail: "Assign the evidence coordinator",
  blocks: false,
  section: null,
  query: {},
  control_ref: null,
  link: "evidence",
  control_id: null,
  tab: null,
};

describe("the engagement's next steps", () => {
  it("reads the journey and the steps the API sends", () => {
    const next = parseNextSteps(body([planStep, consoleStep]));
    assert.ok(next !== null);
    assert.equal(next.current, "PLANS");
    assert.deepEqual(
      next.stages.map((item) => item.status),
      ["DONE", "CURRENT", "UPCOMING", "UPCOMING", "UPCOMING", "UPCOMING"],
    );
    assert.equal(next.steps.length, 2);
    assert.equal(next.steps[0]?.section, "planning");
    assert.equal(next.steps[1]?.section, null);
  });

  it("refuses a malformed journey and drops steps it cannot place", () => {
    assert.equal(parseNextSteps(null), null);
    assert.equal(parseNextSteps({ stages: [{ key: "NOPE" }] }), null);
    const next = parseNextSteps(
      body([
        { ...planStep, stage: "ELSEWHERE" },
        { ...planStep, title: "" },
        planStep,
      ]),
    );
    assert.equal(next?.steps.length, 1);
  });

  it("follows only known pages and plain query values", () => {
    const next = parseNextSteps(
      body([
        { ...planStep, section: "https://example.com" },
        {
          ...planStep,
          query: { filter: "DRAFT_READY", next: "/evil", tab: "a b<" },
        },
      ]),
    );
    assert.equal(next?.steps[0]?.section, null);
    assert.deepEqual(next?.steps[1]?.query, { filter: "DRAFT_READY" });
  });

  it("links a page step to its page and a console item where the console does", () => {
    const next = parseNextSteps(
      body([
        planStep,
        consoleStep,
        {
          ...consoleStep,
          stage: "TESTING",
          kind: "results",
          control_id: CONTROL,
          tab: "testing",
        },
      ]),
    ) as NextSteps;
    const [planned, contacts, results] = next.steps;
    assert.ok(planned && contacts && results);
    const plans = new URL(stepHref(planned, ORG, PROJECT), "http://x");
    assert.equal(plans.searchParams.get("section"), "planning");
    assert.equal(
      plans.searchParams.get("filter"),
      "DRAFT_READY,PENDING_REVIEW",
    );
    assert.equal(plans.searchParams.get("project"), PROJECT);
    const evidence = new URL(stepHref(contacts, ORG, PROJECT), "http://x");
    assert.equal(evidence.searchParams.get("section"), "evidence");
    // Requests without a recipient open where the evidence coordinator is assigned.
    assert.equal(evidence.searchParams.get("tab"), "requests");
    assert.equal(evidence.hash, "#contacts-title");
    const control = new URL(stepHref(results, ORG, PROJECT), "http://x");
    assert.equal(control.searchParams.get("section"), "controls");
    assert.equal(control.searchParams.get("control"), CONTROL);
    assert.equal(control.searchParams.get("tab"), "testing");
  });

  it("groups the steps by stage, in the order of the work", () => {
    const next = parseNextSteps(
      body([{ ...consoleStep, stage: "REVIEW" }, consoleStep, planStep]),
    ) as NextSteps;
    assert.deepEqual(
      stepsByStage(next.steps).map((group) => group.stage),
      ["PLANS", "EVIDENCE", "REVIEW"],
    );
  });

  it("says what the engagement waits on when nothing waits on the team", () => {
    const next = parseNextSteps(body([])) as NextSteps;
    assert.match(idleMessage(next), /agents are working/);
    assert.match(
      idleMessage({ ...next, current: "EVIDENCE" }),
      /client is preparing/,
    );
    assert.match(
      idleMessage({ ...next, current: "CLOSE" }),
      /can be completed/,
    );
  });
});
