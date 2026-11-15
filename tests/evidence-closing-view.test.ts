import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Closing a request with tickmarks (docs/evidence-assurance.md, section 10.15), read from
// the screen's own files. What must hold however it looks: the acceptance and the
// finding's dismissal a tickmark may carry go only through the row's existing handlers
// (the same Accept and the same finding decision, with the same bodies), only after the
// server has confirmed the tickmark, in that order, each said as done only after its own
// answer, and never tried again unasked; nothing is accepted or dismissed that the
// person did not leave ticked; the two boxes are real, labelled checkboxes that start
// ticked; a settled request's first line and its primary Accept; the kept and
// earlier-check lines; the coverage's own state for a tickmark, never green; and every
// sentence that holds the D&I sign-off shown whole.

const read = (path: string) => readFileSync(path, "utf8");
const view = read("apps/web/src/attribute-tickmark.tsx");
const digest = read("apps/web/src/check-digest.tsx");
const list = read("apps/web/src/design-evidence.tsx");
const findings = read("apps/web/src/evidence-findings-view.tsx");
const planView = read("apps/web/src/evidence-plan-view.tsx");
const controls = read("apps/web/src/controls-view.tsx");
const panel = read("apps/web/src/design-conclusion-panel.tsx");
const digestCss = read("apps/web/app/check-digest.css");
const listCss = read("apps/web/app/design-evidence.css");
const workflowCss = read("apps/web/app/control-workflow.css");
const makefile = read("Makefile");

const squash = (source: string) => source.replace(/\s+/g, " ");
/** Whether the source holds what is written, whatever its line breaks. A placeholder
 * of the source is written `@{...}` here, so that no string of these tests holds one. */
const has = (source: string, written: string, label = written) =>
  assert.ok(
    squash(source).includes(squash(written.replaceAll("@{", "${"))),
    label,
  );
const count = (source: string, pattern: RegExp) =>
  (source.match(pattern) ?? []).length;
const rule = (css: string, selector: string) => {
  const from = css.indexOf(`${selector} {`);
  assert.ok(from >= 0, selector);
  return css.slice(from, css.indexOf("}", from));
};

const submit = view.slice(
  view.indexOf("const submit = async"),
  view.indexOf("const reopenProblem"),
);
const at = (text: string) => {
  const found = submit.indexOf(text);
  assert.ok(found >= 0, text);
  return found;
};

