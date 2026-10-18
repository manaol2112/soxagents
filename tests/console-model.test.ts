import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agentWorking,
  blocks,
  citedFiles,
  consoleNoticeFor,
  consoleWrite,
  fileHref,
  filtersLine,
  greeting,
  parseCitations,
  parseConsoleFile,
  parseConsoleNotice,
  parseInbox,
  parseThread,
  parseThreads,
  plainText,
  previewCitations,
  safeHref,
  stepOutcome,
  threadGroups,
  waitingHref,
  writtenSoFar,
} from "../apps/web/src/console-model.ts";

const ids = {
  organization_id: "11111111-1111-7111-8111-111111111111",
  project_id: "22222222-2222-7222-8222-222222222222",
};
const message = "33333333-3333-7333-8333-333333333333";
const action = "44444444-4444-7444-8444-444444444444";
const base = `/organizations/${ids.organization_id}/projects/${ids.project_id}/console`;

describe("agent console model", () => {
  it("parses the conversation and its steps", () => {
    const thread = parseThread({
      id: message,
      model_configured: true,
      messages: [
        {
          id: message,
          role: "AGENT",
          content: "Done.",
          status: "WORKING",
          created_at: "2026-10-11T10:00:00Z",
          actions: [
            {
              id: action,
              position: 1,
              tool: "submit_request",
              label: "Submit for approval",
              risk: "CONFIRM",
              summary: "Submit the evidence request for approval: ITGC-AC-02",
              status: "PROPOSED",
            },
          ],
        },
      ],
    });
    assert.ok(thread !== null);
    assert.equal(thread.messages[0]?.actions[0]?.risk, "CONFIRM");
    // Retry is offered only when the API says so.
    assert.equal(thread.messages[0]?.canRetry, false);
    const failed = parseThread({
      id: message,
      messages: [
        {
          id: message,
          role: "AGENT",
          status: "FAILED",
          content: "I could not reach the model.",
          can_retry: true,
        },
      ],
    });
    assert.equal(failed?.messages[0]?.status, "FAILED");
    assert.equal(failed?.messages[0]?.canRetry, true);
    assert.equal(agentWorking(thread), true);
    assert.equal(parseThread({ messages: [{ id: "x" }] }), null);
    const inbox = parseInbox({
      waiting: [
        { kind: "drafts", title: "16 drafted requests", link: "evidence" },
      ],
      activity: [
        { agent: "Evidence coordinator", action: "Read a stored file" },
      ],
    });
    assert.equal(inbox?.waiting[0]?.link, "evidence");
    assert.equal(inbox?.activity.length, 1);
  });

  it("reads the agent's reply as paragraphs, lists, and tables", () => {
    const result = blocks(
      [
        "**ITGC-AC-01** needs a population.",
        "",
        "- First `item`",
        "- **Second**",
        "| Control | Due |",
        "|---|---|",
        "| AC-01 | 2026-10-21 |",
        "## Next",
        "1. Confirm",
      ].join("\n"),
    );
    assert.deepEqual(
      result.map((block) => block.kind),
      ["paragraph", "list", "table", "heading", "list"],
    );
    const [first, list, table, heading, steps] = result;
    assert.ok(first?.kind === "paragraph" && first.parts[0]?.strong === true);
    assert.ok(list?.kind === "list" && !list.ordered);
    assert.deepEqual(list.items[0]?.parts, [
      { text: "First ", strong: false },
      { text: "item", strong: false, code: true },
    ]);
    assert.ok(table?.kind === "table" && table.rows.length === 1);
    assert.equal(table.header[1]?.[0]?.text, "Due");
    assert.ok(heading?.kind === "heading" && heading.level === 2);
    assert.equal(heading.parts[0]?.text, "Next");
    assert.ok(steps?.kind === "list" && steps.ordered && steps.start === 1);
  });

  it("keeps numbered steps, nested items, code, quotes, and rules", () => {
    const result = blocks(
      [
        "### Plan",
        "3. Draft the request",
        "   - for *ITGC-AC-01*",
        "   - and _ITGC-AC-02_",
        "4. Submit it",
        "> Nothing is sent until approved.",
        "---",
        "```",
        "SELECT * FROM users",
        "  WHERE active",
        "```",
      ].join("\n"),
    );
    assert.deepEqual(
      result.map((block) => block.kind),
      ["heading", "list", "quote", "rule", "code"],
    );
    const [heading, list, quote, , code] = result;
    assert.ok(heading?.kind === "heading" && heading.level === 3);
    assert.ok(list?.kind === "list" && list.ordered && list.start === 3);
    assert.equal(list.items.length, 2);
    assert.deepEqual(
      list.items[0]?.children?.items.map((item) =>
        item.map((part) => [part.text, part.em === true]),
      ),
      [
        [
          ["for ", false],
          ["ITGC-AC-01", true],
        ],
        [
          ["and ", false],
          ["ITGC-AC-02", true],
        ],
      ],
    );
    assert.ok(quote?.kind === "quote");
    assert.equal(quote.parts[0]?.text, "Nothing is sent until approved.");
    assert.ok(code?.kind === "code");
    assert.equal(code.text, "SELECT * FROM users\n  WHERE active");
    // Snake case and lone stars stay as written.
    const [plain] = blocks("Run user_access_review at 2 * 3 times");
    assert.ok(plain?.kind === "paragraph");
    assert.equal(plain.parts.length, 1);
    // Copied text keeps the numbers and the nesting.
    assert.equal(
      plainText("3. Draft\n   - for AC-01\n4. Submit", "copy"),
      "3. Draft\n  - for AC-01\n4. Submit",
    );
  });

  it("links only to the web or to the app, never anywhere else", () => {
    const [line] = blocks(
      "See [the policy](https://example.com/policy), [the control](/?section=controls), " +
        "[a trap](javascript:alert(1)) and [a file](file:///c:/x).",
    );
    assert.ok(line?.kind === "paragraph");
    const links = line.parts.filter((part) => part.href !== undefined);
    assert.deepEqual(
      links.map((part) => [part.text, part.href]),
      [
        ["the policy", "https://example.com/policy"],
        ["the control", "/?section=controls"],
      ],
    );
    // An unsafe link keeps its words, without the link.
    assert.ok(line.parts.some((part) => part.text.includes("a trap")));
    assert.equal(safeHref("//evil.example"), null);
    assert.equal(safeHref("data:text/html,x"), null);
  });

  it("shows an answer still being written, an unfinished code block included", () => {
    assert.deepEqual(
      blocks("Here is the query:\n```\nSELECT 1").map((block) => block.kind),
      ["paragraph", "code"],
    );
    // A half-written list item or bold word does not break the rest.
    const partial = blocks("1. **Approve the dra");
    assert.ok(partial[0]?.kind === "list");
    assert.ok(
      partial[0].items[0]?.parts.some((part) => part.text.includes("Approve")),
    );
  });

  it("builds each write and refuses bad input", () => {
    assert.deepEqual(
      consoleWrite({ ...ids, intent: "ask", text: " What is overdue? " }),
      {
        intent: "ask",
        path: `${base}/messages`,
        body: { text: "What is overdue?" },
      },
    );
    assert.deepEqual(
      consoleWrite({ ...ids, intent: "confirm", action_id: action }),
      {
        intent: "confirm",
        path: `${base}/actions/${action}/confirm`,
        body: null,
      },
    );
    assert.deepEqual(
      consoleWrite({ ...ids, intent: "confirm-all", message_id: message }),
      {
        intent: "confirm-all",
        path: `${base}/messages/${message}/confirm`,
        body: null,
      },
    );
    assert.deepEqual(
      consoleWrite({ ...ids, intent: "retry", message_id: message }),
      {
        intent: "retry",
        path: `${base}/messages/${message}/retry`,
        body: null,
      },
    );
    for (const bad of [
      { ...ids, intent: "ask", text: "   " },
      { ...ids, intent: "retry", message_id: "../confirm" },
      { ...ids, intent: "confirm", action_id: "../x" },
      { ...ids, intent: "run", action_id: action },
      {
        organization_id: "x",
        project_id: ids.project_id,
        intent: "new-thread",
      },
    ]) {
      assert.deepEqual(consoleWrite(bad), { error: "invalid" });
    }
    assert.equal(consoleNoticeFor("ask", 409), "busy");
    assert.equal(consoleNoticeFor("confirm", 409), "stale");
    assert.equal(consoleNoticeFor("confirm-all", 200), "confirmed");
    assert.equal(consoleNoticeFor("cancel", 200), "cancelled");
    assert.equal(consoleNoticeFor("retry", 200), "sent");
    assert.equal(consoleNoticeFor("retry", 409), "settled");
    assert.equal(parseConsoleNotice("busy"), "busy");
    assert.equal(parseConsoleNotice("saved"), null);
  });

  it("shows checked citations as chips and keeps them in copied text", () => {
    const file = "55555555-5555-7555-8555-555555555555";
    const thread = parseThread({
      id: message,
      messages: [
        {
          id: message,
          role: "AGENT",
          status: "DONE",
          content: "Length is 12 [^1]. Lockout is **five attempts** [^2].",
          citations: [
            {
              number: 1,
              evidence_file_id: file,
              file_name: "ISS-07.pdf",
              quote: "at least 12 characters",
              before: "4.1 Passwords must be ",
              after: " long.",
              location: "Page 2",
            },
            { number: 2, evidence_file_id: "not-a-file", file_name: "x" },
          ],
        },
      ],
    });
    const cited = thread?.messages[0];
    assert.equal(cited?.citations.length, 1);
    assert.equal(cited?.citations[0]?.location, "Page 2");
    const [line] = blocks(cited?.content ?? "");
    assert.ok(line !== undefined && line.kind === "paragraph");
    assert.deepEqual(
      line.parts.map((part) => part.cite ?? part.text),
      ["Length is 12 ", 1, ". Lockout is ", "five attempts", " ", 2, "."],
    );
    assert.equal(
      plainText(cited?.content ?? "", "copy"),
      "Length is 12 [1]. Lockout is five attempts [2].",
    );
    assert.equal(
      plainText(cited?.content ?? "", "speech"),
      "Length is 12. Lockout is five attempts.",
    );
  });

  it("turns an answer into text to copy or read aloud", () => {
    const answer = [
      "## Where things stand",
      "**ITGC-AC-01** is waiting on the owner",
      "- Population: missing",
      "- Due 2026-10-20",
      "| Control | Status |",
      "| --- | --- |",
      "| ITGC-AC-01 | Sent |",
    ].join("\n");
    assert.equal(
      plainText(answer, "copy"),
      [
        "Where things stand",
        "ITGC-AC-01 is waiting on the owner",
        "- Population: missing\n- Due 2026-10-20",
        "Control\tStatus\nITGC-AC-01\tSent",
      ].join("\n\n"),
    );
    assert.equal(
      plainText(answer, "speech"),
      "Where things stand. ITGC-AC-01 is waiting on the owner. " +
        "Population: missing. Due 2026-10-20. Control: ITGC-AC-01, Status: Sent.",
    );
    assert.equal(plainText("", "speech"), "");
  });

  it("lists earlier conversations", () => {
    assert.deepEqual(
      parseThreads([
        { id: message, title: "", messages: 2, updated_at: "2026-10-11" },
        { id: "bad" },
      ]),
      [
        {
          id: message,
          title: "New conversation",
          messages: 2,
          updatedAt: "2026-10-11",
        },
      ],
    );
    assert.deepEqual(parseThreads(null), []);
  });
});

