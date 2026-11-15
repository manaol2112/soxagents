import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  guardedHref,
  hasLeaveAsker,
  leaving,
  setLeaveAsker,
} from "../apps/web/src/leave-guard.ts";

// Asking before a person leaves with changes that are not in the workpaper
// (docs/design-workpaper.md, section 3.4; product owner, 15 November 2026: "If the user
// is leaving or moving to other pages, the system should ask if he/she wanted to save the
// changes"). The guard must never hold a person who has nothing unsaved, never lose the
// place they were going to, and never ask about something that does not leave the page.

const HERE = "http://app.test/?section=controls&control=1&step=design";
const plain = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
};
const link = (
  href: string,
  over: Partial<{ target: string; download: boolean }> = {},
) => ({
  href,
  target: "",
  download: false,
  ...over,
});

describe("going on, or asking first", () => {
  it("goes on at once where nothing asks", () => {
    let went = 0;
    assert.equal(hasLeaveAsker(), false);
    leaving(() => {
      went += 1;
    });
    assert.equal(went, 1);
  });

  it("hands the way on to the asker, which goes on only if the person says so", () => {
    const held: Array<() => void> = [];
    const unset = setLeaveAsker((proceed) => held.push(proceed));
    assert.equal(hasLeaveAsker(), true);
    let went = 0;
    leaving(() => {
      went += 1;
    });
    assert.equal(went, 0);
    assert.equal(held.length, 1);
    held[0]?.();
    assert.equal(went, 1);
    unset();
    assert.equal(hasLeaveAsker(), false);
    leaving(() => {
      went += 1;
    });
    assert.equal(went, 2);
  });

  it("lets only the asker that is set unset itself", () => {
    const first = setLeaveAsker(() => {});
    const second = setLeaveAsker(() => {});
    // An editor that closed after another opened does not take the other's guard away.
    first();
    assert.equal(hasLeaveAsker(), true);
    second();
    assert.equal(hasLeaveAsker(), false);
  });
});

describe("which clicks on a link are a way out", () => {
  it("is one for another page of the app, with where it goes", () => {
    assert.equal(
      guardedHref(
        plain,
        link("http://app.test/?section=controls&control=2"),
        HERE,
      ),
      "/?section=controls&control=2",
    );
    assert.equal(
      guardedHref(plain, link("/?section=planning#top"), HERE),
      "/?section=planning#top",
    );
    assert.equal(guardedHref(plain, link("/sign-out"), HERE), "/sign-out");
    // Another step of the same control is another page of the app.
    assert.equal(
      guardedHref(
        plain,
        link("?section=controls&control=1&step=testing"),
        HERE,
      ),
      "/?section=controls&control=1&step=testing",
    );
  });

  it("is not one for a new tab, a download, another site, the app's data routes, or this page", () => {
    for (const [click, to] of [
      [{ ...plain, button: 1 }, link("/?section=planning")],
      [{ ...plain, metaKey: true }, link("/?section=planning")],
      [{ ...plain, ctrlKey: true }, link("/?section=planning")],
      [{ ...plain, shiftKey: true }, link("/?section=planning")],
      [{ ...plain, altKey: true }, link("/?section=planning")],
      [{ ...plain, defaultPrevented: true }, link("/?section=planning")],
      [plain, link("/?section=planning", { target: "_blank" })],
      [plain, link("/?section=planning", { download: true })],
      [plain, link("https://example.org/")],
      [plain, link("mailto:someone@example.org")],
      [plain, link("javascript:void(0)")],
      [plain, link("/workspace/workpapers/export?workpaper=1")],
      [plain, link("/workspace/evidence-files/1/preview")],
      [plain, link(HERE)],
      [plain, link(`${HERE}#section-6`)],
      [plain, link("#section-6")],
      [plain, link("http://[bad")],
    ] as const) {
      assert.equal(guardedHref(click, to, HERE), null, JSON.stringify(to));
    }
    // A link that opens in this same frame by name is still a way out.
    assert.equal(
      guardedHref(plain, link("/?section=planning", { target: "_self" }), HERE),
      "/?section=planning",
    );
  });
});

describe("the router that asks first", () => {
  const source = readFileSync("apps/web/src/guarded-router.ts", "utf8");

  it("asks before it goes anywhere, and never before a refresh", () => {
    for (const way of ["push", "replace"]) {
      assert.match(
        source,
        new RegExp(
          `${way}: \\(\\.\\.\\.args: Parameters<typeof router\\.${way}>\\) =>\\s*leaving\\(\\(\\) => router\\.${way}\\(\\.\\.\\.args\\)\\)`,
        ),
      );
    }
    assert.match(source, /back: \(\) => leaving\(\(\) => router\.back\(\)\)/);
    assert.match(
      source,
      /forward: \(\) => leaving\(\(\) => router\.forward\(\)\)/,
    );
    assert.equal(/refresh:/.test(source), false);
  });

  it("holds a link's click only while it is active, and goes where the link went", () => {
    assert.match(source, /if \(!active\) \{\s*return;\s*\}/);
    assert.match(
      source,
      /document\.addEventListener\("click", onClick, true\);/,
    );
    assert.match(
      source,
      /return \(\) => document\.removeEventListener\("click", onClick, true\);/,
    );
    assert.match(
      source,
      /if \(href === null\) \{\s*return;\s*\}\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*leaving\(\(\) => router\.push\(href\)\);/,
    );
  });
});
