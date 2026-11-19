import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { workspacePath } from "../apps/web/src/last-page-model.ts";
import {
  parseSignInNotice,
  returnAddress,
  SIGN_IN_LEADS,
  SIGN_IN_NOTICES,
  signedOutRedirect,
  signInAddress,
  signInLead,
  withReturn,
} from "../apps/web/src/sign-in-model.ts";

// A signed-out visitor never sees the workspace's frame: the workspace sends them to sign
// in, and signing in brings them back to the address they asked for (product owner, 19
// November 2026). The return address is a workspace address on this app or nothing.

const ORG = "11111111-1111-7111-8111-111111111111";
const PROJECT = "22222222-2222-7222-8222-222222222222";
const DEEP = `/?organization=${ORG}&project=${PROJECT}&section=controls&control=ITGC-01&step=test`;

// Every way an address could leave the app or open another page. The API refuses the same
// list (services/api/tests/test_google.py, UNSAFE_RETURNS).
const UNSAFE = [
  "https://evil.example/",
  "http:/evil.example",
  "//evil.example/",
  "///evil.example",
  "/\\evil.example",
  "/?x=\\evil",
  "\\\\evil.example",
  "javascript:alert(1)",
  "/?x=a b",
  "/?x=\tb",
  "/?x=\nb",
  "/?x=\rb",
  "/?x=\u0000",
  "/?x=\u007f",
  "/?x=café",
  "/welcome",
  "/sign-in?next=/",
  "?organization=1",
  " /",
  "",
  `/?${"a".repeat(1999)}`,
];

describe("the return address", () => {
  it("keeps a workspace address on this app", () => {
    assert.equal(returnAddress("/"), "/");
    assert.equal(returnAddress(DEEP), DEEP);
    assert.equal(returnAddress(`/?${"a".repeat(1998)}`)?.length, 2000);
  });

  it("drops anything that could leave the app or open another page", () => {
    for (const unsafe of UNSAFE) {
      assert.equal(returnAddress(unsafe), null, JSON.stringify(unsafe));
    }
    assert.equal(returnAddress(null), null);
    assert.equal(returnAddress(["/"]), null);
    assert.equal(returnAddress(undefined), null);
  });

  it("is the page's own address without its passing parts", () => {
    assert.equal(
      workspacePath({
        organization: ORG,
        project: PROJECT,
        section: "controls",
        control: "ITGC-01",
        step: "test",
        notice: "denied",
      }),
      DEEP,
    );
    assert.equal(workspacePath({}), "/");
    assert.equal(workspacePath({ notice: "saved" }), "/");
    assert.equal(
      workspacePath({ organization: ORG, stage: ["PLANNED", "TESTING"] }),
      `/?organization=${ORG}&stage=PLANNED&stage=TESTING`,
    );
  });
});

describe("sending a signed-out visitor to sign in", () => {
  it("carries the deep link to the sign-in page", () => {
    assert.equal(
      signInAddress(DEEP),
      `/sign-in?next=${encodeURIComponent(DEEP)}`,
    );
    assert.equal(signInAddress("/"), "/sign-in");
    for (const unsafe of UNSAFE) {
      assert.equal(signInAddress(unsafe), "/sign-in", JSON.stringify(unsafe));
    }
  });

  it("sends every signed-out visit to sign in, a newcomer at the bare address to the landing page", () => {
    // A session the API no longer knows (expired or revoked): the sign-in page says the
    // session ended, and signing in comes back.
    assert.equal(
      signedOutRedirect({ signedOut: true, hasSession: true, path: DEEP }),
      `/sign-in?notice=expired&next=${encodeURIComponent(DEEP)}`,
    );
    assert.equal(
      signedOutRedirect({ signedOut: true, hasSession: true, path: "/" }),
      "/sign-in?notice=expired",
    );
    assert.equal(parseSignInNotice("expired"), "expired");
    assert.equal(SIGN_IN_NOTICES.expired, "Your session has ended.");
    // No session at all: a deep link still signs in and comes back, with no notice.
    assert.equal(
      signedOutRedirect({ signedOut: true, hasSession: false, path: DEEP }),
      `/sign-in?next=${encodeURIComponent(DEEP)}`,
    );
    // The bare address with no session is a newcomer (docs/development.md).
    assert.equal(
      signedOutRedirect({ signedOut: true, hasSession: false, path: "/" }),
      "/welcome",
    );
    // A member who is signed in and denied keeps the workspace's own message.
    assert.equal(
      signedOutRedirect({ signedOut: false, hasSession: true, path: DEEP }),
      null,
    );
  });

  it("puts the return on every way in, and only a safe one", () => {
    const api = "http://127.0.0.1:8000";
    assert.equal(
      withReturn(`${api}/auth/google/login`, DEEP),
      `${api}/auth/google/login?next=${encodeURIComponent(DEEP)}`,
    );
    assert.equal(
      withReturn(`${api}/auth/google/login`, null),
      `${api}/auth/google/login`,
    );
    assert.equal(
      withReturn(`${api}/auth/preview`, "//evil.example/"),
      `${api}/auth/preview`,
    );
  });
});

