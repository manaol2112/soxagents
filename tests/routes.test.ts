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
  "evidence-view.tsx",
  "sheet-view.tsx",
  "workpaper-view.tsx",
  "setup-view.tsx",
  "engagement-create.tsx",
  "round-view.tsx",
  "evidence-change.tsx",
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
    assert.ok(actions.includes("/workspace/follow-ups"));
    assert.ok(actions.includes("/workspace/setup/rcm-upload"));
    assert.ok(actions.includes("/workspace/evidence-filing"));
    assert.ok(actions.includes("/workspace/test-sheets"));
    assert.ok(actions.includes("/workspace/workpapers"));
    assert.ok(actions.includes("/workspace/evidence-change"));
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

describe("live client routes", () => {
  const chat = ["console-chat.tsx", "evidence-intake.tsx"]
    .map((name) =>
      readFileSync(new URL(`../apps/web/src/${name}`, import.meta.url), "utf8"),
    )
    .join("\n");
  const paths = [
    ...new Set(
      [
        ...chat.matchAll(/fetch\(\s*[`"](\/workspace\/[a-z-]+(?:\/[a-z-]+)*)/g),
      ].map((match) => match[1] ?? ""),
    ),
  ];

  it("finds the endpoints the live components call", () => {
    assert.deepEqual(paths, [
      "/workspace/console/live",
      "/workspace/evidence-uploads",
    ]);
  });

  it("lets the chat poll its conversation as well as write to it", () => {
    const route = readFileSync(
      new URL(
        "../apps/web/app/workspace/console/live/route.ts",
        import.meta.url,
      ),
      "utf8",
    );
    assert.match(route, /export async function GET/);
    assert.match(route, /export async function POST/);
  });

  for (const path of paths) {
    it(`has a route handler for ${path}`, () => {
      const route = new URL(`../apps/web/app${path}/route.ts`, import.meta.url);
      assert.ok(existsSync(route), `missing ${route.pathname}`);
      const source = readFileSync(route, "utf8");
      assert.match(source, /export async function POST/);
    });
  }
});
