import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  evidenceList,
  lettersSpan,
  type Requirement,
  rowMenu,
} from "../apps/web/src/design-evidence-model.ts";
import {
  assuranceProblem,
  assuranceRow,
  assuranceWrite,
  type CheckAction,
  CURRENT_ENGINE,
  earlierEngine,
  offeredAction,
  parseAssurance,
  requestCheck,
  UPGRADE_BODY,
  UPGRADE_CONFIRM,
  UPGRADE_DONE,
  UPGRADE_LABEL,
  UPGRADE_TITLE,
  UPGRADE_WAIT,
} from "../apps/web/src/evidence-assurance-model.ts";
import type { RequirementFile } from "../apps/web/src/evidence-plan-model.ts";

// Checking a request again with the current engine (docs/evidence-assurance.md, section
// 10.10; product owner, 14 November 2026: "where do I rerun the analysis of evidence from
// this view?"). The web only decides what to offer: a finished check an earlier engine
// made (engine 1), with no file of the request still being read. The server holds the
// guards. Synthetic data only.

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [A, B] = [uuid(1), uuid(2)] as const;
const POLICY = uuid(11);
const REQUEST = uuid(21);
const FILE = uuid(31);
const [ORG, PROJECT, CONTROL] = [uuid(51), uuid(52), uuid(53)] as const;

const lettered = [A, B].map((id, at) => ({
  id,
  letter: "AB".charAt(at),
  text: `Attribute ${at + 1} wording.`,
}));
const span = (letters: readonly string[]) => lettersSpan(letters, ["A", "B"]);
const FILES = [{ id: FILE, name: "Access_Procedure_v3.pdf" }];

const attribute = () => ({
  attribute_id: A,
  code: "A",
  expected: true,
  verdict: "SUPPORTED",
  result: "MET",
  shows: "IMPLEMENTATION",
  summary: "The ticket shows line-manager approval before access.",
  passages: [],
  absent: [],
  views: [],
  finding_id: null,
  finding_status: null,
});

/** One request's entry as the API sends it; engine 1 unless the server says 2. */
const entry = (over: Record<string, unknown> = {}) => ({
  requirement_id: POLICY,
  run_id: uuid(62),
  status: "REVIEWED",
  stage: "DONE",
  held: null,
  held_files: [],
  file_ids: [FILE],
  lens: "INSTANCE_RECORD",
  read_in_part: false,
  attributes: [attribute()],
  out_of_date: [],
  finished_at: "2026-11-14T10:00:00Z",
  ...over,
});

function assurance(over: Record<string, unknown> = {}) {
  const read = parseAssurance({ requests: [entry(over)] });
  assert.ok(read !== null);
  return read;
}

function checkOf(
  over: Record<string, unknown>,
  options: { reading?: boolean } = { reading: false },
) {
  const [request] = assurance(over).requests;
  assert.ok(request !== undefined);
  return requestCheck(request, lettered, FILES, span, options);
}

const UPGRADE: CheckAction = {
  kind: "UPGRADE",
  label: "Check again with the current engine",
  fileId: null,
};

