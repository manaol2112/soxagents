import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { wizardProblem } from "../apps/web/src/onboarding-model.ts";
import {
  acceptHeld,
  acceptRecommendedWithin,
  allowanceCheck,
  allowanceTaken,
  type ControlAllowance,
  controlAllowance,
  footReason,
  type LibraryOption,
  mapProblem,
  type SystemAdvice,
} from "../apps/web/src/select-controls-model.ts";
import { refusalFrom } from "../apps/web/src/trial-model.ts";
import {
  parseTrialUsage,
  readsTrialUsage,
  type TrialUsage,
} from "../apps/web/src/trial-usage-model.ts";

// Map controls on the free trial (the product owner's fix of 19 November 2026): the
// dialog shows the allowance of controls before anything is chosen, holds Map with the
// reason while the selection passes it, and a refusal says the server's real reason.

const ORG = "11111111-1111-4111-8111-111111111111";

const usage = (plan = "TRIAL", controls: number | null = 5): TrialUsage => {
  const parsed = parseTrialUsage({
    state: plan === "TRIAL" ? "TRIAL" : "ACTIVE",
    plan_type: plan,
    writable: true,
    limits: { controls },
    usage: { controls: 0 },
  });
  assert.ok(parsed);
  return parsed;
};

const option = (ref: string): LibraryOption => ({
  libraryKey: `lib-${ref}`,
  controlRef: ref,
  title: `Control ${ref}`,
  domain: "ACCESS",
  inScope: false,
});

// Twelve library controls, all recommended: the owner's case (12 recommended, 5 allowed).
const TWELVE = Array.from({ length: 12 }, (_, at) =>
  option(`ITGC-AC-${String(at + 1).padStart(2, "0")}`),
);
const ALL_RECOMMENDED: SystemAdvice = {
  state: "READY",
  source: "AGENT",
  cuecs: 0,
  byKey: Object.fromEntries(
    TWELVE.map((item) => [
      item.libraryKey,
      { status: "RECOMMENDED" as const, rationale: "", cuecs: [] },
    ]),
  ),
};

const fresh = (): ControlAllowance => {
  const allowance = controlAllowance(usage(), false, []);
  assert.ok(allowance);
  return allowance;
};

describe("the trial's allowance of controls for the engagement", () => {
  it("is the subscription's limit and the engagement's distinct references", () => {
    assert.deepEqual(fresh(), { allowed: 5, used: 0, left: 5, held: [] });
    // Two rows of one reference (mapped to two systems) count once, as the trigger does.
    assert.deepEqual(
      controlAllowance(usage(), false, ["ITGC-AC-01", "ITGC-AC-01", "X-2"]),
      { allowed: 5, used: 2, left: 3, held: ["ITGC-AC-01", "X-2"] },
    );
    assert.equal(
      controlAllowance(usage(), false, ["A", "B", "C", "D", "E", "F"])?.left,
      0,
    );
  });

  it("is not shown off the trial, without a limit, unread, or on the demo", () => {
    assert.equal(controlAllowance(usage("PAID"), false, []), null);
    assert.equal(controlAllowance(usage("TRIAL", null), false, []), null);
    assert.equal(controlAllowance(null, false, []), null);
    // The demo engagement is outside the allowances (migration 0128).
    assert.equal(controlAllowance(usage(), true, []), null);
  });

  it("charges only references the engagement does not hold yet", () => {
    const allowance = controlAllowance(usage(), false, ["ITGC-AC-01"]);
    assert.ok(allowance);
    assert.equal(
      allowanceTaken(allowance, [option("ITGC-AC-01"), option("ITGC-AC-02")]),
      1,
    );
  });
});

