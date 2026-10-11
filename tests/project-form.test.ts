import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { noticeForStatus, projectWrite } from "../apps/web/src/project-form.ts";

const organizationId = "11111111-1111-7111-8111-111111111111";
const ownerId = "22222222-2222-7222-8222-222222222222";
const projectId = "33333333-3333-7333-8333-333333333333";

describe("project form", () => {
  it("builds a create request and rejects a bad slug", () => {
    const created = projectWrite({
      intent: "create",
      organization_id: organizationId,
      name: "SOX 2026",
      slug: "sox-2026",
      scope: "Access reviews",
      owner_user_id: ownerId,
      status: "DRAFT",
      starts_on: "",
      ends_on: "",
    });
    assert.equal("error" in created, false);
    if (!("error" in created)) {
      assert.equal(created.method, "POST");
      assert.equal(created.body.status, "DRAFT");
    }
    const invalid = projectWrite({
      intent: "create",
      organization_id: organizationId,
      name: "SOX 2026",
      slug: "SOX 2026",
      owner_user_id: ownerId,
    });
    assert.deepEqual(invalid, { error: "invalid" });
  });

  it("maps pause and archive onto the project status", () => {
    const paused = projectWrite({
      intent: "pause",
      organization_id: organizationId,
      project_id: projectId,
      version: "2",
      name: "SOX 2026",
      slug: "sox-2026",
      scope: "",
      owner_user_id: ownerId,
      status: "ACTIVE",
    });
    assert.equal("error" in paused, false);
    if (!("error" in paused)) {
      assert.equal(paused.method, "PATCH");
      assert.equal(paused.body.status, "PAUSED");
      assert.equal(paused.body.version, 2);
    }
    assert.equal(
      noticeForStatus(409, "project slug is already in use"),
      "slug",
    );
    assert.equal(noticeForStatus(409, "project changed"), "conflict");
  });
});
