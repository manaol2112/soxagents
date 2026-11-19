"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";

import { localPath } from "./browser-url";
import { returnStep } from "./control-workflow-model";
import {
  CHANGE_NOTICES,
  type ChangeNotice,
  changeNoticeParam,
  changeProblem,
  cleanReason,
} from "./evidence-change-model";
import { ImpactPreview, useImpact } from "./evidence-impact";
import {
  FILE_ACTION_LABELS,
  removedMessage,
  removeProblem,
  restoredMessage,
  withdrawnMessage,
  withdrawReason,
} from "./evidence-impact-model";
import { filingProblem, MAX_UPLOAD_BYTES } from "./evidence-model";
import { formatBytes } from "./format";
import { UiIcon } from "./ui-icon";

type Mode = "replace" | "withdraw" | "remove";

/** "Remove from this request" sends the version the impact named; without it nothing
 * is sent. */
const REMOVAL_UNKNOWN =
  "How the file serves this request could not be checked. Refresh the page and try again.";

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

/**
 * Replace a file with a corrected one, withdraw it from the engagement, or take it off one
 * request. Each keeps the original on record, and each confirm form first says what the
 * change would do (its impact, E1): where the file is used, whose judgment goes back to
 * not reviewed, which open test sheets are tested again, and, when it cannot be made now,
 * what stands in its way, with the change held. Every change is sent in place, and a
 * refusal is said in the form in the server's own words.
 */