describe("the offer of checking again with the current engine", () => {
  it("is made for a finished engine 1 check with no file being read, and only then", () => {
    assert.deepEqual(checkOf({ engine_version: 1 }).action, UPGRADE);
    // Forward only (section 10.1): an entry that does not say its engine is engine 1.
    assert.deepEqual(checkOf({}).action, UPGRADE);
  });

  it("is never made for an engine 2 check", () => {
    assert.equal(checkOf({ engine_version: 2 }).action, null);
  });

  it("is made only for a known engine earlier than the current one: never a future engine or one it cannot read", () => {
    assert.equal(CURRENT_ENGINE, 2);
    assert.deepEqual(
      [1, 2, 3, 0, -1, 1.5, null].map((engine) => earlierEngine(engine)),
      [true, false, false, false, false, false, false],
    );
    for (const sent of [3, 4, 0, 1.5, "1", "2", null, true, {}]) {
      const [request] = assurance({ engine_version: sent }).requests;
      assert.ok(request !== undefined);
      assert.equal(
        requestCheck(request, lettered, FILES, span, { reading: false }).action,
        null,
        JSON.stringify(sent),
      );
    }
    // The engine is read as the server sent it: 1 where it sent none, null where it
    // sent no whole number. What the row renders by is unchanged (engineVersion).
    const engineOf = (over: Record<string, unknown>) =>
      assurance(over).requests[0]?.engine;
    assert.equal(engineOf({}), 1);
    assert.equal(engineOf({ engine_version: 1 }), 1);
    assert.equal(engineOf({ engine_version: 2 }), 2);
    assert.equal(engineOf({ engine_version: 3 }), 3);
    assert.equal(engineOf({ engine_version: "1" }), null);
    assert.equal(engineOf({ engine_version: null }), null);
    assert.equal(
      assurance({ engine_version: 3 }).requests[0]?.engineVersion,
      1,
    );
  });

  it("is never made while a file of the request is being read, or where that is not said", () => {
    assert.equal(
      checkOf({ engine_version: 1 }, { reading: true }).action,
      null,
    );
    // The wizard and other callers do not say: nothing is offered there.
    assert.equal(checkOf({ engine_version: 1 }, {}).action, null);
    const [request] = assurance({ engine_version: 1 }).requests;
    assert.ok(request !== undefined);
    assert.equal(requestCheck(request, lettered, FILES, span).action, null);
  });

  it("is never made for a check that is not finished and current: each keeps its own action", () => {
    const own: Array<[Record<string, unknown>, string | null]> = [
      [{ status: "QUEUED", stage: null, attributes: [] }, null],
      [{ status: "CHECKING", stage: "ASSESS", attributes: [] }, null],
      [
        {
          status: "HELD",
          held: { code: "KIND_UNSURE", reason: "" },
          attributes: [],
        },
        "Confirm the file's type",
      ],
      [{ status: "FAILED", attributes: [] }, "Check again"],
      [
        { status: "OUT_OF_DATE", out_of_date: ["A file changed."] },
        "Check again",
      ],
      [{ status: "NOT_CHECKED", attributes: [] }, "Check now"],
    ];
    for (const [over, label] of own) {
      for (const engine of [1, 2]) {
        const action = checkOf({ ...over, engine_version: engine }).action;
        assert.notEqual(action?.kind, "UPGRADE", JSON.stringify(over));
        assert.equal(action?.label ?? null, label, JSON.stringify(over));
      }
    }
  });

  it("is made only to a person who may act", () => {
    const facts = (canAct: boolean) => ({
      canAct,
      replaceable: () => true,
      rereadable: () => true,
    });
    assert.deepEqual(offeredAction(UPGRADE, facts(true)), UPGRADE);
    assert.equal(offeredAction(UPGRADE, facts(false)), null);
  });

  it("goes through the row as it is built, and the row menu lists it only while it applies", () => {
    const row = (over: Record<string, unknown>, state = "SENT") =>
      assuranceRow({
        requirementId: POLICY,
        files: FILES,
        assurance: assurance(over),
        attributes: lettered,
        span,
        reading: state === "READING",
      });
    assert.equal(row({ engine_version: 1 })?.check.action?.kind, "UPGRADE");
    assert.equal(row({ engine_version: 2 })?.check.action, null);
    assert.equal(row({ engine_version: 1 }, "READING")?.check.action, null);
  });
});

