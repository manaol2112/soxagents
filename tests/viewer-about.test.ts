import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  citedMarks,
  citedPageMarks,
  citedUnboxedLine,
} from "../apps/web/src/evidence-annotations-model.ts";
import {
  type EvidenceCitation,
  markParts,
} from "../apps/web/src/evidence-preview-model.ts";

// Opening a file opens the viewer, not the reviewer (docs/evidence-annotations.md,
// section 5b; product owner, 14 November 2026: "I still see the old reviewer when opening
// the file. It's just that you incorporated the annotations."). The reviewer's review
// mode is retired; what it held is "About this file", the viewer's second tab. With the
// findings of the independent review of the one viewer (commit 21dcf2b), items 4a to 4g.
// Synthetic data only.

const read = (path: string) => readFileSync(path, "utf8");
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

const viewer = read("apps/web/src/evidence-annotations.tsx");
const opener = read("apps/web/src/evidence-opener.tsx");
const stages = read("apps/web/src/evidence-stages.tsx");
const about = read("apps/web/src/evidence-about.tsx");
const dialog = read("apps/web/src/evidence-dialog.tsx");
const list = read("apps/web/src/design-evidence.tsx");
const requests = read("apps/web/src/evidence-requests-view.tsx");
const model = read("apps/web/src/evidence-annotations-model.ts");
const css = read("apps/web/app/evidence-annotations.css");
const globals = read("apps/web/app/globals.css");

const FILE = "66666666-6666-7666-8666-666666666666";
const OTHER = "77777777-7777-7777-8777-777777777777";
const cite = (over: Partial<EvidenceCitation> = {}): EvidenceCitation => ({
  fileId: FILE,
  fileName: "ticket.pdf",
  quote: "Account Disabled Yes",
  found: true,
  location: "",
  page: 1,
  box: null,
  label: "",
  ...over,
});
const box = (x: number, y: number) => ({ x, y, w: 0.2, h: 0.05 });

describe("a citation folded into an annotation (item 4a, evidence integrity)", () => {
  const annotation = {
    quote: "Account Disabled Yes",
    page: 2,
    rects: [box(0.1, 0.5)],
  };

  it("is folded only where file, page and words agree", () => {
    // The same words on another page are another passage: kept as a cited mark.
    assert.deepEqual(
      citedMarks([cite({ page: 1 })], FILE, [annotation]).map((m) => m.id),
      ["cited-0"],
    );
    // On the annotation's page, or naming no page, it is the annotation's box.
    assert.deepEqual(citedMarks([cite({ page: 2 })], FILE, [annotation]), []);
    assert.deepEqual(
      citedMarks([cite({ page: null })], FILE, [annotation]),
      [],
    );
    // Other words, or another file, never fold.
    assert.equal(
      citedMarks([cite({ page: 2, quote: "Disabled On" })], FILE, [annotation])
        .length,
      1,
    );
    assert.equal(
      citedMarks([cite({ page: 2, fileId: OTHER })], FILE, [annotation]).length,
      1,
    );
  });

  it("on an image, only where its own box overlaps the annotation's", () => {
    const image = {
      quote: "Account Disabled Yes",
      page: 1,
      rects: [box(0.1, 0.5)],
    };
    const at = (b: ReturnType<typeof box> | null) =>
      citedMarks([cite({ page: null, box: b })], FILE, [image], true).length;
    assert.equal(at(box(0.15, 0.52)), 0, "overlapping: the annotation's box");
    assert.equal(at(box(0.6, 0.1)), 1, "elsewhere on the image: its own mark");
    assert.equal(at(null), 1, "no box of its own: its own mark");
  });

  it("numbers what is kept after the annotations, once folded", () => {
    const marks = citedMarks(
      [cite({ page: 2 }), cite({ page: 1 }), cite({ quote: "x y z" })],
      FILE,
      [annotation],
    );
    assert.deepEqual(
      marks.map((m) => [m.id, m.number]),
      [
        ["cited-1", 2],
        ["cited-2", 3],
      ],
    );
  });

  it("counts a file's citations in the switcher after the fold", () => {
    has(
      opener,
      'id === file.id ? citedMarks( marked, file.id, notes.set?.annotations ?? [], previewKind(file.fileName) === "image", ).filter((mark) => mark.fileId === id).length : marked.filter((item) => item.fileId === id).length;',
    );
    has(viewer, 'citedMarks(steady, file.id, annotations, kind === "image")');
  });

  it("never puts the focus on a review action of a mark it was opened on", () => {
    const hook = component(viewer, "useCalloutFocus");
    assert.match(hook, /asked \? "\[data-heading\]" : "\[data-first\]"/);
    // The callout's heading takes it, for an annotation and for a cited passage.
    assert.equal(
      viewer.match(
        /<h3 className="ea-statement" tabIndex=\{-1\} data-heading>/g,
      )?.length,
      2,
    );
    has(component(viewer, "Basis"), "asked && !asking,");
    has(
      component(viewer, "CitedBasis"),
      "useCalloutFocus<HTMLDivElement>(mark.id, quiet, asked)",
    );
    // "Confirm & next" is the first action, and the one a heading's focus never is.
    assert.match(
      component(viewer, "ReviewActions"),
      /data-first\s+disabled=\{waiting\}\s+onClick=\{onConfirm\}/,
    );
    // Enter does not confirm an annotation the viewer was opened on, until the person
    // selects it or confirms one; Confirm itself still needs the server's answer.
    assert.match(
      viewer,
      /selected !== null &&\s*!asked &&\s*set\.canEdit &&\s*selected\.status === "PROPOSED"/,
    );
    assert.match(
      viewer,
      /if \(result\?\.ok\) \{\s*setSelectedId\(next \?\? annotation\.id\);[^}]*setAsked\(false\);/,
    );
  });
});

