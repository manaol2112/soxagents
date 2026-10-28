"use client";

import {
  type DragEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { PANE_COUNT_EVENT } from "./controls-guide-model";
import {
  DESCRIPTION_KINDS,
  type GoverningKind,
  governedNames,
  KIND_LABEL,
  type Match,
  matchGroups,
  POLICY_KINDS,
  type Policy,
  PROPOSAL_DETAIL,
  PROPOSAL_LABEL,
  type PriorYearReference,
  type Proposal,
  type ProposalRow,
  parsePolicies,
  parsePolicy,
  parseProposals,
  parseReference,
  parseReferences,
  plural,
  policiesTile,
  priorYearTile,
  proposalGroups,
  referencesTile,
  running,
  summarize,
} from "./references-model";
import { DiscardBar, Drawer } from "./scope-actions";
import { ScopeTable } from "./scope-table";
import { UiIcon } from "./ui-icon";

type Ids = { organizationId: string; projectId: string };
type Named = { id: string; name: string };

const ROUTE = "/workspace/references";

type Variant = {
  kinds: readonly GoverningKind[];
  tile: string;
  add: string;
  table: string;
  search: string;
  heroTitle: string;
  heroText: string;
  icon: "file" | "layers";
  linkHeading: string;
  linkHint: string;
  /** The column naming what each document is linked to. */
  linkColumn: string;
  formats: string;
  accept: string;
  example: string;
};

const DOCUMENT_ACCEPT = ".docx,.pdf,.xlsx,.csv,.txt,application/pdf";

const VARIANTS: Record<"policies" | "descriptions", Variant> = {
  policies: {
    kinds: POLICY_KINDS,
    tile: "policies",
    add: "Add policy or procedure",
    table: "Policies and procedures",
    search: "Search policies and procedures",
    heroTitle: "Add the governing policies and procedures",
    heroText:
      "Upload the client's policies and procedures once and choose the systems and processes each one governs. Every control under them can cite it, and the agents read it when they review the control.",
    icon: "file",
    linkHeading: "What it governs",
    linkColumn: "Governs",
    linkHint:
      "Every control under the chosen systems and processes can cite the document, and the agents read it when they review the control.",
    formats:
      "Supported formats: Word (.docx), PDF, Excel (.xlsx), CSV, text. Up to 5 MB.",
    accept: DOCUMENT_ACCEPT,
    example: "For example: Access Management Policy",
  },
  descriptions: {
    kinds: DESCRIPTION_KINDS,
    tile: "references",
    add: "Add narrative or flow diagram",
    table: "Process narratives and flow diagrams",
    search: "Search narratives and diagrams",
    heroTitle: "Add the process narratives and flow diagrams",
    heroText:
      "Upload how each process runs, as a narrative or a flow diagram, and choose the processes and systems it describes. Every control under them can cite it, and the agents read it when they build the process understanding and review the control.",
    icon: "layers",
    linkHeading: "What it describes",
    linkColumn: "Describes",
    linkHint:
      "Every control under the chosen processes and systems can cite the document, and the agents read it when they build the process understanding and review the control.",
    formats:
      "Word (.docx), PDF, text, or a diagram image (PNG, JPEG) read by OCR. Up to 5 MB.",
    accept: `${DOCUMENT_ACCEPT},.png,.jpg,.jpeg,image/png,image/jpeg`,
    example: "For example: Procure to pay narrative",
  },
};

type Answer = { status: number; answer: unknown; detail: string };

async function send(init: RequestInit, query = ""): Promise<Answer> {
  try {
    const response = await fetch(`${ROUTE}${query}`, init);
    const body = (await response.json()) as Partial<Answer>;
    return {
      status: typeof body.status === "number" ? body.status : 0,
      answer: body.answer ?? null,
      detail: typeof body.detail === "string" ? body.detail : "",
    };
  } catch {
    return { status: 0, answer: null, detail: "" };
  }
}

const read = (ids: Ids, intent: string, extra = "") =>
  send(
    { method: "GET", cache: "no-store" },
    `?intent=${intent}&organization_id=${ids.organizationId}&project_id=${ids.projectId}${extra}`,
  );

const write = (ids: Ids, body: Record<string, unknown>) =>
  send({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      organization_id: ids.organizationId,
      project_id: ids.projectId,
      ...body,
    }),
  });

/** A control's prior-year proposals changed elsewhere on its page (the walkthrough). */
export const PRIOR_YEAR_CHANGED_EVENT = "aw:prior-year-changed";

/** The agent's prior-year proposals for one control, for its walkthrough. */
export async function controlProposals(
  ids: Ids,
  controlId: string,
): Promise<Proposal[]> {
  const answer = await read(
    ids,
    "control-prior-year",
    `&control_id=${controlId}`,
  );
  return answer.status === 200 ? parseProposals(answer.answer) : [];
}

/** Accepts one prior-year proposal: an accepted answer fills the control's question, and
 * the decision is kept on record with who made it. */
export async function acceptProposal(ids: Ids, id: string): Promise<boolean> {
  const answer = await write(ids, {
    intent: "proposals",
    accept: [id],
    dismiss: [],
  });
  if (answer.status === 200) {
    document.dispatchEvent(new CustomEvent(PRIOR_YEAR_CHANGED_EVENT));
  }
  return answer.status === 200;
}

/** The pane's tile and tab show its count as it changes. */
function tell(pane: string, tile: { count: number; status: string }) {
  document.dispatchEvent(
    new CustomEvent(PANE_COUNT_EVENT, { detail: { pane, ...tile } }),
  );
}

function problemFor(answer: Answer, fallback: string): string {
  if (answer.status === 409 && answer.detail !== "") {
    return `${answer.detail.charAt(0).toUpperCase()}${answer.detail.slice(1)}.`;
  }
  if (answer.status === 413) {
    return "The file is larger than 5 MB.";
  }
  return fallback;
}

const dateOf = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
};