describe("the offer on the D&I list", () => {
  const file = (over: Partial<RequirementFile> = {}): RequirementFile => ({
    fileId: FILE,
    name: "Access_Procedure_v3.pdf",
    via: "REQUEST",
    sharedFrom: null,
    linkId: null,
    linkedBy: null,
    reason: "",
    linkVersion: null,
    readStatus: "READY",
    readBy: "MODEL",
    kind: null,
    kindConfirmed: false,
    coverage: "COVERED",
    note: "",
    period: "",
    gaps: [],
    ...over,
  });
  const requirement = (over: Partial<Requirement> = {}): Requirement =>
    ({
      id: POLICY,
      phase: "DESIGN",
      title: "User access management policy",
      description: "The policy for granting access.",
      categories: ["PROCESS_DOCUMENTATION"],
      necessity: "REQUIRED",
      state: "SENT",
      pendingChange: null,
      version: 3,
      requestId: REQUEST,
      files: [file()],
      assessment: { proposal: "NONE", reason: "", followUps: [] },
      sufficiencyNote: "",
      sufficiencyBy: null,
      waiveReason: "",
      periodLabel: "",
      attributeIds: [A, B],
      procedureIds: [],
      accepted: true,
      acceptedBy: "Daniel Osei",
      acceptedAt: "2026-11-12T08:00:00Z",
      ...over,
    }) as Requirement;
  const rowFor = (
    over: Record<string, unknown>,
    requirementOver: Partial<Requirement> = {},
  ) => {
    const view = evidenceList({
      requirements: [requirement(requirementOver)],
      approved: [A, B].map((id, at) => ({
        id,
        text: `Attribute ${at + 1} wording.`,
        sourceKind: "LIBRARY",
      })),
      requests: [
        {
          id: REQUEST,
          kind: "EVIDENCE",
          status: "SENT",
          dueAt: "2026-11-26",
          recipient: "maria.keller@example.com",
        },
      ],
      owner: { name: "Maria Keller", role: "IT Access Manager" },
      exceptions: [],
      liveEmail: null,
      procedures: null,
      period: "The control as currently designed",
      now: Date.parse("2026-11-14T12:00:00Z"),
      assurance: assurance(over),
    });
    const [first] = view.rows;
    assert.ok(first !== undefined);
    return first;
  };
  const facts = { policies: 1, held: 0, attributes: 2 };
  const upgradeItems = (row: ReturnType<typeof rowFor>) =>
    rowMenu(row, facts).filter((entry) => entry.key === "upgrade");

  it("adds the menu item for a finished engine 1 check, with its label", () => {
    const row = rowFor({ engine_version: 1 });
    assert.equal(row.assurance?.check.action?.kind, "UPGRADE");
    assert.deepEqual(
      upgradeItems(row).map((item) => [item.label, item.unavailable]),
      [[UPGRADE_LABEL, null]],
    );
    // Where it sits: after the file items, before the judgments.
    const labels = rowMenu(row, facts).map((item) => item.label);
    assert.equal(
      labels.indexOf(UPGRADE_LABEL),
      labels.indexOf("Use a file the control holds") + 1,
    );
  });

  it("has no menu item for engine 2, for a check not finished, or while a file is being read", () => {
    assert.deepEqual(upgradeItems(rowFor({ engine_version: 2 })), []);
    assert.deepEqual(
      upgradeItems(rowFor({ status: "FAILED", attributes: [] })),
      [],
    );
    assert.deepEqual(
      upgradeItems(rowFor({ status: "QUEUED", attributes: [] })),
      [],
    );
    assert.deepEqual(
      upgradeItems(
        rowFor(
          { engine_version: 1 },
          { files: [file({ readStatus: "WORKING" })] },
        ),
      ),
      [],
    );
  });

  it("is not offered on a request set aside, and the menu keeps its other items as before", () => {
    const aside = rowFor({ engine_version: 1 }, { state: "NOT_APPLICABLE" });
    assert.deepEqual(upgradeItems(aside), []);
    const labels = rowMenu(rowFor({ engine_version: 2 }), facts).map(
      (item) => item.label,
    );
    assert.deepEqual(labels, [
      "Edit",
      "Change attributes",
      "Upload a file",
      "Use a policy on file",
      "Use a file the control holds",
      "Ask a follow-up",
      "Mark insufficient",
      "Mark not applicable",
      "Reopen decision",
      "Delete",
    ]);
  });
});

describe("the call behind it", () => {
  const fields = {
    organization_id: ORG,
    project_id: PROJECT,
    control_id: CONTROL,
    requirement_id: POLICY,
  };
  const base = `/organizations/${ORG}/projects/${PROJECT}/controls/${CONTROL}/evidence-assurance/${POLICY}`;

  it("posts the upgrade of one request, and the rerun as before", () => {
    assert.deepEqual(assuranceWrite({ ...fields, intent: "upgrade" }), {
      path: `${base}/upgrade`,
    });
    assert.deepEqual(assuranceWrite({ ...fields, intent: "rerun" }), {
      path: `${base}/rerun`,
    });
  });

  it("refuses an unknown intent and any id that is not a UUID", () => {
    for (const bad of [
      { ...fields, intent: "Upgrade" },
      { ...fields, intent: "upgrade/../x" },
      { ...fields, intent: "accept" },
      { ...fields, intent: undefined },
      { ...fields, intent: "upgrade", requirement_id: "../../admin" },
      { ...fields, intent: "upgrade", control_id: "" },
      { ...fields, intent: "upgrade", organization_id: 7 },
      { intent: "upgrade" },
    ]) {
      assert.deepEqual(assuranceWrite(bad), { error: "invalid" });
    }
  });

  it("says a refusal in the server's sentence, and success only on the server's word", () => {
    assert.equal(assuranceProblem(200), null);
    assert.equal(
      assuranceProblem(
        409,
        "This request was already checked by the current engine.",
      ),
      "This request was already checked by the current engine.",
    );
    assert.equal(
      assuranceProblem(409),
      "The check cannot be run now. The row is refreshed.",
    );
    // The current engine's gate would hold the request (section 10.10): the server
    // refuses with the hold's own sentence, said as it is, and the list is read again.
    const hold =
      "The file's type is not confirmed, so the evidence has not been checked against the attributes.";
    assert.equal(assuranceProblem(409, hold), hold);
    assert.equal(assuranceProblem(409, `  ${hold}  `), hold);
    assert.equal(assuranceProblem(403), "Your role cannot run the check.");
    assert.notEqual(assuranceProblem(0), null);
    assert.notEqual(assuranceProblem(500), null);
  });
});

