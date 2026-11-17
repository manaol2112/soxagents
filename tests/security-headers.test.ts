import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import config, {
  FRAME_POLICY,
  headers,
  SECURITY_HEADERS,
} from "../apps/web/next.config.ts";

// Next.js's own compiler of a custom route's source, so the paths below are matched the
// way the server matches them.
const fromWeb = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { buildCustomRoute } = fromWeb("next/dist/lib/build-custom-route.js") as {
  buildCustomRoute: (
    type: "header",
    route: { source: string; headers: { key: string; value: string }[] },
  ) => { regex: string };
};

type Header = { key: string; value: string };

/** The headers next.config.ts gives a path, the last of the same name winning. */
async function headersFor(path: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const route of await headers()) {
    const { regex } = buildCustomRoute("header", route);
    if (new RegExp(regex, "i").test(path)) {
      for (const header of route.headers as Header[]) {
        found.set(header.key.toLowerCase(), header.value);
      }
    }
  }
  return found;
}

describe("security headers (security review, 17 November 2026)", () => {
  it("are configured on the app", () => {
    assert.equal(config.headers, headers);
    assert.deepEqual(
      SECURITY_HEADERS.map((header) => [header.key, header.value]),
      [
        ["X-Content-Type-Options", "nosniff"],
        ["Referrer-Policy", "strict-origin-when-cross-origin"],
        ["X-Frame-Options", "DENY"],
      ],
    );
    assert.deepEqual(FRAME_POLICY, {
      key: "Content-Security-Policy",
      value: "frame-ancestors 'none'",
    });
  });

  it("forbid framing, sniffing and full referrers on every page and route", async () => {
    for (const path of [
      "/",
      "/welcome",
      "/sign-in",
      "/upload/abc123",
      "/portal/session",
      "/workspace/console/live",
      "/workspace/evidence-files/2b0c1d4e-0000-4000-8000-000000000000",
    ]) {
      const given = await headersFor(path);
      assert.equal(given.get("x-content-type-options"), "nosniff", path);
      assert.equal(
        given.get("referrer-policy"),
        "strict-origin-when-cross-origin",
        path,
      );
      assert.equal(given.get("x-frame-options"), "DENY", path);
      assert.equal(
        given.get("content-security-policy"),
        "frame-ancestors 'none'",
        path,
      );
    }
  });

  it("leave a sandboxed preview its own policy, which Next.js would otherwise drop", async () => {
    for (const path of [
      "/workspace/evidence-files/2b0c1d4e-0000-4000-8000-000000000000/preview",
      "/workspace/policy-file",
      "/workspace/request-attachment",
    ]) {
      const given = await headersFor(path);
      assert.equal(given.get("content-security-policy"), undefined, path);
      // Framing is still forbidden, here and in the route's own policy.
      assert.equal(given.get("x-frame-options"), "DENY", path);
      assert.equal(given.get("x-content-type-options"), "nosniff", path);
    }
    // A page that only begins like one of them gets the app-wide policy.
    const near = await headersFor("/workspace/policy-files-elsewhere");
    assert.equal(near.get("content-security-policy"), "frame-ancestors 'none'");
  });
});
