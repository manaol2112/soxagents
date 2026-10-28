import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  addressOf,
  checkOwner,
  confirmLines,
  initialsOf,
  matchOwners,
  outsideDomains,
  ownerOf,
  parseSendResult,
  personOf,
  recipientChoices,
  requests,
  reviewPlan,
  routingOf,
  sendBody,
  sentReport,
  shortTitle,
  withTitles,
} from "../apps/web/src/control-send-model.ts";

// Approve and send a control's requests from its Request step, to its owner (decided by
// the product owner on 28 October 2026).

const answer = {
  preview: true,
  control_ref: "ITGC-AC-01",
  control_title: "User Access Provisioning and Approval",
  contacts: [
    { name: "Jordan Lee", email: "jordan.lee@example.com", role: "IT Manager" },
    { name: "Alex Morgan", email: "alex.morgan@example.com", role: "" },
    { name: "", email: "it-ops@example.com", role: "" },
    { name: "No address", email: "not-an-email", role: "" },
  ],
  domains: ["example.com"],
  needs_owner: false,
  owner_name: "Dana Reyes",
  owner_email: "dana.reyes@client.example",
  drafts: 2,
  targets: [
    {
      id: "g1",
      reference: "PBC-AAAA1111",
      title: "Access policy and one traced grant",
      recipient: "dana.reyes@client.example",
      other_controls: ["ITGC-AC-03", "ITGC-AC-05"],
      ok: true,
      detail: "Ready to approve and send.",
    },
    {
      id: "r2",
      reference: "PBC-BBBB2222",
      title: "HR termination listing",
      recipient: "dana.reyes@client.example",
      other_controls: [],
      ok: false,
      detail: "Assign a recipient.",
    },
  ],
  done: 1,
  refused: 1,
};

describe("assigning a control owner (28 October 2026)", () => {
  const result = parseSendResult(answer);
  const people = result?.contacts ?? [];

  it("offers the engagement's people with an address, and names the control", () => {
    assert.equal(result?.controlRef, "ITGC-AC-01");
    assert.equal(result?.controlTitle, "User Access Provisioning and Approval");
    assert.deepEqual(
      people.map((p) => p.email),
      [
        "jordan.lee@example.com",
        "alex.morgan@example.com",
        "it-ops@example.com",
      ],
    );
  });

  it("searches by name, email or role", () => {
    assert.deepEqual(
      matchOwners(people, "alex").map((p) => p.name),
      ["Alex Morgan"],
    );
    assert.deepEqual(
      matchOwners(people, "manager").map((p) => p.name),
      ["Jordan Lee"],
    );
    assert.equal(matchOwners(people, "").length, 3);
    assert.deepEqual(matchOwners(people, "nobody"), []);
  });

  it("shows initials, and owns by name, or by address with none on record", () => {
    assert.equal(initialsOf({ name: "Jordan Lee", email: "" }), "JL");
    assert.equal(initialsOf({ name: "", email: "it-ops@example.com" }), "IO");
    assert.deepEqual(ownerOf(people[2] ?? { name: "", email: "", role: "" }), {
      name: "it-ops@example.com",
      email: "it-ops@example.com",
    });
  });
});

