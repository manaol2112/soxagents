"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef } from "react";

import { type AddedSystem, openSelectControls } from "./system-added-model";
import { UiIcon } from "./ui-icon";

/**
 * Said once a system is added (the product owner's reference, 27 October 2026): the
 * system is in scope, and its controls can be selected now or later. Map controls opens
 * Select controls on it in place, or the Controls page filtered to it where the page has
 * no Select controls; Not now, the close button and Escape stay here.
 */
export function SystemAddedDialog({
  system,
  mapHref,
  onClose,
}: {
  system: AddedSystem;
  mapHref: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const primary = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    primary.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="as-backdrop" role="presentation">
      <section
        className="sa"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-lead`}
      >
        <header className="sa-head">
          <p className="sa-badge">System created</p>
          <h2 id={`${id}-title`}>System added successfully</h2>
          <p id={`${id}-lead`}>
            Your new system is in scope. Would you like to select its controls
            now?
          </p>
          <button
            type="button"
            className="btn-ghost btn-sm sa-close"
            onClick={onClose}
            aria-label="Close"
          >
            <UiIcon name="x" size={16} />
          </button>
        </header>
        <div className="sa-body">
          <div className="sa-card">
            <span className="sa-icon">
              <UiIcon name="database" size={20} />
            </span>
            <span className="sa-card-text">
              <small>New system</small>
              <span className="sa-name">
                <strong>{system.name}</strong>
                <span className="pill tone-success sa-pill">In scope</span>
              </span>
            </span>
          </div>
          <div className="sa-card is-next">
            <span className="sa-icon">
              <UiIcon name="shield" size={20} />
            </span>
            <span className="sa-card-text">
              <strong>Connect controls to this system</strong>
              <span>
                Select controls from the library or add your own to establish
                the system's control coverage and support audit scoping.
              </span>
            </span>
          </div>
          <p className="sa-note">
            <UiIcon name="info" size={15} />
            <span>You can select its controls later on the Controls page.</span>
          </p>
        </div>
        <footer className="sa-foot">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Not now
          </button>
          <button
            ref={primary}
            type="button"
            onClick={() => {
              // Select controls opens here when the page has it; else the Controls page.
              if (!openSelectControls(document, system.id)) {
                router.push(mapHref);
              }
              onClose();
            }}
          >
            Map controls
            <UiIcon name="arrow" size={15} />
          </button>
        </footer>
      </section>
    </div>
  );
}
