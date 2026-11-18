import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  noticeForStatus,
  projectWrite,
  slugFor,
} from "../apps/web/src/project-form.ts";

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
      assert.equal(created.body.engagement_type, "SOX_FULL");
      assert.equal(created.body.client_name, "");
    }
    // The guided form has no slug field: it comes from the name, with the profile.
    const guided = projectWrite({
      intent: "create",
      organization_id: organizationId,
      name: "SOX FY27 Acme Corp.",
      client_name: " Acme Corp ",
      engagement_type: "SOX_FULL",
      period_end: "2027-12-31",
      owner_user_id: ownerId,
      status: "DRAFT",
    });
    assert.ok(!("error" in guided));
    // The client is part of the identifier: another client may use the same name.
    assert.equal(guided.body.slug, "acme-corp-sox-fy27-acme-corp");
    const other = projectWrite({
      intent: "create",
      organization_id: organizationId,
      name: "SOX FY27 Acme Corp.",
      client_name: "Globex",
      owner_user_id: ownerId,
    });
    assert.ok(!("error" in other));
    assert.equal(other.body.slug, "globex-sox-fy27-acme-corp");
    assert.equal(
      slugFor("SOX FY 2027", "Contoso Ltd"),
      "contoso-ltd-sox-fy-2027",
    );
    assert.equal(guided.body.client_name, "Acme Corp");
    assert.equal(guided.body.engagement_type, "SOX_FULL");
    assert.equal(guided.body.period_end, "2027-12-31");
    assert.equal(slugFor("  Ünïcode & Co  "), "unicode-co");
    assert.deepEqual(
      projectWrite({
        intent: "create",
        organization_id: organizationId,
        name: "SOX",
        engagement_type: "SOMETHING",
        owner_user_id: ownerId,
      }),
      { error: "invalid" },
    );
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