describe("what follows a recorded tickmark", () => {
  it("is called only after the server confirmed the tickmark: the dismissal, then the acceptance", () => {
    assert.ok(submit.length > 400);
    const order = [
      "await tickmark.record(",
      "confirmed(TICKMARK_RECORDED)",
      "if (refused !== null || !(also.dismiss || also.accept)) {",
      "await tickmark.dismiss(line, note)",
      "await tickmark.accept()",
    ].map(at);
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
    // A refused tickmark returns before either: nothing follows a tickmark that was
    // not recorded.
    has(
      submit,
      "if (refused !== null || !(also.dismiss || also.accept)) { // Refused: the tickmark was not recorded, so nothing follows it. return; }",
    );
  });

  it("goes only through the row's handlers, each called once, and never again", () => {
    assert.equal(count(view, /tickmark\.accept\(/g), 1);
    assert.equal(count(view, /tickmark\.dismiss\(/g), 1);
    assert.equal(count(submit, /tickmark\.accept\(/g), 1);
    assert.equal(count(submit, /tickmark\.dismiss\(/g), 1);
    // No loop and no timer around them: a refusal is said, not retried.
    assert.equal(/\b(while|for)\s*\(/.test(submit), false);
    assert.equal(/setTimeout|setInterval|retry/i.test(submit), false);
    // The view still sends nothing of its own.
    for (const forbidden of [
      /fetch\(/,
      /intent:/,
      /method:/,
      /\/workspace\//,
    ]) {
      assert.equal(forbidden.test(view), false, String(forbidden));
    }
  });

  it("does only what the person left ticked, as the form stood at the press", () => {
    has(
      submit,
      "const also = { dismiss: dismissing && dismissToo, accept: after.accept && acceptNow, };",
    );
    assert.ok(at("const also = {") < at("await tickmark.record("));
    has(submit, "if (also.dismiss) {");
    has(submit, "} else if (also.accept) {");
    // What is offered is the model's answer for the row, never worked out here.
    has(
      view,
      "const after: TickmarkAfter = tickmark !== null && offer !== null ? tickmark.after(line) : { accept: false, dismiss: false };",
    );
    has(view, "const dismissing = dismissOffered(after, draft.kind);");
  });

  it("says each as done only after its own answer, and a refusal in the server's sentence", () => {
    has(
      submit,
      'say({ key: "dismiss", state: "working", text: FINDING_DISMISSING }); const kept = await tickmark.dismiss(line, note); held = kept !== null; say( kept === null ? { key: "dismiss", state: "done", text: FINDING_DISMISSED } : { key: "dismiss", state: "refused", text: findingKept(kept) }, );',
    );
    has(
      submit,
      'say({ key: "accept", state: "working", text: EVIDENCE_ACCEPTING }); const kept = await tickmark.accept(); say( kept === null ? { key: "accept", state: "done", text: EVIDENCE_ACCEPTED } : { key: "accept", state: "refused", text: evidenceNotAccepted(kept), }, );',
    );
    // The tickmark's reason is the dismissal's note, as it is sent.
    has(submit, 'const note = draft.reason.replace(/\\s+/g, " ").trim();');
    // The tickmark stays, and is said to: a refusal of either reopens nothing.
    has(
      view,
      "`The evidence was not accepted. @{closed(refusal)} The tickmark stays.`",
    );
    has(
      view,
      "`The proposed finding was not dismissed. @{closed(refusal)} The tickmark stays.`",
    );
    assert.equal(/tickmark\.reopen\(/.test(submit), false);
    // A refusal is announced.
    has(view, 'role={step.state === "refused" ? "alert" : undefined}');
  });

  it("does not accept over a finding whose dismissal was refused", () => {
    has(
      submit,
      'if (also.accept && held) { // The finding still waits on the person: the request is not accepted over it. say({ key: "accept", state: "refused", text: ACCEPT_HELD }); } else if (also.accept) {',
    );
  });
});

describe("the two boxes", () => {
  it("are real checkboxes, labelled, ticked to start each time the form opens", () => {
    assert.equal(count(view, /type="checkbox"/g), 2);
    has(view, "const [acceptNow, setAcceptNow] = useState(true);");
    has(view, "const [dismissToo, setDismissToo] = useState(true);");
    has(view, "setAcceptNow(true); setDismissToo(true);");
    has(
      view,
      '<label className="cdg-tmf-check"> <input type="checkbox" checked={dismissToo} onChange={(event) => setDismissToo(event.target.checked)} /> <span>{DISMISS_FINDING}</span> </label>',
    );
    has(
      view,
      '<label className="cdg-tmf-check"> <input type="checkbox" checked={acceptNow} aria-describedby={`@{id}-accept-hint`} onChange={(event) => setAcceptNow(event.target.checked)} /> <span> {ACCEPT_NOW} <span id={`@{id}-accept-hint`} className="cdg-tmf-hint"> {ACCEPT_NOW_HINT} </span> </span> </label>',
    );
    has(
      view,
      '<fieldset className="cdg-tmf-also"> <legend>{ALSO_LABEL}</legend>',
    );
    // Offered only where the model offers them.
    has(view, "{dismissing || after.accept ? (");
    has(view, "{dismissing ? (");
    has(view, "{after.accept ? (");
  });

  it("are styled with tokens, with nothing that moves", () => {
    const from = digestCss.indexOf(
      "Closing a request with tickmarks (section 10.15)",
    );
    assert.ok(from > 0);
    const part = digestCss.slice(
      from,
      digestCss.indexOf("@media (max-width: 640px)", from),
    );
    for (const selector of [
      ".cdg-tmf-check",
      ".cdg-tm-steps",
      ".cdg-tm-step",
      ".cdg-tm-earlier",
      ".cdg-item-note",
    ]) {
      assert.ok(part.includes(`${selector} {`), selector);
    }
    assert.equal(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(part), false);
    assert.equal(/animation|transition/.test(part), false);
    assert.equal(
      /var\(--(success|warning|danger)-(soft|border)\)/.test(part),
      false,
    );
  });
});

describe("the row's own handlers", () => {
  it("accepts through the row's one Accept, with why it cannot be pressed and the server's sentence", () => {
    has(
      list,
      "accept: async () => { const off = acceptOff.current; if (off !== null) { return off; } return (await accept()) ? null : (action.refusal() ?? ACCEPT_REFUSED); },",
    );
    // One handler and one write, as before: the button's, and now the tickmark's.
    assert.equal(count(list, /async function accept\(\)/g), 1);
    assert.equal(count(list, /sufficiency: "ACCEPTED"/g), 1);
    assert.equal(count(list, /await accept\(\)/g), 1);
    has(list, 'if (ok) { onDone("Evidence accepted."); } return ok; }');
    // Why it cannot be pressed is what its button says, read when the acceptance is due.
    has(
      list,
      "acceptOff.current = locked ? lockedWhy : asking !== null ? ASKING_FIRST : null;",
    );
    // The refusal is the plan route's own, kept for the caller that says it.
    has(planView, "last.current = message;");
    has(planView, "refusal: () => last.current,");
    assert.equal(
      count(planView, /fetch\(/g),
      count(planView, /\/workspace\/evidence-plan"/g),
    );
  });

  it("dismisses through the finding's own decision, with the note", () => {
    has(
      list,
      'return (await decideFinding( findingsAction, finding, "DISMISS", note, )) ? null : (findingsAction.refusal() ?? DISMISS_REFUSED);',
    );
    assert.equal(count(list, /decideFinding\(/g), 1);
    // The finding's own buttons send the same way: one body, written once.
    has(
      findings,
      "const ok = await decideFinding(action, finding, decision, note, question);",
    );
    assert.equal(count(findings, /intent: "decide"/g), 1);
    assert.equal(count(findings, /fetch\(/g), 1);
    has(
      findings,
      'return action.run(`finding-@{finding.id}`, { intent: "decide", finding_id: finding.id, decision, note, question: decision === "EDIT" ? question : "", version: finding.version, });',
    );
    // The row adds no route and no intent of its own for either.
    assert.equal(count(list, /intent: "decide"/g), 0);
    assert.equal(count(list, /\/workspace\/evidence-findings/g), 0);
  });

  it("offers each as the model answers it for the row", () => {
    has(
      list,
      "after: (line) => tickmarkAfter(assured.check, line, { canAccept: canAct && row.canAccept, findingStatus: findingOf(line)?.status ?? null, }),",
    );
    has(
      list,
      'closing={{ accepted: item.state === "ACCEPTED", canAccept: canAct && row.canAccept, }}',
    );
  });
});

describe("the first screen of a settled request", () => {
  it("leads with the model's closing status, and keeps Accept the one primary action", () => {
    has(digest, "const digest = withClosing(made, closing);");
    has(digest, "digest: made,");
    has(
      digest,
      '<h5 className="cdg-outcome" tabIndex={-1}> {digest.status} </h5>',
    );
    has(list, "closing={closing}");
    const foot = digest.slice(
      digest.indexOf('<div className="cdg-foot-acts">'),
      digest.indexOf('<div className="cdg-one"'),
    );
    has(
      foot,
      '<button type="button" className="btn" disabled={accept.off !== null}',
    );
    has(foot, "onClick={accept.onAccept}");
    assert.equal(count(foot, /className="btn"/g), 1);
    has(foot, 'className="btn btn-secondary"');
  });

  it("says a tickmark from an earlier check on its item, quietly", () => {
    has(
      digest,
      '{item.note !== undefined ? ( // A tickmark recorded on an earlier check (section 10.15, item 9): a quiet // line of its own, so the attribute\'s wording keeps its line. <span className="cdg-item-note">{item.note}</span> ) : null}',
    );
    has(
      digest,
      '<span className="cdg-quiet-note cdg-earlier"> {item.note} </span>',
    );
    // Beside Change and Reopen, which it describes.
    has(
      view,
      '{earlier ? ( // It stands through a later check (section 10.15, item 9): said beside // Change and Reopen, for anyone who reads the tickmark. <p className="cdg-tm-earlier" id={`@{id}-earlier`}> <UiIcon name="clock" size={13} /> {EARLIER_CHECK} </p> ) : null}',
    );
    assert.equal(
      count(
        view,
        /aria-describedby=\{earlier \? `\$\{id\}-earlier` : undefined\}/g,
      ),
      2,
    );
    has(view, "const earlier = fromEarlierCheck(standing);");
  });
});

describe("the list", () => {
  it("says the tickmarks kept on a check that is not current, on its line", () => {
    has(
      list,
      'const kept = check.kept !== "" ? ( <p className="de-check-line de-check-kept"> <UiIcon name="tag" size={13} /> <span>{check.kept}</span> </p> ) : null;',
    );
    const checking = list.slice(
      list.indexOf('if (check.standing === "CHECKING") {'),
      list.indexOf('if (check.standing !== "REVIEWED" || digest === null) {'),
    );
    const other = list.slice(
      list.indexOf('if (check.standing !== "REVIEWED" || digest === null) {'),
      list.indexOf("const upgrade ="),
    );
    has(checking, "{kept} <Problem text={refused} />");
    has(other, "{kept} <Problem text={refused} />");
  });

  it("draws a tickmark in the coverage as a state of its own, never the green of evidence", () => {
    has(
      list,
      'chip.state === "TICKMARK" ? chip.tickmark === "EXCEPTION" ? "is-flagged" : "is-tickmark"',
    );
    has(list, "{COVERAGE_TICKMARKS[chip.tickmark].chip}");
    // The check mark is drawn for evidence only.
    has(
      list,
      '{chip.state === "EVIDENCED" ? ( <span className="dq-cov-state" aria-hidden="true"> <UiIcon name="check" size={12} />',
    );
    const neutral = rule(listCss, ".dq-cov.is-tickmark");
    assert.match(neutral, /color: var\(--neutral\);/);
    assert.match(neutral, /background: var\(--neutral-soft\);/);
    assert.equal(/success/.test(neutral), false);
    const flagged = rule(listCss, ".dq-cov.is-flagged");
    assert.match(flagged, /color: var\(--danger\);/);
    assert.equal(/success/.test(flagged), false);
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(`${neutral}${flagged}`), false);
  });

  it("tells the workflow what is in hand to accept and what is to look at again", () => {
    has(
      controls,
      "const lookAgain = requestsToLookAgain( requirements, engagement.evidenceAssurance ?? null, );",
    );
    has(
      controls,
      "files: item.files.length, again: lookAgain.has(item.id), })),",
    );
  });
});

describe("the D&I conclusion", () => {
  it("shows every sentence that holds the sign-off, whole", () => {
    has(panel, "const holds = signHolds(conclusion);");
    has(
      panel,
      '{holds.length > 0 ? ( <div className="dc-blocked" role="note"> {holds.map((text) => ( <p key={text}>{text}</p> ))} </div> ) : null}',
    );
    // Never the first alone, and never cut.
    assert.equal(
      /blocking\[0\]|\.slice\(|substring|truncate/.test(panel),
      false,
    );
    for (const selector of [".dc-blocked", ".dc-blocked > p"]) {
      const css = rule(workflowCss, selector);
      assert.equal(
        /text-overflow|line-clamp|white-space: nowrap|overflow: hidden|max-height/.test(
          css,
        ),
        false,
        selector,
      );
    }
    assert.match(
      rule(workflowCss, ".dc-blocked > p"),
      /overflow-wrap: anywhere;/,
    );
    // The out-of-date reasons are all said, as the server words them.
    has(
      panel,
      'The sign-off no longer holds: {conclusion.outOfDate.join("; ")}.',
    );
  });
});

describe("the standards", () => {
  it("keeps the words plain", () => {
    for (const source of [view, digest, list, panel]) {
      assert.equal(/the client/i.test(source), false);
    }
    const said = [...view.matchAll(/["`]([^"`\n]{12,})["`]/g)].map(
      (match) => match[1] ?? "",
    );
    for (const text of said) {
      assert.equal(text.includes("—"), false, text);
    }
  });

  it("runs in the fast tier", () => {
    const fast = makefile.match(/^FAST_NODE \?= (.*)$/m)?.[1] ?? "";
    assert.ok(fast.includes("tests/evidence-closing-model.test.ts"));
    assert.ok(fast.includes("tests/evidence-closing-view.test.ts"));
  });
});
