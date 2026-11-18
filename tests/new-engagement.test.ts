import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  areaSelected,
  DEFAULT_FRAMEWORKS,
  engagementTypeFor,
  frameworkOfArea,
  frameworksField,
  parseFrameworksField,
  periodRange,
  selectedControls,
} from "../apps/web/src/new-engagement-model.ts";
import { projectWrite } from "../apps/web/src/project-form.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";

describe("the frameworks a new engagement covers", () => {
  it("travels as one field, in the page's order, each once", () => {
    assert.equal(
      frameworksField(["KEY_REPORT", "ITGC", "ITGC"]),
      "ITGC,KEY_REPORT",
    );
    assert.deepEqual(parseFrameworksField("KEY_REPORT, ITGC"), [
      "ITGC",
      "KEY_REPORT",
    ]);
    assert.equal(parseFrameworksField(undefined), null);
    assert.equal(parseFrameworksField(""), "invalid");
    assert.equal(parseFrameworksField("ITGC,SOC2"), "invalid");
  });

  it("opens with the SOX scope the page always covered", () => {
    assert.deepEqual(
      [...DEFAULT_FRAMEWORKS],
      ["ITGC", "BUSINESS", "ITAC", "KEY_REPORT"],
    );
  });

  it("implies the engagement type", () => {
    assert.equal(engagementTypeFor(["ITGC", "KEY_REPORT"]), "SOX_ITGC");
    assert.equal(engagementTypeFor(["ITGC", "BUSINESS"]), "SOX_FULL");
    assert.equal(engagementTypeFor(["ENTITY"]), "SOX_FULL");
  });

  it("counts the library's controls in the frameworks chosen", () => {
    const counts = { ITGC: 31, BUSINESS: 28, ITAC: 13, KEY_REPORT: 8 };
    assert.equal(selectedControls(counts, ["ITGC", "KEY_REPORT"]), 39);
    assert.equal(selectedControls(counts, ["ENTITY"]), 0);
  });

  it("selects the matching areas when setup opens its Controls step", () => {
    assert.equal(frameworkOfArea("ACCESS"), "ITGC");
    assert.equal(frameworkOfArea("IPE"), "KEY_REPORT");
    assert.equal(frameworkOfArea("ORDER_TO_CASH"), "BUSINESS");
    assert.equal(areaSelected("ORDER_TO_CASH", ["ITGC", "BUSINESS"]), true);
    assert.equal(areaSelected("ITAC", ["ITGC", "BUSINESS"]), false);
    // An engagement that chose none keeps the usual selection: the ITGC areas.
    assert.equal(areaSelected("CHANGE", null), true);
    assert.equal(areaSelected("ORDER_TO_CASH", null), false);
  });

  it("names the audit period the period end implies", () => {
    assert.equal(periodRange("2026-12-31"), "Jan 1, 2026 – Dec 31, 2026");
    assert.equal(periodRange("2027-06-30"), "Jul 1, 2026 – Jun 30, 2027");
    assert.equal(periodRange(""), "");
  });
});

describe("creating an engagement with its frameworks", () => {
  const create = (extra: Record<string, string>) =>
    projectWrite({
      intent: "create",
      organization_id: ORG,
      name: "SOX FY27",
      owner_user_id: OWNER,
      status: "DRAFT",
      ...extra,
    });

  it("sends the frameworks and the type they imply", () => {
    const write = create({ frameworks: "ITGC,KEY_REPORT" });
    assert.ok(!("error" in write));
    assert.deepEqual(write.body.frameworks, ["ITGC", "KEY_REPORT"]);
    assert.equal(write.body.engagement_type, "SOX_ITGC");
  });

  it("refuses an unknown framework or an empty choice", () => {
    assert.deepEqual(create({ frameworks: "SOC2" }), { error: "invalid" });
    assert.deepEqual(create({ frameworks: "" }), { error: "invalid" });
  });

  it("leaves the frameworks out when the form sends none", () => {
    const write = create({});
    assert.ok(!("error" in write));
    assert.equal(write.body.frameworks, null);
    assert.equal(write.body.engagement_type, "SOX_FULL");
  });
});
