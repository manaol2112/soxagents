import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { browserUrl } from "../apps/web/src/browser-url.ts";

function request(url: string, headers: Record<string, string>): Request {
  return new Request(url, { headers });
}

describe("redirects go where the browser came from", () => {
  it("uses the browser's host, not the address the server listens on", () => {
    const listening = request("http://0.0.0.0:3000/workspace/follow-ups", {
      host: "10.0.0.245:3000",
    });
    assert.equal(
      browserUrl("/", listening).toString(),
      "http://10.0.0.245:3000/",
    );
    const local = request("http://0.0.0.0:3000/workspace/setup", {
      host: "localhost:3000",
    });
    assert.equal(
      browserUrl("/welcome", local).toString(),
      "http://localhost:3000/welcome",
    );
  });

  it("follows a proxy's forwarded host and scheme", () => {
    const proxied = request("http://0.0.0.0:3000/x", {
      host: "internal:3000",
      "x-forwarded-host": "audit.example.com",
      "x-forwarded-proto": "https",
    });
    assert.equal(
      browserUrl("/", proxied).toString(),
      "https://audit.example.com/",
    );
  });

  it("ignores a malformed host", () => {
    const odd = request("http://127.0.0.1:3000/x", {
      "x-forwarded-host": "evil.example/path?x=1",
    });
    assert.equal(browserUrl("/", odd).host, "127.0.0.1:3000");
  });
});
