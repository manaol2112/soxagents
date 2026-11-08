import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

/** A colour token as [r, g, b, alpha]: hex, rgb() with an alpha, or var() of another. */
function rgbaOf(map: Map<string, string>, name: string, depth = 0): number[] {
  const value = map.get(name) ?? "";
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  if (alias && depth < 4) {
    return rgbaOf(map, alias[1] ?? "", depth + 1);
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const h = hex[1] ?? "";
    return [0, 2, 4]
      .map((at) => Number.parseInt(h.slice(at, at + 2), 16))
      .concat(1);
  }
  const rgb = /^rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)%\)$/.exec(value);
  if (rgb) {
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      Number(rgb[4]) / 100,
    ];
  }
  assert.fail(`${name} is not a colour this test reads: "${value}"`);
}

/** A colour laid over a solid ground, as it renders. */
function over(top: number[], ground: number[]): number[] {
  const a = top[3] ?? 1;
  return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (ground[i] ?? 0) * (1 - a));
}

function ratio(a: number[], b: number[]): number {
  const lum = (c: number[]) => {
    const [r, g, bl] = c.slice(0, 3).map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0);
  };
  const [high, low] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}

/** Every text colour at 4.5:1 on each ground and tinted row, and each status colour on
 * its own tint (WCAG 2.2 1.4.3; product owner, 2 November 2026: chips, badges and muted
 * text first). */
function shortfalls(map: Map<string, string>, link: string): string[] {
  const short: string[] = [];
  const surface = rgbaOf(map, "--surface");
  const grounds = [
    "--canvas",
    "--surface",
    "--surface-hover",
    "--surface-muted",
  ].map((name) => [name, over(rgbaOf(map, name), surface)] as const);
  const tints = [
    "--accent-soft",
    "--success-soft",
    "--warning-soft",
    "--danger-soft",
    "--ai-soft",
  ].map((name) => [name, over(rgbaOf(map, name), surface)] as const);
  const texts = [
    "--text-strong",
    "--text",
    "--text-secondary",
    "--text-tertiary",
    link,
  ];
  for (const [ground, colour] of [...grounds, ...tints]) {
    for (const text of texts) {
      const value = ratio(over(rgbaOf(map, text), colour), colour);
      if (value < 4.5) short.push(`${text} on ${ground}: ${value.toFixed(2)}`);
    }
  }
  for (const tone of ["success", "warning", "danger", "ai"]) {
    for (const [ground, colour] of [
      ...grounds,
      [`--${tone}-soft`, over(rgbaOf(map, `--${tone}-soft`), surface)] as const,
    ]) {
      const value = ratio(rgbaOf(map, `--${tone}`), colour);
      if (value < 4.5)
        short.push(`--${tone} on ${ground}: ${value.toFixed(2)}`);
    }
  }
  return short;
}

describe("text contrast in every theme (WCAG 2.2 AA)", () => {
  const light = tokens(":root,\n.theme-light");
  const dark = new Map([
    ...light,
    ...tokens(':root[data-theme="dark"]:not(:has(.theme-light))'),
  ]);
  const workspace = new Map([
    ...light,
    ...tokens(':root[data-theme="light"]:not(:has(.theme-light))'),
  ]);

  it("keeps the dark theme's text, muted text and chips at 4.5:1, tints included", () => {
    assert.deepEqual(shortfalls(dark, "--accent-text"), []);
  });

  it("keeps the light themes' text, muted text and chips at 4.5:1, tints included", () => {
    assert.deepEqual(shortfalls(light, "--accent-text"), []);
    assert.deepEqual(shortfalls(workspace, "--accent-text"), []);
  });

  it("never colours text with the accent fill, which reads 3.4:1 on dark", () => {
    const sheets = new URL("../apps/web/app/", import.meta.url);
    const offenders: string[] = [];
    for (const name of readdirSync(sheets).filter((file) =>
      file.endsWith(".css"),
    )) {
      const css = readFileSync(new URL(name, sheets), "utf8");
      for (const match of css.matchAll(
        /(?<![\w-])color:\s*var\(--(accent|ink)\)/g,
      )) {
        offenders.push(`${name}: ${match[0]}`);
      }
    }
    assert.deepEqual(offenders, []);
  });
});
