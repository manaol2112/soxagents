// Focus mode for a control's workflow step (product owner, 16 November 2026: focus mode,
// option A): the step strip's pills, the folded notes' strip, the remembered preference,
// the shortcut, and how the panel, the shell and the notes are wired to them.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  FOCUS_KEY,
  FOCUS_NARROW,
  focusCrumbOf,
  focusToggleOf,
  inTextBox,
  isFocusShortcut,
  MAX_NOTE_DOTS,
  notesStripOf,
  rememberedFocus,
  rememberFocus,
  type ShortcutPress,
  stepStripOf,
} from "../apps/web/src/step-focus-model.ts";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const STEPS = [
  { key: "setup", number: 1, title: "RCM / Control Setup", tone: "done" },
  {
    key: "understanding",
    number: 2,
    title: "Control Understanding",
    tone: "done",
  },
  { key: "attributes", number: 3, title: "Attributes", tone: "active" },
  {
    key: "designassessment",
    number: 5,
    title: "D&I Assessment",
    tone: "attention",
  },
  { key: "rollforward", number: 9, title: "Roll-forward", tone: "skipped" },
];
const HREFS = Object.fromEntries(
  STEPS.map((step) => [step.key, `/workspace?control=c1&step=${step.key}`]),
);

describe("the step strip", () => {
  it("is one pill per step, in order, each with the arrows' address", () => {
    const pills = stepStripOf(STEPS, "designassessment", HREFS);
    assert.deepEqual(
      pills.map((pill) => pill.key),
      STEPS.map((step) => step.key),
    );
    assert.deepEqual(
      pills.map((pill) => pill.href),
      STEPS.map((step) => HREFS[step.key]),
    );
  });

  it("ticks a done step, numbers the rest, and marks the open one current", () => {
    const pills = stepStripOf(STEPS, "designassessment", HREFS);
    assert.deepEqual(
      pills.map((pill) => [pill.mark, pill.state]),
      [
        ["check", "done"],
        ["check", "done"],
        ["3", "todo"],
        ["5", "current"],
        ["9", "skipped"],
      ],
    );
    assert.equal(pills.filter((pill) => pill.state === "current").length, 1);
  });

  it("names each pill for a screen reader, with where it stands", () => {
    const pills = stepStripOf(STEPS, "setup", HREFS);
    assert.equal(
      pills[0]?.label,
      "Step 1, RCM / Control Setup, done, open now",
    );
    assert.equal(pills[1]?.label, "Step 2, Control Understanding, done");
    assert.equal(pills[2]?.label, "Step 3, Attributes, not done");
    assert.equal(pills[4]?.label, "Step 9, Roll-forward, not performed");
  });

  it("has no current pill for the activity, and leaves out a step with no address", () => {
    const pills = stepStripOf(STEPS, null, { ...HREFS, attributes: undefined });
    assert.equal(
      pills.some((pill) => pill.state === "current"),
      false,
    );
    assert.equal(
      pills.some((pill) => pill.key === "attributes"),
      false,
    );
    assert.equal(pills.length, STEPS.length - 1);
  });
});

describe("the control's name before the step", () => {
  it("is the reference and the title, either alone where the other is missing", () => {
    assert.equal(
      focusCrumbOf({
        ref: "ITGC-AC-01",
        title: "User Access Provisioning and Approval",
      }),
      "ITGC-AC-01 · User Access Provisioning and Approval",
    );
    assert.equal(focusCrumbOf({ ref: " ", title: "Access" }), "Access");
    assert.equal(focusCrumbOf({ ref: "ITGC-AC-01", title: "" }), "ITGC-AC-01");
  });
});

describe("the remembered preference", () => {
  it("is off until it is chosen, and kept under aw.step-focus", () => {
    assert.equal(FOCUS_KEY, "aw.step-focus");
    const kept = new Map<string, string>();
    const store = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    };
    assert.equal(
      rememberedFocus(() => store),
      false,
    );
    rememberFocus(() => store, true);
    assert.equal(kept.get(FOCUS_KEY), "on");
    assert.equal(
      rememberedFocus(() => store),
      true,
    );
    rememberFocus(() => store, false);
    assert.equal(
      rememberedFocus(() => store),
      false,
    );
  });

  it("is off where the browser refuses, and a refused write is no failure", () => {
    const refusing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    assert.equal(
      rememberedFocus(() => refusing),
      false,
    );
    assert.doesNotThrow(() => rememberFocus(() => refusing, true));
    assert.equal(
      rememberedFocus(() => {
        throw new Error("no localStorage");
      }),
      false,
    );
    assert.equal(
      rememberedFocus(() => null),
      false,
    );
    assert.equal(
      rememberedFocus(() => ({ getItem: () => "garbage" })),
      false,
    );
  });
});