describe("console citations open the evidence", () => {
  it("marks each cited passage on its file and page", () => {
    const citations = parseCitations([
      {
        number: 1,
        evidence_file_id: "01a12dd4-0000-7000-8000-000000000001",
        file_name: "policy.pdf",
        quote: "at least 14 characters",
        location: "Page 3",
      },
      {
        number: 2,
        evidence_file_id: "01a12dd4-0000-7000-8000-000000000002",
        file_name: "settings.png",
        quote: "Lockout 5",
        location: "Screenshot, read by OCR",
      },
      {
        number: 3,
        evidence_file_id: "01a12dd4-0000-7000-8000-000000000001",
        file_name: "policy.pdf",
        quote: "reviewed yearly",
        location: "Page 7",
      },
    ]);
    assert.deepEqual(citedFiles(citations), [
      { id: "01a12dd4-0000-7000-8000-000000000001", fileName: "policy.pdf" },
      { id: "01a12dd4-0000-7000-8000-000000000002", fileName: "settings.png" },
    ]);
    assert.deepEqual(
      previewCitations(citations).map((c) => [c.label, c.page, c.found, c.box]),
      [
        ["[1]", 3, true, null],
        ["[2]", null, true, null],
        ["[3]", 7, true, null],
      ],
    );
  });
});

