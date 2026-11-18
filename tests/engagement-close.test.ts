import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canCloseOut,
  closedNotice,
  detailsEditable,
  ENGAGEMENT_STATUSES,
  engagementPhase,
  hasLaunched,
  isClosed,
  parseCompletion,
  requestsClosedReason,
  scopeOpen,
  setupHeadAction,
  setupOpen,
  statusActions,
  statusAfter,
  statusLabel,
  statusOrder,
} from "../apps/web/src/engagement-lifecycle.ts";
import { setupNoticeFor } from "../apps/web/src/onboarding-model.ts";
import { noticeForStatus, projectWrite } from "../apps/web/src/project-form.ts";

const organizationId = "11111111-1111-7111-8111-111111111111";
const projectId = "33333333-3333-7333-8333-333333333333";
const ids = {
  organization_id: organizationId,
  project_id: projectId,
  version: "7",
};

describe("completed engagements", () => {
  it("are read-only, launched, and lead to the dashboard", () => {
    const phase = engagementPhase({
      status: "COMPLETED",
      started: true,
      ready: true,
    });
    assert.equal(phase, "completed");
    assert.equal(isClosed("COMPLETED"), true);
    assert.equal(isClosed("PAUSED"), false);
    assert.equal(hasLaunched({ status: "COMPLETED", started: false }), true);
    assert.equal(setupOpen(phase), false);
    assert.equal(scopeOpen(phase), false);
    assert.equal(setupHeadAction(phase, true), "dashboard");
    assert.equal(detailsEditable("COMPLETED"), false);
    assert.match(closedNotice("COMPLETED") ?? "", /reopen/);
    assert.equal(closedNotice("ACTIVE"), null);
    assert.match(requestsClosedReason("COMPLETED") ?? "", /completed/);
  });

  it("are archived from settings, and reopened only by their own action", () => {
    assert.deepEqual(statusActions("COMPLETED"), ["archive"]);
    assert.equal(statusAfter("archive", "COMPLETED"), "ARCHIVED");
    assert.equal(statusAfter("update", "COMPLETED"), null);
    assert.equal(statusAfter("resume", "COMPLETED"), null);
    assert.equal(canCloseOut("OWNER"), true);
    assert.equal(canCloseOut("ADMIN"), true);
    assert.equal(canCloseOut("PROJECT_MANAGER"), false);
  });

  it("are one status in the shared list, sorted after the running work", () => {
    assert.deepEqual(
      ENGAGEMENT_STATUSES.map(([key]) => key),
      ["ACTIVE", "DRAFT", "PAUSED", "COMPLETED", "ARCHIVED"],
    );
    assert.equal(statusLabel("COMPLETED"), "Completed");
    assert.ok(statusOrder("COMPLETED") > statusOrder("ACTIVE"));
    assert.ok(statusOrder("UNKNOWN") > statusOrder("ARCHIVED"));
  });
});

describe("completion state", () => {
  it("reads what is still open and the reopenings", () => {
    const parsed = parseCompletion({
      status: "ACTIVE",
      version: 4,
      can_complete: false,
      open_count: 2,
      open_items: [
        { kind: "TEST", label: "AC-01: test not signed off", control_id: "c1" },
        { kind: "RUNNING", label: "Agent still working: x", control_id: null },
      ],
      completed_at: null,
      completed_by: "",
      reopenings: [
        {
          reason: "Retest",
          reopened_by: "Dana",
          reopened_at: "2027-01-02T10:00:00Z",
        },
      ],
      deletable: false,
    });
    assert.ok(parsed !== null);
    assert.equal(parsed.openItems[0]?.controlId, "c1");
    assert.equal(parsed.openItems[1]?.controlId, null);
    assert.equal(parsed.reopenings[0]?.reopenedBy, "Dana");
    assert.equal(
      parseCompletion({ status: "ACTIVE", version: 1, can_complete: true }),
      null,
    );
    assert.equal(
      parseCompletion({
        status: "ACTIVE",
        version: 1,
        can_complete: true,
        open_count: 1,
        open_items: [{ kind: "SOMETHING", label: "x" }],
        reopenings: [],
        deletable: false,
      }),
      null,
    );
  });
});

describe("close-out actions", () => {
  it("complete, reopen with a reason, and delete with the name typed", () => {
    const complete = projectWrite({ ...ids, intent: "complete" });
    assert.ok(!("error" in complete));
    assert.equal(
      complete.path,
      `/organizations/${organizationId}/projects/${projectId}/complete`,
    );
    assert.deepEqual(complete.body, { version: 7 });
    const reopen = projectWrite({
      ...ids,
      intent: "reopen",
      reason: "  Client sent   a new listing ",
    });
    assert.ok(!("error" in reopen));
    assert.deepEqual(reopen.body, {
      version: 7,
      reason: "Client sent a new listing",
    });
    assert.deepEqual(projectWrite({ ...ids, intent: "reopen", reason: "x" }), {
      error: "invalid",
    });
    const remove = projectWrite({
      ...ids,
      intent: "delete",
      confirm_name: " SOX 2027 ",
    });
    assert.ok(!("error" in remove));
    assert.deepEqual(remove.body, { version: 7, name: "SOX 2027" });
    assert.deepEqual(projectWrite({ ...ids, intent: "delete" }), {
      error: "invalid",
    });
    assert.deepEqual(
      projectWrite({ ...ids, version: "0", intent: "complete" }),
      { error: "invalid" },
    );
  });

  it("say what happened and why a refusal came", () => {
    assert.equal(noticeForStatus(200, "", "complete"), "completed-done");
    assert.equal(noticeForStatus(200, "", "reopen"), "reopened");
    assert.equal(noticeForStatus(200, "", "delete"), "deleted");
    assert.equal(
      noticeForStatus(409, "work is still open", "complete"),
      "open-work",
    );
    assert.equal(
      noticeForStatus(409, "a launched engagement is not deleted", "delete"),
      "launched",
    );
    assert.equal(
      noticeForStatus(409, "engagement has work on record", "delete"),
      "work-on-record",
    );
    assert.equal(
      noticeForStatus(409, "setup work is still running", "delete"),
      "setup-running",
    );
    assert.equal(
      noticeForStatus(
        409,
        "the engagement is completed; reopen it to change it",
        "update",
      ),
      "completed",
    );
    assert.equal(noticeForStatus(422, "reason is invalid", "reopen"), "reason");
    assert.equal(
      noticeForStatus(422, "name does not match", "delete"),
      "delete-name",
    );
    assert.equal(noticeForStatus(403, "not allowed", "reopen"), "denied");
    assert.equal(
      setupNoticeFor(
        "profile",
        409,
        "engagement is not active: it is completed and read-only",
      ),
      "setup-completed",
    );
    assert.equal(
      setupNoticeFor(
        "profile",
        409,
        "engagement is not active: it is archived and read-only",
      ),
      "setup-archived",
    );
  });
});
