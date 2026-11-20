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
  parseContext,
} from "./control-context-model";
import {
  ACCEPTED_UNCONFIRMED,
  CHANGE_REOPENS,
  characterCount,
  decidableAssumptions,
  decidedLine,
  settledAssumptions,
  updatedFromLine,
} from "./understanding-once-model";
import {
  assumptionLead,
  assumptionRowWords,
  assumptionText,
  CONFLICT_LEAD,
  changePrompt,
  changeWords,
  confirmWords,
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
  layout = "card",
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
  /** "row": each one a row of the attribute's criteria, "Assumes … Unconfirmed", in the
   * criteria's own columns (Review attributes, 19 November 2026, approved prototype). */
  layout?: "card" | "row";
}) {
  // Open, or accepted with the attribute and not confirmed (B1l point 6: the D&I point links
  // here, so it is confirmed or changed here); the rest as one quiet line each.
  const open = decidableAssumptions(items);
  const decided = settledAssumptions(items);
  if (open.length === 0 && decided.length === 0) {
    return null;
  }
  return (
    <ul
      className={layout === "row" ? "tas-list is-rows" : "tas-list"}
      aria-label={label}
    >
      {open.map((item) => (
        <OpenAssumption
          key={item.id}
          ids={ids}
          item={item}
          canAct={canAct}
          locked={locked}
          onContext={onContext}
          row={layout === "row"}
        />
      ))}
      {decided.map((item) =>
        layout === "row" ? (
          <li key={item.id} className="tas-row is-done">
            <span className="tas-row-label">
              {assumptionRowWords(item).label}
            </span>
            <span className="tas-row-body" suppressHydrationWarning>
              {decidedLine(item)}
            </span>
          </li>
        ) : (
          <li key={item.id} className="tas-done">
            <span suppressHydrationWarning>{decidedLine(item)}</span>
          </li>
        ),
      )}
    </ul>
  );
}

function OpenAssumption({
  ids,
  item,
  canAct,
  locked,
  onContext,
  row = false,
}: {
  ids: Ids;
  item: Assumption;
  canAct: boolean;
  locked: boolean;
  onContext: (context: ControlContext) => void;
  /** As a row of the attribute's criteria (AttributeAssumptions layout "row"). */
  row?: boolean;
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
  // Accepted with its attribute, not confirmed (B1l point 6): still the agent's, decided here.
  const accepted = item.status === "ACCEPTED_WITH_ATTRIBUTE";
  const changeForm =
    canAct && changing ? (
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
        <label htmlFor={`${boxId}-words`}>{changePrompt(item)}</label>
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
          {accepted ? ` ${CHANGE_REOPENS}` : ""}
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
    ) : null;
  const problemLine =
    problem !== null ? (
      <p className="tc-problem" role="alert">
        {problem}
      </p>
    ) : null;
  if (row) {
    const said = assumptionRowWords(item);
    return (
      <li className={`tas-row${conflict ? " is-conflict" : ""}`}>
        <span className="tas-row-label">{said.label}</span>
        <div className="tas-row-body">
          <p className="tas-row-text">
            {said.text} <span className="tas-row-state">{said.state}</span>
          </p>
          {canAct && !changing ? (
            <span className="tas-row-acts">
              <button
                type="button"
                className="tar-link"
                disabled={locked || busy !== ""}
                onClick={() => void send("assumption-confirm")}
              >
                {busy === "confirm" ? "Recording…" : confirmWords(item.kind)}
              </button>
              <button
                type="button"
                className="tar-link"
                disabled={locked || busy !== ""}
                aria-expanded={false}
                onClick={() => {
                  setProblem(null);
                  setChanging(true);
                }}
              >
                {changeWords(item.kind)}
              </button>
            </span>
          ) : null}
          {changeForm}
          {problemLine}
        </div>
      </li>
    );
  }
  return (
    <li
      className={`tas-open${conflict ? " is-conflict" : ""}${accepted ? " is-accepted" : ""}`}
    >
      {conflict ? <p className="tas-kicker">{CONFLICT_LEAD}</p> : null}
      {accepted ? <p className="tas-kicker">{ACCEPTED_UNCONFIRMED}</p> : null}
      <p className="tas-assumed">
        {conflict ? null : <strong>{assumptionLead(item.kind)}</strong>}{" "}
        {assumptionText(item)}
      </p>
      {canAct && !changing ? (
        <div className="tas-acts">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={locked || busy !== ""}
            onClick={() => void send("assumption-confirm")}
          >
            {busy === "confirm" ? "Recording…" : confirmWords(item.kind)}
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
            {changeWords(item.kind)}
          </button>
        </div>
      ) : null}
      {changeForm}
      {problemLine}
    </li>
  );
}

/**
 * Where an attribute's criteria last changed from an answer or an assumption. Its earlier
 * criteria are kept on every change (B1j) and shown in the control's History, each change
 * opening to the earlier and the new criteria (product owner, 20 November 2026: "remove the
 * previous criteria link here and probably add that as part of the history that it was
 * updated").
 */
export function CriteriaTrail({
  updatedFrom,
}: {
  updatedFrom: string | undefined;
}) {
  const from = updatedFromLine(updatedFrom);
  if (from === null) {
    return null;
  }
  return (
    <div className="tas-trail">
      <p className="tas-meta">{from}</p>
    </div>
  );
}
