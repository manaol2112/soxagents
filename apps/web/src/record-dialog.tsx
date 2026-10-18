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

import { UiIcon } from "./ui-icon";

/**
 * A record opened over the page (Milestone 8.17), as a template preview is: the page
 * underneath stays where it was, and closing (the close button, Escape, or a click
 * outside) returns to it without reloading or scrolling. The record itself is rendered
 * on the server and passed in.
 */
export function RecordDialog({
  eyebrow,
  title,
  description,
  closeHref,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  closeHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDivElement>(null);
  const [pending, startTransition] = useTransition();
  const [mounted, setMounted] = useState(false);

  const close = useCallback(() => {
    startTransition(() => {
      router.replace(closeHref, { scroll: false });
    });
  }, [router, closeHref]);

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
      // A confirmation open inside the record closes first, on its own.
      if (
        event.key === "Escape" &&
        document.querySelector("dialog[open]") === null
      ) {
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
      className="preview-backdrop record-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          close();
        }
      }}
    >
      <div
        ref={dialog}
        className="record-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="record-dialog-title"
        aria-busy={pending}
        tabIndex={-1}
      >
        <header className="rd-head">
          <div className="rd-head-text">
            <p className="rd-eyebrow">{eyebrow}</p>
            <h2 id="record-dialog-title">{title}</h2>
            {description ? <p className="rd-desc">{description}</p> : null}
          </div>
          <button
            type="button"
            className="btn-ghost btn-sm rd-close"
            onClick={close}
            aria-label="Close"
          >
            <UiIcon name="x" size={16} />
          </button>
        </header>
        <div className="rd-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
