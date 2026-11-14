import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// The governing-policy question in Control Understanding (product owner, 13 November 2026:
// "Policy should always be optional ... an option here that policy is not available instead
// of linking ... if yes, ask it to add the name of the policy"). The step offers two answers:
// the client has a policy (named, then added to the D&I evidence requests) or no formal policy
// (saved as the "No formal document" value, which the wording reads as established practice).

const source = readFileSync(
  new URL("../apps/web/src/understanding-review.tsx", import.meta.url),
  "utf8",
);

function policyStep(): string {
  const start = source.indexOf("function policyPoint(");
  const end = source.indexOf("async function save(", start);
  assert.ok(start > 0 && end > start, "the policy step is its own function");
  return source.slice(start, end);
}

describe("the policy question in Control Understanding", () => {
  it("routes every policy point to the policy step, not to a link-only step", () => {
    assert.match(
      source,
      /need\.kind === "DOCUMENT"\)\s*\{?\s*return policyPoint\(/,
    );
    assert.doesNotMatch(source, /Link it in D&(?:amp;)?I Evidence/);
  });

  it("offers a named policy or no formal policy, and says a policy is not required", () => {
    const step = policyStep();
    assert.match(step, /The client has a policy/);
    assert.match(step, /No formal policy/);
    assert.match(step, /A formal policy is not\s+required/);
    assert.match(
      step,
      /placeholder="The policy's name, as the client calls it"/,
    );
  });

  it("saves no formal policy as the shared no-document value", () => {
    const step = policyStep();
    assert.match(
      source,
      /import \{[^}]*\bNO_DOCUMENT\b[^}]*\} from "\.\/control-setup-model"/,
    );
    assert.match(step, /choice === "NONE" \? NO_DOCUMENT/);
    assert.match(step, /current === NO_DOCUMENT \? "NONE"/);
    assert.match(step, /void save\(need, answer, true\)/);
  });

  it("asks for the name and points to the D&I evidence requests when there is a policy", () => {
    const step = policyStep();
    assert.match(step, /choice === "NAMED" \?/);
    assert.match(step, /Add it to the D&amp;I\s+evidence requests/);
    assert.match(step, /href=\{documentsHref\}/);
  });

  it("keeps the step skippable and never saves an empty answer", () => {
    const step = policyStep();
    assert.match(step, /disabled=\{!canAct \|\| busy \|\| answer === ""\}/);
    assert.match(step, /foot\([\s\S]*,\s*true,\s*\)/);
  });
});
