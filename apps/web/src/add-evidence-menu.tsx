"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import {
  decisionProblem,
  documentLine,
  type PolicyDocument,
  policiesHref,
} from "./policy-evidence-model";
import { RowMenu } from "./row-menu";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string; controlId: string };

/**
 * Add evidence on an item as a choice (the product owner, 28 October 2026: "provide an
 * option to link an existing evidences like policies or upload an evidence directly"):
 * upload files, file a policy or procedure on file, or use a file the control already
 * holds. Each is a person's choice; the item shows the evidence once the server confirms.
 */
export function AddEvidenceMenu({
  ids,
  itemId,
  itemTitle,
  pick,
  running,
  documents,
  held,
  onLink,
  onFiled,
}: {
  ids: Ids;
  itemId: string;
  itemTitle: string;
  /** Opens the file picker (the item's upload). */
  pick: () => void;
  running: boolean;
  /** The policies and procedures on file that apply to the control. */
  documents: readonly PolicyDocument[];
  /** The control's files that do not serve the item yet. */
  held: ReadonlyArray<{ id: string; name: string }>;
  /** A person links a held file to the item, with why. */
  onLink: (fileId: string, reason: string) => Promise<boolean>;
  /** A policy was filed: the proposals and the item are read again. */
  onFiled: () => void;
}) {
  const [mode, setMode] = useState<"policy" | "held" | null>(null);
  return (
    <div className="ae">
      {running ? (
        <span className="ae-running" aria-live="polite">
          <span className="spinner small" aria-hidden="true" />
          Uploading…
        </span>
      ) : (
        <RowMenu
          label={`Add evidence for ${itemTitle}`}
          trigger={{ label: "Add evidence", icon: "plus" }}
          items={[
            { label: "Upload files", icon: "upload", onSelect: pick },
            {
              label: "Use a policy on file",
              icon: "file",
              onSelect: () => setMode("policy"),
              unavailable:
                documents.length === 0
                  ? "No policy or procedure on file applies to this control."
                  : null,
            },
            {
              label: "Use a file the control holds",
              icon: "layers",
              onSelect: () => setMode("held"),
              unavailable:
                held.length === 0
                  ? "The control holds no other file yet."
                  : null,
            },
          ]}
        />
      )}
      {mode === "policy" ? (
        <PolicyPicker
          ids={ids}
          itemId={itemId}
          documents={documents}
          onCancel={() => setMode(null)}
          onFiled={() => {
            setMode(null);
            onFiled();
          }}
        />
      ) : null}
      {mode === "held" ? (
        <HeldPicker
          held={held}
          onCancel={() => setMode(null)}
          onLink={async (fileId, reason) => {
            if (await onLink(fileId, reason)) {
              setMode(null);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function PolicyPicker({
  ids,
  itemId,
  documents,
  onCancel,
  onFiled,
}: {
  ids: Ids;
  itemId: string;
  documents: readonly PolicyDocument[];
  onCancel: () => void;
  onFiled: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [chosen, setChosen] = useState<string>(
    () => documents.find((d) => d.usable)?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function file() {
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch("/workspace/policy-evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          organization_id: ids.organizationId,
          project_id: ids.projectId,
          control_id: ids.controlId,
          item_id: itemId,
          document_id: chosen,
          decision: "choose",
        }),
      });
      const answer = (await response.json()) as {
        status?: number;
        detail?: string;
      };
      if (answer.status !== 200) {
        setProblem(decisionProblem(answer.status ?? 0, answer.detail ?? ""));
        setBusy(false);
        return;
      }
      onFiled();
      router.refresh();
    } catch {
      setProblem(decisionProblem(0, ""));
    }
    setBusy(false);
  }

  return (
    <fieldset className="ae-panel">
      <legend>Use a policy on file</legend>
      <ul>
        {documents.map((document) => (
          <li key={document.id}>
            <label className={document.usable ? undefined : "is-off"}>
              <input
                type="radio"
                name={`${id}-policy`}
                value={document.id}
                checked={chosen === document.id}
                disabled={!document.usable}
                onChange={() => setChosen(document.id)}
              />
              <span>
                <strong>{document.title}</strong>
                <small>{documentLine(document)}</small>
                {document.usable ? null : (
                  <small className="ae-off">
                    <a
                      className="text-link is-plain"
                      href={policiesHref(ids, document.id)}
                    >
                      Replace it with its file
                    </a>{" "}
                    to use it as evidence.
                  </small>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {problem !== null ? (
        <p className="pm-error" role="alert">
          {problem}
        </p>
      ) : null}
      <span className="ae-actions">
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-sm"
          disabled={busy || chosen === ""}
          onClick={() => void file()}
        >
          {busy ? <span className="spinner small" aria-hidden="true" /> : null}
          Add evidence
          <UiIcon name="arrow" size={14} />
        </button>
      </span>
    </fieldset>
  );
}

function HeldPicker({
  held,
  onCancel,
  onLink,
}: {
  held: ReadonlyArray<{ id: string; name: string }>;
  onCancel: () => void;
  onLink: (fileId: string, reason: string) => Promise<void>;
}) {
  const id = useId();
  const [fileId, setFileId] = useState(held[0]?.id ?? "");
  const [reason, setReason] = useState("Already received for this control.");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="ae-panel"
      autoComplete="off"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        await onLink(fileId, reason.trim());
        setBusy(false);
      }}
    >
      <p className="ae-legend">Use a file the control holds</p>
      <label htmlFor={`${id}-file`}>File</label>
      <select
        id={`${id}-file`}
        value={fileId}
        onChange={(event) => setFileId(event.target.value)}
      >
        {held.map((file) => (
          <option key={file.id} value={file.id}>
            {file.name}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-why`}>Why it serves this item</label>
      <input
        id={`${id}-why`}
        value={reason}
        autoComplete="off"
        onChange={(event) => setReason(event.target.value)}
      />
      <span className="ae-actions">
        <button type="button" className="btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="btn-sm"
          disabled={busy || fileId === "" || reason.trim().length < 3}
        >
          {busy ? <span className="spinner small" aria-hidden="true" /> : null}
          Use this file
        </button>
      </span>
    </form>
  );
}
