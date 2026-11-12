import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  itemKind,
  showsEvidenceWorkspace,
} from "../apps/web/src/design-release-model.ts";
import {
  type RequestsInput,
  requestsView,
} from "../apps/web/src/design-requests-model.ts";

// What changed here (product owner, 12 November 2026): "Why do I need to have the release
// button? Simplify the workflow. After the attributes approval, list down the evidences
// so that I can add, modify or update, or delete. Similar to how I do in the attributes."
// The D&I release card is removed, with its Release button and its early release: the
// server releases the phase once the requests list is settled, and refuses an early D&I
// release. The tests of the removed card are retired with it, each with the test that now
// holds its audit point (tests/design-requests-model.test.ts):
//
// - "is ready once understood and settled: what is requested, against which attributes"
//   (old: a ready card titled "Release the D&I evidence", its three checks done, each item
//   with the letters of the attributes it evidences, matched by wording). New: "lists the
//   live D&I requests, each with its kind, origin and letters" (letters from the request's
//   attribute links, by id) and "is settled once every request is accepted and every
//   attribute addressed".
// - "is an exception when no D&I item evidences the attributes, never ready" (old: the
//   card offered an early release with a reason). New: "raises the one exception: the
//   attribute no request addresses" and "never shows an attribute as addressed against
//   the server or the records": it holds the step for each uncovered attribute, not only
//   when none is evidenced, and nothing releases it early.
// - "waits for the attributes, pointing to the Attributes step, with an early release
//   offered" and "names Control Understanding first when that is what it waits on". New:
//   "waits, in one line, while an earlier step holds it"; the step's frame still points to
//   the step it waits on (tests/step-panel-model.test.ts). No early release is offered.
// - "is hidden once released, complete, or not planned". New: "is hidden where the step is
//   not the list's" and "shows the list at rest while the requests are drafted, then gives
//   way".
// - "names the attributes still without criteria tailored to the control" and "never
//   ticks the attributes settled while criteria are missing, even waiting on
//   understanding" (the card's attributes check). The card and its checks are gone; the
//   server holds the D&I phase on the attributes (phase_release.attribute_waits) and the
//   Attributes step words what they wait for (tests/control-workflow-model.test.ts, "holds
//   the D&I evidence until its requests list is settled"), so the list is not shown as
//   actionable while they are unsettled ("waits, in one line, ...").
// - "marks each check done or open, in words a screen reader hears", "titles the list by
//   the release's state and names who it goes to only when known", "offers the early
//   release only while it waits and the person may release" and "keeps Release early
//   disabled until the reason is long enough and nothing is pending": the checks, the
//   "Will be requested" heading and the early-release form no longer exist. The reason a
//   person records is now why an attribute is not evidenced at D&I: "takes a coverage
//   reason only when it is long enough to stand on its own".

describe("the kinds of D&I evidence (11 November 2026)", () => {
  // Kept from "gives each item to request its kind, icon and one secondary line": the
  // kinds and icons are the requests list's rows now; the secondary line is the row's own
  // (tests/design-requests-model.test.ts).
  it("names an item's kind and icon by its first category the list names", () => {
    assert.deepEqual(itemKind(["PROCESS_DOCUMENTATION"]), {
      kind: "Policy or procedure",
      shows: "how the control is meant to work",
      icon: "file",
    });
    // Its first category the list names decides it: a walkthrough instance, not a policy.
    assert.deepEqual(itemKind(["CONTROL_EXECUTION", "PROCESS_DOCUMENTATION"]), {
      kind: "Walkthrough instance",
      shows: "one instance, start to finish",
      icon: "list",
    });
    assert.equal(itemKind(["OTHER", "CONFIGURATION"]).kind, "Configuration");
    // No category named: supporting evidence, with nothing invented.
    assert.equal(itemKind([]).kind, "Supporting evidence");
    assert.equal(itemKind([]).shows, "");
    assert.equal(itemKind().icon, "file");
  });
});

describe("the evidence list shows once, not twice (12 November 2026)", () => {
  const uuid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const NOW = Date.parse("2026-11-12T10:00:00Z");
  const requirement: RequestsInput["requirements"][number] = {
    id: uuid(11),
    phase: "DESIGN",
    title: "Access provisioning policy",
    description: "The approved policy for granting access.",
    objective: "How access is meant to be approved.",
    categories: ["PROCESS_DOCUMENTATION"],
    necessity: "REQUIRED",
    state: "NOT_GENERATED",
    origin: "AGENT",
    pendingChange: null,
    version: 1,
    requestId: null,
    attributeIds: [uuid(1)],
    accepted: true,
    acceptedBy: "Dana Reyes",
    acceptedAt: "2026-11-12T09:30:00Z",
    toAccept: false,
    personEdited: false,
  };
  const view = (
    status: RequestsInput["status"],
    requirements = [requirement],
  ) =>
    requestsView({
      status,
      approved: [
        { id: uuid(1), text: "Access is approved.", sourceKind: "LIBRARY" },
      ],
      requirements,
      summary: null,
      working: false,
      procedures: null,
      now: NOW,
    });
  const waits = (
    step: string,
    waitingOn: NonNullable<RequestsInput["status"]>["waitingOn"] = "",
  ) => view({ step, waitingOn, waitingFor: "", releasedAt: null });
  const before = waits("WAITING", "REQUESTS");

  // Old: the workspace was hidden while the release card listed "Will be requested".
  // New: it is hidden while the requests list is the step's one list (same audit point:
  // each request is on the page once).
  it("hides the D&I workspace while the requests list shows what will be requested", () => {
    assert.equal(before.mode, "list");
    assert.equal(showsEvidenceWorkspace("designevidence", before), false);
    // Settled and not yet drafted: still the one list.
    const ready = waits("READY");
    assert.equal(ready.mode, "list");
    assert.equal(showsEvidenceWorkspace("designevidence", ready), false);
    // Old: a release that waited on the attributes still listed the planned items. New:
    // the step waits in one line until they are settled; still no second list.
    const waiting = waits("WAITING", "ATTRIBUTES");
    assert.equal(waiting.mode, "waiting");
    assert.equal(showsEvidenceWorkspace("designevidence", waiting), false);
    // While the requests are being drafted the list stays, at rest.
    const drafting = view({
      step: "RELEASED",
      waitingOn: "",
      waitingFor: "",
      releasedAt: "2026-11-12T09:59:30Z",
    });
    assert.equal(drafting.mode, "drafting");
    assert.equal(showsEvidenceWorkspace("designevidence", drafting), false);
  });

  it("shows the workspace once the release has drafted the requests", () => {
    const after = view(
      {
        step: "RELEASED",
        waitingOn: "",
        waitingFor: "",
        releasedAt: "2026-11-12T09:59:30Z",
      },
      [{ ...requirement, state: "DRAFT", requestId: uuid(31) }],
    );
    assert.equal(after.mode, "hidden");
    assert.equal(showsEvidenceWorkspace("designevidence", after), true);
    // A release from before the list, long drafted or not: the workspace, as before.
    assert.equal(
      showsEvidenceWorkspace("designevidence", waits("RELEASED")),
      true,
    );
    assert.equal(
      showsEvidenceWorkspace("designevidence", waits("COMPLETE")),
      true,
    );
  });

  it("leaves every other step's workspace as it was", () => {
    for (const step of ["oeevidence", "oetesting", null]) {
      assert.equal(showsEvidenceWorkspace(step, before), true);
    }
  });
});
