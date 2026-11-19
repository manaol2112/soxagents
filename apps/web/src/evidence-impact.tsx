"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  IMPACT_HELD,
  type ImpactAction,
  type ImpactAsk,
  type ImpactState,
  impactHref,
  impactKey,
  impactSummary,
  impactUnavailable,
  parseFileImpact,
} from "./evidence-impact-model";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };

/** How long a menu waits after opening before it reads, so a menu opened and closed in
 * passing reads nothing; and how long a reading stands before it is read again. */
const DEBOUNCE_MS = 150;
const FRESH_MS = 15000;

/** What a menu item says while its check is on its way. */
export const IMPACT_CHECKING = "Checking…";

async function readImpact(
  ids: Ids,
  ask: ImpactAsk,
  signal?: AbortSignal,
): Promise<ImpactState> {
  try {
    const response = await fetch(impactHref(ids, ask), {
      cache: "no-store",
      ...(signal === undefined ? {} : { signal }),
    });
    const body = (await response.json()) as { impact?: unknown };
    const impact = parseFileImpact(body.impact);
    return impact === null
      ? { status: "failed" }
      : { status: "ready", impact, at: Date.now() };
  } catch {
    return { status: "failed" };
  }
}

/** The impacts a list's menus check their actions with: read only when a menu opens
 * (`prefetch`, debounced; nothing on page load), the last answer for each ask kept, and a
 * stale one never written over a newer. */
export type Impacts = {
  prefetch: (ask: ImpactAsk) => void;
  state: (ask: ImpactAsk) => ImpactState | undefined;
  /** Why the action is held, in the server's words; null when it is not (or not known). */
  unavailable: (ask: ImpactAsk) => string | null;
  /** A quiet word while the check is on its way ("Checking…"), else null: the item stays
   * available meanwhile. */
  checking: (ask: ImpactAsk) => string | null;
  /** Forgets what was read, after a change the person made. */
  forget: () => void;
};

export function useImpacts(ids: Ids): Impacts {
  const [states, setStates] = useState<ReadonlyMap<string, ImpactState>>(
    () => new Map(),
  );
  const current = useRef(states);
  current.current = states;
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const turns = useRef(new Map<string, number>());
  useEffect(
    () => () => {
      for (const timer of timers.current.values()) {
        clearTimeout(timer);
      }
    },
    [],
  );
  const { organizationId, projectId } = ids;
  const prefetch = useCallback(
    (ask: ImpactAsk) => {
      const key = impactKey(ask);
      const known = current.current.get(key);
      if (
        known?.status === "loading" ||
        (known?.status === "ready" && Date.now() - known.at < FRESH_MS) ||
        timers.current.has(key)
      ) {
        return;
      }
      // Said as checking from the moment the menu opens, through the debounce.
      setStates((map) => new Map(map).set(key, { status: "loading" }));
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          const turn = (turns.current.get(key) ?? 0) + 1;
          turns.current.set(key, turn);
          setStates((map) => new Map(map).set(key, { status: "loading" }));
          void readImpact({ organizationId, projectId }, ask).then((state) => {
            // The last ask's answer only.
            if (turns.current.get(key) === turn) {
              setStates((map) => new Map(map).set(key, state));
            }
          });
        }, DEBOUNCE_MS),
      );
    },
    [organizationId, projectId],
  );
  const state = useCallback(
    (ask: ImpactAsk) => states.get(impactKey(ask)),
    [states],
  );
  const unavailable = useCallback(
    (ask: ImpactAsk) => impactUnavailable(states.get(impactKey(ask))),
    [states],
  );
  const checking = useCallback(
    (ask: ImpactAsk) =>
      states.get(impactKey(ask))?.status === "loading" ? IMPACT_CHECKING : null,
    [states],
  );
  const forget = useCallback(() => {
    for (const key of turns.current.keys()) {
      turns.current.set(key, (turns.current.get(key) ?? 0) + 1);
    }
    setStates(new Map());
  }, []);
  return { prefetch, state, unavailable, checking, forget };
}

/** One impact for a confirm form: read as the form opens, again when what it asks
 * changes, and again on a new `attempt` (after the server refused the change, so the
 * form shows what stands in its way now, never a stale preview); an answer to an earlier
 * ask is dropped. Null while there is nothing to ask. */
export function useImpact(
  ids: Ids,
  ask: ImpactAsk | null,
  attempt = 0,
): ImpactState | null {
  const [state, setState] = useState<ImpactState | null>(null);
  const key = ask === null ? "" : `${impactKey(ask)}#${attempt}`;
  const asked = useRef(ask);
  asked.current = ask;
  const { organizationId, projectId } = ids;
  useEffect(() => {
    const ask = asked.current;
    if (key === "" || ask === null) {
      setState(null);
      return;
    }
    const abort = new AbortController();
    setState({ status: "loading" });
    void readImpact({ organizationId, projectId }, ask, abort.signal).then(
      (next) => {
        if (!abort.signal.aborted) {
          setState(next);
        }
      },
    );
    return () => abort.abort();
  }, [key, organizationId, projectId]);
  return state;
}

