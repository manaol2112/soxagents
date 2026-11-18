import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as chain from "../apps/web/src/tickmark-chain.ts";

// What one press of "Record" on a tickmark does (docs/evidence-assurance.md, section
// 10.15, items 1 and 2), run here with scripted answers: the tickmark, then the
// finding's dismissal, then the acceptance, each sent only once the one before it was
// confirmed. What must hold however the form looks: the order; nothing follows a
// tickmark that was refused; a refused dismissal stops the acceptance; nothing is sent
// for a box left unticked; no call is made twice; and an answer that did not arrive is
// said as not known, never as a failure and never as a success, with the list read
// again. The form (attribute-tickmark.tsx) runs this function and only draws what it
// says. Synthetic data only.

type Answer = chain.ChainAnswer | Error;

/** The row's three calls, scripted: each records that it was called, then answers. */
function scripted(answers: {
  record?: Answer;
  dismiss?: Answer;
  accept?: Answer;
}) {
  const sent: string[] = [];
  const said: string[] = [];
  let reread = 0;
  const call = (key: "record" | "dismiss" | "accept") => async () => {
    sent.push(key);
    // What was said before this call was answered, at the time it was sent.
    said.push(`sent ${key}`);
    const answer = answers[key] ?? chain.CONFIRMED;
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  };
  return {
    calls: {
      record: call("record"),
      dismiss: call("dismiss"),
      accept: call("accept"),
    },
    on: {
      say: (step: chain.ChainStep) => {
        said.push(`${step.key}:${step.state}`);
      },
      reread: () => {
        reread += 1;
      },
    },
    sent,
    said,
    rereads: () => reread,
  };
}

const BOTH = { dismiss: true, accept: true };
const lines = (end: chain.ChainEnd) =>
  end.steps.map((step) => `${step.key}:${step.state}:${step.text}`);
const refusal = "The finding changed; look again.";

describe("the chain a tickmark may carry", () => {
  it("sends the tickmark, then the dismissal, then the acceptance, each after the one before was confirmed", async () => {
    const run = scripted({});
    const end = await chain.tickmarkChain(run.calls, BOTH, run.on);
    assert.deepEqual(run.sent, ["record", "dismiss", "accept"]);
    // Each is said as done only after its own call was answered, and the next is sent
    // only after that.
    assert.deepEqual(run.said, [
      "sent record",
      "record:done",
      "dismiss:working",
      "sent dismiss",
      "dismiss:done",
      "accept:working",
      "sent accept",
      "accept:done",
    ]);
    assert.deepEqual(lines(end), [
      "record:done:Tickmark recorded.",
      "dismiss:done:Proposed finding dismissed, with this reason.",
      "accept:done:Evidence accepted.",
    ]);
    assert.deepEqual(end.record, { outcome: "confirmed" });
    assert.equal(run.rereads(), 0);
  });

  it("stops at a refused tickmark: nothing follows a tickmark that was not recorded", async () => {
    const run = scripted({
      record: chain.refusedWith("The check is out of date."),
    });
    const end = await chain.tickmarkChain(run.calls, BOTH, run.on);
    assert.deepEqual(run.sent, ["record"]);
    assert.deepEqual(lines(end), ["record:refused:The check is out of date."]);
    assert.deepEqual(end.record, {
      outcome: "refused",
      sentence: "The check is out of date.",
    });
    assert.equal(run.rereads(), 0);
  });

  it("stops before the acceptance on a refused dismissal, and says the tickmark stays", async () => {
    const run = scripted({ dismiss: chain.refusedWith(refusal) });
    const end = await chain.tickmarkChain(run.calls, BOTH, run.on);
    assert.deepEqual(run.sent, ["record", "dismiss"]);
    assert.deepEqual(lines(end), [
      "record:done:Tickmark recorded.",
      `dismiss:refused:The proposed finding was not dismissed. ${refusal} The tickmark stays.`,
      "accept:held:The evidence was not accepted, because the finding was not dismissed. Decide the finding, then accept from the summary.",
    ]);
    // Where the acceptance was not ticked, nothing is said of it.
    const alone = scripted({ dismiss: chain.refusedWith(refusal) });
    const only = await chain.tickmarkChain(
      alone.calls,
      { dismiss: true, accept: false },
      alone.on,
    );
    assert.deepEqual(alone.sent, ["record", "dismiss"]);
    assert.deepEqual(
      only.steps.map((step) => step.key),
      ["record", "dismiss"],
    );
  });

  it("says a refused acceptance in the server's sentence, closed, and that the tickmark stays", async () => {
    const run = scripted({
      accept: chain.refusedWith("Nothing has arrived for this item yet"),
    });
    const end = await chain.tickmarkChain(run.calls, BOTH, run.on);
    assert.deepEqual(run.sent, ["record", "dismiss", "accept"]);
    assert.equal(
      lines(end)[2],
      "accept:refused:The evidence was not accepted. Nothing has arrived for this item yet. The tickmark stays.",
    );
  });

  it("sends nothing for a box left unticked", async () => {
    const neither = scripted({});
    const end = await chain.tickmarkChain(
      neither.calls,
      { dismiss: false, accept: false },
      neither.on,
    );
    assert.deepEqual(neither.sent, ["record"]);
    assert.deepEqual(lines(end), ["record:done:Tickmark recorded."]);
    const accept = scripted({});
    await chain.tickmarkChain(
      accept.calls,
      { dismiss: false, accept: true },
      accept.on,
    );
    assert.deepEqual(accept.sent, ["record", "accept"]);
    const dismiss = scripted({});
    await chain.tickmarkChain(
      dismiss.calls,
      { dismiss: true, accept: false },
      dismiss.on,
    );
    assert.deepEqual(dismiss.sent, ["record", "dismiss"]);
  });

  it("never makes a call twice, whatever it answers", async () => {
    const answers: Answer[] = [
      chain.CONFIRMED,
      chain.refusedWith(refusal),
      chain.UNKNOWN,
      new Error("offline"),
    ];
    for (const record of answers) {
      for (const dismiss of answers) {
        for (const accept of answers) {
          const run = scripted({ record, dismiss, accept });
          await chain.tickmarkChain(run.calls, BOTH, run.on);
          assert.deepEqual(run.sent, [...new Set(run.sent)]);
          assert.deepEqual(
            run.sent,
            ["record", "dismiss", "accept"].slice(0, run.sent.length),
          );
        }
      }
    }
  });
});

