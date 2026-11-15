"use client";

import { closeHistory } from "@tiptap/pm/history";
import {
  type Editor,
  EditorContent,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { RichText } from "./rich-text";
import { type DocNode, docFromText, textFromDoc } from "./rich-text-model";
import { UiIcon } from "./ui-icon";

/**
 * A text section's box, with its formatting seen as it is typed (docs/design-workpaper.md,
 * section 3.3): bold, italic, underline, a bulleted and a numbered list, a line break,
 * undo and redo. What the box holds, to its owner, is always the section's stored text
 * (plain text with marks, rich-text-model.ts): never HTML. Nothing typed or pasted is
 * kept as anything but text in those formats.
 */

/** The kit, with everything a workpaper's text does not have switched off: a section's
 * structure is the workpaper's own. What is left is the document, paragraphs, text, line
 * breaks, bold, italic, underline, the two lists, their keys, and undo and redo. */
const EXTENSIONS = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    dropcursor: false,
    gapcursor: false,
    heading: false,
    horizontalRule: false,
    link: false,
    strike: false,
    trailingNode: false,
  }),
];

/** The editor's document as the text that is stored. */
const written = (editor: Editor) => textFromDoc(editor.getJSON() as DocNode);

const MARKS = ["bold", "italic", "underline"] as const;
const LISTS = ["bulletList", "orderedList"] as const;

/** Whether "Clear formatting" would change anything where the selection is. */
function clearable(editor: Editor): boolean {
  if ([...MARKS, ...LISTS].some((name) => editor.isActive(name))) {
    return true;
  }
  const { doc, selection } = editor.state;
  if (selection.empty) {
    return false;
  }
  let found = false;
  doc.nodesBetween(selection.from, selection.to, (node) => {
    found =
      found ||
      node.marks.length > 0 ||
      LISTS.some((name) => node.type.name === name);
    return !found;
  });
  return found;
}

type Tool = {
  /** The button's accessible name. */
  name: string;
  /** What a pointer reads over it: the name, and its keys where it has them. */
  title: string;
  keys?: string;
  face: ReactNode;
  /** Whether the selection has it; undefined for what is not switched on and off. */
  pressed?: boolean;
  enabled: boolean;
  /** The first of a group: the groups stand a little apart. */
  first?: boolean;
  run: (editor: Editor) => void;
};

/** A letter drawn as the format it gives: the product has no icon for these. */
const letter = (glyph: string, kind: string) => (
  <span className={`se-glyph is-${kind}`} aria-hidden="true">
    {glyph}
  </span>
);

/** The formatting bar. It is drawn anew once the editor is made, so what it reads of the
 * editor is the editor's own from its first drawing. */
function Tools({
  editor,
  readOnly,
}: {
  editor: Editor | null;
  readOnly: boolean;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: now }) =>
      now === null
        ? null
        : {
            bold: now.isActive("bold"),
            italic: now.isActive("italic"),
            underline: now.isActive("underline"),
            bullets: now.isActive("bulletList"),
            numbers: now.isActive("orderedList"),
            undo: now.can().undo(),
            redo: now.can().redo(),
            clear: clearable(now),
          },
  });
  const on = state !== null && !readOnly;
  const tools: Tool[] = [
    {
      name: "Bold",
      title: "Bold (Ctrl/⌘+B)",
      keys: "Control+B Meta+B",
      face: letter("B", "bold"),
      pressed: state?.bold ?? false,
      enabled: on,
      run: (now) => now.chain().focus().toggleBold().run(),
    },
    {
      name: "Italic",
      title: "Italic (Ctrl/⌘+I)",
      keys: "Control+I Meta+I",
      face: letter("I", "italic"),
      pressed: state?.italic ?? false,
      enabled: on,
      run: (now) => now.chain().focus().toggleItalic().run(),
    },
    {
      name: "Underline",
      title: "Underline (Ctrl/⌘+U)",
      keys: "Control+U Meta+U",
      face: letter("U", "underline"),
      pressed: state?.underline ?? false,
      enabled: on,
      run: (now) => now.chain().focus().toggleUnderline().run(),
    },
    {
      name: "Bulleted list",
      title: "Bulleted list",
      face: <UiIcon name="list" size={15} />,
      pressed: state?.bullets ?? false,
      enabled: on,
      first: true,
      run: (now) => now.chain().focus().toggleBulletList().run(),
    },
    {
      name: "Numbered list",
      title: "Numbered list",
      face: letter("1.", "number"),
      pressed: state?.numbers ?? false,
      enabled: on,
      run: (now) => now.chain().focus().toggleOrderedList().run(),
    },
    {
      name: "Undo",
      title: "Undo (Ctrl/⌘+Z)",
      keys: "Control+Z Meta+Z",
      face: "Undo",
      enabled: on && state.undo,
      first: true,
      run: (now) => now.chain().focus().undo().run(),
    },
    {
      name: "Redo",
      title: "Redo (Ctrl/⌘+Shift+Z)",
      keys: "Control+Shift+Z Meta+Shift+Z",
      face: "Redo",
      enabled: on && state.redo,
      run: (now) => now.chain().focus().redo().run(),
    },
    {
      name: "Clear formatting",
      title: "Clear formatting",
      face: "Clear formatting",
      enabled: on && state.clear,
      first: true,
      run: (now) =>
        now
          .chain()
          .focus()
          .unsetAllMarks()
          .clearNodes()
          // With nothing selected, what is typed next is plain too.
          .command(({ tr }) => {
            if (tr.selection.empty) {
              tr.setStoredMarks([]);
            }
            return true;
          })
          .run(),
    },
  ];

  // The tools in their groups, each with its place in the whole row.
  const groups: Array<Array<{ tool: Tool; at: number }>> = [];
  tools.forEach((tool, at) => {
    if (tool.first === true || groups.length === 0) {
      groups.push([]);
    }
    groups[groups.length - 1]?.push({ tool, at });
  });

  // The toolbar is one stop for the Tab key; the arrow keys move inside it.
  const [stop, setStop] = useState(0);
  const reachable = tools[stop]?.enabled
    ? stop
    : tools.findIndex((tool) => tool.enabled);
  const bar = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [
      ...(bar.current?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? []),
    ];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const last = buttons.length - 1;
    const to =
      at < 0
        ? -1
        : event.key === "ArrowRight"
          ? at === last
            ? 0
            : at + 1
          : event.key === "ArrowLeft"
            ? at === 0
              ? last
              : at - 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? last
                : -1;
    if (to < 0) {
      return;
    }
    event.preventDefault();
    buttons[to]?.focus();
  };
  return (
    <div
      ref={bar}
      className="se-tools"
      role="toolbar"
      aria-label="Formatting"
      onKeyDown={move}
    >
      {groups.map((group) => (
        <span className="se-tool-group" key={group[0]?.tool.name}>
          {group.map(({ tool, at }) => (
            <button
              key={tool.name}
              type="button"
              className="se-tool"
              aria-label={tool.name}
              aria-pressed={tool.pressed}
              aria-keyshortcuts={tool.keys}
              title={tool.title}
              tabIndex={at === reachable ? 0 : -1}
              disabled={!tool.enabled}
              // The press does not take the selection from the text.
              onMouseDown={(event) => event.preventDefault()}
              onFocus={() => setStop(at)}
              onClick={() => {
                if (editor !== null && tool.enabled) {
                  tool.run(editor);
                }
              }}
            >
              {tool.face}
            </button>
          ))}
        </span>
      ))}
    </div>
  );
}

