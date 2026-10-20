import { Fragment } from "react";
import { AutoRefresh } from "./auto-refresh";
import { ConfirmAction } from "./confirm-action";
import { FilterableOffers } from "./library-offers";
import {
  categoryOf,
  HOSTING_LABELS,
  LAYERS,
  type Onboarding,
  type SetupControl,
  type SetupSystem,
  systemControls,
  systemOffers,
  systemStatus,
} from "./onboarding-model";
import { canonicalQuery } from "./routes";
import { removalNote, ScopedControlTable } from "./scoped-controls";
import { SetupForm } from "./setup-form";
import { impactHref } from "./setup-impact-model";
import type { ShellModel } from "./shell-model";
import { SocAssessment, SocReports, SocUpload } from "./soc-view";
import { SystemRows } from "./system-rows";
import { SystemWizard } from "./system-wizard";
import { type IconName, UiIcon } from "./ui-icon";
import { CardHeader, EmptyState } from "./workspace-view";

type Ready = Extract<ShellModel, { status: "ready" }>;

const LAYER_PLURAL: Record<string, string> = {
  APPLICATION: "Applications",
  DATABASE: "Databases",
  OPERATING_SYSTEM: "Operating systems",
  INFRASTRUCTURE: "Infrastructure",
  TOOL: "Tools",
};
const LAYER_ICON: Record<string, IconName> = {
  APPLICATION: "window",
  DATABASE: "database",
  OPERATING_SYSTEM: "server",
  INFRASTRUCTURE: "cloud",
  TOOL: "wrench",
};
const LAYER_LABEL: Record<string, string> = Object.fromEntries(LAYERS);

/**
 * The in-scope systems, scoped one by one: the list on the left, the open system on
 * the right with how it is run, the scoping agent's review, and its recommendations.
 */
export function SystemsScoping({
  model,
  onboarding,
  editable,
  selected,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
  selected: string | null;
}) {
  const systems = onboarding.applications;
  const count = (status: ReturnType<typeof systemStatus>) =>
    systems.filter((system) => systemStatus(system) === status).length;
  const waiting = count("to-decide");
  const empty = count("no-controls");
  const working = count("reviewing") > 0;
  return (
    <section className="card sys" aria-labelledby="systems-title">
      {working ? <AutoRefresh /> : null}
      <CardHeader
        title="In-scope systems"
        titleId="systems-title"
        description="Each system is scoped on its own. Add one to describe it and choose its controls, with the agent's recommendations; open one to see its SOC 1 standing and the controls in scope."
        aside={
          <span className="sys-counts">
            <span className="num">
              {systems.length} system{systems.length === 1 ? "" : "s"}
            </span>
            {waiting > 0 ? (
              <span className="pill pill-dot tone-info">
                {waiting} to review
              </span>
            ) : null}
            {empty > 0 ? (
              <span className="pill pill-dot tone-warning">
                {empty} without controls
              </span>
            ) : null}
          </span>
        }
      />
      {systems.length === 0 ? (
        <EmptyState
          icon="grid"
          title="No systems yet"
          detail={
            onboarding.rcmSource === "UPLOAD"
              ? "The uploaded RCM named no system. Add the systems the controls run on."
              : "Add the systems the controls run on. Uploading the client's RCM finds them for you."
          }
        />
      ) : (
        <SystemRows
          initial={
            systems.some((system) => system.id === selected) ? selected : null
          }
          groups={LAYERS.flatMap(([layer]) => {
            const group = systems.filter((system) => system.layer === layer);
            return group.length === 0
              ? []
              : [
                  {
                    key: layer,
                    label: LAYER_PLURAL[layer] ?? layer,
                    rows: group.map((system) => ({
                      id: system.id,
                      head: <RowHead system={system} />,
                      detail: (
                        <SystemDetail
                          model={model}
                          onboarding={onboarding}
                          system={system}
                          editable={editable}
                        />
                      ),
                    })),
                  },
                ];
          })}
        />
      )}
      {editable ? (
        <div className="card-footer systems-foot">
          <span className="form-hint">
            Describe the system, then choose the controls that apply to it.
          </span>
          <SystemWizard
            organizationId={model.organization.id}
            projectId={onboarding.projectId}
            knownSystems={onboarding.knownSystems}
            systems={systems}
            editable={editable}
          />
        </div>
      ) : null}
    </section>
  );
}

