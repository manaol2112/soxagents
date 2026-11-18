import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aiAllowanceReached,
  dollars,
  megabytes,
  onTrialPlan,
  parseTrialUsage,
  standing,
  usageHref,
  usageMeters,
} from "../apps/web/src/trial-usage-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";

const answer = {
  state: "TRIAL",
  plan_type: "TRIAL",
  trial_started_at: "2026-10-29T10:00:00Z",
  trial_expires_at: "2026-11-05T10:00:00Z",
  days_left: 5,
  writable: true,
  limits: {
    engagements: 1,
    systems: 1,
    controls: 5,
    members: 1,
    uploads: 10,
    upload_bytes: 250_000_000,
    ai_budget_micros: 5_000_000,
    ai_run_limit: 20,
    ai_concurrent_runs: 1,
    ai_run_seconds: 600,
  },
  usage: {
    engagements: 1,
    systems: 1,
    controls: 3,
    members: 1,
    uploads: 4,
    upload_bytes: 4_200_000,
    ai_spent_micros: 1_200_000,
    ai_reserved_micros: 0,
    ai_runs: 6,
    ai_active_runs: 0,
  },
};

describe("the trial's usage as the server says it stands", () => {
  it("reads the answer and refuses a malformed one", () => {
    const usage = parseTrialUsage(answer);
    assert.ok(usage);
    assert.equal(usage.daysLeft, 5);
    assert.equal(usage.limits.aiBudgetMicros, 5_000_000);
    assert.equal(usage.usage.aiSpentMicros, 1_200_000);
    assert.equal(parseTrialUsage(null), null);
    assert.equal(parseTrialUsage({ state: "TRIAL" }), null);
    assert.equal(
      parseTrialUsage({ ...answer, limits: { engagements: null }, usage: {} })
        ?.limits.engagements,
      null,
    );
  });

  it("gives each allowance a meter with the server's figures", () => {
    const usage = parseTrialUsage(answer);
    assert.ok(usage);
    const meters = usageMeters(usage);
    const by = Object.fromEntries(meters.map((m) => [m.key, m]));
    assert.equal(by.ai?.words, "$1.20 of $5.00 used");
    assert.equal(by.runs?.words, "6 of 20 used");
    assert.equal(by.engagements?.words, "1 of 1");
    assert.equal(by.controls?.words, "3 of 5");
    assert.equal(by.uploads?.words, "4 of 10 used");
    assert.equal(by.storage?.words, "4.2 MB of 250 MB used");
    assert.equal(by.members?.words, "1 of 1");
    assert.equal(by.engagements?.tone, "warning");
    assert.equal(
      usageMeters({
        ...usage,
        usage: { ...usage.usage, uploads: 10 },
      }).find((m) => m.key === "uploads")?.tone,
      "danger",
    );
    assert.equal(by.ai?.tone, "info");
    assert.equal(by.runs?.share, 0.3);
    // Without a limit the meter says what is in use and draws no bar.
    const unlimited = usageMeters({
      ...usage,
      limits: { ...usage.limits, controls: null },
    });
    assert.equal(
      unlimited.find((m) => m.key === "controls")?.words,
      "3 in use",
    );
    assert.equal(unlimited.find((m) => m.key === "controls")?.share, null);
    // Reserved spend counts while a run is in flight.
    const inFlight = usageMeters({
      ...usage,
      usage: { ...usage.usage, aiReservedMicros: 500_000, aiActiveRuns: 1 },
    });
    assert.equal(inFlight[0]?.words, "$1.70 of $5.00 used");
    assert.match(inFlight[0]?.note ?? "", /reserved/);
    assert.match(inFlight[1]?.note ?? "", /1 running now/);
  });

  it("knows when the AI allowance is spent and how the trial stands", () => {
    const usage = parseTrialUsage(answer);
    assert.ok(usage);
    assert.equal(aiAllowanceReached(usage), false);
    assert.equal(
      aiAllowanceReached({
        ...usage,
        usage: { ...usage.usage, aiSpentMicros: 5_000_000 },
      }),
      true,
    );
    assert.equal(
      aiAllowanceReached({ ...usage, usage: { ...usage.usage, aiRuns: 20 } }),
      true,
    );
    assert.equal(standing(usage).title, "Free trial");
    assert.match(standing(usage).detail, /5 days left/);
    assert.equal(standing(usage).tone, "info");
    assert.equal(standing({ ...usage, daysLeft: 1 }).tone, "warning");
    const ended = standing({ ...usage, state: "TRIAL_EXPIRED", daysLeft: 0 });
    assert.equal(ended.title, "Free trial ended");
    assert.equal(ended.tone, "danger");
    assert.equal(dollars(1_234_567), "$1.23");
    assert.equal(megabytes(250_000_000), "250 MB");
    assert.equal(megabytes(4_250_000), "4.3 MB");
    assert.match(usageHref(ORG, null), /section=settings&view=trial/);
    assert.match(usageHref(ORG, "p1"), /project=p1/);
    assert.equal(
      onTrialPlan({ state: "TRIAL", planType: "TRIAL", trialExpiresAt: null }),
      true,
    );
    assert.equal(
      onTrialPlan({ state: "ACTIVE", planType: "PAID", trialExpiresAt: null }),
      false,
    );
  });
});
