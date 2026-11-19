"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type FormEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { localPath } from "./browser-url";
import { returnStep } from "./control-workflow-model";
import {
  CHANGE_NOTICES,
  type ChangeNotice,
  changeNoticeParam,
  changeProblem,
  cleanReason,
  nextOpenForm,
  type OpenForm,
  reasonReady,
  restoredLine,
  withdrawnCountLine,
} from "./evidence-change-model";
import { ImpactPreview, useImpact, useMoveCheck } from "./evidence-impact";
import {
  CHOOSE_FILE_FIRST,
  FILE_ACTION_LABELS,
  type ImpactAction,
  impactUnavailable,
  REASON_HINT,
  REASON_OPTIONAL_HINT,
  REASON_PROBLEM,
  REMOVAL_UNCHECKED,
  removedMessage,
  removeProblem,
  restoredMessage,
  withdrawnMessage,
  withdrawReason,
} from "./evidence-impact-model";
import { filingProblem, MAX_UPLOAD_BYTES } from "./evidence-model";
import { formatBytes } from "./format";
import { RefText } from "./ref-text";
import { RowExtra } from "./row-extra";
import { RowMenu, type RowMenuItem } from "./row-menu";
import { heldControl, heldReasons } from "./row-menu-model";
import { UiIcon } from "./ui-icon";
import { useFocusReturn } from "./use-focus-return";

type Mode = "replace" | "withdraw" | "remove";

type Props = {
  organizationId: string;
  projectId: string;
  fileId: string;
  fileName: string;
  /** Why the file cannot change now, or null. */
  blocked: string | null;
  /** A control's Evidence tab to come back to; otherwise the evidence page. */
  controlId?: string;
  /** The control's workflow step the change is made on, to come back to. */
  step?: string | null;
  keep?: Record<string, string>;
  /** Open on this form, as a menu choice does, instead of on the two buttons. */
  start?: Mode;
  /** "Remove from this request": the evidence item the file is taken off (E1). */
  requirementId?: string;
  /** Cancel closes the form (the menu's caller hides it) instead of showing the buttons. */
  onCancel?: () => void;
  /** A change the server confirmed, handed to the caller with what to say, which shows it
   * where the person acted. Without it the page comes back, in place, to where a reload
   * would have landed, with the change's notice. */
  onDone?: (message: string) => void;
};

