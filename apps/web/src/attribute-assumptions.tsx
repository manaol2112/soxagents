"use client";

import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  ASSUMPTION_TEXT_MAX,
  type Assumption,
  assumptionProblem,
  assumptionTextProblem,
  type ControlContext,
  type CriteriaVersion,
  parseContext,
  parseCriteriaHistory,
} from "./control-context-model";
import {
  ASSUMED_LEAD,
  characterCount,
  decidedAssumptions,
  decidedLine,
  openAssumptions,
  previousCriteriaLabel,
  updatedFromLine,
  versionLine,
} from "./understanding-once-model";
import {
  CONFLICT_LEAD,
  CONFLICT_STANDS,
  NOT_KNOWN_LEAD,
} from "./understanding-specialist-model";

type Ids = { organizationId: string; projectId: string; controlId: string };

/**
 * A gap an agent found after the understanding was complete, stated on the attribute it
 * bears on (docs/control-workflow-plan.md, B1j; product owner, 16 November 2026: "On the
 * attribute"). "That's right" records it as the person's confirmed fact; "Change…" records the
 * person's own words and starts one update of the attributes it names. Each shows as done only
 * once the server has recorded it, and the context it answers with is shown at once, in place;
 * the page's data then refreshes without a reload. An assumption is the agent's until a person
 * decides it: accepted with the attribute is never worded as anyone's answer.
 */
export function AttributeAssumptions({
  ids,
  items,
  canAct,
  locked,
  onContext,
  label,
}: {
  ids: Ids;
  items: readonly Assumption[] | undefined;
  canAct: boolean;
  /** The agents are updating the attributes: nothing is decided meanwhile (the server
   * refuses it too). */
  locked: boolean;
  /** The context the server answered with, shown until the page's data catches up. */
  onContext: (context: ControlContext) => void;
  /** What the list is about, for assistive technology. */
  label: string;
}) {
  const open = openAssumptions(items);
  const decided = decidedAssumptions(items);
  if (open.length === 0 && decided.length === 0) {
    return null;
  }
  return (
    <ul className="tas-list" aria-label={label}>
      {open.map((item) => (
        <OpenAssumption
          key={item.id}
          ids={ids}
          item={item}
          canAct={canAct}
          locked={locked}
          onContext={onContext}
        />
      ))}
      {decided.map((item) => (
        <li key={item.id} className="tas-done">
          <span suppressHydrationWarning>{decidedLine(item)}</span>
        </li>
      ))}
    </ul>
  );
}

