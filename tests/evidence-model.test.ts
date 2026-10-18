import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agentStatus,
  applicationLabel,
  applicationWrite,
  byApplicationOf,
  byControl,
  controlLabel,
  fileCounts,
  filingNoticeFor,
  filingNoticeParam,
  filingWrite,
  filterFiles,
  parseEvidenceView,
  parseFilingNotice,
  parseRegister,
  planUploads,
  type RegisterFile,
  uploadBlocked,
  uploadTarget,
} from "../apps/web/src/evidence-model.ts";

const org = "11111111-1111-7111-8111-111111111111";
const project = "22222222-2222-7222-8222-222222222222";
const file = "33333333-3333-7333-8333-333333333333";
const control = "44444444-4444-7444-8444-444444444444";

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: file,
    file_name: "users.csv",
    folder_path: "Acme/AC-01",
    source: "UPLOAD",
    size_bytes: 120,
    content_type: "text/csv",
    created_at: "2026-10-11T10:00:00Z",
    added_by: "Preview owner",
    batch_id: null,
    state: "FILED",
    filed_by: "AGENT",
    confidence: 0.93,
    match_reason: "The folder names ITGC-AC-01.",
    suggestions: [
      {
        control_id: control,
        control_ref: "ITGC-AC-01",
        title: "New users",
        reason: "x",
      },
      { control_id: "bad", control_ref: "X", title: "", reason: "" },
    ],
    filing_version: 3,
    control: {
      id: control,
      control_ref: "ITGC-AC-01",
      title: "New users",
      area: "Access",
    },
    request: { id: file, status: "RECEIVED", provided_directly: true },
    analysis_id: file,
    read_status: "READY",
    kind: "population",
    kind_label: "Population or listing",
    kind_confirmed: false,
    summary: "",
    review_status: null,
    review_proposed: null,
    review_decision: null,
    ...overrides,
  };
}

function parsed(overrides: Record<string, unknown> = {}): RegisterFile {
  const register = parseRegister({ files: [row(overrides)], controls: [] });
  assert.ok(register !== null);
  const [first] = register.files;
  assert.ok(first !== undefined);
  return first;
}

