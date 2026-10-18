import { ClientPicker } from "./client-picker";
import type { ProjectDetail, ShellModel } from "./shell-model";
import { UiIcon } from "./ui-icon";
import { PageHeader, sectionHref } from "./workspace-view";

type Ready = Extract<ShellModel, { status: "ready" }>;

const NOTICES: Record<string, string> = {
  invalid: "Check the fields and try again.",
  slug: "This client already has an engagement with that name. Choose another name.",
  conflict: "That could not be saved. Try again.",
  denied: "Your role cannot open engagements.",
  unavailable: "The engagement could not be opened. Try again.",
  rollforward:
    "An engagement can start only from an earlier engagement of the same client. Choose the client again.",
};

// The same form saving an engagement that exists (Milestone 8.15).
const EDIT_NOTICES: Record<string, string> = {
  invalid: "Check the fields and try again.",
  conflict:
    "This engagement changed while you were editing. The form shows it as it is now; make your change again.",
  locked:
    "The client and the period end are part of the launched plan, so they no longer change.",
  completed: "This engagement is completed, so its details no longer change.",
  archived: "This engagement is archived, so its details no longer change.",
  denied: "Your role cannot change this engagement.",
  unavailable: "The engagement could not be saved. Try again.",
};

/** The link to edit an engagement with the form it was created with. */
export function editEngagementHref(model: Ready, projectId: string): string {
  return `/?organization=${model.organization.id}&section=projects&project=${projectId}&edit=engagement`;
}

/** The link to the New engagement page; for one of the firm's clients, with it chosen. */
export function createEngagementHref(
  model: Ready,
  clientId: string | null = null,
): string {
  const client = clientId === null ? "" : `&client=${clientId}`;
  return `/?organization=${model.organization.id}&section=projects&create=engagement${client}`;
}

/**
 * Opening a new engagement (Milestone 8.3c), on its own page: the client, the name, the
 * period, and who leads it. A new engagement covers IT general controls and business
 * process controls; the controls step in setup decides which are tested, and the profile
 * step can narrow it to ITGC only or a non-SOX IT audit.
 *
 * With `editing`, the same page edits an engagement (Milestone 8.15), filled in, with its
 * fieldwork dates. After launch the client and the period end are part of the launched
 * plan: shown, and kept as they are.
 */