/** A system's row: what it is, how it is run, and where its scoping stands. */
function RowHead({ system }: { system: SetupSystem }) {
  return (
    <>
      <span className="sys-icon" aria-hidden="true">
        <UiIcon name={LAYER_ICON[system.layer] ?? "window"} size={15} />
      </span>
      <span className="sys-row-name">
        <strong>{system.name}</strong>
        <small>{factsLine(system)}</small>
      </span>
      <span className="sys-row-coverage">{coverageLine(system)}</span>
      <StatusMark system={system} />
      <span className="sys-chevron" aria-hidden="true">
        <UiIcon name="chevron" size={14} />
      </span>
    </>
  );
}

/** How many controls are in scope for the system, for its row. */
function coverageLine(system: SetupSystem): string {
  const n = system.controlsInScope;
  return n === 0
    ? "No controls in scope"
    : `${n} control${n === 1 ? "" : "s"} in scope`;
}

/** One short line under the name: how it appears to be run, and its SOC 1 standing. */
function factsLine(system: SetupSystem): string {
  const hosting =
    system.hosting === null ? "" : (HOSTING_LABELS[system.hosting] ?? "");
  const soc = system.assessment?.socStatus;
  const parts = [
    hosting,
    soc === "RELEVANT"
      ? "SOC 1 relevant"
      : soc === "UNDETERMINED"
        ? "SOC 1 undetermined"
        : "",
  ].filter((part) => part !== "");
  return parts.length > 0 ? parts.join(" · ") : "Not assessed yet";
}

function StatusMark({ system }: { system: SetupSystem }) {
  const status = systemStatus(system);
  if (status === "reviewing") {
    return (
      <span className="sys-status is-working">
        <i aria-hidden="true" />
        Reviewing
      </span>
    );
  }
  if (status === "to-decide") {
    return <span className="sys-status is-confirm">Review controls</span>;
  }
  if (status === "no-controls") {
    return <span className="sys-status is-confirm">No controls</span>;
  }
  return (
    <span className="sys-status is-done" title="Scoped">
      <UiIcon name="check" size={12} />
    </span>
  );
}

function Hidden({
  model,
  onboarding,
  system,
  intent,
}: {
  model: Ready;
  onboarding: Onboarding;
  system: SetupSystem;
  intent: string;
}) {
  return (
    <>
      <input
        type="hidden"
        name="organization_id"
        value={model.organization.id}
      />
      <input type="hidden" name="project_id" value={onboarding.projectId} />
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="step" value="controls" />
      <input type="hidden" name="system_id" value={system.id} />
      <input type="hidden" name="return_system" value={system.id} />
    </>
  );
}