describe("the toggle and its shortcut", () => {
  it("is named for what it does, with the shortcut in its tooltip", () => {
    assert.deepEqual(focusToggleOf(false), {
      label: "Expand to full width",
      tip: "Expand to full width (Shift+F)",
    });
    assert.deepEqual(focusToggleOf(true), {
      label: "Exit full width",
      tip: "Exit full width (Shift+F)",
    });
  });

  const press = (over: Partial<ShortcutPress>): ShortcutPress => ({
    key: "F",
    shiftKey: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    defaultPrevented: false,
    target: { tagName: "BODY", editable: false },
    ...over,
  });

  it("is Shift+F outside a text box, and never Escape", () => {
    assert.equal(isFocusShortcut(press({})), true);
    assert.equal(isFocusShortcut(press({ target: null })), true);
    assert.equal(
      isFocusShortcut(
        press({ target: { tagName: "BUTTON", editable: false } }),
      ),
      true,
    );
    assert.equal(isFocusShortcut(press({ key: "Escape" })), false);
    assert.equal(
      isFocusShortcut(press({ key: "Escape", shiftKey: false })),
      false,
    );
    assert.equal(isFocusShortcut(press({ shiftKey: false, key: "f" })), false);
  });

  it("is not taken with another modifier, held down, or already handled", () => {
    assert.equal(isFocusShortcut(press({ metaKey: true })), false);
    assert.equal(isFocusShortcut(press({ ctrlKey: true })), false);
    assert.equal(isFocusShortcut(press({ altKey: true })), false);
    assert.equal(isFocusShortcut(press({ repeat: true })), false);
    assert.equal(isFocusShortcut(press({ defaultPrevented: true })), false);
  });

  it("is left to an editor, a field or a list box", () => {
    for (const target of [
      { tagName: "TEXTAREA", editable: false },
      { tagName: "SELECT", editable: false },
      { tagName: "INPUT", type: "text", editable: false },
      { tagName: "INPUT", type: "search", editable: false },
      { tagName: "INPUT", editable: false },
      { tagName: "DIV", editable: true },
    ]) {
      assert.equal(inTextBox(target), true, JSON.stringify(target));
      assert.equal(isFocusShortcut(press({ target })), false);
    }
    assert.equal(
      inTextBox({ tagName: "INPUT", type: "checkbox", editable: false }),
      false,
    );
  });
});

describe("the folded notes' strip", () => {
  it("counts the open notes and draws one dot each, the urgent first", () => {
    const strip = notesStripOf([
      { status: "OPEN", criticality: "NORMAL" },
      { status: "RESPONDED", criticality: "URGENT" },
      { status: "CLEARED", criticality: "URGENT" },
      { status: "DISMISSED", criticality: "NORMAL" },
      { status: "OPEN", criticality: "FOLLOW_UP" },
      { status: "OPEN", criticality: "SOMETHING_NEW" },
    ]);
    assert.equal(strip.open, 4);
    assert.deepEqual(strip.dots, [
      "urgent",
      "normal",
      "follow-up",
      "follow-up",
    ]);
    assert.equal(strip.more, 0);
    assert.equal(strip.label, "Review notes, 4 open notes, 1 urgent");
  });

  it("never draws an unknown criticality as urgent, and caps the dots", () => {
    const many = Array.from({ length: MAX_NOTE_DOTS + 3 }, () => ({
      status: "OPEN",
      criticality: "OTHER",
    }));
    const strip = notesStripOf(many);
    assert.equal(strip.dots.length, MAX_NOTE_DOTS);
    assert.equal(strip.dots.includes("urgent"), false);
    assert.equal(strip.more, 3);
    assert.equal(notesStripOf([]).label, "Review notes, no open notes");
    assert.equal(
      notesStripOf([{ status: "OPEN", criticality: "NORMAL" }]).label,
      "Review notes, 1 open note",
    );
  });
});