function Hidden({
  organizationId,
  projectId,
  fileId,
  controlId,
  step,
  keep,
}: Pick<
  Props,
  "organizationId" | "projectId" | "fileId" | "controlId" | "step" | "keep"
>) {
  return (
    <>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="file_id" value={fileId} />
      {controlId !== undefined ? (
        <input type="hidden" name="control_id" value={controlId} />
      ) : null}
      {controlId !== undefined && step ? (
        <input type="hidden" name="step" value={step} />
      ) : null}
      {Object.entries(keep ?? {}).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
    </>
  );
}

/** Sends a withdrawal or a restoration in place (the change route answers as JSON): the
 * notice, the server's own sentence when it refused, and where a reload would land. */
async function sendChange(form: FormData): Promise<{
  notice: ChangeNotice;
  detail: string;
  location: string | null;
}> {
  try {
    const response = await fetch("/workspace/evidence-change", {
      method: "POST",
      headers: { accept: "application/json" },
      body: form,
    });
    const body = (await response.json()) as {
      notice?: unknown;
      detail?: unknown;
      location?: unknown;
    };
    const notice =
      typeof body.notice === "string" && body.notice in CHANGE_NOTICES
        ? (body.notice as ChangeNotice)
        : "unavailable";
    return {
      notice,
      detail: typeof body.detail === "string" ? body.detail : "",
      location:
        typeof body.location === "string" ? localPath(body.location) : null,
    };
  } catch {
    return { notice: "unavailable", detail: "", location: null };
  }
}

/** A change's reason: one rule everywhere (E1 design review, 18 November 2026), a
 * two-line field with its rule under it, checked when the form is sent. */
function ReasonField({
  id,
  name,
  value,
  required,
  label = "Why",
  placeholder,
  onChange,
}: {
  id: string;
  name?: string;
  value: string;
  required: boolean;
  label?: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <>
      <label htmlFor={id} className="change-label-line">
        {label}
        {required ? null : (
          <>
            {" "}
            <span className="change-optional">(optional)</span>
          </>
        )}
      </label>
      <textarea
        id={id}
        {...(name === undefined ? {} : { name })}
        rows={2}
        value={value}
        maxLength={500}
        aria-describedby={`${id}-rule`}
        {...(placeholder === undefined ? {} : { placeholder })}
        onChange={(event) => onChange(event.target.value)}
      />
      <small id={`${id}-rule`} className="form-hint change-rule">
        {required ? REASON_HINT : REASON_OPTIONAL_HINT}
      </small>
    </>
  );
}

/** A change the server says cannot be made now: what it is, what stands in its way (the
 * held box), and one way out. No field and no action that cannot succeed. */
function HeldChange({
  title,
  impact,
  action,
  onClose,
  focusRef,
}: {
  title: ReactNode;
  impact: ReturnType<typeof useImpact>;
  action: ImpactAction;
  onClose: () => void;
  /** The form's focus return (use-focus-return.ts): the held box is the form drawn anew. */
  focusRef: (element: HTMLElement | null) => void;
}) {
  const uid = useId();
  return (
    <div className="change-form is-held" ref={focusRef}>
      <p className="change-title" id={`${uid}-title`}>
        {title}
      </p>
      <div id={`${uid}-why`}>
        <ImpactPreview state={impact} action={action} />
      </div>
      <div className="file-changes-actions">
        {/* The one way out, and where focus lands when a refusal holds the change: it
            names what is held and why. */}
        <button
          type="button"
          className="btn-secondary btn-sm"
          data-focus-return=""
          aria-describedby={`${uid}-title ${uid}-why`}
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}

/**
 * Replace a file with a corrected one, withdraw it from the engagement, or take it off one
 * request. Each keeps the original on record, and each confirm form first says what the
 * change would do (its impact, E1): where the file is used, whose judgment goes back to
 * not reviewed, which open test sheets are tested again. When the server says it cannot
 * be made now, the form is only that (the held box and Close). A refusal reads the impact
 * again: a reliance then shows as the held box, once; any other refusal is said in the
 * server's own words. Every change is sent in place.
 */
export function FileChanges(props: Props) {
  const { organizationId, projectId, fileId, fileName, blocked, controlId } =
    props;
  const router = useRouter();
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  // Focus goes back where the person was once the form closes or answers.
  const focus = useFocusReturn();
  const [mode, setMode] = useState<"idle" | Mode>(props.start ?? "idle");
  const [picked, setPicked] = useState<File | null>(null);
  const [reason, setReason] = useState(
    props.start === "replace" ? "Corrected version" : "",
  );
  const [sending, setSending] = useState(false);
  // A problem the form said (a reason too short, the server unreachable).
  const [problem, setProblem] = useState<string | null>(null);
  // The server's refusal, said only if the impact read after it does not hold the change.
  const [refused, setRefused] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // A change the server confirmed, said here until the page has come back.
  const [done, setDone] = useState<string | null>(null);
  const ids = { organizationId, projectId };
  const action: ImpactAction | null =
    mode === "idle"
      ? null
      : mode === "remove"
        ? "REMOVE_FROM_REQUEST"
        : mode === "replace"
          ? "REPLACE"
          : "WITHDRAW";
  const impact = useImpact(
    ids,
    blocked !== null || action === null
      ? null
      : action === "REMOVE_FROM_REQUEST"
        ? props.requirementId === undefined
          ? null
          : { fileId, action, requirementId: props.requirementId }
        : { fileId, action },
    attempt,
  );
  // The two presses the panel shows at rest, checked as a menu checks its items (E1
  // design review, round 5: the Library offered Replace and Withdraw that the menu and
  // the viewer held).
  const atRest = (check: "REPLACE" | "WITHDRAW") =>
    blocked === null && mode === "idle" ? { fileId, action: check } : null;
  const replaceCheck = useImpact(ids, atRest("REPLACE"), attempt);
  const withdrawCheck = useImpact(ids, atRest("WITHDRAW"), attempt);
  // Held while the server says the change cannot be made now.
  const held = impact?.status === "ready" && !impact.impact.allowed;
  const retry = () => setAttempt((count) => count + 1);
  // How the file serves the item, at the version the person sees: what a removal sends.
  const removal =
    impact?.status === "ready" && impact.impact.allowed
      ? impact.impact.removal
      : null;
  const close = () => {
    if (sending) {
      return;
    }
    setPicked(null);
    setProblem(null);
    setRefused(null);
    focus.returnFocus("back");
    if (props.onCancel !== undefined) {
      props.onCancel();
    } else {
      setMode("idle");
    }
  };

  if (blocked !== null) {
    return (
      <p className="form-hint change-blocked">
        <UiIcon name="info" size={13} /> {blocked}
      </p>
    );
  }

  /** The change confirmed: said where the person acted, or the page comes back in place
   * to where a reload would have landed. */
  const confirmed = (message: string, location: string | null) => {
    setDone(message);
    focus.returnFocus("answer");
    if (props.onDone !== undefined) {
      props.onDone(message);
      router.refresh();
    } else if (location !== null) {
      router.replace(location, { scroll: false });
    } else {
      router.refresh();
    }
  };

  /** The server refused with its sentence: the impact is read again, and the sentence
   * is said only where that read does not hold the change. */
  const refusedWith = (sentence: string) => {
    setRefused(sentence);
    setAttempt((count) => count + 1);
    // Where the read holds the change, its held box takes the focus (its Close).
    focus.returnFocus("answer");
  };

  // One rule for every change's press (E1 design review, round 5): it waits, reachable
  // and described by what it waits for, until it can be sent; a press then does nothing.
  const reasonOk = reasonReady(reason, mode !== "withdraw");
  const unchecked = impact?.status === "failed";
  const off =
    sending ||
    !reasonOk ||
    (mode === "replace" && picked === null) ||
    (mode === "remove" && removal === null);
  const offWhy =
    mode === "replace" && picked === null
      ? `${uid}-pick`
      : !reasonOk
        ? `${uid}-why-rule`
        : undefined;

  async function replace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (off) {
      return;
    }
    const why = cleanReason(reason);
    if (picked === null) {
      setProblem("Choose the corrected file.");
      return;
    }
    if (why === null) {
      setProblem(REASON_PROBLEM);
      return;
    }
    if (picked.size === 0 || picked.size > MAX_UPLOAD_BYTES) {
      setProblem("Choose a file between 1 byte and 25 MB.");
      return;
    }
    setSending(true);
    setProblem(null);
    setRefused(null);
    const query = new URLSearchParams({
      organization: organizationId,
      project: projectId,
      file: fileId,
      name: picked.name.slice(0, 200),
      reason: why,
    });
    let notice: ChangeNotice = "unavailable";
    let detail = "";
    let newId: string | null = null;
    try {
      const response = await fetch(`/workspace/evidence-replace?${query}`, {
        method: "POST",
        headers: {
          "content-type": picked.type || "application/octet-stream",
        },
        body: picked,
      });
      const body = (await response.json()) as {
        notice?: unknown;
        file_id?: unknown;
        detail?: unknown;
      };
      if (typeof body.notice === "string" && body.notice in CHANGE_NOTICES) {
        notice = body.notice as ChangeNotice;
      }
      detail = typeof body.detail === "string" ? body.detail : "";
      newId = typeof body.file_id === "string" ? body.file_id : null;
    } catch {
      notice = "unavailable";
    }
    setSending(false);
    if (notice !== "replaced") {
      if (detail.trim() !== "") {
        refusedWith(changeProblem(notice, detail));
      } else {
        setProblem(changeProblem(notice, detail));
      }
      return;
    }
    const params = new URLSearchParams({
      organization: organizationId,
      project: projectId,
      notice: changeNoticeParam("replaced"),
    });
    if (controlId !== undefined) {
      params.set("section", "controls");
      params.set("control", controlId);
      // Back to the step the file was replaced on: D&I Evidence or OE Evidence.
      const step = returnStep(props.step);
      if (step !== null) {
        params.set("step", step);
      } else {
        params.set("tab", "evidence");
      }
    } else {
      params.set("section", "evidence");
      for (const [key, value] of Object.entries(props.keep ?? {})) {
        params.set(key, value);
      }
      if (newId !== null) {
        params.set("file", newId);
      }
    }
    router.push(`/?${params.toString()}`);
    router.refresh();
  }

  async function withdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (off) {
      return;
    }
    const given = withdrawReason(reason);
    if (given === null) {
      setProblem(REASON_PROBLEM);
      return;
    }
    const form = new FormData(event.currentTarget);
    form.set("reason", given);
    setSending(true);
    setProblem(null);
    setRefused(null);
    const answer = await sendChange(form);
    setSending(false);
    if (answer.notice !== "withdrawn") {
      if (answer.detail.trim() !== "") {
        refusedWith(changeProblem(answer.notice, answer.detail));
      } else {
        setProblem(changeProblem(answer.notice, answer.detail));
      }
      return;
    }
    confirmed(withdrawnMessage(fileName), answer.location);
  }

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (off) {
      return;
    }
    const why = cleanReason(reason);
    if (why === null || props.requirementId === undefined) {
      setProblem(REASON_PROBLEM);
      return;
    }
    if (removal === null) {
      // Held: the form already says the removal could not be checked.
      return;
    }
    setSending(true);
    setProblem(null);
    setRefused(null);
    let status = 0;
    let detail = "";
    try {
      const response = await fetch(
        `/workspace/evidence-files/${fileId}/remove-from-request`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organization_id: organizationId,
            project_id: projectId,
            requirement_id: props.requirementId,
            reason: why,
            // The link's or the filing's version the impact named: a change meanwhile is
            // refused rather than taking off something the person did not see.
            version: removal.version,
          }),
        },
      );
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
    } catch {
      status = 0;
    }
    setSending(false);
    const said = removeProblem(status, detail);
    if (said !== null) {
      if (status === 409 && detail.trim() !== "") {
        refusedWith(said);
      } else {
        setProblem(said);
      }
      return;
    }
    confirmed(removedMessage(fileName), null);
  }

  if (done !== null && props.onDone === undefined) {
    return (
      <p className="ep-done" role="status">
        <UiIcon name="check" size={14} />
        <span>{done}</span>
      </p>
    );
  }

  // One line for what went wrong: the form's own, or the server's refusal once the
  // impact read after it does not hold the change (never beside the held box).
  const shownProblem =
    problem ??
    (refused !== null && impact?.status !== "loading" && !held
      ? refused
      : null);
  const problemLine =
    shownProblem !== null ? (
      <p className="change-problem" role="alert">
        {shownProblem}
      </p>
    ) : null;
  const cancelButton = (
    <button
      type="button"
      className="btn-ghost btn-sm"
      onClick={close}
      aria-disabled={sending || undefined}
    >
      Cancel
    </button>
  );
  const title =
    mode === "replace" ? (
      <>
        Replace <strong>{fileName}</strong>
      </>
    ) : mode === "withdraw" ? (
      <>
        Withdraw <strong>{fileName}</strong> from the engagement
      </>
    ) : (
      <>
        Remove <strong>{fileName}</strong> from this request
      </>
    );

  if (held && action !== null) {
    return (
      <div className="file-changes">
        <HeldChange
          title={title}
          impact={impact}
          action={action}
          onClose={close}
          focusRef={focus.ref}
        />
      </div>
    );
  }

  return (
    <div className="file-changes">
      {mode === "idle"
        ? (() => {
            const presses = [
              {
                label: FILE_ACTION_LABELS.REPLACE,
                unavailable: impactUnavailable(replaceCheck),
              },
              {
                label: FILE_ACTION_LABELS.WITHDRAW,
                unavailable: impactUnavailable(withdrawCheck),
              },
            ];
            // One reason the two share is said once, naming them.
            const reasons = heldReasons(presses);
            const said = (index: number) => {
              const why = presses[index]?.unavailable ?? null;
              const at = presses
                .map((each) => each.unavailable)
                .lastIndexOf(why);
              return why === null ? undefined : `${uid}-held-${at}`;
            };
            return (
              <div className="file-changes-rest">
                <div className="file-changes-actions">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    {...heldControl(presses[0]?.unavailable != null, said(0))}
                    onClick={() => {
                      if (presses[0]?.unavailable == null) {
                        setMode("replace");
                        setReason("Corrected version");
                      }
                    }}
                  >
                    <UiIcon name="upload" size={13} />{" "}
                    {FILE_ACTION_LABELS.REPLACE}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm is-danger"
                    {...heldControl(presses[1]?.unavailable != null, said(1))}
                    onClick={() => {
                      if (presses[1]?.unavailable == null) {
                        setMode("withdraw");
                        setReason("");
                      }
                    }}
                  >
                    <UiIcon name="trash" size={13} />{" "}
                    {FILE_ACTION_LABELS.WITHDRAW}
                  </button>
                </div>
                {reasons.map((line, index) =>
                  line === null ? null : (
                    <small
                      key={line}
                      id={`${uid}-held-${index}`}
                      className="change-held-line"
                    >
                      <RefText text={line} />
                    </small>
                  ),
                )}
              </div>
            );
          })()
        : null}
      {mode === "replace" ? (
        <form
          ref={focus.ref}
          autoComplete="off"
          className="change-form"
          noValidate
          onSubmit={replace}
        >
          <p className="change-title">{title}</p>
          <p className="form-hint">
            The new file replaces this one on its control, request and samples,
            and the agent reads it again. This file is kept under Withdrawn.
          </p>
          <ImpactPreview state={impact} action="REPLACE" onRetry={retry} />
          <div className="change-pick">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                if (!sending) {
                  input.current?.click();
                }
              }}
              aria-disabled={sending || undefined}
            >
              Choose the corrected file
            </button>
            <span
              className="change-picked"
              title={picked === null ? undefined : picked.name}
            >
              {picked === null
                ? "No file chosen"
                : `${picked.name} · ${formatBytes(picked.size)}`}
            </span>
            {picked === null ? (
              <span id={`${uid}-pick`} className="sr-only">
                {CHOOSE_FILE_FIRST}
              </span>
            ) : null}
            <input
              ref={input}
              type="file"
              hidden
              onChange={(event) => setPicked(event.target.files?.[0] ?? null)}
            />
          </div>
          <ReasonField
            id={`${uid}-why`}
            value={reason}
            required
            onChange={setReason}
          />
          {problemLine}
          <div className="file-changes-actions">
            <button
              type="submit"
              className="btn-sm"
              {...heldControl(off, offWhy)}
            >
              {sending ? (
                <>
                  <span className="spinner small" aria-hidden="true" />{" "}
                  Uploading…
                </>
              ) : (
                "Replace"
              )}
            </button>
            {cancelButton}
          </div>
        </form>
      ) : null}
      {mode === "withdraw" ? (
        <form
          ref={focus.ref}
          autoComplete="off"
          className="change-form"
          method="post"
          action="/workspace/evidence-change"
          noValidate
          onSubmit={withdraw}
        >
          <Hidden {...props} />
          <input type="hidden" name="intent" value="withdraw" />
          <p className="change-title">{title}</p>
          <p className="form-hint">
            It comes off every request, test sheet, and workpaper that uses it.
            The file and who withdrew it stay on record, and it can be restored.
          </p>
          <ImpactPreview state={impact} action="WITHDRAW" onRetry={retry} />
          <ReasonField
            id={`${uid}-why`}
            name="reason"
            value={reason}
            required={false}
            placeholder="For example, uploaded to the wrong control"
            onChange={setReason}
          />
          {problemLine}
          <div className="file-changes-actions">
            <button
              type="submit"
              className="btn-sm btn-danger"
              {...heldControl(off, offWhy)}
            >
              {sending ? (
                <>
                  <span className="spinner small" aria-hidden="true" />{" "}
                  Withdrawing…
                </>
              ) : (
                "Withdraw"
              )}
            </button>
            {cancelButton}
          </div>
        </form>
      ) : null}
      {mode === "remove" ? (
        <form
          ref={focus.ref}
          autoComplete="off"
          className="change-form"
          noValidate
          onSubmit={remove}
        >
          <p className="change-title">{title}</p>
          <p className="form-hint">
            The file is removed from this request only. It stays on its control
            and on any other request it serves, and is not withdrawn.
          </p>
          <ImpactPreview
            state={impact}
            action="REMOVE_FROM_REQUEST"
            unchecked={REMOVAL_UNCHECKED}
            onRetry={retry}
          />
          {unchecked ? null : (
            <ReasonField
              id={`${uid}-why`}
              value={reason}
              required
              placeholder="For example, it belongs to another request"
              onChange={setReason}
            />
          )}
          {problemLine}
          <div className="file-changes-actions">
            {unchecked ? null : (
              <button
                type="submit"
                className="btn-sm"
                {...heldControl(off, offWhy)}
              >
                {sending ? (
                  <>
                    <span className="spinner small" aria-hidden="true" />{" "}
                    Removing…
                  </>
                ) : (
                  "Remove from this request"
                )}
              </button>
            )}
            {cancelButton}
          </div>
        </form>
      ) : null}
    </div>
  );
}

