import type { ReactNode } from "react";

import { AgentPanel, OnboardingCycle } from "./agent-panel";
import { ClientPicker } from "./client-picker";
import { PeriodField, ScopeField } from "./engagement-fields";
import { EngagementGuide } from "./engagement-guide";
import { firstNameFrom } from "./engagement-guide-model";
import { METHODOLOGIES, SETUP_STEPS } from "./onboarding-model";
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

const FORM_ID = "engagement-form";

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

/** A numbered section of the form: its number, title, and one line on what it holds. */
function FormSection({
  step,
  title,
  detail,
  children,
}: {
  step: number;
  title: string;
  detail: string;
  children: ReactNode;
}) {
  const id = `engagement-section-${step}`;
  return (
    <section className="card ne-section" aria-labelledby={id}>
      <header className="ne-section-head">
        <span className="ne-step" aria-hidden="true">
          {step}
        </span>
        <span>
          <h2 id={id}>{title}</h2>
          <p>{detail}</p>
        </span>
      </header>
      <div className="ne-section-body">{children}</div>
    </section>
  );
}

/**
 * Opening a new engagement (Milestone 8.3c; laid out as the product owner asked): the
 * client and scope in one step (the client, the period, the lead, the methodology, and
 * the scope, drafted as they are chosen), beside the setup agent. Onboarding then names
 * the team and launches; the systems, controls, and templates are set up in Controls
 * after launch. Nothing starts until the engagement is launched.
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
  const creating = editing === undefined;
  const back = creating
    ? sectionHref(model, "projects")
    : `/?organization=${model.organization.id}&section=projects&project=${editing.id}`;
  const problem =
    notice === null
      ? null
      : ((creating ? NOTICES : EDIT_NOTICES)[notice] ?? null);
  const locked = editing?.launched === true;
  // The firm's clients and their earlier engagements, as the agent speaks of them.
  const guideClients = model.clients.map((client) => ({
    id: client.id,
    name: client.name,
    engagements: client.engagements.map((item) => ({
      id: item.id,
      name: item.name,
      periodEnd: item.periodEnd,
    })),
  }));
  return (
    <div className="page create-page ne">
      <PageHeader
        context={model.organization.name}
        title={creating ? "New engagement" : `Edit ${editing.name}`}
        description={
          creating
            ? "Set up a new audit engagement: the client, the period, who leads it, and what it covers. Start fresh, or from an earlier engagement of the same client."
            : locked
              ? "Change its name, its lead, or its fieldwork dates. The client and the period end are part of the launched plan and stay as they are."
              : "Change the client, the name, the period, or who leads it. Systems, controls, and the team are set in guided setup."
        }
        actions={
          <>
            {creating ? (
              // The setup agent's guide: by itself the first time, then on request.
              <EngagementGuide clients={guideClients} />
            ) : null}
            <a className="btn btn-secondary" href={back}>
              Cancel
            </a>
            <button type="submit" form={FORM_ID} className="ne-submit">
              {creating ? (
                <>
                  Create engagement <UiIcon name="arrow" size={15} />
                </>
              ) : (
                "Save changes"
              )}
            </button>
          </>
        }
      />
      {problem !== null ? (
        <p className="banner banner-warning" role="alert">
          <UiIcon name="info" size={15} />
          <span>{problem}</span>
        </p>
      ) : null}
      <div className={creating ? "create-layout" : "ne-single"}>
        <div className="ne-main">
          {creating ? (
            <OnboardingCycle
              clients={guideClients}
              setup={SETUP_STEPS.map(({ id, title, detail }) => ({
                id,
                title,
                detail,
              }))}
            />
          ) : null}
          <form
            id={FORM_ID}
            autoComplete="off"
            method="post"
            action="/workspace/projects"
            className="ne-form"
          >
            <input
              type="hidden"
              name="intent"
              value={creating ? "create" : "details"}
            />
            <input
              type="hidden"
              name="organization_id"
              value={model.organization.id}
            />
            {creating ? (
              <input type="hidden" name="status" value="DRAFT" />
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
            <FormSection
              step={1}
              title={
                creating ? "Client and scope" : "Client and basic information"
              }
              detail={
                creating
                  ? "The client, the period, who leads the engagement, the methodology, and what it covers."
                  : "Choose the client, name the engagement, and set the audit period."
              }
            >
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
                    rollforward={creating}
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
                    Shown to the team and on reports. Name the fiscal year and
                    the planner picks up the period from it.
                  </span>
                </label>
              </div>
              <div className="create-grid">
                <PeriodField
                  id="create-period"
                  name={locked ? undefined : "period_end"}
                  defaultValue={editing?.periodEnd ?? undefined}
                  disabled={locked}
                  hint={
                    locked
                      ? "Set before launch."
                      : "The last day the controls are tested through. Leave it blank and the planner suggests one."
                  }
                />
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
                    Owns the engagement and approves the kickoff plan. The rest
                    of the team is added next.
                  </span>
                </label>
              </div>
              {creating ? (
                <div className="create-grid">
                  <label htmlFor="create-methodology" className="field-wide">
                    Methodology
                    <select
                      id="create-methodology"
                      name="methodology"
                      required
                      defaultValue=""
                    >
                      <option value="" disabled>
                        Choose the methodology
                      </option>
                      {METHODOLOGIES.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}: {item.detail}
                        </option>
                      ))}
                    </select>
                    <span className="form-hint">
                      Every methodology needs an independent reviewer; nobody
                      reviews their own work.
                    </span>
                  </label>
                  <ScopeField clients={guideClients} />
                </div>
              ) : null}
            </FormSection>
            {creating ? null : (
              <FormSection
                step={2}
                title="Fieldwork dates"
                detail="When the fieldwork starts and ends."
              >
                <div className="create-grid">
                  <label htmlFor="create-starts">
                    Fieldwork starts
                    <input
                      id="create-starts"
                      name="starts_on"
                      type="date"
                      defaultValue={editing?.startsOn ?? undefined}
                    />
                  </label>
                  <label htmlFor="create-ends">
                    Fieldwork ends
                    <input
                      id="create-ends"
                      name="ends_on"
                      type="date"
                      defaultValue={editing?.endsOn ?? undefined}
                    />
                    <span className="form-hint">Optional.</span>
                  </label>
                </div>
              </FormSection>
            )}
            <div className="ne-actions">
              <a className="btn btn-secondary" href={back}>
                Cancel
              </a>
              <button type="submit">
                {creating ? (
                  <>
                    Create engagement <UiIcon name="arrow" size={15} />
                  </>
                ) : (
                  "Save changes"
                )}
              </button>
            </div>
          </form>
        </div>
        {creating ? (
          <div className="create-aside ne-aside">
            <AgentPanel
              clients={guideClients}
              firstName={firstNameFrom(model.email)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
