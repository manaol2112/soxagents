import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// A person's decision on a file's reliability on the screen (docs/evidence-assurance.md,
// section 10.14), read from the sources: the decision posts only through the workspace
// route with its two intents; success is said only once the server has answered, and a
// refusal is the server's sentence, kept where it was said; every control is labelled
// with its errors tied to it; the focus moves with the form; nothing reloads; the words
// are the model's; colours are tokens with words beside them, in both themes; motion is
// off under reduced motion; and nothing says "the client". The behaviour itself is
// checked in a headless browser with scripted answers (the harness of this increment).

const read = (path: string) => readFileSync(path, "utf8");
const panel = read("apps/web/src/file-reliability.tsx");
const model = read("apps/web/src/file-reliability-model.ts");
const digest = read("apps/web/src/check-digest.tsx");
const digestModel = read("apps/web/src/check-digest-model.ts");
const list = read("apps/web/src/design-evidence.tsx");
const about = read("apps/web/src/evidence-about.tsx");
const route = read("apps/web/app/workspace/evidence-assurance/route.ts");
const assurance = read("apps/web/src/evidence-assurance-model.ts");
const css = read("apps/web/app/check-digest.css");
const wpView = read("apps/web/src/design-workpaper-view.tsx");
const wpCss = read("apps/web/app/design-workpaper.css");
const makefile = read("Makefile");

const squash = (source: string) => source.replace(/\s+/g, " ");
/** Whether the source has the text, whitespace aside; "@{" stands for "${" so that a
 * template literal of the source can be written in a plain string. */
const has = (source: string, written: string, label = written) =>
  assert.ok(
    squash(source).includes(squash(written.replaceAll("@{", "${"))),
    label,
  );
const count = (source: string, pattern: RegExp) =>
  [...source.matchAll(pattern)].length;
const component = (source: string, name: string) => {
  const from = source.search(new RegExp(`\\n(?:export )?function ${name}\\b`));
  assert.ok(from >= 0, name);
  const next = source
    .slice(from + 1)
    .search(/\n(?:export )?(?:function |const [A-Z_]+\b|type )/);
  return next < 0 ? source.slice(from) : source.slice(from, from + 1 + next);
};
const rule = (sheet: string, selector: string) => {
  const from = sheet.indexOf(`\n${selector} {`);
  assert.ok(from >= 0, selector);
  return sheet.slice(from, sheet.indexOf("}", from) + 1);
};
const hook = component(list, "useReliabilityAction");

