import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseSignInNotice,
  parseSignInProviders,
  providerHref,
} from "../apps/web/src/sign-in-model.ts";

describe("the sign-in page's providers", () => {
  it("reads the providers the API offers", () => {
    const parsed = parseSignInProviders({
      providers: [
        { id: "google", label: "Google", login_path: "/auth/google/login" },
        { id: "entra", label: "Microsoft", login_path: "/auth/login" },
      ],
      preview: true,
    });
    assert.deepEqual(parsed, {
      providers: [
        { id: "google", label: "Google", loginPath: "/auth/google/login" },
        { id: "entra", label: "Microsoft", loginPath: "/auth/login" },
      ],
      preview: true,
    });
    assert.equal(
      providerHref("http://127.0.0.1:8000", parsed, "google"),
      "http://127.0.0.1:8000/auth/google/login",
    );
    assert.equal(providerHref("http://127.0.0.1:8000", null, "google"), null);
  });

  it("treats an unknown provider or an odd login path as unknown", () => {
    assert.equal(
      parseSignInProviders({
        providers: [{ id: "other", label: "X", login_path: "/auth/x" }],
        preview: false,
      }),
      null,
    );
    assert.equal(
      parseSignInProviders({
        providers: [
          { id: "google", label: "Google", login_path: "https://evil.example" },
        ],
        preview: false,
      }),
      null,
    );
    assert.equal(parseSignInProviders({ providers: [] }), null);
    assert.equal(parseSignInProviders(null), null);
    assert.deepEqual(parseSignInProviders({ providers: [], preview: false }), {
      providers: [],
      preview: false,
    });
  });

  it("keeps only the notices the API sends back", () => {
    assert.equal(parseSignInNotice("failed"), "failed");
    assert.equal(parseSignInNotice("unlinked"), "unlinked");
    assert.equal(parseSignInNotice("disabled"), "disabled");
    assert.equal(parseSignInNotice("sent"), null);
    assert.equal(parseSignInNotice(null), null);
  });
});
