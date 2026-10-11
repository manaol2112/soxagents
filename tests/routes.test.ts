import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const view = [
  "workspace-view.tsx",
  "onboarding-view.tsx",
  "engagement-view.tsx",
  "analysis-view.tsx",
  "testing-view.tsx",
  "console-view.tsx",
  "controls-view.tsx",
]
  .map((name) =>
    readFileSync(new URL(`../apps/web/src/${name}`, import.meta.url), "utf8"),
  )
  .join("\n");

describe("workspace form routes", () => {
  const actions = [
    ...new Set(
      [...view.matchAll(/action="(\/workspace\/[a-z-]+(?:\/[a-z-]+)*)"/g)].map(
        (match) => match[1] ?? "",
      ),
    ),
  ];

  it("finds the forms that post to workspace routes", () => {
    assert.ok(actions.includes("/workspace/evidence"));
    assert.ok(actions.includes("/workspace/evidence/redraft"));
    assert.ok(actions.includes("/workspace/setup/rcm-upload"));
    assert.ok(actions.length >= 6);
  });

  for (const action of actions) {
    it(`has a route handler for ${action}`, () => {
      const route = new URL(
        `../apps/web/app${action}/route.ts`,
        import.meta.url,
      );
      assert.ok(existsSync(route), `missing ${route.pathname}`);
    });
  }
});
