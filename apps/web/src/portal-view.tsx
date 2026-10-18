"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { formatDate } from "./format";
import {
  EMPTY_QUERY,
  filterRequests,
  formatSize,
  ITEM_STATE_TONES,
  isOverdue,
  itemsProgress,
  type LinkStatus,
  type ListQuery,
  MAX_TEXT,
  OWNER_STATUS_LABELS,
  OWNER_STATUS_TONES,
  type OwnerStatus,
  type Portal,
  type PortalDeliverable,
  type PortalFile,
  type PortalRequest,
  parsePortal,
  portalProblem,
  referenceHref,
  requestHref,
  requestTypes,
  type SortKey,
  type StatusFilter,
  selectedRequest,
  submitCheck,
  type Tone,
  uploadProblem,
} from "./portal-model";
import { UiIcon } from "./ui-icon";

type Answer = { status: number; detail: string; body: unknown };

function readAnswer(raw: unknown): Answer {
  const body = (raw ?? {}) as Partial<Answer>;
  return {
    status: typeof body.status === "number" ? body.status : 0,
    detail: typeof body.detail === "string" ? body.detail : "",
    body: body.body ?? null,
  };
}

async function call(path: string, init: RequestInit): Promise<Answer> {
  try {
    const response = await fetch(path, { ...init, cache: "no-store" });
    return readAnswer(await response.json());
  } catch {
    return { status: 0, detail: "", body: null };
  }
}

async function work(
  intent: "answers" | "messages" | "submit",
  requestId: string,
  fields: Record<string, unknown>,
): Promise<Answer> {
  return call("/portal/work", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...fields, intent, request_id: requestId }),
  });
}

/** The API's refusal in words for the owner, including the page's own checks. */
function problemOf(result: Answer): string | null {
  if (result.status === 422 && /^[A-Z].*\.$/.test(result.detail)) {
    return result.detail;
  }
  return portalProblem(result.status, result.detail);
}

/** One file to the page's upload route, reporting how much has gone. */
function sendFile(
  form: FormData,
  onProgress: (fraction: number) => void,
): Promise<Answer> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/portal/upload");
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    };
    request.onload = () => resolve(readAnswer(request.response));
    request.onerror = () => resolve({ status: 0, detail: "", body: null });
    request.ontimeout = request.onerror;
    request.timeout = 180_000;
    request.send(form);
  });
}

async function loadPortal(): Promise<Portal | null> {
  const opened = await call("/portal/session", { method: "GET" });
  return opened.status === 200 ? parsePortal(opened.body) : null;
}

/** The evidence owner's portal: check the link, verify a code, then work on requests. */
export function PortalPage({
  token,
  status,
  unavailable,
  portal: initial,
}: {
  token: string;
  status: LinkStatus | null;
  unavailable: boolean;
  portal: Portal | null;
}) {
  const [portal, setPortal] = useState<Portal | null>(initial);
  const [ended, setEnded] = useState(false);
  if (unavailable) {
    return (
      <Shell>
        <Message
          icon="clock"
          title="The evidence portal is unavailable right now"
          detail="Try the link again in a few minutes."
        />
      </Shell>
    );
  }
  if (status === null) {
    return (
      <Shell>
        <Message
          icon="x"
          title="This link is not valid"
          detail="Use the link in the most recent email from the audit team. Links are personal: a link forwarded from someone else does not open."
        />
      </Shell>
    );
  }
  const context = { firm: status.firm, engagement: status.engagement };
  if (status.state === "REVOKED") {
    return (
      <Shell context={context}>
        <Message
          icon="x"
          title="This link is no longer active"
          detail="The audit team turned this link off. If evidence is still to be sent, ask the audit team for a new request."
        />
      </Shell>
    );
  }
  if (status.state === "CLOSED" && portal === null) {
    return (
      <Shell context={context}>
        <Message
          icon="check"
          title="No requests are open on this link"
          detail="The requests on this link are closed, or more than 30 days past their due date. If evidence is still to be sent, contact the audit team."
        />
      </Shell>
    );
  }
  if (ended) {
    return (
      <Shell context={context}>
        <Message
          icon="check"
          title="Signed out"
          detail="Open the link in the email again to continue."
        />
      </Shell>
    );
  }
  if (portal === null) {
    return (
      <Shell context={context}>
        <Verify
          token={token}
          maskedEmail={status.maskedEmail}
          onVerified={setPortal}
        />
      </Shell>
    );
  }
  return (
    <Workspace
      portal={portal}
      onChanged={setPortal}
      onEnded={() => setEnded(true)}
    />
  );
}