describe("wired into the panel, the shell and the notes", () => {
  const panel = read("apps/web/src/control-workflow.tsx");
  const state = read("apps/web/src/step-focus.tsx");
  const css = read("apps/web/app/control-workflow.css");
  const notes = read("apps/web/src/design-workpaper-view.tsx");
  const notesCss = read("apps/web/app/review-notes.css");
  const controls = read("apps/web/src/controls-view.tsx");

  it("the toggle sits with the arrows, only where the panel is not already full width", () => {
    assert.match(
      panel,
      /\{wide \? <FocusToggle on=\{chosen\} ghost=\{minimal\} \/> : null\}/,
    );
    assert.match(panel, /aria-keyshortcuts="Shift\+F"/);
    assert.equal(FOCUS_NARROW, "(max-width: 1100px)");
    assert.match(
      css,
      /@media \(max-width: 1100px\) \{\s*\.wf-strip \{\s*display: block;/,
    );
  });

  it("the choice is client state kept in the browser, never in the address", () => {
    assert.match(state, /rememberFocus\(\(\) => window\.localStorage, on\);/);
    assert.match(state, /rememberedFocus\(\(\) => window\.localStorage\)/);
    assert.doesNotMatch(state, /router|searchParams|history\.|location\./);
    assert.doesNotMatch(panel, /[?&]focus=|searchParams/);
  });

  it("Escape still closes the panel and never toggles focus", () => {
    assert.match(
      panel,
      /event\.key === "Escape"[\s\S]{0,400}router\.push\(closeHref/,
    );
    assert.doesNotMatch(panel, /Escape[^\n]*setStepFocus/);
  });

  it("the step strip and the control's name come from the panel's own steps and addresses", () => {
    assert.match(
      controls,
      /strip=\{\{ steps: workflow, hrefs: stepHrefsWf \}\}/,
    );
    assert.match(
      controls,
      /control=\{\{ ref: control\.controlRef, title: control\.title \}\}/,
    );
    assert.match(panel, /stepStripOf\(strip\.steps, step, strip\.hrefs\)/);
    assert.match(
      panel,
      /aria-current=\{pill\.state === "current" \? "step" : undefined\}/,
    );
  });

  it("the navigation folds to its icons only in focus, on a wide screen, never in print", () => {
    assert.match(
      css,
      /@media screen and \(min-width: 1101px\) \{[\s\S]*:root\[data-step-focus\] \.shell \{\s*grid-template-columns: var\(--focus-rail\) minmax\(0, 1fr\);/,
    );
    assert.match(panel, /root\.dataset\.stepFocus = "";/);
    // The names stay readable to assistive technology: clipped, not removed.
    assert.match(
      css,
      /:is\(\.brand-text, \.nav-label\) \{\s*position: absolute;[\s\S]{0,120}clip-path: inset\(50%\);/,
    );
  });

  it("the width animates 200 ms only when toggled, and not under reduced motion", () => {
    assert.match(
      css,
      /:root\[data-step-focus-moving\] \.wf-panel \{\s*transition: width 200ms ease;/,
    );
    assert.match(
      css,
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*:root\[data-step-focus-moving\] \.wf-panel,\s*:root\[data-step-focus-moving\] \.shell,[\s\S]{0,80}transition: none;/,
    );
  });

  it("the work is centred at a readable width in focus", () => {
    assert.match(
      css,
      /\.wf-panel\.is-focus \.wf-panel-body > \* \{\s*max-width: 1100px;\s*margin-inline: auto;/,
    );
  });

  it("the notes fold to a strip in the side column in focus, and open beside the document", () => {
    assert.match(
      notes,
      /const railOn = railChoice \?\? \(!notesAside && openNotes > 0\);/,
    );
    assert.match(notes, /const railBeside = railOn && !notesAside;/);
    assert.match(notes, /createPortal\(\s*<div className=\{`rn-side/);
    assert.match(
      notes,
      /<NotesStrip\s+open=\{railOn\}\s+onToggle=\{\(\) => setRailChoice\(!railOn\)\}/,
    );
    assert.match(
      notesCss,
      /\.rn-side > \.rn-rail \{\s*position: static;\s*width: 340px;/,
    );
  });
});