// One change form open at a time

type FormStore = {
  get: () => OpenForm<unknown>;
  set: (next: OpenForm<unknown>) => void;
  subscribe: (listener: () => void) => () => void;
};

function formStore(): FormStore {
  let state: OpenForm<unknown> = null;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next) => {
      state = next;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// One change form open on the page (E1 design review, round 5: a form opened on one row
// stayed open while another opened on the next, each with its own Cancel). The page is
// the one owner: the D&I list's items, the control's own file cards, the Withdrawn list.
const pageForms = formStore();

/**
 * The change form a row or a card shows, owned by the page: opening one closes any other
 * (it unmounts; focus stays on the control that opened the new one), closing it closes
 * only its own, and a row that leaves the page closes its form. Used by every row and
 * card that opens a change form, never a state of its own.
 */
export function useChangeForm<T>(): [T | null, (next: T | null) => void] {
  const owner = useId();
  const open = useSyncExternalStore(
    pageForms.subscribe,
    pageForms.get,
    () => null,
  );
  const set = useCallback(
    (next: T | null) =>
      pageForms.set(nextOpenForm(pageForms.get(), owner, next)),
    [owner],
  );
  useEffect(
    () => () => pageForms.set(nextOpenForm(pageForms.get(), owner, null)),
    [owner],
  );
  return [
    open !== null && open.owner === owner ? (open.value as T) : null,
    set,
  ];
}

/** A list's confirmation, said once above it: what a change made on one of its cards
 * did, which stays while the card itself leaves the list (a withdrawn file). */
const ListDoneContext = createContext<((message: string) => void) | null>(null);

/** The list that says its cards' confirmations (the control's own file list): the last
 * confirmation above it, where focus goes. */
export function ChangeList({ children }: { children: ReactNode }) {
  const [done, setDone] = useState<string | null>(null);
  return (
    <ListDoneContext.Provider value={setDone}>
      {done !== null ? (
        <p className="ep-done" role="status">
          <UiIcon name="check" size={14} />
          <span>{done}</span>
        </p>
      ) : null}
      {children}
    </ListDoneContext.Provider>
  );
}

/**
 * A file card's actions in the control's own file list: Download, Replace file and
 * Withdraw from the engagement… (last) behind the card's "…" menu, beside Preview, and
 * the form one opens across the card's row (E1 design review, 18 November 2026). One form
 * open in the list at a time; a confirmed change is said above the list, where it stays
 * once the card has gone (round 5: the confirmation went with the withdrawn card, and
 * focus with it).
 */
export function FileCardActions({
  organizationId,
  projectId,
  fileId,
  fileName,
  blocked,
  canAct,
  controlId,
  step,
}: {
  organizationId: string;
  projectId: string;
  fileId: string;
  fileName: string;
  blocked: string | null;
  canAct: boolean;
  controlId: string;
  step: string | null;
}) {
  const [form, setForm] = useChangeForm<"replace" | "withdraw">();
  const say = useContext(ListDoneContext);
  if (form !== null) {
    return (
      <div className="evidence-file-tools is-open">
        <FileChanges
          organizationId={organizationId}
          projectId={projectId}
          fileId={fileId}
          fileName={fileName}
          blocked={blocked}
          controlId={controlId}
          step={step}
          start={form}
          onCancel={() => setForm(null)}
          {...(say === null
            ? {}
            : {
                onDone: (message: string) => {
                  setForm(null);
                  say(message);
                },
              })}
        />
      </div>
    );
  }
  const items: RowMenuItem[] = [
    {
      label: "Download",
      icon: "arrowDown" as const,
      href: `/workspace/evidence-files/${fileId}?organization=${organizationId}&project=${projectId}`,
    },
    ...(canAct
      ? [
          {
            label: FILE_ACTION_LABELS.REPLACE,
            icon: "upload" as const,
            unavailable: blocked,
            onSelect: () => setForm("replace"),
          },
          {
            label: FILE_ACTION_LABELS.WITHDRAW,
            icon: "trash" as const,
            danger: true,
            unavailable: blocked,
            onSelect: () => setForm("withdraw"),
          },
        ]
      : []),
  ];
  return (
    <div className="evidence-file-tools">
      <RowMenu label={fileName} items={items} />
    </div>
  );
}

/** One row of the Withdrawn list, as the page knows it. */
export type WithdrawnRow = {
  id: string;
  fileName: string;
  /** The file's cell, drawn by the page: its badge, name and how it came. */
  file: ReactNode;
  /** The control it was filed to, as the list names it, or null. */
  control: string | null;
  reason: string;
  /** Under the reason: the version that replaced it, where one did. */
  replaced: ReactNode;
  withdrawnOn: string;
  withdrawnBy: string;
  downloadHref: string;
  /** Not replaced, and the person may restore it. */
  restorable: boolean;
};

type Restored = { row: WithdrawnRow; index: number; message: string };

type WithdrawnState = {
  restored: readonly Restored[];
  add: (entry: Restored) => void;
};

const WithdrawnContext = createContext<WithdrawnState | null>(null);

/** The Withdrawn list and its count: the files restored here stay on the list, in their
 * new state, and the count says so (E1 design review, round 5: the count said 0 withdrawn
 * beside a row still listed with its withdrawal date). */
export function WithdrawnScope({ children }: { children: ReactNode }) {
  const [restored, setRestored] = useState<readonly Restored[]>([]);
  const add = useCallback(
    (entry: Restored) => setRestored((now) => [...now, entry]),
    [],
  );
  return (
    <WithdrawnContext.Provider value={{ restored, add }}>
      {children}
    </WithdrawnContext.Provider>
  );
}

/** "1 withdrawn · 1 restored just now": the files the server still lists as withdrawn,
 * less those restored here, and those restored here. */
export function WithdrawnCount({ ids }: { ids: readonly string[] }) {
  const scope = useContext(WithdrawnContext);
  const back = scope?.restored ?? [];
  const still = ids.filter(
    (id) => !back.some((entry) => entry.row.id === id),
  ).length;
  return (
    <span className="grid-count">{withdrawnCountLine(still, back.length)}</span>
  );
}

/** Why it was withdrawn: up to two lines; a longer reason opens in full under its row. */
function WithdrawnReason({
  row,
  open,
  onToggle,
  controls,
}: {
  row: WithdrawnRow;
  open: boolean;
  onToggle: () => void;
  controls: string;
}) {
  const text = useRef<HTMLSpanElement>(null);
  const [long, setLong] = useState(false);
  useEffect(() => {
    const element = text.current;
    if (element === null) {
      return;
    }
    // Longer than its two lines: measured, as the column's width decides it.
    const measure = () =>
      setLong(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      {/* Open, the reason shows in full in its own cell, once (E1 design review: it was
          also repeated in a row under it). */}
      <span
        className={open ? "withdrawn-why is-open" : "withdrawn-why"}
        id={controls}
        ref={text}
      >
        {row.reason}
      </span>
      {long || open ? (
        <button
          type="button"
          className="as-link withdrawn-why-toggle"
          aria-expanded={open}
          aria-controls={controls}
          onClick={onToggle}
        >
          {open ? "Hide reason" : "Show reason"}
        </button>
      ) : null}
      {row.replaced}
    </>
  );
}

/**
 * The Withdrawn list's rows, with Restore in place (E1 design review, 18 November 2026).
 * Restore opens its form as a full-width row under the file's row; once the server
 * confirmed it, the row says its new state ("Restored just now · back on …") with the
 * confirmation under it, and stays on the list while the person is there. A row the
 * person is acting on stays too while the page is read again (round 5: a refusal because
 * the file was restored meanwhile vanished with its row when the list was read again).
 * A long reason opens in full under its row. Under 640 px each row stacks: the file, why,
 * "Withdrawn {date} by {name}", then Download and Restore (round 5: the File and Why
 * columns measured 0 at 390 px).
 */
export function WithdrawnRows({
  organizationId,
  projectId,
  keep,
  rows,
  head,
  empty,
  columns,
}: {
  organizationId: string;
  projectId: string;
  keep: Record<string, string>;
  rows: readonly WithdrawnRow[];
  head: ReactNode;
  empty: ReactNode;
  columns: number;
}) {
  const uid = useId();
  const [open, setOpen] = useChangeForm<string>();
  // The row its form was opened on, as it was then: kept while the form is open.
  const [pinned, setPinned] = useState<{
    row: WithdrawnRow;
    index: number;
  } | null>(null);
  const [reasonOpen, setReasonOpen] = useState<string | null>(null);
  const scope = useContext(WithdrawnContext);
  const [localRestored, setLocalRestored] = useState<readonly Restored[]>([]);
  const restored = scope?.restored ?? localRestored;
  const addRestored =
    scope?.add ??
    ((entry: Restored) => setLocalRestored((now) => [...now, entry]));
  const keptOpen =
    open !== null && pinned !== null && pinned.row.id === open ? pinned : null;
  const shown: Array<{ row: WithdrawnRow; message: string | null }> = rows
    .filter((row) => !restored.some((entry) => entry.row.id === row.id))
    .map((row) => ({ row, message: null }));
  const extras: Array<{
    row: WithdrawnRow;
    index: number;
    message: string | null;
  }> = [
    ...restored,
    ...(keptOpen !== null &&
    !rows.some((row) => row.id === keptOpen.row.id) &&
    !restored.some((entry) => entry.row.id === keptOpen.row.id)
      ? [{ ...keptOpen, message: null }]
      : []),
  ];
  for (const entry of [...extras].sort((a, b) => a.index - b.index)) {
    shown.splice(Math.min(entry.index, shown.length), 0, {
      row: entry.row,
      message: entry.message,
    });
  }
  if (shown.length === 0) {
    return <>{empty}</>;
  }
  return (
    <div className="grid-scroll">
      <table className="table data-grid is-fixed evidence-grid withdrawn-grid">
        {head}
        <tbody>
          {shown.map(({ row, message }) => [
            <tr
              key={row.id}
              className={message !== null ? "is-restored" : undefined}
            >
              <td className="col-file">{row.file}</td>
              <td className="col-control">
                {row.control !== null ? (
                  <span className="mono item-ref">{row.control}</span>
                ) : (
                  "—"
                )}
              </td>
              <td className="col-why">
                <WithdrawnReason
                  row={row}
                  open={reasonOpen === row.id}
                  controls={`${uid}-${row.id}-reason`}
                  onToggle={() =>
                    setReasonOpen(reasonOpen === row.id ? null : row.id)
                  }
                />
              </td>
              <td className="col-added">
                {message !== null ? (
                  <span className="withdrawn-state">
                    <RefText text={restoredLine(row.control)} />
                  </span>
                ) : (
                  <>
                    <span className="withdrawn-when">
                      <span className="withdrawn-label">Withdrawn </span>
                      {row.withdrawnOn}
                    </span>{" "}
                    {/* Its own line, cut with an ellipsis in the fixed grid; the title
                        holds the whole name (.is-fixed td > .cell-sub[title]). */}
                    <small className="cell-sub" title={`by ${row.withdrawnBy}`}>
                      by {row.withdrawnBy}
                    </small>
                  </>
                )}
              </td>
              <td className="col-restore">
                <span className="withdrawn-actions">
                  <a className="btn btn-ghost btn-sm" href={row.downloadHref}>
                    Download
                  </a>
                  {row.restorable && message === null ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      aria-expanded={open === row.id}
                      onClick={() => {
                        if (open === row.id) {
                          setOpen(null);
                          return;
                        }
                        setPinned({
                          row,
                          index: rows.findIndex((each) => each.id === row.id),
                        });
                        setOpen(row.id);
                      }}
                    >
                      Restore
                    </button>
                  ) : null}
                </span>
              </td>
            </tr>,
            open === row.id && message === null ? (
              <RowExtra
                key={`${row.id}-restore`}
                columns={columns}
                className="withdrawn-row-extra"
              >
                <RestoreForm
                  organizationId={organizationId}
                  projectId={projectId}
                  fileId={row.id}
                  fileName={row.fileName}
                  keep={keep}
                  onCancel={() => setOpen(null)}
                  onDone={(said) => {
                    setOpen(null);
                    addRestored({
                      row,
                      index:
                        pinned !== null && pinned.row.id === row.id
                          ? pinned.index
                          : Math.max(
                              0,
                              rows.findIndex((each) => each.id === row.id),
                            ),
                      message: said,
                    });
                  }}
                />
              </RowExtra>
            ) : null,
            message !== null ? (
              <RowExtra
                key={`${row.id}-done`}
                columns={columns}
                className="withdrawn-row-extra"
              >
                <p className="ep-done" role="status">
                  <UiIcon name="check" size={14} />
                  <span>{message}</span>
                </p>
              </RowExtra>
            ) : null,
          ])}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Restoring a withdrawn file, with why, in place: what restoring does (its impact), the
 * reason, Restore and Cancel. Held where the server says it cannot be restored (a replaced
 * file stays in its version history). Confirmed only once the server has, to the caller,
 * which says it on the file's row; the page is then read again in place.
 */
function RestoreForm({
  organizationId,
  projectId,
  fileId,
  fileName,
  keep,
  onCancel,
  onDone,
}: {
  organizationId: string;
  projectId: string;
  fileId: string;
  fileName: string;
  keep: Record<string, string>;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const uid = useId();
  const focus = useFocusReturn();
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const impact = useImpact(
    { organizationId, projectId },
    { fileId, action: "RESTORE" },
    attempt,
  );
  const held = impact?.status === "ready" && !impact.impact.allowed;
  const title = (
    <>
      Restore <strong>{fileName}</strong>
    </>
  );

  /** Cancel, Close or Escape: the form goes, and focus goes back to its Restore. */
  const cancel = () => {
    if (sending) {
      return;
    }
    focus.returnFocus("back");
    onCancel();
  };

  async function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending || !reasonReady(reason, true)) {
      return;
    }
    const form = new FormData(event.currentTarget);
    setSending(true);
    setProblem(null);
    setRefused(null);
    const answer = await sendChange(form);
    setSending(false);
    if (answer.notice !== "restored") {
      if (answer.detail.trim() !== "") {
        setRefused(changeProblem(answer.notice, answer.detail));
        setAttempt((count) => count + 1);
        // Where the read holds the restoration, its held box takes the focus.
        focus.returnFocus("answer");
      } else {
        setProblem(changeProblem(answer.notice, answer.detail));
      }
      return;
    }
    // The confirmation on the file's row takes the focus.
    focus.returnFocus("answer");
    onDone(restoredMessage(fileName));
    router.refresh();
  }

  if (held) {
    return (
      <HeldChange
        title={title}
        impact={impact}
        action="RESTORE"
        onClose={cancel}
        focusRef={focus.ref}
      />
    );
  }
  const shownProblem =
    problem ??
    (refused !== null && impact?.status !== "loading" ? refused : null);
  return (
    <form
      ref={focus.ref}
      autoComplete="off"
      method="post"
      action="/workspace/evidence-change"
      className="change-form"
      noValidate
      onSubmit={restore}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !sending) {
          event.stopPropagation();
          cancel();
        }
      }}
    >
      <Hidden
        organizationId={organizationId}
        projectId={projectId}
        fileId={fileId}
        keep={keep}
      />
      <input type="hidden" name="intent" value="restore" />
      <p className="change-title">{title}</p>
      <ImpactPreview
        state={impact}
        action="RESTORE"
        onRetry={() => setAttempt((count) => count + 1)}
      />
      <ReasonField
        id={`${uid}-why`}
        name="reason"
        value={reason}
        required
        label="Why restore it"
        onChange={setReason}
      />
      {shownProblem !== null ? (
        <p className="change-problem" role="alert">
          {shownProblem}
        </p>
      ) : null}
      <div className="file-changes-actions">
        <button
          type="submit"
          className="btn-sm"
          {...heldControl(
            sending || !reasonReady(reason, true),
            reasonReady(reason, true) ? undefined : `${uid}-why-rule`,
          )}
        >
          {sending ? (
            <>
              <span className="spinner small" aria-hidden="true" /> Restoring…
            </>
          ) : (
            "Restore"
          )}
        </button>
        <button
          type="button"
          className="btn-ghost btn-sm"
          aria-disabled={sending || undefined}
          onClick={cancel}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * A filing or application form sent in place (E1): the page's own form, its fields
 * as they are, posted for a JSON answer. While it is on its way it is busy and a second
 * press sends nothing (its controls are never switched off, so keyboard focus stays where
 * the person pressed); a refusal is said under it in the server's own words (a move or an
 * application change something relies on, with how to clear it); once the server
 * confirmed it, the page comes back in place to where a reload would have landed, with
 * its notice. Its Cancel, where it has one, gives focus back to what opened it. Without
 * script the form posts and reloads as before.
 */
export function InPlaceForm({
  action,
  form,
  className,
  children,
  onDone,
  onCancel,
}: {
  action: "/workspace/evidence-filing" | "/workspace/evidence-application";
  form: "filing" | "application";
  className?: string;
  children: ReactNode;
  /** Confirmed by the server: the caller says so where the person acted, and the page
   * is read again in place. Without it the page comes back with its notice. */
  onDone?: () => void;
  /** A form opened from a row: its Cancel, after the form's own controls. */
  onCancel?: () => void;
}) {
  const router = useRouter();
  const moveCheck = useMoveCheck();
  const focus = useFocusReturn();
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) {
      return;
    }
    const fields = new FormData(event.currentTarget);
    setSending(true);
    setProblem(null);
    let status = 0;
    let detail = "";
    let location: string | null = null;
    try {
      const response = await fetch(action, {
        method: "POST",
        headers: { accept: "application/json" },
        body: fields,
      });
      const body = (await response.json()) as {
        status?: unknown;
        detail?: unknown;
        location?: unknown;
      };
      status = typeof body.status === "number" ? body.status : 0;
      detail = typeof body.detail === "string" ? body.detail : "";
      location =
        typeof body.location === "string" ? localPath(body.location) : null;
    } catch {
      status = 0;
    }
    setSending(false);
    const refused = filingProblem(status, detail, form);
    if (refused !== null) {
      // Under a move check, a refusal reads the move's impact again: a reliance is then
      // the held box above the forms, said once (never also a red line here).
      if (status === 409 && moveCheck !== null) {
        moveCheck.refused(refused);
        return;
      }
      setProblem(refused);
      return;
    }
    if (onDone !== undefined) {
      // The confirmation the caller says takes the focus.
      focus.returnFocus("answer");
      onDone();
      router.refresh();
    } else if (location !== null) {
      // The page's notice, once it is back, takes the focus.
      focus.returnFocus("answer");
      router.replace(location, { scroll: false });
    } else {
      router.refresh();
    }
  }

  return (
    <form
      ref={focus.ref}
      autoComplete="off"
      method="post"
      action={action}
      className={className}
      data-in-place=""
      aria-busy={sending}
      onSubmit={send}
    >
      {children}
      {onCancel !== undefined ? (
        <button
          type="button"
          className="btn-ghost btn-sm"
          aria-disabled={sending || undefined}
          onClick={() => {
            if (!sending) {
              focus.returnFocus("back");
              onCancel();
            }
          }}
        >
          Cancel
        </button>
      ) : null}
      {problem !== null ? (
        <p className="change-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
