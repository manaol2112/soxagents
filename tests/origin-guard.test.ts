import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  allowedOrigins,
  ORIGIN_REFUSED,
  type OriginFacts,
  originRefusal,
} from "../apps/web/src/origin-guard.ts";

// Governance finding S3 (owner-approved design, 18 November 2026): the session cookie is
// SameSite=Lax, which a sibling subdomain does not stop, so a state-changing request is
// accepted only from the workspace's own origin.

const own = (over: Partial<OriginFacts> = {}): OriginFacts => ({
  method: "POST",
  origin: "https://audit.example.com",
  fetchSite: "same-origin",
  host: "audit.example.com",
  forwardedHost: null,
  allowed: [],
  ...over,
});

describe("a state-changing request is accepted only from the workspace's own origin", () => {
  it("accepts the workspace's own form posts and fetches", () => {
    assert.equal(originRefusal(own()), null);
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      assert.equal(originRefusal(own({ method })), null, method);
    }
    // Behind a reverse proxy: the browser's host arrives as X-Forwarded-Host.
    assert.equal(
      originRefusal(
        own({ host: "127.0.0.1:3000", forwardedHost: "audit.example.com" }),
      ),
      null,
    );
    // Local development, any port.
    assert.equal(
      originRefusal(
        own({ origin: "http://localhost:3000", host: "localhost:3000" }),
      ),
      null,
    );
  });

  it("refuses another origin, a sibling subdomain above all", () => {
    for (const origin of [
      "https://evil.example.net",
      "https://pages.example.com", // same site, another subdomain: what SameSite=Lax lets in
      "https://audit.example.com.evil.net",
      "http://audit.example.com:8443", // another port is another origin
      "null", // a sandboxed frame or a local file
      "not a url",
    ]) {
      assert.equal(originRefusal(own({ origin })), ORIGIN_REFUSED, origin);
    }
  });

  it("refuses a browser request that says it is cross-site even without an Origin", () => {
    assert.equal(
      originRefusal(own({ origin: null, fetchSite: "cross-site" })),
      ORIGIN_REFUSED,
    );
    assert.equal(
      originRefusal(own({ origin: null, fetchSite: "same-site" })),
      ORIGIN_REFUSED,
    );
    assert.equal(
      originRefusal(own({ origin: null, fetchSite: "same-origin" })),
      null,
    );
  });

  it("lets a server-to-server call (neither header) through to the route's own checks", () => {
    assert.equal(originRefusal(own({ origin: null, fetchSite: null })), null);
  });

  it("never refuses a request that changes nothing", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      assert.equal(
        originRefusal(own({ method, origin: "https://evil.example.net" })),
        null,
      );
    }
  });

  it("accepts an origin named in WEB_ALLOWED_ORIGINS, and only that one", () => {
    const allowed = allowedOrigins(
      " https://portal.example.org , https://x.example.org/ ",
    );
    assert.deepEqual(allowed, [
      "https://portal.example.org",
      "https://x.example.org/",
    ]);
    assert.equal(
      originRefusal(own({ origin: "https://portal.example.org", allowed })),
      null,
    );
    assert.equal(
      originRefusal(own({ origin: "https://other.example.org", allowed })),
      ORIGIN_REFUSED,
    );
    assert.deepEqual(allowedOrigins(undefined), []);
  });

  it("is applied by the proxy to every route but the static files", () => {
    const proxy = readFileSync(
      join(import.meta.dirname, "..", "apps", "web", "proxy.ts"),
      "utf8",
    );
    assert.match(proxy, /originRefusal\(\{/);
    assert.match(proxy, /status: 403/);
    // The refusal comes before the redirect table, so it covers every path.
    assert.ok(
      proxy.indexOf("originRefusal({") < proxy.indexOf("resolveRoute(params)"),
    );
    assert.match(
      proxy,
      /matcher: \["\/\(\(\?!_next\/static\|_next\/image\|favicon\\\\\.ico\)\.\*\)"\]/,
    );
  });
});