function SystemDetail({
  model,
  onboarding,
  system,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  system: SetupSystem;
  editable: boolean;
}) {
  const assessment = system.assessment;
  const status = systemStatus(system);
  const ids = {
    organizationId: model.organization.id,
    projectId: onboarding.projectId,
  };
  const about: Array<[string, string]> = [
    ["Description", system.description],
    ["Business purpose", system.purpose],
    ["Processes", system.processes],
    ["Owner", system.owner],
  ];
  return (
    <article className="sys-detail" aria-label={`Scoping of ${system.name}`}>
      <header className="sys-head">
        <p>
          {LAYER_LABEL[system.layer] ?? "Application"}
          {assessment !== null && assessment.source !== "NONE" ? (
            <span>
              {" "}
              · Assessed by{" "}
              {assessment.source === "AGENT" ? "the agent" : "standard checks"}
            </span>
          ) : null}
        </p>
        {editable ? (
          <div className="sys-head-actions">
            <SystemWizard
              organizationId={model.organization.id}
              projectId={onboarding.projectId}
              knownSystems={onboarding.knownSystems}
              systems={onboarding.applications}
              editable={editable}
              system={system}
            />
            <form autoComplete="off" method="post" action="/workspace/setup">
              <input
                type="hidden"
                name="organization_id"
                value={model.organization.id}
              />
              <input
                type="hidden"
                name="project_id"
                value={onboarding.projectId}
              />
              <input type="hidden" name="step" value="controls" />
              <input type="hidden" name="application_id" value={system.id} />
              <ConfirmAction
                label={onboarding.started ? "Take out of scope" : "Remove"}
                intent="remove-application"
                className="btn-ghost btn-sm sys-remove"
                title={
                  onboarding.started
                    ? `Take ${system.name} out of scope?`
                    : `Remove ${system.name}?`
                }
                consequence={removalImpact(onboarding, system)}
                confirmLabel={
                  onboarding.started ? "Take out of scope" : "Remove system"
                }
                impact={
                  onboarding.started
                    ? impactHref(model.organization.id, onboarding.projectId, {
                        kind: "application",
                        id: system.id,
                      })
                    : undefined
                }
              />
            </form>
          </div>
        ) : null}
      </header>

      {status === "reviewing" ? (
        <p className="sys-working">
          <i aria-hidden="true" />
          The agent is assessing {system.name}. This updates on its own.
        </p>
      ) : status === "to-decide" ? (
        <p className="sys-locked">
          <UiIcon name="wand" size={13} />
          <span>
            The agent recommended controls for {system.name}. Open Review
            controls to accept or change them; nothing changes until you save.
          </span>
        </p>
      ) : status === "no-controls" ? (
        <p className="sys-locked">
          <UiIcon name="risk" size={13} />
          <span>
            No control is in scope for {system.name}, so nothing would be tested
            for it. Open Review controls to choose them.
          </span>
        </p>
      ) : null}

      <section className="sys-block" aria-label={`About ${system.name}`}>
        <h4>About {system.name}</h4>
        {about.some(([, value]) => value !== "") ? (
          <dl className="cc-def-list">
            {about
              .filter(([, value]) => value !== "")
              .map(([label, value]) => (
                <Fragment key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </Fragment>
              ))}
          </dl>
        ) : (
          <p className="form-hint">
            No details yet. Add them in Review controls; the agent's
            recommendations rest on them.
          </p>
        )}
        {assessment !== null && assessment.summary !== "" ? (
          <p className="sys-summary">{assessment.summary}</p>
        ) : null}
      </section>

      <section className="sys-block" aria-label="SOC 1">
        <h4>SOC 1</h4>
        <SocAssessment system={system} />
        <SocReports ids={ids} reports={system.socReports} editable={editable} />
        <SocUpload ids={ids} system={system} editable={editable} />
      </section>

      <ScopedControls
        model={model}
        onboarding={onboarding}
        system={system}
        editable={editable}
      />
      {editable ? (
        <LibraryOffers model={model} onboarding={onboarding} system={system} />
      ) : null}
    </article>
  );
}

/**
 * The rest of the library's IT controls for this system, closed until opened: any control
 * not in scope here and not waiting as one of the agent's recommendations can be added,
 * whatever the agent recommended. A control loaded for the system but out of scope is
 * brought back rather than copied again.
 */