export function RichTextBox({
  value,
  label,
  describedBy,
  readOnly,
  onChange,
}: {
  /** The section's text as stored, marks included. */
  value: string;
  /** The box's accessible name. */
  label: string;
  describedBy?: string | undefined;
  readOnly: boolean;
  /** What is typed, as the text that is stored. */
  onChange: (value: string) => void;
}) {
  const [start] = useState(() => {
    const doc = docFromText(value);
    return { doc, value, written: textFromDoc(doc) };
  });
  // What the box holds, as its owner knows it: the text it was last given, or last said.
  const held = useRef(start.value);
  // The text the box was given, and the same as the editor writes it back: a document
  // brought back to it is that text again, so undoing everything is no change.
  const given = useRef({ value: start.value, written: start.written });
  const editorProps = useMemo(
    () => ({
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        "aria-readonly": readOnly ? "true" : "false",
        ...(describedBy === undefined
          ? {}
          : { "aria-describedby": describedBy }),
        class: "se-text se-rich",
      },
    }),
    [label, describedBy, readOnly],
  );
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: start.doc,
    editable: !readOnly,
    // Under the server's rendering there is no editor yet: it is made in the browser.
    immediatelyRender: false,
    // The box's styles are the product's own stylesheet's; no style element is added.
    injectCSS: false,
    // What is typed or pasted as marks ("**x**", "- x") stays what was typed.
    enableInputRules: false,
    enablePasteRules: false,
    editorProps,
    onUpdate: ({ editor: changed }) => {
      const text = written(changed);
      const next = text === given.current.written ? given.current.value : text;
      if (next !== held.current) {
        held.current = next;
        onChange(next);
      }
    },
  });

  // Read-only while a save is out, before another key can land.
  useLayoutEffect(() => {
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);

  // The owner put another text in the box (a restore, a reset): the box takes it and says
  // nothing of it; it is one step of its own to undo. The text the box itself just said
  // is never put back, so the caret stays where it is while a person types.
  useLayoutEffect(() => {
    if (editor === null || value === held.current) {
      return;
    }
    held.current = value;
    const doc = docFromText(value);
    const text = textFromDoc(doc);
    given.current = { value, written: text };
    if (written(editor) !== text) {
      editor
        .chain()
        .command(({ tr }) => {
          closeHistory(tr);
          return true;
        })
        .setContent(doc, { emitUpdate: false })
        .run();
    }
  }, [editor, value]);

  // Until the editor is made the text stands in its place, as it reads. The focus it was
  // given then is passed on to the editor, unless the person has moved it since: on the
  // next frame, once the editor's own element has settled in the page (in development
  // React takes it out and puts it back, and the focus would go with it).
  const asked = useRef(false);
  useEffect(() => {
    if (editor === null || !asked.current) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      asked.current = false;
      const active = document.activeElement;
      if (
        !editor.isDestroyed &&
        (active === null || active === document.body)
      ) {
        editor.view.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editor]);

  // Tab leaves the box, as it leaves any other: the keyboard is never held in it, and a
  // list is not put inside a list (the stored text has no such thing).
  const leave = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key === "Tab" &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.stopPropagation();
    }
  };

  return (
    <div className="se-rich-box">
      <Tools
        key={editor === null ? "waiting" : "made"}
        editor={editor}
        readOnly={readOnly}
      />
      {editor === null ? (
        // biome-ignore lint/a11y/useSemanticElements: the text as it reads, in the box's place, until the editor is made.
        <div
          className="se-text se-rich"
          role="textbox"
          aria-multiline="true"
          aria-readonly="true"
          aria-label={label}
          aria-describedby={describedBy}
          tabIndex={0}
          onFocus={() => {
            asked.current = true;
          }}
        >
          <RichText text={value} />
        </div>
      ) : (
        <EditorContent editor={editor} onKeyDownCapture={leave} />
      )}
    </div>
  );
}
