"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { Count } from "./attribute-tickmark";
import {
  CONSIDER_LABEL,
  CONSIDERED,
  consideredLine,
  considerRequest,
  POINT_ROUTES,
  type Point,
  type PointIntent,
  pointAnchor,
  pointField,
  reasonProblem as pointReasonProblem,
  pointRefusal,
  pointRereads,
  RAISED_SINCE,
  REASON_MAX,
  REASON_MIN,
  RECORD,
  RECORDED_READING,
  SETTLE_WORDS,
  settleHref,
  settleWhere,
  THE_POINT,
  WITHDRAW,
  WITHDRAWN_READING,
  withdrawRequest,
  YOUR_DECISION,
} from "./design-points-model";
import { NoteField } from "./review-notes";

/**
 * A point of the D&I workpaper at its place (docs/design-workpaper.md, section 3.9): the
 * row the document draws under an attribute, a report, a file's line or the head of
 * section 5, with its one form ("Considered…", a reason in place) and its two writes
 * (consider, withdraw) through the page's own routes. The document view only places it;
 * the form and the writes are here, as the sign-off's are in preparer-signoff.tsx.
 */

/** What the row's writes need: the ids, the workpaper version the views read, whether a
 * write waits for a read, the D&I Evidence step's link, and what the page does once the
 * server answered (it reads the workpaper again). */
export type PointWrites = {
  scope: { organizationId: string; projectId: string; controlId: string };
  version: number;
  held: boolean;
  evidenceHref: string | null;
  /** The Attributes step, where an ASSUMPTION point's assumption is confirmed or changed
   * (B1l point 6); absent or null where the page has no link to it. */
  attributesHref?: string | null;
  onSettled: () => void;
};

/** One of the points' writes: an answer that cannot be read, or none, is status 0, and
 * nothing is taken as done. */