function OpenAssumption({
  ids,
  item,
  canAct,
  locked,
  onContext,
}: {
  ids: Ids;
  item: Assumption;
  canAct: boolean;
  locked: boolean;
  onContext: (context: ControlContext) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const boxId = useId();
  const [changing, setChanging] = useState(false);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState<"" | "confirm" | "change">("");
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (changing) {
      box.current?.focus();
    }
  }, [changing]);
  const wordsProblem = assumptionTextProblem(words);

  async function send(intent: "assumption-confirm" | "assumption-change") {
    setBusy(intent === "assumption-confirm" ? "confirm" : "change");
    setProblem(null);
    let status = 0;
    let detail = "";
    let context: ControlContext | null = null;
    try {
      const response = await fetch("/workspace/control-context", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          intent,
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          assumption_id: item.id,
          version: item.version,
          ...(intent === "assumption-change" ? { text: words.trim() } : {}),
        }),
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
        context?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
      context = status === 200 ? parseContext(body.context) : null;
    } catch {
      status = 0;
    }
    setBusy("");
    // Done only once the server has recorded it, with the context it answered.
    const message =
      status === 200 && context === null
        ? "That was recorded, but the page could not read the answer. Refresh to see it."
        : assumptionProblem(status, detail);
    setProblem(message);
    if (context !== null) {
      onContext(context);
    }
    if (status === 200) {
      startTransition(() => router.refresh());
    }
  }

  // B1l: a conflict with a confirmed fact holds the attribute until a person decides it, and
  // a question left as not known in Control Understanding says so; each is decided with the
  // same two choices.
  const conflict = item.kind === "CONFLICT";
  return (
    <li className={`tas-open${conflict ? " is-conflict" : ""}`}>
      {conflict ? <p className="tas-kicker">{CONFLICT_LEAD}</p> : null}
      <p className="tas-assumed">
        {conflict ? null : (
          <strong>
            {item.kind === "NOT_KNOWN" ? NOT_KNOWN_LEAD : ASSUMED_LEAD}
          </strong>
        )}{" "}
        {item.assumed}
      </p>
      {canAct && !changing ? (
        <div className="tas-acts">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={locked || busy !== ""}
            onClick={() => void send("assumption-confirm")}
          >
            {busy === "confirm"
              ? "Recording…"
              : conflict
                ? CONFLICT_STANDS
                : "That's right"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={locked || busy !== ""}
            aria-expanded={false}
            onClick={() => {
              setProblem(null);
              setChanging(true);
            }}
          >
            Change…
          </button>
        </div>
      ) : null}
      {canAct && changing ? (
        <form
          className="tas-change"
          id={boxId}
          autoComplete="off"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            if (wordsProblem === null) {
              void send("assumption-change");
            }
          }}
        >
          <label htmlFor={`${boxId}-words`}>
            What is the case
            {item.matter.trim() !== "" ? ` on ${item.matter.trim()}` : ""}?
          </label>
          <textarea
            id={`${boxId}-words`}
            ref={box}
            rows={3}
            maxLength={ASSUMPTION_TEXT_MAX}
            value={words}
            disabled={busy !== ""}
            aria-describedby={`${boxId}-count`}
            onChange={(event) => setWords(event.target.value)}
          />
          <p className="tas-count" id={`${boxId}-count`}>
            {characterCount(words, ASSUMPTION_TEXT_MAX)}
            {words.trim() !== "" && wordsProblem !== null
              ? ` · ${wordsProblem}`
              : ""}
          </p>
          <p className="tas-note">
            Your words are recorded as your answer, and the attributes this
            assumption names are updated from them.
          </p>
          <div className="tas-acts">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={locked || busy !== "" || wordsProblem !== null}
            >
              {busy === "change" ? "Saving…" : "Save the change"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy !== ""}
              onClick={() => {
                setChanging(false);
                setProblem(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
      {problem !== null ? (
        <p className="tc-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Where an attribute's criteria last changed from an answer or an assumption, and its earlier
 * criteria (B1j: every change keeps the previous criteria), read only when opened. An answer
 * that lands after a newer one, or after the fold closed, is not shown.
 */
export function CriteriaTrail({
  ids,
  attributeId,
  updatedFrom,
  versions,
}: {
  ids: Ids;
  attributeId: string;
  updatedFrom: string | undefined;
  versions: number | undefined;
}) {
  const from = updatedFromLine(updatedFrom);
  const fold = previousCriteriaLabel(versions);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<
    | { count: number; versions: CriteriaVersion[] }
    | { count: number; failed: true }
    | null
  >(null);
  const reads = useRef(0);
  const count = versions ?? 0;
  const loaded = history !== null && history.count === count;
  useEffect(() => {
    if (!open || loaded) {
      return;
    }
    reads.current += 1;
    const mine = reads.current;
    const params = new URLSearchParams({
      intent: "criteria-history",
      organization_id: ids.organizationId,
      project_id: ids.projectId,
      control_id: ids.controlId,
      attribute_id: attributeId,
      v: String(count),
    });
    void fetch(`/workspace/control-context?${params.toString()}`, {
      cache: "no-store",
    })
      .then((response) => response.json())
      .then((body: { status?: unknown; history?: unknown }) => {
        if (mine !== reads.current) {
          return;
        }
        const read =
          body.status === 200 ? parseCriteriaHistory(body.history) : null;
        setHistory(
          read === null ? { count, failed: true } : { count, versions: read },
        );
      })
      .catch(() => {
        if (mine === reads.current) {
          setHistory({ count, failed: true });
        }
      });
  }, [open, loaded, ids, attributeId, count]);
  // A read still on its way when the fold closes is not shown.
  useEffect(() => {
    if (!open) {
      reads.current += 1;
    }
  }, [open]);
  if (from === null && fold === null) {
    return null;
  }
  return (
    <div className="tas-trail">
      <p className="tas-meta">
        {from !== null ? <span>{from}</span> : null}
        {from !== null && fold !== null ? (
          <span aria-hidden="true"> · </span>
        ) : null}
        {fold !== null ? (
          <button
            type="button"
            className="tas-link"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((was) => !was)}
          >
            {fold}
          </button>
        ) : null}
      </p>
      {open ? (
        <div className="tas-history" id={listId}>
          {!loaded ? (
            <p className="tas-reading" role="status">
              Reading the earlier criteria…
            </p>
          ) : "failed" in history ? (
            <p className="tc-problem" role="alert">
              The earlier criteria could not be read.{" "}
              <button
                type="button"
                className="tas-link"
                onClick={() => setHistory(null)}
              >
                Try again
              </button>
            </p>
          ) : history.versions.length === 0 ? (
            <p className="tas-reading">No earlier criteria are kept.</p>
          ) : (
            <ol className="tas-versions">
              {history.versions.map((each) => (
                <li key={each.version}>
                  <dl className="tc-rules">
                    {each.condition !== "" ? (
                      <div>
                        <dt>Tested</dt>
                        <dd>{each.condition}</dd>
                      </div>
                    ) : null}
                    <div className="is-pass">
                      <dt>Passed</dt>
                      <dd>{each.passCriteria || "Not stated"}</dd>
                    </div>
                    <div className="is-fail">
                      <dt>Failed</dt>
                      <dd>{each.failCriteria || "Not stated"}</dd>
                    </div>
                    {each.judgmentRequired ? (
                      <div>
                        <dt>Judgment</dt>
                        <dd>Professional judgment required</dd>
                      </div>
                    ) : null}
                  </dl>
                  <p className="tas-by" suppressHydrationWarning>
                    {versionLine(each)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}
