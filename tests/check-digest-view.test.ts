import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// A finished check as "Needs attention" (docs/evidence-assurance.md, section 10.12),
// read from the screen's own files. What must hold however it looks: the first screen
// is the verdict, what needs attention, the quiet line and the footer, in that order and
// nothing else until it is asked for; everything the row said before is still reachable;
// the components send and decide nothing; the asks reach the owner only through the
// row's existing follow-up form, and Accept is the row's existing one; a finding's
// decisions are the existing ones, drawn once; every caveat is on the first screen,
// never clipped; an attribute opened once stays in the page; every disclosure is a real
// button that names something that exists; and nothing moves under reduced motion.

const read = (path: string) => readFileSync(path, "utf8");
const digest = read("apps/web/src/check-digest.tsx");
const model = read("apps/web/src/check-digest-model.ts");
const list = read("apps/web/src/design-evidence.tsx");
const findings = read("apps/web/src/evidence-findings-view.tsx");
const css = read("apps/web/app/check-digest.css");
const listCss = read("apps/web/app/design-evidence.css");
const layout = read("apps/web/app/layout.tsx");
const makefile = read("Makefile");

/** A function's source: from its declaration to the next top-level one. */
const component = (source: string, name: string) => {
  const from = source.search(new RegExp(`\\n(?:export )?function ${name}\\b`));
  assert.ok(from >= 0, name);
  const next = source
    .slice(from + 1)
    .search(/\n(?:export )?(?:function |const [A-Z_]+\b|type )/);
  return source.slice(from, next < 0 ? undefined : from + 1 + next);
};

const count = (source: string, pattern: RegExp) =>
  source.match(pattern)?.length ?? 0;

/** A source on one line: every run of white space is one space, so an assertion on what
 * is written does not depend on how it is wrapped. */
const squash = (source: string) => source.replace(/\s+/g, " ");
/** Whether `written` is in the source, however it is wrapped. In `written`, "@{" stands
 * for the opening of a template's expression. */
const has = (source: string, written: string, label = written) =>
  assert.ok(
    squash(source).includes(squash(written).replaceAll("@{", "$" + "{")),
    label,
  );

/** The places, in order, at which each of these first appears; all must appear. */
const inOrder = (source: string, marks: string[]) => {
  const at = marks.map((mark) => source.indexOf(mark));
  assert.ok(
    at.every((place) => place >= 0),
    JSON.stringify(marks.filter((_, index) => (at[index] ?? -1) < 0)),
  );
  assert.deepEqual(
    at,
    [...at].sort((a, b) => a - b),
    marks.join(" < "),
  );
};

/** A rule's body in a stylesheet, by its exact selector. */
const rule = (sheet: string, selector: string) => {
  const from = sheet.indexOf(`\n${selector} {`);
  assert.ok(from >= 0, selector);
  return sheet.slice(from, sheet.indexOf("\n}", from));
};

const view = component(digest, "CheckDigestView");
const item = component(digest, "Item");
const attribute = component(digest, "Attribute");
const askBox = component(digest, "AskBox");
const askRow = component(digest, "AskRow");
const askWhy = component(digest, "AskWhy");
const table = component(digest, "tableOf");
const assurance = read("apps/web/src/evidence-assurance-model.ts");
// Changed 14 November 2026 (docs/evidence-annotations.md, section 5a, "One evidence
// viewer"). Old: the openers and the old viewer in evidence-preview.tsx. New: the old
// viewer is retired; the openers (the button, the dialog, the inline file) are in
// evidence-opener.tsx and show the one viewer of evidence-annotations.tsx.
const preview = read("apps/web/src/evidence-opener.tsx");
const check = component(list, "CheckOfRequest");
const row = component(list, "Row");
/** The first screen, and one attribute alone, as the view draws them. */
const summary = view.slice(
  view.indexOf('<div className="cdg-summary"'),
  view.indexOf("{visited.length > 0 ? ("),
);
const one = view.slice(view.indexOf("{visited.length > 0 ? ("));
/** The open row of a finished check, and of every other row. */
const reviewedBody = row.slice(
  row.indexOf("{open && reviewed ? ("),
  row.indexOf(") : open ? ("),
);
const otherBody = row.slice(row.indexOf(") : open ? ("));