describe("Map is offered only when it can succeed", () => {
  it("says the allowance up front", () => {
    assert.deepEqual(allowanceCheck(fresh(), []), {
      line: "Your trial includes 5 controls per engagement · 0 used · 5 left",
      held: null,
      tone: "info",
    });
  });

  it("holds Map with the reason when the selection passes what is left", () => {
    const eleven = allowanceCheck(fresh(), TWELVE.slice(0, 11));
    assert.equal(eleven.held, "Select up to 5 controls on the trial.");
    assert.equal(eleven.tone, "warning");
    assert.equal(allowanceCheck(fresh(), TWELVE.slice(0, 5)).held, null);
    const full = controlAllowance(usage(), false, ["A", "B", "C", "D", "E"]);
    assert.ok(full);
    assert.equal(allowanceCheck(full, []).tone, "warning");
    assert.equal(
      allowanceCheck(full, [option("F")]).held,
      "The trial's 5 controls for this engagement are in use. Explore plans to add more.",
    );
  });

  it("accepts the recommended controls up to the allowance and says so", () => {
    const accepted = acceptRecommendedWithin(
      [],
      TWELVE,
      ALL_RECOMMENDED,
      fresh(),
    );
    assert.deepEqual(
      accepted.chosen,
      TWELVE.slice(0, 5).map((item) => item.libraryKey),
    );
    assert.equal(
      accepted.note,
      "5 of 12 recommended controls selected, the most the trial allows. Swap any in the list to choose others.",
    );
    // Off the trial, every recommended control, as before.
    assert.equal(
      acceptRecommendedWithin([], TWELVE, ALL_RECOMMENDED, null).chosen.length,
      12,
    );
  });

  it("holds Accept recommended, with the reason, when there is no room", () => {
    const full = controlAllowance(usage(), false, ["A", "B", "C", "D", "E"]);
    assert.equal(
      acceptHeld([], TWELVE, ALL_RECOMMENDED, full),
      "The trial's 5 controls for this engagement are in use.",
    );
    assert.equal(acceptHeld([], TWELVE, ALL_RECOMMENDED, fresh()), null);
    // Room left on the engagement, all of it taken by the selection: said of the selection.
    const five = TWELVE.slice(0, 5).map((item) => item.libraryKey);
    assert.equal(
      acceptHeld(five, TWELVE, ALL_RECOMMENDED, fresh()),
      "The selection already uses the 5 controls left on the trial.",
    );
    assert.equal(acceptHeld([], TWELVE, ALL_RECOMMENDED, null), null);
  });
});

describe("a refused Map says the server's reason", () => {
  // The API's answer to the owner's selection of 11 (entitlement_errors.py).
  const LIMIT = {
    detail: "trial limit reached: controls",
    code: "TRIAL_LIMIT",
    resource: "controls",
    used: 5,
    allowed: 5,
  };

  it("names the allowance and what to do, never a retry line", () => {
    const said = mapProblem(402, LIMIT.detail, refusalFrom(402, LIMIT));
    assert.equal(
      said.words,
      "Nothing was mapped. The free trial includes 5 controls per engagement, and this selection exceeds what is left. Select fewer controls, or explore plans to map more.",
    );
    assert.equal(said.plans, true);
    assert.doesNotMatch(said.words, /Try again/);
  });

  it("says an ended trial is read-only", () => {
    const said = mapProblem(
      402,
      "subscription inactive: the free trial has ended",
      refusalFrom(402, {
        code: "SUBSCRIPTION_INACTIVE",
        state: "TRIAL_EXPIRED",
      }),
    );
    assert.match(
      said.words,
      /^Nothing was mapped\. Your free trial has ended\./,
    );
    assert.match(said.words, /remains available to review/);
    // The words already point at the plans: no second link.
    assert.equal(said.plans, false);
  });

  it("gives other refusals their own words; only a lost call is retried", () => {
    assert.equal(
      mapProblem(409, "bring the system back into scope first", null).words,
      "Bring this system back into scope before mapping controls to it.",
    );
    assert.equal(
      mapProblem(409, "BP-OTC-01 is in scope for another process", null).words,
      "BP-OTC-01 is in scope for another process. Leave it out, or map it from that process.",
    );
    assert.equal(
      mapProblem(403, "", null).words,
      "Only the engagement's managers can select controls.",
    );
    assert.equal(
      mapProblem(0, "", null).words,
      "The controls could not be mapped. Check the connection and try again.",
    );
  });
});

