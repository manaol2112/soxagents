import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatSize,
  MAX_UPLOAD,
  parseLinkStatus,
  parsePortal,
  parseRecipientLinks,
  portalProblem,
  portalWrite,
  referenceHref,
  requestState,
  uploadProblem,
  validRequestId,
  validToken,
} from "../apps/web/src/portal-model.ts";

const REQUEST = "01a1429c-504a-7abe-9fe0-bb5b2c4f2f99";
const ORG = "01a13253-ec1a-7604-8944-a06dd7633ce0";
const PROJECT = "01a1327d-b92a-7bd1-b34b-845a8d89c879";

function portalBody(overrides: Record<string, unknown> = {}) {
  return {
    engagement: "SOX 2027",
    firm: "Acme Audit",
    email: "iam@client.example",
    session_expires_at: "2027-01-01T12:00:00Z",
    requests: [
      {
        id: REQUEST,
        reference: "PBC-2C4F2F99",
        control: "ITGC-AC-01",
        description: "Every access grant in the window.",
        due_at: "2026-10-26T00:00:00Z",
        status: "WAITING_FOR_RESPONSE",
        open_until: "2026-11-25T00:00:00Z",
        files: [
          {
            file_name: "population.csv",
            size_bytes: 2048,
            added_at: "2026-10-20T09:00:00Z",
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe("the owner's upload page", () => {
  it("accepts only well-formed link tokens and request ids", () => {
    assert.equal(
      validToken("O7DYOLrww-rD_qHbir1MamJrs1y3MBDrOWmz5b46DY0"),
      true,
    );
    for (const bad of ["short", "../../etc/passwd", "a b".repeat(20), ""]) {
      assert.equal(validToken(bad), false);
    }
    assert.equal(validRequestId(REQUEST), true);
    assert.equal(validRequestId("not-a-uuid"), false);
  });

  it("reads a link's state and refuses anything else", () => {
    assert.deepEqual(
      parseLinkStatus({
        state: "ACTIVE",
        engagement: "SOX 2027",
        firm: "Acme Audit",
        masked_email: "i***@client.example",
      }),
      {
        state: "ACTIVE",
        engagement: "SOX 2027",
        firm: "Acme Audit",
        maskedEmail: "i***@client.example",
      },
    );
    assert.equal(parseLinkStatus({ state: "OPEN" }), null);
    assert.equal(parseLinkStatus(null), null);
  });

  it("reads the owner's requests and their own files", () => {
    const portal = parsePortal(portalBody());
    assert.equal(portal?.requests.length, 1);
    assert.equal(portal?.requests[0]?.files[0]?.fileName, "population.csv");
    // One malformed request makes the whole answer untrusted.
    const broken = portalBody({
      requests: [{ ...portalBody().requests[0], id: "1" }],
    });
    assert.equal(parsePortal(broken), null);
  });

  it("lists the reference materials the audit team shared, and nothing malformed", () => {
    const body = portalBody();
    const request = {
      ...body.requests[0],
      references: [
        { id: ORG, file_name: "walkthrough.pdf", size_bytes: 4096 },
        { id: "nope", file_name: "x.pdf", size_bytes: 1 },
      ],
    };
    const portal = parsePortal({ ...body, requests: [request] });
    assert.deepEqual(portal?.requests[0]?.references, [
      { id: ORG, fileName: "walkthrough.pdf", sizeBytes: 4096 },
    ]);
    // A request without the field has none.
    assert.deepEqual(parsePortal(portalBody())?.requests[0]?.references, []);
    assert.equal(
      referenceHref(REQUEST, ORG),
      `/portal/reference?request=${REQUEST}&reference=${ORG}`,
    );
  });

  it("tells the owner where a request stands in plain words", () => {
    const portal = parsePortal(portalBody());
    const request = portal?.requests[0];
    assert.ok(request !== undefined);
    // The fixture has a file the owner sent, not yet read by the team.
    assert.equal(requestState(request).label, "Files sent, being checked");
    assert.equal(
      requestState({ ...request, files: [] }).label,
      "Waiting for your files",
    );
    assert.equal(
      requestState({ ...request, status: "RECEIVED" }).label,
      "Received, thank you",
    );
    assert.equal(
      requestState({ ...request, files: [], status: "OVERDUE" }).tone,
      "warning",
    );
  });

  it("checks a file before sending it", () => {
    assert.equal(uploadProblem(0), "This file is empty.");
    assert.match(uploadProblem(MAX_UPLOAD + 1) ?? "", /larger than 25 MB/);
    assert.equal(uploadProblem(1024), null);
    assert.equal(formatSize(512), "512 B");
    assert.equal(formatSize(2048), "2 KB");
    assert.equal(formatSize(3 * 1024 * 1024), "3.0 MB");
  });

  it("explains the API's refusals without internal words", () => {
    assert.equal(portalProblem(200), null);
    assert.match(portalProblem(404) ?? "", /not valid/);
    assert.match(portalProblem(429) ?? "", /Try again in an hour/);
    assert.equal(
      portalProblem(409, "that code is not right; 4 tries left"),
      "That code is not right; 4 tries left.",
    );
    assert.match(portalProblem(0) ?? "", /Something went wrong/);
  });
});

describe("the team's view of upload links", () => {
  it("reads who holds links", () => {
    assert.deepEqual(
      parseRecipientLinks([
        {
          recipient: "iam@client.example",
          active_links: 2,
          revoked_links: 0,
          last_opened_at: null,
          last_upload_at: "2026-10-20T09:00:00Z",
          open_requests: 3,
        },
      ]),
      [
        {
          recipient: "iam@client.example",
          activeLinks: 2,
          revokedLinks: 0,
          lastOpenedAt: null,
          lastUploadAt: "2026-10-20T09:00:00Z",
          openRequests: 3,
        },
      ],
    );
    assert.equal(parseRecipientLinks([{ recipient: 1 }]), null);
  });

  it("builds revoke and preview writes, and refuses anything else", () => {
    const fields = {
      organization_id: ORG,
      project_id: PROJECT,
      recipient: " IAM@Client.Example ",
    };
    assert.deepEqual(portalWrite({ ...fields, intent: "revoke" }), {
      intent: "revoke",
      path: `/organizations/${ORG}/projects/${PROJECT}/evidence-portal/revoke`,
      body: { recipient: "iam@client.example" },
    });
    assert.deepEqual(portalWrite({ ...fields, intent: "preview" }), {
      intent: "preview",
      path: `/organizations/${ORG}/projects/${PROJECT}/evidence-portal/preview-link`,
      body: { recipient: "iam@client.example" },
    });
    for (const bad of [
      { ...fields, intent: "delete" },
      { ...fields, intent: "revoke", recipient: "not an email" },
      { ...fields, intent: "revoke", organization_id: "x" },
    ]) {
      assert.deepEqual(portalWrite(bad), { error: "invalid" });
    }
  });
});