function Shell({
  children,
  context,
  account,
}: {
  children: ReactNode;
  context?: { firm: string; engagement: string };
  account?: ReactNode;
}) {
  return (
    <div className="pt">
      <header className="pt-bar">
        <div className="pt-bar-inner">
          <span className="pt-brand">
            <span className="pt-brand-mark" aria-hidden="true">
              <UiIcon name="logo" size={15} />
            </span>
            <span className="pt-brand-name">AI Workforce</span>
            <span className="pt-brand-product">Evidence Portal</span>
          </span>
          {context !== undefined ? (
            <span className="pt-context">
              <span className="pt-context-firm">{context.firm}</span>
              <span className="pt-context-engagement">
                {context.engagement}
              </span>
            </span>
          ) : null}
          <span className="pt-bar-actions">
            <HelpButton />
            {account}
          </span>
        </div>
      </header>
      <main className="pt-main">{children}</main>
      <footer className="pt-foot">
        <UiIcon name="shield" size={13} />
        Files and messages sent here go only to the audit team for this
        engagement.
      </footer>
    </div>
  );
}

function Message({
  icon,
  title,
  detail,
}: {
  icon: "x" | "check" | "clock";
  title: string;
  detail: string;
}) {
  return (
    <section className="pt-card pt-message">
      <span className={`pt-message-icon is-${icon}`} aria-hidden="true">
        <UiIcon name={icon} size={18} />
      </span>
      <h1>{title}</h1>
      <p>{detail}</p>
    </section>
  );
}

function useDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const open = useCallback(() => ref.current?.showModal(), []);
  const close = useCallback(() => ref.current?.close(), []);
  return { ref, open, close };
}