describe("the footer gives one reason", () => {
  it("is the refusal while shown, then the held reason once the selection changes", () => {
    // After a real refusal the page refreshes to 0 left, so Map is held as well: the
    // refusal alone is said, and Map is described by it.
    assert.equal(
      footReason("Nothing was mapped.", "Select up to 3."),
      "problem",
    );
    assert.equal(footReason(null, "Select up to 3."), "held");
    assert.equal(footReason(null, null), null);
  });

  it("renders the held line and describes Map only through that reason", () => {
    const source = readFileSync("apps/web/src/scope-actions.tsx", "utf8");
    const flat = source.replace(/\s+/g, " ");
    // An element id as the source writes it, a template on the dialog's id.
    const at = (name: string) => ["{`$", "{id}-", name, "`}"].join("");
    assert.ok(
      flat.includes(
        `{reason === "held" ? ( <span id=${at("held")} className="mc-held">`,
      ),
    );
    assert.ok(
      flat.includes(
        'aria-disabled={held !== null ? "true" : undefined} aria-describedby={reasonId}',
      ),
    );
    assert.ok(
      flat.includes(
        `<p id=${at("problem")} className="as-problem" role="alert">`,
      ),
    );
    // The held line is never shown beside a refusal.
    assert.ok(!flat.includes(`{held !== null ? ( <span id=${at("held")}`));
  });
});

describe("the shared wizard route carries the refusal (the class)", () => {
  it("passes the API's 402 body on, read once by refusalFrom", () => {
    const route = readFileSync(
      "apps/web/app/workspace/system-wizard/route.ts",
      "utf8",
    );
    assert.match(route, /if \(status === 402\) \{\s*refusal = body;/);
    assert.match(
      route,
      /NextResponse\.json\(\{ status, detail, onboarding, refusal \}\)/,
    );
  });

  it("has every dialog that writes through it read the refusal", () => {
    for (const file of [
      "apps/web/src/scope-actions.tsx",
      "apps/web/src/add-system-wizard.tsx",
      "apps/web/src/add-process-wizard.tsx",
      "apps/web/src/system-wizard.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /"\/workspace\/system-wizard"/, file);
      assert.match(
        source,
        /refusalFrom\(status, (answer|body)\.refusal\)/,
        file,
      );
    }
    // The generic line that hid the owner's refusal is gone from Map controls.
    assert.doesNotMatch(
      readFileSync("apps/web/src/scope-actions.tsx", "utf8"),
      /The controls could not be added\. Try again\./,
    );
  });

  it("says the trial's words in the system wizard", () => {
    assert.equal(
      wizardProblem(
        402,
        "trial limit reached: systems",
        refusalFrom(402, {
          code: "TRIAL_LIMIT",
          resource: "systems",
          used: 1,
          allowed: 1,
        }),
      ),
      "The free trial includes one system. To add more, explore plans.",
    );
  });

  it("is read on the pages that map controls, for a firm on the trial", () => {
    const firms = [
      { id: ORG, plan_type: "TRIAL", subscription_state: "TRIAL" },
    ];
    assert.equal(readsTrialUsage("controls", firms, ORG), true);
    assert.equal(readsTrialUsage("register", firms, ORG), true);
    assert.equal(readsTrialUsage("settings", [], ORG), true);
    assert.equal(readsTrialUsage("overview", firms, ORG), false);
    assert.equal(
      readsTrialUsage(
        "controls",
        [{ id: ORG, plan_type: "PAID", subscription_state: "ACTIVE" }],
        ORG,
      ),
      false,
    );
    assert.equal(readsTrialUsage(null, firms, ORG), false);
  });

  it("passes the allowance to both Map controls dialogs", () => {
    const view = readFileSync("apps/web/src/setup-view.tsx", "utf8");
    assert.equal(
      view.match(/allowance=\{controlAllowance\(\s*model\.trialUsage,/g)
        ?.length,
      2,
    );
  });
});
