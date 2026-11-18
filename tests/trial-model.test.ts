import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { noticeForStatus } from "../apps/web/src/project-form.ts";
import {
  deriveShell,
  type WorkspaceSnapshot,
} from "../apps/web/src/shell-model.ts";
import {
  daysLeft,
  PLANS_HREF,
  parseSubscription,
  refusalFrom,
  refusalWords,
  trialBadge,
  trialStrip,
} from "../apps/web/src/trial-model.ts";

const now = new Date("2026-10-28T12:00:00Z");
const inDays = (days: number) =>
  new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
const trial = (days: number, state = "TRIAL") => ({
  state,
  planType: "TRIAL",
  trialExpiresAt: inDays(days),
});

describe("the free trial as the API says it stands", () => {
  it("reads the subscription from an organization and defaults to unknown", () => {
    assert.deepEqual(
      parseSubscription({
        subscription_state: "TRIAL",
        plan_type: "TRIAL",
        trial_expires_at: "2026-11-04T09:00:00Z",
      }),
      {
        state: "TRIAL",
        planType: "TRIAL",
        trialExpiresAt: "2026-11-04T09:00:00Z",
      },
    );
    assert.deepEqual(parseSubscription({ id: "x", trial_expires_at: "soon" }), {
      state: "NONE",
      planType: "TRIAL",
      trialExpiresAt: null,
    });
  });

  it("counts a started day and never goes below zero", () => {
    assert.equal(daysLeft(trial(6.5), now), 7);
    assert.equal(daysLeft(trial(0.2), now), 1);
    assert.equal(daysLeft(trial(-3), now), 0);
    assert.equal(
      daysLeft(
        { state: "ACTIVE", planType: "INTERNAL", trialExpiresAt: null },
        now,
      ),
      null,
    );
  });

  it("shows the badge to a trial firm only, warning as the end nears", () => {
    assert.deepEqual(trialBadge(trial(6.5), now), {
      kind: "Free trial",
      detail: "7 days left",
      tone: "info",
      title: "The free trial has 7 days left. Explore plans.",
    });
    assert.equal(trialBadge(trial(1.5), now)?.detail, "2 days left");
    assert.equal(trialBadge(trial(1.5), now)?.tone, "warning");
    assert.equal(trialBadge(trial(0.9), now)?.detail, "1 day left");
    assert.equal(trialBadge(trial(-0.1), now)?.detail, "ends today");
    assert.deepEqual(trialBadge(trial(-1, "TRIAL_EXPIRED"), now), {
      kind: "Free trial",
      detail: "ended",
      tone: "warning",
      title: "The free trial has ended. Explore plans to keep working.",
    });
    assert.equal(
      trialBadge(
        { state: "ACTIVE", planType: "INTERNAL", trialExpiresAt: null },
        now,
      ),
      null,
    );
    assert.equal(
      trialBadge(
        { state: "ACTIVE", planType: "PAID", trialExpiresAt: null },
        now,
      ),
      null,
    );
  });

  it("puts a strip above every page only while nothing may change", () => {
    assert.equal(trialStrip(trial(3)), null);
    assert.match(
      trialStrip(trial(-1, "TRIAL_EXPIRED")) ?? "",
      /^Your free trial has ended\./,
    );
    assert.match(
      trialStrip({
        state: "SUSPENDED",
        planType: "PAID",
        trialExpiresAt: null,
      }) ?? "",
      /suspended/,
    );
    assert.equal(
      trialStrip({ state: "ACTIVE", planType: "PAID", trialExpiresAt: null }),
      null,
    );
  });
});

