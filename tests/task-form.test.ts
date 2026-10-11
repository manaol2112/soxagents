import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { noticeForStatus, taskWrite } from "../apps/web/src/task-form.ts";

const organizationId = "11111111-1111-7111-8111-111111111111";
const projectId = "22222222-2222-7222-8222-222222222222";
const taskId = "33333333-3333-7333-8333-333333333333";
const otherId = "44444444-4444-7444-8444-444444444444";

function fields(extra: Record<string, string> = {}): Record<string, string> {
  return {
    intent: "create",
    organization_id: organizationId,
    project_id: projectId,
    title: "Collect population",
    description: "Prepare the sample.",
    priority: "HIGH",
    deadline: "2026-12-31",
    assignee_user_id: "",
    agent_instance_id: "",
    status: "DRAFT",
    blocker: "",
    escalation: "",
    cancellation_reason: "",
    max_retries: "1",
    artifact_refs: "evidence/population",
    ...extra,
  };
}

describe("task form", () => {
  it("builds a task and keeps a deadline in UTC", () => {
    const created = taskWrite(fields(), [otherId]);
    assert.equal("error" in created, false);
    if (!("error" in created)) {
      assert.equal(created.method, "POST");
      assert.equal(created.body.deadline, "2026-12-31T00:00:00Z");
      assert.deepEqual(created.body.depends_on_task_ids, [otherId]);
    }
    assert.equal(
      noticeForStatus(409, "task dependency is not allowed"),
      "dependency",
    );
  });

  it("cancels with a reason and reactivates only as its own operation", () => {
    const cancelled = taskWrite(
      fields({
        intent: "cancel",
        task_id: taskId,
        version: "3",
        status: "FAILED",
        cancellation_reason: "Scope changed",
      }),
      [],
    );
    assert.equal("error" in cancelled, false);
    if (!("error" in cancelled)) {
      assert.equal(cancelled.body.operation, "cancel");
    }
    const missingReason = taskWrite(
      fields({ intent: "cancel", task_id: taskId, version: "3" }),
      [],
    );
    assert.deepEqual(missingReason, { error: "invalid" });
    const restored = taskWrite(
      fields({
        intent: "reactivate",
        task_id: taskId,
        version: "4",
        status: "CANCELLED",
      }),
      [],
    );
    assert.equal("error" in restored, false);
    if (!("error" in restored)) {
      assert.equal(restored.body.operation, "reactivate");
    }
  });
});
