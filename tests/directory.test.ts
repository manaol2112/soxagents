import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  blockedTasks,
  directoryHref,
  filterAgents,
  filterTasks,
  paginate,
  parseDirectoryQuery,
  upcomingDeadlines,
} from "../apps/web/src/directory.ts";

const tasks = [
  {
    id: "1",
    title: "Collect",
    status: "BLOCKED",
    priority: "HIGH",
    deadline: "2026-12-02",
  },
  {
    id: "2",
    title: "Review",
    status: "READY",
    priority: "LOW",
    deadline: "2026-11-01",
  },
  {
    id: "3",
    title: "Filed",
    status: "SUCCEEDED",
    priority: "HIGH",
    deadline: "2026-10-01",
  },
];

describe("workspace directory", () => {
  it("filters tasks and ignores an unknown status", () => {
    assert.deepEqual(
      filterTasks(tasks, { taskStatus: "BLOCKED", taskPriority: null }).map(
        (task) => task.id,
      ),
      ["1"],
    );
    assert.equal(
      parseDirectoryQuery({ taskStatus: "NOPE", taskPage: "0" }).taskStatus,
      null,
    );
    assert.equal(parseDirectoryQuery({ taskPage: "2" }).taskPage, 2);
  });

  it("pages a filtered list and clamps the last page", () => {
    const filtered = filterTasks(tasks, {
      taskStatus: null,
      taskPriority: "HIGH",
    });
    const page = paginate(filtered, 9, 1);
    assert.equal(page.pages, 2);
    assert.equal(page.page, 2);
    assert.equal(page.items[0]?.id, "3");
  });

  it("lists blocked work and open deadlines", () => {
    assert.deepEqual(
      blockedTasks(tasks).map((task) => task.id),
      ["1"],
    );
    assert.deepEqual(
      upcomingDeadlines(tasks).map((task) => task.id),
      ["2", "1"],
    );
    assert.deepEqual(
      filterAgents([{ status: "ACTIVE" }, { status: "DISABLED" }], "DISABLED"),
      [{ status: "DISABLED" }],
    );
  });

  it("keeps filters in the address and drops the first page", () => {
    const href = directoryHref({
      section: "tasks",
      organizationId: "org",
      projectId: "project",
      taskStatus: "BLOCKED",
      taskPage: 1,
    });
    assert.equal(
      href,
      "/?organization=org&project=project&section=tasks&taskStatus=BLOCKED",
    );
  });
});
