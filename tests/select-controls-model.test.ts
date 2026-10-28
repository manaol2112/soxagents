import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  acceptRecommended,
  adviceSourceLine,
  clickRow,
  type LibraryFilters,
  type LibraryOption,
  libraryView,
  pickCategory,
  type SystemAdvice,
  systemAdvice,
  toggleVisible,
} from "../apps/web/src/select-controls-model.ts";

// Map controls (the product owner's reference, 27 October 2026): the library filtered by
// category, source and words, with the chosen controls listed beside it.

const option = (
  controlRef: string,
  domain: string,
  title: string,
  inScope = false,
): LibraryOption => ({
  libraryKey: `lib-${controlRef}`,
  controlRef,
  title,
  domain,
  inScope,
});

const OPTIONS = [
  option("ITGC-AC-01", "ACCESS", "User Access Provisioning and Approval"),
  option("ITGC-AC-02", "ACCESS", "Timely Removal of Terminated User Access"),
  option("ITGC-CM-01", "CHANGE", "Program Change Testing and Approval", true),
  option("ITAC-01", "ITAC", "Three-way match"),
];

const filters = (extra: Partial<LibraryFilters> = {}): LibraryFilters => ({
  categories: pickCategory(OPTIONS, "ALL"),
  sources: [],
  words: "",
  categoryWords: "",
  chosen: [],
  ...extra,
});

describe("the library view", () => {
  it("counts each category and source, and shows every control by default", () => {
    const view = libraryView(OPTIONS, filters());
    assert.equal(view.categoryChoice, "ALL");
    assert.equal(view.shown.length, 4);
    assert.deepEqual(
      view.sources.map((item) => [item.label, item.count]),
      [["Standard", 4]],
    );
    assert.equal(
      view.allCategories.reduce((sum, item) => sum + item.count, 0),
      4,
    );
  });

  it("searches by control ID or name, and categories by their label", () => {
    assert.deepEqual(
      libraryView(OPTIONS, filters({ words: "terminated" })).shown.map(
        (item) => item.controlRef,
      ),
      ["ITGC-AC-02"],
    );
    assert.deepEqual(
      libraryView(OPTIONS, filters({ words: "itac-01" })).shown.map(
        (item) => item.controlRef,
      ),
      ["ITAC-01"],
    );
    const searched = libraryView(OPTIONS, filters({ categoryWords: "zzz" }));
    assert.deepEqual(searched.categories, []);
    assert.equal(searched.allCategories.length > 0, true);
    // The category search narrows the filter list, not the controls.
    assert.equal(searched.shown.length, 4);
  });

  it("narrows to one category from the All categories picker", () => {
    const one = pickCategory(OPTIONS, "ITAC");
    assert.deepEqual(one, ["ITAC"]);
    const view = libraryView(OPTIONS, filters({ categories: one }));
    assert.equal(view.categoryChoice, "ITAC");
    assert.deepEqual(
      view.shown.map((item) => item.controlRef),
      ["ITAC-01"],
    );
    assert.deepEqual(pickCategory(OPTIONS, "UNKNOWN").length > 1, true);
  });

  it("lists the chosen controls in the order chosen", () => {
    const view = libraryView(
      OPTIONS,
      filters({ chosen: ["lib-ITAC-01", "lib-ITGC-AC-01", "lib-gone"] }),
    );
    assert.deepEqual(
      view.selected.map((item) => item.controlRef),
      ["ITAC-01", "ITGC-AC-01"],
    );
  });

  it("selects all visible controls not already in scope, and clears them", () => {
    const view = libraryView(OPTIONS, filters());
    assert.deepEqual(
      view.open.map((item) => item.controlRef),
      ["ITGC-AC-01", "ITGC-AC-02", "ITAC-01"],
    );
    const chosen = toggleVisible([], view);
    assert.equal(chosen.length, 3);
    const all = libraryView(OPTIONS, filters({ chosen }));
    assert.equal(all.allChosen, true);
    assert.deepEqual(toggleVisible(chosen, all), []);
  });
});

describe("picking controls by their rows", () => {
  const shown = OPTIONS;
  const key = (ref: string) => `lib-${ref}`;

  it("picks and unpicks a control with a click on its row", () => {
    const on = clickRow([], shown, key("ITGC-AC-02"), null, false);
    assert.deepEqual(on, [key("ITGC-AC-02")]);
    assert.deepEqual(clickRow(on, shown, key("ITGC-AC-02"), null, false), []);
  });

  it("picks every open control between two rows with Shift, skipping those in scope", () => {
    const first = clickRow([], shown, key("ITGC-AC-01"), null, false);
    const range = clickRow(
      first,
      shown,
      key("ITAC-01"),
      key("ITGC-AC-01"),
      true,
    );
    assert.deepEqual(range, [
      key("ITGC-AC-01"),
      key("ITGC-AC-02"),
      key("ITAC-01"),
    ]);
    // Upwards works the same, and a Shift-click on a picked row unpicks the range.
    assert.deepEqual(
      clickRow(range, shown, key("ITGC-AC-01"), key("ITAC-01"), true),
      [],
    );
  });

  it("treats Shift without an earlier click, or a row no longer shown, as one click", () => {
    assert.deepEqual(clickRow([], shown, key("ITAC-01"), null, true), [
      key("ITAC-01"),
    ]);
    assert.deepEqual(clickRow([], shown, key("ITAC-01"), "lib-gone", true), [
      key("ITAC-01"),
    ]);
  });
});

