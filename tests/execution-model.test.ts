import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executionOf,
  NO_AUTOMATION,
  parseAutomation,
} from "../apps/web/src/execution-model.ts";

const local = { available: true, provider: "local", detail: "" } as const;

describe("agent execution states", () => {
  it("reads the automation status and treats an unknown one as unavailable", () => {
    assert.deepEqual(
      parseAutomation({ available: true, provider: "local", detail: "x" }),
      {
        available: true,
        provider: "local",
        detail: "x",
      },
    );
    assert.equal(parseAutomation({ provider: "local" }), null);
    assert.equal(parseAutomation(null), null);
    assert.equal(NO_AUTOMATION.available, false);
  });

  it("says running only when a run record is active and a worker exists", () => {
    assert.equal(
      executionOf({ agent: "tester", run: "RUNNING", automation: local }).state,
      "RUNNING",
    );
    assert.equal(
      executionOf({ agent: "tester", run: "QUEUED", automation: local }).state,
      "QUEUED",
    );
    const queuedNoWorker = executionOf({
      agent: "tester",
      run: "QUEUED",
      automation: null,
    });
    assert.equal(queuedNoWorker.state, "UNAVAILABLE");
    assert.match(
      queuedNoWorker.detail,
      /no agent worker is configured, so it will not start/,
    );
    // A working lease with no worker is still not "running": nothing will finish it.
    assert.equal(
      executionOf({
        agent: "reviewer",
        run: "RUNNING",
        automation: { ...local, available: false },
      }).state,
      "UNAVAILABLE",
    );
  });

  it("distinguishes ready, completed and failed", () => {
    assert.equal(
      executionOf({ agent: "tester", run: "IDLE", automation: local }).state,
      "READY",
    );
    assert.equal(
      executionOf({ agent: "tester", run: "IDLE", automation: null }).label,
      "Ready; no worker",
    );
    assert.equal(
      executionOf({
        agent: "tester",
        run: "IDLE",
        automation: local,
        done: true,
      }).state,
      "COMPLETED",
    );
    const failed = executionOf({
      agent: "drafter",
      run: "IDLE",
      automation: local,
      failed: true,
    });
    assert.equal(failed.state, "FAILED");
    assert.match(
      failed.detail,
      /stopped before finishing; a person runs it again/,
    );
  });
});
