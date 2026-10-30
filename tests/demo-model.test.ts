import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  DEFAULT_DEMO,
  DEMO_COPY,
  demoHref,
  demoMenuEntry,
  demoOutcome,
  demoStrip,
  offersDemo,
  parseDemo,
  showsInvitation,
} from "../apps/web/src/demo-model.ts";
import {
  deriveShell,
  type WorkspaceSnapshot,
} from "../apps/web/src/shell-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

const trial = { state: "TRIAL", planType: "TRIAL", trialExpiresAt: null };
const paid = { state: "ACTIVE", planType: "PAID", trialExpiresAt: null };

const invited = {
  state: "NOT_INITIALIZED",
  eligible: true,
  can_initialize: true,
  invitation: "PENDING",
  invited: true,
  dataset_available: true,
  dataset_complete: false,
  project_id: null,
};

describe("the demo as the API says it stands", () => {
  it("reads the server's answer and defaults to nothing offered", () => {
    const demo = parseDemo(invited);
    assert.equal(demo.state, "NOT_INITIALIZED");
    assert.equal(demo.eligible, true);
    assert.equal(demo.canInitialize, true);
    assert.equal(demo.invitation, "PENDING");
    assert.equal(demo.invited, true);
    assert.equal(demo.datasetAvailable, true);
    assert.equal(demo.datasetComplete, false);
    assert.equal(demo.projectId, null);
    assert.deepEqual(parseDemo(null), DEFAULT_DEMO);
    assert.deepEqual(parseDemo({ invitation: "nonsense" }), DEFAULT_DEMO);
    assert.equal(
      parseDemo({ ...invited, invitation: "DISMISSED" }).invitation,
      "DISMISSED",
    );
    // The reset allowance (Step 6): counts from the server, nothing assumed.
    const resettable = parseDemo({
      ...invited,
      resets: 2,
      resets_left: 1,
      can_reset: true,
    });
    assert.equal(resettable.resets, 2);
    assert.equal(resettable.resetsLeft, 1);
    assert.equal(resettable.canReset, true);
    assert.equal(parseDemo({ ...invited, resets: -1 }).resets, 0);
    assert.equal(parseDemo(invited).canReset, false);
  });

  it("asks the API about the demo only for a firm on a running trial", () => {
    const firms = [
      { id: ORG, subscription_state: "TRIAL", plan_type: "TRIAL" },
      { id: "other", subscription_state: "ACTIVE", plan_type: "INTERNAL" },
      { id: "ended", subscription_state: "TRIAL_EXPIRED", plan_type: "TRIAL" },
    ];
    assert.equal(offersDemo(firms, ORG), true);
    assert.equal(offersDemo(firms, "other"), false);
    assert.equal(offersDemo(firms, "ended"), false);
    assert.equal(offersDemo(null, ORG), false);
  });
});

describe("when the invitation opens", () => {
  const quiet = { reopened: false, dialogOpen: false, inDemo: false };

  it("opens once, when the server says this person is invited", () => {
    assert.equal(showsInvitation(parseDemo(invited), quiet), true);
    assert.equal(
      showsInvitation(parseDemo({ ...invited, invited: false }), quiet),
      false,
    );
    assert.equal(
      showsInvitation(
        parseDemo({ ...invited, invitation: "DISMISSED", invited: false }),
        quiet,
      ),
      false,
    );
    assert.equal(showsInvitation(DEFAULT_DEMO, quiet), false);
  });

  it("never opens over another dialog or inside the demo itself", () => {
    const demo = parseDemo(invited);
    assert.equal(showsInvitation(demo, { ...quiet, dialogOpen: true }), false);
    assert.equal(showsInvitation(demo, { ...quiet, inDemo: true }), false);
  });

  it("opens again from the account menu while the person may still start it", () => {
    const declined = parseDemo({
      ...invited,
      invitation: "DISMISSED",
      invited: false,
    });
    assert.equal(showsInvitation(declined, { ...quiet, reopened: true }), true);
    const reviewer = parseDemo({
      ...invited,
      can_initialize: false,
      invited: false,
    });
    assert.equal(
      showsInvitation(reviewer, { ...quiet, reopened: true }),
      false,
    );
    const ended = parseDemo({ ...invited, eligible: false, invited: false });
    assert.equal(showsInvitation(ended, { ...quiet, reopened: true }), false);
  });
});

describe("the account menu's entry", () => {
  it("offers the invitation, then the demo once it exists, on a running trial only", () => {
    assert.deepEqual(demoMenuEntry(parseDemo(invited), trial), {
      kind: "invite",
      label: "Explore the demo",
    });
    const ready = parseDemo({
      ...invited,
      state: "READY",
      project_id: PROJECT,
      invited: false,
    });
    assert.deepEqual(demoMenuEntry(ready, trial), {
      kind: "open",
      label: "Open the demo",
    });
    assert.equal(demoMenuEntry(parseDemo(invited), paid), null);
    assert.equal(
      demoMenuEntry(parseDemo(invited), { ...trial, state: "TRIAL_EXPIRED" }),
      null,
    );
    assert.equal(
      demoMenuEntry(parseDemo({ ...invited, can_initialize: false }), trial),
      null,
    );
    assert.equal(
      demoMenuEntry(parseDemo({ ...invited, eligible: false }), trial),
      null,
    );
  });

  it("opens the demo engagement's own page", () => {
    assert.equal(
      demoHref(ORG, PROJECT),
      `/?section=overview&organization=${ORG}&project=${PROJECT}`,
    );
  });
});

