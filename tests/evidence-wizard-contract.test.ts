// Independent review (13 November 2026): the server's real JSON (written by
// the review's services/api test) parsed by the web model; the fixtures are in
// tests/fixtures/evidence-wizard.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { parseAssurance } from "../apps/web/src/evidence-assurance-model.ts";
import {
  attributeRows,
  batchToShow,
  fileLines,
  itemCards,
  itemResults,
  parseBatch,
  parseBatchFile,
  parseBatchList,
  placementProblem,
  progressLine,
  progressOf,
  resultsSummary,
  uploadAnswer,
  type WizardItem,
} from "../apps/web/src/evidence-wizard-model.ts";

const DIR = new URL("./fixtures/evidence-wizard", import.meta.url).pathname;
// biome-ignore lint/suspicious/noExplicitAny: raw fixture JSON
const load = (name: string): any =>
  JSON.parse(readFileSync(`${DIR}/${name}`, "utf8"));

// biome-ignore lint/suspicious/noExplicitAny: raw fixture JSON
function wizardItemsOf(raw: any): WizardItem[] {
  // biome-ignore lint/suspicious/noExplicitAny: raw fixture JSON
  return raw.items.map((item: any) => ({
    requirementId: item.requirement_id,
    title: item.title,
    kind: "Kind",
    icon: "file",
    shows: "",
    letters: item.letters,
    files: item.file_ids.length,
    choosable: true,
    accepted: false,
    canAccept: true,
    acceptedBy: "",
    version: 1,
    held: [],
  }));
}