describe("what waits on the team leads to the work", () => {
  const item = {
    kind: "results",
    title: "Decide the open test results for ITGC-AC-01",
    detail: "",
    controlRef: "ITGC-AC-01",
    link: "controls",
    controlId: "01a1429c-504a-7abe-9fe0-bb5b2c4f2f99",
    tab: "interim",
  };
  const org = "01a13253-ec1a-7604-8944-a06dd7633ce0";
  const project = "01a1327d-b92a-7bd1-b34b-845a8d89c879";

  it("opens the control record on its tab when the item is about one control", () => {
    assert.equal(
      waitingHref(item, org, project),
      `/?organization=${org}&project=${project}&section=controls&control=${item.controlId}&tab=interim`,
    );
  });

  it("opens the page that holds it otherwise, and never a made-up tab", () => {
    assert.equal(
      waitingHref({ ...item, controlId: null, link: "mailbox" }, org, project),
      `/?organization=${org}&project=${project}&section=evidence&tab=mailbox`,
    );
    assert.equal(
      waitingHref({ ...item, controlId: null, link: "unknown" }, org, null),
      `/?organization=${org}&section=console`,
    );
    assert.equal(
      waitingHref({ ...item, tab: "javascript:alert(1)" }, org, project),
      `/?organization=${org}&project=${project}&section=controls&control=${item.controlId}`,
    );
  });
});

