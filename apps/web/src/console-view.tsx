import { AutoRefresh } from "./auto-refresh";
import {
  agentWorking,
  blocks,
  CONSOLE_NOTICES,
  type ConsoleAction,
  type ConsoleMessage,
  type ConsoleState,
  type Inline,
  SUGGESTIONS,
} from "./console-model";
import { formatDate } from "./format";
import type { ShellModel } from "./shell-model";
import { UiIcon } from "./ui-icon";

type Ready = Extract<ShellModel, { status: "ready" }>;

const LINKS: Record<string, string> = {
  approvals: "approvals",
  controls: "controls",
  evidence: "evidence",
};

function href(model: Ready, section: string): string {
  const params = new URLSearchParams({
    organization: model.organization.id,
    section,
  });
  if (model.selectedProject !== null) {
    params.set("project", model.selectedProject.id);
  }
  return `/?${params.toString()}`;
}

function Identity({
  model,
  thread = null,
}: {
  model: Ready;
  thread?: string | null;
}) {
  return (
    <>
      {thread !== null ? (
        <input type="hidden" name="thread_id" value={thread} />
      ) : null}
      <input
        type="hidden"
        name="organization_id"
        value={model.organization.id}
      />
      <input
        type="hidden"
        name="project_id"
        value={model.selectedProject?.id ?? ""}
      />
    </>
  );
}

function Text({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) =>
        part.strong ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one line keep their order.
          <strong key={index}>{part.text}</strong>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts of one line keep their order.
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Reply({ content }: { content: string }) {
  return (
    <div className="reply-text">
      {blocks(content).map((block, index) =>
        block.kind === "table" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks of one reply keep their order.
          <div key={index} className="reply-table">
            <table className="table data-grid">
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns keep their order.
                    <th key={cellIndex} scope="col">
                      <Text parts={cell} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows keep their order.
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: columns keep their order.
                      <td key={cellIndex}>
                        <Text parts={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : block.kind === "list" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks of one reply keep their order.
          <ul key={index}>
            {block.items.map((item, itemIndex) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: items keep their order.
              <li key={itemIndex}>
                <Text parts={item} />
              </li>
            ))}
          </ul>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: blocks of one reply keep their order.
          <p key={index}>
            <Text parts={block.parts} />
          </p>
        ),
      )}
    </div>
  );
}

