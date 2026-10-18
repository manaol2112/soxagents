import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  clientKey,
  clientNamed,
  nextPeriodEnd,
  parseClients,
  periodNotAfter,
  rollforwardSources,
} from "../apps/web/src/client-model.ts";
import { noticeForStatus, projectWrite } from "../apps/web/src/project-form.ts";

const organizationId = "11111111-1111-7111-8111-111111111111";
const ownerId = "22222222-2222-7222-8222-222222222222";
const clientId = "44444444-4444-7444-8444-444444444444";
const earlier = "55555555-5555-7555-8555-555555555555";

const listed = [
  {
    id: clientId,
    name: "Eladriel Corp",
    version: 2,
    engagements: [
      {
        id: earlier,
        name: "2027 SOX Audit",
        status: "ACTIVE",
        period_end: "2027-12-31",
        launched: true,
      },
    ],
  },
];

describe("clients", () => {
  it("reads the firm's clients and their engagements", () => {
    const clients = parseClients(listed);
    assert.ok(clients !== null);
    assert.equal(clients[0]?.engagements[0]?.periodEnd, "2027-12-31");
    assert.equal(clients[0]?.engagements[0]?.launched, true);
    assert.equal(parseClients([{ id: clientId }]), null);
    assert.equal(parseClients({}), null);
  });

  it("knows a client however its name is written", () => {
    const clients = parseClients(listed) ?? [];
    assert.equal(clientKey("  ELADRIEL   corp "), "eladriel corp");
    assert.equal(clientNamed(clients, "eladriel  CORP")?.id, clientId);
    assert.equal(clientNamed(clients, "Eladriel"), undefined);
    assert.equal(clientNamed(clients, "   "), undefined);
    assert.equal(rollforwardSources(clients[0]).length, 1);
    assert.deepEqual(rollforwardSources(undefined), []);
  });
});

describe("a new engagement for a client", () => {
  const create = (fields: Record<string, string>) =>
    projectWrite({
      intent: "create",
      organization_id: organizationId,
      name: "SOX FY28",
      owner_user_id: ownerId,
      status: "DRAFT",
      ...fields,
    });

  it("sends the client picked and the engagement it starts from", () => {
    const write = create({
      client_id: clientId,
      client_name: "Eladriel Corp",
      rollforward_from: earlier,
    });
    assert.ok(!("error" in write));
    assert.equal(write.body.client_id, clientId);
    assert.equal(write.body.rollforward_from, earlier);
    // The identifier keeps the client's name, so two clients can both have "SOX FY28".
    assert.equal(write.body.slug, "eladriel-corp-sox-fy28");
  });

  it("sends a new client by name, starting fresh", () => {
    const write = create({ client_name: " Rosa Corp " });
    assert.ok(!("error" in write));
    assert.equal(write.body.client_id, null);
    assert.equal(write.body.rollforward_from, null);
    assert.equal(write.body.client_name, "Rosa Corp");
  });

  it("refuses a start without a client, or ids that are not ids", () => {
    assert.deepEqual(create({ rollforward_from: earlier }), {
      error: "invalid",
    });
    assert.deepEqual(create({ client_id: "eladriel" }), { error: "invalid" });
    assert.deepEqual(
      create({ client_id: clientId, rollforward_from: "last-year" }),
      { error: "invalid" },
    );
  });

  it("says why a start from another client's engagement was refused", () => {
    assert.equal(
      noticeForStatus(
        422,
        "an engagement rolls forward from its own client's",
        "create",
      ),
      "rollforward",
    );
  });

  it("edits the client by id when the form picked one", () => {
    const write = projectWrite({
      intent: "details",
      organization_id: organizationId,
      project_id: earlier,
      version: "3",
      name: "SOX FY28",
      owner_user_id: ownerId,
      client_id: clientId,
      client_name: "Eladriel Corp",
    });
    assert.ok(!("error" in write));
    assert.equal(write.body.client_id, clientId);
  });
});

describe("the period a roll-forward proposes", () => {
  it("is a year after the earlier engagement's", () => {
    assert.equal(nextPeriodEnd("2026-12-31"), "2027-12-31");
    assert.equal(nextPeriodEnd("2027-06-30"), "2028-06-30");
    // A leap day lands on the last day of February.
    assert.equal(nextPeriodEnd("2028-02-29"), "2029-02-28");
    assert.equal(nextPeriodEnd("2027-02-28"), "2028-02-28");
    assert.equal(nextPeriodEnd("31/12/2026"), null);
    assert.equal(nextPeriodEnd("2026-13-01"), null);
  });

  it("warns when the period end is not after the earlier one", () => {
    assert.equal(periodNotAfter("2026-12-31", "2026-12-31"), true);
    assert.equal(periodNotAfter("2026-06-30", "2026-12-31"), true);
    assert.equal(periodNotAfter("2027-12-31", "2026-12-31"), false);
    assert.equal(periodNotAfter("", "2026-12-31"), false);
    assert.equal(periodNotAfter("2026-12-31", null), false);
  });
});
