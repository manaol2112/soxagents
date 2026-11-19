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
import { ImpactPreview, useImpact, useMoveCheck } from "./evidence-impact";
import {
  FILE_ACTION_LABELS,
  type ImpactAction,
  REASON_HINT,
  REASON_OPTIONAL_HINT,
  REASON_PROBLEM,
  removedMessage,
  removeProblem,
  restoredMessage,
  withdrawnMessage,
  withdrawReason,
} from "./evidence-impact-model";
import { filingProblem, MAX_UPLOAD_BYTES } from "./evidence-model";
import { formatBytes } from "./format";
import { RowMenu, type RowMenuItem } from "./row-menu";
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
}: {
  title: ReactNode;
  impact: ReturnType<typeof useImpact>;
  action: ImpactAction;
  onClose: () => void;
}) {
  return (
    <div className="change-form is-held">
      <p className="change-title">{title}</p>
      <ImpactPreview state={impact} action={action} />
      <div className="file-changes-actions">
        <button
          type="button"
          className="btn-secondary btn-sm"
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
  // Held while the server says the change cannot be made now.
  const held = impact?.status === "ready" && !impact.impact.allowed;
  // How the file serves the item, at the version the person sees: what a removal sends.
  const removal =
    impact?.status === "ready" && impact.impact.allowed
      ? impact.impact.removal
      : null;
  const close = () => {
    setPicked(null);
    setProblem(null);
    setRefused(null);
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
  };

  async function replace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    const why = cleanReason(reason);
    if (why === null || props.requirementId === undefined) {
      setProblem(REASON_PROBLEM);
      return;
    }
    if (removal === null) {
      setProblem(REMOVAL_UNKNOWN);
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
      disabled={sending}
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
        />
      </div>
    );
  }

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
            <UiIcon name="trash" size={13} /> {FILE_ACTION_LABELS.WITHDRAW}
          </button>
        </div>
      ) : null}
      {mode === "replace" ? (
        <form
          autoComplete="off"
          className="change-form"
          noValidate
          onSubmit={replace}
        >
          <p className="change-title">{title}</p>
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
              disabled={sending}
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
            <button type="submit" className="btn-sm" disabled={sending}>
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
          <ImpactPreview state={impact} action="WITHDRAW" />
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
              disabled={sending}
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
          autoComplete="off"
          className="change-form"
          noValidate
          onSubmit={remove}
        >
          <p className="change-title">{title}</p>
          <p className="form-hint">
            Only this request lets go of it. The file stays on its control and
            on any other request it serves, and it is not withdrawn.
          </p>
          <ImpactPreview
            state={impact}
            action="REMOVE_FROM_REQUEST"
            unchecked={REMOVAL_UNKNOWN}
          />
          <ReasonField
            id={`${uid}-why`}
            value={reason}
            required
            placeholder="For example, it belongs to another request"
            onChange={setReason}
          />
          {problemLine}
          <div className="file-changes-actions">
            <button
              type="submit"
              className="btn-sm"
              disabled={sending || removal === null}
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
 * A file card's actions in the control's own file list: Download, Replace file and
 * Withdraw from the engagement… (last) behind the card's "…" menu, and the form one
 * opens across the card's row, the menu out of the way while it is open (E1 design
 * review, 18 November 2026: the form opened beside a lone Download).
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
  const [form, setForm] = useState<"replace" | "withdraw" | null>(null);
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
        />
      </div>
    );
  }
  const items: RowMenuItem[] = [
    {
      label: "Download",
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

/** One row of the Withdrawn list, as the page drew it: its cells, and what may be done. */
export type WithdrawnRow = {
  id: string;
  fileName: string;
  /** The row's cells before its actions, drawn by the page. */
  cells: ReactNode;
  downloadHref: string;
  /** Not replaced, and the person may restore it. */
  restorable: boolean;
};

/**
 * The Withdrawn list's rows, with Restore in place (E1 design review, 18 November 2026).
 * Restore opens its form as a full-width row under the file's row ("Restore <name>",
 * what it does, why, Restore and Cancel); once the server confirmed it, the confirmation
 * is said on a full-width row under the file, which stays in the list while the person is
 * there, and the page is read again in place. One confirmation, on the row.
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
  const [open, setOpen] = useState<string | null>(null);
  // Restored here: kept on the list, where they were, with their confirmation.
  const [restored, setRestored] = useState<
    ReadonlyArray<{ row: WithdrawnRow; index: number; message: string }>
  >([]);
  const shown: Array<{ row: WithdrawnRow; message: string | null }> = rows
    .filter((row) => !restored.some((entry) => entry.row.id === row.id))
    .map((row) => ({ row, message: null }));
  for (const entry of [...restored].sort((a, b) => a.index - b.index)) {
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
              {row.cells}
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
                      onClick={() => setOpen(open === row.id ? null : row.id)}
                    >
                      Restore
                    </button>
                  ) : null}
                </span>
              </td>
            </tr>,
            open === row.id && message === null ? (
              <tr key={`${row.id}-restore`} className="withdrawn-row-extra">
                <td colSpan={columns}>
                  <div className="withdrawn-row-body">
                    <RestoreForm
                      organizationId={organizationId}
                      projectId={projectId}
                      fileId={row.id}
                      fileName={row.fileName}
                      keep={keep}
                      onCancel={() => setOpen(null)}
                      onDone={(said) => {
                        setOpen(null);
                        setRestored((now) => [
                          ...now,
                          {
                            row,
                            index: rows.findIndex((each) => each.id === row.id),
                            message: said,
                          },
                        ]);
                      }}
                    />
                  </div>
                </td>
              </tr>
            ) : null,
            message !== null ? (
              <tr key={`${row.id}-done`} className="withdrawn-row-extra">
                <td colSpan={columns}>
                  <div className="withdrawn-row-body">
                    <p className="ep-done" role="status">
                      <UiIcon name="check" size={14} />
                      <span>{message}</span>
                    </p>
                  </div>
                </td>
              </tr>
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

  async function restore(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cleanReason(reason) === null) {
      setProblem(REASON_PROBLEM);
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
      } else {
        setProblem(changeProblem(answer.notice, answer.detail));
      }
      return;
    }
    onDone(restoredMessage(fileName));
    router.refresh();
  }

  if (held) {
    return (
      <HeldChange
        title={title}
        impact={impact}
        action="RESTORE"
        onClose={onCancel}
      />
    );
  }
  const shownProblem =
    problem ??
    (refused !== null && impact?.status !== "loading" ? refused : null);
  return (
    <form
      autoComplete="off"
      method="post"
      action="/workspace/evidence-change"
      className="change-form"
      noValidate
      onSubmit={restore}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !sending) {
          event.stopPropagation();
          onCancel();
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
      <ImpactPreview state={impact} action="RESTORE" />
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
        <button type="submit" className="btn-sm" disabled={sending}>
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
          disabled={sending}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </form>
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
  const moveCheck = useMoveCheck();
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
