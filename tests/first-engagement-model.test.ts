import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  FIRST_ENGAGEMENT_STEPS,
  firstEngagementCopy,
} from "../apps/web/src/first-engagement-model.ts";
import { METHODOLOGIES } from "../apps/web/src/onboarding-model.ts";

describe("Home before the first engagement", () => {
  it("offers to create one to a member who can", () => {
    const copy = firstEngagementCopy(true);
    assert.equal(copy.title, "Let’s create your first engagement");
    assert.equal(copy.action?.label, "Create first engagement");
    assert.deepEqual(copy.action?.notes, [
      "About 3 minutes",
      "You can change details before launch",
    ]);
    assert.equal(copy.waiting, null);
  });

  it("tells a member who cannot create one who does, with no action", () => {
    const copy = firstEngagementCopy(false);
    assert.equal(copy.action, null);
    assert.match(copy.waiting ?? "", /owner, admin, or project manager/);
    assert.doesNotMatch(copy.title, /create/i);
  });

  it("lists the three steps in order, numbered", () => {
    assert.deepEqual(
      FIRST_ENGAGEMENT_STEPS.map((step) => [step.number, step.title]),
      [
        ["01", "Add a client"],
        ["02", "Define engagement"],
        ["03", "Start working"],
      ],
    );
  });

  it("names only methodologies the engagement form offers", () => {
    const offered = METHODOLOGIES.map((item) => item.label).join(" ");
    const detail = FIRST_ENGAGEMENT_STEPS.map((step) => step.detail).join(" ");
    for (const other of ["SOC 2", "ISO 27001"]) {
      assert.ok(!detail.includes(other), `${other} is not a methodology here`);
    }
    assert.match(offered, /SOX 404/);
    assert.match(offered, /[Ii]nternal audit/);
  });
});

describe("the first-run styles", () => {
  const globals = readFileSync("apps/web/app/globals.css", "utf8");
  const glass = readFileSync("apps/web/app/glass.css", "utf8");
  const block = globals.slice(globals.indexOf(".first-run {"));

  it("stacks the steps on a phone and stills motion when asked", () => {
    assert.match(
      block,
      /@media \(max-width: 820px\)[\s\S]*?\.first-run-steps \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    assert.match(
      block,
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none;/,
    );
  });

  it("uses tokens only, never a raw color", () => {
    assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i);
  });

  it("joins the step cards to the glass panels, and to their solid fallback", () => {
    assert.equal(glass.match(/\.first-run-step\b/g)?.length, 2);
  });
});