describe("what the server's answer means for the dialog", () => {
  it("opens the demo only when the server confirms it is ready", () => {
    const ready = demoOutcome(
      200,
      { ...invited, state: "READY", project_id: PROJECT },
      ORG,
    );
    assert.deepEqual(ready, { kind: "ready", href: demoHref(ORG, PROJECT) });
  });

  it("says the demo is being prepared while no dataset is available", () => {
    const outcome = demoOutcome(
      200,
      { ...invited, invitation: "ACCEPTED", dataset_available: false },
      ORG,
    );
    assert.equal(outcome.kind, "preparing");
    assert.equal(
      outcome.kind === "preparing" && outcome.words,
      DEMO_COPY.preparing,
    );
  });

  it("explains a refusal and a failure, and says how to recover", () => {
    const ended = demoOutcome(
      402,
      { code: "SUBSCRIPTION_INACTIVE", state: "TRIAL_EXPIRED" },
      ORG,
    );
    assert.equal(ended.kind, "refused");
    assert.match(
      ended.kind === "refused" ? ended.words : "",
      /free trial has ended/,
    );
    const paidFirm = demoOutcome(
      403,
      { code: "DEMO_NOT_AVAILABLE", reason: "not-trial" },
      ORG,
    );
    assert.match(
      paidFirm.kind === "refused" ? paidFirm.words : "",
      /free trial/,
    );
    const reviewer = demoOutcome(403, { detail: "not allowed" }, ORG);
    assert.match(
      reviewer.kind === "refused" ? reviewer.words : "",
      /create engagements/,
    );
    const failed = demoOutcome(503, { code: "DEMO_FAILED", attempts: 1 }, ORG);
    assert.equal(failed.kind, "failed");
    assert.match(failed.kind === "failed" ? failed.words : "", /Try again/);
    const offline = demoOutcome(0, null, ORG);
    assert.match(offline.kind === "failed" ? offline.words : "", /connection/);
  });
});

describe("the demo engagement told apart", () => {
  it("has a strip above its pages, naming a placeholder for what it is", () => {
    const complete = parseDemo({ ...invited, dataset_complete: true });
    assert.match(
      demoStrip({ demo: true }, complete) ?? "",
      /^Synthetic demo engagement for Northstar/,
    );
    assert.match(
      demoStrip({ demo: true }, parseDemo(invited)) ?? "",
      /^Demo preparation/,
    );
    assert.equal(demoStrip({ demo: false }, complete), null);
    // Without the demo's record (the trial ended), the line still says what it is.
    assert.match(
      demoStrip({ demo: true }, DEFAULT_DEMO) ?? "",
      /^Synthetic demo engagement/,
    );
    assert.equal(demoStrip(null, complete), null);
  });

  it("is carried by the shell from the project list and the demo answer", () => {
    const snapshot: WorkspaceSnapshot = {
      meStatus: 200,
      me: { id: "u1", email: "dana@firm.example" },
      organizationsStatus: 200,
      organizations: [
        {
          id: ORG,
          name: "Firm",
          slug: "firm",
          role: "OWNER",
          subscription_state: "TRIAL",
          plan_type: "TRIAL",
        },
      ],
      projectsStatus: 200,
      projects: [
        {
          id: PROJECT,
          name: "Demo",
          slug: "northstar-demo",
          status: "DRAFT",
          demo: true,
        },
        { id: "p2", name: "Own", slug: "own", status: "DRAFT" },
      ],
      requestedOrganizationId: ORG,
      requestedProjectId: PROJECT,
      requestedSection: "projects",
      notifications: "empty",
      canManageProjects: true,
      members: [],
      projectDetail: null,
      notice: null,
      agentsStatus: 200,
      agents: [],
      requestedAgentId: null,
      agentDetail: null,
      tasksStatus: 200,
      tasks: [],
      requestedTaskId: null,
      taskDetail: null,
      canManageTasks: false,
      taskAssignees: [],
      agentInstances: [],
      demo: { ...invited, state: "READY", project_id: PROJECT, invited: false },
    };
    const model = deriveShell(snapshot);
    assert.equal(model.status, "ready");
    if (model.status !== "ready") {
      return;
    }
    assert.deepEqual(
      model.projects.map((project) => project.demo),
      [true, false],
    );
    assert.equal(model.demo.state, "READY");
    assert.equal(model.demo.projectId, PROJECT);
    const without = deriveShell({ ...snapshot, demo: undefined });
    assert.equal(without.status === "ready" && without.demo.state, "NONE");
  });

  it("keeps the invitation's words as the product owner set them", () => {
    const source = readFileSync("apps/web/src/demo-invitation.tsx", "utf8");
    assert.equal(DEMO_COPY.title, "Experience Audit Workforce in action");
    assert.equal(DEMO_COPY.explore, "Explore demo");
    assert.equal(DEMO_COPY.own, "Start my own engagement");
    assert.match(source, /DEMO_COPY\.note/);
    assert.match(DEMO_COPY.note, /separate from your own engagements/);
  });
});
