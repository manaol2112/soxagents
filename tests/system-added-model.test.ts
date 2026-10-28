import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { SELECT_CONTROLS_EVENT } from "../apps/web/src/controls-guide-model.ts";
import {
  type Onboarding,
  parseOnboarding,
} from "../apps/web/src/onboarding-model.ts";
import { parseControlsFor } from "../apps/web/src/scope-controls-model.ts";
import {
  addedSystem,
  mapControlsHref,
  openSelectControls,
  selectTargetFor,
} from "../apps/web/src/system-added-model.ts";

// After a system is added, the offer to select its controls (the product owner's
// reference, 27 October 2026).

const ORG = "11111111-1111-7111-8111-111111111111";
const PROJECT = "22222222-2222-7222-8222-222222222222";
const SAP = "44444444-4444-7444-8444-444444444444";
const ORACLE = "55555555-5555-7555-8555-555555555555";

function snapshot(applications: unknown[]): Onboarding {
  const parsed = parseOnboarding({
    project_id: PROJECT,
    project_name: "SOX FY27",
    project_status: "ACTIVE",
    scope: "",
    settings: { period_end: "2027-12-31", version: 1 },
    applications,
    team: [],
    candidates: [],
    controls: [],
    templates: [],
    agents: [],
    library: [],
    readiness: [],
    ready: false,
    plan: null,
    started: true,
  });
  assert.ok(parsed);
  return parsed;
}

describe("the system a save added", () => {
  it("is the one in scope now that was not before, by the name entered", () => {
    const after = snapshot([
      { id: ORACLE, name: "Oracle EBS", description: "" },
      { id: SAP, name: "SAP S/4HANA", description: "" },
    ]);
    assert.deepEqual(addedSystem([{ id: ORACLE }], after, " sap s/4hana "), {
      id: SAP,
      name: "SAP S/4HANA",
    });
  });

  it("takes the only new system when the name was tidied on save", () => {
    const after = snapshot([
      { id: SAP, name: "SAP S/4 HANA", description: "" },
    ]);
    assert.equal(addedSystem([], after, "SAP S/4HANA")?.id, SAP);
  });

  it("offers nothing when the answer does not show it", () => {
    assert.equal(addedSystem([], null, "SAP"), null);
    const unchanged = snapshot([{ id: SAP, name: "SAP", description: "" }]);
    assert.equal(addedSystem([{ id: SAP }], unchanged, "SAP"), null);
  });
});

describe("Map controls", () => {
  it("opens the Controls page filtered to the system", () => {
    const href = mapControlsHref(ORG, PROJECT, SAP);
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    assert.equal(params.get("section"), "register");
    assert.equal(params.get("organization"), ORG);
    assert.equal(params.get("project"), PROJECT);
    assert.deepEqual(parseControlsFor(params.get("for")), {
      kind: "system",
      id: SAP,
    });
  });
});

describe("the system-added dialog's styles", () => {
  const globals = readFileSync("apps/web/app/globals.css", "utf8");
  const block = globals.slice(globals.indexOf("\n.sa {"));

  it("uses tokens only, fits a phone, and stills motion when asked", () => {
    assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i);
    assert.match(block, /@media \(max-width: 820px\)/);
    assert.match(
      block,
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.sa \{\s*animation: none;/,
    );
  });
});

describe("Map controls opens Select controls in place", () => {
  it("is taken by a Select controls on the page, which learns the system", () => {
    const page = new EventTarget();
    const seen: unknown[] = [];
    page.addEventListener(SELECT_CONTROLS_EVENT, (event) => {
      event.preventDefault();
      seen.push((event as CustomEvent<unknown>).detail);
    });
    assert.equal(openSelectControls(page, SAP), true);
    assert.deepEqual(seen, [{ awaiting: SAP }]);
  });

  it("falls back to the Controls page where no Select controls is there", () => {
    assert.equal(openSelectControls(new EventTarget(), SAP), false);
  });

  it("waits for a system just added until the refreshed page lists it", () => {
    const before = [{ id: ORACLE, kind: "system" }];
    assert.deepEqual(selectTargetFor(before, { awaiting: SAP }), {
      wait: true,
    });
    const after = [...before, { id: SAP, kind: "system" }];
    assert.deepEqual(selectTargetFor(after, { awaiting: SAP }), {
      wait: false,
      target: { id: SAP, kind: "system" },
    });
  });

  it("opens other openers as before: the named target, else the first", () => {
    const targets = [{ id: ORACLE }, { id: SAP }];
    assert.deepEqual(selectTargetFor(targets, SAP), {
      wait: false,
      target: { id: SAP },
    });
    assert.deepEqual(selectTargetFor(targets, "ORDER_TO_CASH"), {
      wait: false,
      target: { id: ORACLE },
    });
    assert.deepEqual(selectTargetFor(targets, null), {
      wait: false,
      target: { id: ORACLE },
    });
    assert.deepEqual(selectTargetFor([], null), { wait: false, target: null });
  });

  it("is acknowledged by the scope's drawers", () => {
    const actions = readFileSync("apps/web/src/scope-actions.tsx", "utf8");
    assert.match(actions, /raised\.preventDefault\(\);/);
    assert.match(actions, /selectTargetFor\(targets, drawer\.detail\)/);
  });
});