function stem(name: string): string {
  return name
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

/** A file dropped or chosen; the dialog sends it itself. */
function FileDrop({
  file,
  onFile,
  formats,
  accept = DOCUMENT_ACCEPT,
}: {
  file: File | null;
  onFile: (file: File) => void;
  formats: string;
  accept?: string;
}) {
  const id = useId();
  const [over, setOver] = useState(false);
  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setOver(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped !== undefined) {
      onFile(dropped);
    }
  };
  return (
    <label
      htmlFor={`${id}-file`}
      className={`rcm-drop ry-drop${over ? " is-over" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <span className="rcm-drop-icon" aria-hidden="true">
        <UiIcon name={file === null ? "upload" : "file"} size={22} />
      </span>
      <strong>
        {file === null ? "Drag and drop the file here" : file.name}
      </strong>
      <span>
        {file === null
          ? "or choose a file to upload"
          : "Choose another file to replace it"}
      </span>
      <span className="btn btn-sm">Choose file</span>
      <small>{formats}</small>
      <input
        id={`${id}-file`}
        className="sr-only"
        type="file"
        accept={accept}
        onChange={(event) => {
          const chosen = event.target.files?.[0];
          if (chosen !== undefined) {
            onFile(chosen);
          }
        }}
      />
    </label>
  );
}

/** Systems and processes to choose, each a checkbox; at least one is required. */
function GovernsPicker({
  systems,
  processes,
  chosenSystems,
  chosenProcesses,
  onSystems,
  onProcesses,
}: {
  systems: readonly Named[];
  processes: readonly Named[];
  chosenSystems: string[];
  chosenProcesses: string[];
  onSystems: (ids: string[]) => void;
  onProcesses: (ids: string[]) => void;
}) {
  const toggle = (list: string[], value: string) =>
    list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];
  const group = (
    label: string,
    items: readonly Named[],
    chosen: string[],
    onChange: (ids: string[]) => void,
    empty: string,
  ) => (
    <fieldset className="ry-pick">
      <legend>{label}</legend>
      {items.length === 0 ? (
        <p className="ry-muted">{empty}</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={chosen.includes(item.id)}
                  onChange={() => onChange(toggle(chosen, item.id))}
                />
                {item.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
  return (
    <div className="ry-governs">
      {group(
        "Systems",
        systems,
        chosenSystems,
        onSystems,
        "No systems are in scope yet.",
      )}
      {group(
        "Processes",
        processes,
        chosenProcesses,
        onProcesses,
        "No processes are in scope yet.",
      )}
    </div>
  );
}

function AddPolicy({
  ids,
  variant,
  systems,
  processes,
  onClose,
  onSaved,
}: {
  ids: Ids;
  variant: Variant;
  systems: readonly Named[];
  processes: readonly Named[];
  onClose: () => void;
  onSaved: (policy: Policy) => void;
}) {
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<GoverningKind>(variant.kinds[0] ?? "POLICY");
  const [title, setTitle] = useState("");
  const [chosenSystems, setSystems] = useState<string[]>([]);
  const [chosenProcesses, setProcesses] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState(false);
  const entered =
    file !== null ||
    title.trim() !== "" ||
    chosenSystems.length + chosenProcesses.length > 0;
  const ready =
    file !== null &&
    title.trim() !== "" &&
    chosenSystems.length + chosenProcesses.length > 0;
  const close = () => (entered && !busy ? setAsking(true) : onClose());
  const save = async () => {
    if (!ready || file === null) {
      return;
    }
    setBusy(true);
    setProblem("");
    const form = new FormData();
    form.set("intent", "policy-upload");
    form.set("organization_id", ids.organizationId);
    form.set("project_id", ids.projectId);
    form.set("kind", kind);
    form.set("title", title.trim());
    for (const item of chosenSystems) {
      form.append("system_id", item);
    }
    for (const item of chosenProcesses) {
      form.append("process_id", item);
    }
    form.set("content", file);
    const answer = await send({ method: "POST", body: form });
    setBusy(false);
    const body = answer.answer as {
      policy?: unknown;
      readable?: unknown;
      note?: unknown;
    } | null;
    const policy = body === null ? null : parsePolicy(body.policy);
    if (answer.status === 200 && policy !== null) {
      onSaved(policy);
      return;
    }
    setProblem(
      answer.status === 200 &&
        typeof body?.note === "string" &&
        body.note !== ""
        ? body.note
        : problemFor(answer, "The document could not be added. Try again."),
    );
  };
  return (
    <Drawer
      title={variant.add}
      icon="file"
      busy={busy}
      onClose={close}
      footer={
        asking ? (
          <DiscardBar onKeep={() => setAsking(false)} onDiscard={onClose} />
        ) : (
          <>
            {problem !== "" ? (
              <p className="as-problem" role="alert">
                {problem}
              </p>
            ) : (
              <span className="sc-count">
                {chosenSystems.length + chosenProcesses.length === 0
                  ? "Governs nothing yet"
                  : `Governs ${plural(chosenSystems.length + chosenProcesses.length, "item")}`}
              </span>
            )}
            <span className="as-foot-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || !ready}
                onClick={save}
              >
                {busy ? "Adding…" : "Add document"}
              </button>
            </span>
          </>
        )
      }
    >
      <form
        className="ry-form"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FileDrop
          file={file}
          formats={variant.formats}
          accept={variant.accept}
          onFile={(chosen) => {
            setFile(chosen);
            if (title.trim() === "") {
              setTitle(stem(chosen.name));
            }
          }}
        />
        <div className="ry-row">
          <fieldset className="ry-kind">
            <legend>Type</legend>
            {variant.kinds.map((value) => (
              <label
                key={value}
                className={kind === value ? "is-on" : undefined}
              >
                <input
                  type="radio"
                  name={`${id}-kind`}
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                {KIND_LABEL[value]}
              </label>
            ))}
          </fieldset>
          <label className="as-field">
            <span>Title</span>
            <input
              type="text"
              value={title}
              maxLength={200}
              placeholder={variant.example}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        </div>
        <h3 className="ry-sub">{variant.linkHeading}</h3>
        <p className="as-hint">{variant.linkHint}</p>
        <GovernsPicker
          systems={systems}
          processes={processes}
          chosenSystems={chosenSystems}
          chosenProcesses={chosenProcesses}
          onSystems={setSystems}
          onProcesses={setProcesses}
        />
      </form>
    </Drawer>
  );
}

function ChangeScope({
  ids,
  policy,
  systems,
  processes,
  onClose,
  onSaved,
}: {
  ids: Ids;
  policy: Policy;
  systems: readonly Named[];
  processes: readonly Named[];
  onClose: () => void;
  onSaved: (policy: Policy) => void;
}) {
  const [chosenSystems, setSystems] = useState(policy.systemIds);
  const [chosenProcesses, setProcesses] = useState(policy.processIds);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const count = chosenSystems.length + chosenProcesses.length;
  const save = async () => {
    setBusy(true);
    setProblem("");
    const answer = await write(ids, {
      intent: "policy-scope",
      document_id: policy.id,
      system_ids: chosenSystems,
      process_ids: chosenProcesses,
    });
    setBusy(false);
    const saved = parsePolicy(answer.answer);
    if (answer.status === 200 && saved !== null) {
      onSaved(saved);
      return;
    }
    setProblem(problemFor(answer, "The change could not be saved. Try again."));
  };
  return (
    <Drawer
      title={`What ${policy.title} governs`}
      icon="layers"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          {problem !== "" ? (
            <p className="as-problem" role="alert">
              {problem}
            </p>
          ) : (
            <span className="sc-count">
              {count === 0
                ? "Choose at least one"
                : `Governs ${plural(count, "item")}`}
            </span>
          )}
          <span className="as-foot-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy || count === 0}
              onClick={save}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </span>
        </>
      }
    >
      <GovernsPicker
        systems={systems}
        processes={processes}
        chosenSystems={chosenSystems}
        chosenProcesses={chosenProcesses}
        onSystems={setSystems}
        onProcesses={setProcesses}
      />
      {policy.excluded > 0 ? (
        <p className="as-note">
          <UiIcon name="info" size={14} />
          {plural(policy.excluded, "control")} the document was taken off stay
          off.
        </p>
      ) : null}
    </Drawer>
  );
}

/** Removing asks first: what stops, and that the document stays on record. */
function ConfirmRemove({
  title,
  detail,
  onClose,
  onConfirm,
}: {
  title: string;
  detail: string;
  onClose: () => void;
  onConfirm: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  return (
    <Drawer
      title={title}
      icon="x"
      busy={busy}
      onClose={onClose}
      compact
      footer={
        <>
          {problem !== "" ? (
            <p className="as-problem" role="alert">
              {problem}
            </p>
          ) : (
            <span className="sc-count">Kept on record</span>
          )}
          <span className="as-foot-actions">
            <button
              type="button"
              className="btn-secondary"
              disabled={busy}
              onClick={onClose}
            >
              Keep it
            </button>
            <button
              type="button"
              className="btn as-discard"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const failed = await onConfirm();
                setBusy(false);
                if (failed !== null) {
                  setProblem(failed);
                }
              }}
            >
              {busy ? "Removing…" : "Remove"}
            </button>
          </span>
        </>
      }
    >
      <p className="ry-confirm">{detail}</p>
    </Drawer>
  );
}

function ReplacePolicy({
  ids,
  policy,
  onClose,
  onSaved,
}: {
  ids: Ids;
  policy: Policy;
  onClose: () => void;
  onSaved: (policy: Policy) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState(policy.title);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState(false);
  const close = () => (file !== null && !busy ? setAsking(true) : onClose());
  const ready = file !== null && title.trim() !== "";
  const save = async () => {
    if (!ready || file === null) {
      return;
    }
    setBusy(true);
    setProblem("");
    const form = new FormData();
    form.set("intent", "policy-replace");
    form.set("organization_id", ids.organizationId);
    form.set("project_id", ids.projectId);
    form.set("document_id", policy.id);
    form.set("title", title.trim());
    form.set("content", file);
    const answer = await send({ method: "POST", body: form });
    setBusy(false);
    const body = answer.answer as { policy?: unknown; note?: unknown } | null;
    const saved = body === null ? null : parsePolicy(body.policy);
    if (answer.status === 200 && saved !== null) {
      onSaved(saved);
      return;
    }
    setProblem(
      answer.status === 200 &&
        typeof body?.note === "string" &&
        body.note !== ""
        ? body.note
        : problemFor(answer, "The new version could not be saved. Try again."),
    );
  };
  return (
    <Drawer
      title={`Replace ${policy.title}`}
      icon="upload"
      busy={busy}
      onClose={close}
      footer={
        asking ? (
          <DiscardBar onKeep={() => setAsking(false)} onDiscard={onClose} />
        ) : (
          <>
            {problem !== "" ? (
              <p className="as-problem" role="alert">
                {problem}
              </p>
            ) : (
              <span className="sc-count">
                {file === null ? "No file chosen" : file.name}
              </span>
            )}
            <span className="as-foot-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || !ready}
                onClick={save}
              >
                {busy ? "Replacing…" : "Replace"}
              </button>
            </span>
          </>
        )
      }
    >
      <form
        className="ry-form"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FileDrop
          file={file}
          formats="Supported formats: Word (.docx), PDF, Excel (.xlsx), CSV, text. Up to 5 MB."
          onFile={setFile}
        />
        <label className="as-field">
          <span>Title</span>
          <input
            type="text"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
      </form>
      <p className="as-note">
        <UiIcon name="info" size={14} />
        The new version governs the same systems and processes, and controls
        taken off stay off. The current version ({policy.fileName}) is kept on
        record, so what was quoted from it stays traceable.
      </p>
    </Drawer>
  );
}

/**
 * Policies and procedures (decided by the product owner): each governs systems and
 * processes, and every control under them can cite it. The list updates in place.
 */
export function PoliciesPane({
  ids,
  initial,
  systems,
  processes,
  editable,
  kind = "policies",
  onChange,
}: {
  ids: Ids;
  initial: Policy[];
  systems: Named[];
  processes: Named[];
  editable: boolean;
  /** Policies and procedures, or process narratives and flow diagrams. */
  kind?: "policies" | "descriptions";
  /** Told the list as it changes (the References tab's tile counts it with the prior year). */
  onChange?: (policies: Policy[]) => void;
}) {
  const variant = VARIANTS[kind];
  const mine = (list: Policy[]) =>
    list.filter((item) => variant.kinds.includes(item.kind));
  const [policies, setPolicies] = useState(() => mine(initial));
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (onChange !== undefined) {
      onChange(policies);
    } else {
      tell(variant.tile, policiesTile(policies));
    }
  }, [policies, onChange, variant.tile]);
  const [scoping, setScoping] = useState<Policy | null>(null);
  const [replacing, setReplacing] = useState<Policy | null>(null);
  const [removing, setRemoving] = useState<Policy | null>(null);
  const [saved, setSaved] = useState("");
  const refresh = useCallback(async () => {
    const answer = await read(ids, "policies");
    if (answer.status === 200) {
      setPolicies(
        parsePolicies(answer.answer).filter((item) =>
          variant.kinds.includes(item.kind),
        ),
      );
    }
  }, [ids, variant.kinds]);
  const add = editable ? (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => setAdding(true)}
    >
      <UiIcon name="plus" size={14} />
      {variant.add}
    </button>
  ) : null;
  const dialogs = (
    <>
      {adding ? (
        <AddPolicy
          ids={ids}
          variant={variant}
          systems={systems}
          processes={processes}
          onClose={() => setAdding(false)}
          onSaved={(policy) => {
            setAdding(false);
            setSaved(`${policy.title} was added.`);
            void refresh();
          }}
        />
      ) : null}
      {scoping !== null ? (
        <ChangeScope
          ids={ids}
          policy={scoping}
          systems={systems}
          processes={processes}
          onClose={() => setScoping(null)}
          onSaved={(policy) => {
            setScoping(null);
            setSaved(`What ${policy.title} governs was saved.`);
            setPolicies((list) =>
              list.map((item) => (item.id === policy.id ? policy : item)),
            );
          }}
        />
      ) : null}
      {replacing !== null ? (
        <ReplacePolicy
          ids={ids}
          policy={replacing}
          onClose={() => setReplacing(null)}
          onSaved={(policy) => {
            const previous = replacing.id;
            setReplacing(null);
            setSaved(`${policy.title} was replaced with ${policy.fileName}.`);
            setPolicies((list) =>
              list.map((item) => (item.id === previous ? policy : item)),
            );
          }}
        />
      ) : null}
      {removing !== null ? (
        <ConfirmRemove
          title={`Remove ${removing.title}`}
          detail={`It stops applying to ${plural(removing.controls, "control")} and leaves this list. The document stays on record, with who removed it and when, so what the agents quoted from it stays traceable.`}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const answer = await write(ids, {
              intent: "policy-remove",
              document_id: removing.id,
            });
            if (answer.status !== 200) {
              return problemFor(
                answer,
                "The document could not be removed. Try again.",
              );
            }
            setSaved(`${removing.title} was removed.`);
            setRemoving(null);
            setPolicies(parsePolicies(answer.answer));
            return null;
          }}
        />
      ) : null}
    </>
  );
  if (policies.length === 0) {
    return (
      <>
        {saved !== "" ? (
          <p className="ry-saved" role="status">
            <UiIcon name="check" size={14} />
            {saved}
          </p>
        ) : null}
        <section className="card cs-hero">
          <span className="cs-hero-dots" aria-hidden="true" />
          <span className="cs-hero-mark" aria-hidden="true">
            <UiIcon name={variant.icon} size={30} />
            <span className="cs-hero-plus">
              <UiIcon name="plus" size={12} />
            </span>
          </span>
          <h2>{variant.heroTitle}</h2>
          <p>{variant.heroText}</p>
          {add === null ? null : <div className="cs-hero-actions">{add}</div>}
        </section>
        {dialogs}
      </>
    );
  }
  return (
    <>
      {saved !== "" ? (
        <p className="ry-saved" role="status">
          <UiIcon name="check" size={14} />
          {saved}
        </p>
      ) : null}
      <ScopeTable
        label={variant.table}
        columns={["Document", variant.linkColumn, "Controls", "Added"]}
        searchLabel={variant.search}
        kindLabel="Type"
        kinds={[
          ...variant.kinds.map((item) => [item, KIND_LABEL[item]] as const),
        ]}
        action={add}
        rows={policies.map((policy) => {
          const names = governedNames(policy, systems, processes);
          return {
            id: policy.id,
            kind: policy.kind,
            text: `${policy.title} ${policy.fileName} ${names.join(" ")}`,
            cells: [
              <span key="title" className="ry-doc">
                <strong>{policy.title}</strong>
                <span className="ry-tag">{KIND_LABEL[policy.kind]}</span>
              </span>,
              <span key="governs" className="ry-chips">
                {names.length === 0 ? (
                  <span className="ry-muted">Nothing in scope</span>
                ) : (
                  names.map((name) => (
                    <span key={name} className="ry-chip">
                      {name}
                    </span>
                  ))
                )}
              </span>,
              <span key="controls">
                {policy.controls}
                {policy.excluded > 0 ? (
                  <small className="ry-muted">
                    {" "}
                    · {policy.excluded} taken off
                  </small>
                ) : null}
              </span>,
              <span key="added" className="ry-muted">
                {[policy.createdBy, dateOf(policy.createdAt)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>,
            ],
            detail: (
              <div className="ry-detail">
                <p className="ry-excerpt">{policy.excerpt}</p>
                <p className="ry-muted">
                  {policy.fileName}. A control can be taken off from its own
                  documents.
                </p>
                {editable ? (
                  <span className="ry-actions">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setScoping(policy)}
                    >
                      <UiIcon name="layers" size={14} />
                      Change what it governs
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => setReplacing(policy)}
                    >
                      <UiIcon name="upload" size={14} />
                      Replace file
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm ry-danger"
                      onClick={() => setRemoving(policy)}
                    >
                      <UiIcon name="x" size={14} />
                      Remove
                    </button>
                  </span>
                ) : null}
              </div>
            ),
          };
        })}
      />
      {dialogs}
    </>
  );
}

function UploadReference({
  ids,
  onClose,
  onSaved,
}: {
  ids: Ids;
  onClose: () => void;
  onSaved: (reference: PriorYearReference) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState(false);
  const entered = file !== null || title.trim() !== "";
  const ready = file !== null && title.trim() !== "";
  const close = () => (entered && !busy ? setAsking(true) : onClose());
  const save = async () => {
    if (!ready || file === null) {
      return;
    }
    setBusy(true);
    setProblem("");
    const form = new FormData();
    form.set("intent", "prior-upload");
    form.set("organization_id", ids.organizationId);
    form.set("project_id", ids.projectId);
    form.set("title", title.trim());
    form.set("content", file);
    const answer = await send({ method: "POST", body: form });
    setBusy(false);
    const body = answer.answer as {
      reference?: unknown;
      note?: unknown;
    } | null;
    const reference = body === null ? null : parseReference(body.reference);
    if (answer.status === 200 && reference !== null) {
      onSaved(reference);
      return;
    }
    setProblem(
      answer.status === 200 &&
        typeof body?.note === "string" &&
        body.note !== ""
        ? body.note
        : problemFor(answer, "The reference could not be added. Try again."),
    );
  };
  return (
    <Drawer
      title="Add prior-year reference"
      icon="clock"
      busy={busy}
      onClose={close}
      footer={
        asking ? (
          <DiscardBar onKeep={() => setAsking(false)} onDiscard={onClose} />
        ) : (
          <>
            {problem !== "" ? (
              <p className="as-problem" role="alert">
                {problem}
              </p>
            ) : (
              <span className="sc-count">
                {file === null ? "No file chosen" : file.name}
              </span>
            )}
            <span className="as-foot-actions">
              <button
                type="button"
                className="btn-secondary"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || !ready}
                onClick={save}
              >
                {busy ? "Uploading…" : "Upload and analyse"}
              </button>
            </span>
          </>
        )
      }
    >
      <form
        className="ry-form"
        autoComplete="off"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FileDrop
          file={file}
          formats="Prior-year workpapers, the prior RCM, or test results: Word (.docx), PDF, Excel (.xlsx), CSV, text. Up to 5 MB."
          onFile={(chosen) => {
            setFile(chosen);
            if (title.trim() === "") {
              setTitle(stem(chosen.name));
            }
          }}
        />
        <label className="as-field">
          <span>Title</span>
          <input
            type="text"
            value={title}
            maxLength={200}
            placeholder="For example: FY2025 ITGC workpapers"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
      </form>
      <p className="as-note">
        <UiIcon name="info" size={14} />
        The agent matches the document to this year&apos;s controls and proposes
        answers, exceptions to address, the prior test approach, and design
        changes. Each waits for a person. Prior-year work informs the plan; it
        is never evidence that a control operated this year.
      </p>
    </Drawer>
  );
}

function Quote({ text }: { text: string }) {
  return (
    <blockquote className="ry-quote">
      <UiIcon name="file" size={12} />
      {text}
    </blockquote>
  );
}

/** One grouped decision over the matches found the same way. */
function MatchGroup({
  title,
  detail,
  matches,
  busy,
  editable,
  onDecide,
}: {
  title: string;
  detail: string;
  matches: Match[];
  busy: boolean;
  editable: boolean;
  onDecide: (confirm: string[], reject: string[]) => void;
}) {
  const [chosen, setChosen] = useState<string[]>(() =>
    matches.map((match) => match.id),
  );
  const [open, setOpen] = useState<string | null>(null);
  // Every match is chosen again when the list itself changes, not on each render.
  const listed = matches.map((match) => match.id).join(",");
  useEffect(() => {
    setChosen(listed === "" ? [] : listed.split(","));
  }, [listed]);
  if (matches.length === 0) {
    return null;
  }
  const rest = matches
    .map((match) => match.id)
    .filter((id) => !chosen.includes(id));
  return (
    <section className="ry-group">
      <header>
        <h4>
          {title} <span>({matches.length})</span>
        </h4>
        <p className="ry-muted">{detail}</p>
      </header>
      <ul className="ry-matches">
        {matches.map((match) => (
          <li key={match.id}>
            <label className="ry-match">
              <input
                type="checkbox"
                hidden={!editable}
                disabled={!editable}
                checked={chosen.includes(match.id)}
                onChange={() =>
                  setChosen((list) =>
                    list.includes(match.id)
                      ? list.filter((item) => item !== match.id)
                      : [...list, match.id],
                  )
                }
              />
              <span className="ry-prior">
                {match.priorRef || match.priorTitle || "Prior-year item"}
              </span>
              <UiIcon name="arrow" size={12} />
              <span className="ry-now">
                <strong>{match.controlRef}</strong> {match.controlTitle}
                {match.systemName !== "" ? (
                  <span className="ry-muted"> · {match.systemName}</span>
                ) : null}
              </span>
            </label>
            <button
              type="button"
              className="ry-link"
              aria-expanded={open === match.id}
              onClick={() => setOpen(open === match.id ? null : match.id)}
            >
              {open === match.id
                ? "Hide the prior-year text"
                : "Show the prior-year text"}
            </button>
            {open === match.id ? <Quote text={match.excerpt} /> : null}
          </li>
        ))}
      </ul>
      {editable ? (
        <div className="ry-actions">
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || chosen.length === 0}
            onClick={() => onDecide(chosen, rest)}
          >
            <UiIcon name="check" size={14} />
            {rest.length === 0
              ? `Confirm ${plural(chosen.length, "match", "matches")}`
              : `Confirm ${chosen.length}, reject ${rest.length}`}
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() =>
              onDecide(
                [],
                matches.map((match) => match.id),
              )
            }
          >
            Reject all
          </button>
        </div>
      ) : null}
    </section>
  );
}

function UnmatchedItem({
  match,
  controls,
  busy,
  editable,
  onAssign,
  onSetAside,
}: {
  match: Match;
  controls: ReadonlyArray<{ id: string; label: string }>;
  busy: boolean;
  editable: boolean;
  onAssign: (controlId: string) => void;
  onSetAside: () => void;
}) {
  const [control, setControl] = useState("");
  return (
    <li className="ry-unmatched">
      <p>
        <strong>
          {match.priorRef || match.priorTitle || "Prior-year item"}
        </strong>
        {match.priorRef !== "" && match.priorTitle !== ""
          ? ` ${match.priorTitle}`
          : null}
      </p>
      <Quote text={match.excerpt.slice(0, 600)} />
      {editable ? (
        <div className="ry-actions">
          <select
            value={control}
            aria-label="This year's control"
            onChange={(event) => setControl(event.target.value)}
          >
            <option value="">Choose this year&apos;s control</option>
            {controls.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || control === ""}
            onClick={() => onAssign(control)}
          >
            Match
          </button>
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={onSetAside}
          >
            Set aside
          </button>
        </div>
      ) : null}
    </li>
  );
}

function ReferenceCard({
  ids,
  reference,
  controls,
  editable,
  onChange,
  onRemoved,
}: {
  ids: Ids;
  reference: PriorYearReference;
  controls: ReadonlyArray<{ id: string; label: string }>;
  editable: boolean;
  onChange: (reference: PriorYearReference) => void;
  onRemoved: (references: PriorYearReference[], title: string) => void;
}) {
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const summary = summarize(reference);
  const groups = matchGroups(reference);
  const working = running(reference);
  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setProblem("");
    const answer = await write(ids, { document_id: reference.id, ...body });
    setBusy(false);
    const next = parseReference(answer.answer);
    if (answer.status === 200 && next !== null) {
      onChange(next);
      return;
    }
    setProblem(problemFor(answer, "The change could not be saved. Try again."));
  };
  const skipped = reference.matches.some(
    (match) =>
      match.analysisStatus === "SKIPPED" &&
      (match.status === "PROPOSED" || match.status === "CONFIRMED"),
  );
  return (
    <article className="card ry-card">
      <header className="ry-card-head">
        <span className="ry-card-icon" aria-hidden="true">
          <UiIcon name="clock" size={18} />
        </span>
        <div>
          <h3>{reference.title}</h3>
          <p className="ry-muted">
            {[
              reference.fileName,
              reference.createdBy,
              dateOf(reference.createdAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span
          className={`ry-state is-${working ? "working" : reference.runStatus.toLowerCase()}`}
          aria-live="polite"
        >
          {working ? (
            <>
              <span className="ng-orb is-small" aria-hidden="true" />
              Agent analysing
            </>
          ) : reference.runStatus === "FAILED" ? (
            "Not finished"
          ) : (
            "Analysed"
          )}
        </span>
      </header>
      {reference.runNote !== "" && !working ? (
        <p className="ry-note">
          <UiIcon name="sparkles" size={12} />
          {reference.runNote}
        </p>
      ) : null}
      <dl className="ry-counts">
        <div>
          <dt>To confirm</dt>
          <dd>{summary.toConfirm}</dd>
        </div>
        <div>
          <dt>Confirmed</dt>
          <dd>{summary.confirmed}</dd>
        </div>
        <div>
          <dt>Not matched</dt>
          <dd>{summary.unmatched}</dd>
        </div>
        <div>
          <dt>Proposals to decide</dt>
          <dd>{summary.toDecide}</dd>
        </div>
      </dl>
      {problem !== "" ? (
        <p className="as-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <MatchGroup
        title="Matched by control reference"
        detail="The prior-year document names the same control reference. Confirming a match shows the agent's proposals for the control."
        matches={groups.byReference}
        busy={busy || working}
        editable={editable}
        onDecide={(confirm, reject) =>
          void act({ intent: "matches", confirm, reject })
        }
      />
      <MatchGroup
        title="Matched by description"
        detail="The agent matched what the control does; check each before confirming. Confirming a match shows the agent's proposals for the control."
        matches={groups.byDescription}
        busy={busy || working}
        editable={editable}
        onDecide={(confirm, reject) =>
          void act({ intent: "matches", confirm, reject })
        }
      />
      {groups.unmatched.length > 0 ? (
        <section className="ry-group">
          <header>
            <h4>
              Not matched <span>({groups.unmatched.length})</span>
            </h4>
            <p className="ry-muted">
              No control of this year matches these. Match one to a control, or
              set it aside.
            </p>
          </header>
          <ul className="ry-matches">
            {groups.unmatched.map((match) => (
              <UnmatchedItem
                key={match.id}
                match={match}
                controls={controls}
                busy={busy}
                editable={editable}
                onAssign={(controlId) =>
                  void act({
                    intent: "assign",
                    match_id: match.id,
                    control_id: controlId,
                    version: match.version,
                  })
                }
                onSetAside={() =>
                  void act({
                    intent: "set-aside",
                    match_id: match.id,
                    version: match.version,
                  })
                }
              />
            ))}
          </ul>
        </section>
      ) : null}
      {editable && !working && (skipped || reference.runStatus === "FAILED") ? (
        <div className="ry-actions">
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() => void act({ intent: "run" })}
          >
            <UiIcon name="retry" size={14} />
            Analyse again
          </button>
        </div>
      ) : null}
      {editable ? (
        <div className="ry-actions ry-card-foot">
          <button
            type="button"
            className="btn-secondary btn-sm ry-danger"
            disabled={busy}
            onClick={() => setRemoving(true)}
          >
            <UiIcon name="x" size={14} />
            Remove reference
          </button>
        </div>
      ) : null}
      {removing ? (
        <ConfirmRemove
          title={`Remove ${reference.title}`}
          detail="Its matches and proposals still waiting are taken off, and the agent stops working on it. What a person already accepted stays, and the document stays on record so its quotes stay traceable."
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            const answer = await write(ids, {
              intent: "prior-remove",
              document_id: reference.id,
            });
            if (answer.status !== 200) {
              return problemFor(
                answer,
                "The reference could not be removed. Try again.",
              );
            }
            setRemoving(false);
            onRemoved(parseReferences(answer.answer), reference.title);
            return null;
          }}
        />
      ) : null}
    </article>
  );
}

/** A proposal's own words: the answer, or the point and its detail. */
function ProposalText({ proposal }: { proposal: Proposal }) {
  return proposal.kind === "ANSWER" ? (
    <p className="ry-proposal-text">
      <span className="ry-muted">{proposal.title}</span>
      <strong>{proposal.value}</strong>
    </p>
  ) : (
    <p className="ry-proposal-text">
      <strong>{proposal.title}</strong>
      {proposal.detail !== "" ? <span>{proposal.detail}</span> : null}
    </p>
  );
}

/** The proposals waiting, one group per kind, each with one grouped decision. */
function ProposalReview({
  ids,
  references,
  editable,
  onDecided,
}: {
  ids: Ids;
  references: PriorYearReference[];
  editable: boolean;
  onDecided: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const groups = proposalGroups(references);
  if (groups.length === 0) {
    return null;
  }
  const decide = async (accept: string[], dismiss: string[]) => {
    setBusy(true);
    setProblem("");
    const answer = await write(ids, { intent: "proposals", accept, dismiss });
    setBusy(false);
    if (answer.status === 200) {
      onDecided(
        accept.length > 0
          ? `${plural(accept.length, "proposal")} accepted.`
          : `${plural(dismiss.length, "proposal")} dismissed.`,
      );
      return;
    }
    setProblem(
      problemFor(answer, "The decision could not be saved. Try again."),
    );
  };
  return (
    <section className="card ry-review" aria-labelledby="ry-review-title">
      <header className="ry-review-head">
        <span className="ry-card-icon is-ai" aria-hidden="true">
          <UiIcon name="sparkles" size={16} />
        </span>
        <div>
          <h3 id="ry-review-title">Proposals from the prior year</h3>
          <p className="ry-muted">
            Drafted by the planning agent from confirmed matches. Each quotes
            the prior-year document and waits for a person.
          </p>
        </div>
      </header>
      {problem !== "" ? (
        <p className="as-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {groups.map((group) => (
        <section key={group.kind} className="ry-group">
          <header className="ry-group-head">
            <div>
              <h4>
                {PROPOSAL_LABEL[group.kind]} <span>({group.rows.length})</span>
              </h4>
              <p className="ry-muted">{PROPOSAL_DETAIL[group.kind]}</p>
            </div>
            {editable ? (
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() =>
                  void decide(
                    group.rows.map((row) => row.id),
                    [],
                  )
                }
              >
                <UiIcon name="check" size={14} />
                Accept all {group.rows.length}
              </button>
            ) : null}
          </header>
          <ul className="ry-proposals">
            {group.rows.map((row: ProposalRow) => (
              <li key={row.id}>
                <span className="ry-control">
                  <strong>{row.controlRef}</strong> {row.controlTitle}
                  {row.systemName !== "" ? (
                    <span className="ry-muted"> · {row.systemName}</span>
                  ) : null}
                </span>
                <ProposalText proposal={row} />
                <Quote text={row.quote} />
                {editable ? (
                  <span className="ry-row-actions">
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => void decide([row.id], [])}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="ry-link"
                      disabled={busy}
                      onClick={() => void decide([], [row.id])}
                    >
                      Dismiss
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

/**
 * Prior-year references (decided by the product owner): uploaded, matched by the agent to
 * this year's controls, confirmed by a person, and the agent's proposals decided. The
 * pane refetches only its own list, and polls while the agent works.
 */
export function PriorYearPane({
  ids,
  initial,
  controls,
  editable,
  onChange,
}: {
  ids: Ids;
  /** The list as the page loaded it; null when the pane loads it itself. */
  initial: PriorYearReference[] | null;
  controls: ReadonlyArray<{ id: string; label: string }>;
  editable: boolean;
  /** Told the list as it changes; without it, the pane counts itself on its tile. */
  onChange?: (references: PriorYearReference[]) => void;
}) {
  const [loaded, setLoaded] = useState<PriorYearReference[] | null>(initial);
  const references = loaded ?? [];
  const setReferences = (
    next:
      | PriorYearReference[]
      | ((list: PriorYearReference[]) => PriorYearReference[]),
  ) =>
    setLoaded((now) => (typeof next === "function" ? next(now ?? []) : next));
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (loaded === null) {
      return;
    }
    if (onChange !== undefined) {
      onChange(loaded);
    } else {
      tell("prior-year", priorYearTile(loaded));
    }
  }, [loaded, onChange]);
  const [saved, setSaved] = useState("");
  const asked = useRef(0);
  const refresh = useCallback(async () => {
    // Only the latest answer is kept: an older one that arrives late is ignored.
    asked.current += 1;
    const mine = asked.current;
    const answer = await read(ids, "prior-year");
    if (mine === asked.current) {
      setLoaded(answer.status === 200 ? parseReferences(answer.answer) : []);
    }
  }, [ids]);
  useEffect(() => {
    if (initial === null) {
      void refresh();
    }
  }, [initial, refresh]);
  const working = references.some(running);
  useEffect(() => {
    if (!working) {
      return;
    }
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [working, refresh]);
  const add = editable ? (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => setAdding(true)}
    >
      <UiIcon name="upload" size={14} />
      Add prior-year reference
    </button>
  ) : null;
  const dialog = adding ? (
    <UploadReference
      ids={ids}
      onClose={() => setAdding(false)}
      onSaved={(reference) => {
        setAdding(false);
        setSaved(`${reference.title} was added. The agent is analysing it.`);
        setReferences((list) => [
          reference,
          ...list.filter((item) => item.id !== reference.id),
        ]);
      }}
    />
  ) : null;
  if (loaded === null) {
    return (
      <p className="ry-muted" aria-live="polite">
        Loading the prior-year references…
      </p>
    );
  }
  if (references.length === 0) {
    return (
      <>
        {saved !== "" ? (
          <p className="ry-saved" role="status">
            <UiIcon name="check" size={14} />
            {saved}
          </p>
        ) : null}
        <section className="card cs-hero">
          <span className="cs-hero-dots" aria-hidden="true" />
          <span className="cs-hero-mark" aria-hidden="true">
            <UiIcon name="clock" size={30} />
            <span className="cs-hero-plus">
              <UiIcon name="plus" size={12} />
            </span>
          </span>
          <h2>Bring in the prior year</h2>
          <p>
            Upload last year&apos;s workpapers, RCM, or test results. The agent
            matches them to this year&apos;s controls and proposes answers,
            exceptions to address, the test approach, and design changes, each
            for a person to decide.
          </p>
          {add === null ? null : <div className="cs-hero-actions">{add}</div>}
        </section>
        {dialog}
      </>
    );
  }
  return (
    <div className="ry-pane">
      <div className="cs-pane-actions">
        {saved !== "" ? (
          <p className="ry-saved" role="status">
            <UiIcon name="check" size={14} />
            {saved}
          </p>
        ) : null}
        {add}
      </div>
      <ProposalReview
        ids={ids}
        references={references}
        editable={editable}
        onDecided={(message) => {
          setSaved(message);
          void refresh();
        }}
      />
      {references.map((reference) => (
        <ReferenceCard
          key={reference.id}
          ids={ids}
          reference={reference}
          controls={controls}
          editable={editable}
          onRemoved={(list, title) => {
            setReferences(list);
            setSaved(`${title} was removed.`);
          }}
          onChange={(next) =>
            setReferences((list) =>
              list.map((item) => (item.id === next.id ? next : item)),
            )
          }
        />
      ))}
      {dialog}
    </div>
  );
}

/**
 * The prior year's proposals for one control, on its page: loaded when the page opens,
 * shown only when there are any. Accepting here is the same decision as on the
 * Systems & Processes page.
 */
export function ControlPriorYear({
  ids,
  controlId,
  editable,
}: {
  ids: Ids;
  controlId: string;
  editable: boolean;
}) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const load = useCallback(async () => {
    const answer = await read(
      ids,
      "control-prior-year",
      `&control_id=${controlId}`,
    );
    setProposals(answer.status === 200 ? parseProposals(answer.answer) : []);
  }, [ids, controlId]);
  useEffect(() => {
    void load();
    // An answer accepted in the walkthrough reloads the list here.
    const reload = () => void load();
    document.addEventListener(PRIOR_YEAR_CHANGED_EVENT, reload);
    return () => document.removeEventListener(PRIOR_YEAR_CHANGED_EVENT, reload);
  }, [load]);
  if (proposals === null || proposals.length === 0) {
    return null;
  }
  const waiting = proposals.filter((item) => item.status === "PROPOSED");
  const accepted = proposals.filter((item) => item.status === "ACCEPTED");
  const decide = async (accept: string[], dismiss: string[]) => {
    setBusy(true);
    setProblem("");
    const answer = await write(ids, { intent: "proposals", accept, dismiss });
    setBusy(false);
    if (answer.status === 200) {
      void load();
      return;
    }
    setProblem(
      problemFor(answer, "The decision could not be saved. Try again."),
    );
  };
  return (
    <section
      className="card ry-control-card"
      aria-labelledby="ry-control-title"
    >
      <header className="ry-review-head">
        <span className="ry-card-icon" aria-hidden="true">
          <UiIcon name="clock" size={16} />
        </span>
        <div>
          <h3 id="ry-control-title">Prior year</h3>
          <p className="ry-muted">
            {waiting.length > 0
              ? `${plural(waiting.length, "proposal")} from the prior-year reference to decide.`
              : `${plural(accepted.length, "point")} accepted from the prior year.`}{" "}
            A reference for planning, never evidence of operation this year.
          </p>
        </div>
        {editable && waiting.length > 1 ? (
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy}
            onClick={() =>
              void decide(
                waiting.map((item) => item.id),
                [],
              )
            }
          >
            Accept all {waiting.length}
          </button>
        ) : null}
      </header>
      {problem !== "" ? (
        <p className="as-problem" role="alert">
          {problem}
        </p>
      ) : null}
      {waiting.length > 0 ? (
        <ul className="ry-proposals">
          {waiting.map((item) => (
            <li key={item.id}>
              <span className="ry-tag">{PROPOSAL_LABEL[item.kind]}</span>
              <ProposalText proposal={item} />
              <Quote text={item.quote} />
              {editable ? (
                <span className="ry-row-actions">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => void decide([item.id], [])}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="ry-link"
                    disabled={busy}
                    onClick={() => void decide([], [item.id])}
                  >
                    Dismiss
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {accepted.length > 0 ? (
        // What was accepted stays on record, folded so the work waiting comes first.
        <details className="ry-accepted">
          <summary>
            {plural(accepted.length, "point")} accepted from the prior year
          </summary>
          <ul className="ry-proposals">
            {accepted.map((item) => (
              <li key={item.id} className="is-accepted">
                <span className="ry-tag">{PROPOSAL_LABEL[item.kind]}</span>
                <ProposalText proposal={item} />
                <Quote text={item.quote} />
                <span className="ry-muted">
                  <UiIcon name="check" size={12} /> Accepted
                  {item.decidedBy !== null ? ` by ${item.decidedBy}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/**
 * References (decided by the product owner on 26 October 2026): what describes the scope,
 * kept with it. Process narratives and flow diagrams are linked to the processes and
 * systems they describe; prior-year workpapers are matched by the agent to this year's
 * controls, with its proposals for a person to decide.
 */
export function ReferencesPane({
  ids,
  documents,
  systems,
  processes,
  controls,
  editable,
}: {
  ids: Ids;
  documents: Policy[];
  systems: Named[];
  processes: Named[];
  controls: ReadonlyArray<{ id: string; label: string }>;
  editable: boolean;
}) {
  const [described, setDescribed] = useState<Policy[]>(() =>
    documents.filter((item) => DESCRIPTION_KINDS.includes(item.kind)),
  );
  const [prior, setPrior] = useState<PriorYearReference[] | null>(null);
  useEffect(() => {
    if (prior !== null) {
      tell("references", referencesTile(described, prior));
    }
  }, [described, prior]);
  return (
    <div className="ry-pane">
      <section
        className="ry-section"
        aria-label="Process narratives and flow diagrams"
      >
        <PoliciesPane
          ids={ids}
          initial={documents}
          systems={systems}
          processes={processes}
          editable={editable}
          kind="descriptions"
          onChange={setDescribed}
        />
      </section>
      <section className="ry-section" aria-labelledby="ry-prior-title">
        <h3 id="ry-prior-title" className="ry-section-title">
          Prior-year workpapers
        </h3>
        <PriorYearPane
          ids={ids}
          initial={null}
          controls={controls}
          editable={editable}
          onChange={setPrior}
        />
      </section>
    </div>
  );
}
