import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  agentWorking,
  blocks,
  consoleNoticeFor,
  consoleWrite,
  parseConsoleNotice,
  parseInbox,
  parseThread,
  parseThreads,
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
      ["paragraph", "list", "table", "paragraph", "list"],
    );
    const [first, list, table] = result;
    assert.ok(first?.kind === "paragraph" && first.parts[0]?.strong === true);
    assert.ok(
      list?.kind === "list" && list.items[0]?.[0]?.text === "First item",
    );
    assert.ok(table?.kind === "table" && table.rows.length === 1);
    assert.equal(table.header[1]?.[0]?.text, "Due");
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
    for (const bad of [
      { ...ids, intent: "ask", text: "   " },
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
    assert.equal(parseConsoleNotice("busy"), "busy");
    assert.equal(parseConsoleNotice("saved"), null);
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
