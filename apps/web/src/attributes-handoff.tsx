"use client";

import Link from "next/link";
import type { Handoff } from "./attributes-handoff-model";
import { UiIcon } from "./ui-icon";

/**
 * The Attributes step once every attribute is settled: one card with what was settled, by
 * whom, what comes next, and the one way on (product owner, 17 November 2026: "keep the
 * attributes design and just update this section"; the earlier banner and next-step card
 * said it in two places). A coverage gap is the one exception said under it.
 */
export function AttributesHandoff({
  handoff,
  stepHrefs,
}: {
  handoff: Handoff;
  stepHrefs: Readonly<Record<string, string>>;
}) {
  return (
    <div className="ah">
      <section className="ah-done" aria-labelledby="ah-done-title">
        <span className="ah-tick" aria-hidden="true">
          <UiIcon name="check" size={15} />
        </span>
        <div className="ah-done-text">
          <strong id="ah-done-title">{handoff.title}</strong>
          <span>{handoff.line}</span>
        </div>
        <Link
          className="btn btn-primary"
          href={stepHrefs[handoff.next.key] ?? "#"}
          scroll={false}
        >
          {handoff.next.label}
          <UiIcon name="arrow" size={14} />
        </Link>
      </section>
      {handoff.gap !== "" ? (
        <p className="ah-coverage is-gap">
          <UiIcon name="risk" size={13} />
          <span>{handoff.gap}</span>
        </p>
      ) : null}
    </div>
  );
}