async function postPoint(
  intent: PointIntent,
  body: Record<string, unknown>,
): Promise<{ status: number; detail: string }> {
  try {
    const response = await fetch(POINT_ROUTES[intent], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = (await response.json()) as {
      status?: unknown;
      detail?: unknown;
    };
    return {
      status: typeof answer.status === "number" ? answer.status : 0,
      detail: typeof answer.detail === "string" ? answer.detail : "",
    };
  } catch {
    return { status: 0, detail: "" };
  }
}

/**
 * One point at its place. For the preparer, while it is not settled: "Your decision."
 * with its sentence and references, the way to each of its own actions (done in the D&I
 * Evidence step, where the request's check, its files and its findings are: no such action
 * is on the workpaper's page), and "Considered…", which opens a reason box in place. Raised after the
 * preparer signed: the same sentence, for everyone, "Raised since the preparer signed".
 * Considered: one quiet line for everyone and on paper, the point's sentence on request,
 * and "Withdraw" for the preparer on the draft. Never the word "open".
 *
 * A write shows as done only once the server confirms it, in a status, and nothing is
 * pressed again until the views read again show it; a refusal is the server's sentence
 * (role="alert", which takes the focus), and an answer that leaves the page in doubt
 * reads the workpaper again.
 */
export function PointRow({
  point,
  shown,
  canSettle,
  writes,
  printed,
  refs,
}: {
  point: Point;
  shown: "considered" | "decide" | "raised" | "hidden";
  /** The server's word that the viewer may consider or withdraw now. */
  canSettle: boolean;
  /** The writes; null on paper, and where the page has no workpaper to write to. */
  writes: PointWrites | null;
  /** The printed copy: no anchor, nothing to press, the point's words under its line. */
  printed: boolean;
  /** The point's references, as the view draws them (chips, or text on paper). */
  refs: ReactNode;
}) {
  const uid = useId();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [submits, setSubmits] = useState(0);
  const [sending, setSending] = useState<PointIntent | null>(null);
  const [confirmed, setConfirmed] = useState<PointIntent | null>(null);
  const [refusal, setRefusal] = useState("");
  const [told, setTold] = useState(false);
  const busy = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  // The read that shows a confirmed write: what was said before it no longer holds, and
  // the focus goes to the point's place, whose line has changed.
  const standing = point.considered?.id ?? "";
  const seen = useRef(standing);
  useEffect(() => {
    if (seen.current === standing) {
      return;
    }
    seen.current = standing;
    setConfirmed(null);
    setRefusal("");
    setAsking(false);
    setReason("");
    window.requestAnimationFrame(() => box.current?.focus());
  }, [standing]);

  const write = async (intent: PointIntent) => {
    if (busy.current || confirmed !== null || writes === null || writes.held) {
      return;
    }
    const body =
      intent === "consider"
        ? considerRequest(
            writes.scope,
            point.key,
            reason.trim(),
            writes.version,
          )
        : point.considered === null
          ? null
          : withdrawRequest(
              writes.scope,
              point.key,
              point.considered.id,
              writes.version,
            );
    if (body === null) {
      return;
    }
    busy.current = true;
    setSending(intent);
    setRefusal("");
    const answer = await postPoint(intent, body);
    busy.current = false;
    setSending(null);
    const said = pointRefusal(intent, answer.status, answer.detail);
    if (said !== "") {
      setRefusal(said);
      window.requestAnimationFrame(() => alert.current?.focus());
      if (pointRereads(answer.status)) {
        writes.onSettled();
      }
      return;
    }
    // Confirmed: said at once, and held until the workpaper read again shows it.
    setConfirmed(intent);
    writes.onSettled();
  };

  const reading = (
    <p className="ps-status" role="status">
      {confirmed === "consider"
        ? RECORDED_READING
        : confirmed === "withdraw"
          ? WITHDRAWN_READING
          : ""}
    </p>
  );
  const refused =
    refusal !== "" ? (
      <p className="ps-refusal" role="alert" tabIndex={-1} ref={alert}>
        {refusal}
      </p>
    ) : null;
  const anchor = printed ? undefined : pointAnchor(point.key);

  if (shown === "considered" && point.considered !== null) {
    const considered = point.considered;
    const mayWithdraw = writes !== null && canSettle;
    return (
      <div
        className="dw-point is-considered"
        id={anchor}
        ref={box}
        tabIndex={-1}
      >
        <p className="dw-point-line">
          <NoteField
            field={pointField(point.key)}
            text={consideredLine(considered)}
            inline
          />
          {!printed ? (
            <>
              {" "}
              <button
                type="button"
                className="dw-link dw-point-more"
                aria-expanded={told}
                aria-controls={`${uid}-said`}
                onClick={() => setTold((now) => !now)}
              >
                {THE_POINT}
              </button>
            </>
          ) : null}
          {mayWithdraw && confirmed === null ? (
            <>
              <span className="dw-point-sep" aria-hidden="true">
                {" · "}
              </span>
              <button
                type="button"
                className="dw-link"
                aria-disabled={sending !== null || writes.held}
                onClick={() => void write("withdraw")}
              >
                {sending === "withdraw" ? "Withdrawing…" : WITHDRAW}
                <span className="sr-only"> the consideration</span>
              </button>
            </>
          ) : null}
        </p>
        {told || printed ? (
          <p className="dw-point-said" id={`${uid}-said`}>
            {point.text} {refs}
          </p>
        ) : null}
        {reading}
        {refused}
      </div>
    );
  }

  if (shown === "raised") {
    return (
      <div className="dw-point is-raised" id={anchor} ref={box} tabIndex={-1}>
        <p className="dw-point-line">
          <b>{RAISED_SINCE}</b> {point.text} {refs}
        </p>
      </div>
    );
  }

  if (shown !== "decide") {
    return null;
  }
  const problem = pointReasonProblem(reason);
  const own = point.settle.filter(
    (action): action is Exclude<typeof action, "CONSIDER"> =>
      action !== "CONSIDER",
  );
  const links = {
    evidenceHref: writes?.evidenceHref ?? null,
    attributesHref: writes?.attributesHref ?? null,
  };
  return (
    <div className="dw-point is-decide" id={anchor} ref={box} tabIndex={-1}>
      <p className="dw-point-line">
        <b>{YOUR_DECISION}</b> {point.text} {refs}
      </p>
      {!asking && confirmed === null ? (
        <p className="dw-point-acts">
          {own.map((action) => {
            // Done in the D&I Evidence step, where the request's check, its files and its
            // findings are, or, for an assumption, on its attribute in the Attributes step
            // (B1l point 6): none of these actions is on the workpaper's page.
            const href = settleHref(action, links, point.place);
            return href !== null ? (
              <Link
                key={action}
                className="btn btn-secondary btn-sm"
                href={href}
              >
                {SETTLE_WORDS[action]}
                <span className="sr-only"> {settleWhere(action)}</span>
              </Link>
            ) : null;
          })}
          <button
            ref={opener}
            type="button"
            className="btn-secondary btn-sm"
            disabled={writes === null}
            onClick={() => {
              setAsking(true);
              setRefusal("");
              window.requestAnimationFrame(() =>
                document.getElementById(`${uid}-why`)?.focus(),
              );
            }}
          >
            {CONSIDERED}
          </button>
        </p>
      ) : null}
      {asking && confirmed === null ? (
        <form
          autoComplete="off"
          className="ps-form dw-point-form"
          aria-busy={sending !== null}
          onSubmit={(event) => {
            event.preventDefault();
            setSubmits((n) => n + 1);
            if (problem === null) {
              void write("consider");
            }
          }}
        >
          <label htmlFor={`${uid}-why`}>{CONSIDER_LABEL}</label>
          <textarea
            id={`${uid}-why`}
            rows={2}
            minLength={REASON_MIN}
            maxLength={REASON_MAX}
            value={reason}
            disabled={sending !== null}
            aria-describedby={`${uid}-count`}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
          <div className="ps-actions">
            <Count
              id={`${uid}-count`}
              used={reason.trim().length}
              max={REASON_MAX}
              submits={submits}
            />
            <button
              type="button"
              className="dw-link"
              disabled={sending !== null}
              onClick={() => {
                setAsking(false);
                setReason("");
                setRefusal("");
                window.requestAnimationFrame(() => opener.current?.focus());
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="dw-ink btn-sm"
              aria-disabled={
                problem !== null || sending !== null || writes?.held === true
              }
            >
              {sending === "consider" ? "Recording…" : RECORD}
            </button>
          </div>
          {writes?.held === true ? (
            <small className="ps-hint">Reading the workpaper again…</small>
          ) : null}
        </form>
      ) : null}
      {reading}
      {refused}
    </div>
  );
}
