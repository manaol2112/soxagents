import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  centerHref,
  centerWrite,
  DEFAULT_QUERY,
  parseCenterQuery,
} from "../apps/web/src/evidence-center-model.ts";
import {
  assignSummary,
  chooseAll,
  chosen,
  initialChoices,
  parseOwners,
  sections,
} from "../apps/web/src/evidence-owners-model.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const A = "33333333-3333-4333-8333-333333333333";
const B = "44444444-4444-4444-8444-444444444444";
const C = "55555555-5555-4555-8555-555555555555";
const ids = { organizationId: ORG, projectId: PROJECT };

const item = (id: string, ref: string, suggestion: unknown) => ({
  id,
  version: 3,
  reference: `PBC-${id.slice(-8).toUpperCase()}`,
  control_id: id,
  control_ref: ref,
  control_title: `${ref} title`,
  system: "SAP ERP",
  phase: "DESIGN",
  suggestion,
});

const api = {
  items: [
    item(A, "ITGC-AC-03", {
      name: "Access owner",
      email: "iam@client.example",
      source: "CONTROL_OWNER",
      label: "Control owner in the RCM",
    }),
    item(B, "ITGC-CM-04", {
      name: "",
      email: "Maria.Chen@client.example",
      source: "SAME_SYSTEM",
      label: "Receives the change management requests for SAP ERP",
    }),
    item(C, "ITGC-AC-06", null),
  ],
  contacts: [
    {
      name: "Dana Reyes",
      email: "dana@client.example",
      role: "",
      source: "CONTACT",
    },
  ],
  domains: ["client.example"],
};

describe("assigning owners", () => {
  it("reads the suggestions, with their sources, and none where no record names one", () => {
    const owners = parseOwners(api);
    assert.ok(owners !== null);
    assert.equal(
      owners.items[1]?.suggestion?.email,
      "maria.chen@client.example",
    );
    assert.equal(owners.items[2]?.suggestion, null);
    // A suggestion that is not an address, or from an unknown source, is no suggestion.
    const odd = parseOwners({
      ...api,
      items: [
        item(A, "X-1", { email: "nobody", source: "CONTROL_OWNER", label: "" }),
      ],
    });
    assert.equal(odd?.items[0]?.suggestion, null);
    assert.equal(parseOwners({ items: "nope" }), null);
  });

  it("starts with every suggestion confirmed and nothing chosen without one", () => {
    const owners = parseOwners(api);
    assert.ok(owners !== null);
    const choices = initialChoices(owners.items);
    assert.deepEqual(chosen(owners.items, choices), [
      { id: A, version: 3, recipient: "iam@client.example" },
      { id: B, version: 3, recipient: "maria.chen@client.example" },
    ]);
    // One section per suggested person, then the requests with no suggestion.
    assert.deepEqual(
      sections(owners.items).map((s) => [s.email, s.items.length, s.labels]),
      [
        ["iam@client.example", 1, ["Control owner in the RCM"]],
        [
          "maria.chen@client.example",
          1,
          ["Receives the change management requests for SAP ERP"],
        ],
        ["", 1, []],
      ],
    );
  });

  it("changes one, or a whole section, and leaves out what is unchecked", () => {
    const owners = parseOwners(api);
    assert.ok(owners !== null);
    let choices = initialChoices(owners.items);
    choices = chooseAll(choices, [C], "Dana@Client.Example");
    choices = {
      ...choices,
      [B]: { recipient: "maria.chen@client.example", include: false },
    };
    choices = {
      ...choices,
      [A]: { recipient: "dana@client.example", include: true },
    };
    assert.deepEqual(chosen(owners.items, choices), [
      { id: A, version: 3, recipient: "dana@client.example" },
      { id: C, version: 3, recipient: "dana@client.example" },
    ]);
    assert.equal(assignSummary(2, 0), "2 requests assigned.");
    assert.equal(
      assignSummary(1, 1),
      "1 request assigned; 1 request could not change.",
    );
  });

  it("opens in the address and confirms each request with its own owner, checked", () => {
    const href = centerHref(ids, DEFAULT_QUERY, { assigning: true });
    const params = new URL(href, "http://x").searchParams;
    assert.equal(params.get("rassign"), "1");
    assert.equal(parseCenterQuery((name) => params.get(name)).assigning, true);
    const base = {
      organization_id: ORG,
      project_id: PROJECT,
      intent: "owners-assign",
    };
    const items = [
      { id: A, version: 3, recipient: "Dana@Client.Example" },
      { id: B, version: 3, recipient: "maria.chen@client.example" },
    ];
    assert.deepEqual(centerWrite({ ...base, items }), {
      intent: "owners-assign",
      path: `/organizations/${ORG}/projects/${PROJECT}/evidence-owners/assign`,
      body: {
        items: [
          { id: A, version: 3, recipient: "dana@client.example" },
          { id: B, version: 3, recipient: "maria.chen@client.example" },
        ],
      },
    });
    for (const bad of [
      [{ id: A, version: 3, recipient: "not an address" }],
      [{ id: "x", version: 3, recipient: "a@client.example" }],
      [items[0], items[0]],
      [],
    ]) {
      assert.deepEqual(centerWrite({ ...base, items: bad }), {
        error: "invalid",
      });
    }
  });
});