export function FileChanges(props: Props) {
  const { organizationId, projectId, fileId, fileName, blocked, controlId } =
    props;
  const router = useRouter();
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"idle" | Mode>(props.start ?? "idle");
  const [picked, setPicked] = useState<File | null>(null);
  const [reason, setReason] = useState(
    props.start === "replace" ? "Corrected version" : "",
  );
  const cancel = () => {
    if (props.onCancel !== undefined) {
      props.onCancel();
    } else {
      setMode("idle");
    }
  };
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A change the server confirmed, said here until the page has come back.
  const [done, setDone] = useState<string | null>(null);
  const ids = { organizationId, projectId };
  const impact = useImpact(
    ids,
    blocked !== null || mode === "idle"
      ? null
      : mode === "remove"
        ? props.requirementId === undefined
          ? null
          : {
              fileId,
              action: "REMOVE_FROM_REQUEST",
              requirementId: props.requirementId,
            }
        : { fileId, action: mode === "replace" ? "REPLACE" : "WITHDRAW" },
  );
  // Held while the server says the change cannot be made now.
  const held = impact?.status === "ready" && !impact.impact.allowed;
  // How the file serves the item, at the version the person sees: what a removal sends.
  const removal =
    impact?.status === "ready" && impact.impact.allowed
      ? impact.impact.removal
      : null;

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
    if (props.onDone !== undefined) {
      props.onDone(message);
      router.refresh();
    } else if (location !== null) {
      router.replace(location, { scroll: false });
    } else {
      router.refresh();
    }
  };

  async function replace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const why = cleanReason(reason);
    if (picked === null || why === null) {
      setProblem(CHANGE_NOTICES.invalid);
      return;
    }
    if (picked.size === 0 || picked.size > MAX_UPLOAD_BYTES) {
      setProblem("Choose a file between 1 byte and 25 MB.");
      return;
    }
    setSending(true);
    setProblem(null);
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
      setProblem(changeProblem(notice, detail));
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
    const given = withdrawReason(reason);
    if (given === null) {
      setProblem("Give a reason of 3 to 500 characters, or leave it empty.");
      return;
    }
    const form = new FormData(event.currentTarget);
    form.set("reason", given);
    setSending(true);
    setProblem(null);
    const answer = await sendChange(form);
    setSending(false);
    if (answer.notice !== "withdrawn") {
      setProblem(changeProblem(answer.notice, answer.detail));
      return;
    }
    confirmed(withdrawnMessage(fileName, given !== ""), answer.location);
  }

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const why = cleanReason(reason);
    if (why === null || props.requirementId === undefined) {
      setProblem("Give a reason of 3 to 500 characters.");
      return;
    }
    if (removal === null) {
      setProblem(REMOVAL_UNKNOWN);
      return;
    }
    setSending(true);
    setProblem(null);
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
    const refused = removeProblem(status, detail);
    if (refused !== null) {
      setProblem(refused);
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

  const problemLine =
    problem !== null ? (
      <p className="change-problem" role="alert">
        {problem}
      </p>
    ) : null;
  const cancelButton = (
    <button
      type="button"
      className="btn-ghost btn-sm"
      onClick={() => {
        setPicked(null);
        setProblem(null);
        cancel();
      }}
      disabled={sending}
    >
      Cancel
    </button>
  );

  return (
    <div className="file-changes">
      {mode === "idle" ? (
        <div className="file-changes-actions">
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              setMode("replace");
              setReason("Corrected version");
            }}
          >
            <UiIcon name="upload" size={13} /> {FILE_ACTION_LABELS.REPLACE}
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm is-danger"
            onClick={() => {
              setMode("withdraw");
              setReason("");
            }}
          >
            <UiIcon name="x" size={13} /> {FILE_ACTION_LABELS.WITHDRAW}
          </button>
        </div>
      ) : null}
      {mode === "replace" ? (
        <form autoComplete="off" className="change-form" onSubmit={replace}>
          <p className="change-title">
            Replace <strong>{fileName}</strong>
          </p>
          <p className="form-hint">
            The new file takes this one's place on its control, request, and
            samples, and the agent reads it again. This file is kept under
            Withdrawn.
          </p>
          <ImpactPreview state={impact} action="REPLACE" />
          <div className="change-pick">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => input.current?.click()}
              disabled={sending || held}
            >
              Choose the corrected file
            </button>
            <span className="change-picked">
              {picked === null
                ? "No file chosen"
                : `${picked.name} · ${formatBytes(picked.size)}`}
            </span>
            <input
              ref={input}
              type="file"
              hidden
              onChange={(event) => setPicked(event.target.files?.[0] ?? null)}
            />
          </div>
          <label>
            Why
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
              maxLength={500}
              required
              disabled={held}
            />
          </label>
          {problemLine}
          <div className="file-changes-actions">
            <button
              type="submit"
              className="btn-sm"
              disabled={sending || picked === null || held}
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
          autoComplete="off"
          className="change-form"
          method="post"
          action="/workspace/evidence-change"
          onSubmit={withdraw}
        >
          <Hidden {...props} />
          <input type="hidden" name="intent" value="withdraw" />
          <p className="change-title">
            Withdraw <strong>{fileName}</strong> from the engagement
          </p>
          <p className="form-hint">
            It comes off every request, test sheet, and workpaper that uses it.
            The file and who withdrew it stay on record, and it can be restored.
          </p>
          <ImpactPreview state={impact} action="WITHDRAW" />
          <label htmlFor={`${uid}-why`} className="change-label-line">
            Why <span className="change-optional">(optional)</span>
          </label>
          <input
            id={`${uid}-why`}
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="For example, uploaded to the wrong control"
            disabled={held}
          />
          {problemLine}
          <div className="file-changes-actions">
            <button
              type="submit"
              className="btn-sm btn-danger"
              disabled={sending || held}
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
        <form autoComplete="off" className="change-form" onSubmit={remove}>
          <p className="change-title">
            Remove <strong>{fileName}</strong> from this request
          </p>
          <p className="form-hint">
            Only this request lets go of it. The file stays on its control and
            on any other request it serves, and it is not withdrawn.
          </p>
          <ImpactPreview
            state={impact}
            action="REMOVE_FROM_REQUEST"
            unchecked={REMOVAL_UNKNOWN}
          />
          <label htmlFor={`${uid}-why`}>Why</label>
          <input
            id={`${uid}-why`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            minLength={3}
            maxLength={500}
            required
            placeholder="For example, it belongs to another request"
            disabled={held}
          />
          {problemLine}
          <div className="file-changes-actions">
            <button
              type="submit"
              className="btn-sm"
              disabled={sending || removal === null || reason.trim().length < 3}
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
            {cancelButton}
          </div>
        </form>
      ) : null}
    </div>
  );
}

