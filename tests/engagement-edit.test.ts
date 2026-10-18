import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { noticeForStatus, projectWrite } from "../apps/web/src/project-form.ts";
import { parseProjectDetail } from "../apps/web/src/shell-model.ts";

const organizationId = "11111111-1111-7111-8111-111111111111";
const ownerId = "22222222-2222-7222-8222-222222222222";
const projectId = "33333333-3333-7333-8333-333333333333";

const form = (overrides: Record<string, string> = {}) => ({
  intent: "details",
  organization_id: organizationId,
  project_id: projectId,
  version: "4",
  name: " SOX FY28 ",
  client_name: " Acme Corp ",
  owner_user_id: ownerId,
  period_end: "2028-12-31",
  starts_on: "",
  ends_on: "",
  ...overrides,
});

describe("editing an engagement with its form", () => {
  it("saves the details in one request", () => {
    const write = projectWrite(
      form({ starts_on: "2028-01-10", ends_on: "2028-03-31" }),
    );
    assert.ok(!("error" in write));
    assert.equal(write.method, "PATCH");
    assert.equal(
      write.path,
      `/organizations/${organizationId}/projects/${projectId}/details`,
    );
    assert.deepEqual(write.body, {
      version: 4,
      name: "SOX FY28",
      owner_user_id: ownerId,
      client_id: null,
      client_name: "Acme Corp",
      period_end: "2028-12-31",
      starts_on: "2028-01-10",
      ends_on: "2028-03-31",
    });
    // Blank dates are cleared, not sent as text.
    const cleared = projectWrite(form({ period_end: "" }));
    assert.ok(!("error" in cleared));
    assert.equal(cleared.body.period_end, null);
  });

  it("refuses what the API would refuse", () => {
    for (const overrides of [
      { name: "  " },
      { version: "0" },
      { owner_user_id: "someone" },
      { period_end: "31/12/2028" },
      { starts_on: "2028-04-01", ends_on: "2028-03-01" },
      { client_name: "x".repeat(201) },
    ]) {
      assert.deepEqual(projectWrite(form(overrides)), { error: "invalid" });
    }
  });

  it("says why a launched engagement keeps its client and period", () => {
    assert.equal(
      noticeForStatus(
        409,
        "client and period end are locked after launch",
        "details",
      ),
      "locked",
    );
    assert.equal(noticeForStatus(200, "", "details"), "saved");
  });

  it("reads the profile on the engagement's detail", () => {
    const base = {
      id: projectId,
      name: "SOX FY28",
      slug: "acme-sox-fy28",
      scope: "",
      owner_user_id: ownerId,
      owner_name: "Dana",
      status: "ACTIVE",
      starts_on: null,
      ends_on: null,
      version: 4,
      progress: [],
      activity: [],
    };
    const detail = parseProjectDetail({
      ...base,
      client_name: "Acme Corp",
      period_end: "2028-12-31",
      launched: true,
    });
    assert.ok(detail !== null);
    assert.equal(detail.clientName, "Acme Corp");
    assert.equal(detail.periodEnd, "2028-12-31");
    assert.equal(detail.launched, true);
    // An older API without the profile still reads, as not launched and unset.
    const older = parseProjectDetail(base);
    assert.ok(older !== null);
    assert.equal(older.clientName, "");
    assert.equal(older.launched, false);
  });
});
