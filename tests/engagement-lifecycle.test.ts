import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  archiveConsequence,
  canLaunch,
  detailsEditable,
  engagementPhase,
  hasLaunched,
  launchStepLabel,
  requestsClosedReason,
  scopeOpen,
  setupHeadAction,
  setupOpen,
  statusActions,
  statusAfter,
  statusMeaning,
} from "../apps/web/src/engagement-lifecycle.ts";
import {
  setupNoticeFor,
  setupProblem,
  setupWrite,
  systemNamed,
  systemNameKey,
  wizardProblem,
} from "../apps/web/src/onboarding-model.ts";
import { noticeForStatus, projectWrite } from "../apps/web/src/project-form.ts";

const organizationId = "11111111-1111-7111-8111-111111111111";
const ownerId = "22222222-2222-7222-8222-222222222222";
const projectId = "33333333-3333-7333-8333-333333333333";

describe("engagement lifecycle", () => {
  it("places the engagement from its status, kickoff, and readiness", () => {
    const at = (status: string, started: boolean, ready: boolean) =>
      engagementPhase({ status, started, ready });
    assert.equal(at("DRAFT", false, false), "setup");
    assert.equal(at("DRAFT", false, true), "ready");
    assert.equal(at("ACTIVE", true, true), "running");
    assert.equal(at("PAUSED", true, true), "paused");
    assert.equal(at("ARCHIVED", true, true), "closed");
    assert.equal(at("ARCHIVED", false, true), "closed");
    // A launched engagement is never offered the launch again, however setup reads.
    assert.equal(at("ACTIVE", true, false), "running");
    assert.equal(hasLaunched({ status: "ACTIVE", started: false }), true);
    assert.equal(hasLaunched({ status: "DRAFT", started: false }), false);
  });

  it("offers the launch once, and setup only before it", () => {
    assert.equal(canLaunch("ready"), true);
    for (const phase of ["setup", "running", "paused", "closed"] as const) {
      assert.equal(canLaunch(phase), false, phase);
    }
    assert.equal(setupOpen("setup"), true);
    assert.equal(setupOpen("ready"), true);
    assert.equal(setupOpen("running"), false);
    assert.equal(setupOpen("closed"), false);
    // Systems, controls, and the team stay open after launch, until it closes.
    assert.equal(scopeOpen("running"), true);
    assert.equal(scopeOpen("paused"), true);
    assert.equal(scopeOpen("closed"), false);
  });

  it("leads setup to the next thing, never back to the launch", () => {
    assert.equal(setupHeadAction("setup", false), "continue");
    assert.equal(setupHeadAction("ready", false), "launch");
    // On the launch step the launch is on the page: no link back to the same page.
    assert.equal(setupHeadAction("ready", false, true), null);
    assert.equal(setupHeadAction("setup", false, true), "continue");
    assert.equal(setupHeadAction("running", true, true), "dashboard");
    assert.equal(setupHeadAction("running", true), "dashboard");
    assert.equal(setupHeadAction("paused", true), "dashboard");
    assert.equal(setupHeadAction("closed", true), "dashboard");
    assert.equal(setupHeadAction("closed", false), null);
    assert.equal(launchStepLabel("ready"), "Review and launch");
    assert.equal(launchStepLabel("running"), "Launch summary");
    assert.equal(launchStepLabel("closed"), "Launch summary");
  });

  it("allows only the status changes the API allows", () => {
    assert.deepEqual(statusActions("DRAFT"), ["archive"]);
    assert.deepEqual(statusActions("ACTIVE"), ["pause", "archive"]);
    assert.deepEqual(statusActions("PAUSED"), ["resume", "archive"]);
    assert.deepEqual(statusActions("ARCHIVED"), []);
    assert.deepEqual(statusActions("UNKNOWN"), []);
    // Saving keeps the status; nothing activates a draft but the launch.
    assert.equal(statusAfter("update", "DRAFT"), "DRAFT");
    assert.equal(statusAfter("start", "DRAFT"), null);
    assert.equal(statusAfter("resume", "DRAFT"), null);
    assert.equal(statusAfter("pause", "DRAFT"), null);
    assert.equal(statusAfter("archive", "DRAFT"), "ARCHIVED");
    assert.equal(statusAfter("pause", "ACTIVE"), "PAUSED");
    assert.equal(statusAfter("resume", "PAUSED"), "ACTIVE");
    assert.equal(statusAfter("resume", "ACTIVE"), null);
    // Archived is closed: no action, not even saving the details.
    for (const intent of ["update", "resume", "archive", "pause"]) {
      assert.equal(statusAfter(intent, "ARCHIVED"), null, intent);
    }
    assert.equal(detailsEditable("ARCHIVED"), false);
    assert.equal(detailsEditable("PAUSED"), true);
  });

  it("explains each status and what archiving does", () => {
    assert.match(statusMeaning("DRAFT"), /launch it from setup/);
    assert.match(statusMeaning("ARCHIVED"), /Closed for good/);
    assert.match(archiveConsequence(true), /cannot be reopened/);
    assert.match(archiveConsequence(false), /never launched/);
    assert.equal(requestsClosedReason("ACTIVE"), null);
    assert.match(requestsClosedReason("DRAFT") ?? "", /launches/);
    assert.doesNotMatch(requestsClosedReason("ARCHIVED") ?? "", /reactivate/i);
  });
});