function LibraryOffers({
  model,
  onboarding,
  system,
}: {
  model: Ready;
  onboarding: Onboarding;
  system: SetupSystem;
}) {
  const areas = systemOffers(system);
  const total = areas.reduce((sum, area) => sum + area.offers.length, 0);
  if (total === 0) {
    return null;
  }
  return (
    <details className="sys-more">
      <summary>
        <span>Add controls from the library</span>
        <span className="num">{total} available</span>
      </summary>
      <p className="form-hint">
        Standard IT controls not yet in scope for {system.name}. Each one added
        is tested for this system only.
      </p>
      <FilterableOffers
        system={system.name}
        areas={areas}
        actions={Object.fromEntries(
          areas.flatMap((area) =>
            area.offers.map((offer) => [
              offer.libraryKey || offer.controlRef,
              <SetupForm
                key={offer.libraryKey || offer.controlRef}
                className="sys-rec-actions"
              >
                <Hidden
                  model={model}
                  onboarding={onboarding}
                  system={system}
                  intent="system-add-control"
                />
                {offer.controlId !== null ? (
                  <input
                    type="hidden"
                    name="control_id"
                    value={offer.controlId}
                  />
                ) : (
                  <input
                    type="hidden"
                    name="library_key"
                    value={offer.libraryKey}
                  />
                )}
                <button type="submit" className="btn-ghost btn-sm">
                  <UiIcon name="plus" size={13} />
                  {offer.controlId !== null ? "Add back" : "Add to scope"}
                </button>
              </SetupForm>,
            ]),
          ),
        )}
      />
    </details>
  );
}

/** Opens the control in the editor above the systems: frequency, nature, templates. */
export function controlHref(
  model: Ready,
  onboarding: Onboarding,
  control: SetupControl,
  system: string | null = null,
): string {
  const params = new URLSearchParams({
    organization: model.organization.id,
    section: "setup",
    step: "controls",
    project: onboarding.projectId,
    category: categoryOf(control.domain),
    control: control.id,
  });
  canonicalQuery(params);
  if (system !== null) {
    // Opened from a system, on the IT tab: the page stays on that tab and that system.
    params.set("category", "it");
    params.set("system", system);
  }
  return `/?${params.toString()}`;
}

function ScopedControls({
  model,
  onboarding,
  system,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  system: SetupSystem;
  editable: boolean;
}) {
  const controls = systemControls(onboarding.controls, system.id);
  return (
    <ScopedControlTable
      title={`Controls in scope for ${system.name}`}
      titleId={`scoped-${system.id}`}
      controls={controls}
      empty="None yet. Add the recommended controls, or any other from the library below."
      hrefFor={(control) => controlHref(model, onboarding, control, system.id)}
      action={
        editable
          ? (control) => (
              <SetupForm className="sys-rec-actions">
                <Hidden
                  model={model}
                  onboarding={onboarding}
                  system={system}
                  intent="system-remove-control"
                />
                <input type="hidden" name="control_id" value={control.id} />
                <ConfirmAction
                  label="Remove from scope"
                  intent="system-remove-control"
                  className="btn-ghost btn-sm ctl-remove"
                  title={`Remove ${control.controlRef} from scope?`}
                  consequence={removalNote(
                    control,
                    system.name,
                    onboarding.started,
                  )}
                  confirmLabel="Remove from scope"
                  impact={
                    onboarding.started
                      ? impactHref(
                          model.organization.id,
                          onboarding.projectId,
                          {
                            kind: "control",
                            id: control.id,
                          },
                        )
                      : undefined
                  }
                />
              </SetupForm>
            )
          : null
      }
    />
  );
}

/** What removing a system does to its controls, said before it is done. */
function removalImpact(onboarding: Onboarding, system: SetupSystem): string {
  const controls = onboarding.controls.filter(
    (control) => control.applicationId === system.id && control.included,
  ).length;
  const count = `${controls} control${controls === 1 ? "" : "s"} in scope`;
  return onboarding.started
    ? `Its ${count} leave scope and their open work stops. The system, the work already done, and its evidence stay on record.`
    : `It has ${count}. A control it shares with other systems loses its copy for this one; a control on no other system is kept, out of scope, and returns if the system is added again.`;
}
