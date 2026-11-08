import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AGENT_SAYS,
  AGENT_STATE_LABEL,
  agentStateOf,
  avatarDetail,
  clickableAt,
  nextReaction,
} from "../apps/web/src/agent-avatar-model.ts";

describe("the agent's look by what it is doing", () => {
  it("thinks while queued, works while running, celebrates when done", () => {
    assert.equal(agentStateOf("PENDING"), "thinking");
    assert.equal(agentStateOf("working"), "working");
    assert.equal(agentStateOf("RUNNING"), "working");
    assert.equal(agentStateOf("DONE"), "done");
  });

  it("asks for the person when a run fails or waits on them", () => {
    assert.equal(agentStateOf("FAILED"), "attention");
    assert.equal(agentStateOf("NEEDS_INPUT"), "attention");
    assert.equal(agentStateOf("SETUP_REQUIRED"), "attention");
  });

  it("is ready when the status names nothing it knows", () => {
    assert.equal(agentStateOf(undefined), "idle");
    assert.equal(agentStateOf(""), "idle");
    assert.equal(agentStateOf("SOMETHING_NEW"), "idle");
  });

  it("reads its state in words, and drops fine detail at small sizes", () => {
    assert.equal(AGENT_STATE_LABEL.attention, "needs you");
    assert.equal(avatarDetail(18), "compact");
    assert.equal(avatarDetail(64), "full");
  });
});

describe("the agent, clicked", () => {
  it("says what it is doing, in its state's words", () => {
    assert.match(AGENT_SAYS.working, /^Working on this now/);
    assert.match(AGENT_SAYS.attention, /details are needed/);
    // The product's neutral voice: no agent first person.
    for (const line of Object.values(AGENT_SAYS)) {
      assert.doesNotMatch(line, /(I|I'm|I'll|me|my)/);
    }
  });

  it("reacts in turn: a hop, a wink, a little love, a spin, then again", () => {
    assert.deepEqual([0, 1, 2, 3, 4].map(nextReaction), [
      "hop",
      "wink",
      "love",
      "spin",
      "hop",
    ]);
  });

  it("is its own button only when large enough to stand alone", () => {
    assert.equal(clickableAt(20), false);
    assert.equal(clickableAt(40), true);
  });
});
