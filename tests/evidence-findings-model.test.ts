import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  attributeLabel,
  changesOf,
  composeFollowUp,
  decisionsFor,
  type EvidenceFinding,
  findingsForFile,
  findingsProblem,
  findingsWrite,
  latestNote,
  parseFindings,
} from "../apps/web/src/evidence-findings-model.ts";

// Evidence findings on the web (docs/evidence-intelligence.md, increment 2): parsed from
// the API, the decisions a status allows, the follow-up a person starts from, and the
// route's mapping to the API. Nothing is derived here.

const FILE = "0199a1b2-0000-7000-8000-000000000001";
const OTHER = "0199a1b2-0000-7000-8000-000000000002";
const FINDING = "0199a1b2-0000-7000-8000-00000000000a";
const CONTROL = "0199a1b2-0000-7000-8000-0000000000c0";
const ORG = "0199a1b2-0000-7000-8000-0000000000f0";
const PROJECT = "0199a1b2-0000-7000-8000-0000000000f1";

function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FINDING,
    file_id: FILE,
    file_name: "policy.txt",
    analysis_id: null,
    mapping_run_id: null,
    requirement_id: null,
    requirement_title: "",
    request_id: "0199a1b2-0000-7000-8000-0000000000e0",
    attribute_index: null,
    attribute_id: null,
    attribute_code: "",
    source: "READER",
    kind: "GAP",
    title: "Confirm the emergency access approval timeframe.",
    observation: "The timeframe is a placeholder.",
    question: "Please confirm the timeframe.",
    expected: "The approved section",
    citation: {
      file_id: FILE,
      file_name: "policy.txt",
      quote: "within [1] business day",
      location: "Page 3",
      page: 3,
      found: true,
    },
    plan_revision: 2,
    status: "PROPOSED",
    stale: false,
    stale_reason: "",
    sent_message_id: null,
    answered_by_message_id: null,
    answered_by_file_id: null,
    decided_by: null,
    decided_at: null,
    decision_note: "",
    created_at: "2026-10-30T10:00:00Z",
    updated_at: "2026-10-30T10:00:00Z",
    version: 1,
    events: [
      {
        event: "PROPOSED",
        actor_kind: "AGENT",
        actor: null,
        note: "",
        question: "Please confirm the timeframe.",
        points_at: {},
        created_at: "2026-10-30T10:00:00Z",
      },
    ],
    ...over,
  };
}

describe("parseFindings", () => {
  it("keeps a well-formed finding with its citation and history, and drops the rest", () => {
    const parsed = parseFindings({
      control_id: CONTROL,
      findings: [raw(), raw({ id: "nope" }), raw({ status: "WRONG" }), "x"],
    });
    assert.ok(parsed);
    assert.equal(parsed.length, 1);
    const finding = parsed[0] as EvidenceFinding;
    assert.equal(finding.kind, "GAP");
    assert.equal(finding.citation?.page, 3);
    assert.equal(finding.citation?.found, true);
    assert.equal(finding.events[0]?.actorKind, "AGENT");
    assert.equal(finding.planRevision, 2);
    assert.equal(parseFindings({ nope: true }), null);
    assert.equal(parseFindings(null), null);
  });
});

describe("findingsForFile", () => {
  it("lists a file's findings, what needs a person first, then the rest", () => {
    const parsed = parseFindings({
      control_id: CONTROL,
      findings: [
        raw({
          id: "0199a1b2-0000-7000-8000-000000000011",
          status: "RESOLVED",
          created_at: "2026-10-30T12:00:00Z",
        }),
        raw({
          id: "0199a1b2-0000-7000-8000-000000000012",
          status: "ACCEPTED",
          created_at: "2026-10-30T11:00:00Z",
        }),
        raw({
          id: "0199a1b2-0000-7000-8000-000000000013",
          status: "ANSWERED",
          created_at: "2026-10-30T09:00:00Z",
        }),
        raw({
          id: "0199a1b2-0000-7000-8000-000000000014",
          file_id: OTHER,
          citation: null,
        }),
        raw({
          id: "0199a1b2-0000-7000-8000-000000000015",
          file_id: null,
          citation: {
            file_id: FILE,
            file_name: "policy.txt",
            quote: "q",
            location: "",
            page: null,
            found: true,
          },
          status: "PROPOSED",
          created_at: "2026-10-30T08:00:00Z",
        }),
      ],
    });
    assert.ok(parsed);
    assert.deepEqual(
      findingsForFile(parsed, FILE).map((f) => f.status),
      ["ANSWERED", "PROPOSED", "ACCEPTED", "RESOLVED"],
    );
    assert.equal(findingsForFile(parsed, OTHER).length, 1);
  });
});

describe("decisions and notes", () => {
  it("offers the decisions a status allows, accept first, and reopen when closed", () => {
    assert.equal(decisionsFor("PROPOSED")[0], "ACCEPT");
    assert.ok(decisionsFor("SENT").includes("CLARIFICATION_ACCEPTED"));
    assert.ok(!decisionsFor("SENT").includes("ACCEPT"));
    assert.deepEqual(decisionsFor("RESOLVED"), ["REOPEN"]);
    assert.deepEqual(decisionsFor("DISMISSED"), ["REOPEN"]);
  });

  it("says what last happened, and that a stale finding is out of date", () => {
    const parsed = parseFindings({ control_id: CONTROL, findings: [raw()] });
    assert.ok(parsed);
    const finding = parsed[0] as EvidenceFinding;
    assert.equal(latestNote(finding), "");
    const replied: EvidenceFinding = {
      ...finding,
      events: [
        ...finding.events,
        {
          event: "REPLIED",
          actorKind: "SYSTEM",
          actor: null,
          note: "The control owner replied on the request.",
          question: "",
          pointsAt: {},
          createdAt: "2026-10-30T11:00:00Z",
        },
      ],
    };
    assert.equal(
      latestNote(replied),
      "The control owner replied on the request.",
    );
    const decided: EvidenceFinding = {
      ...replied,
      events: [
        ...replied.events,
        {
          event: "RESOLVED",
          actorKind: "PERSON",
          actor: "Ava Lin",
          note: "Covered by the approved policy.",
          question: "",
          pointsAt: {},
          createdAt: "2026-10-30T12:00:00Z",
        },
      ],
    };
    assert.equal(
      latestNote(decided),
      "Ava Lin: Covered by the approved policy.",
    );
    assert.equal(
      latestNote({
        ...decided,
        stale: true,
        staleReason: "The file was replaced.",
      }),
      "Out of date: The file was replaced.",
    );
  });
});