/**
 * Restoring a withdrawn file, with why, in place (E1: before, the form reloaded the
 * page): the button shows the restoration on its way, the row says it once the server
 * confirmed it, and a refusal is said in the form in the server's own words. The page then
 * comes back, in place, to where a reload would have landed.
 */
export function RestoreForm({
  organizationId,
  projectId,
  fileId,
  fileName,
  keep,
}: {
  organizationId: string;
  projectId: string;
  fileId: string;
  fileName: string;
  keep?: Record<string, string>;
}) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cleanReason(reason) === null) {
      setProblem("Give a reason of 3 to 500 characters.");
      return;
    }
    const form = new FormData(event.currentTarget);
    setSending(true);
    setProblem(null);
    const answer = await sendChange(form);
    setSending(false);
    if (answer.notice !== "restored") {
      setProblem(changeProblem(answer.notice, answer.detail));
      return;
    }
    setDone(restoredMessage(fileName));
    if (answer.location !== null) {
      router.replace(answer.location, { scroll: false });
    } else {
      router.refresh();
    }
  }

  if (done !== null) {
    return (
      <p className="ep-done restore-done" role="status">
        <UiIcon name="check" size={14} />
        <span>{done}</span>
      </p>
    );
  }
  return (
    <span className={`row-menu restore-menu${open ? " is-open" : ""}`}>
      <button
        ref={toggle}
        type="button"
        className="btn btn-secondary btn-sm"
        aria-expanded={open}
        aria-controls={`${uid}-form`}
        onClick={() => {
          setOpen(!open);
          setProblem(null);
        }}
      >
        Restore
      </button>
      {open ? (
        <form
          id={`${uid}-form`}
          autoComplete="off"
          method="post"
          action="/workspace/evidence-change"
          className="row-menu-panel"
          onSubmit={restore}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !sending) {
              event.stopPropagation();
              setOpen(false);
              toggle.current?.focus();
            }
          }}
        >
          <Hidden
            organizationId={organizationId}
            projectId={projectId}
            fileId={fileId}
            {...(keep === undefined ? {} : { keep })}
          />
          <input type="hidden" name="intent" value="restore" />
          <label htmlFor={`${uid}-why`}>Why restore it</label>
          <input
            id={`${uid}-why`}
            name="reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            minLength={3}
            maxLength={500}
          />
          {problem !== null ? (
            <p className="change-problem" role="alert">
              {problem}
            </p>
          ) : null}
          <button
            type="submit"
            className="btn-sm"
            disabled={sending || reason.trim().length < 3}
          >
            {sending ? (
              <>
                <span className="spinner small" aria-hidden="true" /> Restoring…
              </>
            ) : (
              "Restore"
            )}
          </button>
        </form>
      ) : null}
    </span>
  );
}

/**
 * A filing or application form sent in place (E1): the page's own form, its fields
 * as they are, posted for a JSON answer. While it is on its way its controls are off; a
 * refusal is said under it in the server's own words (a move or an application change
 * something relies on, with how to clear it); once the server confirmed it, the page
 * comes back in place to where a reload would have landed, with its notice. Without
 * script the form posts and reloads as before.
 */
export function InPlaceForm({
  action,
  form,
  className,
  children,
  onDone,
}: {
  action: "/workspace/evidence-filing" | "/workspace/evidence-application";
  form: "filing" | "application";
  className?: string;
  children: ReactNode;
  /** Confirmed by the server: the caller says so where the person acted, and the page
   * is read again in place. Without it the page comes back with its notice. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setProblem(refused);
      return;
    }
    if (onDone !== undefined) {
      onDone();
      router.refresh();
    } else if (location !== null) {
      router.replace(location, { scroll: false });
    } else {
      router.refresh();
    }
  }

  return (
    <form
      autoComplete="off"
      method="post"
      action={action}
      className={className}
      aria-busy={sending}
      onSubmit={send}
    >
      <fieldset className="move-guard" disabled={sending}>
        {children}
      </fieldset>
      {problem !== null ? (
        <p className="change-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
