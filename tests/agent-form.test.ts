import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agentWrite, noticeForStatus } from "../apps/web/src/agent-form.ts";

const organizationId = "11111111-1111-7111-8111-111111111111";
const agentId = "33333333-3333-7333-8333-333333333333";
const schema = '{"type":"object","properties":{}}';

function fields(extra: Record<string, string> = {}): Record<string, string> {
  return {
    intent: "create",
    organization_id: organizationId,
    agent_key: "evidence-request",
    name: "Evidence request",
    role: "Requests population files",
    description: "Asks for the listed evidence.",
    input_schema: schema,
    output_schema: schema,
    allowed_tool_ids: "mail.draft",
    model_config_ref: "audit-model",
    max_iterations: "4",
    time_budget_seconds: "600",
    status: "ACTIVE",
    ...extra,
  };
}

describe("agent form", () => {
  it("builds a definition and rejects a secret", () => {
    const created = agentWrite(fields());
    assert.equal("error" in created, false);
    if (!("error" in created)) {
      assert.equal(created.method, "POST");
      assert.equal(created.body.status, "ACTIVE");
    }
    const secret = agentWrite(
      fields({ description: "api_key=sk-live-should-not-persist" }),
    );
    assert.deepEqual(secret, { error: "secret" });
    assert.equal(noticeForStatus(409, "agent key is already in use"), "key");
  });

  it("maps disable onto the definition status", () => {
    const disabled = agentWrite(
      fields({
        intent: "disable",
        agent_id: agentId,
        version: "2",
        status: "ACTIVE",
      }),
    );
    assert.equal("error" in disabled, false);
    if (!("error" in disabled)) {
      assert.equal(disabled.method, "PATCH");
      assert.equal(disabled.body.status, "DISABLED");
      assert.equal(disabled.body.version, 2);
    }
  });
});