describe("the first screen of a finished check", () => {
  it("is the verdict, what needs attention, the quiet line with All details, and the footer", () => {
    inOrder(summary, [
      'className="cdg-verdict"',
      "{DIGEST_ATTENTION}",
      "{under}",
      'className="cdg-quiet"',
      "{DIGEST_ALL_DETAILS}",
      'className="cdg-details"',
      "className={`cdg-foot${",
    ]);
    for (const [name, words] of [
      ["DIGEST_PROPOSED", "Proposed for your review"],
      ["DIGEST_ATTENTION", "Needs attention"],
      ["DIGEST_ALL_DETAILS", "All details"],
      ["DIGEST_NOTHING_SENT", "Nothing is sent until you approve it."],
      ["DIGEST_ACCEPT", "Accept evidence"],
    ]) {
      assert.ok(digest.includes(`export const ${name} = "${words}";`), name);
    }
    // No other part: the summary's direct parts are these and no list of attributes, of
    // follow-ups or of files.
    assert.equal(
      /digest\.attributes\.map|digest\.asks\.map|<AskGroup|<Attribute\b/.test(
        summary,
      ),
      false,
    );
  });

  it("where nothing waits, says what the model says of that: never its own 'nothing needs your attention'", () => {
    // Superseded after the independent review of 14 November 2026 (section 10.12, item
    // 3 of the fixes). Old: with an empty list the screen wrote its own constant,
    // "Nothing needs your attention.", whatever the outcome or the caveats said. New:
    // it renders `digest.calm`, the model's line, which is that sentence only for a
    // sufficient outcome with no caveat, and otherwise the review's own explanation or
    // the caveats' words. The screen has no such sentence of its own.
    has(
      summary,
      `) : calm !== "" ? ( // Nothing waits on the person: what the check itself says of that, which is // "nothing needs your attention" only where nothing says otherwise. <p className="cdg-calm">{calm}</p> ) : null}`,
      "the calm line is the model's",
    );
    // Second review, item 2(b): where the model has nothing else to say, its calm line is
    // what the accept note cautions, which the footer already says beside Accept; the
    // screen does not say it twice. A person with no footer reads it here.
    // Changed 14 November 2026 (docs/evidence-assurance.md, section 10.14, A). Old:
    // `const calm = digest.calm === caution ? "" : digest.calm;`. New: the same, the
    // model's calm line as it reads under the status line (calmUnderStatus), which drops
    // only what the status line now says itself ("Nothing needs your attention.", what
    // the tickmarks settle, or the caveats alone). The calm line stays the model's.
    has(
      view,
      'const calm = digest.calm === caution ? "" : calmUnderStatus(digest);',
    );
    assert.equal(count(digest, /digest\.calm\b/g), 1);
    assert.match(
      model,
      /return digest\.calm === DIGEST_NOTHING \|\|\s*digest\.calm\.startsWith\(DIGEST_TICKMARKED\) \|\|\s*digest\.calm === caveats\s*\? ""\s*: digest\.calm;/,
    );
    assert.equal(/DIGEST_NOTHING\b/.test(digest), false);
    assert.equal(/Nothing needs your attention/.test(digest), false);
    // The model decides the words, and says the sentence only where nothing says
    // otherwise.
    assert.match(
      model,
      /export const DIGEST_NOTHING = "Nothing needs your attention\.";/,
    );
    assert.match(
      model,
      /if \(fine && caveats\.length === 0\) \{\s*return DIGEST_NOTHING;\s*\}/,
    );
    // Second review, item 2(b): calm only where every attribute asked for is one
    // accepting marks as evidenced, the accept note's own rule.
    // Changed 14 November 2026 (docs/evidence-assurance.md, section 10.13, review fix 3).
    // Old: `calm: attention.length > 0 ? "" : calmOf(check, quiet, asked, acceptNote),`.
    // New: the same, calmOf also told whether a finding still waits on the person, so
    // that the tickmarks' calm line is never said while one does.
    assert.match(
      model,
      /calm:\s*attention\.length > 0\s*\?\s*""\s*:\s*calmOf\(\s*check,\s*quiet,\s*asked,\s*acceptNote,/,
    );
    has(
      model,
      'const fine = (review === null || review.state === "SUFFICIENT") && asked.length > 0 && asked.every((row) => row.line.evidenced);',
    );
  });
  it("leads with what is left after the person's work, large; then the counts; then the check's own outcome, quietly", () => {
    // Changed 14 November 2026 (docs/evidence-assurance.md, section 10.14, A; the product
    // owner: "I have added a tickmark on the evidence here but says still can't be
    // concluded?"). Old: the heading was the review's own outcome with its mark ("Unable
    // to conclude yet"), the sentence under it, and a check without a review had the
    // sentence alone as its heading. New: the heading is the model's status line (what
    // a person's work settled and what is left, or "Nothing waits on you."), the
    // sentence under it for every check, and the check's outcome kept, in its own words
    // with its mark, on a quiet line: "The check proposed: ...", with "Proposed for your
    // review". What it protects is kept: the outcome is the review's own words, never
    // reworded, and always said to be a proposal.
    inOrder(summary, [
      "{digest.status}",
      "{digest.verdict}",
      "{CHECK_PROPOSED}",
      "{digest.outcome.label}",
      "{DIGEST_PROPOSED}",
      "{upgrade}",
    ]);
    assert.match(
      summary,
      /<h5 className="cdg-outcome" tabIndex=\{-1\}>\s*\{digest\.status\}\s*<\/h5>\s*<p className="cdg-sentence">\{digest\.verdict\}<\/p>/,
    );
    assert.match(
      summary,
      /\{digest\.outcome !== null \? \(\s*<span className="cdg-check-said">\s*\{CHECK_PROPOSED\}\{" "\}\s*<span className=\{`cdg-state is-\$\{digest\.outcome\.tone\}`\}>\s*<span className="cdg-dot" aria-hidden="true" \/>\s*\{digest\.outcome\.label\}/,
    );
    assert.equal(count(summary, /digest\.verdict/g), 1);
    assert.equal(count(summary, /digest\.status/g), 1);
    assert.match(model, /export const CHECK_PROPOSED = "The check proposed:";/);
    assert.match(rule(css, ".cdg-outcome"), /font-size: var\(--fs-lg\);/);
    // Quiet, and in tokens only.
    assert.match(
      rule(css, ".cdg-proposed-line"),
      /color: var\(--text-tertiary\);/,
    );
  });

  it("shows the result only for a finished check, and leaves every other standing its one line", () => {
    assert.match(
      check,
      /const digest = checkDigest\(\s*check,\s*findings \?\? \[\],\s*files,\s*extras,\s*acceptNote,?\s*\);/,
    );
    assert.equal(count(list, /checkDigest\(/g), 1);
    inOrder(check, [
      'if (check.standing === "CHECKING") {',
      'if (check.standing !== "REVIEWED" || digest === null) {',
      '<div className="de-check is-reviewed">',
    ]);
    // Queued, held, failed, out of date, not checked: the line, its one action, and the
    // files left out, as before.
    const other = check.slice(
      check.indexOf('if (check.standing !== "REVIEWED" || digest === null) {'),
      check.indexOf("const upgrade ="),
    );
    assert.match(other, /<span>\{check\.line\}<\/span>/);
    assert.match(other, /\{action !== null\s*\? actButton\(/);
    assert.match(other, /\{leftOut\}/);
    assert.match(check, /const leftOut = fileLines\(check\.leftOut\);/);
    assert.equal(count(list, /<CheckDigestView\b/g), 1);
    assert.match(
      model,
      /if \(check\.standing !== "REVIEWED"\) \{\s*return null;\s*\}/,
    );
    // The row arranges itself as the first screen under the same condition, and under
    // no other.
    assert.match(
      row,
      /const reviewed =\s*assured !== null &&\s*row\.reading === 0 &&\s*assured\.check\.standing === "REVIEWED";/,
    );
  });

  it("renders nothing of the request, the attributes it addresses or its files until asked", () => {
    // The open row of a finished check: a proposed change, the files once asked for,
    // the check, a person's note, and what opens on the person's own choice.
    assert.ok(reviewedBody.length > 200 && otherBody.length > 200);
    inOrder(reviewedBody, [
      "{change}",
      'className="de-files-panel"',
      "{check}",
      "{decided}",
      "{forms}",
    ]);
    for (const absent of [
      "{request}",
      "<dt>",
      "tc-rules",
      "de-accept",
      "{traceView}",
      "{agentSaid}",
      "{passedOver}",
      "{policyCheck}",
    ]) {
      assert.equal(reviewedBody.includes(absent), false, absent);
    }
    // The files: closed until "7 files" is pressed, then today's list in place.
    // Superseded after the independent review (item 2 of the fixes). Old: the files
    // were closed until asked for, always (`useState(false)`). New: they are closed
    // until asked for unless a file has something to settle or could not be read; then
    // they are listed until the person closes them. The person's own choice stands.
    assert.match(
      row,
      /const \[filesOpen, setFilesOpen\] = useState<boolean \| null>\(null\);/,
    );
    // Second review, item 3: and while a form is open in the list, whatever else.
    has(
      row,
      "const filesShown = fileForm !== null || (filesOpen ?? (flagged.length > 0 || unread.length > 0 || beingRead.length > 0));",
    );
    assert.match(
      reviewedBody,
      /hidden=\{!filesShown && item\.files\.length > 0\}\s*>\s*\{filesShown \|\| item\.files\.length === 0 \? fileList : null\}/,
    );
    assert.equal(count(reviewedBody, /fileList/g), 1);
    // The header's chips are the closed row's: open, the verdict says it once.
    assert.match(
      row,
      /\{!open && assured !== null && assured\.states\.length > 0 \? \(\s*<span className="de-states" id=/,
    );
  });

  it("keeps every other row as it was: the request, its files, the check and Accept, in that order", () => {
    inOrder(otherBody, [
      "{change}",
      '<dl className="tc-rules">',
      "{request}",
      "<dt>Evidence</dt>",
      "{fileList}",
      "{check}",
      "{traceView}",
      "{agentSaid}",
      "{passedOver}",
      "{decided}",
      "{policyCheck}",
      "{forms}",
      '<div className="de-accept">',
    ]);
    // Its head is the one button it always was.
    assert.match(
      row,
      /<button\s+type="button"\s+className="tar-head dq-head de-head"\s+aria-expanded=\{open\}\s+aria-controls=\{bodyId\}\s+onClick=\{onToggle\}/,
    );
  });

  it("opens the files from the row's own line, as today's list with each file's menu", () => {
    assert.match(
      row,
      /<button\s+type="button"\s+className="de-link de-files-toggle"\s+aria-expanded=\{filesShown\}\s+aria-controls=\{filesId\}\s+onClick=\{\(\) => setFilesOpen\(!filesShown\)\}\s*>\s*\{filesWord\}/,
    );
    assert.match(row, /const filesId = `\$\{id\}-files`;/);
    assert.match(reviewedBody, /id=\{filesId\}/);
    // The count is the row's own words, found in its line and not written again.
    assert.match(
      row,
      /const filesWord = `\$\{item\.files\.length\} file\$\{item\.files\.length === 1 \? "" : "s"\}`;/,
    );
    assert.match(row, /row\.sub\.indexOf\(` · \$\{filesWord\}`\)/);
    // The list is the one every row has: preview, annotations, the file's own actions,
    // unlink, each behind the file's menu.
    const files = row.slice(
      row.indexOf("const fileList = ("),
      row.indexOf("const preview = ("),
    );
    for (const kept of [
      '<ul className="de-files">',
      'label: "Annotations"',
      "...(line?.actions ?? [])",
      'label: "Unlink from this request"',
      "<RowMenu label={file.name} items={fileMenu} />",
      // Changed 14 November 2026 (section 5b). Old: the file's name opened the reviewer
      // ('mode: "review"'). New: it opens the one viewer, by the row's own openFile.
      "onClick={() => openFile(file.fileId)}",
      "{line?.form ?? null}",
      "{fileDone}",
    ]) {
      assert.ok(files.includes(kept), kept);
    }
    assert.equal(count(row, /<ul className="de-files">/g), 1);
    // A file's own form is in that list: asking for it opens the list.
    assert.match(
      row,
      /setFileForm\(\{ fileId: act\.fileId, form: "replace" \}\);\s*setFileDone\(null\);[\s\S]{0,80}setFilesOpen\(true\);/,
    );
    // Upload and the row's menu stay in the head.
    inOrder(row.slice(row.indexOf("const content = (")), [
      'className="tar-head dq-head de-head de-head-split"',
      'className="btn btn-secondary btn-sm de-upload"',
      "<RowMenu label={row.title} items={menuFor()} />",
      "{open && reviewed ? (",
    ]);
  });

  it("opens All details in place to the request, the attributes it addresses, and the check's details", () => {
    // The request's wording, the attributes in full, and its format and period: the
    // rows every other row shows, handed in whole.
    const request = row.slice(
      row.indexOf("const request = ("),
      row.indexOf("const fileList = ("),
    );
    inOrder(request, [
      "<dt>Request</dt>",
      "What it must show",
      "<dt>Addresses</dt>",
      '<ul className="dq-addressed">',
      "<dt>Format · period</dt>",
    ]);
    assert.match(
      row,
      /about=\{\s*reviewed \? \(\s*<div className="tc is-flat">\s*<dl className="tc-rules">\{request\}<\/dl>\s*<\/div>\s*\) : null\s*\}/,
    );
    // The sample trace is here unless it waits on the person or has been put in view
    // under the list (then it is drawn there, once).
    has(
      row,
      "{traceShown || tracePending ? null : traceView} {agentSaid} {passedOver} {policyCheck}",
    );
    // Then the check's details, as the first build's Details held them.
    const details = check.slice(
      check.indexOf("const details = ("),
      check.indexOf('<div className="de-check is-reviewed">'),
    );
    inOrder(details, [
      "{about}",
      "<CheckReview review={check.review} onOpen={onOpen} />",
      "Not asked for by this request",
      "{fileLines(check.leftOut, false)}",
      "{fileLines(check.confirm, false)}",
      "{check.line}",
      "{check.readInPart}",
      "{more}",
    ]);
    const review = component(list, "CheckReview");
    for (const held of [
      "{review.explanation}",
      'review.completeness.reasons.join(" ")',
      "review.groups.map(",
      "{CONSIDERATIONS_TITLE}",
      "review.concerns.map(",
      "{FILES_TITLE}",
      "{review.contextThin}",
      "{RESOLVED_TITLE}",
    ]) {
      assert.ok(review.includes(held), held);
    }
    // The explanation and the completeness reasons are read as soon as "All details" is
    // open: no fold of the review is over them (restored after the independent review,
    // item 11 of the fixes; committed, they were read first, with no step at all).
    const lead = review.slice(
      review.indexOf('<div className="de-review-lead">'),
      review.indexOf("<details"),
    );
    assert.ok(lead.length > 200);
    has(lead, '<p className="de-review-why">{review.explanation}</p>');
    has(lead, '{review.completeness.reasons.join(" ")}');
    // A note on a file's type, or a file left out, is said there in full whether or
    // not it has an action: the list is not narrowed to either kind.
    assert.equal(/check\.(confirm|leftOut)\.filter/.test(check), false);
    has(
      check,
      'const fileLines = (items: RequestCheck["leftOut"], acts = true) => items.length === 0 ? null : (',
    );
    // In place, closed to start, and once opened it stays in the page (what was opened
    // inside it stays open).
    assert.match(
      view,
      /const \[detailsOpen, setDetailsOpen\] = useState\(false\);/,
    );
    assert.match(
      summary,
      /<div id=\{`\$\{id\}-details`\} className="cdg-details" hidden=\{!detailsOpen\}>\s*\{detailsSeen \? \(\s*<>\s*\{details\}/,
    );
    // The follow-ups the check did not list are said there whenever there are any, and
    // a request whose item opens no attribute is there in full.
    assert.match(
      summary,
      /\{digest\.asksMore !== "" \? \(\s*<p className="cdg-quiet-note">\{digest\.asksMore\}<\/p>\s*\) : null\}/,
    );
    has(summary, "<AskBox asks={loose} digest={digest} ticks={ticks} full />");
    assert.match(
      view,
      /item\.kind === "GENERAL" && item\.control\.type === "ASK"\s*\? item\.control\.askKeys\s*: \[\],/,
    );
  });
});

describe("audit integrity of the first screen", () => {
  it("says the result is proposed on every finished check, whatever else it holds", () => {
    // Not under a condition. Changed 14 November 2026 (section 10.14, A). Old: the span
    // followed the heading (the outcome) directly. New: it closes the quiet line that
    // keeps the check's outcome, outside any condition, so every finished check still
    // says its result is proposed.
    assert.match(
      summary,
      /\) : null\}\s*<span className="cdg-proposed">\s*<UiIcon name="sparkles" size=\{12\} \/>\s*\{DIGEST_PROPOSED\}\s*<\/span>\s*<\/p>/,
    );
    assert.equal(count(digest, /\{DIGEST_PROPOSED\}/g), 1);
    // The outcome is the review's own words, and nothing on the screen words it again.
    assert.equal(
      /\b(approved|concluded|passed the check|effective)\b/i.test(view),
      false,
    );
    assert.match(
      model,
      /outcome:\s*review === null\s*\? null\s*: \{ label: review\.label, icon: review\.icon, tone: review\.tone \},/,
    );
  });

  it("draws every caveat from the model's quiet line, in full: never clipped, never dropped", () => {
    assert.match(summary, /\{digest\.quiet\.map\(\(item\) => \{/);
    assert.equal(count(digest, /digest\.quiet\b/g), 2);
    assert.equal(/digest\.quiet\.(filter|slice|find)\b/.test(digest), false);
    assert.match(
      summary,
      /<span className="cdg-caveat">\s*<UiIcon name=\{item\.icon\} size=\{13\} \/>\s*\{item\.text\}\s*<\/span>/,
    );
    // Its words wrap; nothing about the line or the caveat cuts them.
    for (const selector of [
      ".cdg-quiet",
      ".cdg .cdg-quiet-items",
      ".cdg-quiet-items > li",
      ".cdg-caveat",
    ]) {
      assert.equal(
        /overflow: hidden|text-overflow|white-space: nowrap|line-clamp|max-height/.test(
          rule(css, selector),
        ),
        false,
        selector,
      );
    }
    assert.match(rule(css, ".cdg .cdg-quiet-items"), /flex-wrap: wrap;/);
    assert.match(rule(css, ".cdg-caveat"), /overflow-wrap: anywhere;/);
    // The model puts every caveat of either engine there.
    for (const said of [
      'said("CAVEAT:COMPLETENESS", caveat.label)',
      'said("CAVEAT:READ_IN_PART", QUIET_READ_IN_PART)',
      'said("CAVEAT:LEFT_OUT", filesLeftOut(leftOut))',
      // A note on a file's type with no action (second review, item 2c).
      'said("CAVEAT:TYPE", typesUnconfirmed(typed))',
      // And the row's own (a file that could not be read, a trace), unless the check
      // already names the same file.
      'extra.caveat && extraWords(extra) !== "" && !(extra.fileId !== undefined && named.has(extra.fileId)),',
    ]) {
      has(model, said);
    }
  });

  it("colours a quiet item by the model's own tone: only what it tones as shown is green", () => {
    assert.match(
      summary,
      /<li key=\{item\.key\} className=\{`is-\$\{item\.tone\}`\}>/,
    );
    // An attribute with no item opens from the quiet line whatever its state (kind
    // SHOWN or OTHER_STATE): the button is drawn for every item that names one.
    // Changed 14 November 2026 (section 10.14). Old: `{key !== null ? ( <button ...`
    // first. New: a file whose reliability a person decided opens its decision first
    // (`{fileId !== undefined ? ( <button ...`), then `) : key !== null ? (` as before;
    // its words are the model's too, so `{item.text}` is drawn three times, not two.
    has(
      summary,
      `) : key !== null ? ( <button type="button" className="cdg-link cdg-quiet-open" data-cdg-open={key} onClick={() => show(key)} > <UiIcon name={item.icon} size={13} /> {item.text} </button>`,
    );
    has(
      summary,
      `{fileId !== undefined ? ( // A file whose reliability a person decided: its decision, in // place, with its own Close. <button type="button" className="cdg-link cdg-quiet-open" data-cdg-reliability={fileId} onClick={(event) => openReliability(fileId, event.currentTarget, false) } > <UiIcon name={item.icon} size={13} /> {item.text} </button>`,
    );
    assert.equal(/item\.kind === "(SHOWN|OTHER_STATE)"/.test(summary), false);
    // Its words are the model's, unchanged ("D shown (not asked for)", "A supported").
    assert.equal(count(summary, /\{item\.text\}/g), 3);
    assert.match(
      css,
      /\nbutton\.cdg-quiet-open,\nbutton\.cdg-quiet-open:hover:not\(:disabled\) \{\s*color: var\(--text-secondary\);/,
    );
    for (const tone of ["success", "warning", "danger"]) {
      assert.match(
        css,
        new RegExp(
          `\\.cdg-quiet-items > \\.is-${tone} button\\.cdg-quiet-open,[^{]*\\{\\s*color: var\\(--${tone}\\);`,
        ),
        tone,
      );
    }
    // Neutral has no colour of its own: support the check does not say how is not green.
    assert.equal(/\.is-neutral button\.cdg-quiet-open/.test(css), false);
    // Second review, item 2(b): shown is what accepting marks as evidenced (or a
    // document shows), never support that is not whole.
    has(
      model,
      'const shown = row.line.state === "SUPPORTED" && (row.line.evidenced || row.line.shows === "DESIGN");',
    );
  });
  it("lists every item the model gives, each in its words: a bold line, its state and a quiet line, a flag, one control", () => {
    assert.match(summary, /\{digest\.attention\.map\(\(item\) => \(\s*<Item/);
    assert.equal(/digest\.attention\.(filter|slice)\b/.test(digest), false);
    assert.match(
      item,
      /<strong className="cdg-item-title" title=\{item\.headline\}>\s*\{item\.headline\}\s*<\/strong>/,
    );
    // What the bold line leaves out is counted beside it, never cut off with the text:
    // more of the same after "Missing: ...", and after a sentence of its own (a judgment,
    // an exception, a failed comparison) what is missing besides.
    has(
      item,
      '<span className="cdg-item-more"> {`+@{item.more} @{item.headline.startsWith(`@{MISSING}:`) ? "more" : "missing"}`} </span>',
    );
    assert.match(rule(css, ".cdg-item-more,\n.cdg-item-flag"), /flex: none;/);
    // The attribute's own state leads the quiet line, in the model's words with a mark:
    // an item never reads as only a gap where the check found an issue or left a
    // judgment.
    has(
      item,
      '{item.status !== null ? ( <span className={`cdg-state cdg-item-status is-@{item.status.tone}`}> <span className="cdg-dot" aria-hidden="true" /> {item.status.label} </span> ) : null} <span className="cdg-item-context" title={item.context}>',
    );
    assert.match(rule(css, ".cdg-item-status"), /flex: none;/);
    assert.match(
      item,
      /<span className="cdg-item-context" title=\{item\.context\}>\s*\{item\.context\}\s*<\/span>/,
    );
    assert.match(
      item,
      /\{item\.flag !== "" \? \(\s*<span className="cdg-item-flag">\{item\.flag\}<\/span>/,
    );
    // An item on an attribute the request does not ask for says so: the verdict's
    // "N of M" does not count it.
    assert.match(
      item,
      /digest\.attributes\.some\(\(row\) => row\.key === key && !row\.line\.expected\);/,
    );
    assert.match(
      item,
      /\{unasked \? \(\s*<span className="cdg-item-flag">\{DIGEST_NOT_ASKED\}<\/span>/,
    );
    // One control, by the model's own kind: a tick, a button that opens, the check's
    // own action, a button that puts something of the row's in view, or none.
    assert.equal(
      count(item, /control\.type === "ASK" && ticks\.ticked !== null/g),
      1,
    );
    assert.equal(count(item, /control\.type === "OPEN" && key !== null/g), 1);
    assert.match(
      item,
      /\{control\.type === "ACT" \? act\(control\.action\) : null\}/,
    );
    has(
      item,
      '{control.type === "VIEW" ? ( <button type="button" className="btn btn-secondary btn-sm" data-cdg-view={item.key} onClick={() => onView(item.key)} > {control.label}',
    );
    // Changed 14 November 2026 (section 10.14). Old: two controls drew the model's label
    // (OPEN and VIEW). New: also RELIABILITY, a file's "Decide", drawn only where the row
    // offers a decision (onReliability), with what it decides for a screen reader.
    has(
      item,
      '{control.type === "RELIABILITY" && onReliability !== null ? ( <button type="button" className="btn btn-secondary btn-sm" data-cdg-reliability={control.fileId} onClick={(event) => onReliability(control.fileId, event.currentTarget) } > {control.label}',
    );
    assert.equal(count(item, /\{control\.label\}/g), 3);
    assert.match(item, /\{ASK_OWNER\}/);
  });

  it("puts on the first screen what of the row itself waits on the person: the sample to confirm, and what a file hides", () => {
    // Added after the independent review (items 1 and 2 of the fixes): before, a sample
    // the trace proposed and a file's "Application not set" were behind "All details"
    // and "N files", so the first screen could read as settled while they waited.
    has(
      row,
      'const tracePending = traced && !traceFailed && trace !== null && (trace.status === "PROPOSED" || trace.status === "CHOOSE");',
    );
    has(row, "const extras: DigestExtra[] = !reviewed ? [] : [");
    // The sample: an item whose button reveals the trace's own card under the list.
    has(row, "key: EXTRA_TRACE,");
    has(row, "label: TRACE_WORDS.view, caveat: false,");
    has(
      list,
      'PROPOSED: "Confirm the sample the agent proposed.", CHOOSE: "Pick the sample this request walks through.", view: "Review the sample",',
    );
    has(
      row,
      'under={ reviewed && traceShown && traced ? ( <div className="de-under" tabIndex={-1}> {traceView} </div> ) : null }',
    );
    // The card is the row's own, drawn once: under the list, or in All details.
    assert.equal(count(row, /<SampleTrace\b/g), 1);
    assert.equal(count(row, /\{traceView\}/g), 2);
    has(row, "{traceShown || tracePending ? null : traceView}");
    // A file with something to settle: an item whose button opens the files on it.
    // Second review, item 3: from the fact itself (fileLine's own rule), not the drawn
    // flag, which is gone while its form is open.
    has(
      row,
      "const flagged = item.files.filter( (file) => canAct && files.find((each) => each.id === file.fileId)?.applicationUnknown === true && applications.length > 1, );",
    );
    // Item 4: the row's own file items have their own prefix, and name their file.
    has(list, 'const EXTRA_FILE = "ROW_FILE:";');
    // A file the check left out is not counted again as unread.
    has(
      row,
      'const unread = item.files.filter( (file) => file.readStatus === "FAILED" && !leftOutIds.has(file.fileId), );',
    );
    // Item 2a: a trace that asks nothing still says what must not be lost.
    has(row, 'key: "TRACE:FAILED", mark: "", headline: TRACE_WORDS.failed,');
    has(
      row,
      ': traced && trace !== null && trace.status === "CONFIRMED" ? tracePoints(trace) : []),',
    );
    has(
      row,
      "...flagged.map((file) => ({ key: `@{EXTRA_FILE}@{file.fileId}`, mark: fileRef(rowFiles, file.fileId), headline: FILE_WORDS.application, context: FILE_WORDS.applicationOf(file.name), label: FILE_WORDS.view, caveat: false, fileId: file.fileId, })),",
    );
    // What is only to be known of a file is a caveat on the quiet line.
    has(
      row,
      'const unread = item.files.filter( (file) => file.readStatus === "FAILED" && !leftOutIds.has(file.fileId), );',
    );
    has(
      row,
      'key: "FILES:UNREAD", mark: "", headline: FILE_WORDS.unread(unread.length),',
    );
    // The row's caveats: a file that could not be read, one still being read, a trace
    // that failed to load (second review, item 2a).
    assert.equal(count(row, /caveat: true,/g), 3);
    has(list, "function tracePoints(trace: Trace): DigestExtra[] {");
    // The model places them; the row hands them over and answers the buttons.
    has(check, "checkDigest(check, findings ?? [], files, extras, acceptNote)");
    has(row, "extras={extras} onView={viewExtra}");
    has(
      row,
      "if (key === EXTRA_TRACE) { setTraceShown(true); } else if (fileAt >= 0) { setFilesOpen(true); } else { return; }",
    );
    // The focus goes to what was put in view: the card, or the file's own flag.
    has(
      row,
      'key === EXTRA_TRACE ? root?.querySelector<HTMLElement>(".de-under") : (file?.querySelector<HTMLElement>(".ep-file-flag") ?? file?.querySelector<HTMLElement>(".ep-file-open"));',
    );
    has(row, "target?.focus();");
    // It only shows: no write of its own.
    const viewer = row.slice(
      row.indexOf("const viewExtra = (key: string) => {"),
      row.indexOf("const traceView = ("),
    );
    assert.ok(viewer.length > 200);
    assert.equal(/action\.run|fetch\(|intent:/.test(viewer), false);
    // In the digest, the revealed card sits directly under the list.
    inOrder(summary, ["<Item", "{under}", 'className="cdg-quiet"']);
  });
  it("never draws an issue or a judgment as shown, nor a finding against as merely missing", () => {
    assert.match(attribute, /<State pill=\{row\.status\} \/>/);
    const state = component(digest, "State");
    assert.match(
      state,
      /<span className=\{`cdg-state is-\$\{pill\.tone\}`\}>\s*<span className="cdg-dot" aria-hidden="true" \/>\s*\{pill\.label\}/,
    );
    // A row is "shown" only for an element the model tones as a success.
    has(
      table,
      'const shown = elements("SHOWN", (element) => element.tone === "success");',
    );
    // Superseded after the independent review (item 4 of the fixes). Old: an element
    // the check found against, naming nothing absent, was a row under the model's word
    // for what is absent. New: it is a row in the element's own result words ("Not
    // met", "Not shown"); that word labels only what the model lists as absent.
    has(
      table,
      '...elements( "AGAINST", (element) => element.deviation || (element.tone === "danger" && element.absent.length === 0), ),',
    );
    has(
      table,
      "line.elements.filter(only).map((element) => ({ key: `@{kind}:@{element.key}`, kind, label: element.result, text: element.text, lacks: [], passages: element.passages, }));",
    );
    has(
      table,
      '...absentOf(line) .filter((gap) => !told.has(lackKey(gap))) .map((gap) => ({ key: `MISSING:@{gap}`, kind: "MISSING" as const, label: MISSING, text: gap, lacks: [], passages: [], })),',
    );
    assert.equal(count(table, /label: MISSING,/g), 1);
    // Without elements, only a supported attribute has a Shown row.
    assert.match(
      table,
      /shown\.length === 0 &&\s*line\.elements\.length === 0 &&\s*line\.state === "SUPPORTED" &&/,
    );
    assert.equal(count(table, /label: STATUS_SHOWN,/g), 1);
    // The table draws each row once, by its own label; a row is green only as SHOWN.
    assert.equal(count(attribute, /table\.map\(\(each\) => \{/g), 1);
    has(
      attribute,
      "<span className={`cdg-row-key is-@{ROW_TONE[each.kind]}`}>",
    );
    has(
      digest,
      'const ROW_TONE = { SHOWN: "success", PART: "warning", AGAINST: "danger", MISSING: "danger", } as const;',
    );
    assert.match(attribute, /\{each\.label\}/);
    assert.equal(
      /item\.absent|element\.absent\.map\(\(gap|line\.absent\b/.test(attribute),
      false,
    );
    // A comparison is its sentence with whether it passed in words, as the model has
    // them; the view picks none to show or hide.
    assert.match(attribute, /\{line\.checks\.map\(\(item\) => \(/);
    assert.match(attribute, /\{item\.result\}/);
    assert.match(attribute, /<span>\{item\.sentence\}<\/span>/);
  });

  it("gives an element shown in part its own row, with what of it is missing under it, once", () => {
    // Added 14 November 2026 (item 13), from the product owner's real check: an
    // attribute whose elements were each half shown listed only what was missing, and
    // hid what was shown. An element whose result is the check's "Shown in part" is a
    // row in those words, with its sentence, the passage and "View".
    has(digest, 'const HALF_SHOWN = elementWords("PARTLY_MET");');
    has(
      table,
      '.filter((element) => element.result === HALF_SHOWN) .map( (element): TableRow => ({ key: `PART:@{element.key}`, kind: "PART", label: element.result, text: element.text,',
    );
    // What it lacks is under it, each thing once across the rows, and is not a row of
    // its own after that: only what belongs to no row is.
    has(
      table,
      'lacks: element.absent.map(flat).filter((gap) => { const key = lackKey(gap); if (key === "" || told.has(key)) { return false; } told.add(key); return true; }),',
    );
    has(table, ".filter((gap) => !told.has(lackKey(gap)))");
    has(
      attribute,
      '{each.lacks.map((gap) => ( // What of this element is missing: under it, and nowhere else. <p key={gap} className="cdg-row-lack"> <span className="cdg-row-key is-danger"> <UiIcon name="x" size={12} /> {MISSING} </span> {gap} </p> ))}',
    );
    // It rests on the evidence like a shown row: it quotes, names and opens its own
    // element's first passage (second review, item 1).
    has(table, "passages: element.passages, }), );");
    // Its mark and colour are the warning's, never the success's.
    has(digest, 'PART: "warning",');
    assert.match(
      rule(css, ".cdg-row-key.is-warning"),
      /color: var\(--warning\);/,
    );
    // What an attribute shown in part leaves to the other requests is said under the
    // table, not behind "More about this attribute"; an element that is a row is not
    // said again there.
    has(
      attribute,
      'const halves = new Set( table.filter((each) => each.kind === "PART").map((each) => each.text), ); const left = (line.inPart?.leaves ?? []).filter((text) => !halves.has(text));',
    );
    inOrder(attribute, [
      '<ul className="cdg-rows">',
      "{DIGEST_LEFT}",
      "{left.map((each) => (",
      "{DIGEST_MORE}",
    ]);
    assert.ok(
      digest.includes('export const DIGEST_LEFT = "Left to other requests";'),
    );
    // Behind "More": the elements this request shows, in full; what it leaves is not
    // listed a second time.
    has(
      attribute,
      "const listed = line.elements.filter((item) => !leaves.has(item.text));",
    );
    has(attribute, "{listed.map(element)}");
  });
  it("keeps the counts equal to what they count", () => {
    // "Ask owner for N items": N is the ticked requests, and what does not fit the
    // follow-up form is said beside it.
    assert.match(
      view,
      /const text = askText\(digest, ticked\);\s*const wanted = askLines\(digest, ticked\)\.length;/,
    );
    assert.match(view, /\{digestAskFor\(wanted\)\}/);
    assert.match(
      digest,
      /export const digestAskFor = \(count: number\) =>\s*`Ask owner for \$\{count\} item\$\{count === 1 \? "" : "s"\}`;/,
    );
    assert.match(
      view,
      /const fits = text === "" \? 0 : text\.split\("\\n"\)\.length;/,
    );
    assert.match(
      view,
      /asking !== null && fits < wanted \? `\$\{digestFits\(fits, wanted\)\}\.` : ""/,
    );
    assert.match(
      digest,
      /export const digestFits = \(fits: number, ticked: number\) =>\s*`\$\{fits\} of \$\{ticked\} fit in one follow-up`;/,
    );
    // Follow-ups the check did not list are said beside the action too.
    assert.match(view, /asking !== null \? digest\.asksMore : "",/);
    // The place is the attribute's place among the model's steps.
    assert.match(one, /\{digestPlace\(at \+ 1, digest\.steps\.length\)\}/);
    assert.match(
      view,
      /const at = current === null \? -1 : digest\.steps\.indexOf\(current\);/,
    );
  });

  it("shows a finding once, through the existing component, with its existing decisions", () => {
    assert.equal(count(list, /<FindingRecords\b/g), 1);
    assert.match(
      check,
      /<FindingRecords\s+findings=\{\[finding\]\}\s+canAct=\{canAct\}\s+action=\{findingsAction\}[\s\S]{0,160}compact\s*\/>/,
    );
    assert.equal(count(attribute, /\{finding\(line\)\}/g), 1);
    assert.equal(count(digest, /finding\(/g), 1);
    // The digest names no decision of its own.
    assert.equal(
      /decisionsFor|DECISION_LABELS|useFindingsAction|FindingRecords/.test(
        digest,
      ),
      false,
    );
    // The compact finding draws the same decisions from the same place, once, and
    // sends them the one way.
    assert.equal(count(findings, /\{decisions\.map\(\(decision\) => \(/g), 1);
    assert.equal(count(findings, /intent: "decide"/g), 1);
    assert.equal(count(findings, /fetch\(/g), 1);
    assert.equal(count(findings, /<FindingDetail\b/g), 2);
    const detail = component(findings, "FindingDetail");
    assert.match(
      detail,
      /if \(brief !== null\) \{[\s\S]*?\{acts\}\s*<div id=\{brief\.id\} className="ei-brief-body" hidden=\{!brief\.open\}>/,
    );
    // Its body and history are behind "Details": the title, the status in words and
    // the decisions are what is seen.
    const compact = component(findings, "FindingRecords");
    assert.match(compact, /FINDING_STATUS_LABELS\[finding\.status\]/);
    assert.match(
      compact,
      /aria-expanded=\{isOpen\}\s+aria-controls=\{moreId\}/,
    );
    assert.match(detail, /\{brief\.open \? \(\s*<>\s*\{said\}\s*\{past\}/);
    // The question the finding proposes, and what would settle it, stay in view over
    // the decisions: Accept approves that question. Restored after the independent
    // review (item 7 of the fixes): the first build put them behind "Details" with the
    // observation. Only the observation, the source, the quote and the history are
    // behind it.
    has(
      detail,
      '<div className="ei-finding-more is-brief"> {/* Always in view, over the decisions: Accept approves this question. */} {asked} {acts} <div id={brief.id} className="ei-brief-body" hidden={!brief.open}>',
    );
    has(
      detail,
      'const asked = finding.question !== "" && deciding !== "EDIT" ? ( <p className="ei-finding-question"> <strong>Proposed question:</strong> {finding.question} {finding.expected !== "" ? ( <small>Would settle it: {finding.expected}</small> ) : null} </p> ) : null;',
    );
    // Drawn once in either mode: over the decisions when compact, with what the finding
    // says otherwise.
    assert.equal(count(detail, /\{asked\}/g), 1);
    has(
      detail,
      '<p className="ei-brief-said">{finding.observation}</p> ) : ( asked )}',
    );
    assert.equal(count(detail, /Proposed question:/g), 1);
    // In the compact finding the leading decision is outlined: the view it sits in has
    // its own one primary action.
    assert.match(
      detail,
      /const lead = brief !== null \? "btn btn-secondary btn-sm" : "btn btn-sm";/,
    );
  });
});

describe("what the result sends", () => {
  it("is nothing: no call, no form, no write in check-digest.tsx", () => {
    for (const forbidden of [
      /fetch\(/,
      /XMLHttpRequest|sendBeacon|WebSocket/,
      /method:/,
      /intent:/,
      /useRouter|router\./,
      /action\.run/,
      /<form\b/,
      /type="submit"/,
      /\/workspace\//,
      /localStorage|sessionStorage|document\.cookie/,
      /location\.(reload|href|assign)/,
    ]) {
      assert.equal(forbidden.test(digest), false, String(forbidden));
    }
    // It imports React, the two models, the tickmark's view and the icon, and nothing
    // that could send. Changed 14 November 2026 (docs/evidence-assurance.md, section
    // 10.13). Old: React, the two models and the icon. New: also ./attribute-tickmark,
    // the attribute view's tickmark, whose form sends through the row's own handlers
    // only: it too has no call, no route and no write of its own (checked below and in
    // attribute-tickmark-view.test.ts).
    // Changed 14 November 2026 (section 10.14). Old: these five. New: also
    // ./file-reliability, a file's reliability decision, whose form, like the tickmark's,
    // sends through the row's own handlers only, with no call, route or write of its own
    // (checked below and in file-reliability-view.test.ts).
    assert.deepEqual(
      [...digest.matchAll(/from "([^"]+)";/g)].map((match) => match[1]),
      [
        "react",
        "./attribute-tickmark",
        "./check-digest-model",
        "./evidence-assurance-model",
        "./file-reliability",
        "./ui-icon",
      ],
    );
    const reliability = read("apps/web/src/file-reliability.tsx");
    for (const forbidden of [
      /fetch\(/,
      /XMLHttpRequest|sendBeacon|WebSocket/,
      /method:/,
      /intent:/,
      /useRouter|router\./,
      /\/workspace\//,
      /localStorage|sessionStorage|document\.cookie/,
      /location\.(reload|href|assign)/,
    ]) {
      assert.equal(forbidden.test(reliability), false, String(forbidden));
    }
    const tickmark = read("apps/web/src/attribute-tickmark.tsx");
    for (const forbidden of [
      /fetch\(/,
      /XMLHttpRequest|sendBeacon|WebSocket/,
      /method:/,
      /intent:/,
      /useRouter|router\./,
      /action\.run/,
      /\/workspace\//,
      /localStorage|sessionStorage|document\.cookie/,
      /location\.(reload|href|assign)/,
    ]) {
      assert.equal(forbidden.test(tickmark), false, String(forbidden));
    }
  });

  it("reaches the follow-up form only by the row's existing ask", () => {
    // In the digest: one button, which hands over the model's text.
    assert.equal(count(digest, /\.onAsk\(/g), 1);
    assert.match(view, /const text = askText\(digest, ticked\);/);
    assert.match(view, /onClick=\{\(\) => asking\.onAsk\(text\)\}/);
    // In the list: that is the row's own `ask`, with the kind its menu's "Ask a
    // follow-up" uses, and nothing else.
    assert.match(row, /onAsk: askOwner,\s*unavailable: followUpOff,/);
    const owner = row.slice(
      row.indexOf("const askOwner = (text: string) => {"),
      row.indexOf("async function checkAgain() {"),
    );
    assert.ok(owner.length > 100);
    assert.equal(count(owner, /ask\(\{ kind: "FOLLOW_UP_REQUIRED" \}, /g), 2);
    assert.equal(/setAsking|setWords|action\.run|fetch\(/.test(owner), false);
    assert.match(
      row,
      /const followUp = \(\) =>\s*ask\(\s*\{ kind: "FOLLOW_UP_REQUIRED" \},/,
    );
    assert.match(row, /"follow-up": followUp,/);
    // One form, sent by the row's one submit: the digest added no other.
    assert.equal(count(list, /<AskForm\b/g), 1);
    assert.equal(count(list, /onSubmit=\{\(\) => void submitAsk\(\)\}/g), 1);
    assert.equal(count(list, /sufficiency: asking\.kind,/g), 1);
  });

  it("never silently replaces what is already typed in the form, and puts the focus in it", () => {
    const owner = row.slice(
      row.indexOf("const askOwner = (text: string) => {"),
      row.indexOf("async function checkAgain() {"),
    );
    // An empty or closed form starts with the ticked requests; one with words keeps
    // them, and takes the requests after a blank line where they are new and fit.
    assert.match(
      owner,
      /const typed = asking !== null \? words\.trim\(\) : "";\s*if \(asking === null \|\| typed === ""\) \{\s*ask\(\{ kind: "FOLLOW_UP_REQUIRED" \}, text\);\s*\} else if \(\s*asking\.kind === "FOLLOW_UP_REQUIRED" &&\s*!typed\.includes\(text\) &&\s*typed\.length \+ 2 \+ text\.length <= ASK_WORDS\.FOLLOW_UP_REQUIRED\.max\s*\) \{\s*ask\(\{ kind: "FOLLOW_UP_REQUIRED" \}, `\$\{typed\}\\n\\n\$\{text\}`\);\s*\}/,
    );
    assert.match(
      owner,
      /rowRef\.current\?\.querySelector<HTMLTextAreaElement>\("\.de-ask textarea"\);\s*field\?\.focus\(\);/,
    );
    // The form's limit is the model's: the text handed over stays within it.
    assert.match(model, /export const ASK_LIMIT = 1000;/);
    assert.match(list, /FOLLOW_UP_REQUIRED: \{[^}]*max: 1000,/);
  });

  it("turns the action off, with the reason, where nothing is ticked or the row cannot ask", () => {
    // Second review, item 7: the lock's reason is the upload's only where an upload is
    // the cause; during any other write, "Saving. One moment."
    assert.match(
      row,
      /const followUpOff = locked\s*\? lockedWhy\s*: \(menuEntries\.find\(\(each\) => each\.key === "follow-up"\)\?\.unavailable \?\?\s*null\);/,
    );
    has(list, 'const SAVING = "Saving. One moment.";');
    has(list, "const lockedWhy = settling === plan ? LOCKED : SAVING;");
    assert.equal(/locked\s*\?\s*LOCKED\b/.test(list), false);
    // The menu is built from the same entries: one reason, said in both places.
    assert.equal(count(list, /rowMenu\(row, \{/g), 1);
    assert.match(
      view,
      /const askOff =\s*asking === null\s*\? null\s*: wanted === 0\s*\? DIGEST_NONE_TICKED\s*: asking\.unavailable \|\| null;/,
    );
    // Each sentence beside the actions is said once, and each button is described by
    // its own (second review, item 7: the upload's sentence was said twice, and
    // described Accept twice).
    has(
      view,
      'const hints = [...askSays, acceptSays].filter( (part, at, all) => part !== "" && all.indexOf(part) === at, );',
    );
    has(summary, "disabled={askOff !== null} aria-describedby={askDescribed}");
    has(
      view,
      'const askDescribed = askSays.map(hintId).join(" ") || undefined;',
    );
    has(
      summary,
      '<span className="cdg-foot-hint"> {hints.map((part, at) => ( <span key={part} id={hintId(part)}>',
    );
    // Where the check recommends nothing, there is nothing to ask for here.
    assert.match(
      view,
      /const asking = ask !== null && digest\.askTotal > 0 \? ask : null;/,
    );
  });

  it("accepts through the row's existing Accept: the same handler, one click, primary", () => {
    has(
      summary,
      '<button type="button" className="btn" disabled={accept.off !== null} aria-describedby={ acceptSays !== "" ? `@{id}-accepting @{hintId(acceptSays)}` : `@{id}-accepting` } onClick={accept.onAccept} > {accept.busy ? "Accepting…" : DIGEST_ACCEPT} </button>',
    );
    // Superseded after the independent review (item 6 of the fixes). Old: `busy` was
    // `action.busy === judge-<id>`, which is also the key a follow-up, an insufficient
    // and a reopen are recorded under, so Accept read "Accepting…" while one of those
    // was being saved. New: only the accept itself (no form of the row is open).
    has(
      row,
      "accept={ canAct && row.canAccept ? { onAccept: () => void accept(), // Only the accept itself: a follow-up, an insufficient or a reopen // being recorded runs under the same key, with its form open. busy: asking === null && action.busy === `judge-@{item.id}`, off: locked ? lockedWhy : asking !== null ? ASKING_FIRST : null, } : null }",
    );
    assert.equal(count(list, /async function accept\(\)/g), 1);
    assert.equal(count(list, /sufficiency: "ACCEPTED"/g), 1);
    // It says "Evidence accepted." only once the server has confirmed.
    assert.match(
      list,
      /async function accept\(\) \{\s*const ok = await action\.run\([\s\S]{0,220}if \(ok\) \{\s*onDone\("Evidence accepted\."\);/,
    );
    // Why it cannot be pressed is said in words on the screen and to a screen reader
    // (item 10 of the fixes: before, only a `title` on a disabled button).
    has(view, 'const acceptSays = accept?.off ?? "";');
    has(view, "const hints = [...askSays, acceptSays]");
    assert.equal(/title=\{accept\.off/.test(digest), false);
    // One primary button a view: Accept on the first screen, the way on in an
    // attribute. Everything else is outlined, quiet or a link.
    assert.equal(count(summary, /className="btn"/g), 1);
    assert.equal(count(one, /className="btn"/g), 1);
    assert.equal(count(digest, /className="btn"/g), 2);
    assert.match(
      summary,
      /className="btn btn-secondary"\s+disabled=\{askOff !== null\}/,
    );
  });

  it("shows the row's warning about accepting: what cautions always, only the sentence in favour behind 'more'", () => {
    // Superseded after the independent review (item 5 of the fixes). Old (first build
    // of 10.12): the footer showed the note's first sentence, which for a row with
    // something evidenced is the favourable "Accepting marks attribute A as evidenced.",
    // and held the issues and judgments behind "more". Committed before that: the whole
    // note beside Accept (`<p className="de-accept-note">{assured.acceptNote}</p>`).
    // New: everything that cautions is always read; only the sentence in favour waits
    // behind "more"; a note that does not open with that sentence is shown whole.
    assert.match(row, /acceptNote=\{assured\.acceptNote\}/);
    has(view, 'const warning = accept !== null ? flat(acceptNote) : "";');
    has(view, "const { favour, caution } = acceptNoteParts(warning);");
    has(
      summary,
      '<span id={`@{id}-note`}> {noteOpen && favour !== "" ? `@{favour} ` : ""} {caution} </span>',
    );
    // "more" is offered only where there is a sentence in favour to hold back.
    has(
      summary,
      '{favour !== "" ? ( <> {" "} <button type="button" className="cdg-link" aria-expanded={noteOpen} aria-controls={`@{id}-note`}',
    );
    assert.equal(/firstSentence/.test(digest), false);
    // The note is shown, not merely handed over: the caution is rendered under no
    // condition but that there is a note.
    has(
      summary,
      '{warning === "" ? ( DIGEST_NOTHING_SENT ) : ( <> <span id={`@{id}-note`}>',
    );
    // Accept is described by the whole note, with no word of the "more" control in it.
    has(
      summary,
      '<span id={`@{id}-accepting`} hidden> {warning === "" ? DIGEST_NOTHING_SENT : warning} </span>',
    );
    // The split is the note's own builder's, where the note is worded.
    assert.match(
      assurance,
      /export function acceptNoteParts\(note: string\): \{/,
    );
    assert.ok(
      assurance.indexOf("export function acceptNote(") <
        assurance.indexOf("export function acceptNoteParts("),
    );
  });
  it("offers the ticks and the actions only to a person who may act", () => {
    assert.match(view, /ticked: ask === null \? null : ticked,/);
    assert.match(
      item,
      /\{control\.type === "ASK" && ticks\.ticked !== null \? \(\s*<Tick/,
    );
    assert.match(
      askRow,
      /return ticks\.ticked !== null \? \(\s*<label className="cdg-ask">\s*<input\s+type="checkbox"\s+checked=\{ticks\.ticked\.has\(line\.key\)\}/,
    );
    assert.match(row, /ask=\{\s*canAct\s*\? \{/);
    // The footer is there only for someone with something to press.
    assert.match(summary, /\{ask !== null \|\| accept !== null \? \(/);
    // An item's own action goes through the row's offer, as every check action does.
    assert.match(
      check,
      /act=\{\(own\) => \{\s*const act = offer\(own\);\s*return act === null\s*\? null\s*: actButton\(/,
    );
  });

  it("keeps one state of ticks for the first screen and every attribute: what the person chose, by request", () => {
    assert.match(view, /const start = tickedToStart\(digest\);/);
    // Superseded after the independent review (item 10 of the fixes). Old: the state
    // was the set of keys "flipped" against the model's start, so a request whose start
    // changed when the list was read again turned over what the person had chosen.
    // New: each request the person ticked or unticked is kept by its key with the
    // choice itself; any other is ticked as the model starts it.
    has(
      view,
      "const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>( () => new Map(), );",
    );
    has(view, ".filter((key) => chosen.get(key) ?? start.has(key)),");
    has(view, "for (const key of keys) { next.set(key, on); }");
    assert.equal(/flipped/.test(digest), false);
    assert.equal(count(digest, /useState<ReadonlyMap<string, boolean>>/g), 1);
    assert.equal(count(digest, /tickedToStart\(/g), 1);
    // The same `ticks` goes to every item, every attribute and the details.
    assert.equal(count(view, /ticks=\{ticks\}/g), 3);
    // An item's tick stands for every request under it: on, those the model starts
    // with; off, all of them.
    assert.match(
      item,
      /checked=\{every\.some\(\(line\) => ticks\.ticked\?\.has\(line\.key\)\)\}/,
    );
    assert.match(
      item,
      /on \? control\.askKeys : every\.map\(\(line\) => line\.key\),\s*on,/,
    );
  });
  it("copies every ticked request of an attribute in full, never bounded to the form", () => {
    assert.match(
      askBox,
      /const text = askLines\(digest, chosen\)\.join\("\\n"\);/,
    );
    assert.equal(/askText\(|ASK_LIMIT|\.slice\(/.test(askBox), false);
    assert.match(askBox, /await navigator\.clipboard\.writeText\(text\);/);
    assert.match(askBox, /copied === "done" \? 2000 : 6000/);
    assert.match(
      askBox,
      /className=\{copied === "failed" \? "cdg-copy-note" : "sr-only"\}\s+role="status"/,
    );
    assert.equal(count(digest, /navigator\.clipboard/g), 1);
  });

  it("keeps the check again with the current engine on the result, quietly", () => {
    assert.match(
      check,
      /const upgrade =\s*action !== null && action\.kind === "UPGRADE" \? \(\s*<button\s+type="button"\s+className="btn btn-secondary btn-sm de-check-upgrade"/,
    );
    assert.match(check, /upgrade=\{upgrade\}/);
    assert.equal(count(view, /\{upgrade\}/g), 1);
  });
});

describe("one attribute at a time", () => {
  it("replaces the first screen inside the same row, and keeps the open attribute by its key", () => {
    assert.match(
      view,
      /const \[openKey, setOpenKey\] = useState<string \| null>\(null\);/,
    );
    // It survives the list being read again; where the check no longer has it, the
    // first screen is back.
    assert.match(
      view,
      /const current =\s*openKey !== null && digest\.steps\.includes\(openKey\) \? openKey : null;/,
    );
    assert.match(
      view,
      /if \(openKey !== null && current === null\) \{\s*setOpenKey\(null\);/,
    );
    // The first screen is hidden, not thrown away; the attribute's part likewise.
    assert.match(
      view,
      /<div className="cdg-summary" hidden=\{current !== null\}>/,
    );
    assert.match(view, /<div className="cdg-one" hidden=\{current === null\}>/);
    // Whatever display a part has of its own, closed is not shown.
    assert.match(css, /\n\.cdg \[hidden\] \{\s*display: none !important;/);
    // No attribute opens by itself.
    assert.equal(/line\.open\b/.test(digest), false);
  });

  it("keeps every attribute opened so far in the page, so nothing half typed is lost", () => {
    assert.match(
      view,
      /const \[visited, setVisited\] = useState<readonly string\[\]>\(\[\]\);/,
    );
    // Added to, never taken from.
    assert.equal(count(view, /setVisited\(/g), 1);
    assert.match(
      view,
      /setVisited\(\(was\) => \(was\.includes\(key\) \? was : \[\.\.\.was, key\]\)\);/,
    );
    assert.match(
      one,
      /\{visited\.map\(\(key\) => \{\s*const row = rowOf\(key\);\s*return row === undefined \? null : \(\s*<Attribute\s+key=\{key\}/,
    );
    assert.match(one, /hidden=\{key !== current\}/);
    assert.match(
      attribute,
      /<article\s+className="cdg-focus"\s+hidden=\{hidden\}/,
    );
    // The finding, with what is typed in it, is inside that kept part.
    assert.match(attribute, /\{finding\(line\)\}/);
  });

  it("steps over the model's own order with Summary, the place, Previous and Next", () => {
    inOrder(one, [
      "{DIGEST_SUMMARY}",
      "{title}",
      "digestPlace(",
      'aria-label="Previous attribute"',
      'aria-label="Next attribute"',
      "<Attribute",
      "{DIGEST_PREVIOUS}",
      "digestNext(",
    ]);
    assert.match(view, /const previous = digest\.steps\[at - 1\];/);
    assert.match(view, /const next = digest\.steps\[at \+ 1\];/);
    // The last one leads back.
    assert.match(
      one,
      /onClick=\{\(\) => \(next !== undefined \? show\(next\) : back\(\)\)\}/,
    );
    assert.match(
      one,
      /\{next !== undefined\s*\? digestNext\(rowOf\(next\)\?\.letter \?\? ""\)\s*: DIGEST_BACK\}/,
    );
    assert.match(
      one,
      /className="btn btn-ghost"\s+disabled=\{previous === undefined\}/,
    );
    for (const [name, words] of [
      ["DIGEST_SUMMARY", "Summary"],
      ["DIGEST_PREVIOUS", "Previous"],
      ["DIGEST_BACK", "Back to summary"],
      ["DIGEST_MORE", "More about this attribute"],
      ["DIGEST_ASKS", "Ask the owner"],
    ]) {
      assert.ok(digest.includes(`export const ${name} = "${words}";`), name);
    }
    // The keyboard is left alone: no key is taken for stepping.
    assert.equal(/onKey|keydown|keyup|addEventListener/.test(digest), false);
  });

  it("shows the attribute in the contract's order: wording, state, the table, the check's sentence over the readings, comparisons, asks, finding, the rest", () => {
    inOrder(attribute, [
      'className="cdg-focus-title"',
      "<State pill={row.status} />",
      'className="cdg-sources"',
      '<ul className="cdg-rows">',
      "{each.label}",
      '<q className="cdg-quote">{own.quote}</q>',
      "{view(evidence, DIGEST_VIEW)}",
      "{over.map((part, at) => (",
      '<div className="de-views">',
      "{CHECKED_IN_CODE}",
      "<AskBox asks={row.asks} digest={digest} ticks={ticks} />",
      "{finding(line)}",
      "{DIGEST_MORE}",
    ]);
    // Superseded after the independent review (item 4 of the fixes). Old: over the two
    // readings only `line.judgment` was drawn, and the check's own summary sentence was
    // behind "More about this attribute". New: where the readings are drawn, the
    // judgment's sentence and the summary are over them, each once.
    has(
      attribute,
      'const over = line.readings.length > 0 || line.state === "JUDGMENT" ? [line.judgment ?? "", line.summary] .map(flat) .filter((part, at, all) => part !== "" && all.indexOf(part) === at) : [];',
    );
    has(attribute, 'over.includes(flat(line.summary)) ? "" : line.summary,');
    // Each row quotes its own element's first passage (second review, item 1); every other
    // passage of the attribute and its elements, each once, is behind "More about this
    // attribute", with the elements in full, what is left to other requests, and the
    // check's own sentence.
    has(
      attribute,
      "const quoted = new Set( table.flatMap((each) => each.passages[0] === undefined ? [] : [passageKey(each.passages[0])], ), );",
    );
    has(
      attribute,
      "const further = [ ...line.passages, ...line.elements.flatMap((element) => element.passages), ].filter(",
    );
    const more = attribute.slice(attribute.indexOf("{DIGEST_MORE}"));
    inOrder(more, [
      "sentence.map(",
      'className="cdg-elements"',
      "further.map((each) => passage(each, row.letter))",
      "<AskWhy line={ask} serves />",
    ]);
    assert.match(attribute, /const \[more, setMore\] = useState\(false\);/);
    // Each request in full, with what kind of ask it is and its priority in words;
    // those folded under one are listed on request, each with its own tick.
    assert.match(
      askRow,
      /<span className="cdg-ask-text">\{line\.request\}<\/span>/,
    );
    has(
      askRow,
      'const facts = [line.kind, line.priority] .filter((part) => part !== "") .join(" · ");',
    );
    has(
      askRow,
      '{facts !== "" ? <span className="cdg-ask-priority">{facts}</span> : null}',
    );
    const group = component(digest, "AskGroup");
    assert.match(group, /\{`\$\{count\} similar`\}/);
    assert.match(group, /\{ask\.similar\.map\(\(line\) => \(/);
  });

  it("keeps all a follow-up says reachable: under its attribute on request, and in full where it is listed outside one", () => {
    // Restored after the independent review (items 9 and 11 of the fixes). Committed:
    // each follow-up had "Details" with what kind of ask it is, for which attributes,
    // what is missing, why it matters and an alternative. The first build of 10.12
    // dropped them for a request listed in "All details", and the kind for every one.
    for (const [heading, field] of [
      ["What is missing", "line.missing"],
      ["Why it matters", "line.why"],
      ["An alternative", "line.alternatives"],
    ]) {
      has(askWhy, `<dt>${heading}</dt> <dd>{${field}}</dd>`);
    }
    has(
      askWhy,
      '{serves && line.serves !== "" ? ( <span className="cdg-cap">{line.serves}</span> ) : null}',
    );
    // The kind and the priority are on every request's own line.
    has(askRow, "[line.kind, line.priority]");
    // In its attribute's view: behind "More about this attribute", for every request
    // that says any of it.
    has(
      attribute,
      'const reasons = asked.filter( (ask) => ask.missing !== "" || ask.why !== "" || ask.alternatives !== "" || ask.serves !== "", );',
    );
    has(attribute, "{reasons.map((ask) => (");
    // Outside an attribute (All details): with the request, not behind anything more.
    has(
      askRow,
      "if (full) { return ( <> <AskRow line={line} ticks={ticks} full={false} /> <AskWhy line={line} serves /> </> ); }",
    );
    has(summary, "<AskBox asks={loose} digest={digest} ticks={ticks} full />");
    const box = component(digest, "AskBox");
    has(box, "<AskGroup key={ask.key} ask={ask} ticks={ticks} full={full} />");
  });

  it("opens the evidence a row rests on in one click, in the evidence reviewer, on the annotation that marks the row's passage", () => {
    // Asked by the product owner on the attribute view, 14 November 2026: "Is there a
    // way to quickly view the annotations for the shown?", then: "I want the evidence
    // reviewer to be the one that has annotations, not the old viewer." Every row that
    // rests on the evidence carries its own element's file reference and "View"; a row
    // of something absent carries none.
    has(
      attribute,
      'const own = each.passages[0]; const evidence = evidenceOf(own, own?.quote ?? "");',
    );
    has(
      attribute,
      '{evidence !== null ? ( <span className="cdg-row-ref"> <span title={where} aria-hidden="true"> {ref} </span> {view(evidence, DIGEST_VIEW)} </span> )',
    );
    // A real button, named in full for a screen reader: "View E2 with its annotations
    // for attribute C".
    has(
      attribute,
      '<button type="button" className="cdg-link cdg-view" onClick={() => onEvidence(evidence)} > <span aria-hidden="true">{words}</span> <span className="sr-only"> {`@{DIGEST_VIEW}@{digestViewName(fileRef(files, evidence.fileId), row.letter)}`} </span> </button>',
    );
    assert.ok(digest.includes('export const DIGEST_VIEW = "View";'));
    has(digest, "` @{ref} with its annotations for attribute @{letter}`");
    // Only for a passage the row's viewer can open: the link never leads nowhere.
    has(
      attribute,
      "shown === undefined || !shown.opens || shown.fileId === null ? null : { fileId: shown.fileId, attributeId: line.attributeId, letter: row.letter, quote, passage: shown, };",
    );
    // Once at the top, beside the state: "Evidence: E2, E3", each file a button.
    has(attribute, '<span aria-hidden="true">{`@{DIGEST_EVIDENCE}:`}</span>');
    has(attribute, "{view(evidence, ref)}");
    assert.equal(count(attribute, /view\(evidence, /g), 2);
  });

  it("opens every file of a D&I request in the one viewer, full size, never in the reviewer", () => {
    // Item 9 (product owner, 14 November 2026). In design-evidence.tsx and
    // check-digest.tsx no opener is the standalone preview any more: the file's name,
    // its menu's "Annotations", a row's "View", "Evidence: E3" and a passage's "Open in
    // the file" each open the file the one way.
    // Changed 14 November 2026 (docs/evidence-annotations.md, section 5b; product owner:
    // "I still see the old reviewer when opening the file"). Old: that one way was the
    // evidence reviewer (`onDialog({ mode: "review", ... })`), its Preview the annotation
    // viewer inline. New: it is the annotation viewer itself, full size (`onView`, the
    // list's FileViewer, AnnotatedDialog), with the request's other files in its switcher
    // and the reviewer's content under "About this file"; review mode is gone.
    for (const source of [list, digest]) {
      assert.equal(
        /EvidencePreview|PreviewButton|PassageOpen|setAnnotating/.test(source),
        false,
      );
      assert.equal(/mode: "review"/.test(source), false);
    }
    has(
      row,
      'const openFile = ( fileId: string, annotation?: AnnotationAsk, more: Omit<FileOpen, "fileId" | "files"> = {}, ) => onView({ fileId, files: filesOf(item), ...(item.phase === "DESIGN" ? { requirementId: item.id, ...(annotation === undefined ? {} : { annotation }), } : {}), ...more, });',
    );
    // The file menu's "Annotations", and the check's openers, are that one way.
    has(row, 'label: "Annotations", onSelect: () => openFile(file.fileId),');
    has(row, "onOpen={openFile}");
    has(
      check,
      "onEvidence={(evidence) => onOpen(evidence.fileId, { attributeId: evidence.attributeId, quote: evidence.quote, }) }",
    );
    has(check, "<CheckReview review={check.review} onOpen={onOpen} />");
    const line = component(list, "PassageLine");
    has(
      line,
      '<button type="button" className="de-link" onClick={() => onOpen(fileId, { attributeId, quote: passage.quote }) } > Open in the file </button>',
    );
    // The file's name is that one way too, with the request it serves.
    has(row, "onClick={() => openFile(file.fileId)}");
    // "Confirm the file's type" and "Pick the walkthrough instance" open on the file's
    // details, the second on its rows to pick from.
    has(
      row,
      'openFile(act.fileId, undefined, { tab: "about", ...(act.kind === "PICK_INSTANCE" ? { pick: true } : {}), });',
    );
    // The list draws the viewer, with "About this file" from the page's own records.
    has(list, "<FileViewer");
    has(list, "open={viewing} context={aboutContext}");
    const about = read("apps/web/src/evidence-about.tsx");
    has(about, "annotation?: AnnotationAsk | undefined;");
    has(about, "startAnnotationFor={open.annotation}");
    has(about, "startAnnotationId={open.annotationId}");
    has(
      about,
      "annotations={ open.requirementId === undefined ? undefined : { controlId: context.ids.controlId, requirementId: open.requirementId, } }",
    );
    // The reviewer is only the upload dialog now: no review mode, no request's
    // annotations, and its Preview is the one viewer as before.
    const dialog = read("apps/web/src/evidence-dialog.tsx");
    has(
      dialog,
      'export type DialogOpen = { mode: "add"; itemId: string | null };',
    );
    assert.equal(
      /mode: "review"|mode === "review"|annotations=\{|notesOf|askOf/.test(
        dialog,
      ),
      false,
    );
    inOrder(dialog, [
      '{tab === "preview" ? (',
      "table ? (",
      "<FileData",
      "<AnnotatedFile",
    ]);
    assert.equal(/<AnnotatedPreview\b|<EvidenceViewer\b/.test(dialog), false);
    // The inline viewer: the existing one, with its review, and the same pick.
    // Changed 14 November 2026 (docs/evidence-assurance.md, section 10.13, tickmarks).
    // Old: the inline viewer passed `undefined` for the annotation asked for by its id.
    // New: it passes `startAnnotationId`, so a tickmark's "E2 · View" opens the reviewer
    // on the annotation a "Shown, on my review" rests on; the pick by passage is as it
    // was, and the dialog's own open state also says when it was opened to add one.
    has(
      preview,
      "const annotationPick = useAnnotationPick( notes.set, file.id, startAnnotationId, startAnnotationFor, );",
    );
    has(about, "annotationId?: string | undefined;");
    has(about, "add?: { attributeId: string } | undefined;");
    has(preview, "act={notes.act}");
    has(preview, "inline");
    // The matcher runs once each file's annotations are here; `startAnnotationId` keeps
    // working, and without either nothing is selected.
    has(preview, "const first = annotationFor(set, startAnnotationFor);");
    has(
      preview,
      "return ( asked ?? (found !== null && found.fileId === fileId ? found.pick : null) );",
    );
    has(
      preview,
      "if ( startAnnotationFor === undefined || set === null || foundFor === set.fileId ) { return; }",
    );
    // Opening it writes nothing.
    const opened = preview.slice(
      preview.indexOf("function useAnnotationPick("),
      preview.indexOf("/** The cited passage a file opens on"),
    );
    assert.ok(opened.length > 200);
    assert.equal(/fetch\(|notes\.act|method:/.test(opened), false);
  });

  it("moves the focus to the attribute's heading, and back to its item on return", () => {
    assert.match(
      attribute,
      /<h5\s+className="cdg-focus-title"\s+id=\{`\$\{id\}-title`\}\s+tabIndex=\{-1\}\s+ref=\{headingRef\}/,
    );
    assert.match(
      view,
      /const show = \(key: string\) => \{\s*setOpenKey\(key\);[\s\S]{0,120}setFocus\(\{ to: "heading", key \}\);\s*\};/,
    );
    assert.match(view, /headings\.current\.get\(focus\.key\)\?\.focus\(\);/);
    assert.match(
      view,
      /const back = \(\) => \{\s*if \(current !== null\) \{\s*setFocus\(\{ to: "item", key: current \}\);\s*\}\s*setOpenKey\(null\);\s*\};/,
    );
    assert.match(
      view,
      /items\.find\(\(item\) => item\.dataset\.cdgOpen === focus\.key\)/,
    );
    // Every way in carries the attribute's key: an item, and a shown attribute.
    assert.equal(count(digest, /data-cdg-open=\{key\}/g), 2);
    // No smooth scrolling: nothing to turn off under reduced motion.
    assert.equal(/behavior:/.test(digest), false);
    // Both headings show where the focus is.
    for (const selector of [
      ".cdg-focus-title:focus-visible",
      ".cdg-outcome:focus-visible",
    ]) {
      assert.match(rule(css, selector), /outline: 2px solid var\(--accent\);/);
    }
  });

  it("gives the focus back to the row's own button after its dialog, whichever head the row has", () => {
    // After the independent review (item 10 of the fixes): a row with a finished check
    // has a head that is not itself a button, so `.de-head` alone found nothing to
    // focus. The title's button, or the head that is one.
    has(
      row,
      'root .querySelector<HTMLElement>( "button.de-head-toggle, button.de-head", ) ?.focus();',
    );
    assert.equal(/querySelector<HTMLElement>\("\.de-head"\)/.test(row), false);
  });
  it("opens an attribute from the whole item, a shown attribute and Decide: real buttons, each", () => {
    assert.match(
      item,
      /<button\s+type="button"\s+className="cdg-item-open"\s+data-cdg-open=\{key\}\s+onClick=\{\(\) => onOpen\(key\)\}/,
    );
    // The button's own box is the item, under its control.
    assert.match(
      rule(css, "button.cdg-item-open::after"),
      /position: absolute;\s*inset: 0 -0\.4rem;/,
    );
    assert.match(rule(css, ".cdg-item"), /position: relative;/);
    assert.match(
      rule(css, ".cdg-item-control"),
      /position: relative;\s*z-index: 1;/,
    );
    assert.match(
      summary,
      /className="cdg-link cdg-quiet-open"\s+data-cdg-open=\{key\}\s+onClick=\{\(\) => show\(key\)\}/,
    );
    assert.match(
      item,
      /className="btn btn-secondary btn-sm"\s+onClick=\{\(\) => onOpen\(key\)\}\s*>\s*\{control\.label\}/,
    );
    assert.match(summary, /onOpen=\{show\}/);
  });
});

describe("controls and names", () => {
  it("wires every disclosure to something that exists", () => {
    // Every aria-controls and aria-labelledby in the digest names an id the same
    // component always renders.
    const named = [
      ...digest.matchAll(
        /aria-(?:controls|labelledby|describedby)=\{(?:[^`}]*\? )?`\$\{id\}-([a-z${}.]+)`/g,
      ),
    ].map((match) => match[1] ?? "");
    assert.ok(named.length >= 9, String(named.length));
    for (const name of named) {
      assert.ok(digest.includes(`id={\`\${id}-${name}\`}`), name);
    }
    // No disclosure is expanded without naming what it opens.
    assert.equal(
      count(digest, /aria-expanded=\{[^}]+\}/g),
      count(digest, /aria-expanded=\{[^}]+\}\s+aria-controls=\{/g),
    );
    assert.equal(count(digest, /aria-expanded=/g), 4);
    // A reference that is only sometimes there names something that is there then:
    // Accept's reason is in the hint whenever Accept is off.
    has(view, 'const acceptSays = accept?.off ?? "";');
    // What a closed disclosure names is in the page while closed: hidden, not absent.
    for (const [opened, name] of [
      ["detailsOpen", "details"],
      ["more", "more"],
      ["open", "similar"],
    ]) {
      assert.match(
        digest,
        new RegExp(
          `id=\\{\`\\$\\{id\\}-${name}\`\\}[^>]*hidden=\\{!${opened}\\}`,
        ),
        name,
      );
    }
    // The row's own: the body the title opens, and the files "7 files" opens.
    assert.match(
      row,
      /className="de-head-toggle"\s+aria-expanded=\{open\}\s+aria-controls=\{bodyId\}/,
    );
    // Its name is the title; what the whole head said when it was the one button (the
    // row's line, where each attribute stands, the attributes and the state) describes
    // it. Restored after the independent review (item 10 of the fixes).
    has(
      row,
      'aria-describedby={`@{id}-sub@{!open && assured !== null && assured.states.length > 0 ? ` @{id}-states` : ""} @{id}-meta`}',
    );
    for (const part of ["sub", "states", "meta"]) {
      assert.ok(row.includes(`id={\`\${id}-${part}\`}`), part);
    }
    assert.equal(count(row, /id=\{`\$\{id\}-sub`\}/g), 2);
    assert.match(rule(listCss, ".de-head-meta"), /display: contents;/);
    // Each letter keeps its own words for the pointer, over the title's box.
    assert.match(
      rule(listCss, ".de-head-split .dq-letters"),
      /position: relative;\s*z-index: 1;/,
    );
    assert.match(
      reviewedBody,
      /<div className="tar-body de-body de-reviewed" id=\{bodyId\}>/,
    );
    assert.match(
      reviewedBody,
      /<div\s+id=\{filesId\}\s+className="de-files-panel"/,
    );
  });

  it("uses real buttons and inputs only, each with its words", () => {
    // Buttons and inputs only: nothing clickable that the keyboard cannot reach.
    assert.equal(
      /onClick=/.test(digest.replace(/<button\b[\s\S]*?>/g, "")),
      false,
    );
    assert.equal(
      /<div[^>]*onClick|<span[^>]*onClick|<li[^>]*onClick/.test(digest),
      false,
    );
    assert.equal(/role="button"/.test(digest), false);
    assert.equal(count(digest, /<button\b/g), count(digest, /type="button"/g));
    // A heading takes the focus when the screen changes, and is never a tab stop.
    assert.deepEqual(
      [...digest.matchAll(/tabIndex=\{([^}]+)\}/g)].map((match) => match[1]),
      ["-1", "-1"],
    );
    // A tick is a real checkbox inside its label.
    const tick = component(digest, "Tick");
    assert.match(
      tick,
      /<label className="cdg-tick">\s*<input\s+type="checkbox"\s+checked=\{checked\}\s+onChange=\{\(event\) => onChange\(event\.target\.checked\)\}\s*\/>\s*<span>\s*\{children\}/,
    );
    assert.equal(
      count(digest, /type="checkbox"/g),
      count(digest, /<label className=/g),
    );
    // The two icon buttons say what they do.
    assert.equal(count(one, /aria-label="(Previous|Next) attribute"/g), 2);
    // In the row: the title and "7 files" are two buttons, neither inside the other.
    const head = row.slice(
      row.indexOf('className="tar-head dq-head de-head de-head-split"'),
      row.indexOf(") : (", row.indexOf("de-head-split")),
    );
    assert.match(head, /^className="tar-head dq-head de-head de-head-split">/);
    assert.equal(count(head, /<button\b/g), 2);
    assert.match(
      head,
      /<span className="tar-text">\{row\.title\}<\/span>\s*<\/button>\s*\{open && item\.files\.length > 0 \? \(/,
    );
    assert.match(
      rule(listCss, "button.de-head-toggle::after"),
      /position: absolute;\s*inset: 0;/,
    );
    assert.match(
      rule(listCss, "button.de-link.de-files-toggle"),
      /position: relative;\s*z-index: 1;/,
    );
  });
});

describe("the stylesheet", () => {
  it("is loaded with the others, before the glass layer", () => {
    assert.ok(layout.includes('import "./check-digest.css";'));
    assert.ok(
      layout.indexOf('import "./design-evidence.css";') <
        layout.indexOf('import "./check-digest.css";'),
    );
    assert.ok(
      layout.indexOf('import "./check-digest.css";') <
        layout.indexOf('import "./glass.css";'),
    );
  });

  it("uses the tokens only: no literal colour, and never the accent fill as text", () => {
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false);
    assert.equal(/rgb\(|rgba\(|hsl\(|oklch\(/.test(css), false);
    assert.equal(/[^-]color: var\(--accent\)/.test(css), false);
    assert.equal(
      /^\s*(?:color|background|border-color): (?!var\(--|transparent|currentColor|color-mix\(in srgb, var\(--)/m.test(
        css,
      ),
      false,
    );
    assert.equal(/:\s*(?:white|black)\b/.test(css), false);
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(listCss), false);
  });

  it("keeps a status colour to a mark and the status words, never a fill", () => {
    // No soft status fill anywhere in the result: a state is a dot and its words.
    assert.equal(
      /var\(--(success|warning|danger)-(soft|border)\)/.test(css),
      false,
    );
    const filled = [
      ...css.matchAll(
        /\n([^\n{}]+) \{[^}]*background: var\(--(success|warning|danger)\);/g,
      ),
    ].map((match) => match[1]);
    assert.deepEqual(filled, [
      ".cdg-dot.is-success",
      ".cdg-dot.is-warning",
      ".cdg-dot.is-danger",
    ]);
    assert.match(rule(css, ".cdg-dot"), /width: 9px;\s*height: 9px;/);
    assert.equal(/de-state|tone-\$\{/.test(digest), false);
  });

  it("moves within the motion budget, and not at all under reduced motion", () => {
    const moving = [
      ...css.matchAll(/(?:animation|transition)[^;]*?(\d+)ms/g),
    ].map((match) => Number(match[1]));
    assert.ok(moving.length >= 8);
    // A view or a panel opens in 200 ms (150 to 250); hover and a caret's turn are 120
    // and 180.
    assert.ok(
      moving.every((ms) => ms >= 100 && ms <= 250),
      String(moving),
    );
    const reduced = css.slice(
      css.lastIndexOf("@media (prefers-reduced-motion"),
    );
    // Every rule that opens is stilled there, and every rule that moves.
    const opening = [
      ...css.matchAll(
        /\n([^\n{}@]+(?:,\n[^\n{}@]+)*) \{[^}]*\banimation: tar-open 200ms ease;/g,
      ),
    ].flatMap((match) =>
      (match[1] ?? "").split(",").map((part) => part.trim()),
    );
    assert.ok(opening.length >= 6, String(opening));
    for (const selector of opening) {
      assert.ok(reduced.includes(selector), selector);
    }
    assert.match(reduced, /\{\s*animation: none;\s*\}/);
    const moved = [
      ...css.matchAll(/\n([^\n{}@]+(?:,\n[^\n{}@]+)*) \{[^}]*\btransition:/g),
    ].flatMap((match) =>
      (match[1] ?? "").split(",").map((part) => part.trim()),
    );
    assert.ok(moved.length >= 5, String(moved));
    for (const selector of moved) {
      assert.ok(reduced.includes(selector), selector);
    }
    assert.match(reduced, /\{\s*transition: none;\s*\}/);
    // The row's own: the files' list opens in 200 ms, and not under reduced motion.
    assert.match(
      rule(listCss, ".de-files-panel"),
      /animation: tar-open 200ms ease;/,
    );
    const listReduced = listCss.slice(
      listCss.lastIndexOf("@media (prefers-reduced-motion"),
    );
    assert.match(listReduced, /\.de-files-panel \{\s*animation: none;/);
    assert.match(listReduced, /\.de-head-split,/);
  });

  it("holds an item to two lines, whatever the model's text is, with the full text reachable", () => {
    // The full text: in the attribute's own view or the details, by keyboard and
    // pointer; and on hover here, since an item's words sit over its stretched button
    // (after the independent review, item 10: before, the button's box covered them and
    // no title ever showed).
    assert.match(item, /title=\{item\.headline\}/);
    assert.match(item, /title=\{item\.context\}/);
    assert.match(
      rule(
        css,
        "button.cdg-item-open > .cdg-item-head,\nbutton.cdg-item-open > .cdg-item-sub",
      ),
      /position: relative;\s*z-index: 1;/,
    );
    assert.match(item, /title=\{item\.context\}/);
    assert.match(
      attribute,
      /\{row\.text !== "" \? row\.text : `Attribute \$\{row\.letter\}`\}/,
    );
    // The item's columns: the marker, the text (which may shrink), the control, the
    // chevron. Nothing has a fixed width that long text could push out.
    assert.match(
      rule(css, ".cdg-item"),
      /grid-template-columns: var\(--cdg-mark\) minmax\(0, 1fr\) auto 16px;/,
    );
    // In an attribute's view everything wraps.
    for (const selector of [
      ".cdg-focus-title",
      ".cdg-row-text",
      ".cdg-quote",
      ".cdg-ask-said",
    ]) {
      assert.match(rule(css, selector), /overflow-wrap: anywhere;/, selector);
    }
  });

  it("stacks at a phone's width: the control under the text, the actions under the sentence", () => {
    const narrow = css.slice(
      css.indexOf("@container dq (max-width: 560px) {"),
      css.indexOf("@media (max-width: 640px)"),
    );
    assert.ok(narrow.length > 200);
    assert.match(
      narrow,
      /\.cdg-item \{\s*grid-template-columns: var\(--cdg-mark\) minmax\(0, 1fr\) 16px;/,
    );
    assert.match(
      narrow,
      /\.cdg-item-control \{\s*grid-row: 2;\s*grid-column: 2;\s*justify-self: start;/,
    );
    assert.match(
      narrow,
      /\.cdg-row \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    assert.match(narrow, /\.cdg-foot-acts \{\s*flex: 1 1 100%;/);
  });
});

describe("the words", () => {
  it("never say the client, and use no long dash", () => {
    // (The file's own "use client" directive is not copy.)
    for (const source of [digest.replace('"use client";', ""), css]) {
      assert.equal(/\bclients?\b/i.test(source), false);
      assert.equal(/[—–]/.test(source), false);
    }
  });

  it("are the model's wherever it has them", () => {
    for (const name of [
      "ASK_OWNER",
      "absentOf",
      "askLines",
      "askText",
      "fileRef",
      "MISSING",
      "STATUS_SHOWN",
      "tickedToStart",
    ]) {
      assert.match(digest, new RegExp(`\\b${name},`), name);
    }
    assert.match(attribute, /\{CHECKED_IN_CODE\}/);
    // The model's words are not typed again here.
    for (const typed of [
      '"Ask owner"',
      ">Ask owner<",
      '"Missing"',
      ">Missing<",
      '"Decide"',
      "Finding to decide",
      "need your attention",
      "Nothing needs your attention",
      "not asked for)",
      "Read in part",
    ]) {
      assert.equal(digest.includes(typed), false, typed);
    }
    // Nothing reads as more than proposed.
    assert.equal(
      /\b(approved|concluded|confirmed|verified by|effective)\b/i.test(
        digest.replace(/first verified passage/gi, ""),
      ),
      false,
    );
  });
});

describe("the fast tier", () => {
  it("runs the digest's two test files", () => {
    const fast = makefile.match(/^FAST_NODE \?= (.*)$/m)?.[1] ?? "";
    for (const file of [
      "tests/check-digest-model.test.ts",
      "tests/check-digest-view.test.ts",
    ]) {
      assert.ok(fast.split(" ").includes(file), file);
    }
  });
});
