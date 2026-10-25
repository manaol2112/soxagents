import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type Onboarding,
  parseOnboarding,
  parsePeriod,
  setupWrite,
} from "../apps/web/src/onboarding-model.ts";
import {
  guidedStep,
  setupBrief,
  setupCycle,
} from "../apps/web/src/setup-guide-model.ts";
import { controlsToSetUp } from "../apps/web/src/shell-model.ts";

const projectId = "33333333-3333-7333-8333-333333333333";

function onboarding(extra: Record<string, unknown> = {}): Onboarding {
  const parsed = parseOnboarding({
    project_id: projectId,
    project_name: "SOX FY27",
    project_status: "DRAFT",
    scope: "",
    settings: {
      period_end: "2027-12-31",
      client_coordinator_name: "",
      client_coordinator_email: "",
      client_domains: [],
      pbc_due_days: 10,
      pbc_follow_up_days: 3,
      pbc_max_follow_ups: 2,
      templates_confirmed_at: null,
      kicked_off_at: null,
      version: 1,
    },
    applications: [],
    team: [],
    candidates: [],
    controls: [],
    templates: [],
    agents: [],
    readiness: [
      {
        step: "scope",
        title: "Scope",
        complete: false,
        issues: ["Describe what the engagement covers."],
        advisories: [],
      },
      {
        step: "team",
        title: "Team",
        complete: false,
        issues: ["Name an engagement lead."],
        advisories: ["Add an independent reviewer."],
      },
      {
        step: "rcm",
        title: "Controls",
        complete: false,
        issues: ["Load the standard library or upload the client's RCM."],
        advisories: [],
      },
      { step: "workpapers", title: "Templates", complete: true, issues: [] },
    ],
    ready: false,
    plan: null,
    started: false,
    ...extra,
  });
  assert.ok(parsed);
  return parsed;
}

describe("onboarding through guided setup", () => {
  it("opens on the first step with something to do, never an overview", () => {
    assert.equal(guidedStep(onboarding(), "overview"), "profile");
    assert.equal(guidedStep(onboarding(), "team"), "team");
    const allReady = onboarding({
      readiness: [
        { step: "scope", title: "Scope", complete: true, issues: [] },
        { step: "team", title: "Team", complete: true, issues: [] },
        { step: "rcm", title: "Controls", complete: true, issues: [] },
        { step: "workpapers", title: "Templates", complete: true, issues: [] },
      ],
      ready: true,
    });
    assert.equal(guidedStep(allReady, "overview"), "launch");
  });

  // Onboarding is the client and scope, the team, and launch (decided by the product
  // owner, 25 October 2026); systems, controls, and templates are set up in Controls.
  it("shows the client and scope, the team, and launch, the open step current", () => {
    const cycle = setupCycle(onboarding(), "team");
    assert.deepEqual(
      cycle.map((stage) => `${stage.id}:${stage.state}`),
      ["profile:upcoming", "team:current", "launch:upcoming"],
    );
    assert.equal(cycle[0]?.title, "Client and scope");
    assert.equal(cycle[0]?.detail, "1 to do");
    const entered = onboarding({
      readiness: [
        { step: "scope", title: "Scope", complete: true, issues: [] },
        {
          step: "team",
          title: "Team",
          complete: false,
          issues: ["Name an engagement lead."],
        },
      ],
    });
    assert.deepEqual(
      setupCycle(entered, "team").map(
        (stage) => `${stage.id}:${stage.state}:${stage.detail}`,
      ),
      [
        "profile:done:Entered",
        "team:current:1 to do",
        "launch:upcoming:Check the plan, start the agents",
      ],
    );
  });

  it("says what the step needs, what is worth checking, and where next", () => {
    const team = setupBrief(onboarding(), "team");
    assert.equal(team.title, "Team");
    assert.deepEqual(team.todo, ["Name an engagement lead."]);
    assert.deepEqual(team.worth, ["Add an independent reviewer."]);
    assert.equal(team.ready, false);
    assert.equal(team.next, null);
    assert.equal(team.progress, "0 of 2 onboarding steps ready.");
    // A ready step points at the next onboarding step with something to do, else launch.
    const ready = onboarding({
      readiness: [
        { step: "scope", title: "Scope", complete: true, issues: [] },
        { step: "team", title: "Team", complete: true, issues: [] },
      ],
      ready: true,
    });
    assert.deepEqual(setupBrief(ready, "team").next, {
      step: "launch",
      label: "Review and launch",
    });
    assert.equal(
      setupBrief(ready, "team").progress,
      "2 of 2 onboarding steps ready.",
    );
  });

  it("lists everything that holds launch on the launch step", () => {
    const launch = setupBrief(onboarding(), "launch");
    assert.equal(launch.ready, false);
    assert.ok(
      launch.todo.some((line) => line.endsWith("Name an engagement lead.")),
    );
    assert.ok(launch.todo.length >= 3);
  });

  it("keeps the product's neutral voice", () => {
    const words = (
      ["profile", "team", "controls", "workpapers", "launch"] as const
    )
      .map((step) => setupBrief(onboarding(), step))
      .flatMap((brief) => [
        brief.title,
        brief.outcome,
        brief.tip,
        brief.progress,
      ])
      .join(" ");
    assert.doesNotMatch(words, /\b(I|I'll|I'm|me|my|we|let's)\b/i);
  });
});

describe("controls after launch", () => {
  it("are set up in Controls while a launched engagement has none", () => {
    assert.equal(controlsToSetUp({ status: "ACTIVE", controls: 0 }), true);
    assert.equal(controlsToSetUp({ status: "ACTIVE", controls: 31 }), false);
    // Before launch the Controls page is closed; a closed engagement changes nothing.
    assert.equal(controlsToSetUp({ status: "DRAFT", controls: 0 }), false);
    assert.equal(controlsToSetUp({ status: "ARCHIVED", controls: 0 }), false);
    assert.equal(controlsToSetUp({ status: "COMPLETED", controls: 0 }), false);
    assert.equal(controlsToSetUp(null), false);
  });
});

describe("a name and period that disagree", () => {
  const org = "11111111-1111-4111-8111-111111111111";
  const project = "22222222-2222-4222-8222-222222222222";
  const basis = "0123456789abcdef0123456789abcdef";

  it("carries both corrections from the check", () => {
    const period = parsePeriod({
      basis,
      confirmed: false,
      conflicts: [
        {
          kind: "NAME_YEAR",
          message:
            "The engagement's name points to 2028, but the period ends 31 December 2027.",
          blocking: true,
          period_end_fix: "2028-12-31",
          name_fix: "SOX FY2027",
        },
      ],
    });
    assert.ok(period);
    assert.equal(period.conflicts[0]?.periodEndFix, "2028-12-31");
    assert.equal(period.conflicts[0]?.nameFix, "SOX FY2027");
  });

  it("sends the correction chosen, for exactly what the page showed", () => {
    const write = setupWrite({
      organization_id: org,
      project_id: project,
      intent: "period-align",
      basis,
      to: "name",
    });
    assert.ok(!("error" in write));
    assert.equal(
      write.path,
      `/organizations/${org}/projects/${project}/onboarding/period/align`,
    );
    assert.deepEqual(write.body, { basis, to: "name" });
    assert.deepEqual(
      setupWrite({
        organization_id: org,
        project_id: project,
        intent: "period-align",
        basis,
        to: "scope",
      }),
      { error: "invalid" },
    );
  });
});
