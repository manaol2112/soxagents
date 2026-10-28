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
    // navy, which is dark in both themes.
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

  it("refines the light workspace only, with tokens the shared light set names", () => {
    const light = tokens(":root,\n.theme-light");
    const workspace = tokens(
      ':root[data-theme="light"]:not(:has(.theme-light))',
    );
    assert.ok(workspace.size > 0);
    assert.deepEqual(
      [...workspace.keys()].filter((name) => !light.has(name)),
      [],
    );
    // Every light-only rule in the glass layer is scoped to the workspace shell or its
    // panes, so the portal and the public pages never pick it up.
    const glass = readFileSync(
      new URL("../apps/web/app/glass.css", import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n");
    const scoped = [
      ...glass.matchAll(/^\s*(:root\[data-theme="light"\][^{,]*)/gm),
    ].map((match) => (match[1] ?? "").trim());
    assert.ok(scoped.length > 0);
    for (const selector of scoped) {
      assert.match(selector, /^:root\[data-theme="light"\] (\.shell\b|\.as\b)/);
    }
  });

  it("keeps the light workspace's text at AA on its page and its surfaces", () => {
    const light = tokens(":root,\n.theme-light");
    const workspace = tokens(
      ':root[data-theme="light"]:not(:has(.theme-light))',
    );
    const value = (name: string) =>
      workspace.get(name) ?? light.get(name) ?? "";
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((at) => {
        const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
        return channel <= 0.03928
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    const contrast = (a: string, b: string) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
    };
    const short = [];
    for (const ground of ["--canvas", "--surface", "--surface-hover"]) {
      for (const text of [
        "--text-strong",
        "--text",
        "--text-secondary",
        "--text-tertiary",
        "--accent",
        "--success",
        "--warning",
        "--danger",
        "--ai",
      ]) {
        const ratio = contrast(value(ground), value(text));
        if (ratio < 4.5)
          short.push(`${text} on ${ground}: ${ratio.toFixed(2)}`);
      }
    }
    assert.deepEqual(short, []);
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