describe("a change the subscription refused", () => {
  it("is read from the API's 402 and nothing else", () => {
    assert.deepEqual(
      refusalFrom(402, {
        detail: "trial limit reached: controls",
        code: "TRIAL_LIMIT",
        resource: "controls",
        used: 5,
        allowed: 5,
      }),
      { kind: "limit", resource: "controls", allowed: 5 },
    );
    assert.deepEqual(
      refusalFrom(402, {
        code: "SUBSCRIPTION_INACTIVE",
        state: "TRIAL_EXPIRED",
      }),
      { kind: "inactive", state: "TRIAL_EXPIRED" },
    );
    assert.equal(refusalFrom(409, { code: "TRIAL_LIMIT" }), null);
    assert.equal(refusalFrom(402, "no"), null);
  });

  it("says what the trial includes, in the firm's words", () => {
    assert.equal(
      refusalWords({ kind: "limit", resource: "engagements", allowed: 1 }),
      "The free trial includes one engagement. To add more, explore plans.",
    );
    assert.equal(
      refusalWords({ kind: "limit", resource: "controls", allowed: 5 }),
      "The free trial includes 5 controls. To add more, explore plans.",
    );
    assert.equal(
      refusalWords({
        kind: "limit",
        resource: "storage",
        allowed: 250_000_000,
      }),
      "The free trial includes 250 MB of stored documents. To store more, explore plans.",
    );
    assert.match(
      refusalWords({ kind: "inactive", state: "TRIAL_EXPIRED" }),
      /^Your free trial has ended\./,
    );
    assert.match(
      refusalWords({ kind: "limit", resource: "subscription", allowed: 0 }),
      /more than the free trial includes/,
    );
  });

  it("maps the engagement form's 402 to its notice", () => {
    assert.equal(
      noticeForStatus(402, "trial limit reached: engagements"),
      "trial-limit",
    );
    assert.equal(
      noticeForStatus(402, "subscription inactive: the free trial has ended"),
      "trial-ended",
    );
    assert.equal(noticeForStatus(201, "", "create"), "saved");
  });

  it("keeps the product's neutral voice and points at the plans", () => {
    const words = [
      trialBadge(trial(3), now)?.title ?? "",
      trialStrip(trial(-1, "TRIAL_EXPIRED")) ?? "",
      refusalWords({ kind: "limit", resource: "systems", allowed: 1 }),
    ].join(" ");
    assert.doesNotMatch(words, /\b(I|I'll|I'm|me|my|we|let's)\b/);
    assert.equal(PLANS_HREF, "/welcome#pricing");
  });
});

describe("the shell carries the firm's subscription", () => {
  const organization = {
    id: "11111111-1111-7111-8111-111111111111",
    name: "Firm",
    slug: "firm",
    role: "OWNER",
    subscription_state: "TRIAL",
    plan_type: "TRIAL",
    trial_expires_at: "2026-11-04T09:00:00Z",
  };
  const snapshot: WorkspaceSnapshot = {
    meStatus: 200,
    me: { id: "user-1", email: "owner@example.com" },
    organizationsStatus: 200,
    organizations: [organization],
    projectsStatus: 200,
    projects: [],
    requestedOrganizationId: organization.id,
    requestedProjectId: null,
    requestedSection: "overview",
    notifications: "empty",
    canManageProjects: false,
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
  };

  it("from the organizations list to the ready model", () => {
    const model = deriveShell(snapshot);
    assert.equal(model.status, "ready");
    if (model.status === "ready") {
      assert.deepEqual(model.organization.subscription, {
        state: "TRIAL",
        planType: "TRIAL",
        trialExpiresAt: "2026-11-04T09:00:00Z",
      });
    }
  });
});

describe("the trial's styles and placement", () => {
  it("use tokens only, are loaded, and sit in the top bar and above the page", () => {
    const css = readFileSync("apps/web/app/trial.css", "utf8");
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
    assert.match(css, /\.trial-badge\.tone-warning/);
    assert.match(css, /@media \(max-width: 640px\)/);
    assert.match(
      readFileSync("apps/web/app/layout.tsx", "utf8"),
      /import "\.\/trial\.css";/,
    );
    const view = readFileSync("apps/web/src/workspace-view.tsx", "utf8");
    assert.match(
      view,
      /<TrialBadgeLink\s+subscription=\{model\.organization\.subscription\}/,
    );
    assert.match(view, /className="trial-strip" role="status"/);
  });
});

describe("the setup form's refusals", () => {
  it("map a 402 to the trial notices", async () => {
    const { setupNoticeFor } = await import(
      "../apps/web/src/onboarding-model.ts"
    );
    assert.equal(
      setupNoticeFor("add-system", 402, "trial limit reached: systems"),
      "trial-limit",
    );
    assert.equal(
      setupNoticeFor(
        "add-system",
        402,
        "subscription inactive: the free trial has ended",
      ),
      "trial-ended",
    );
  });
});
