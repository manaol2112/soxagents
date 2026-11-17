"use client";

import { useEffect, useState } from "react";

import { initials } from "./format";
import {
  parseWaitingReviews,
  reminderWords,
  type WaitingReview,
  waitingCountLabel,
  waitingCountOf,
  waitingHref,
  waitingLine,
} from "./review-request-model";
import { UiIcon } from "./ui-icon";

const DAY = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const day = (value: string) => {
  const time = Date.parse(value);
  return Number.isNaN(time) ? value : DAY.format(time);
};

type Read =
  | { state: "loading" }
  | { state: "ready"; items: WaitingReview[] }
  | { state: "failed" };

/**
 * Home's "Waiting for your review" (docs/design-workpaper.md, section 3.8): one line per
 * D&I workpaper sent to the viewer for review, with who sent it, when, and the conclusion
 * (or the urgent notes that hold it), each opening the control's D&I Assessment at
 * section 6, where it is signed off or returned. One read through the page's JSON route,
 * stopped if the page goes; nothing here acts. Quiet when nothing waits: the card is not
 * drawn at all, so a person who reviews nothing never sees it.
 */
export function ReviewWaiting({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const [read, setRead] = useState<Read>({ state: "loading" });
  useEffect(() => {
    const control = new AbortController();
    let current = true;
    const query = new URLSearchParams({
      organization_id: organizationId,
      project_id: projectId,
    });
    (async () => {
      let next: Read = { state: "failed" };
      try {
        const response = await fetch(`/workspace/review-requests?${query}`, {
          cache: "no-store",
          signal: control.signal,
        });
        const body = (await response.json()) as {
          status?: unknown;
          result?: unknown;
        };
        if (body.status === 200) {
          const items = parseWaitingReviews(body.result);
          next =
            items === null ? { state: "failed" } : { state: "ready", items };
        } else if (body.status === 403 || body.status === 404) {
          // Not a reviewer here, or the list is not offered: nothing waits for them.
          next = { state: "ready", items: [] };
        }
      } catch {
        next = { state: "failed" };
      }
      if (current) {
        setRead(next);
      }
    })();
    return () => {
      current = false;
      control.abort();
    };
  }, [organizationId, projectId]);

  if (read.state === "loading") {
    return null;
  }
  if (read.state === "failed") {
    return (
      <p className="home-review-failed" role="status">
        Your review list could not be read. Refresh the page to try again.
      </p>
    );
  }
  if (read.items.length === 0) {
    return null;
  }
  return (
    <section
      className="card home-review"
      aria-labelledby="home-review-title"
      id="review-waiting"
    >
      <header className="card-header">
        <div>
          <h2 id="home-review-title">Waiting for your review</h2>
        </div>
        <span className="count">{read.items.length}</span>
      </header>
      <ul className="home-steps home-review-list">
        {read.items.map((item) => (
          <li key={item.id} className="home-step home-review-item">
            <span className="home-review-avatar" aria-hidden="true">
              {item.from === "" ? "?" : initials(item.from)}
            </span>
            <span className="home-step-copy">
              <strong>
                {item.reference !== "" ? (
                  <span className="home-review-ref">{item.reference}</span>
                ) : null}
                <span className="home-review-title">
                  {item.title || "Untitled control"} · D&amp;I
                </span>
              </strong>
              <small>
                {/* The urgent notes in place of the conclusion, in the one colour
                    that says they hold the sign-off; the preparer's last reminder
                    after them. */}
                {item.urgent > 0 ? (
                  <>
                    {waitingLine(
                      { ...item, urgent: 0, conclusion: "", remindedAt: null },
                      day,
                    )}
                    <span className="is-held">
                      {" · "}
                      {item.urgent} urgent{" "}
                      {item.urgent === 1 ? "note" : "notes"}
                    </span>
                    {item.remindedAt !== null
                      ? ` · ${reminderWords(item.remindedAt, day)}`
                      : null}
                  </>
                ) : (
                  waitingLine(item, day)
                )}
              </small>
            </span>
            <a
              className="btn btn-sm btn-secondary"
              href={waitingHref(item, organizationId, projectId)}
              aria-label={`Open the D&I review of ${item.reference || item.title || "the control"}`}
            >
              Open
              <UiIcon name="arrow" size={13} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The count in the navigation (section 3.8): how many D&I workpapers wait for the
 * viewer's review, the server's `count` of GET …/review-requests/mine, beside Home. One
 * read through the page's JSON route, stopped if the page goes; nothing is drawn while it
 * reads, where it cannot be read, or where nothing waits.
 */
export function ReviewNavCount({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const control = new AbortController();
    let current = true;
    const query = new URLSearchParams({
      organization_id: organizationId,
      project_id: projectId,
    });
    (async () => {
      let next: number | null = null;
      try {
        const response = await fetch(`/workspace/review-requests?${query}`, {
          cache: "no-store",
          signal: control.signal,
        });
        const body = (await response.json()) as {
          status?: unknown;
          result?: unknown;
        };
        next = body.status === 200 ? waitingCountOf(body.result) : null;
      } catch {
        next = null;
      }
      if (current) {
        setCount(next);
      }
    })();
    return () => {
      current = false;
      control.abort();
    };
  }, [organizationId, projectId]);
  if (count === null || count <= 0) {
    return null;
  }
  return (
    <span
      className="nav-badge nav-badge-review"
      role="status"
      aria-label={waitingCountLabel(count)}
      title={waitingCountLabel(count)}
    >
      {count}
    </span>
  );
}