describe("composeFollowUp", () => {
  it("numbers one question per finding, falling back to the title", () => {
    const text = composeFollowUp(
      [
        { title: "Timeframe", question: "Please confirm the timeframe." },
        { title: "Version not established", question: "" },
      ],
      "ITGC-AC-01",
      "User access provisioning",
    );
    assert.deepEqual(text.split("\n"), [
      "Following up on the evidence for ITGC-AC-01 User access provisioning:",
      "",
      "1. Please confirm the timeframe.",
      "2. Please confirm: Version not established",
      "",
      "Thank you.",
    ]);
  });
});

describe("findingsWrite", () => {
  const ids = {
    organization_id: ORG,
    project_id: PROJECT,
    control_id: CONTROL,
  };
  const control = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}`;

  it("maps a decision to the finding's endpoint with its version", () => {
    const write = findingsWrite({
      ...ids,
      intent: "decide",
      finding_id: FINDING,
      decision: "ACCEPT",
      version: 3,
      note: "  ok  ",
    });
    assert.deepEqual(write, {
      path: `${control}/evidence-findings/${FINDING}/decide`,
      body: {
        decision: "ACCEPT",
        note: "ok",
        question: "",
        file_id: null,
        version: 3,
      },
    });
    assert.deepEqual(
      findingsWrite({
        ...ids,
        intent: "decide",
        finding_id: FINDING,
        decision: "NOPE",
        version: 1,
      }),
      { error: "invalid" },
    );
    assert.deepEqual(
      findingsWrite({
        ...ids,
        intent: "decide",
        finding_id: FINDING,
        decision: "ACCEPT",
      }),
      { error: "invalid" },
    );
  });

  it("maps a follow-up to the control's endpoint with the findings and the message", () => {
    const write = findingsWrite({
      ...ids,
      intent: "follow-up",
      request_id: "0199a1b2-0000-7000-8000-0000000000e0",
      finding_ids: [FINDING, "junk"],
      body: "Please confirm.",
    });
    assert.deepEqual(write, {
      path: `${control}/evidence-findings/follow-up`,
      body: {
        request_id: "0199a1b2-0000-7000-8000-0000000000e0",
        finding_ids: [FINDING],
        body: "Please confirm.",
      },
    });
    assert.deepEqual(
      findingsWrite({
        ...ids,
        intent: "follow-up",
        request_id: "x",
        finding_ids: [FINDING],
        body: "Hi",
      }),
      { error: "invalid" },
    );
    assert.deepEqual(findingsWrite({ ...ids, intent: "other" }), {
      error: "invalid",
    });
    assert.deepEqual(findingsWrite({ intent: "decide" }), { error: "invalid" });
  });

  it("says what a refusal means", () => {
    assert.equal(findingsProblem(200, ""), null);
    assert.equal(
      findingsProblem(409, "a finding that is sent cannot be accepted"),
      "a finding that is sent cannot be accepted",
    );
    assert.equal(findingsProblem(409, ""), "The finding changed; look again.");
    assert.equal(
      findingsProblem(403, ""),
      "You are not allowed to decide this.",
    );
    assert.equal(
      findingsProblem(0, ""),
      "The decision could not be saved. Try again.",
    );
  });
});

describe("what changed and the attribute label", () => {
  it("counts what came back, what is proposed, out with the owner, stale and closed", () => {
    const parsed = parseFindings({
      control_id: CONTROL,
      findings: [
        raw({ id: "0199a1b2-0000-7000-8000-000000000021", status: "ANSWERED" }),
        raw({
          id: "0199a1b2-0000-7000-8000-000000000022",
          status: "PROPOSED",
          stale: true,
        }),
        raw({ id: "0199a1b2-0000-7000-8000-000000000023", status: "SENT" }),
        raw({
          id: "0199a1b2-0000-7000-8000-000000000024",
          status: "RESOLVED",
          stale: true,
        }),
      ],
    });
    assert.ok(parsed);
    assert.deepEqual(changesOf(parsed), {
      answered: 1,
      proposed: 1,
      sent: 1,
      stale: 1,
      closed: 1,
    });
  });

  it("names the attribute by its code, and by its position only without one", () => {
    assert.equal(
      attributeLabel({ attributeCode: "A2", attributeIndex: 1 }),
      "A2",
    );
    assert.equal(
      attributeLabel({ attributeCode: "", attributeIndex: 1 }),
      "attribute 2",
    );
    assert.equal(
      attributeLabel({ attributeCode: "", attributeIndex: null }),
      "",
    );
    const parsed = parseFindings({
      control_id: CONTROL,
      findings: [
        raw({ attribute_id: FILE, attribute_code: "A3", attribute_index: 2 }),
      ],
    });
    assert.equal(parsed?.[0]?.attributeId, FILE);
    assert.equal(parsed?.[0]?.attributeCode, "A3");
  });
});
