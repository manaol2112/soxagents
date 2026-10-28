import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  demoWrite,
  parseLibrarySummary,
  parseWelcomeNotice,
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
