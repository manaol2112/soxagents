"use client";

import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { createPortal } from "react-dom";

import { SheetTabBar } from "./sheet-tabs";
import { UiIcon } from "./ui-icon";

export type PreviewChoice = {
  id: string;
  label: string;
  href: string;
};

export type PreviewPanel = {
  key: string;
  title: string;
  reference: string;
  content: ReactNode;
};

type Props = {
  title: string;
  closeHref: string;
  choices: readonly PreviewChoice[];
  current: string;
  /** The workbook's tabs, shown like a spreadsheet's sheet tabs. */
  panels: readonly PreviewPanel[];
};

/**
 * A workpaper template preview over the page, laid out like a workbook: the open tab's
 * sections above, the sheet tabs along the bottom. The workpaper itself is rendered on
 * the server; this opens it as a dialog, switches tabs, swaps the sample control, and
 * closes it, all without scrolling or reloading the page underneath.
 */
export function TemplatePreviewDialog({
  title,
  closeHref,
  choices,
  current,
  panels,
}: Props) {
  const router = useRouter();
  const dialog = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLElement>(null);
  const [pending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(panels[0]?.key ?? "");
  const shown = panels.find((panel) => panel.key === active) ?? panels[0];

  const go = useCallback(
    (href: string) => {
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    },
    [router],
  );
  const close = useCallback(() => go(closeHref), [go, closeHref]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("has-dialog");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("has-dialog");
      previous?.focus();
    };
  }, [close, mounted]);

  if (!mounted) {
    return null;
  }
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the backdrop closes; Escape and the close button do too.
    <div
      className="preview-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div
        ref={dialog}
        className="preview-dialog template-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Preview ${title}`}
        aria-busy={pending}
        tabIndex={-1}
      >
        <header className="preview-head">
          <div>
            <p className="page-context">
              Template preview. Results are never filled in here.
            </p>
            <h2 title={title}>{title}</h2>
          </div>
          <label className="template-preview-control">
            <span>Control</span>
            <select
              aria-label="Control shown in the preview"
              value={current}
              disabled={pending}
              onChange={(event) => {
                const choice = choices.find(
                  (item) => item.id === event.target.value,
                );
                if (choice !== undefined) {
                  go(choice.href);
                }
              }}
            >
              {choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-ghost btn-sm preview-close"
            onClick={close}
            aria-label="Close preview"
          >
            <UiIcon name="x" size={16} />
          </button>
        </header>
        <div className="preview-body workbook">
          <section
            ref={stage}
            className={`preview-stage ${pending ? "is-loading" : ""}`}
            aria-label={
              shown === undefined
                ? "Workpaper"
                : `Workpaper ${shown.reference}: ${shown.title}`
            }
          >
            {shown?.content}
          </section>
          <SheetTabBar
            tabs={panels.map((panel) => ({
              key: panel.key,
              title: panel.title,
              note: panel.reference,
              tone: "is-reference",
            }))}
            active={shown?.key ?? ""}
            onSelect={(key) => {
              setActive(key);
              stage.current?.scrollTo(0, 0);
            }}
            label="Workpaper tabs"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