describe("the sign-in card's lead", () => {
  it("names the return for a member and never calls an ended session new", () => {
    assert.equal(signInLead(DEEP, null), "page");
    assert.equal(signInLead(DEEP, "expired"), "page");
    assert.equal(signInLead(DEEP, "failed"), "page");
    assert.equal(signInLead("/", "expired"), "workspace");
    assert.equal(signInLead(null, "expired"), "workspace");
    assert.equal(signInLead(null, null), "newcomer");
    assert.equal(signInLead(null, "failed"), "newcomer");
    assert.equal(
      SIGN_IN_LEADS.page,
      "You will return to the page you were on.",
    );
    assert.equal(SIGN_IN_LEADS.workspace, "You will return to your workspace.");
    assert.match(SIGN_IN_LEADS.newcomer, /^New here\?/);
  });
});

describe("the pages use the rule", () => {
  const page = readFileSync("apps/web/app/page.tsx", "utf8");
  const signIn = readFileSync("apps/web/app/sign-in/page.tsx", "utf8");
  const view = readFileSync("apps/web/src/sign-in-view.tsx", "utf8");

  it("the workspace redirects a signed-out visitor before drawing anything", () => {
    assert.match(page, /signedOutRedirect\(\{/);
    assert.match(page, /path: workspacePath\(params\)/);
    // Before the loaders and the frame: the check follows the workspace load directly.
    assert.ok(
      page.indexOf("signedOutRedirect({") < page.indexOf("loadWorkflow("),
    );
  });

  it("the proxy answers a signed-out page load before the page streams its frame", () => {
    const proxy = readFileSync("apps/web/proxy.ts", "utf8");
    assert.match(
      proxy,
      /if \(request\.method === "GET" && \(await signedOut\(request\)\)\) \{\s*const away = signedOutRedirect\(\{\s*signedOut: true,\s*hasSession: request\.cookies\.get\("aw_session"\)\?\.value !== undefined,\s*path: workspacePath\(params\),/,
    );
    // No cookie is signed out; a cookie is asked about on a page load, and only a 401 is a
    // sign-out (an API that cannot be reached is not).
    assert.match(proxy, /if \(raw === undefined\) \{\s*return true;\s*\}/);
    assert.match(
      proxy,
      /return \(await apiGet\("\/auth\/me", sessionToken\(raw\)\)\)\.status === 401;/,
    );
    // The app's own fetches are left to the page, which reads the session anyway.
    assert.match(proxy, /"sec-fetch-dest"\) === "empty"\) \{\s*return false;/);
    // After the older addresses move, so the return is the address that now holds the page.
    assert.ok(
      proxy.indexOf("route.redirect !== null") <
        proxy.indexOf("signedOutRedirect({"),
    );
  });

  it("the sign-in page checks the return and sends a signed-in member there", () => {
    assert.match(
      signIn,
      /const returnTo = returnAddress\(first\(params\[RETURN_PARAM\]\)\);/,
    );
    assert.match(signIn, /redirect\(returnTo \?\? "\/"\);/);
    assert.match(signIn, /returnTo=\{returnTo\}/);
  });

  it("every way in on the sign-in page carries the return", () => {
    const starts = view.match(/href=\{withReturn\(/g) ?? [];
    assert.equal(starts.length, 3);
    assert.doesNotMatch(view, /href=\{`\$\{apiBase\}/);
    assert.match(view, /SIGN_IN_LEADS\[signInLead\(returnTo, shownNotice\)\]/);
    // An ended session gives its reason before the lead.
    assert.match(
      view,
      /\{reasonFirst \? null : lead\}[\s\S]*si-notice[\s\S]*\{reasonFirst \? lead : null\}/,
    );
    assert.match(view, /const reasonFirst = shownNotice === "expired";/);
  });
});