describe("the console's conversations and greeting", () => {
  it("groups conversations by the day they last moved", () => {
    const now = new Date(2026, 9, 16, 15, 0);
    const at = (days: number, hour = 9) =>
      new Date(2026, 9, 16 - days, hour, 0).toISOString();
    const groups = threadGroups(
      [
        { id: "a", updatedAt: at(0) },
        { id: "b", updatedAt: at(1, 23) },
        { id: "c", updatedAt: at(5) },
        { id: "d", updatedAt: at(20) },
        { id: "e", updatedAt: at(90) },
        { id: "f", updatedAt: "not a date" },
      ],
      now,
    );
    assert.deepEqual(
      groups.map((group) => [group.label, group.threads.map((t) => t.id)]),
      [
        ["Today", ["a"]],
        ["Yesterday", ["b"]],
        ["Previous 7 days", ["c"]],
        ["Previous 30 days", ["d"]],
        ["Older", ["e", "f"]],
      ],
    );
    assert.deepEqual(threadGroups([], now), []);
  });

  it("greets by the hour", () => {
    assert.equal(greeting(8), "Good morning");
    assert.equal(greeting(12), "Good afternoon");
    assert.equal(greeting(19), "Good evening");
    assert.equal(greeting(2), "Good evening");
  });
});

