import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

// Tickmarks on the attribute view (docs/evidence-assurance.md, section 10.13), read from
// the screen's own files. What must hold however it looks: the tickmark's view sends
// nothing itself; the row sends only through /workspace/evidence-assurance with the two
// tickmark intents, which assuranceWrite validates, and the route passes the validated
// body on; success is said only once the server has answered, a refusal is the server's
// sentence, and the list is read again in place (no reload); the form is a real form in
// place (not a dialog), with labelled fields and their errors tied to them; "Add
// evidence" is the row's existing upload and picker; nothing is offered to a person who
// cannot act; and nothing moves under reduced motion.

const read = (path: string) => readFileSync(path, "utf8");
const view = read("apps/web/src/attribute-tickmark.tsx");
const digest = read("apps/web/src/check-digest.tsx");
const list = read("apps/web/src/design-evidence.tsx");
const route = read("apps/web/app/workspace/evidence-assurance/route.ts");
const dialog = read("apps/web/src/evidence-dialog.tsx");
const viewer = read("apps/web/src/evidence-annotations.tsx");
const css = read("apps/web/app/check-digest.css");
const makefile = read("Makefile");

const squash = (source: string) => source.replace(/\s+/g, " ");
const has = (source: string, written: string, label = written) =>
  assert.ok(squash(source).includes(squash(written)), label);

/** A function's source: from its declaration to the next top-level one. */
const component = (source: string, name: string) => {
  const from = source.search(
    new RegExp(`\\n(?:export )?(?:async )?function ${name}\\b`),
  );
  assert.ok(from >= 0, name);
  const next = source
    .slice(from + 1)
    .search(/\n(?:export )?(?:async )?(?:function |const [A-Z_]+\b|type )/);
  return source.slice(from, next < 0 ? undefined : from + 1 + next);
};

describe("what the tickmark's view sends", () => {
  it("is nothing of its own: no call, no route, no router, no storage", () => {
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
      assert.equal(forbidden.test(view), false, String(forbidden));
    }
    // It records and reopens only through the row's own handlers.
    has(
      view,
      "const refused = await tickmark.record( line.attributeId, tickmarkFields({ ...draft, kind: draft.kind }), );",
    );
    has(
      view,
      "const refused = await tickmark.reopen( line.attributeId, standing.version,",
    );
  });

  it("says success only once the server has answered, and shows its refusal as it is", () => {
    const submit = view.slice(
      view.indexOf("const submit = async"),
      view.indexOf("const reopenProblem"),
    );
    const at = (text: string) => {
      const found = submit.indexOf(text);
      assert.ok(found >= 0, text);
      return found;
    };
    assert.ok(
      at("await tickmark.record(") < at("confirmed(TICKMARK_RECORDED)"),
    );
    has(
      submit,
      "if (refused === null) { confirmed(TICKMARK_RECORDED); } else { setProblem(refused); }",
    );
    const reopen = view.slice(
      view.indexOf("const reopen = async"),
      view.indexOf("const set = (change"),
    );
    has(
      reopen,
      "if (refused === null) { confirmed(TICKMARK_REOPENED); } else { setProblem(refused); }",
    );
    // The refusal is said where the action was taken, as an alert.
    has(view, '<p className="cdg-tmf-problem" role="alert"> {problem} </p>');
    // A second press while one is on its way sends nothing.
    has(
      view,
      "busy || draft.kind === null || Object.keys(problems).length > 0",
    );
  });
});