describe("evidence register model", () => {
  it("parses the register and drops suggestions that are not controls", () => {
    const item = parsed();
    assert.equal(item.control?.controlRef, "ITGC-AC-01");
    assert.equal(item.request?.providedDirectly, true);
    assert.deepEqual(
      item.suggestions.map((entry) => entry.controlRef),
      ["ITGC-AC-01"],
    );
    assert.equal(parseRegister({ files: [{ id: "x" }], controls: [] }), null);
    assert.equal(
      parseRegister({ files: [row({ state: "LOST" })], controls: [] }),
      null,
    );
    assert.equal(parseRegister([]), null);
  });

  it("reads the view from the address and refuses odd values", () => {
    assert.deepEqual(
      parseEvidenceView({
        tab: null,
        queue: "needs_match",
        q: "  users ",
        group: "control",
        file,
      }),
      {
        tab: "requests",
        queue: "needs_match",
        query: "users",
        group: "control",
        file,
      },
    );
    assert.deepEqual(
      parseEvidenceView({
        tab: "mailbox",
        queue: "everything",
        q: null,
        group: "x",
        file: "../x",
      }),
      { tab: "mailbox", queue: null, query: "", group: "list", file: null },
    );
  });

  it("sorts files into queues, searches them, and groups them by control", () => {
    const files = [
      parsed(),
      parsed({
        id: "55555555-5555-7555-8555-555555555555",
        state: "NEEDS_MATCH",
        control: null,
        filed_by: null,
        file_name: "notes.txt",
      }),
      parsed({
        id: "66666666-6666-7666-8666-666666666666",
        state: "READING",
        control: null,
        filed_by: null,
        read_status: "WORKING",
      }),
      parsed({
        id: "77777777-7777-7777-8777-777777777777",
        source: "MAILBOX",
        filed_by: "EMAIL",
      }),
    ];
    assert.deepEqual(fileCounts(files), {
      total: 4,
      needsMatch: 1,
      filedByAgent: 1,
      reading: 1,
    });
    assert.equal(filterFiles(files, { queue: "email", query: "" }).length, 1);
    assert.deepEqual(
      filterFiles(files, { queue: null, query: "NOTES" }).map(
        (item) => item.fileName,
      ),
      ["notes.txt"],
    );
    assert.equal(
      filterFiles(files, { queue: null, query: "itgc-ac-01 access" }).length,
      0,
    );
    assert.equal(
      filterFiles(files, { queue: null, query: "itgc-ac-01 users" }).length,
      2,
    );
    const groups = byControl(files);
    assert.equal(groups[0]?.label, "Not filed to a control");
    assert.equal(groups[0]?.files.length, 2);
    assert.equal(groups[1]?.label, "ITGC-AC-01 · New users");
  });

  it("says what the agents made of a file", () => {
    assert.deepEqual(agentStatus(parsed({ read_status: "PENDING" })), {
      label: "Reading",
      tone: "info",
    });
    assert.deepEqual(agentStatus(parsed({ read_status: "FAILED" })), {
      label: "Not read",
      tone: "danger",
    });
    assert.equal(
      agentStatus(
        parsed({ review_status: "READY", review_proposed: "EXCEPTION" }),
      ).label,
      "Exception proposed",
    );
    assert.equal(
      agentStatus(
        parsed({ review_status: "READY", review_decision: "ACCEPTED" }),
      ).label,
      "Review signed off",
    );
    assert.equal(
      agentStatus(parsed({ kind_confirmed: true })).label,
      "Kind confirmed",
    );
  });

  it("plans an upload from a folder and skips what is not evidence", () => {
    const plan = planUploads([
      { path: "Acme PBC/AC-01/users.xlsx", size: 2000 },
      { path: "Acme PBC\\CM\\changes.csv", size: 10 },
      { path: "Acme PBC/.DS_Store", size: 6 },
      { path: "Acme PBC/~$users.xlsx", size: 6 },
      { path: "Acme PBC/.git/config", size: 6 },
      { path: "Acme PBC/empty.txt", size: 0 },
      { path: "Acme PBC/huge.zip", size: 30_000_000 },
      { path: "single.pdf", size: 5 },
    ]);
    assert.deepEqual(
      plan.accepted.map((item) => [item.index, item.folder, item.name]),
      [
        [0, "Acme PBC/AC-01", "users.xlsx"],
        [1, "Acme PBC/CM", "changes.csv"],
        [7, "", "single.pdf"],
      ],
    );
    assert.deepEqual(
      plan.skipped.map((item) => item.reason),
      [
        "System file",
        "System file",
        "System file",
        "Empty file",
        "Larger than 25 MB",
      ],
    );
  });

  it("builds the upload and filing calls, and refuses bad input", () => {
    const batch = "88888888-8888-7888-8888-888888888888";
    const target = uploadTarget(
      new URLSearchParams({
        organization: org,
        project,
        batch,
        name: "a b.csv",
        path: "Acme/AC 01",
      }),
    );
    assert.deepEqual(target, {
      path: `/organizations/${org}/projects/${project}/evidence-uploads`,
      query: `batch_id=${batch}&name=a+b.csv&path=Acme%2FAC+01`,
    });
    assert.deepEqual(
      uploadTarget(
        new URLSearchParams({
          organization: org,
          project,
          batch: "x",
          name: "a",
        }),
      ),
      { error: "invalid" },
    );
    // A file added on a request carries it, so the API files it there.
    const onRequest = uploadTarget(
      new URLSearchParams({
        organization: org,
        project,
        batch,
        name: "a.csv",
        request: file,
      }),
    );
    assert.ok(!("error" in onRequest));
    assert.match(onRequest.query, new RegExp(`request_id=${file}`));
    assert.deepEqual(
      uploadTarget(
        new URLSearchParams({
          organization: org,
          project,
          batch,
          name: "a.csv",
          request: "../x",
        }),
      ),
      { error: "invalid" },
    );
    const base = {
      organization_id: org,
      project_id: project,
      file_id: file,
      version: "3",
    };
    assert.deepEqual(filingWrite({ ...base, control_id: control }), {
      path: `/organizations/${org}/projects/${project}/evidence-files/${file}/filing`,
      body: { version: 3, control_id: control },
    });
    assert.deepEqual(filingWrite({ ...base, control_id: "none" }).valueOf(), {
      path: `/organizations/${org}/projects/${project}/evidence-files/${file}/filing`,
      body: { version: 3, control_id: null },
    });
    for (const bad of [
      { ...base, control_id: "../x" },
      { ...base, version: "0", control_id: control },
      { ...base, file_id: "x", control_id: control },
    ]) {
      assert.deepEqual(filingWrite(bad), { error: "invalid" });
    }
  });

  it("groups a control's files by the application they show", () => {
    const ad = {
      id: "aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa",
      name: "Active Directory",
    };
    const db = {
      id: "bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb",
      name: "Oracle Database",
    };
    const files = [
      parsed({
        id: "11111111-0000-7000-8000-000000000001",
        application: ad,
        application_scope: "ONE",
      }),
      parsed({
        id: "11111111-0000-7000-8000-000000000002",
        application_scope: "ALL",
      }),
      parsed({
        id: "11111111-0000-7000-8000-000000000003",
        application_scope: "UNKNOWN",
      }),
    ];
    const groups = byApplicationOf(files, [ad, db]);
    assert.deepEqual(
      groups.map((group) => [group.label, group.files.length]),
      [
        ["Application not known", 1],
        ["Active Directory", 1],
        ["Oracle Database", 0],
        ["All applications", 1],
      ],
    );
    assert.equal(
      applicationLabel(files[0] as RegisterFile),
      "Active Directory",
    );
    assert.equal(
      applicationLabel(files[1] as RegisterFile),
      "All applications",
    );
    // One application: every file sits under it.
    assert.deepEqual(
      byApplicationOf([parsed()], [ad]).map((group) => group.label),
      ["Active Directory"],
    );
    const base = { organization_id: org, project_id: project, file_id: file };
    assert.deepEqual(applicationWrite({ ...base, application: ad.id }), {
      path: `/organizations/${org}/projects/${project}/evidence-files/${file}/application`,
      body: { scope: "ONE", application_id: ad.id },
    });
    assert.deepEqual(
      applicationWrite({ ...base, application: "ALL" }).valueOf(),
      {
        path: `/organizations/${org}/projects/${project}/evidence-files/${file}/application`,
        body: { scope: "ALL", application_id: null },
      },
    );
    assert.deepEqual(applicationWrite({ ...base, application: "SAP" }), {
      error: "invalid",
    });
  });

  it("says why evidence cannot be added instead of hiding the upload", () => {
    assert.equal(uploadBlocked("ACTIVE", "OWNER"), null);
    assert.match(uploadBlocked("ARCHIVED", "OWNER") ?? "", /archived/);
    assert.match(uploadBlocked("PAUSED", "ADMIN") ?? "", /paused/);
    assert.match(uploadBlocked("DRAFT", "OWNER") ?? "", /not launched yet/);
    assert.match(uploadBlocked("ACTIVE", "REVIEWER") ?? "", /cannot add/);
  });

  it("names each filing outcome apart from the page's other notices", () => {
    assert.equal(filingNoticeFor(200, false), "filed");
    assert.equal(filingNoticeFor(200, true), "unfiled");
    assert.equal(filingNoticeFor(409, false), "stale");
    assert.equal(filingNoticeFor(404, false), "denied");
    assert.equal(filingNoticeFor(0, false), "unavailable");
    assert.equal(parseFilingNotice(filingNoticeParam("stale")), "stale");
    assert.equal(parseFilingNotice("stale"), null);
    assert.equal(parseFilingNotice("invalid"), null);
  });
});

