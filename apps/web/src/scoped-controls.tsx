import Link from "next/link";
import type { ReactNode } from "react";

import {
  FREQUENCIES,
  kindForDomain,
  NATURES,
  type SetupControl,
} from "./onboarding-model";

/** A control's kind as a short label and a tone, for the type column. */
function kindOf(control: SetupControl): { label: string; tone: string } {
  switch (kindForDomain(control.domain)) {
    case "ITGC":
      return { label: "ITGC", tone: "is-itgc" };
    case "ITAC":
      return { label: "Application", tone: "is-itac" };
    case "KEY_REPORT":
      return { label: "Key report", tone: "is-ipe" };
    default:
      return {
        label: control.domainLabel || "Business process",
        tone: "is-bp",
      };
  }
}

/** The standard words for a frequency or nature; the client's own term when it has one. */
function labelled(
  own: string,
  key: string,
  list: ReadonlyArray<[string, string]>,
): string {
  if (own !== "") {
    return own;
  }
  return list.find(([value]) => value === key)?.[1] ?? key;
}

/**
 * Controls in scope, as a table (Milestone 8.17): the control's ID, its title and owner
 * (which open it), its type, how often and how it operates, and an action. Shared by the
 * system and process views of the Controls and systems step.
 */
export function ScopedControlTable({
  title,
  titleId,
  controls,
  empty,
  hrefFor,
  action,
  showType = true,
}: {
  title: string;
  titleId: string;
  controls: readonly SetupControl[];
  empty: string;
  hrefFor: (control: SetupControl) => string;
  action?: ((control: SetupControl) => ReactNode) | null;
  showType?: boolean;
}) {
  return (
    <section className="ctl-block" aria-labelledby={titleId}>
      <header className="ctl-block-head">
        <h4 id={titleId}>{title}</h4>
        <span className="ctl-count">
          {controls.length} control{controls.length === 1 ? "" : "s"}
        </span>
      </header>
      {controls.length === 0 ? (
        empty === "" ? null : (
          <p className="ctl-empty">{empty}</p>
        )
      ) : (
        <div className="ctl-table-wrap">
          <table className="ctl-table">
            <thead>
              <tr>
                <th scope="col" className="ctl-ref-col">
                  ID
                </th>
                <th scope="col">Control</th>
                {showType ? <th scope="col">Type</th> : null}
                <th scope="col">Operation</th>
                {action ? (
                  <th scope="col" className="ctl-action-col">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {controls.map((control) => {
                const kind = kindOf(control);
                return (
                  <tr key={control.id}>
                    <td className="ctl-ref-col">
                      <span className="ctl-ref">{control.controlRef}</span>
                    </td>
                    <td className="ctl-main">
                      {/* Opens the control over the page, which stays where it is. */}
                      <Link
                        className="ctl-link"
                        href={hrefFor(control)}
                        scroll={false}
                      >
                        {control.title}
                      </Link>
                      <span className="ctl-sub">
                        {control.keyControl ? (
                          <span className="ctl-key">Key</span>
                        ) : (
                          <span className="ctl-nonkey">Non-key</span>
                        )}
                        {control.ownerName !== "" ? (
                          <span>{control.ownerName}</span>
                        ) : (
                          <span className="ctl-unowned">No owner yet</span>
                        )}
                      </span>
                    </td>
                    {showType ? (
                      <td data-label="Type">
                        <span className={`ctl-type ${kind.tone}`}>
                          {kind.label}
                        </span>
                      </td>
                    ) : null}
                    <td className="ctl-op" data-label="Operation">
                      <span className="ctl-op-text">
                        <span>
                          {labelled(
                            control.frequencyLabel,
                            control.frequency,
                            FREQUENCIES,
                          )}
                        </span>
                        <small>
                          {labelled(
                            control.natureLabel,
                            control.nature,
                            NATURES,
                          )}
                        </small>
                      </span>
                    </td>
                    {action ? (
                      <td className="ctl-action-col">{action(control)}</td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** What taking a control out of scope does, said before it is done. */
export function removalNote(
  control: SetupControl,
  where: string,
  started: boolean,
): string {
  return started
    ? `${control.controlRef} will no longer be tested for ${where}. Its open work is cancelled and any evidence request not yet sent is withdrawn. Testing, workpapers, and requests already sent stay on record, and you can bring it back into scope later.`
    : `${control.controlRef} will no longer be tested for ${where}. You can bring it back into scope at any time before or after launch.`;
}