/**
 * What a change would do, in its confirm form (E1): where the file is used now, its items
 * on request; whose judgment goes back to not reviewed; the open test sheets tested
 * again; and, when the change cannot be made, every reliance in its way, in the server's
 * words. Said only where it has something to say.
 */
export function ImpactPreview({
  state,
  action,
  unchecked = "Where the file is used could not be checked. The change is still checked when it is sent.",
}: {
  state: ImpactState | null;
  action: ImpactAction;
  /** What is said when the impact could not be read: by default, that the server still
   * checks the change; a change that cannot be sent without it says so. */
  unchecked?: string;
}) {
  if (state === null) {
    return null;
  }
  if (state.status === "loading") {
    return (
      <p className="ip-line is-loading" role="status">
        <span className="spinner small" aria-hidden="true" />
        Checking where the file is used…
      </p>
    );
  }
  if (state.status === "failed") {
    return <p className="form-hint">{unchecked}</p>;
  }
  const summary = impactSummary(state.impact);
  if (!state.impact.allowed) {
    return (
      <div className="ip-held" role="status">
        <p className="ip-line">
          <UiIcon name="info" size={14} />
          <strong>{IMPACT_HELD[action]}</strong>
        </p>
        <ul className="ip-list">
          {summary.blocking.map((sentence) => (
            <li key={sentence}>{sentence}</li>
          ))}
        </ul>
      </div>
    );
  }
  if (
    summary.used === null &&
    summary.resets === null &&
    summary.retests === null
  ) {
    return null;
  }
  return (
    <div className="ip-impact">
      {summary.used !== null ? (
        summary.items.length > 0 ? (
          <details className="ip-used">
            <summary>{summary.used}</summary>
            <ul className="ip-list">
              {summary.items.map((item) => (
                <li key={item.key}>{item.text}</li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="ip-line">{summary.used}</p>
        )
      ) : null}
      {summary.resets !== null ? (
        <p className="ip-line">{summary.resets}</p>
      ) : null}
      {summary.retests !== null ? (
        <p className="ip-line">{summary.retests}</p>
      ) : null}
    </div>
  );
}

type MoveState = {
  held: boolean;
  /** A form that moved the file was refused: the move's impact is read again, and the
   * server's sentence is said only if the new read does not hold the move. */
  refused: (sentence: string) => void;
  /** What a move does has been said, so a press sends it. */
  intended: boolean;
  /** A person chose where to move the file, or pressed a move: what it does is said;
   * a press first says it, with how to send it. */
  intend: (pressed: boolean) => void;
};

const MoveContext = createContext<MoveState | null>(null);

/** The move check the form is under, or null (InPlaceForm). */
export function useMoveCheck(): MoveState | null {
  return useContext(MoveContext);
}

/**
 * Moving a filed file to another control, or off its control, in the Evidence Library
 * (E1). At rest it says only what holds the move (the file's impact for MOVE, read as its
 * panel opens), with the forms that move it held (`MoveGuard`); what a move would do is
 * said once a person chooses a control or presses a move, and a first press only shows
 * it (the second sends). A refused move reads the impact again, so a reliance shows as
 * the held box, once.
 */
export function MoveCheck({
  organizationId,
  projectId,
  fileId,
  children,
}: {
  organizationId: string;
  projectId: string;
  fileId: string;
  children: ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const [intended, setIntended] = useState<"chosen" | "pressed" | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const state = useImpact(
    { organizationId, projectId },
    { fileId, action: "MOVE" },
    attempt,
  );
  const held = state?.status === "ready" && !state.impact.allowed;
  const value: MoveState = {
    held,
    refused: (sentence) => {
      setRefusal(sentence);
      setAttempt((count) => count + 1);
    },
    intended: intended !== null,
    intend: (pressed) => setIntended(pressed ? "pressed" : "chosen"),
  };
  return (
    <MoveContext.Provider value={value}>
      {held || intended !== null || state?.status === "failed" ? (
        <ImpactPreview state={state} action="MOVE" />
      ) : null}
      {intended === "pressed" && !held && refusal === null ? (
        <p className="form-hint">
          This is what the move does. Press it again to make it.
        </p>
      ) : null}
      {refusal !== null && state?.status === "ready" && !held ? (
        <p className="change-problem" role="alert">
          {refusal}
        </p>
      ) : null}
      {/* Choosing a control says what the move does (a select's change bubbles). */}
      <div
        className="move-intent"
        onChange={() => setIntended((now) => now ?? "chosen")}
      >
        {children}
      </div>
    </MoveContext.Provider>
  );
}

/** A form that moves the file: off while its move is held (MoveCheck). Its first press,
 * before what the move does was said, only says it. */
export function MoveGuard({ children }: { children: ReactNode }) {
  const check = useContext(MoveContext);
  return (
    <fieldset
      className="move-guard"
      disabled={check?.held ?? false}
      onSubmitCapture={(event) => {
        if (check !== null && !check.intended) {
          event.preventDefault();
          event.stopPropagation();
          check.intend(true);
        }
      }}
    >
      {children}
    </fieldset>
  );
}
