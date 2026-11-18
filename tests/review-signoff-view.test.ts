import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

// One D&I step: the preparer sends it for review, the reviewer signs in section 7
// (product owner, 16 November 2026, docs/design-workpaper.md section 3.8). Read from the
// screen's own files, for what must hold however it looks and what cannot run here: the
// step is gone and nothing mounts its panel; every write shows as done only once the
// server confirmed it; refusals are said in an alert; the routes answer as JSON with the
// person's session only, never a redirect; nothing sets HTML. Synthetic data only.

const read = (path: string) => readFileSync(path, "utf8");
const WEB = "apps/web";
const block = read(`${WEB}/src/review-signoff.tsx`);
const preparer = read(`${WEB}/src/preparer-signoff.tsx`);
const picker = read(`${WEB}/src/review-picker.tsx`);
const waiting = read(`${WEB}/src/review-waiting.tsx`);
const proxy = read(`${WEB}/src/review-request-route.ts`);
const view = read(`${WEB}/src/design-workpaper-view.tsx`);
const controls = read(`${WEB}/src/controls-view.tsx`);
const workflow = read(`${WEB}/src/control-workflow-model.ts`);
const panels = read(`${WEB}/src/step-panel-model.ts`);
const home = read(`${WEB}/src/engagement-view.tsx`);
const oldRoute = read(`${WEB}/app/workspace/design-conclusions/route.ts`);
const mineRoute = read(`${WEB}/app/workspace/review-requests/route.ts`);
const makefile = read("Makefile");
const shell = read(`${WEB}/src/workspace-view.tsx`);
const loader = read(`${WEB}/src/load-engagement.ts`);
const shellModel = read(`${WEB}/src/shell-model.ts`);
const ROUTES = {
  send: `${WEB}/app/workspace/design-conclusions/send-for-review/route.ts`,
  reviewer: `${WEB}/app/workspace/design-conclusions/review-request/reviewer/route.ts`,
  remind: `${WEB}/app/workspace/design-conclusions/review-request/remind/route.ts`,
  return: `${WEB}/app/workspace/design-conclusions/return/route.ts`,
};

const squash = (source: string) => source.replace(/\s+/g, " ");
/** Whether the source holds what is written, whatever its line breaks. A placeholder of
 * the source is written `@{...}` here, so that no string of these tests holds one. */
const has = (source: string, written: string) =>
  assert.ok(
    squash(source).includes(squash(written.replaceAll("@{", "${"))),
    written,
  );
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

describe("the step is gone", () => {
  it("has no D&I Conclusion and Review step, panel or section", () => {
    assert.equal(existsSync(`${WEB}/src/design-conclusion-panel.tsx`), false);
    assert.equal(
      /DesignConclusionPanel|design-conclusion-panel/.test(controls),
      false,
    );
    assert.equal(/"design-conclusion"/.test(code(workflow)), false);
    assert.equal(/designconclusion/.test(code(panels)), false);
    assert.equal(/key: "designconclusion"/.test(workflow), false);
    // An old link lands on D&I Assessment, at section 7.
    has(workflow, 'designconclusion: "designassessment",');
    has(oldRoute, 'destination.searchParams.set("step", "designassessment");');
    has(oldRoute, 'destination.hash = "di-conclusion";');
  });
});