describe("an answer still being written", () => {
  it("waits for a table row to finish, and closes open bold and code", () => {
    const lines = (...parts: string[]) => parts.join("\n");
    const head = lines("Overdue:", "", "| Request | Owner |", "| --- | --- |");
    assert.equal(writtenSoFar(lines(head, "| PBC-01")), head);
    assert.equal(writtenSoFar(lines("Overdue:", "|")), "Overdue:");
    assert.equal(writtenSoFar("| A | B |"), "| A | B |");
    assert.equal(
      writtenSoFar("1. **Approve the dra"),
      "1. **Approve the dra**",
    );
    assert.equal(writtenSoFar("Run `list_cont"), "Run `list_cont`");
    assert.equal(writtenSoFar("**Done** and `x` "), "**Done** and `x`");
    // Inside a code block nothing is closed or held back.
    assert.equal(writtenSoFar(lines("```", "| a")), lines("```", "| a"));
  });
});

describe("a settled step", () => {
  it("says what became of it and who decided it", () => {
    assert.equal(
      stepOutcome({ status: "DONE", decidedBy: "Rob" }),
      "Approved by Rob",
    );
    assert.equal(stepOutcome({ status: "DONE", decidedBy: null }), "Done");
    assert.equal(
      stepOutcome({ status: "CANCELLED", decidedBy: "Rob" }),
      "Skipped by Rob",
    );
    assert.equal(
      stepOutcome({ status: "FAILED", decidedBy: "Rob" }),
      "Approved by Rob, but it did not run",
    );
    assert.equal(
      stepOutcome({ status: "FAILED", decidedBy: null }),
      "Did not run",
    );
  });
});

describe("a file the agent made", () => {
  const exported = {
    export: {
      id: "77777777-7777-7777-8777-777777777777",
      project_id: "88888888-8888-7888-8888-888888888888",
      file_name: "SOX-2027-evidence-requests-20261016-2002Z.xlsx",
      file_format: "xlsx",
      dataset: "evidence_requests",
      rows: 42,
      filters: {
        phase: "INTERIM",
        overdue_only: true,
        status_group: ["with_client"],
      },
      as_of: "2026-10-16T20:02:52+00:00",
      expires: "2026-11-15",
    },
  };

  it("shows a link only for a whole file from an export step", () => {
    const file = parseConsoleFile("export_records", exported);
    assert.ok(file !== null);
    assert.equal(file.rows, 42);
    assert.equal(
      fileHref(file, "11111111-1111-7111-8111-111111111111"),
      "/workspace/exports/77777777-7777-7777-8777-777777777777?organization=11111111-1111-7111-8111-111111111111&project=88888888-8888-7888-8888-888888888888",
    );
    // Any other step, a failed one, or a file missing a part, shows no link.
    assert.equal(parseConsoleFile("redraft_request", exported), null);
    assert.equal(parseConsoleFile("export_records", null), null);
    assert.equal(
      parseConsoleFile("export_records", {
        export: { ...exported.export, id: "../../etc" },
      }),
      null,
    );
    assert.equal(
      parseConsoleFile("export_records", {
        export: { ...exported.export, file_format: "exe" },
      }),
      null,
    );
  });

  it("shows a report the same way, as a PDF or a Word file", () => {
    const report = parseConsoleFile("generate_report", {
      export: {
        ...exported.export,
        file_name: "SOX-2027-status-report-20261016-2044Z.pdf",
        file_format: "pdf",
        dataset: "status_report",
        filters: { scope: "The whole engagement" },
      },
    });
    assert.ok(report !== null);
    assert.equal(report.fileFormat, "pdf");
    assert.equal(report.dataset, "status_report");
    assert.equal(filtersLine(report.filters), "The whole engagement");
  });

  it("says which records the file holds", () => {
    assert.equal(
      filtersLine(exported.export.filters),
      "phase INTERIM, overdue only, status group with_client",
    );
    assert.equal(filtersLine({}), "all records");
  });
});
