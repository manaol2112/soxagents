import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  lastPageTarget,
  opensOnLastPage,
  rememberedPath,
} from "../apps/web/src/last-page-model.ts";

// The last page a person opened, kept on their account (migration 0124; decided by the
// product owner on 28 October 2026).

const ORG = "11111111-1111-7111-8111-111111111111";
const PROJECT = "22222222-2222-7222-8222-222222222222";

describe("the page that is kept", () => {
  it("is the workspace address, as the person had it", () => {
    assert.equal(
      rememberedPath({
        organization: ORG,
        project: PROJECT,
        section: "register",
        for: "system:abc",
        stage: ["PLANNED", "TESTING"],
      }),
      `/?organization=${ORG}&project=${PROJECT}&section=register&for=system%3Aabc&stage=PLANNED&stage=TESTING`,
    );
  });

  it("leaves out what only just happened or opened a form", () => {
    assert.equal(
      rememberedPath({
        organization: ORG,
        section: "projects",
        create: "engagement",
        notice: "setup-saved",
        edit: "engagement",
        manage: "engagement",
        new: PROJECT,
      }),
      `/?organization=${ORG}&section=projects`,
    );
  });

  it("is nothing without one firm", () => {
    assert.equal(rememberedPath({ section: "overview" }), null);
    assert.equal(rememberedPath({ organization: [ORG, ORG] }), null);
  });
});

describe("going back to it", () => {
  it("happens only when the workspace opens with no address", () => {
    assert.equal(opensOnLastPage({}), true);
    assert.equal(opensOnLastPage({ section: undefined, q: "" }), true);
    assert.equal(opensOnLastPage({ organization: ORG }), false);
    assert.equal(opensOnLastPage({ section: "evidence" }), false);
  });

  it("goes only to a workspace address", () => {
    assert.equal(
      lastPageTarget({ path: `/?organization=${ORG}` }),
      `/?organization=${ORG}`,
    );
    for (const path of [
      "https://example.com/?organization=x",
      "//evil.example/?x=1",
      "/welcome",
      "",
      42,
    ]) {
      assert.equal(lastPageTarget({ path }), null, String(path));
    }
    assert.equal(lastPageTarget(null), null);
  });

  it("is wired into the page, and each page keeps itself", () => {
    const page = readFileSync("apps/web/app/page.tsx", "utf8");
    assert.match(page, /if \(opensOnLastPage\(params\)\)/);
    assert.match(page, /apiGet\("\/me\/last-page", session\)/);
    assert.match(
      page,
      /lastPage=\{model\.status === "ready" \? rememberedPath\(params\) : null\}/,
    );
    const view = readFileSync("apps/web/src/workspace-view.tsx", "utf8");
    assert.match(view, /<LastPageRecorder path=\{lastPage\} \/>/);
  });
});
