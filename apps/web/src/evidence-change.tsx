"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";

import {
  CHANGE_NOTICES,
  type ChangeNotice,
  changeNoticeParam,
  cleanReason,
} from "./evidence-change-model";
import { MAX_UPLOAD_BYTES } from "./evidence-model";
import { formatBytes } from "./format";
import { UiIcon } from "./ui-icon";

type Props = {
  organizationId: string;
  projectId: string;
  fileId: string;
  fileName: string;
  /** Why the file cannot change now, or null. */
  blocked: string | null;
  /** A control's Evidence tab to come back to; otherwise the evidence page. */
  controlId?: string;
  keep?: Record<string, string>;
  /** Open on this form, as a menu choice does, instead of on the two buttons. */
  start?: "replace" | "withdraw";
  /** Cancel closes the form (the menu's caller hides it) instead of showing the buttons. */
  onCancel?: () => void;
};

function Hidden({
  organizationId,
  projectId,
  fileId,
  controlId,
  keep,
}: Omit<Props, "fileName" | "blocked" | "start" | "onCancel">) {
  return (
    <>
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="project_id" value={projectId} />
      <input type="hidden" name="file_id" value={fileId} />
      {controlId !== undefined ? (
        <input type="hidden" name="control_id" value={controlId} />
      ) : null}
      {Object.entries(keep ?? {}).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
    </>
  );
}

/** Replace a file with a corrected one, or withdraw it. Both keep the original on record. */
export function FileChanges(props: Props) {
  const { organizationId, projectId, fileId, fileName, blocked, controlId } =
    props;
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"idle" | "replace" | "withdraw">(
    props.start ?? "idle",
  );
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

  if (blocked !== null) {
    return (
      <p className="form-hint change-blocked">
        <UiIcon name="info" size={13} /> {blocked}
      </p>
    );
  }

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
      };
      if (typeof body.notice === "string" && body.notice in CHANGE_NOTICES) {
        notice = body.notice as ChangeNotice;
      }
      newId = typeof body.file_id === "string" ? body.file_id : null;
    } catch {
      notice = "unavailable";
    }
    setSending(false);
    if (notice !== "replaced") {
      setProblem(CHANGE_NOTICES[notice]);
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
      params.set("tab", "evidence");
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
            <UiIcon name="upload" size={13} /> Replace file
          </button>
          <button
            type="button"
            className="btn-ghost btn-sm is-danger"
            onClick={() => {
              setMode("withdraw");
              setReason("");
            }}
          >
            <UiIcon name="x" size={13} /> Withdraw
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
          <div className="change-pick">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => input.current?.click()}
              disabled={sending}
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
            />
          </label>
          {problem !== null ? (
            <p className="change-problem" role="alert">
              {problem}
            </p>
          ) : null}
          <div className="file-changes-actions">
            <button
              type="submit"
              className="btn-sm"
              disabled={sending || picked === null}
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
          </div>
        </form>
      ) : null}
      {mode === "withdraw" ? (
        <form
          autoComplete="off"
          className="change-form"
          method="post"
          action="/workspace/evidence-change"
        >
          <Hidden {...props} />
          <input type="hidden" name="intent" value="withdraw" />
          <p className="change-title">
            Withdraw <strong>{fileName}</strong>
          </p>
          <p className="form-hint">
            It comes off its request, testing, and workpapers. The file and who
            withdrew it stay on record, and it can be restored.
          </p>
          <div className="file-changes-actions">
            <button type="submit" className="btn-sm btn-danger">
              Withdraw
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={cancel}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
