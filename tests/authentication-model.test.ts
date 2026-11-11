import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  authRequest,
  nextSetting,
  type Profile,
  parseProfile,
  requiredLeft,
} from "../apps/web/src/authentication-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const CONTROL = "33333333-3333-4333-8333-333333333333";
const ids = { organization_id: ORG, project_id: PROJECT, control_id: CONTROL };
const path = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/authentication`;

const setting = (key: string, value = "", required = true) => ({
  key,
  label: key,
  question: `${key}?`,
  options: ["A", "B"],
  why: "",
  required,
  value,
});

describe("the sign-in settings (product owner, 10 November 2026)", () => {
  it("reads, saves setting by setting, and reads the policy, checked before sending", () => {
    assert.deepEqual(authRequest({ ...ids, intent: "read" }), {
      method: "GET",
      path,
      body: null,
    });
    assert.deepEqual(authRequest({ ...ids, intent: "read-policy" }), {
      method: "POST",
      path: `${path}/read-policy`,
      body: null,
    });
    assert.deepEqual(
      authRequest({
        ...ids,
        intent: "save",
        values: { "pw-length": " 12 characters " },
      }),
      {
        method: "PUT",
        path,
        body: { values: { "pw-length": "12 characters" } },
      },
    );
    for (const bad of [
      { intent: "save", values: {} },
      { intent: "save", values: { "Bad Key": "x" } },
      { intent: "save", values: { "auth-idp": "password=Hunter2Hunter2" } },
      { intent: "save", values: { "auth-idp": "x".repeat(121) } },
      { intent: "delete" },
    ]) {
      assert.deepEqual(authRequest({ ...ids, ...bad }), { error: "invalid" });
    }
    assert.deepEqual(authRequest({ ...ids, control_id: "x", intent: "read" }), {
      error: "invalid",
    });
  });

  it("reads the API's profile", () => {
    const profile = parseProfile({
      method: "Local sign-in",
      settings: [setting("auth-signin", "Local sign-in"), { label: "no key" }],
      complete: false,
      composed: "",
      policies: [{ id: "p1", title: "Information Security Standard" }, {}],
    });
    assert.ok(profile !== null);
    assert.deepEqual(
      profile.settings.map((s) => s.key),
      ["auth-signin"],
    );
    assert.deepEqual(profile.policies, [
      { id: "p1", title: "Information Security Standard" },
    ]);
    assert.equal(parseProfile({ settings: "x" }), null);
    assert.equal(parseProfile(null), null);
  });

  it("goes to the next required setting not answered, then the optional ones", () => {
    // In the API's order: how users sign in, the required settings, then the optional ones.
    const profile: Profile = {
      method: "Local sign-in",
      settings: [
        setting("auth-signin", "Local sign-in"),
        setting("pw-length", "12 characters"),
        setting("pw-lockout"),
        setting("auth-mfa"),
        setting("pw-lockout-duration", "", false),
      ],
      complete: false,
      composed: "",
      policies: [],
    };
    assert.equal(nextSetting(profile, -1), 2);
    assert.equal(nextSetting(profile, 2), 3);
    // After the last required one, the optional one.
    assert.equal(nextSetting(profile, 3), 4);
    assert.equal(nextSetting(profile, 4), profile.settings.length);
    assert.equal(requiredLeft(profile), 2);
    // A required one skipped is offered before an optional one.
    assert.equal(nextSetting(profile, 0), 2);
    const answered = {
      ...profile,
      settings: profile.settings.map((s) =>
        s.required ? { ...s, value: s.value || "x" } : s,
      ),
    };
    assert.equal(requiredLeft(answered), 0);
    assert.equal(nextSetting(answered, -1), 4);
  });
});