describe("the words", () => {
  it("are pinned: the label, the confirmation and what is said once it started", () => {
    assert.equal(UPGRADE_LABEL, "Check again with the current engine");
    assert.equal(UPGRADE_TITLE, "Check this request again?");
    assert.equal(
      UPGRADE_BODY,
      "The files on this request are read again by the model, as for the first check. The earlier result stays in the history and is no longer shown as current. Findings from it that nobody has decided yet are closed as out of date and raised again only if the new check finds them. A finding someone has already acted on keeps its status, and the new result is added to it for a person to decide. Nothing is sent to the organization.",
    );
    assert.equal(
      UPGRADE_WAIT,
      "Another check is being started on this list. Confirm once it has started.",
    );
    assert.equal(UPGRADE_CONFIRM, "Check again");
    assert.equal(
      UPGRADE_DONE,
      "The check was started again with the current engine.",
    );
  });

  it("never say the client, and use no em dash", () => {
    for (const text of [
      UPGRADE_LABEL,
      UPGRADE_TITLE,
      UPGRADE_BODY,
      UPGRADE_CONFIRM,
      UPGRADE_DONE,
      UPGRADE_WAIT,
    ]) {
      assert.equal(/client/i.test(text), false);
      assert.equal(text.includes("—"), false);
    }
  });
});