describe("one confirmation when an owner is needed (28 October 2026)", () => {
  const view = readFileSync("apps/web/src/control-send.tsx", "utf8");

  it("is the reference's owner step, and Assign owner sends", () => {
    // Assign owner sets the owner and sends: no second confirmation, no list of codes.
    assert.match(
      view,
      /onSend=\{\(chosen\) => \{\s*setOwner\(chosen\);\s*void send\(chosen\);/,
    );
    assert.match(view, /No request will be sent until you continue\./);
    assert.match(view, /Assign owner\s*<UiIcon name="arrow"/);
    assert.doesNotMatch(view, /co-plan|Assign owner and send|onAssign=/);
  });

  it("names requests by their titles, never a reference to look up", () => {
    const model = readFileSync("apps/web/src/control-send-model.ts", "utf8");
    assert.doesNotMatch(model, /\$\{target\.reference\}|\$\{t\.reference\}/);
  });
});

describe("review and send requests (the reference, 28 October 2026)", () => {
  const held = {
    ...answer,
    targets: [
      { ...answer.targets[0], phase: "DESIGN" },
      {
        ...answer.targets[1],
        ok: false,
        waiting: true,
        phase: "INTERIM",
        detail:
          "Will become available after design and implementation testing and interim release.",
      },
      {
        id: "r3",
        reference: "PBC-CCCC3333",
        title: "Change tickets",
        recipient: "dana.reyes@client.example",
        other_controls: [],
        ok: false,
        waiting: false,
        phase: "DESIGN",
        detail: "E8 evidences no approved attribute of the test plan.",
      },
    ],
  };

  it("splits what goes now, what is scheduled for its phase, and what a check holds", () => {
    const result = parseSendResult(held);
    assert.ok(result !== null);
    const plan = reviewPlan(result);
    assert.deepEqual(
      plan.sending.map((s) => [s.title, s.recipient, s.others]),
      [
        [
          "Access policy and one traced grant",
          "dana.reyes@client.example",
          ["ITGC-AC-03", "ITGC-AC-05"],
        ],
      ],
    );
    assert.deepEqual(
      plan.later.map((l) => [l.title, l.note]),
      [
        [
          "HR termination listing",
          "Will become available after design and implementation testing and interim release.",
        ],
      ],
    );
    assert.deepEqual(
      plan.attention.map((a) => a.title),
      ["Change tickets"],
    );
    assert.equal(
      plan.laterLead,
      "These requests will be sent after design and implementation testing is released.",
    );
    assert.equal(plan.emails, 1);
  });

  it("reads a title without the window it ends with, and counts requests", () => {
    assert.equal(
      shortTitle("All access grants and changes, 1 Jan to 30 Sep 2027"),
      "All access grants and changes",
    );
    assert.equal(
      shortTitle("How the control is designed and works"),
      "How the control is designed and works",
    );
    assert.equal(requests(1), "1 request");
    assert.equal(requests(2), "2 requests");
  });

  it("sends only once the reviewer confirms the details", () => {
    const view = readFileSync("apps/web/src/control-send.tsx", "utf8");
    assert.match(view, /I have reviewed the recipient and request details/);
    assert.match(view, /disabled=\{!reviewed\}/);
    assert.match(view, /Review and send requests/);
  });
});

describe("approve and send from the Request step", () => {
  it("reads the API's answer, and refuses anything else", () => {
    const result = parseSendResult(answer);
    assert.ok(result !== null);
    assert.equal(result.needsOwner, false);
    assert.deepEqual(result.targets[0]?.otherControls, [
      "ITGC-AC-03",
      "ITGC-AC-05",
    ]);
    assert.equal(parseSendResult(null), null);
    assert.equal(parseSendResult({ targets: "x" }), null);
  });

  it("asks for a named owner with a valid email", () => {
    assert.deepEqual(
      checkOwner("  Dana   Reyes ", " Dana.Reyes@Client.example "),
      {
        name: "Dana Reyes",
        email: "dana.reyes@client.example",
      },
    );
    assert.deepEqual(checkOwner("", "dana@client.example"), {
      problem: "Name the control owner.",
    });
    assert.deepEqual(checkOwner("Dana", "dana"), {
      problem: "Give the owner's email address.",
    });
  });

  it("checks first, and sends with the owner only when one was named", () => {
    assert.deepEqual(sendBody(true, null), { preview: true });
    assert.deepEqual(sendBody(false, { name: "Dana", email: "d@c.example" }), {
      preview: false,
      owner_name: "Dana",
      owner_email: "d@c.example",
    });
  });

  it("says who each email goes to and what travels with it, and what waits", () => {
    const result = parseSendResult(answer);
    assert.ok(result !== null);
    assert.deepEqual(confirmLines(result), {
      ready: [
        "Access policy and one traced grant to dana.reyes@client.example, with ITGC-AC-03, ITGC-AC-05 in the same email",
      ],
      waiting: [
        {
          title: "HR termination listing",
          reason: "Assign a recipient.",
          held: false,
        },
      ],
    });
  });

  it("reports what went and to whom, plainly; a refused request is not sent, with why", () => {
    // Rewritten for the product owner's correction of 28 October 2026 ("why Some???"):
    // was the title "Some requests were sent" with every unsent request under "Not sent
    // yet"; now the count that went and to whom, and only a request a check refused is
    // "Not sent". The facts reported (what went, what did not and why) are unchanged.
    const result = parseSendResult(answer);
    assert.ok(result !== null);
    assert.deepEqual(sentReport(result), {
      tone: "attention",
      title: "1 of 2 requests sent",
      lead: "Approved and emailed to dana.reyes@client.example. Replies and evidence will appear in the Evidence center.",
      scheduled: [],
      scheduledLead:
        "These requests will be sent once their phase is released.",
      problems: [
        { title: "HR termination listing", reason: "Assign a recipient." },
      ],
    });
    const none = {
      ...result,
      targets: result.targets.map((t) => ({ ...t, ok: false })),
    };
    assert.equal(sentReport(none).title, "Not sent");
    assert.equal(
      sentReport(none).lead,
      "No request was sent. Resolve what is below, then approve and send again.",
    );
    const all = {
      ...result,
      targets: result.targets.map((t) => ({
        ...t,
        ok: true,
        recipient: "jordan.lee@example.com",
      })),
    };
    assert.deepEqual(sentReport(all).problems, []);
    assert.equal(sentReport(all).title, "2 requests sent");
    assert.equal(sentReport(all).tone, "success");
    assert.match(sentReport(all).lead, /emailed to Jordan Lee\./);
  });

  it("says a request scheduled for its phase is still scheduled, not unsent", () => {
    // The product owner's case: the design request went, the interim one waits.
    const result = parseSendResult(answer);
    assert.ok(result !== null);
    const sent = withTitles(
      {
        ...result,
        targets: [
          {
            ...(result.targets[0] as (typeof result.targets)[number]),
            phase: "DESIGN",
          },
          {
            ...(result.targets[1] as (typeof result.targets)[number]),
            ok: false,
            waiting: true,
            phase: "INTERIM",
            detail:
              "Will become available after design and implementation testing and interim release.",
          },
        ],
      },
      {
        r2: {
          title: "All access grants and changes, 1 Jan to 30 Sep 2027",
          period: "Jan 1, 2027 – Sep 30, 2027",
        },
      },
    );
    const report = sentReport(sent);
    assert.equal(report.title, "Request sent");
    assert.equal(report.tone, "success");
    assert.doesNotMatch(`${report.title} ${report.lead}`, /Some|Not sent/);
    assert.deepEqual(report.problems, []);
    assert.deepEqual(report.scheduled, [
      {
        title: "All access grants and changes",
        period: "Jan 1, 2027 – Sep 30, 2027",
      },
    ]);
    assert.equal(
      report.scheduledLead,
      "These requests will be sent after design and implementation testing is released.",
    );
    const only = sentReport({ ...sent, targets: sent.targets.slice(1) });
    assert.equal(only.title, "Nothing to send yet");
    assert.equal(only.tone, "waiting");
    const view = readFileSync("apps/web/src/control-send.tsx", "utf8");
    assert.match(view, /Still scheduled/);
    assert.doesNotMatch(view, /Some requests/);
  });

  it("names each request as the list does, not by a code (28 October 2026)", () => {
    const result = parseSendResult(answer);
    assert.ok(result !== null);
    const titled = withTitles(result, {
      r2: {
        title: "All access grants, 1 Jan to 30 Sep 2027",
        period: "Jan 1, 2027 – Sep 30, 2027",
      },
    });
    assert.equal(titled.targets[1]?.period, "Jan 1, 2027 – Sep 30, 2027");
    assert.deepEqual(
      titled.targets.map((t) => t.title),
      [
        "Access policy and one traced grant",
        "All access grants, 1 Jan to 30 Sep 2027",
      ],
    );
  });

  it("is offered on the Request step in place of the trip to the Evidence center", () => {
    const view = readFileSync(
      "apps/web/src/evidence-requests-view.tsx",
      "utf8",
    );
    assert.match(
      view,
      /canAct && drafted \? \(\s*<ControlSend ids=\{ids\} titles=\{requestTitles\} \/>/,
    );
    assert.doesNotMatch(view, /Approve and send in the Evidence center/);
  });
});

describe("changing who a request goes to in the review (28 October 2026)", () => {
  const result = parseSendResult(answer);
  const people = result?.contacts ?? [];

  it("sends only the rows whose recipient or copies changed, never the recipient copied", () => {
    const plan = [
      { id: "g1", recipient: "dana.reyes@client.example" },
      { id: "r2", recipient: "dana.reyes@client.example" },
      { id: "r3", recipient: "dana.reyes@client.example" },
    ];
    assert.deepEqual(
      routingOf(plan, {
        g1: { recipient: "jordan.lee@example.com", cc: [] },
        r2: {
          recipient: "dana.reyes@client.example",
          cc: [
            "alex.morgan@example.com",
            "alex.morgan@example.com",
            "dana.reyes@client.example",
          ],
        },
        r3: { recipient: "dana.reyes@client.example", cc: [] },
      }),
      [
        { id: "g1", recipient: "jordan.lee@example.com", cc: [] },
        {
          id: "r2",
          recipient: "dana.reyes@client.example",
          cc: ["alex.morgan@example.com"],
        },
      ],
    );
    assert.deepEqual(routingOf(plan, {}), []);
  });

  it("carries the changes, with the owner only when asked", () => {
    const routing = [{ id: "g1", recipient: "jordan.lee@example.com", cc: [] }];
    assert.deepEqual(sendBody(false, null, routing), {
      preview: false,
      routing,
    });
    assert.deepEqual(
      sendBody(false, personOf("jordan.lee@example.com", people), routing),
      {
        preview: false,
        owner_name: "Jordan Lee",
        owner_email: "jordan.lee@example.com",
        routing,
      },
    );
    assert.deepEqual(sendBody(false, null, []), { preview: false });
  });

  it("offers the contacts not already on the request, then a typed address", () => {
    assert.deepEqual(
      recipientChoices(people, "", ["jordan.lee@example.com"]).map(
        (p) => p.email,
      ),
      ["alex.morgan@example.com", "it-ops@example.com"],
    );
    assert.deepEqual(recipientChoices(people, " Sam@Client.example ", []), [
      { name: "", email: "sam@client.example", role: "" },
    ]);
    // A contact's own address is offered as the contact, once.
    assert.deepEqual(
      recipientChoices(people, "alex.morgan@example.com", []).map(
        (p) => p.name,
      ),
      ["Alex Morgan"],
    );
    assert.deepEqual(recipientChoices(people, "sam@", []), []);
    assert.equal(addressOf("not an address"), null);
  });

  it("names the new owner as a contact, or by the address", () => {
    assert.deepEqual(personOf("sam@client.example", people), {
      name: "sam@client.example",
      email: "sam@client.example",
    });
  });

  it("flags an address outside the client's domains", () => {
    assert.equal(outsideDomains("a@example.com", ["example.com"]), false);
    assert.equal(outsideDomains("a@eu.example.com", ["Example.com"]), false);
    assert.equal(outsideDomains("a@gmail.com", ["example.com"]), true);
    assert.equal(outsideDomains("a@gmail.com", []), false);
  });

  it("changes in place, asks for the review again, and sends the changes", () => {
    const view = readFileSync("apps/web/src/control-send.tsx", "utf8");
    assert.match(view, /Change\s*<\/button>/);
    assert.match(view, /Add recipient/);
    assert.match(view, /Also make them the control owner/);
    assert.match(view, /setReviewed\(false\)/);
    assert.match(view, /onSend\(routingOf\(plan\.sending, edits\), newOwner\)/);
    const route = readFileSync(
      "apps/web/app/workspace/control-send/route.ts",
      "utf8",
    );
    assert.match(route, /send\.routing = rest\.routing/);
  });
});