describe("controls per application", () => {
  it("names a file's control with the application its instance tests", () => {
    const [file] =
      parseRegister({
        files: [
          row({
            control: {
              id: control,
              control_ref: "ITGC-AC-01",
              application: "Oracle EBS",
              title: "New users",
              area: "Access",
            },
          }),
        ],
        controls: [],
        withdrawn: [],
      })?.files ?? [];
    assert.ok(file?.control);
    assert.equal(file.control.application, "Oracle EBS");
    assert.equal(controlLabel(file.control), "ITGC-AC-01 · Oracle EBS");
    assert.equal(
      controlLabel({ controlRef: "ITGC-AC-01", application: "" }),
      "ITGC-AC-01",
    );
  });
});

describe("an instance's evidence tab", () => {
  it("groups only the instance's application and lists sibling files apart", () => {
    const ad = {
      id: "01a12dd4-0000-7000-8000-00000000000a",
      name: "Active Directory",
    };
    const db = {
      id: "01a12dd4-0000-7000-8000-00000000000b",
      name: "Oracle Database",
    };
    const files = [
      parseRegister({
        files: [
          row({
            id: "01a12dd4-0000-7000-8000-000000000001",
            application: ad,
            application_scope: "ONE",
          }),
        ],
        controls: [],
      })?.files[0],
      parseRegister({
        files: [
          row({
            id: "01a12dd4-0000-7000-8000-000000000002",
            application: db,
            application_scope: "ONE",
          }),
        ],
        controls: [],
      })?.files[0],
      parseRegister({
        files: [
          row({
            id: "01a12dd4-0000-7000-8000-000000000003",
            application_scope: "ALL",
          }),
        ],
        controls: [],
      })?.files[0],
    ].filter((item): item is RegisterFile => item !== undefined);
    assert.deepEqual(
      byApplicationOf(files, [ad, db], "Active Directory").map((group) => [
        group.label,
        group.files.length,
      ]),
      [
        ["Active Directory", 1],
        ["All applications", 1],
        ["Shows another application", 1],
      ],
    );
    // Without an instance (or an unknown one) the family's groups stay as before.
    assert.equal(byApplicationOf(files, [ad, db]).length, 3);
  });
});