describe("engagement settings form", () => {
  const fields = (overrides: Record<string, string>) => ({
    organization_id: organizationId,
    project_id: projectId,
    version: "3",
    name: "SOX 2027",
    slug: "sox-2027",
    scope: "",
    owner_user_id: ownerId,
    ...overrides,
  });

  it("creates only drafts", () => {
    const create = { ...fields({}), intent: "create" };
    const draft = projectWrite({ ...create, status: "DRAFT" });
    assert.ok(!("error" in draft));
    assert.equal(draft.body.status, "DRAFT");
    assert.deepEqual(projectWrite({ ...create, status: "ACTIVE" }), {
      error: "invalid",
    });
  });

  it("keeps the status on save and refuses activating a draft", () => {
    const saved = projectWrite(fields({ intent: "update", status: "PAUSED" }));
    assert.ok(!("error" in saved));
    assert.equal(saved.body.status, "PAUSED");
    assert.deepEqual(
      projectWrite(fields({ intent: "start", status: "DRAFT" })),
      {
        error: "invalid",
      },
    );
    assert.deepEqual(
      projectWrite(fields({ intent: "update", status: "ARCHIVED" })),
      { error: "invalid" },
    );
    const archived = projectWrite(
      fields({ intent: "archive", status: "DRAFT" }),
    );
    assert.ok(!("error" in archived));
    assert.equal(archived.body.status, "ARCHIVED");
  });

  it("names the API's lifecycle refusals", () => {
    assert.equal(
      noticeForStatus(
        409,
        "launch the engagement from setup to make it active",
      ),
      "launch",
    );
    assert.equal(
      noticeForStatus(409, "the engagement is archived and cannot change"),
      "archived",
    );
  });
});

describe("setup refusals", () => {
  it("tells a second launch from a locked setup", () => {
    assert.equal(
      setupNoticeFor("launch", 409, "engagement has started"),
      "setup-already-launched",
    );
    assert.equal(
      setupNoticeFor("profile", 409, "engagement has started"),
      "setup-started",
    );
    assert.equal(
      setupNoticeFor("profile", 409, "engagement is archived"),
      "setup-archived",
    );
    assert.equal(
      setupNoticeFor("application", 409, "system is already in scope"),
      "setup-system-exists",
    );
    assert.equal(
      setupNoticeFor("control", 409, "control has testing on record"),
      "setup-control-tested",
    );
    assert.match(
      setupProblem("setup-control-tested") ?? "",
      /testing on record/,
    );
    assert.match(
      wizardProblem(409, "system is already in scope") ?? "",
      /already in scope/,
    );
  });

  it("never says a launch failed when it only took long to answer", () => {
    assert.equal(setupNoticeFor("launch", -1, ""), "setup-launch-slow");
    assert.equal(setupNoticeFor("approve", -1, ""), "setup-launch-slow");
    assert.equal(setupNoticeFor("profile", -1, ""), "setup-slow");
    // A failure that is one is still said as one.
    assert.equal(setupNoticeFor("launch", 0, ""), "setup-unavailable");
  });

  it("compares system names as the API does", () => {
    assert.equal(systemNameKey("  SAP   ERP "), "sap erp");
    const systems = [{ id: "a", name: "SAP ERP" }];
    assert.equal(systemNamed(systems, "sap  erp")?.id, "a");
    assert.equal(systemNamed(systems, "SAP"), undefined);
  });

  it("sends the acknowledgement for a tested control only when ticked", () => {
    const base = {
      organization_id: organizationId,
      project_id: projectId,
      intent: "control",
      control_id: "44444444-4444-7444-8444-444444444444",
      version: "2",
      owner_name: "",
      owner_email: "",
      frequency: "DAILY",
      nature: "MANUAL",
    };
    const plain = setupWrite(base, {});
    assert.ok(!("error" in plain));
    assert.equal(plain.body.acknowledge_testing, false);
    const acknowledged = setupWrite({ ...base, acknowledge_testing: "on" }, {});
    assert.ok(!("error" in acknowledged));
    assert.equal(acknowledged.body.acknowledge_testing, true);
  });
});
