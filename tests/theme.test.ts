import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseTheme,
  THEME_COOKIE,
  themeCookie,
} from "../apps/web/src/theme.ts";

const globals = readFileSync(
  new URL("../apps/web/app/globals.css", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

/** The custom properties a block declares, by name, with their values. */
function tokens(selector: string): Map<string, string> {
  const start = globals.indexOf(`${selector} {`);
  assert.ok(start >= 0, `no ${selector} block`);
  const body = globals.slice(start, globals.indexOf("\n}\n", start));
  const found = new Map<string, string>();
  for (const match of body.matchAll(/^\s+(--[\w-]+):\s*([^;]+);/gm)) {
    found.set(match[1] ?? "", (match[2] ?? "").trim());
  }
  return found;
}

describe("the workspace theme", () => {
  it("is dark unless light was chosen", () => {
    assert.equal(parseTheme(undefined), "dark");
    assert.equal(parseTheme(""), "dark");
    assert.equal(parseTheme("sepia"), "dark");
    assert.equal(parseTheme("dark"), "dark");
    assert.equal(parseTheme("light"), "light");
  });

  it("keeps the choice for a year on the whole site", () => {
    const cookie = themeCookie("light");
    assert.ok(cookie.startsWith(`${THEME_COOKIE}=light;`));
    assert.match(cookie, /Path=\/;/);
    assert.match(cookie, /Max-Age=31536000/);
    assert.match(cookie, /SameSite=Lax/);
  });

  it("gives every light color a dark value, or shares it on purpose", () => {
    const light = tokens(":root,\n.theme-light");
    const dark = tokens(':root[data-theme="dark"]:not(:has(.theme-light))');
    // Colors that read the same on both: they derive from another token, or sit on
    // the navy sidebar, which is dark in both themes.
    const shared = new Set(["--navy-text", "--navy-muted"]);
    const missing = [...light]
      .filter(([, value]) => /^(#|rgb)/.test(value))
      .map(([name]) => name)
      .filter((name) => !dark.has(name) && !shared.has(name));
    assert.deepEqual(missing, []);
    // And the dark theme names no token the light one lacks.
    assert.deepEqual(
      [...dark.keys()].filter((name) => !light.has(name)),
      [],
    );
  });

  it("keeps the client portal and the public pages light", () => {
    for (const [file, root] of [
      ["portal-view.tsx", 'className="pt theme-light"'],
      ["sign-in-view.tsx", 'className="si theme-light"'],
      ["welcome-view.tsx", 'className="lp theme-light"'],
    ] as const) {
      const source = readFileSync(
        new URL(`../apps/web/src/${file}`, import.meta.url),
        "utf8",
      );
      assert.ok(source.includes(root), `${file} is not marked light`);
    }
  });
});