describe("cited and annotated passages in a file's text (item 4b)", () => {
  it("knows which passage each marked part is", () => {
    const parts = markParts("Lockout 0, max age 180, history 5", [
      "history 5",
      "Lockout 0",
    ]);
    assert.deepEqual(
      parts.filter((part) => part.mark).map((part) => [part.text, part.at]),
      [
        ["Lockout 0", 1],
        ["history 5", 0],
      ],
    );
    assert.ok(
      parts.filter((part) => !part.mark).every((part) => part.at === -1),
    );
  });

  it("marks each by its kind, the cited one dashed in --mark-cited, rows the same", () => {
    has(stages, 'export type PassageKind = "annotated" | "cited";');
    has(stages, 'kindAt(part.at) === "cited" ? "is-cited" : ""');
    has(
      viewer,
      '...annotations.map(() => "annotated" as const), ...citedHere.map(() => "cited" as const),',
    );
    assert.match(
      globals,
      /\.text-stage mark\.is-cited \{\s*background: transparent;\s*outline: 2px dashed var\(--mark-cited\);\s*\}/,
    );
    assert.match(
      globals,
      /\.text-table tr\.is-cited \{\s*outline: 2px dashed var\(--mark-cited\);\s*outline-offset: -2px;\s*\}/,
    );
    // An annotated row keeps the highlight it had.
    assert.match(
      globals,
      /\.text-table tr\.is-annotated td \{\s*background: var\(--highlight\);/,
    );
  });
});

describe("why a cited passage has no box (item 4c)", () => {
  const marks = (found: boolean[]) =>
    citedMarks(
      found.map((each, at) =>
        cite({ page: null, found: each, quote: `w${at} a b` }),
      ),
      FILE,
      [],
    );
  it("says it in the file's own terms", () => {
    const one = marks([true]);
    assert.equal(
      citedUnboxedLine(one, null, citedPageMarks(one, null), "image"),
      "1 cited passage is listed beside the file without a box: it was found in the file's text and could not be boxed on the image.",
    );
    const unread = marks([false, false]);
    assert.equal(
      citedUnboxedLine(unread, null, citedPageMarks(unread, null), "image"),
      "2 cited passages are listed beside the file without a box: their words were not found in the file's text.",
    );
    const mixed = marks([true, false]);
    assert.equal(
      citedUnboxedLine(mixed, null, citedPageMarks(mixed, null), "image"),
      "1 cited passage is listed beside the file without a box: it was found in the file's text and could not be boxed on the image. 1 cited passage is listed beside the file without a box: its words were not found in the file's text.",
    );
    // A PDF's page keeps its sentence.
    assert.match(
      citedUnboxedLine(one, null, citedPageMarks(one, null), "pdf") ?? "",
      /its words were not found on this page\.$/,
    );
    has(viewer, "citedUnboxedLine(cited, page, citedOn, shownKind)");
  });
});

describe("the callout's place and stepping (items 4d, 4e)", () => {
  it("counts an annotation among the annotations, a citation among the citations", () => {
    has(viewer, "at={positionWords(annotations, selected.id)}");
    has(viewer, "at={positionWords(reachable, selectedCited.id)}");
    has(viewer, "previous={stepTo(reachable, selectedCited.id, -1) !== null}");
  });

  it("steps through the cited passages into the dialog's other files, and offers no line it cannot open", () => {
    const step = viewer.slice(
      viewer.indexOf("function step(direction: 1 | -1) {"),
    );
    assert.match(
      step,
      /if \(selectedCited !== null\) \{\s*const next = stepTo\(reachable, selectedCited\.id, direction\);\s*const mark = reachable\.find\(\(each\) => each\.id === next\);\s*if \(mark !== undefined\) \{\s*choose\(mark\);/,
    );
    has(
      viewer,
      "const reachable = cited.filter((mark) => opens(mark.fileId));",
    );
    has(viewer, "disabled={elsewhere && !opens(mark.fileId)}");
    has(
      viewer,
      "fileId === file.id || (onOpenFile !== undefined && (openable === undefined || openable.includes(fileId)));",
    );
    has(opener, "openable={files.map((item) => item.id)}");
  });
});

describe("dead code removed (item 4f)", () => {
  it("leaves no unused rule, class, route helper or export", () => {
    assert.ok(!globals.includes(".preview-note"));
    assert.ok(!/has-tools/.test(stages));
    assert.ok(
      !/readingUrl/.test(read("apps/web/src/design-workpaper-model.ts")),
    );
    assert.ok(!/export (const CITED_PREFIX|function isCitedId)/.test(model));
    assert.ok(!/isCitedId/.test(model));
  });
});

describe("About this file", () => {
  it("is a real tablist beside the legend: Annotations first, About this file second", () => {
    assert.match(
      viewer,
      /const PANEL_TABS: ReadonlyArray<readonly \[PanelTab, string\]> = \[\s*\["annotations", "Annotations"\],\s*\["about", "About this file"\],\s*\];/,
    );
    for (const written of [
      'role="tablist"',
      'role="tab"',
      "aria-selected={shownTab === key}",
      `aria-controls={\`\${"tabsId"}-\${"key"}-panel\`}`.replace(/"/g, ""),
      "tabIndex={shownTab === key ? 0 : -1}",
      'role="tabpanel"',
      'hidden={shownTab !== "annotations"}',
      'hidden={withPanel && shownTab !== "about"}',
      "onKeyDown={onTabKey}",
    ]) {
      has(viewer, written);
    }
    const keys = viewer.slice(viewer.indexOf("const onTabKey = "));
    for (const key of ['"ArrowRight"', '"ArrowLeft"', '"Home"', '"End"']) {
      assert.ok(keys.slice(0, 900).includes(key), key);
    }
    // The viewer's own arrows are not heard on the tabs or inside the tab.
    has(viewer, '[role="tablist"], .ea-about, .ea-data');
    // With nothing in the legend, the tab is the panel by itself.
    has(viewer, 'const shownTab: PanelTab = withPanel ? tab : "about";');
  });

  it("opens on Annotations unless the opener asked for the file's details", () => {
    has(viewer, 'startTab = "annotations",');
    has(opener, 'startTab = "annotations",');
    has(opener, "const [tab, setTab] = useState<PanelTab>(startTab);");
    has(
      about,
      'startTab={open.tab ?? (open.pick === true ? "about" : "annotations")}',
    );
    has(
      list,
      'openFile(act.fileId, undefined, { tab: "about", ...(act.kind === "PICK_INSTANCE" ? { pick: true } : {}), });',
    );
  });

  it("is not shown where nothing about the file applies", () => {
    has(about, "aboutApplies(context, fileId) ? (place) => ( <AboutThisFile");
    has(component(about, "aboutApplies"), ") !== null");
    has(opener, "const aboutTab = about?.(file.id) ?? null;");
    // And a section with nothing to say is not drawn.
    for (const name of ["PopulationChecks", "Samples", "Instance"]) {
      assert.match(component(about, name), /return null;/, name);
    }
  });

  it("keeps each action's own call, and says it is done only after the server", () => {
    const hook = component(about, "useDialogAction");
    assert.match(
      hook,
      /fetch\("\/workspace\/evidence-dialog", \{\s*method: "POST"/,
    );
    assert.match(
      hook,
      /if \(status === 200\) \{\s*\/\/[^\n]*\n\s*startTransition\(\(\) => router\.refresh\(\)\);\s*return true;/,
    );
    const file = component(about, "useFileAbout");
    for (const intent of [
      '"confirm-kind"',
      '"reanalyze"',
      '"pick-instance"',
      '"propose-samples"',
      '"approve-samples"',
      '"link"',
      '"sufficiency"',
    ]) {
      assert.ok(file.includes(`intent: ${intent}`), intent);
    }
    // Confirming the type: a person's submit, closed only once the server confirmed it.
    has(
      component(about, "Classification"),
      "if (next !== undefined && (await about.confirm(next))) { setChangingKind(false); }",
    );
    has(
      component(about, "Classification"),
      '<button type="submit" className="btn btn-sm"> Confirm the type </button>',
    );
    // Picking the instance: the row a person chose, said only once the server recorded it.
    assert.match(file, /const ok = await dialog\.run\("pick", \{/);
    has(
      component(about, "FileData"),
      "if (await about.pickRow(row)) { onPicked?.(row); }",
    );
    // Withdrawing: the existing form, and the screen told only once it is withdrawn.
    // Changed 18 November 2026 (E1, product owner). Old: one "Remove from this request"
    // that opened the withdrawal ('setWithdrawing(false)'), and a refusal said in the
    // notice's canned words ('setProblem(CHANGE_NOTICES[notice])'). New: "Remove from
    // this request" takes the file off that request only (RemoveForm), "Withdraw from the
    // engagement…" is its own action, last; both tell the screen only once the server
    // confirmed, and a refusal is said in the server's own sentence (changeProblem).
    has(component(about, "WithdrawForm"), 'start="withdraw"');
    has(component(about, "RemoveForm"), 'start="remove"');
    assert.equal(
      squash(component(about, "AboutThisFile")).split(
        "onDone={(message) => { setChanging(null); context.onWithdrawn?.(message); }}",
      ).length,
      3,
    );
    const change = read("apps/web/src/evidence-change.tsx");
    // Changed again 18 November 2026 (E1 design review). Old: a refusal set the red line
    // at once. New: a refusal with the server's sentence reads the impact again first
    // (refusedWith), so a reliance shows once, as the held box; confirmed only after.
    assert.match(
      change,
      /if \(answer\.notice !== "withdrawn"\) \{\s*if \(answer\.detail\.trim\(\) !== ""\) \{\s*refusedWith\(changeProblem\(answer\.notice, answer\.detail\)\);\s*\} else \{\s*setProblem\(changeProblem\(answer\.notice, answer\.detail\)\);\s*\}\s*return;\s*\}\s*confirmed\(/,
    );
    // The removal is the association's own route, never a withdrawal.
    assert.match(
      change,
      /fetch\(\s*`\/workspace\/evidence-files\/\$\{fileId\}\/remove-from-request`/,
    );
    // The findings keep their own actions, the reading its history.
    has(
      component(about, "FileFindings"),
      "findingsAction={about.findingsAction}",
    );
    has(
      component(about, "AboutThisFile"),
      "<Details insight={insight} ids={context.ids} canAct={context.canAct} />",
    );
    // The list is read again in place after an action: no page reload anywhere here.
    assert.ok(!/location\.reload|window\.location/.test(about));
  });

  it("puts a passage it names in view on the file, the focus staying in the tab", () => {
    has(
      viewer,
      "show: (citation) => { setFromAbout(true); onShowPassage?.(citation); },",
    );
    has(viewer, "quiet={(inline || fromAbout) && asked}");
    has(opener, "setShown(citation); setShownPick({ quote: citation.quote });");
    has(
      opener,
      "const pick = shownPick ?? annotationPick ?? askedPick ?? citedPick;",
    );
  });

  it("shows a population's rows in place of the file to pick the instance from", () => {
    has(
      viewer,
      '<div className="ea-data" ref={setDataHost} hidden={!dataShown} />',
    );
    has(viewer, "stage: dataHost, onStage: setDataShown,");
    has(component(about, "AboutThisFile"), "createPortal(");
    has(component(about, "AboutThisFile"), "Back to the file");
    has(
      component(about, "FileData"),
      "picking={!compact && about.picking && about.canPick}",
    );
  });
});

describe("the reviewer's review mode is retired", () => {
  const sources = readdirSync("apps/web/src")
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => `apps/web/src/${name}`);

  it("is opened by no screen, and the dialog only adds evidence", () => {
    has(
      dialog,
      'export type DialogOpen = { mode: "add"; itemId: string | null };',
    );
    assert.ok(!/mode === "review"|mode: "review"/.test(dialog));
    for (const path of sources) {
      const source = read(path);
      if (/from "\.\/evidence-dialog"/.test(source)) {
        assert.ok(!/mode: "review"/.test(source), path);
      }
    }
    // Each former opener opens the viewer: the D&I list and the OE requests list.
    for (const source of [list, requests]) {
      has(source, "<FileViewer");
      has(source, "fileOpenFor(plan, intelligence.focusFile)");
    }
    has(requests, "onView({ fileId: file.fileId, files: filesOf(item),");
    // Upload keeps its own dialog.
    has(list, "<EvidenceDialog");
    has(requests, "<EvidenceDialog");
    has(dialog, 'title="Add evidence"');
    has(dialog, "<RequestUpload");
  });

  it("keeps the reviewer's content, moved into the tab", () => {
    for (const name of [
      "Classification",
      "PopulationChecks",
      "Samples",
      "Instance",
      "FileFindings",
      "FileData",
      "WithdrawForm",
    ]) {
      assert.match(about, new RegExp(`export function ${name}\\b`), name);
    }
    for (const written of [
      "Detected file type",
      "Why it was classified this way",
      "What the agent suggests",
      "Remove from this request",
      "Read again",
      "Findings and coverage",
      "History",
      "Serves",
    ]) {
      assert.ok(about.includes(written), written);
    }
  });
});

describe("opening a file writes nothing (item 4g)", () => {
  it("makes no call but a read until a person acts", () => {
    // The opener and the stages read only.
    assert.ok(!/fetch\(/.test(opener));
    for (const call of stages.match(/fetch\([^)]*\)/g) ?? []) {
      assert.match(call, /fetch\(url, \{ cache: "no-store" \}\)/);
    }
    assert.ok(!/method:/.test(stages));
    // "About this file" writes through one helper, which nothing runs on its own.
    assert.equal(about.match(/fetch\(/g)?.length, 1);
    assert.equal(about.match(/method: "POST"/g)?.length, 1);
    const effects = [
      ...about.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[/g),
    ].map((match) => match[1] ?? "");
    assert.ok(effects.length >= 2);
    for (const body of effects) {
      assert.ok(
        !/run\(|act\(|confirm\(|reread\(|pickRow\(|fetch\(/.test(body),
        body,
      );
    }
    // Every write is behind a person's click or submit.
    const file = component(about, "useFileAbout");
    assert.equal(file.match(/dialog\.run\(/g)?.length, 5);
    assert.equal(file.match(/plan\$\.run\(/g)?.length, 2);
  });
});

describe("the tab's styles", () => {
  it("use tokens only, and stop their motion under reduced motion", () => {
    const from = css.indexOf("/* The side panel's two tabs (section 5b)");
    const block = css.slice(
      from,
      css.indexOf("/* While the annotations are read"),
    );
    assert.ok(block.length > 500);
    assert.ok(!/#[0-9a-f]{3,6}\b|rgb\(/i.test(block));
    assert.match(
      css,
      /button\.ea-tab,\s*\.ea-about-more > summary::after \{\s*transition: none;/,
    );
    assert.match(block, /\.ea-tabpanel\[hidden\] \{\s*display: none;/);
    assert.match(block, /\.ea-data\[hidden\] \{\s*display: none;/);
  });
});