describe("an answer that did not arrive", () => {
  it("is said as not known for the dismissal, never as a failure or a success; the list is read again and nothing is accepted", async () => {
    const run = scripted({ dismiss: chain.UNKNOWN });
    const end = await chain.tickmarkChain(run.calls, BOTH, run.on);
    assert.deepEqual(run.sent, ["record", "dismiss"]);
    assert.deepEqual(lines(end), [
      "record:done:Tickmark recorded.",
      "dismiss:unknown:The answer did not arrive, so it is not known whether the finding was dismissed. The list is read again.",
      "accept:held:The acceptance was not sent, because it is not known whether the finding was dismissed. Once the list shows where the finding stands, accept from the summary.",
    ]);
    assert.equal(run.rereads(), 1);
    for (const step of end.steps.slice(1)) {
      assert.equal(/was not dismissed|not accepted\b/.test(step.text), false);
      assert.equal(
        /dismissed, with this reason|Evidence accepted/.test(step.text),
        false,
      );
    }
  });

  it("is said as not known for the acceptance", async () => {
    const run = scripted({ accept: chain.UNKNOWN });
    const end = await chain.tickmarkChain(run.calls, BOTH, run.on);
    assert.deepEqual(run.sent, ["record", "dismiss", "accept"]);
    assert.equal(
      lines(end)[2],
      "accept:unknown:The answer did not arrive, so it is not known whether the evidence was accepted. The list is read again.",
    );
    assert.equal(run.rereads(), 1);
  });

  it("ends the chain where it is the tickmark's own: nothing follows a tickmark that is not confirmed", async () => {
    const run = scripted({ record: chain.UNKNOWN });
    const end = await chain.tickmarkChain(run.calls, BOTH, run.on);
    assert.deepEqual(run.sent, ["record"]);
    assert.deepEqual(lines(end), [
      "record:unknown:The answer did not arrive, so it is not known whether the tickmark was recorded. The list is read again.",
    ]);
    assert.deepEqual(end.record, { outcome: "unknown" });
    assert.equal(run.rereads(), 1);
  });

  it("is what a call that throws is: no answer, so not known", async () => {
    const run = scripted({ dismiss: new Error("Failed to fetch") });
    const end = await chain.tickmarkChain(run.calls, BOTH, run.on);
    assert.deepEqual(run.sent, ["record", "dismiss"]);
    assert.equal(end.steps[1]?.state, "unknown");
    assert.equal(end.steps[2]?.state, "held");
    assert.equal(run.rereads(), 1);
  });

  it("is read from the route's status: no answer at all, or a gateway's, never the server's own", () => {
    for (const status of [0, 502, 503, 504]) {
      assert.equal(chain.outcomeUnknown(status), true, String(status));
    }
    // The server's own answers, a failure it reports included, are known.
    for (const status of [200, 402, 403, 404, 409, 422, 500]) {
      assert.equal(chain.outcomeUnknown(status), false, String(status));
    }
    assert.deepEqual(chain.answerOf(null, false), { outcome: "confirmed" });
    assert.deepEqual(chain.answerOf("No.", false), {
      outcome: "refused",
      sentence: "No.",
    });
    // Whatever sentence the row has for it, a lost answer is not a refusal.
    assert.deepEqual(
      chain.answerOf("That could not be saved. Try again.", true),
      { outcome: "unknown" },
    );
    assert.equal(
      chain.ANSWER_LOST,
      "The answer did not arrive, so it is not known whether this was saved. Refresh the page to see where it stands.",
    );
  });
});