export function EngagementCreatePage({
  model,
  notice,
  editing,
}: {
  model: Ready;
  notice: string | null;
  editing?: ProjectDetail;
}) {
  const back =
    editing === undefined
      ? sectionHref(model, "projects")
      : `/?organization=${model.organization.id}&section=projects&project=${editing.id}`;
  const problem =
    notice === null
      ? null
      : ((editing === undefined ? NOTICES : EDIT_NOTICES)[notice] ?? null);
  const locked = editing?.launched === true;
  return (
    <div className="page create-page">
      <PageHeader
        context={model.organization.name}
        title={
          editing === undefined ? "New engagement" : `Edit ${editing.name}`
        }
        description={
          editing === undefined
            ? "Choose the client, or add a new one, and who leads it. For a client you have audited before, you can start from an earlier engagement. The engagement opens in guided setup; nothing starts until you launch it."
            : locked
              ? "Change its name, its lead, or its fieldwork dates. The client and the period end are part of the launched plan and stay as they are."
              : "Change the client, the name, the period, or who leads it. Systems, controls, and the team are set in guided setup."
        }
        actions={
          <a className="btn btn-secondary" href={back}>
            Cancel
          </a>
        }
      />
      {problem !== null ? (
        <p className="banner banner-warning" role="alert">
          <UiIcon name="info" size={15} />
          <span>{problem}</span>
        </p>
      ) : null}
      <div className="create-layout">
        <section className="card create-card" aria-labelledby="create-title">
          <h2 id="create-title" className="sr-only">
            Engagement details
          </h2>
          <form
            autoComplete="off"
            method="post"
            action="/workspace/projects"
            className="create-form"
          >
            <input
              type="hidden"
              name="intent"
              value={editing === undefined ? "create" : "details"}
            />
            <input
              type="hidden"
              name="organization_id"
              value={model.organization.id}
            />
            {editing === undefined ? (
              <>
                <input type="hidden" name="status" value="DRAFT" />
                <input type="hidden" name="engagement_type" value="SOX_FULL" />
              </>
            ) : (
              <>
                <input type="hidden" name="project_id" value={editing.id} />
                <input type="hidden" name="version" value={editing.version} />
              </>
            )}
            {locked && editing !== undefined ? (
              // Shown below but not editable; sent as they are.
              <>
                <input
                  type="hidden"
                  name="client_name"
                  value={editing.clientName}
                />
                <input
                  type="hidden"
                  name="period_end"
                  value={editing.periodEnd ?? ""}
                />
              </>
            ) : null}
            <div className="create-grid">
              {locked ? (
                <label htmlFor="create-client">
                  Client
                  <input
                    id="create-client"
                    disabled
                    autoComplete="off"
                    defaultValue={editing?.clientName}
                  />
                  <span className="form-hint">Set before launch.</span>
                </label>
              ) : (
                // One of the firm's clients, or a new one; a new engagement can start
                // from one of the client's earlier engagements (Milestone 8.18).
                <ClientPicker
                  clients={model.clients}
                  initialClientId={editing?.clientId ?? null}
                  rollforward={editing === undefined}
                />
              )}
              <label htmlFor="create-name">
                Engagement name
                <input
                  id="create-name"
                  name="name"
                  required
                  maxLength={200}
                  placeholder="For example, SOX FY27"
                  defaultValue={editing?.name}
                />
                <span className="form-hint">
                  Shown to the team and on reports. Name the fiscal year and the
                  planner picks up the period from it.
                </span>
              </label>
            </div>
            {editing === undefined ? (
              <div className="create-coverage">
                <p className="create-coverage-title">Covered</p>
                <ul>
                  <li>
                    <UiIcon name="check" size={13} />
                    IT general controls
                  </li>
                  <li>
                    <UiIcon name="check" size={13} />
                    Business process controls
                  </li>
                  <li>
                    <UiIcon name="check" size={13} />
                    Application controls (ITAC)
                  </li>
                  <li>
                    <UiIcon name="check" size={13} />
                    Key reports (IPE)
                  </li>
                </ul>
                <p className="form-hint">
                  You choose the exact controls in setup. Leave out what the
                  audit does not cover.
                </p>
              </div>
            ) : null}
            <div className="create-grid">
              <label htmlFor="create-period">
                Period end
                <input
                  id="create-period"
                  name={locked ? undefined : "period_end"}
                  type="date"
                  disabled={locked}
                  defaultValue={editing?.periodEnd ?? undefined}
                />
                <span className="form-hint">
                  {locked
                    ? "Set before launch."
                    : "The last day the controls are tested through. Leave it blank and the planner suggests one."}
                </span>
              </label>
              <label htmlFor="create-owner">
                Engagement lead
                <select
                  id="create-owner"
                  name="owner_user_id"
                  required
                  defaultValue={editing?.ownerUserId}
                >
                  {model.members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
                </select>
                <span className="form-hint">
                  Owns the engagement and approves the kickoff plan. The rest of
                  the team is added in setup.
                </span>
              </label>
            </div>
            {editing !== undefined ? (
              <div className="create-grid">
                <label htmlFor="create-starts">
                  Fieldwork starts
                  <input
                    id="create-starts"
                    name="starts_on"
                    type="date"
                    defaultValue={editing.startsOn ?? undefined}
                  />
                </label>
                <label htmlFor="create-ends">
                  Fieldwork ends
                  <input
                    id="create-ends"
                    name="ends_on"
                    type="date"
                    defaultValue={editing.endsOn ?? undefined}
                  />
                  <span className="form-hint">Optional.</span>
                </label>
              </div>
            ) : null}
            <div className="form-actions create-actions">
              {editing === undefined ? (
                <button type="submit">
                  Open in guided setup <UiIcon name="arrow" size={15} />
                </button>
              ) : (
                <button type="submit">Save changes</button>
              )}
              <a className="btn btn-secondary" href={back}>
                Cancel
              </a>
            </div>
          </form>
        </section>
        {editing === undefined ? (
          <aside className="create-aside">
            <section className="card">
              <div className="create-aside-body">
                <p className="page-context">What happens next</p>
                <ol className="overview-flow">
                  <li>
                    <strong>It opens as a draft</strong>
                    <small>
                      Only the engagement team can see it. The planner drafts
                      the scope, the period, and the request cadence from what
                      you enter here.
                    </small>
                  </li>
                  <li>
                    <strong>You set it up</strong>
                    <small>
                      Profile, team, controls and systems, then the workpaper
                      templates. A few minutes each; accept the planner's drafts
                      or edit them.
                    </small>
                  </li>
                  <li>
                    <strong>You launch</strong>
                    <small>
                      The planner records each control's evidence plan and
                      starts the agents. A request is drafted when you approve
                      the plan, and sent only after an approver confirms it.
                    </small>
                  </li>
                </ol>
              </div>
            </section>
            <section className="card">
              <div className="create-aside-body">
                <p className="page-context">What one engagement covers</p>
                <ul className="guide">
                  <li>
                    <strong>IT general controls</strong>
                    Logical access, change management, and IT operations over
                    the systems that support financial reporting.
                  </li>
                  <li>
                    <strong>Business processes</strong>
                    The business cycles and their manual controls, tested
                    alongside the ITGCs.
                  </li>
                  <li>
                    <strong>Application controls (ITAC)</strong>
                    Automated controls configured in the applications, such as
                    the three-way match and credit limits.
                  </li>
                  <li>
                    <strong>Key reports (IPE)</strong>
                    System reports the controls rely on, tested for completeness
                    and accuracy.
                  </li>
                  <li>
                    <strong>Narrower audits</strong>
                    For an ITGC-only audit, leave the business process controls
                    out in the Controls and systems step.
                  </li>
                </ul>
              </div>
            </section>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
