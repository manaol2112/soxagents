import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Closing a request with tickmarks (docs/evidence-assurance.md, section 10.15), read from
// the screen's own files. What must hold however it looks: the acceptance and the
// finding's dismissal a tickmark may carry go only through the row's existing handlers
// (the same Accept and the same finding decision, with the same bodies), and only
// through the one chain that orders them (tickmark-chain.ts, run with scripted answers in
// tests/tickmark-chain.test.ts: the order, the stops, the unknown outcome); nothing is
// accepted or dismissed that the person did not leave ticked; the two boxes are real,
// labelled checkboxes, the acceptance ticked to start only where nothing else waits; a
// settled request's first line and its primary Accept; the kept and earlier-check lines;
// the coverage's own state for a tickmark, never green; an exception that holds the D&I
// sign-off drawn from the model's own head, never green; and every sentence that holds
// the sign-off, and every out-of-date reason, shown whole.

const read = (path: string) => readFileSync(path, "utf8");
const view = read("apps/web/src/attribute-tickmark.tsx");
const chainSource = read("apps/web/src/tickmark-chain.ts");
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
  // Rewritten 15 November 2026 (independent review of 408f4ce, item 10c, and its ask for
  // a committed test that executes the chain).
  // Old: these tests read the order out of the form's own source (`await
  // tickmark.record(` before `await tickmark.dismiss(line, note)` before `await
  // tickmark.accept()`, the early return on a refusal, `held = kept !== null`), where
  // the chain was written inline; a call's lost answer was a refusal like any other.
  // New: the chain is one pure function the form runs, and its order, its stops and the
  // unknown outcome are tested by running it (tests/tickmark-chain.test.ts). What is
  // read from the source here is only that the form runs it, once, with the row's own
  // handlers, and adds no call of its own.
  it("is run by the one chain, given the row's three handlers and what the person left ticked", () => {
    assert.ok(submit.length > 400);
    has(
      submit,
      "await tickmarkChain( { record: () => tickmark.record(line.attributeId, fields, seen), dismiss: () => tickmark.dismiss(line, note), accept: () => tickmark.accept(), }, also, {",
    );
    assert.equal(count(view, /tickmarkChain\(/g), 1);
    // The form reads the chain's answers; it does not order or stop anything itself.
    assert.equal(/\bheld\b|refused !== null|kept === null/.test(submit), false);
    // Where an answer did not arrive, the list is read again through the row.
    has(submit, "reread: tickmark.reread,");
  });

  it("goes only through the row's handlers, each called once, and never again", () => {
    assert.equal(count(view, /tickmark\.accept\(/g), 1);
    assert.equal(count(view, /tickmark\.dismiss\(/g), 1);
    assert.equal(count(view, /tickmark\.record\(/g), 1);
    assert.equal(count(submit, /tickmark\.accept\(/g), 1);
    assert.equal(count(submit, /tickmark\.dismiss\(/g), 1);
    // No loop and no timer around them: a refusal is said, not retried.
    assert.equal(/\b(while|for)\s*\(/.test(submit), false);
    assert.equal(/setTimeout|setInterval|retry/i.test(submit), false);
    // Nor in the chain: each call is awaited once, in a straight line.
    const run = chainSource.slice(
      chainSource.indexOf("export async function tickmarkChain"),
    );
    assert.equal(/\b(while|for)\s*\(/.test(run), false);
    assert.equal(/setTimeout|setInterval|retry/i.test(run), false);
    assert.equal(count(run, /answered\(calls\.record\)/g), 1);
    assert.equal(count(run, /answered\(calls\.dismiss\)/g), 1);
    assert.equal(count(run, /answered\(calls\.accept\)/g), 1);
    // The view and the chain still send nothing of their own.
    for (const source of [view, chainSource]) {
      for (const forbidden of [
        /fetch\(/,
        /intent:/,
        /method:/,
        /\/workspace\//,
      ]) {
        assert.equal(forbidden.test(source), false, String(forbidden));
      }
    }
    // The chain is pure: no React, no router, nothing of the page.
    assert.equal(
      /from "react"|next\/|window\.|document\./.test(chainSource),
      false,
    );
  });

  it("does only what the person left ticked, as the form stood at the press", () => {
    has(
      submit,
      "const also: ChainAlso = { dismiss: dismissing && dismissToo, accept: after.accept && acceptNow, };",
    );
    assert.ok(at("const also: ChainAlso = {") < at("await tickmarkChain("));
    // What is offered is the model's answer for the row, from the first screen's own
    // facts, never worked out here.
    has(
      view,
      'const after: TickmarkAfter = tickmark !== null && offer !== null ? tickmark.after(line, facts) : { accept: false, dismiss: false, left: "" };',
    );
    has(view, "const dismissing = dismissOffered(after, draft.kind);");
  });

  it("draws each line as the chain says it: done only after its own answer, a refusal or an unknown outcome as an alert", () => {
    // The tickmark's own line: recorded only on the chain's word; otherwise the form
    // stays with the chain's sentence (the server's refusal, or that it is not known).
    has(
      submit,
      'if (step.state === "done") { confirmed(TICKMARK_RECORDED); setFollowing(also.dismiss || also.accept); } else {',
    );
    has(submit, "setProblem(step.text); setFollow(true);");
    // The tickmark's reason is the dismissal's note, as it is sent.
    has(submit, 'const note = draft.reason.replace(/\\s+/g, " ").trim();');
    // The tickmark stays, and is said to: a refusal of either reopens nothing.
    has(
      chainSource,
      "`The evidence was not accepted. @{closed(refusal)} The tickmark stays.`",
    );
    has(
      chainSource,
      "`The proposed finding was not dismissed. @{closed(refusal)} The tickmark stays.`",
    );
    assert.equal(/tickmark\.reopen\(/.test(submit), false);
    assert.equal(/reopen/i.test(chainSource), false);
    // A refusal, an acceptance that was held and an unknown outcome are announced.
    has(
      view,
      'role={ step.state === "refused" || step.state === "held" || step.state === "unknown" ? "alert" : undefined }',
    );
    // An unknown outcome has its own mark and tone: neither a failure's nor a success's.
    has(view, 'unknown: "help",');
    const unknown = rule(
      digestCss,
      ".cdg-tm-step.is-unknown,\n.cdg-tm-step.is-unknown > svg",
    );
    assert.match(unknown, /color: var\(--warning\);/);
    assert.equal(/danger|success/.test(unknown), false);
  });
});

describe("the two boxes", () => {
  it("are real checkboxes, labelled; the acceptance ticked to start only where nothing else waits", () => {
    assert.equal(count(view, /type="checkbox"/g), 2);
    // Rewritten 15 November 2026 (independent review of 408f4ce, item 9). Old: both
    // boxes started ticked each time the form opened (`useState(true)`,
    // `setAcceptNow(true)`). New: the acceptance starts ticked only where the model says
    // nothing else waits on the request (`after.left` is ""), and what is left is said
    // under it; the dismissal still starts ticked. The rule itself is run in
    // tests/evidence-closing-model.test.ts.
    has(view, "const [acceptNow, setAcceptNow] = useState(false);");
    has(view, "const [dismissToo, setDismissToo] = useState(true);");
    has(
      view,
      'setAcceptNow(after.accept && after.left === ""); setDismissToo(true);',
    );
    assert.equal(/setAcceptNow\(true\)/.test(view), false);
    has(
      view,
      '<label className="cdg-tmf-check"> <input type="checkbox" checked={dismissToo} onChange={(event) => setDismissToo(event.target.checked)} /> <span>{DISMISS_FINDING}</span> </label>',
    );
    has(
      view,
      '<label className="cdg-tmf-check"> <input type="checkbox" checked={acceptNow} aria-describedby={`@{id}-accept-hint`} onChange={(event) => setAcceptNow(event.target.checked)} /> <span> {ACCEPT_NOW} <span id={`@{id}-accept-hint`} className="cdg-tmf-hint"> {after.left !== "" ? after.left : ACCEPT_NOW_HINT} </span> </span> </label>',
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
    // Rewritten 15 November 2026 (item 10c). Old: the handler answered null or a
    // sentence (`return off;`, `? null : (action.refusal() ?? ACCEPT_REFUSED)`), so a
    // lost answer read as a refusal. New: it answers as the chain reads it: confirmed,
    // refused in a sentence, or not known where the plan route's answer did not arrive.
    has(
      list,
      "accept: async () => { const off = acceptOff.current; if (off !== null) { return refusedWith(off); } return (await accept()) ? CONFIRMED : answerOf(action.refusal() ?? ACCEPT_REFUSED, action.lost()); },",
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
    // Whether its answer arrived is kept beside it, and a lost answer is never worded
    // as a failure.
    has(
      planView,
      "lost.current = outcomeUnknown(status); const message = lost.current ? ANSWER_LOST : planProblem(status, detail);",
    );
    has(planView, "lost: () => lost.current,");
    assert.equal(
      count(planView, /fetch\(/g),
      count(planView, /\/workspace\/evidence-plan"/g),
    );
  });

  it("dismisses through the finding's own decision, with the note", () => {
    has(
      list,
      'return (await decideFinding( findingsAction, finding, "DISMISS", note, )) ? CONFIRMED : answerOf( findingsAction.refusal() ?? DISMISS_REFUSED, findingsAction.lost(), );',
    );
    has(
      findings,
      "lost.current = outcomeUnknown(status); const message = lost.current ? ANSWER_LOST : findingsProblem(status, detail);",
    );
    has(findings, "lost: () => lost.current,");
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
      "after: (line, open) => tickmarkAfter(assured.check, line, { canAccept: canAct && row.canAccept, findingStatus: findingOf(line)?.status ?? null, open, }),",
    );
    // The first screen's own facts are what the row's model reads what is left from.
    has(digest, "open={digest.facts}");
    // The recording answers as the chain reads it, and the list is read again in place
    // where an answer did not arrive.
    has(
      list,
      'answerOf( await send({ intent: "disposition", requirement_id: requirementId, attribute_id: attributeId, ...fields, replaces, }), lost.current, ),',
    );
    has(list, "reread: () => startTransition(() => router.refresh()),");
    has(list, "reread: tickmarks.reread,");
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

  it("tells the workflow what is to look at again, and nothing of an item's files", () => {
    has(
      controls,
      "const lookAgain = requestsToLookAgain( requirements, engagement.evidenceAssurance ?? null, );",
    );
    // Rewritten 15 November 2026 (item 7). Old: `files: item.files.length, again:
    // lookAgain.has(item.id)`: the count of files made the workflow say "1 item to
    // review" of items nobody can accept. New: the state the server gives says it.
    has(controls, "again: lookAgain.has(item.id), })),");
    assert.equal(/files: item\.files\.length,\s+again:/.test(controls), false);
    // What holds the D&I sign-off goes to the workflow, which reads an exception from it.
    has(controls, "blocking: engagement.designConclusion.blocking,");
  });
});

describe("the D&I conclusion", () => {
  it("shows every sentence that holds the sign-off, whole", () => {
    // Rewritten 15 November 2026 (item 6). Old: `const holds = signHolds(conclusion);`
    // under the card, beside a card that still read "Effective, awaiting reviewer
    // sign-off". New: the card itself is the model's head (conclusionHead: the
    // exception's sentences as its reason), and what else holds the sign-off is under
    // it (holdsBelow); between the two every sentence of signHolds is said once
    // (tests/evidence-closing-model.test.ts runs that).
    has(panel, "const head = conclusionHead(conclusion);");
    has(panel, "const holds = holdsBelow(conclusion);");
    has(
      panel,
      '{holds.length > 0 ? ( <div className="dc-blocked" role="note"> {holds.map((text) => ( <p key={text}>{text}</p> ))} </div> ) : null}',
    );
    has(
      panel,
      '<div className="dc-excepted" role="note"> {head.reasons.map((text) => ( <p key={text}>{text}</p> ))}',
    );
    // Never the first alone, and never cut.
    assert.equal(
      /blocking\[0\]|reasons\[0\]|\.slice\(|substring|truncate/.test(panel),
      false,
    );
    for (const selector of [
      ".dc-blocked",
      ".dc-blocked > p",
      ".dc-excepted",
      ".dc-excepted > p",
      ".dc-outdated",
      ".dc-outdated li",
    ]) {
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
    assert.match(
      rule(workflowCss, ".dc-excepted > p"),
      /overflow-wrap: anywhere;/,
    );
  });

  it("draws the card from the model's head: no status, verdict or effect worded here", () => {
    has(panel, "<div className={`dc-verdict is-@{head.tone}`}>");
    has(panel, '<h3 id="dc-heading">{head.heading}</h3>');
    has(panel, "<span className={`dc-status is-@{head.statusTone}`}>");
    has(panel, '<p className="dc-verdict-word">{head.word}</p>');
    has(panel, '<p className="dc-effect">{head.effect}</p>');
    has(panel, "{head.next}");
    // What misled is no longer written in the panel at all: the model says it, and only
    // where no exception holds the sign-off.
    for (const words of [
      "Awaiting reviewer sign-off",
      "Once signed off",
      "cleared to proceed",
    ]) {
      assert.equal(panel.includes(words), false, words);
    }
    // An exception's card is never the green of effective.
    const excepted = rule(workflowCss, ".dc-verdict.is-excepted");
    assert.match(excepted, /border-left-color: var\(--warning\);/);
    assert.equal(/success/.test(excepted), false);
    const status = workflowCss.slice(
      workflowCss.indexOf(".dc-status.is-to_sign,"),
      workflowCss.indexOf(".dc-verdict-word {"),
    );
    assert.ok(status.includes(".dc-status.is-excepted"));
    assert.equal(/success/.test(status), false);
    assert.equal(
      /#[0-9a-fA-F]{3,8}\b/.test(
        `${excepted}${status}${rule(workflowCss, ".dc-excepted")}`,
      ),
      false,
    );
    // The exceptions the server lists are shown with who recorded each, and why.
    has(panel, "{conclusion.exceptions.length > 0 ? (");
    has(panel, "<strong>{exceptionLine(item, formatDate)}</strong>");
  });

  it("shows every out-of-date reason whole, each on its own line", () => {
    // Rewritten 15 November 2026 (item 6). Old: the reasons joined into one sentence
    // (`conclusion.outOfDate.join("; ")`), which a reason that names what changed (and
    // holds its own punctuation) no longer reads in. New: one line per reason, as sent.
    has(
      panel,
      '<div className="dc-outdated"> <p>The sign-off no longer holds:</p> <ul> {conclusion.outOfDate.map((reason) => ( <li key={reason}>{reason}</li> ))} </ul> <p>OE waits until a reviewer signs off again.</p> </div>',
    );
    assert.equal(/outOfDate\.join|outOfDate\[0\]/.test(panel), false);
    assert.match(
      rule(workflowCss, ".dc-outdated li"),
      /overflow-wrap: anywhere;/,
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
    // The chain itself is run there too.
    assert.ok(fast.includes("tests/tickmark-chain.test.ts"));
  });
});
