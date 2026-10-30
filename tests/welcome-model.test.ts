import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  demoWrite,
  ENTERPRISE_INCLUDES,
  PRICING_QUESTIONS,
  parseLibrarySummary,
  parseWelcomeNotice,
  TRIAL_DAYS,
  TRIAL_INCLUDES,
  welcomeNoticeFor,
} from "../apps/web/src/welcome-model.ts";

describe("the landing page's demo request", () => {
  it("accepts a name and a work email and trims the rest", () => {
    const write = demoWrite({
      name: "  Dana Ruiz ",
      email: "dana@firm.example",
      firm: "Firm LLP",
      message: " We run forty engagements. ",
      website: "",
    });
    assert.deepEqual(write, {
      body: {
        name: "Dana Ruiz",
        email: "dana@firm.example",
        firm: "Firm LLP",
        message: "We run forty engagements.",
        website: "",
      },
    });
  });

  it("refuses a missing name, a bad email, or a credential", () => {
    assert.deepEqual(demoWrite({ email: "dana@firm.example" }), {
      error: "invalid",
    });
    assert.deepEqual(demoWrite({ name: "Dana", email: "dana" }), {
      error: "invalid",
    });
    assert.deepEqual(
      demoWrite({
        name: "Dana",
        email: "dana@firm.example",
        message: "api_key: sk-123",
      }),
      { error: "invalid" },
    );
  });

  it("leads the message with the primary focus, and only a listed one", () => {
    const write = demoWrite({
      name: "Dana",
      email: "dana@firm.example",
      focus: "IT SOX / ITGC",
    });
    assert.ok(!("error" in write));
    assert.equal(write.body.message, "Primary focus: IT SOX / ITGC");
    const both = demoWrite({
      name: "Dana",
      email: "dana@firm.example",
      focus: "Internal audit",
      message: "Forty engagements.",
    });
    assert.ok(!("error" in both));
    assert.equal(
      both.body.message,
      "Primary focus: Internal audit\n\nForty engagements.",
    );
    assert.deepEqual(
      demoWrite({ name: "Dana", email: "dana@firm.example", focus: "Taxes" }),
      { error: "invalid" },
    );
  });

  it("maps the API's answer to what the page says", () => {
    assert.equal(welcomeNoticeFor(201), "sent");
    assert.equal(welcomeNoticeFor(422), "invalid");
    assert.equal(welcomeNoticeFor(429), "busy");
    assert.equal(welcomeNoticeFor(0), "unavailable");
    assert.equal(parseWelcomeNotice("sent"), "sent");
    assert.equal(parseWelcomeNotice("nope"), null);
  });
});

describe("the landing page's library figures", () => {
  it("reads them from the API and refuses anything implausible", () => {
    assert.deepEqual(
      parseLibrarySummary({ version: 3, controls: 53, areas: 14, agents: 8 }),
      { controls: 53, areas: 14, agents: 8 },
    );
    for (const bad of [
      null,
      { controls: "53", areas: 14, agents: 8 },
      { controls: 0, areas: 14, agents: 8 },
    ]) {
      assert.equal(parseLibrarySummary(bad), null);
    }
  });
});

describe("the landing page's pricing", () => {
  it("offers a seven-day trial and never promises another length", () => {
    assert.equal(TRIAL_DAYS, 7);
    const words = [
      ...TRIAL_INCLUDES,
      ...ENTERPRISE_INCLUDES,
      ...PRICING_QUESTIONS.flatMap((item) => [item.q, item.a]),
    ].join(" ");
    assert.match(words, /What happens after 7 days\?/);
    for (const days of words.matchAll(/(\d+)[ -]days?/g)) {
      assert.equal(Number(days[1]), TRIAL_DAYS);
    }
    // The trial's limits as the product owner set them (28 October 2026).
    assert.deepEqual(TRIAL_INCLUDES.slice(0, 4), [
      "1 active engagement",
      "Up to 5 controls",
      "1 system",
      "1 user",
    ]);
    assert.ok(TRIAL_INCLUDES.includes("10 evidence uploads"));
  });

  it("keeps the product's neutral voice", () => {
    const answers = PRICING_QUESTIONS.map((item) => item.a).join(" ");
    assert.doesNotMatch(answers, /\b(I|I'll|I'm|me|my)\b/);
  });
});