describe("what a decision sends", () => {
  it("posts only through the workspace route, with the two new intents", () => {
    // The list's one hook: one route, POST, JSON, and the two intents.
    assert.equal(count(list, /function useReliabilityAction\(/g), 1);
    assert.equal(count(list, /useReliabilityAction\(ids\)/g), 1);
    has(
      hook,
      'const response = await fetch("/workspace/evidence-assurance", {',
    );
    has(hook, 'method: "POST",');
    has(hook, 'intent: "file-reliability",');
    has(hook, 'intent: "reopen-file-reliability",');
    assert.equal(count(hook, /fetch\(/g), 1);
    // A recording names what it replaces, a reopening the one it reopens.
    has(hook, "...fields, replaces, }),");
    has(hook, "file_id: fileId, id, reason,");
    // The route is the existing one, which sends only what assuranceWrite takes.
    has(route, "const write = assuranceWrite(fields);");
    has(
      route,
      'if ("error" in write) { return NextResponse.json({ status: 422, detail: "" }); }',
    );
    has(
      assurance,
      'if (intent === "file-reliability" || intent === "reopen-file-reliability") {',
    );
    has(assurance, "const path = `@{base}/files/@{fileId}/reliability`;");
    has(assurance, ": { path: `@{path}/reopen`, body: { id, reason } };");
  });

  it("says success only once the server has answered, and reads the list again in place", () => {
    has(hook, "const problem = reliabilityProblem(status, detail);");
    has(
      hook,
      "if (problem === null || status === 409) { startTransition(() => router.refresh()); }",
    );
    assert.equal(
      /location\.(reload|href|assign)|window\.location/.test(hook),
      false,
    );
    // A second press while the first is on its way sends nothing.
    has(hook, "if (sending.current) {");
    // In the panel: the confirmation only where the call answered null.
    has(
      panel,
      "const refused = await action.record( line.fileId, reliabilityFields({ ...draft, kind: draft.kind }), seen, ); setBusy(false); if (refused === null) { confirmed(RELIABILITY_RECORDED); } else { setProblem(refused); setFollow(true); }",
    );
    has(
      panel,
      'const refused = await action.reopen( line.fileId, seen, reopenReason.replace(/\\s+/g, " ").trim(), ); setBusy(false); if (refused === null) { confirmed(RELIABILITY_REOPENED); } else { setProblem(refused); setFollow(true); }',
    );
    // Nothing optimistic: no confirmation is set anywhere else.
    assert.equal(count(panel, /confirmed\(/g), 2);
    assert.equal(count(panel, /setDone\(words\)/g), 1);
  });

  it("keeps a refusal where it was said, as the server's sentence", () => {
    assert.equal(count(panel, /role="alert"/g), 3);
    has(
      panel,
      '{problem !== null && !(mode === "form" && offer !== null) && !(mode === "reopen" && standing !== null) ? (',
    );
    // After a refusal the form follows what stands once the list is read again.
    has(panel, "if (follow) { setSeen(standingId); }");
  });

  it("has no call, route or write of its own in the panel", () => {
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
      assert.equal(forbidden.test(panel), false, String(forbidden));
      assert.equal(forbidden.test(model), false, String(forbidden));
    }
    assert.deepEqual(
      [...panel.matchAll(/from "([^"]+)";/g)].map((match) => match[1]),
      [
        "react",
        "./attribute-tickmark",
        "./evidence-assurance-model",
        "./file-reliability-model",
        "./ui-icon",
      ],
    );
  });

  it("offers a decision only to a person who may act, on the row's own check", () => {
    const helper = component(list, "reliabilityFor");
    has(helper, "return canAct ? {");
    has(helper, "offer: (line) => reliabilityOffer(check, line, canAct),");
    has(
      list,
      "const fileReliability: ReliabilityAction | null = assured !== null ? reliabilityFor(reliabilityCalls, item.id, assured.check, canAct) : null;",
    );
    has(list, "reliability={fileReliability}");
    // "About this file" uses the same calls, for the request the file was opened on.
    has(
      list,
      "action: reliabilityFor(reliabilityCalls, requirementId, check, canAct),",
    );
  });
});

describe("the form", () => {
  it("labels every control and ties each error to its field", () => {
    has(panel, "<legend>{KINDS_LEGEND}</legend>");
    assert.match(model, /label: "Reliability established on my review",/);
    assert.match(model, /label: "Not relied on",/);
    for (const field of ["reason", "relied", "reopen"]) {
      assert.match(
        panel,
        new RegExp(`htmlFor=\\{\`\\$\\{id\\}-${field}\`\\}`),
        field,
      );
      assert.match(
        panel,
        new RegExp(`id=\\{\`\\$\\{id\\}-${field}\`\\}`),
        field,
      );
      assert.match(
        panel,
        new RegExp(
          `\\$\\{id\\}-${field}-count\\$\\{[^}]+\\? \` \\$\\{id\\}-${field}-error\` : ""\\}`,
        ),
        field,
      );
      assert.match(
        panel,
        new RegExp(
          `<p id=\\{\`\\$\\{id\\}-${field}-error\`\\} className="cdg-tmf-error">`,
        ),
        field,
      );
    }
    has(
      panel,
      'aria-describedby={ err("kind") !== null ? `@{id}-kind-error` : undefined }',
    );
    // The counts are the tickmark form's own, with their bounds.
    assert.equal(count(panel, /<Count\b/g), 3);
    has(panel, "max={RELIABILITY_BOUNDS.reasonMax}");
    has(panel, "max={RELIABILITY_BOUNDS.reliedOnMax}");
    has(
      assurance,
      "reasonMin: 10, reasonMax: 1000, reliedOnMin: 10, reliedOnMax: 600,",
    );
  });

  it("asks what was relied on only for 'Reliability established on my review', where it is required", () => {
    has(
      panel,
      '{draft.kind === "ESTABLISHED_ON_REVIEW" ? ( <div className="cdg-tmf-field"> <label htmlFor={`@{id}-relied`}>{RELIED_ON_LABEL}</label>',
    );
    assert.match(panel, /export const RELIED_ON_LABEL = "What you relied on";/);
    // Required, not optional.
    assert.equal(/\(optional\)/.test(panel), false);
  });

  it("moves the focus with the form: into it, back to what opened it, to the confirmation", () => {
    has(
      panel,
      `form?.querySelector<HTMLInputElement>('input[type="radio"]:checked') ??`,
    );
    has(panel, "reopenRef.current?.focus();");
    has(panel, "window.setTimeout(() => doneRef.current?.focus(), 0);");
    has(
      panel,
      "const back = [opener.current, decideRef.current, headRef.current].find( (each) => each?.isConnected === true, ); back?.focus();",
    );
    has(
      panel,
      'className="cdg-tm-done" role="status" tabIndex={-1} ref={doneRef}',
    );
    // Record and Cancel, as the tickmark's form.
    has(panel, '{busy ? "Recording…" : RELIABILITY_RECORD}');
    assert.match(panel, /export const RELIABILITY_RECORD = "Record";/);
    assert.equal(count(panel, />\s*Cancel\s*</g), 2);
  });

  it("shows the decision that stands with who, when, the reason, what was relied on, Change and Reopen, and History with how each ended", () => {
    has(panel, "{decidedLine(standing.recordedBy, standing.recordedAt)}");
    has(panel, '<p className="cdg-tm-reason">{standing.reason}</p>');
    has(panel, '<span className="cdg-cap">{RELIED_ON_SHOWN}</span>');
    has(panel, "{RELIABILITY_CHANGE}");
    has(panel, "{RELIABILITY_REOPEN}");
    has(panel, '<p className="cdg-tm-ended">{reliabilityEndingLine(item)}</p>');
    // What the check found stays beside the decision.
    has(
      panel,
      '{line.question !== "" ? ( <p className="cdg-tm-line cdg-rel-found"> <span className="cdg-cap">{RELIABILITY_FOUND}</span> <span>{line.question}</span>',
    );
    assert.match(panel, /export const RELIABILITY_FOUND = "The check found";/);
  });
});

describe("where it is opened", () => {
  it("opens in place on the first screen, from the file's item and from the quiet line", () => {
    has(
      digest,
      "<FileReliability key={relLine.fileId} line={relLine} fileRef={fileRef(files, relLine.fileId)} action={reliability} startForm={relOpen.form} onClose={closeReliability} />",
    );
    has(digest, "(fileId, from) => openReliability(fileId, from, true)");
    has(digest, "openReliability(fileId, event.currentTarget, false)");
    // A person who may not act gets no "Decide"; anyone reads a decision.
    has(digest, 'control.type === "RELIABILITY" && onReliability !== null');
    has(digest, "reliability === null ? null : (fileId, from) =>");
    // Closing gives the focus back.
    has(
      digest,
      'from?.isConnected === true ? from : root.current?.querySelector<HTMLElement>(".cdg-outcome")',
    );
  });

  it("opens from 'About this file' for the file, on the request it was opened on", () => {
    has(about, "<h3 id={`@{uid}-reliability`}>{RELIABILITY_TITLE}</h3>");
    has(
      about,
      "<FileReliability line={reliability.line} fileRef={reliability.ref} action={reliability.action} />",
    );
    has(about, "context.reliability?.(requirementId, fileId) ?? null");
    has(
      about,
      "open.requirementId, ), [context, open.pick, open.requirementId],",
    );
    assert.match(panel, /export const RELIABILITY_TITLE = "Reliability";/);
  });

  it("leads the first screen with the status line and keeps the check's outcome quietly", () => {
    has(
      digest,
      '<h5 className="cdg-outcome" tabIndex={-1}> {digest.status} </h5>',
    );
    has(digestModel, 'export const STATUS_NOTHING = "Nothing waits on you.";');
    has(digestModel, 'export const STATUS_OPEN = "Still open:";');
    assert.equal(
      /sufficien/i.test(component(digestModel, "statusLine")),
      false,
    );
  });
});

describe("the standards", () => {
  it("uses tokens only, words with every colour, and no motion under reduced motion", () => {
    for (const selector of [
      ".cdg-proposed-line",
      ".cdg-rel-wrap",
      ".cdg-rel.is-panel",
      ".cdg-rel-head > h6",
      ".cdg-rel-found",
    ]) {
      const said = rule(css, selector);
      assert.equal(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(said), false, selector);
    }
    for (const selector of [".dw-not-relied", ".dw-inspected"]) {
      const said = rule(wpCss, selector);
      assert.equal(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i.test(said), false, selector);
    }
    assert.match(rule(css, ".cdg-rel-wrap"), /animation: tar-open 200ms ease;/);
    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    assert.match(reduced, /\.cdg-rel-wrap,/);
    // Every decision is said in words with its mark; its tone is neutral.
    has(panel, "<UiIcon name={words.icon} size={13} /> {words.shown}");
    assert.equal(/tone: "success"/.test(model), false);
  });

  it("never says 'the client', and uses no dash its neighbours avoid", () => {
    for (const source of [
      panel,
      model,
      digest,
      digestModel,
      css,
      wpView,
      wpCss,
    ]) {
      assert.equal(/\bthe client\b/i.test(source), false);
    }
    for (const source of [panel, model, css]) {
      assert.equal(/[—–]/.test(source), false);
    }
  });

  it("adds no dependency", () => {
    for (const source of [panel, model]) {
      assert.equal(
        /from "(?!\.|react)/.test(source.replace(/from "react"/g, "")),
        false,
      );
    }
  });

  it("words the workpaper's report row and evidence index as the model does", () => {
    has(wpView, "<Inspected paper={paper} report={report} />");
    assert.equal(
      count(wpView, /<Inspected paper=\{paper\} report=\{report\} \/>/g),
      2,
    );
    assert.equal(count(wpView, /notReliedOnLine\(entry\)/g) >= 4, true);
    has(wpView, '<small className="dw-not-relied">{NOT_RELIED_ON}</small>');
  });

  it("runs in the fast tier", () => {
    const fast = makefile.slice(makefile.indexOf("FAST_NODE ?="));
    assert.match(
      fast.slice(0, fast.indexOf("\n")),
      /tests\/file-reliability-model\.test\.ts/,
    );
    assert.match(
      fast.slice(0, fast.indexOf("\n")),
      /tests\/file-reliability-view\.test\.ts/,
    );
  });
});