describe("the agent's recommendations in Map controls (27 October 2026)", () => {
  const advice: SystemAdvice = {
    state: "READY",
    source: "AGENT",
    cuecs: 1,
    byKey: {
      "lib-ITGC-AC-01": {
        status: "RECOMMENDED",
        rationale: "Users sign in to the system.",
        cuecs: ["CUEC-2"],
      },
      // Already in scope: counted out of what is left to accept.
      "lib-ITGC-CM-01": { status: "RECOMMENDED", rationale: "", cuecs: [] },
      "lib-ITAC-01": { status: "POTENTIAL", rationale: "", cuecs: [] },
    },
  };

  it("counts what is left to accept, and shows only those rated when asked", () => {
    const view = libraryView(OPTIONS, filters(), advice);
    assert.equal(view.recommended, 1);
    assert.equal(view.potential, 1);
    assert.deepEqual(
      libraryView(
        OPTIONS,
        filters({ recommendedOnly: true }),
        advice,
      ).shown.map((item) => item.controlRef),
      ["ITGC-AC-01", "ITGC-CM-01", "ITAC-01"],
    );
  });

  it("accepts only the recommended controls not in scope; potential ones stay a choice", () => {
    assert.deepEqual(acceptRecommended(["lib-ITGC-AC-02"], OPTIONS, advice), [
      "lib-ITGC-AC-02",
      "lib-ITGC-AC-01",
    ]);
    assert.deepEqual(acceptRecommended([], OPTIONS, null), []);
  });

  it("reads the system's review and only its uploaded reports' CUECs", () => {
    const system = (assessment: unknown, socReports: unknown[] = []) =>
      ({ assessment, socReports }) as unknown as Parameters<
        typeof systemAdvice
      >[0];
    const candidate = (
      libraryKey: string | null,
      controlRef: string,
      status: string,
    ) => ({ libraryKey, controlRef, status, rationale: "why" });
    const reviewed = systemAdvice(
      system(
        {
          status: "IDLE",
          source: "AGENT",
          candidates: [
            candidate("lib-ITGC-AC-01", "ITGC-AC-01", "RECOMMENDED"),
            candidate("lib-ITGC-AC-02", "ITGC-AC-02", "NOT_RECOMMENDED"),
            candidate(null, "SYS-01", "RECOMMENDED"),
            candidate("lib-ITAC-01", "ITAC-01", "POTENTIAL"),
          ],
        },
        [
          {
            status: "READ",
            cuecs: [
              { ref: "CUEC-2", controls: [{ controlRef: "ITGC-AC-01" }] },
            ],
          },
          // A report still being read contributes nothing.
          {
            status: "READING",
            cuecs: [{ ref: "CUEC-9", controls: [{ controlRef: "ITAC-01" }] }],
          },
        ],
      ),
    );
    assert.equal(reviewed.state, "READY");
    assert.equal(reviewed.cuecs, 1);
    assert.deepEqual(Object.keys(reviewed.byKey).sort(), [
      "lib-ITAC-01",
      "lib-ITGC-AC-01",
    ]);
    assert.deepEqual(reviewed.byKey["lib-ITGC-AC-01"]?.cuecs, ["CUEC-2"]);
    assert.deepEqual(reviewed.byKey["lib-ITAC-01"]?.cuecs, []);
    assert.equal(systemAdvice(system(null)).state, "NONE");
    assert.equal(
      systemAdvice(
        system({ status: "WORKING", source: "NONE", candidates: [] }),
      ).state,
      "WORKING",
    );
  });
});

describe("a review the reviewed rules stood in for (27 October 2026)", () => {
  // The model's answer did not fit, so the rules were used and saved as FALLBACK. It read
  // as no review at all, so Map controls refreshed without end after Ask the agent.
  const fallback = {
    assessment: {
      status: "IDLE",
      source: "FALLBACK",
      candidates: [
        {
          libraryKey: "lib-ITGC-AC-01",
          controlRef: "ITGC-AC-01",
          status: "RECOMMENDED",
          rationale: "",
        },
      ],
    },
    socReports: [],
  } as unknown as Parameters<typeof systemAdvice>[0];

  it("is a finished review, so the drawer stops refreshing", () => {
    const advice = systemAdvice(fallback);
    assert.equal(advice.state, "READY");
    assert.equal(advice.source, "FALLBACK");
    assert.equal(Object.keys(advice.byKey).length, 1);
  });

  it("says plainly that the rules stood in", () => {
    assert.match(
      adviceSourceLine("FALLBACK", "Active Directory"),
      /answer for Active Directory could not be used, so the reviewed rules/,
    );
    assert.match(adviceSourceLine("RULES", "SAP"), /reviewed rules suggested/);
    assert.match(adviceSourceLine("AGENT", "SAP"), /agent recommended/);
  });

  it("is read from the API as it is saved", () => {
    const model = readFileSync("apps/web/src/onboarding-model.ts", "utf8");
    assert.match(
      model,
      /pick\(value\.source, \["RULES", "AGENT", "FALLBACK"\] as const\)/,
    );
    // The drawer stops asking for a refresh a minute after Ask the agent at most.
    const drawer = readFileSync("apps/web/src/scope-actions.tsx", "utf8");
    assert.match(drawer, /setTimeout\(\(\) => setAsking\(false\), 60000\)/);
  });
});

describe("the Map controls styles", () => {
  const css = readFileSync("apps/web/app/controls-setup.css", "utf8");
  const block = css.slice(css.indexOf("/* Map controls (Select controls"));

  it("uses tokens, no !important, and stacks on narrow screens", () => {
    assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b/i);
    assert.doesNotMatch(block, /!important/);
    assert.match(
      block,
      /@media \(max-width: 820px\)[\s\S]*?\.mc \.as-main \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
  });
});
