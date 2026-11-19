"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  CHOOSE_FIRST,
  IMPACT_HELD,
  IMPACT_UNCHECKED,
  type ImpactAction,
  type ImpactAsk,
  type ImpactState,
  impactHref,
  impactKey,
  impactSummary,
  impactUnavailable,
  type MoveAction,
  moveConfirmTitle,
  moveHeldLine,
  parseFileImpact,
} from "./evidence-impact-model";
import { RefText } from "./ref-text";
import { heldControl } from "./row-menu-model";
import { UiIcon } from "./ui-icon";
import { useFocusReturn } from "./use-focus-return";

type Ids = { organizationId: string; projectId: string };

/** How long a menu waits after opening before it reads, so a menu opened and closed in
 * passing reads nothing. Every opening reads again: what holds a change (an acceptance,
 * a sign-off) may have changed elsewhere since, and an earlier answer is never kept for a
 * while on trust (E1 design review, round 4, 18 November 2026: a menu kept a held reason
 * after the decision was reopened elsewhere). */
const DEBOUNCE_MS = 150;

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

/** The impacts a list's menus check their actions with: read each time a menu opens
 * (`prefetch`, debounced; nothing on page load), said as checking until the answer is
 * in, and an answer to an earlier opening never written over a newer one. */
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
      // Already on its way for this opening.
      if (timers.current.has(key)) {
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
 * on request, each item whose decision the change takes back marked so; how many go back
 * to Not reviewed; the open test sheets tested again; and, when the change cannot be made,
 * every reliance in its way, in the server's words. Where it could not be read, an amber
 * notice with "Check again" (E1 design review, round 5: a grey hint said to refresh the
 * page). Said only where it has something to say.
 */
export function ImpactPreview({
  state,
  action,
  unchecked = IMPACT_UNCHECKED,
  heldLine,
  onRetry,
}: {
  state: ImpactState | null;
  action: ImpactAction;
  /** What is said when the impact could not be read: by default, that the server still
   * checks the change; a change that cannot be sent without it says so. */
  unchecked?: string;
  /** The held box's first line, where it is not the action's own. */
  heldLine?: string;
  /** Reads the impact again. */
  onRetry?: () => void;
}) {
  // "Check again" goes once the read is under way: focus goes to what the read then says
  // (round 6: it fell to the page's body).
  const focus = useFocusReturn();
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
    return (
      <div
        className="ip-unchecked"
        role="status"
        data-focus-return=""
        ref={focus.ref}
      >
        <p className="ip-line">
          <UiIcon name="info" size={14} />
          <span>{unchecked}</span>
        </p>
        {onRetry !== undefined ? (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              focus.returnFocus("answer");
              onRetry();
            }}
          >
            Check again
          </button>
        ) : null}
      </div>
    );
  }
  const summary = impactSummary(state.impact);
  if (!state.impact.allowed) {
    return (
      // Where a refusal puts the focus when nothing else answers it (use-focus-return).
      <div className="ip-held" role="status" data-focus-return="">
        <p className="ip-line">
          <UiIcon name="info" size={14} />
          <strong>{heldLine ?? IMPACT_HELD[action]}</strong>
        </p>
        <ul className="ip-list">
          {summary.blocking.map((sentence) => (
            <li key={sentence}>
              <RefText text={sentence} />
            </li>
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
    <div className="ip-impact" data-focus-return="">
      {summary.used !== null ? (
        summary.items.length > 0 ? (
          <details className="ip-used">
            <summary>
              <UiIcon name="chevron" size={13} />
              <span>
                <RefText text={summary.used} />
              </span>
            </summary>
            <ul className="ip-list">
              {summary.items.map((item) => (
                <li key={item.key}>
                  <RefText text={item.text} />
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="ip-line">
            <RefText text={summary.used} />
          </p>
        )
      ) : null}
      {summary.resets !== null ? (
        <p className="ip-line">{summary.resets}</p>
      ) : null}
      {summary.retests !== null ? (
        <p className="ip-line">
          <RefText text={summary.retests} />
        </p>
      ) : null}
    </div>
  );
}

type MoveState = {
  held: boolean;
  /** The held box's id: a held press is described by it. */
  heldId: string;
  /** A form that moved the file was refused: the move's impact is read again, and the
   * server's sentence is said only if the new read does not hold the move. */
  refused: (sentence: string) => void;
  /** What the move does is on screen for this press, so the press sends it. */
  intended: (action: MoveAction) => boolean;
  /** A first press: its confirm block opens under it. */
  ask: (action: MoveAction, form: HTMLFormElement) => void;
  /** The confirm block open under this press, or null. */
  asking: (action: MoveAction) => ReactNode;
};

const MoveContext = createContext<MoveState | null>(null);

/** The move check the form is under, or null (InPlaceForm). */
export function useMoveCheck(): MoveState | null {
  return useContext(MoveContext);
}

/**
 * Moving a filed file to another control, or off its control, in the Evidence Library
 * (E1). At rest it says only what holds the move (the file's impact for MOVE, read as its
 * panel opens; "It cannot be moved or taken off now." where it offers both), with the
 * presses that move it held (`MoveSubmit`, reachable by keyboard and described by the
 * held box). Choosing a control says what the move does, and Move then makes it; a first
 * press without that (Take off this control, or Move on the control suggested) opens a
 * confirm block under it: what it does, the press that makes it and Cancel (E1 design
 * review, round 5: the sentence that asked for a second press was hard to read). A refused move reads
 * the impact again, so a reliance shows as the held box, once, and takes the focus.
 */
export function MoveCheck({
  organizationId,
  projectId,
  fileId,
  fileName,
  control,
  takeOff,
  children,
}: {
  organizationId: string;
  projectId: string;
  fileId: string;
  fileName: string;
  /** The control the file is filed to, as the panel names it. */
  control: string;
  /** The panel offers Take off this control as well as Move. */
  takeOff: boolean;
  children: ReactNode;
}) {
  const heldId = useId();
  const titleId = useId();
  const focus = useFocusReturn();
  const [attempt, setAttempt] = useState(0);
  // A control picked: what the move does is on screen, and Move makes it.
  const [chosen, setChosen] = useState(false);
  const [confirm, setConfirm] = useState<{
    action: MoveAction;
    form: HTMLFormElement;
  } | null>(null);
  // The press the confirm block armed, read in the same event as its submit.
  const armed = useRef<MoveAction | null>(null);
  const block = useRef<HTMLFieldSetElement | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const state = useImpact(
    { organizationId, projectId },
    { fileId, action: "MOVE" },
    attempt,
  );
  const held = state?.status === "ready" && !state.impact.allowed;
  const retry = () => setAttempt((count) => count + 1);
  useEffect(() => {
    if (confirm !== null) {
      block.current?.focus();
    }
  }, [confirm]);
  const close = () => {
    focus.returnFocus("back");
    armed.current = null;
    setConfirm(null);
  };
  const value: MoveState = {
    held,
    heldId,
    refused: (sentence) => {
      setRefusal(sentence);
      setConfirm(null);
      armed.current = null;
      setAttempt((count) => count + 1);
      focus.returnFocus("answer");
    },
    intended: (action) =>
      armed.current === action || (action === "move" && chosen),
    ask: (action, form) => {
      setRefusal(null);
      setConfirm({ action, form });
    },
    asking: (action) => {
      if (confirm === null || confirm.action !== action) {
        return null;
      }
      const field = confirm.form.elements.namedItem("control_id");
      const target =
        action === "move" && field instanceof HTMLSelectElement
          ? (field.selectedOptions[0]?.textContent ?? null)
          : null;
      return (
        <fieldset
          ref={(element) => {
            block.current = element;
            focus.ref(element);
          }}
          className="move-confirm"
          aria-labelledby={titleId}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <p className="change-title" id={titleId}>
            <RefText
              text={moveConfirmTitle(action, fileName, control, target)}
            />
          </p>
          <ImpactPreview state={state} action="MOVE" onRetry={retry} />
          <div className="file-changes-actions">
            <button
              type="button"
              className={action === "takeoff" ? "btn-danger btn-sm" : "btn-sm"}
              {...heldControl(held, heldId)}
              onClick={() => {
                if (held) {
                  return;
                }
                armed.current = action;
                confirm.form.requestSubmit();
              }}
            >
              {action === "takeoff" ? "Take off" : "Move"}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={close}>
              Cancel
            </button>
          </div>
        </fieldset>
      );
    },
  };
  return (
    <MoveContext.Provider value={value}>
      {held || state?.status === "failed" || (chosen && confirm === null) ? (
        <div id={heldId}>
          <ImpactPreview
            state={state}
            action="MOVE"
            heldLine={moveHeldLine(takeOff)}
            onRetry={retry}
          />
        </div>
      ) : null}
      {refusal !== null && state?.status === "ready" && !held ? (
        <p className="change-problem" role="alert">
          {refusal}
        </p>
      ) : null}
      {/* Choosing a control says what the move does, and Move makes it (a select's
          change bubbles). */}
      <div
        className="move-intent"
        onChange={(event) => {
          if (event.target instanceof HTMLSelectElement) {
            setChosen(event.target.value !== "");
            setConfirm(null);
          }
        }}
      >
        {children}
      </div>
    </MoveContext.Provider>
  );
}

/** A form that moves the file (MoveCheck): a press sends only once what the move does is
 * on screen for it; a first press opens its confirm block under it, and a press while the
 * move is held sends nothing. */
export function MoveGuard({
  action,
  children,
}: {
  action: MoveAction;
  children: ReactNode;
}) {
  const check = useContext(MoveContext);
  return (
    <fieldset
      className="move-guard"
      onSubmitCapture={(event) => {
        if (check === null) {
          return;
        }
        if (check.held) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (
          !check.intended(action) &&
          event.target instanceof HTMLFormElement
        ) {
          event.preventDefault();
          event.stopPropagation();
          check.ask(action, event.target);
        }
      }}
    >
      {children}
      {check?.asking(action) ?? null}
    </fieldset>
  );
}

/**
 * The press that files a file or moves it (the Evidence Library). Offered only where it
 * can succeed, and reachable by keyboard where it cannot (aria-disabled, never disabled):
 * it waits while its form's control is not chosen (no browser bubble asks for one; E1
 * design review, round 4, 18 November 2026), and while the move is held (MoveCheck),
 * described by the held box; a press then does nothing.
 */
export function MoveSubmit({
  label,
  className = "btn-sm",
}: {
  label: string;
  className?: string;
}) {
  const check = useContext(MoveContext);
  const uid = useId();
  const button = useRef<HTMLButtonElement>(null);
  // The form's control, where it has one to choose: read as it is drawn and as it changes.
  const [chosen, setChosen] = useState(true);
  useEffect(() => {
    const form = button.current?.form ?? null;
    const field = form?.elements.namedItem("control_id");
    if (form === null || !(field instanceof HTMLSelectElement)) {
      return;
    }
    const read = () => setChosen(field.value !== "");
    read();
    form.addEventListener("change", read);
    return () => form.removeEventListener("change", read);
  }, []);
  const held = check?.held ?? false;
  const off = held || !chosen;
  // While the move is held, its control to choose is held with it (E1 design review:
  // the select looked live beside a held Move).
  useEffect(() => {
    const field = button.current?.form?.elements.namedItem("control_id");
    if (!(field instanceof HTMLSelectElement)) {
      return;
    }
    if (held) {
      field.setAttribute("aria-disabled", "true");
      if (check?.heldId) {
        field.setAttribute("aria-describedby", check.heldId);
      }
    } else {
      field.removeAttribute("aria-disabled");
      field.removeAttribute("aria-describedby");
    }
  }, [held, check?.heldId]);
  return (
    <>
      <button
        ref={button}
        type="submit"
        className={className}
        {...heldControl(off, held ? check?.heldId : `${uid}-choose`)}
        onClick={(event) => {
          if (off) {
            event.preventDefault();
          }
        }}
      >
        {label}
      </button>
      {!held && !chosen ? (
        <span id={`${uid}-choose`} className="sr-only">
          {CHOOSE_FIRST}
        </span>
      ) : null}
    </>
  );
}