function HelpButton() {
  const dialog = useDialog();
  const titleId = useId();
  return (
    <>
      <button type="button" className="pt-icon-btn" onClick={dialog.open}>
        <UiIcon name="help" size={16} />
        <span className="pt-hide-sm">Help</span>
      </button>
      <dialog ref={dialog.ref} className="pt-dialog" aria-labelledby={titleId}>
        <div className="pt-dialog-body">
          <h2 id={titleId}>Using the evidence portal</h2>
          <dl className="pt-help">
            <dt>Signing in</dt>
            <dd>
              Each visit is confirmed with a one-time code emailed to the
              address the request was sent to. The session ends at the time
              shown in the account menu.
            </dd>
            <dt>Uploading</dt>
            <dd>
              Upload each file under the item it answers. Files go to the audit
              team as soon as they arrive, up to 25 MB each. For privacy, files
              cannot be opened or downloaded here after they are sent.
            </dd>
            <dt>Submitting</dt>
            <dd>
              Select Submit evidence when a request is complete. More files can
              still be added afterwards if the audit team asks for them.
            </dd>
            <dt>Questions</dt>
            <dd>
              Answer the audit team&apos;s questions on the request, or write to
              the audit team under Questions &amp; messages. Replies are also
              announced by email.
            </dd>
          </dl>
        </div>
        <div className="pt-dialog-foot">
          <button type="button" className="pt-btn" onClick={dialog.close}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}

function AccountMenu({
  email,
  expiresAt,
  onEnded,
}: {
  email: string;
  expiresAt: string;
  onEnded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) {
      return;
    }
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const signOut = async () => {
    setBusy(true);
    await call("/portal/end", { method: "POST" });
    setBusy(false);
    onEnded();
  };
  const expires = new Date(expiresAt);
  return (
    <div className="pt-account" ref={ref}>
      <button
        type="button"
        className="pt-icon-btn pt-account-btn"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="pt-avatar" aria-hidden="true">
          {email.charAt(0).toUpperCase()}
        </span>
        <span className="pt-hide-sm pt-account-email">{email}</span>
        <UiIcon name="chevron" size={13} />
      </button>
      {open ? (
        <div className="pt-menu">
          <p className="pt-menu-label">Signed in as</p>
          <p className="pt-menu-email">{email}</p>
          {Number.isNaN(expires.getTime()) ? null : (
            <p className="pt-menu-note">
              Session ends at{" "}
              {expires.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>
          )}
          <button
            type="button"
            className="pt-menu-item"
            onClick={signOut}
            disabled={busy}
          >
            <UiIcon name="logout" size={14} />
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Verify({
  token,
  maskedEmail,
  onVerified,
}: {
  token: string;
  maskedEmail: string;
  onVerified: (portal: Portal) => void;
}) {
  const [sent, setSent] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const codeId = useId();

  const askForCode = async () => {
    setBusy(true);
    setProblem(null);
    const result = await call("/portal/code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setBusy(false);
    const message = portalProblem(result.status, result.detail);
    if (message !== null) {
      setProblem(message);
      return;
    }
    const body = result.body as { preview_code?: unknown } | null;
    setPreview(
      typeof body?.preview_code === "string" ? body.preview_code : null,
    );
    setSent(true);
  };

  const verify = async () => {
    setBusy(true);
    setProblem(null);
    const result = await call("/portal/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, code }),
    });
    if (result.status !== 200) {
      setBusy(false);
      setProblem(
        result.status === 422
          ? "Enter the six-digit code from the email."
          : portalProblem(result.status, result.detail),
      );
      return;
    }
    const portal = await loadPortal();
    setBusy(false);
    if (portal === null) {
      setProblem(portalProblem(0));
      return;
    }
    onVerified(portal);
  };

  return (
    <section className="pt-card pt-verify" aria-labelledby="verify-title">
      <span className="pt-verify-icon" aria-hidden="true">
        <UiIcon name="shield" size={20} />
      </span>
      <h1 id="verify-title">Confirm your identity</h1>
      <p className="pt-lede">
        To keep the evidence private, a one-time code is emailed to{" "}
        <strong>{maskedEmail}</strong>, the address the request was sent to.
      </p>
      {!sent ? (
        <button
          type="button"
          className="pt-btn pt-btn-primary pt-btn-block"
          onClick={askForCode}
          disabled={busy}
        >
          <UiIcon name="mail" size={14} />
          {busy ? "Sending…" : "Email me a code"}
        </button>
      ) : (
        <form
          className="pt-code"
          onSubmit={(event) => {
            event.preventDefault();
            void verify();
          }}
        >
          <label htmlFor={codeId}>Code from the email</label>
          <div className="pt-code-row">
            <input
              id={codeId}
              className="pt-input pt-code-input"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-describedby={`${codeId}-hint`}
            />
            <button
              type="submit"
              className="pt-btn pt-btn-primary"
              disabled={busy || code.length !== 6}
            >
              {busy ? "Checking…" : "Continue"}
            </button>
          </div>
          <p id={`${codeId}-hint`} className="pt-hint">
            The code is valid for 10 minutes.{" "}
            <button
              type="button"
              className="pt-link"
              onClick={askForCode}
              disabled={busy}
            >
              Send a new code
            </button>
          </p>
          {preview !== null ? (
            <p className="pt-preview" role="note">
              Local preview: email is not sent in this environment. The code is{" "}
              <strong>{preview}</strong>.
            </p>
          ) : null}
        </form>
      )}
      {problem !== null ? (
        <p className="pt-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}

function Workspace({
  portal,
  onChanged,
  onEnded,
}: {
  portal: Portal;
  onChanged: (portal: Portal) => void;
  onEnded: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setSelected(selectedRequest(window.location.search));
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const open = (requestId: string | null) => {
    window.history.pushState(
      null,
      "",
      requestHref(window.location.pathname, requestId),
    );
    setSelected(requestId);
    window.scrollTo({ top: 0 });
  };
  const refresh = useCallback(async () => {
    const found = await loadPortal();
    if (found !== null) {
      onChanged(found);
    }
  }, [onChanged]);
  const request =
    selected === null
      ? undefined
      : portal.requests.find((item) => item.id === selected);
  return (
    <Shell
      context={{ firm: portal.firm, engagement: portal.engagement }}
      account={
        <AccountMenu
          email={portal.email}
          expiresAt={portal.sessionExpiresAt}
          onEnded={onEnded}
        />
      }
    >
      {request !== undefined ? (
        <RequestDetail
          key={request.id}
          request={request}
          onBack={() => open(null)}
          onChanged={refresh}
        />
      ) : (
        <RequestList portal={portal} onOpen={(id) => open(id)} />
      )}
    </Shell>
  );
}

const SUMMARY: { status: StatusFilter; label: string }[] = [
  { status: "ALL", label: "All requests" },
  { status: "AWAITING", label: OWNER_STATUS_LABELS.AWAITING },
  { status: "IN_PROGRESS", label: OWNER_STATUS_LABELS.IN_PROGRESS },
  { status: "SUBMITTED", label: OWNER_STATUS_LABELS.SUBMITTED },
  { status: "UNDER_REVIEW", label: OWNER_STATUS_LABELS.UNDER_REVIEW },
  { status: "MORE_NEEDED", label: OWNER_STATUS_LABELS.MORE_NEEDED },
  { status: "COMPLETED", label: OWNER_STATUS_LABELS.COMPLETED },
];

function periodText(portal: Portal): string {
  if (portal.periodStart !== null && portal.periodEnd !== null) {
    return `${formatDate(portal.periodStart)} to ${formatDate(portal.periodEnd)}`;
  }
  if (portal.periodEnd !== null) {
    return `ending ${formatDate(portal.periodEnd)}`;
  }
  return "";
}

function RequestList({
  portal,
  onOpen,
}: {
  portal: Portal;
  onOpen: (requestId: string) => void;
}) {
  const [query, setQuery] = useState<ListQuery>(EMPTY_QUERY);
  const types = useMemo(() => requestTypes(portal.requests), [portal]);
  const shown = useMemo(
    () => filterRequests(portal.requests, query),
    [portal, query],
  );
  const searchId = useId();
  const period = periodText(portal);
  const filtered =
    query.search !== "" || query.status !== "ALL" || query.type !== "";
  return (
    <>
      <div className="pt-page-head">
        <h1>Evidence requests</h1>
        <p>
          Requests from {portal.firm} for {portal.engagement}
          {period !== "" ? `, audit period ${period}` : ""}. Upload each file
          under the item it answers, then submit the request.
        </p>
      </div>
      <section className="pt-summary" aria-label="Requests by status">
        {SUMMARY.map((entry) => {
          const count =
            entry.status === "ALL"
              ? portal.counts.total
              : portal.counts[entry.status];
          if (
            entry.status !== "ALL" &&
            count === 0 &&
            (entry.status === "UNDER_REVIEW" || entry.status === "MORE_NEEDED")
          ) {
            return null;
          }
          const active = query.status === entry.status;
          return (
            <button
              key={entry.status}
              type="button"
              className={`pt-stat${active ? " is-active" : ""}${
                entry.status === "ALL"
                  ? ""
                  : ` tone-${OWNER_STATUS_TONES[entry.status]}`
              }`}
              aria-pressed={active}
              onClick={() =>
                setQuery((value) => ({
                  ...value,
                  status: active ? "ALL" : entry.status,
                }))
              }
            >
              <span className="pt-stat-count">{count}</span>
              <span className="pt-stat-label">{entry.label}</span>
            </button>
          );
        })}
      </section>
      <section className="pt-card pt-list" aria-label="Requests">
        <div className="pt-toolbar">
          <label className="pt-search" htmlFor={searchId}>
            <UiIcon name="search" size={14} />
            <span className="sr-only">Search requests</span>
            <input
              id={searchId}
              type="search"
              className="pt-input"
              placeholder="Search by title, reference, or control"
              value={query.search}
              onChange={(event) =>
                setQuery((value) => ({ ...value, search: event.target.value }))
              }
            />
          </label>
          <div className="pt-toolbar-filters">
            <label className="pt-select">
              <span className="sr-only">Status</span>
              <select
                value={query.status}
                onChange={(event) =>
                  setQuery((value) => ({
                    ...value,
                    status: event.target.value as StatusFilter,
                  }))
                }
              >
                <option value="ALL">All statuses</option>
                {(Object.keys(OWNER_STATUS_LABELS) as OwnerStatus[]).map(
                  (status) => (
                    <option key={status} value={status}>
                      {OWNER_STATUS_LABELS[status]}
                    </option>
                  ),
                )}
              </select>
            </label>
            {types.length > 1 ? (
              <label className="pt-select">
                <span className="sr-only">Request type</span>
                <select
                  value={query.type}
                  onChange={(event) =>
                    setQuery((value) => ({
                      ...value,
                      type: event.target.value,
                    }))
                  }
                >
                  <option value="">All types</option>
                  {types.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="pt-select">
              <span className="sr-only">Sort</span>
              <select
                value={query.sort}
                onChange={(event) =>
                  setQuery((value) => ({
                    ...value,
                    sort: event.target.value as SortKey,
                  }))
                }
              >
                <option value="due-soonest">Due date, soonest first</option>
                <option value="due-latest">Due date, latest first</option>
                <option value="title">Title, A to Z</option>
              </select>
            </label>
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="pt-empty">
            <p>
              {filtered
                ? "No requests match these filters."
                : "No evidence requests are open for this address."}
            </p>
            {filtered ? (
              <button
                type="button"
                className="pt-btn"
                onClick={() => setQuery(EMPTY_QUERY)}
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <div className="pt-row pt-row-head" aria-hidden="true">
              <span>Request</span>
              <span>Due</span>
              <span>Items</span>
              <span>Status</span>
            </div>
            <ul className="pt-rows">
              {shown.map((request) => (
                <RequestRow
                  key={request.id}
                  request={request}
                  onOpen={() => onOpen(request.id)}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

function StatusPill({ tone, label }: { tone: Tone; label: string }) {
  return <span className={`pt-pill tone-${tone}`}>{label}</span>;
}

function RequestRow({
  request,
  onOpen,
}: {
  request: PortalRequest;
  onOpen: () => void;
}) {
  const progress = itemsProgress(request);
  const overdue = isOverdue(request);
  const messages = request.messages.length;
  return (
    <li>
      <a
        href={requestHref("", request.id)}
        className="pt-row"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) {
            return;
          }
          event.preventDefault();
          onOpen();
        }}
      >
        <span className="pt-row-main">
          <span className="pt-row-title">{request.title}</span>
          <span className="pt-row-meta">
            <span>{request.reference}</span>
            <span>{request.control}</span>
            {request.typeLabel !== "" ? <span>{request.typeLabel}</span> : null}
            {request.period !== "" ? <span>{request.period}</span> : null}
            {messages > 0 ? (
              <span className="pt-row-messages">
                <UiIcon name="message" size={12} />
                {messages}
              </span>
            ) : null}
          </span>
        </span>
        <span className={`pt-row-due${overdue ? " is-overdue" : ""}`}>
          <span className="pt-row-label">Due</span>
          {formatDate(request.dueAt)}
          {overdue ? <span className="pt-overdue">Past due</span> : null}
        </span>
        <span className="pt-row-items">
          <span className="pt-row-label">Items</span>
          <span>
            {progress.done} of {progress.total}
          </span>
          <span className="pt-meter" aria-hidden="true">
            <span
              style={{
                width: `${progress.total === 0 ? 0 : (progress.done / progress.total) * 100}%`,
              }}
            />
          </span>
        </span>
        <span className="pt-row-status">
          <StatusPill
            tone={OWNER_STATUS_TONES[request.ownerStatus]}
            label={request.ownerStatusLabel}
          />
        </span>
        <span className="pt-row-go" aria-hidden="true">
          <UiIcon name="chevron" size={14} />
        </span>
      </a>
    </li>
  );
}

function RequestDetail({
  request,
  onBack,
  onChanged,
}: {
  request: PortalRequest;
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const progress = itemsProgress(request);
  const overdue = isOverdue(request);
  return (
    <div className="pt-detail">
      <button type="button" className="pt-back" onClick={onBack}>
        <UiIcon name="back" size={14} />
        All requests
      </button>
      <header className="pt-detail-head">
        <div className="pt-detail-title">
          <p className="pt-detail-ref">
            {request.reference} · {request.control}
            {request.typeLabel !== "" ? ` · ${request.typeLabel}` : ""}
          </p>
          <h1>{request.title}</h1>
        </div>
        <StatusPill
          tone={OWNER_STATUS_TONES[request.ownerStatus]}
          label={request.ownerStatusLabel}
        />
      </header>
      {!request.open ? (
        <p className="pt-banner" role="note">
          <UiIcon name="info" size={14} />
          This request is closed. It is shown for reference; files, answers, and
          messages can no longer be added.
        </p>
      ) : request.ownerStatus === "MORE_NEEDED" ? (
        <p className="pt-banner is-danger" role="note">
          <UiIcon name="info" size={14} />
          The audit team needs more for this request. See the items marked More
          information requested, and the messages below.
        </p>
      ) : null}
      <div className="pt-detail-grid">
        <div className="pt-detail-main">
          {request.summary !== "" && request.structured ? (
            <section className="pt-card pt-section">
              <h2>About this request</h2>
              <p className="pt-prose">{request.summary}</p>
            </section>
          ) : null}
          {!request.structured ? (
            <section className="pt-card pt-section">
              <h2>The request</h2>
              <p className="pt-prose">{request.description}</p>
            </section>
          ) : null}
          <section className="pt-section-plain" aria-labelledby="items-title">
            <div className="pt-section-head">
              <h2 id="items-title">
                {request.structured ? "Requested items" : "Files"}
              </h2>
              <span className="pt-muted">
                {progress.done} of {progress.total}{" "}
                {progress.total === 1 ? "item has" : "items have"} files
              </span>
            </div>
            <ol className="pt-items">
              {request.deliverables.map((item) => (
                <DeliverableCard
                  key={item.number}
                  request={request}
                  item={item}
                  onChanged={onChanged}
                />
              ))}
            </ol>
            {request.earlierFiles.length > 0 ? (
              <div className="pt-card pt-section">
                <h3>Files sent earlier</h3>
                <p className="pt-muted">
                  Sent before files were uploaded by item. The audit team has
                  them.
                </p>
                <FileList files={request.earlierFiles} />
              </div>
            ) : null}
          </section>
          {request.questions.length > 0 ? (
            <Questions request={request} onChanged={onChanged} />
          ) : null}
          <Thread request={request} onChanged={onChanged} />
        </div>
        <aside className="pt-detail-side">
          <SubmitPanel request={request} onChanged={onChanged} />
          <section className="pt-card pt-facts">
            <h2>Details</h2>
            <dl>
              <div>
                <dt>Due</dt>
                <dd className={overdue ? "is-overdue" : ""}>
                  {formatDate(request.dueAt)}
                  {overdue ? " · Past due" : ""}
                </dd>
              </div>
              {request.period !== "" ? (
                <div>
                  <dt>Period</dt>
                  <dd>{request.period}</dd>
                </div>
              ) : null}
              <div>
                <dt>Control</dt>
                <dd>{request.control}</dd>
              </div>
              <div>
                <dt>Reference</dt>
                <dd>{request.reference}</dd>
              </div>
              {request.open ? (
                <div>
                  <dt>Open for uploads until</dt>
                  <dd>{formatDate(request.openUntil)}</dd>
                </div>
              ) : null}
            </dl>
          </section>
          {request.references.length > 0 ? (
            <section className="pt-card pt-facts">
              <h2>Reference documents</h2>
              <p className="pt-muted">Shared by the audit team.</p>
              <ul className="pt-files">
                {request.references.map((item) => (
                  <li key={item.id}>
                    <UiIcon name="file" size={14} />
                    <a href={referenceHref(request.id, item.id)}>
                      {item.fileName}
                    </a>
                    <span className="pt-muted">
                      {formatSize(item.sizeBytes)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function FileList({ files }: { files: PortalFile[] }) {
  return (
    <ul className="pt-files">
      {files.map((file) => (
        <li key={`${file.fileName}-${file.addedAt}`}>
          <UiIcon name="file" size={14} />
          <span className="pt-file-name">{file.fileName}</span>
          <span className="pt-muted">
            {formatSize(file.sizeBytes)} · {formatDate(file.addedAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

type Sending = {
  id: number;
  file: File;
  state: "queued" | "sending" | "failed";
  progress: number;
  note: string;
};

let sendingIds = 0;

function DeliverableCard({
  request,
  item,
  onChanged,
}: {
  request: PortalRequest;
  item: PortalDeliverable;
  onChanged: () => Promise<void>;
}) {
  const [sending, setSending] = useState<Sending[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const busy = sending.some(
    (entry) => entry.state === "queued" || entry.state === "sending",
  );
  const inputId = useId();

  const patch = (id: number, change: Partial<Sending>) =>
    setSending((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...change } : row)),
    );

  const upload = async (rows: Sending[]) => {
    const received: string[] = [];
    for (const row of rows) {
      const tooBig = uploadProblem(row.file.size);
      if (tooBig !== null) {
        patch(row.id, { state: "failed", note: tooBig });
        continue;
      }
      patch(row.id, { state: "sending", progress: 0, note: "" });
      const form = new FormData();
      form.set("request_id", request.id);
      if (request.structured) {
        form.set("item", String(item.number));
      }
      form.set("file", row.file);
      const result = await sendFile(form, (progress) =>
        patch(row.id, { progress }),
      );
      const problem = problemOf(result);
      if (problem !== null) {
        patch(row.id, {
          state: "failed",
          note: result.status === 0 ? "The upload did not finish." : problem,
        });
        continue;
      }
      const duplicate =
        (result.body as { duplicate?: unknown } | null)?.duplicate === true;
      received.push(
        duplicate
          ? `${row.file.name} was already received.`
          : `${row.file.name} was received.`,
      );
      setSending((all) => all.filter((entry) => entry.id !== row.id));
    }
    setNotes(received);
    if (received.length > 0) {
      await onChanged();
    }
  };

  const add = (files: File[]) => {
    if (files.length === 0 || busy || !request.open) {
      return;
    }
    const rows = files.map((file) => ({
      id: ++sendingIds,
      file,
      state: "queued" as const,
      progress: 0,
      note: "",
    }));
    setSending((all) => [
      ...all.filter((entry) => entry.state !== "failed"),
      ...rows,
    ]);
    void upload(rows);
  };

  const facts = [
    { label: "Period", value: item.period },
    { label: "Format", value: item.format },
    { label: "Should show", value: item.show },
    { label: "Completeness", value: item.completeness },
  ].filter((entry) => entry.value !== "");

  return (
    <li className="pt-card pt-item">
      <div className="pt-item-head">
        {request.structured ? (
          <span className="pt-item-number" aria-hidden="true">
            {item.number}
          </span>
        ) : null}
        <h3 className="pt-item-title">
          {request.structured ? (
            <span className="sr-only">Item {item.number}: </span>
          ) : null}
          {request.structured ? item.title : "Files for this request"}
        </h3>
        <StatusPill
          tone={ITEM_STATE_TONES[item.state]}
          label={item.stateLabel}
        />
      </div>
      {request.structured && item.detail !== "" ? (
        <p className="pt-prose pt-item-detail">{item.detail}</p>
      ) : null}
      {item.include.length > 0 || facts.length > 0 ? (
        <dl className="pt-item-facts">
          {item.include.length > 0 ? (
            <div>
              <dt>Include</dt>
              <dd>
                <ul className="pt-bullets">
                  {item.include.map((entry) => (
                    <li key={entry}>{entry}</li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}
          {facts.map((entry) => (
            <div key={entry.label}>
              <dt>{entry.label}</dt>
              <dd>{entry.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {item.files.length > 0 ? <FileList files={item.files} /> : null}
      {request.open ? (
        <label
          htmlFor={inputId}
          className={`pt-drop${dragging ? " is-over" : ""}${busy ? " is-busy" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            add([...event.dataTransfer.files]);
          }}
        >
          <UiIcon name="upload" size={16} />
          <span>
            <strong>{busy ? "Uploading…" : "Choose files"}</strong> or drag them
            here
            <span className="pt-drop-note">Up to 25 MB each</span>
          </span>
          <input
            id={inputId}
            type="file"
            multiple
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = "";
              add(files);
            }}
          />
        </label>
      ) : null}
      {sending.length > 0 ? (
        <ul className="pt-sending" aria-live="polite">
          {sending.map((row) => (
            <li key={row.id} className={`is-${row.state}`}>
              <span className="pt-sending-name">
                <UiIcon name="file" size={13} />
                {row.file.name}
                <span className="pt-muted">{formatSize(row.file.size)}</span>
              </span>
              {row.state === "failed" ? (
                <span className="pt-sending-failed">
                  <span>{row.note}</span>
                  {uploadProblem(row.file.size) === null ? (
                    <button
                      type="button"
                      className="pt-link"
                      disabled={busy}
                      onClick={() => {
                        patch(row.id, { state: "queued", note: "" });
                        void upload([{ ...row, state: "queued" }]);
                      }}
                    >
                      Retry
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="pt-link"
                    onClick={() =>
                      setSending((all) =>
                        all.filter((entry) => entry.id !== row.id),
                      )
                    }
                  >
                    Dismiss
                  </button>
                </span>
              ) : (
                <span className="pt-progress">
                  <span className="pt-meter">
                    <span
                      style={{ width: `${Math.round(row.progress * 100)}%` }}
                    />
                  </span>
                  <span className="pt-muted">
                    {row.state === "queued"
                      ? "Waiting"
                      : row.progress >= 1
                        ? "Processing"
                        : `${Math.round(row.progress * 100)}%`}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {notes.length > 0 ? (
        <p className="pt-received" role="status">
          <UiIcon name="check" size={13} />
          {notes.join(" ")}
        </p>
      ) : null}
    </li>
  );
}

function Questions({
  request,
  onChanged,
}: {
  request: PortalRequest;
  onChanged: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      request.questions.map((item) => [item.key, item.answer]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const changed = request.questions.filter(
    (item) => (drafts[item.key] ?? "").trim() !== item.answer.trim(),
  );
  const answered = request.questions.filter(
    (item) => item.answer !== "",
  ).length;
  const save = async () => {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    const result = await work("answers", request.id, {
      answers: changed.map((item) => ({
        key: item.key,
        answer: drafts[item.key] ?? "",
      })),
    });
    setBusy(false);
    const message = problemOf(result);
    if (message !== null) {
      setProblem(message);
      return;
    }
    setSaved(true);
    await onChanged();
  };
  return (
    <section className="pt-card pt-section" aria-labelledby="questions-title">
      <div className="pt-section-head">
        <h2 id="questions-title">Questions from the audit team</h2>
        <span className="pt-muted">
          {answered} of {request.questions.length} answered
        </span>
      </div>
      <form
        className="pt-questions"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {request.questions.map((item, index) => (
          <div key={item.key} className="pt-question">
            <label htmlFor={`q-${item.key}`}>
              <span className="pt-question-number">{index + 1}.</span>
              {item.text}
            </label>
            <textarea
              id={`q-${item.key}`}
              className="pt-input pt-textarea"
              rows={3}
              maxLength={MAX_TEXT}
              disabled={!request.open || busy}
              value={drafts[item.key] ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setSaved(false);
                setDrafts((all) => ({ ...all, [item.key]: value }));
              }}
            />
            {item.answeredAt !== null ? (
              <p className="pt-hint">Saved {formatDate(item.answeredAt)}</p>
            ) : null}
          </div>
        ))}
        {request.open ? (
          <div className="pt-actions">
            <button
              type="submit"
              className="pt-btn pt-btn-primary"
              disabled={busy || changed.length === 0}
            >
              {busy ? "Saving…" : "Save answers"}
            </button>
            {saved && changed.length === 0 ? (
              <span className="pt-saved" role="status">
                <UiIcon name="check" size={13} /> Answers saved
              </span>
            ) : null}
          </div>
        ) : null}
        {problem !== null ? (
          <p className="pt-problem" role="alert">
            {problem}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function Thread({
  request,
  onChanged,
}: {
  request: PortalRequest;
  onChanged: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const boxId = useId();
  const send = async () => {
    setBusy(true);
    setProblem(null);
    const result = await work("messages", request.id, { body: draft });
    setBusy(false);
    const message = problemOf(result);
    if (message !== null) {
      setProblem(message);
      return;
    }
    setDraft("");
    await onChanged();
  };
  return (
    <section className="pt-card pt-section" aria-labelledby="thread-title">
      <div className="pt-section-head">
        <h2 id="thread-title">Questions &amp; messages</h2>
        <span className="pt-muted">With the audit team</span>
      </div>
      {request.messages.length === 0 ? (
        <p className="pt-muted">
          No messages yet. Write to the audit team about this request below.
        </p>
      ) : (
        <ol className="pt-thread">
          {request.messages.map((message) => (
            <li
              key={message.id}
              className={message.author === "YOU" ? "is-mine" : "is-team"}
            >
              <p className="pt-thread-meta">
                <strong>{message.authorName}</strong>
                <span className="pt-muted">
                  {formatDate(message.createdAt)}{" "}
                  {new Date(message.createdAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </p>
              <p className="pt-thread-body">{message.body}</p>
            </li>
          ))}
        </ol>
      )}
      {request.open ? (
        <form
          className="pt-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor={boxId} className="sr-only">
            Message to the audit team
          </label>
          <textarea
            id={boxId}
            className="pt-input pt-textarea"
            rows={3}
            maxLength={MAX_TEXT}
            placeholder="Write a message to the audit team"
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="pt-actions">
            <span className="pt-hint">
              Do not include passwords or other credentials.
            </span>
            <button
              type="submit"
              className="pt-btn pt-btn-primary"
              disabled={busy || draft.trim() === ""}
            >
              <UiIcon name="message" size={14} />
              {busy ? "Sending…" : "Send message"}
            </button>
          </div>
          {problem !== null ? (
            <p className="pt-problem" role="alert">
              {problem}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}

function SubmitPanel({
  request,
  onChanged,
}: {
  request: PortalRequest;
  onChanged: () => Promise<void>;
}) {
  const dialog = useDialog();
  const titleId = useId();
  const noteId = useId();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const check = submitCheck(request);
  const progress = itemsProgress(request);
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const result = await work("submit", request.id, {
      note,
      confirm_incomplete: check.missing.length > 0,
    });
    setBusy(false);
    const message = problemOf(result);
    if (message !== null) {
      setProblem(message);
      return;
    }
    dialog.close();
    setNote("");
    await onChanged();
  };
  return (
    <section className="pt-card pt-submit" aria-labelledby={`${titleId}-panel`}>
      <h2 id={`${titleId}-panel`}>Submission</h2>
      <div className="pt-submit-progress">
        <span>
          <strong>{progress.done}</strong> of {progress.total}{" "}
          {progress.total === 1 ? "item" : "items"} with files
        </span>
        <span className="pt-meter">
          <span
            style={{
              width: `${progress.total === 0 ? 0 : (progress.done / progress.total) * 100}%`,
            }}
          />
        </span>
      </div>
      {request.submittedAt !== null ? (
        <p className="pt-submitted">
          <UiIcon name="check" size={14} />
          Submitted {formatDate(request.submittedAt)}
        </p>
      ) : null}
      {request.open ? (
        <>
          <button
            type="button"
            className="pt-btn pt-btn-primary pt-btn-block"
            disabled={!check.ready}
            onClick={() => {
              setProblem(null);
              dialog.open();
            }}
          >
            {request.submittedAt !== null ? "Submit again" : "Submit evidence"}
          </button>
          <p className="pt-hint">
            {check.problem ??
              "Files reach the audit team as soon as they are uploaded. Submitting tells the audit team the request is ready for review."}
          </p>
        </>
      ) : null}
      <dialog ref={dialog.ref} className="pt-dialog" aria-labelledby={titleId}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="pt-dialog-body">
            <h2 id={titleId}>Submit evidence for {request.reference}</h2>
            {check.missing.length > 0 ? (
              <div className="pt-warning">
                <p>
                  {check.missing.length === 1
                    ? "One item has no files yet:"
                    : `${check.missing.length} items have no files yet:`}
                </p>
                <ul className="pt-bullets">
                  {check.missing.map((title) => (
                    <li key={title}>{title}</li>
                  ))}
                </ul>
                <p>
                  Submit anyway only if these are not available, and explain why
                  in the note.
                </p>
              </div>
            ) : (
              <p>
                Every item has at least one file. The audit team is told the
                request is ready for review.
              </p>
            )}
            <label htmlFor={noteId} className="pt-label">
              Note to the audit team{" "}
              <span className="pt-muted">(optional)</span>
            </label>
            <textarea
              id={noteId}
              className="pt-input pt-textarea"
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            {problem !== null ? (
              <p className="pt-problem" role="alert">
                {problem}
              </p>
            ) : null}
          </div>
          <div className="pt-dialog-foot">
            <button
              type="button"
              className="pt-btn"
              onClick={dialog.close}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="pt-btn pt-btn-primary"
              disabled={busy}
            >
              {busy
                ? "Submitting…"
                : check.missing.length > 0
                  ? "Submit anyway"
                  : "Submit"}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