// biome-ignore lint/suspicious/noExplicitAny: raw fixture JSON
function letteredOf(raw: any) {
  const seen = new Map<string, { id: string; letter: string; text: string }>();
  for (const item of raw.items) {
    for (const attribute of item.assurance?.attributes ?? []) {
      seen.set(attribute.attribute_id, {
        id: attribute.attribute_id,
        letter: attribute.code,
        text: `Wording of ${attribute.code}`,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.letter.localeCompare(b.letter));
}

// No internal code on screen: two or more capitals joined by underscores.
const CODE = /\b[A-Z]{2,}(?:_[A-Z]+)+\b/;
function words(value: unknown, into: string[] = []): string[] {
  if (typeof value === "string") {
    into.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) words(item, into);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      // The fields that are codes by design (keys, states, tones), not words shown.
      if (
        [
          "key",
          "state",
          "status",
          "tone",
          "mode",
          "icon",
          "kind",
          "mark",
          "verdict",
          "met",
          "fileId",
          "requirementId",
          "requirementIds",
          "fileIds",
          "on",
          "findingId",
          "track",
          "value",
          "upload",
          "file",
          "letters",
          "letter",
          "code",
          "quote",
        ].includes(key)
      ) {
        continue;
      }
      words(item, into);
    }
  }
  return into;
}

describe("the server's batch state, read by the web model", () => {
  const raw = load("batch-state-all.json");
  const batch = parseBatch(raw);
  it("parses the batch with every file, in the server's order", () => {
    assert.ok(batch !== null);
    assert.deepEqual(
      batch.files.map((f) => f.fileId),
      // biome-ignore lint/suspicious/noExplicitAny: raw fixture JSON
      raw.files.map((f: any) => f.file_id),
    );
    assert.deepEqual(batch.stages, {
      stored: raw.stages.stored,
      read: raw.stages.read,
      sorted: raw.stages.sorted,
      checkedItems: raw.stages.checked_items,
      items: raw.stages.items,
      files: raw.stages.files,
    });
  });
  it("keeps each file's reading, placement and classification as the server said", () => {
    assert.ok(batch !== null);
    raw.files.forEach(
      // biome-ignore lint/suspicious/noExplicitAny: raw fixture JSON
      (f: any, at: number) => {
        const mine = batch.files[at];
        assert.ok(mine !== undefined);
        assert.equal(mine.read.status, f.read.status, f.name);
        assert.equal(mine.placement.status, f.placement.status, f.name);
        assert.equal(mine.placement.method, f.placement.method, f.name);
        assert.equal(mine.placement.version, f.placement.version, f.name);
        assert.deepEqual(
          mine.placement.requirementIds,
          f.placement.requirement_ids,
          f.name,
        );
        assert.equal(
          mine.placement.suggestions.length,
          f.placement.suggestions.length,
          f.name,
        );
        assert.equal(
          mine.classification?.label ?? null,
          f.classification?.label ?? null,
          f.name,
        );
        assert.equal(mine.addresses.length, f.addresses.length, f.name);
        assert.equal(mine.sizeBytes, f.size_bytes, f.name);
        assert.equal(mine.duplicate, f.duplicate, f.name);
      },
    );
  });
  it("parses each item's REVIEWED check, attribute by attribute", () => {
    assert.ok(batch !== null);
    raw.items.forEach(
      // biome-ignore lint/suspicious/noExplicitAny: raw fixture JSON
      (item: any, at: number) => {
        const mine = batch.items[at];
        assert.ok(
          mine?.check !== null && mine?.check !== undefined,
          item.title,
        );
        assert.equal(mine.check.status, item.assurance.status);
        assert.equal(mine.check.stage, item.assurance.stage);
        assert.equal(mine.check.lens, item.assurance.lens);
        assert.deepEqual(
          mine.check.attributes.map((a) => [a.code, a.verdict, a.shows]),
          // biome-ignore lint/suspicious/noExplicitAny: raw fixture JSON
          item.assurance.attributes.map((a: any) => [
            a.code,
            a.verdict,
            a.shows,
          ]),
        );
        assert.deepEqual(mine.fileIds, item.file_ids);
        assert.deepEqual(mine.letters, item.letters);
        assert.equal(mine.requestTitle, item.request_title);
      },
    );
  });
  it("the item's entry is the assurance API's entry for it", () => {
    const assurance = parseAssurance(load("assurance.json"));
    assert.ok(assurance !== null && batch !== null);
    for (const item of batch.items) {
      const api: unknown = assurance.requests.find(
        (each) => each.requirementId === item.requirementId,
      );
      assert.deepEqual(item.check, api, item.title);
    }
  });
  it("is still under way while a file waits and one is read, and polls on", () => {
    assert.ok(batch !== null);
    const now = batch.serverNow ?? Date.now();
    const progress = progressOf([], batch, now);
    assert.equal(progress.done, false);
    assert.equal(progress.reading, true);
    const lines = fileLines([], batch, {
      items: wizardItemsOf(raw),
      chosenRequirementId: null,
      mine: true,
      now,
    });
    const said = Object.fromEntries(
      lines.map((line) => [line.name, line.activity?.text ?? ""]),
    );
    assert.match(said["being read.txt"] ?? "", /longer than usual/);
    assert.match(said["queued listing.csv"] ?? "", /Waiting for a reader/);
    assert.match(said["unreadable scan.txt"] ?? "", /Could not be read/);
  });
  it("puts no internal code on screen", () => {
    assert.ok(batch !== null);
    const items = wizardItemsOf(raw);
    const attributes = letteredOf(raw);
    const now = batch.serverNow ?? Date.now();
    const lines = fileLines([], batch, {
      items,
      chosenRequirementId: null,
      mine: true,
      now,
    });
    const results = itemResults(batch, { items, attributes, now });
    const shown = [
      ...words(lines),
      ...words(itemCards(batch, { items, attributes, now })),
      ...words(results),
      ...words(resultsSummary(batch, results, progressOf([], batch, now))),
      ...batch.items.flatMap((item) =>
        words(attributeRows(item, batch, { attributes, items })),
      ),
    ];
    const leaked = shown.filter((text) => CODE.test(text));
    assert.deepEqual(leaked, []);
  });
});

describe("the server's sessions list, read by the web model", () => {
  const raw = load("batch-list.json");
  const list = parseBatchList(raw);
  it("reads every session", () => {
    assert.ok(list !== null);
    assert.equal(list.length, raw.batches.length);
  });
  it("reads in_progress as the server sends it (a count of files)", () => {
    assert.ok(list !== null);
    raw.batches.forEach(
      // biome-ignore lint/suspicious/noExplicitAny: raw fixture JSON
      (item: any, at: number) => {
        assert.equal(typeof item.in_progress, "number");
        // Rewritten after the review (13 November 2026). Old: inProgress was !finished
        // (the model read a boolean and fell back for a number). New: the server sends a
        // count of files still under way, read as under way when it is above 0. Reason:
        // the server's real payload (decision 12).
        assert.equal(list[at]?.inProgress, item.in_progress > 0);
      },
    );
  });
  it("shows the latest session under way", () => {
    assert.ok(list !== null);
    assert.equal(
      batchToShow(list, new Set())?.batchId,
      raw.batches[0].batch_id,
    );
    const line = progressLine({
      progress: null,
      summary: list[0] ?? null,
      seconds: 42,
    });
    assert.ok(line !== null);
    assert.equal(line.done, false);
  });
});

describe("a duplicate session and the move answers", () => {
  it("lists a file held already as a duplicate with its placement", () => {
    const raw = load("batch-state-duplicate.json");
    const batch = parseBatch(raw);
    assert.ok(batch !== null);
    const dup = batch.files.find((file) => file.duplicate);
    assert.ok(dup !== undefined);
    assert.equal(dup.placement.status, "PLACED");
  });
  it("reads the upload's duplicate answer", () => {
    const answer = uploadAnswer(200, load("upload-duplicate.json"));
    assert.equal(answer.state, "duplicate");
  });
  it("reads a person's move as the file's entry", () => {
    const entry = parseBatchFile(load("placement-answer.json"));
    assert.ok(entry !== null);
    assert.equal(entry.placement.status, "PLACED");
    assert.equal(entry.placement.method, "PERSON");
  });
  it("says the server's 409 sentences as sentences", () => {
    const stale = load("placement-409.json");
    assert.equal(
      placementProblem(stale.status, stale.body.detail),
      "The placement changed.",
    );
    const reading = load("placement-409-reading.json");
    assert.equal(
      placementProblem(reading.status, reading.body.detail),
      "The agent is still reading this file.",
    );
  });
});

describe("review scenarios on the server's JSON", () => {
  it("a file removed from this upload in this browser leaves the session finished", () => {
    // The reviewed session, every file read and both checks reviewed, as this browser
    // sent it; then the person removes one file ("Remove from this upload").
    const before = parseBatch(load("batch-state-reviewed.json"));
    assert.ok(before !== null);
    const uploads = before.files.map((file, at) => ({
      key: `u${at}`,
      name: file.name,
      folder: "",
      size: file.sizeBytes ?? 1,
      sent: file.sizeBytes ?? 1,
      state: "stored" as const,
      fileId: file.fileId,
      detail: "",
    }));
    const now = (before.serverNow ?? 0) + 120_000;
    assert.equal(progressOf(uploads, before, now).done, true);
    const ids = load("ids.json");
    // The server stops listing a withdrawn file (evidence_wizard._LISTED).
    const after = {
      ...before,
      files: before.files.filter((file) => file.fileId !== ids.files.minutes),
    };
    const progress = progressOf(uploads, after, now);
    const lines = fileLines(uploads, after, {
      items: [],
      chosenRequirementId: null,
      mine: true,
      now,
    });
    const removed = lines.find((line) => line.fileId === ids.files.minutes);
    assert.deepEqual(
      {
        done: progress.done,
        reading: progress.reading,
        shown: removed?.activity?.text ?? null,
      },
      { done: true, reading: false, shown: null },
    );
  });
  it("a duplicate that needs a person is offered a choice where the list sends the person", () => {
    const batch = parseBatch(load("batch-state-duplicate-needs.json"));
    assert.ok(batch !== null);
    const [line] = fileLines([], batch, {
      items: [],
      chosenRequirementId: null,
      mine: false,
      now: batch.serverNow ?? 0,
    });
    assert.ok(line !== undefined);
    assert.equal(line.dest?.kind, "needs");
    const list = parseBatchList(load("batch-list-after.json"));
    assert.ok(list !== null);
    // The list's line reopens this session (it needs a person)...
    assert.equal(batchToShow(list, new Set())?.batchId, batch.batchId);
    // ...where the window now offers the choice for it. Rewritten after the review (13
    // November 2026). Old: `line.duplicate` false, the condition the window then needed
    // to show Choose (it hid Choose for every duplicate). New: the file stays a
    // duplicate (it was added earlier) and is movable, which is what shows Choose.
    // Reason: decision 6, a duplicate that needs a person is chosen where the list
    // sends the person.
    assert.equal(line.duplicate, true);
    assert.equal(line.movable, true);
  });
});