describe("the row's tickmark calls", () => {
  const hook = component(list, "useTickmarkAction");

  it("post only to /workspace/evidence-assurance, with the two tickmark intents", () => {
    assert.equal((hook.match(/fetch\(/g) ?? []).length, 1);
    has(
      hook,
      'const response = await fetch("/workspace/evidence-assurance", { method: "POST",',
    );
    has(hook, 'intent: "disposition",');
    has(hook, 'intent: "reopen-disposition",');
    // Success is the server's answer; the list is then read again in place.
    has(hook, "const problem = dispositionProblem(status, detail);");
    has(
      hook,
      "if (problem === null || status === 409) { startTransition(() => router.refresh()); }",
    );
    assert.equal(/location\.|window\.location/.test(hook), false);
  });

  it("are offered only to a person who may act, as the model offers them", () => {
    has(
      list,
      "const tickmark: DigestTickmarkAction | null = canAct && assured !== null ? {",
    );
    has(list, "offer: (line) => tickmarkOffer(assured.check, line, canAct),");
    has(list, "const addEvidence: DigestAddEvidence | null = canAct ? {");
    has(list, "tickmark={tickmark} addEvidence={addEvidence}");
  });

  it("add evidence through the row's existing paths: the wizard on this request, and the picker", () => {
    has(list, "upload: () => onUpload(),");
    has(list, 'held: () => { setPicker("held"); setHeldAsked(true); },');
    has(list, 'uploadOff: locked ? lockedWhy : unavailable("upload"),');
    has(list, 'heldOff: locked ? lockedWhy : unavailable("held"),');
  });

  it("read a request's annotations only, and add one in the existing reviewer, coming back to the form", () => {
    const annotations = component(list, "readRequestAnnotations");
    has(annotations, "`/workspace/evidence-annotations?${annotationsQuery({");
    assert.equal(/method:/.test(annotations), false);
    has(
      list,
      'onDialog({ mode: "review", fileId, requirementId: item.id, add: { attributeId }, onClosed: back, }),',
    );
    has(
      list,
      'const after = evidence.mode === "review" ? evidence.onClosed : undefined; setEvidence(null); after?.();',
    );
    has(dialog, "add?: { attributeId: string };");
    has(dialog, "open.add?.attributeId");
    // The viewer starts drawing once, and the box names the attribute.
    has(viewer, "addingStarted.current = true; startDrawing();");
    has(viewer, "? [startAdding]");
  });
});

describe("the route", () => {
  it("passes on only the body assuranceWrite made, as JSON", () => {
    has(route, "const write = assuranceWrite(fields);");
    has(
      route,
      'if ("error" in write) { return NextResponse.json({ status: 422, detail: "" }); }',
    );
    has(
      route,
      "...(write.body !== undefined ? { body: JSON.stringify(write.body) } : {}),",
    );
    has(route, 'headers.set("content-type", "application/json");');
    assert.equal(/JSON\.stringify\(fields\)/.test(route), false);
  });
});

describe("the form", () => {
  it("is a form in place, never a dialog, and offers only the kinds the model offers", () => {
    assert.equal(
      /role="dialog"|aria-modal|<dialog\b|createPortal/.test(view),
      false,
    );
    has(view, "const kinds: readonly DispositionKind[] = offer?.kinds ?? [];");
    has(view, "{kinds.map((kind) => (");
    has(view, '{offer.note !== "" ? (');
    // Nothing to a person who cannot act: no Tickmark, no Change, no Reopen.
    has(view, "{offer !== null && standing === null ? (");
    has(view, "{offer !== null ? (");
  });

  it("labels every field and ties its error and its count to it", () => {
    for (const field of ["reason", "relied", "reopen"]) {
      has(view, `htmlFor={\`\${id}-${field}\`}`);
      has(view, `id={\`\${id}-${field}\`}`);
      has(view, `aria-describedby={\`\${id}-${field}-count`);
      has(view, `id={\`\${id}-${field}-error\`}`);
    }
    assert.ok((view.match(/<legend>/g) ?? []).length >= 2);
    assert.ok((view.match(/type="radio"/g) ?? []).length >= 2);
    has(view, 'aria-live="polite"');
    has(view, `{\`\${used} of \${max} characters\`}`);
  });

  it("moves the focus to the form when it opens and back to what opened it when it closes", () => {
    has(
      view,
      "form?.querySelector<HTMLInputElement>('input[type=\"radio\"]:checked') ?? form?.querySelector<HTMLInputElement>('input[type=\"radio\"]')",
    );
    has(view, "window.setTimeout(() => back?.isConnected && back.focus(), 0);");
    // What opened it stays in the page while the form is open, so the focus can return.
    has(view, '<span className="cdg-tm-acts" hidden={mode !== "none"}>');
    has(view, '<div className="cdg-tm-bar" hidden={mode === "form"}>');
    // Once confirmed, the confirmation takes the focus.
    has(view, "window.setTimeout(() => doneRef.current?.focus(), 0);");
  });

  it("shows the standing tickmark above what the check found, which stays as it was", () => {
    const at = (text: string) => digest.indexOf(text);
    assert.ok(at('<p className="cdg-focus-state">') < at("<AttributeTickmark"));
    assert.ok(at("<AttributeTickmark") < at("{table.length > 0 ? ("));
  });

  it("keeps its words plain", () => {
    assert.equal(/the client/i.test(view), false);
    const said = [...view.matchAll(/"([^"\n]{12,})"/g)].map(
      (match) => match[1] ?? "",
    );
    for (const text of said) {
      assert.equal(text.includes("—"), false, text);
    }
  });
});

describe("the stylesheet", () => {
  it("uses tokens only, no status fill, and nothing moves under reduced motion", () => {
    const from = css.indexOf("A person's tickmark on an attribute");
    assert.ok(from > 0);
    const part = css.slice(from, css.indexOf("@media (max-width: 640px)"));
    assert.equal(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(part), false);
    assert.equal(
      /var\(--(success|warning|danger)-(soft|border)\)/.test(part),
      false,
    );
    const reduced = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    has(reduced, ".cdg-tmf,");
    has(reduced, ".cdg-tm-history > ul {");
    has(reduced, ".cdg-tmf-kind { transition: none; }");
    for (const ms of [...part.matchAll(/(\d+)ms/g)].map((match) =>
      Number(match[1]),
    )) {
      assert.ok(ms >= 100 && ms <= 250, String(ms));
    }
  });
});

describe("the fast tier", () => {
  it("runs these tests", () => {
    const fast = makefile.match(/^FAST_NODE \?= (.*)$/m)?.[1] ?? "";
    assert.ok(fast.includes("tests/attribute-tickmark-model.test.ts"));
    assert.ok(fast.includes("tests/attribute-tickmark-view.test.ts"));
  });
});