export function ConsoleMain({
  model,
  console: state,
}: {
  model: Ready;
  console: ConsoleState;
}) {
  const project = model.selectedProject;
  if (project === null) {
    return null;
  }
  const thread = state.thread;
  const threadId = thread?.id ?? null;
  const messages = thread?.messages ?? [];
  const working = agentWorking(thread);
  const waiting = state.inbox?.waiting ?? [];
  const activity = state.inbox?.activity ?? [];
  return (
    <div className="page console-page">
      {working ? <AutoRefresh seconds={2} limit={90} /> : null}
      <section
        className="console-main"
        aria-label="Conversation with the agents"
      >
        <header className="console-head">
          <div>
            <p className="page-context">{project.name}</p>
            <h1>Ask the workforce</h1>
          </div>
          <form method="post" action="/workspace/console">
            <Identity model={model} thread={threadId} />
            <input type="hidden" name="intent" value="new-thread" />
            <button type="submit" className="btn-secondary btn-sm">
              New conversation
            </button>
          </form>
        </header>
        {thread !== null && !thread.modelConfigured ? (
          <p className="console-banner">
            No model is configured, so the agents cannot work from plain
            language yet. Set MODEL_PROVIDER and MODEL_API_KEY.
          </p>
        ) : null}
        {state.notice !== null && CONSOLE_NOTICES[state.notice] !== "" ? (
          <p className="console-banner">{CONSOLE_NOTICES[state.notice]}</p>
        ) : null}
        <ol className="conversation">
          {messages.length === 0 ? (
            <li className="conversation-empty">
              <span className="agent-mark large" aria-hidden="true">
                <UiIcon name="sparkles" size={18} />
              </span>
              <div>
                <h2>Your audit workforce is ready</h2>
                <p>
                  Ask a question about any control or its evidence, or tell the
                  agents what to do. They answer from the engagement's records,
                  do routine work at once, and bring anything that goes to a
                  client, approves, or signs off back to you to confirm.
                </p>
              </div>
            </li>
          ) : (
            messages.map((message, index) => (
              <Message
                key={message.id}
                model={model}
                message={message}
                threadId={threadId}
                latest={index === messages.length - 1}
              />
            ))
          )}
        </ol>
        <form method="post" action="/workspace/console" className="composer">
          <Identity model={model} thread={threadId} />
          <input type="hidden" name="intent" value="ask" />
          <label className="sr-only" htmlFor="console-text">
            Message the agents
          </label>
          <textarea
            id="console-text"
            name="text"
            rows={2}
            maxLength={4000}
            required
            disabled={working}
            placeholder={
              working
                ? "The agents are working…"
                : "Ask about a control, or tell the agents what to do"
            }
          />
          <button type="submit" disabled={working}>
            <UiIcon name="arrow" size={14} /> Send
          </button>
        </form>
        {working ? null : (
          <div className="suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <form key={suggestion} method="post" action="/workspace/console">
                <Identity model={model} thread={threadId} />
                <input type="hidden" name="intent" value="ask" />
                <input type="hidden" name="text" value={suggestion} />
                <button type="submit" className="suggestion">
                  {suggestion}
                </button>
              </form>
            ))}
          </div>
        )}
      </section>
      <aside className="console-rail" aria-label="What needs you">
        <section className="card rail-card">
          <h2>Conversations</h2>
          {state.threads.length === 0 ? (
            <p className="form-hint">Your conversations appear here.</p>
          ) : (
            <ul className="thread-list">
              {state.threads.map((item) => (
                <li key={item.id}>
                  <a
                    href={`${href(model, "console")}&thread=${item.id}`}
                    aria-current={item.id === threadId ? "page" : undefined}
                  >
                    <strong>{item.title}</strong>
                    <small>
                      {item.messages} message{item.messages === 1 ? "" : "s"} ·{" "}
                      {formatDate(item.updatedAt)}
                    </small>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card rail-card">
          <h2>
            Waiting on you
            {waiting.length > 0 ? (
              <span className="view-count">{waiting.length}</span>
            ) : null}
          </h2>
          {waiting.length === 0 ? (
            <p className="form-hint">Nothing is waiting on you.</p>
          ) : (
            <ul className="waiting-list">
              {waiting.map((item) => (
                <li key={`${item.kind}-${item.title}`}>
                  <a href={href(model, LINKS[item.link] ?? "console")}>
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card rail-card">
          <h2>Agent activity</h2>
          {activity.length === 0 ? (
            <p className="form-hint">No agent activity yet.</p>
          ) : (
            <ol className="activity-list">
              {activity.map((item) => (
                <li key={`${item.at}-${item.action}`}>
                  <span className="activity-agent">{item.agent}</span>
                  <span>
                    {item.action}
                    {item.detail !== "" ? ` · ${item.detail}` : ""}
                  </span>
                  <time dateTime={item.at}>{formatDate(item.at)}</time>
                </li>
              ))}
            </ol>
          )}
        </section>
      </aside>
    </div>
  );
}

function Message({
  model,
  message,
  threadId,
  latest,
}: {
  model: Ready;
  message: ConsoleMessage;
  threadId: string | null;
  latest: boolean;
}) {
  if (message.role === "USER") {
    return (
      <li className="turn turn-user" id={latest ? "latest" : undefined}>
        <div className="bubble">{message.content}</div>
      </li>
    );
  }
  const routine = message.actions.filter((action) => action.risk === "ROUTINE");
  const steps = message.actions.filter((action) => action.risk === "CONFIRM");
  const open = steps.filter((action) => action.status === "PROPOSED");
  const working = message.status === "PENDING" || message.status === "WORKING";
  return (
    <li className="turn turn-agent" id={latest ? "latest" : undefined}>
      <span className="agent-mark" aria-hidden="true">
        <UiIcon name="sparkles" size={14} />
      </span>
      <div className="turn-body">
        <p className="turn-author">Lead agent</p>
        {working ? (
          <p className="thinking">
            <span className="dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            Working through the engagement's records…
          </p>
        ) : (
          <Reply content={message.content} />
        )}
        {message.note !== "" && !working ? (
          <p className="turn-note">{message.note}</p>
        ) : null}
        {routine.length > 0 ? (
          <ul className="ran-list">
            {routine.map((action) => (
              <li
                key={action.id}
                className={`ran-${action.status.toLowerCase()}`}
              >
                <UiIcon
                  name={action.status === "DONE" ? "check" : "x"}
                  size={12}
                />
                {action.summary}
                {action.error !== "" ? ` · ${action.error}` : ""}
              </li>
            ))}
          </ul>
        ) : null}
        {steps.length > 0 ? (
          <div className="plan-card">
            <div className="plan-head">
              <strong>
                {open.length > 0
                  ? `${open.length} step${open.length === 1 ? "" : "s"} need your confirmation`
                  : "Steps"}
              </strong>
              {open.length > 1 ? (
                <form method="post" action="/workspace/console">
                  <Identity model={model} thread={threadId} />
                  <input type="hidden" name="intent" value="confirm-all" />
                  <input type="hidden" name="message_id" value={message.id} />
                  <button type="submit" className="btn-sm">
                    <UiIcon name="check" size={13} /> Confirm all
                  </button>
                </form>
              ) : null}
            </div>
            <ol className="plan-steps">
              {steps.map((action) => (
                <Step
                  key={action.id}
                  model={model}
                  action={action}
                  threadId={threadId}
                />
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </li>
  );
}

const STEP_STATUS: Record<ConsoleAction["status"], string> = {
  PROPOSED: "Waiting for you",
  DONE: "Done",
  FAILED: "Did not run",
  CANCELLED: "Cancelled",
};

function Step({
  model,
  action,
  threadId,
}: {
  model: Ready;
  action: ConsoleAction;
  threadId: string | null;
}) {
  return (
    <li className={`plan-step step-${action.status.toLowerCase()}`}>
      <span className="plan-number">{action.position}</span>
      <span className="plan-text">
        <strong>{action.summary}</strong>
        <small>
          {action.label}
          {action.status !== "PROPOSED"
            ? ` · ${STEP_STATUS[action.status]}${action.decidedBy ? ` by ${action.decidedBy}` : ""}`
            : ""}
          {action.error !== "" ? ` · ${action.error}` : ""}
        </small>
      </span>
      {action.status === "PROPOSED" ? (
        <span className="plan-buttons">
          <form method="post" action="/workspace/console">
            <Identity model={model} thread={threadId} />
            <input type="hidden" name="intent" value="cancel" />
            <input type="hidden" name="action_id" value={action.id} />
            <button type="submit" className="btn-secondary btn-sm">
              Cancel
            </button>
          </form>
          <form method="post" action="/workspace/console">
            <Identity model={model} thread={threadId} />
            <input type="hidden" name="intent" value="confirm" />
            <input type="hidden" name="action_id" value={action.id} />
            <button type="submit" className="btn-sm">
              Confirm
            </button>
          </form>
        </span>
      ) : (
        <span
          className={`pill pill-dot ${action.status === "DONE" ? "tone-success" : action.status === "FAILED" ? "tone-danger" : ""}`}
        >
          {STEP_STATUS[action.status]}
        </span>
      )}
    </li>
  );
}