describe("section 7's Sign-off", () => {
  it("is the end of section 7, with the preparer's row then the reviewer's", () => {
    has(view, "<SignOffOf paper={paper} actions={actions} head={head} />");
    has(view, "<SignOffBlock");
    has(block, "<Mark n={1} done={preparedDone} />");
    has(block, '<Mark n={2} done={signedOff} waiting={stage === "sent"} />');
    // The reviewer's sign-off names the request it ends, where one stands.
    has(block, "...(request === null ? {} : { request_id: request.id }),");
    // The picker offers only whom the server offers; the others are shown, greyed, with
    // the server's reason.
    has(picker, "disabled={!item.offered}");
    has(picker, "<small id={`@{uid}-@{item.id}`}>{detail}</small>");
    has(
      preparer,
      "const offered = (sendFor?.reviewers ?? []).filter((item) => item.offered);",
    );
  });

  it("shows a write as done only once the server confirmed it, and reads again when in doubt", () => {
    // The reviewer's row: a refusal returns before anything is said as done.
    assert.match(
      block,
      /const said = await perform\(\);[\s\S]*?if \(!said\.done\) \{\s*setRefusal\(said\.refusal\);[\s\S]*?if \(said\.doubt\) \{[\s\S]*?onDone\(\);\s*\}\s*return;\s*\}[\s\S]*?setConfirmed\(kind\);/,
    );
    // Nothing is pressed again until the records read again show it.
    assert.match(
      block,
      /if \(busy\.current \|\| confirmed !== null\) \{\s*return;/,
    );
    has(block, 'setRefusal(""); setConfirmed(null); setOpen(null);');
    // Done is the server's 200, or the sign-off's own notice.
    has(block, "done: answer.status === 200,");
    has(
      block,
      'answer.notice === (intent === "sign" ? "dc-signed" : "dc-reopened");',
    );
    // The preparer's "Sign and send for review" posts the send route; its refusal is said.
    has(
      preparer,
      'const intent = kind === "prepare" && sendFor !== null ? "send" : kind;',
    );
    has(preparer, "REVIEW_ROUTES.send,");
    assert.match(
      preparer,
      /const said = signOffRefusal\(intent, answer\.status, answer\.detail\);\s*if \(said !== ""\) \{/,
    );
  });

  it("says a refusal in an alert that takes the focus, and never drops the focus", () => {
    for (const source of [block, preparer]) {
      has(
        source,
        '<p className="ps-refusal" role="alert" tabIndex={-1} ref={alert}>',
      );
      has(
        source,
        "window.requestAnimationFrame(() => alert.current?.focus());",
      );
    }
    // Into the reason when Return or Reopen opens it, back to its button on Cancel, and
    // to the row's heading once a confirmed write is shown.
    has(block, "document.getElementById(`@{uid}-@{which}`)?.focus(),");
    has(block, "window.requestAnimationFrame(() => opener.current?.focus());");
    has(block, "window.requestAnimationFrame(() => heading.current?.focus());");
    // The picker gives the focus back to its line when it closes.
    has(
      picker,
      "window.requestAnimationFrame(() => trigger.current?.focus());",
    );
  });

  it("returns only with a reason of 10 to 1,000 characters, and reminds once an hour", () => {
    has(
      block,
      "if (said.length < RETURN_MIN || said.length > RETURN_MAX) { return; }",
    );
    has(block, "aria-disabled={wait > 0 || sending !== null}");
    has(block, "const wait = remindWaitMinutes(request, now);");
  });

  it("sets no HTML", () => {
    for (const source of [block, preparer, picker, waiting]) {
      assert.equal(
        /dangerouslySetInnerHTML|innerHTML|outerHTML/.test(source),
        false,
      );
      assert.equal(/the client/i.test(source), false);
    }
  });
});

describe("the routes", () => {
  it("validate with the model, use the session cookie only, and answer as JSON", () => {
    for (const [intent, path] of Object.entries(ROUTES)) {
      const route = read(path);
      has(route, `return forwardReview("${intent}", request);`);
      assert.equal(/redirect/i.test(route), false, path);
    }
    has(proxy, "const write = reviewWrite(intent, fields);");
    has(
      proxy,
      'return NextResponse.json({ status: 422, detail: "", result: null });',
    );
    has(proxy, 'headers.set("cookie", `aw_session=@{session}`);');
    has(proxy, "return NextResponse.json({ status, detail, result });");
    for (const source of [proxy, mineRoute]) {
      assert.equal(/redirect|console\./.test(code(source)), false);
      assert.equal(/authorization|bearer/i.test(source), false);
    }
    has(
      mineRoute,
      "const path = waitingPath(new URL(request.url).searchParams);",
    );
    // The sign-off in the background is answered as JSON.
    has(oldRoute, 'if (request.headers.get("x-dc-fetch") === "1") {');
  });
});

describe("Home", () => {
  it("lists what waits for the viewer's review, quietly where nothing does", () => {
    has(home, "<ReviewWaiting");
    has(waiting, "fetch(`/workspace/review-requests?@{query}`, {");
    has(waiting, "if (read.items.length === 0) { return null; }");
    has(waiting, '<h2 id="home-review-title">Waiting for your review</h2>');
    has(waiting, '<span className="count">{read.items.length}</span>');
    has(waiting, "href={waitingHref(item, organizationId, projectId)}");
    has(waiting, "control.abort();");
  });
});

describe("independent review of 3.8 (16 November 2026)", () => {
  it("keeps Sign and send for review on a draft for a viewer the server counts as a reviewer", () => {
    // "Reopen to change" is hidden from a reviewer on a PREPARED workpaper only; a draft
    // is the server's `can_edit` (preparerRowMayAct, tested in the model).
    assert.equal(/reviewerOnly/.test(block), false);
    has(
      block,
      "mayAct={preparerRowMayAct({ preparerMayAct, paperStatus: facts.status,",
    );
  });

  it("prepares nothing where the D&I conclusion could not be read", () => {
    has(block, "const press = preparerPressOf(conclusion);");
    has(block, 'const flow = press === "send";');
    has(block, 'unread={press === "unread"}');
    has(preparer, 'if (unread && kind === "prepare") { return; }');
    has(preparer, 'if (facts.status !== "DRAFT" || !mayAct || unread) {');
    has(preparer, '"the sign-off could not be read. Refresh the page."');
  });

  it("names the viewer from the conclusion body or the session, not the notes route alone", () => {
    has(block, "const viewer = conclusion?.viewerId ?? viewerId;");
    has(block, "viewerId: viewer,");
    has(block, "viewerId={viewer}");
    has(loader, "parseDesignConclusion(ok(designConclusion), model.userId),");
    has(shellModel, "userId: user.id,");
  });

  it("offers Change reviewer and Remind by the server's may_manage rule, Remind too", () => {
    has(block, "const mayChange = mayManageRequest({");
    has(block, "canManage: conclusion.canManageRequest,");
    assert.equal(/const mayChange = canAct;/.test(block), false);
    assert.equal(/side === "preparer" \? \(\s*<button/.test(block), false);
  });

  it("shows the reminder to the reviewer, in section 7 and on Home", () => {
    has(
      block,
      '<span className="ps-who">{sentToYouLine(request, shortDay)}</span>',
    );
    has(waiting, "` · @{reminderWords(item.remindedAt, day)}`");
    has(waiting, "waitingLine(item, day)");
  });

  it("starts Sign and send again on the reviewer who returned it", () => {
    has(preparer, "const returnedAt = sendFor?.returned?.at ?? null;");
    assert.match(
      preparer,
      /if \(seenReturn\.current !== returnedAt\) \{\s*seenReturn\.current = returnedAt;\s*if \(returnedAt !== null\) \{\s*setReviewerId\(startOn\);/,
    );
    has(preparer, "}, [returnedAt, startOn]);");
  });

  it("shows the count in the navigation, beside Home", () => {
    has(shell, "<ReviewNavCount");
    has(shell, 'item.id === "overview" && model.selectedProject !== null ? (');
    has(
      waiting,
      "next = body.status === 200 ? waitingCountOf(body.result) : null;",
    );
    has(waiting, "aria-label={waitingCountLabel(count)}");
    has(waiting, "if (count === null || count <= 0) { return null; }");
  });
});

describe("the fast tier", () => {
  it("runs these tests", () => {
    assert.match(
      makefile,
      /tests\/review-request-model\.test\.ts tests\/review-signoff-view\.test\.ts/,
    );
  });
});