describe("the screen", () => {
  const read = (path: string) =>
    readFileSync(new URL(path, import.meta.url), "utf8");
  const view = read("../apps/web/src/design-evidence.tsx");
  const route = read("../apps/web/app/workspace/evidence-assurance/route.ts");

  it("asks in the list's confirmation dialog, with the pinned copy, before anything is sent", () => {
    assert.match(view, /<UpgradeDialog\b/);
    assert.match(view, /<dialog[\s\S]*?className="confirm-dialog"/);
    assert.match(view, /element\.showModal\(\)/);
    assert.match(view, /<h2 id=\{`\$\{id\}-title`\}>\{UPGRADE_TITLE\}<\/h2>/);
    assert.match(view, /<p id=\{`\$\{id\}-body`\}>\{UPGRADE_BODY\}<\/p>/);
    assert.match(view, /\{busy \? "Starting…" : UPGRADE_CONFIRM\}/);
    assert.match(view, /aria-labelledby=\{`\$\{id\}-title`\}/);
    // Escape, a click outside and Cancel close it without sending; not while it is out.
    assert.match(view, /if \(busy\) \{\s*event\.preventDefault\(\)/);
    assert.match(
      view,
      /className="btn-secondary"\s+disabled=\{busy\}\s+onClick=\{close\}/,
    );
  });

  it("sends the upgrade only from the dialog's confirm, through the workspace route, once", () => {
    // The intent is named where the call is typed and where it is made, and the menu
    // key once; nowhere else.
    const known = [
      'intent: "rerun" | "upgrade" = "rerun"',
      'run(requirementId, "upgrade")',
      'entry.key === "upgrade"',
    ];
    for (const place of known) {
      assert.equal(view.split(place).length - 1, 1, place);
    }
    assert.equal(
      known
        .reduce((rest, place) => rest.split(place).join(""), view)
        .includes('"upgrade"'),
      false,
    );
    assert.match(view, /intent: "rerun" \| "upgrade" = "rerun"/);
    assert.match(view, /fetch\("\/workspace\/evidence-assurance"/);
    assert.match(
      view,
      /return \(await run\(requirementId, "upgrade"\)\) \? "done" : "refused";/,
    );
    assert.equal((view.match(/checks\.upgrade\(/g) ?? []).length, 1);
    assert.equal((view.match(/upgradeCheck\(/g) ?? []).length, 2);
    // The row's action and the menu item only open the dialog.
    assert.match(
      view,
      /act\.kind === "UPGRADE"\) \{\s*setUpgrading\("action"\)/,
    );
    assert.match(view, /upgrade: \(\) => setUpgrading\("menu"\)/);
    // Its confirm is the only caller, and it sends one request however often pressed.
    assert.match(view, /void onConfirm\(\)\.then\(\(result\) => \{/);
    assert.match(view, /if \(!sent\.current\) \{\s*sent\.current = true;/);
    assert.match(view, /if \(sending\.current\) \{\s*return false;/);
    // Success is said once the server has confirmed, then the list is read in place.
    assert.match(view, /onDone\(UPGRADE_DONE\)/);
    assert.match(view, /startTransition\(\(\) => router\.refresh\(\)\)/);
    assert.equal(
      /location\.reload|window\.location\.href\s*=/.test(view),
      false,
    );
    // The route validates through the model's one function.
    assert.match(route, /assuranceWrite\(fields\)/);
  });

  it("puts the action beside a finished result, quietly, and the item in the row menu", () => {
    assert.match(
      view,
      /action\.kind === "UPGRADE" \? \(\s*<button\s+type="button"\s+className="btn btn-secondary btn-sm de-check-upgrade"/,
    );
    assert.match(view, /aria-haspopup="dialog"/);
    assert.match(view, /upgrade: "retry"/);
    assert.equal(/btn btn-primary[^"]*de-check-upgrade/.test(view), false);
    // The row's offer goes through the same filter as every other action.
    assert.match(view, /const action = offer\(check\.action\);/);
    assert.match(view, /\{canAct \? <RowMenu label=\{row\.title\}/);
    assert.match(view, /\{canAct && upgrading !== null \? \(\s*<UpgradeDialog/);
  });

  it("is off while another check call of the list is out, and says why, never closing silently", () => {
    // The menu item: unavailable, with the reason, while any call of the checks is out;
    // the lock after an upload still comes first.
    assert.match(
      view,
      /entry\.key === "upgrade" && checks\.pending\s*\? \{ \.\.\.entry, unavailable: UPGRADE_WAIT \}\s*: entry,/,
    );
    // Changed 14 November 2026 (second review of section 10.12, item 7). Old: the lock's
    // reason was always the upload's sentence (LOCKED). New: the upload's sentence only
    // where an upload is the cause, "Saving. One moment." during any other write; still
    // said, never a silent refusal.
    assert.match(view, /unavailable: locked \? lockedWhy : entry\.unavailable/);
    assert.match(
      view,
      /const lockedWhy = settling === plan \? LOCKED : SAVING;/,
    );
    // The row's action: off while a call is out (the list's other check actions too).
    assert.match(view, /disabled=\{locked \|\| checks\.pending\}/);
    assert.match(
      view,
      /className="btn btn-secondary btn-sm de-check-upgrade"\s+disabled=\{disabled\}/,
    );
    // The dialog: the list-wide state is passed in; Confirm is off and the reason said.
    assert.match(
      view,
      /waiting=\{\s*locked\s*\? lockedWhy\s*: checks\.pending && checks\.busy !== item\.id\s*\? UPGRADE_WAIT\s*: null\s*\}/,
    );
    assert.match(view, /disabled=\{busy \|\| waiting !== null\}/);
    assert.match(
      view,
      /\{why !== null \? \(\s*<p className="confirm-impact-state" role="status">/,
    );
    // A press that found another call out sends nothing, says so and stays open.
    assert.match(
      view,
      /if \(sending\.current \|\| out\.current !== ""\) \{\s*return "busy";/,
    );
    assert.match(
      view,
      /if \(result === "busy"\) \{[\s\S]{0,120}sent\.current = false;\s*setHeld\(UPGRADE_WAIT\);\s*\} else \{\s*close\(\);/,
    );
    // Every call of the checks marks itself out at once, and clears it when done.
    // Rewritten 17 November 2026 (owner: "Read all N again"). Old: two calls (run,
    // reread), so 2. New: a third, rereadAll, one request per file of a group, marks
    // itself out the same way, so 3. Kept: each call clears its mark when done.
    assert.equal((view.match(/out\.current = "";/g) ?? []).length, 3);
    assert.equal((view.match(/out\.current = (`reread|key)/g) ?? []).length, 2);
  });

  it("gives focus back to where it was chosen, and says nothing of the client", () => {
    assert.match(view, /querySelector<HTMLElement>\("\.row-menu-button"\)/);
    assert.match(view, /querySelector<HTMLElement>\("\.de-check-upgrade"\)/);
    assert.equal(/the client/i.test(view), false);
  });
});
