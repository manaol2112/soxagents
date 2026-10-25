import { useId } from "react";
import { ConfirmAction } from "./confirm-action";
import { NewControlForm } from "./new-control-form";
import {
  type Onboarding,
  PROCESS_CYCLES,
  type ProcessRow,
  processRows,
  type ReportRow,
  reportOffers,
  reportRows,
  type SetupControl,
} from "./onboarding-model";
import { ScopeTable } from "./scope-table";
import { removalNote, ScopedControlTable } from "./scoped-controls";
import { SetupForm } from "./setup-form";
import { impactHref } from "./setup-impact-model";
import type { ShellModel } from "./shell-model";
import { SystemRows } from "./system-rows";
import { controlHref } from "./systems-view";
import { UiIcon } from "./ui-icon";
import { CardHeader, EmptyState } from "./workspace-view";

type Ready = Extract<ShellModel, { status: "ready" }>;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The hidden fields every setup form posts, plus the ones named. */
function Fields({
  model,
  onboarding,
  intent,
  values,
}: {
  model: Ready;
  onboarding: Onboarding;
  intent: string;
  values: Record<string, string>;
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
      {Object.entries(values).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </>
  );
}

/**
 * The business processes, each a row that opens in place with its controls: the ones in
 * scope, the ones taken out, and the library's starter controls for it. A business
 * process control belongs to its process, not a system.
 */
export function ProcessesCard({
  model,
  onboarding,
  editable,
  selected,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
  /** The process to open: the one a selected control belongs to. */
  selected: string | null;
}) {
  const rows = processRows(onboarding);
  const inScope = rows.reduce((sum, row) => sum + row.inScope.length, 0);
  const rowId = (row: ProcessRow) => row.processId ?? row.domain;
  return (
    <section className="card sys" aria-labelledby="processes-title">
      <CardHeader
        title="Business processes"
        titleId="processes-title"
        description="Each process is scoped on its own. Open one to see its controls in scope and the starter controls the library offers for it. Name the client's own processes beside the standard cycles, and write controls for any of them."
        aside={
          <span className="sys-counts">
            <span className="num">{plural(inScope, "control")} in scope</span>
          </span>
        }
      />
      {editable ? (
        <div className="sys-groups">
          <NewProcessForm model={model} onboarding={onboarding} />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState
          icon="grid"
          title="No business process controls yet"
          detail="Add starter controls from the library, upload the client's RCM, name a process, or write a control below."
        />
      ) : (
        <SystemRows
          initial={
            rows.some((row) => rowId(row) === selected) ? selected : null
          }
          groups={[
            {
              key: "processes",
              label: "Business processes",
              rows: rows.map((row) => ({
                id: rowId(row),
                head: <ProcessHead row={row} />,
                detail: (
                  <ProcessDetail
                    model={model}
                    onboarding={onboarding}
                    row={row}
                    editable={editable}
                  />
                ),
              })),
            },
          ]}
        />
      )}
      {editable ? (
        <div className="sys-groups">
          <NewControlForm
            model={model}
            onboarding={onboarding}
            domains={PROCESS_CYCLES.map(([key]) => key)}
            processes={onboarding.processes}
            systems={[]}
            title="New business process control"
            example={{
              controlRef: "BP-01",
              title: "Credit notes are approved before posting",
            }}
          />
        </div>
      ) : null}
    </section>
  );
}

/** The cycles a process may be based on, by key. */
const CYCLE_LABEL: Record<string, string> = Object.fromEntries(PROCESS_CYCLES);

/** The business processes in scope (a process of the client's own, or a standard cycle
 * with controls in scope), counted as the page's tile counts them. */
export function scopedProcesses(onboarding: Onboarding): ProcessRow[] {
  return processRows(onboarding).filter(
    (row) => row.processId !== null || row.inScope.length > 0,
  );
}

/**
 * The business processes as the Systems & Processes page's table (decided by the
 * product owner): name, the cycle it is based on, and the controls in scope; a row opens
 * the process's controls in place.
 */
export function ProcessesTable({
  model,
  onboarding,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
}) {
  const rows = scopedProcesses(onboarding);
  return (
    <ScopeTable
      label="Processes"
      columns={["Process name", "Based on", "Controls"]}
      kinds={PROCESS_CYCLES.filter(([key]) =>
        rows.some((row) => row.domain === key),
      )}
      kindLabel="Filter by cycle"
      searchLabel="Search processes"
      action={
        editable ? (
          <NewProcessForm
            model={model}
            onboarding={onboarding}
            label="Add process"
          />
        ) : null
      }
      rows={rows.map((row) => ({
        id: row.processId ?? row.domain,
        kind: row.domain,
        text: [row.label, CYCLE_LABEL[row.domain] ?? ""].join("\n"),
        cells: [
          <span key="name" className="st-name">
            <span className="st-icon is-process" aria-hidden="true">
              <UiIcon name="layers" size={15} />
            </span>
            <strong>{row.label}</strong>
          </span>,
          row.processId === null ? (
            <span key="cycle" className="st-muted">
              Standard cycle
            </span>
          ) : (
            (CYCLE_LABEL[row.domain] ?? row.domain)
          ),
          <span key="controls" className="num">
            {row.inScope.length}
          </span>,
        ],
        detail: (
          <ProcessDetail
            model={model}
            onboarding={onboarding}
            row={row}
            editable={editable}
          />
        ),
      }))}
    />
  );
}

/** Name a process of the client's own, based on the standard cycle it is closest to.
 * With a label, it opens from a main button, as the first process. */
export function NewProcessForm({
  model,
  onboarding,
  label = null,
}: {
  model: Ready;
  onboarding: Onboarding;
  label?: string | null;
}) {
  const id = useId();
  return (
    <details
      className={`sys-more new-process${label === null ? "" : " is-first"}`}
    >
      <summary>
        <span>
          <UiIcon name="plus" size={13} /> {label ?? "Add a process"}
        </span>
      </summary>
      <SetupForm className="new-control-form">
        <Fields
          model={model}
          onboarding={onboarding}
          intent="process-new"
          values={{}}
        />
        <div className="new-control-grid">
          <label className="span-2" htmlFor={`${id}-name`}>
            Process name
            <input
              id={`${id}-name`}
              name="name"
              required
              maxLength={120}
              placeholder="Lease accounting"
            />
          </label>
          <label htmlFor={`${id}-domain`}>
            Based on
            <select
              id={`${id}-domain`}
              name="domain"
              defaultValue="OTHER_BUSINESS"
            >
              {PROCESS_CYCLES.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-actions">
          <button type="submit" className="btn-sm">
            <UiIcon name="plus" size={13} /> Add process
          </button>
          <span className="form-hint">
            The cycle it is based on decides the tester, the sample sizes, and
            the workpaper template of its controls.
          </span>
        </div>
      </SetupForm>
    </details>
  );
}

function ProcessHead({ row }: { row: ProcessRow }) {
  return (
    <>
      <span className="sys-icon" aria-hidden="true">
        <UiIcon name="briefcase" size={15} />
      </span>
      <span className="sys-row-name">
        <strong>{row.label}</strong>
        <small>
          {row.inScope.length === 0
            ? "No controls in scope"
            : `${plural(row.inScope.length, "control")} in scope`}
          {row.processId !== null
            ? ` · Based on ${
                PROCESS_CYCLES.find(([key]) => key === row.domain)?.[1] ??
                row.domain
              }`
            : ""}
        </small>
      </span>
      <span className="sys-row-coverage">
        {row.offers.length > 0
          ? `${row.offers.length} more in the library`
          : ""}
      </span>
      {row.inScope.length > 0 ? (
        <span className="sys-status is-done" title="Scoped">
          <UiIcon name="check" size={12} />
        </span>
      ) : (
        <span className="sys-status is-confirm">No controls</span>
      )}
      <span className="sys-chevron" aria-hidden="true">
        <UiIcon name="chevron" size={14} />
      </span>
    </>
  );
}

function ProcessDetail({
  model,
  onboarding,
  row,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  row: ProcessRow;
  editable: boolean;
}) {
  return (
    <article className="sys-detail" aria-label={`Scoping of ${row.label}`}>
      <ControlList
        model={model}
        onboarding={onboarding}
        title={`Controls in scope for ${row.label}`}
        controls={row.inScope}
        empty="None yet. Bring one back into scope, or add a starter control from the library below."
        action={
          editable
            ? (control) => (
                <SetupForm className="sys-rec-actions">
                  <Fields
                    model={model}
                    onboarding={onboarding}
                    intent="control-scope"
                    values={{ control_id: control.id, included: "false" }}
                  />
                  <ConfirmAction
                    label="Remove from scope"
                    intent="control-scope"
                    className="btn-ghost btn-sm ctl-remove"
                    title={`Remove ${control.controlRef} from scope?`}
                    consequence={removalNote(
                      control,
                      row.label,
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
      {row.outOfScope.length > 0 ? (
        <ControlList
          model={model}
          onboarding={onboarding}
          title="Out of scope"
          controls={row.outOfScope}
          empty=""
          action={
            editable
              ? (control) => (
                  <SetupForm className="sys-rec-actions">
                    <Fields
                      model={model}
                      onboarding={onboarding}
                      intent="control-scope"
                      values={{ control_id: control.id, included: "true" }}
                    />
                    <button type="submit" className="btn-secondary btn-sm">
                      <UiIcon name="plus" size={13} /> Bring into scope
                    </button>
                  </SetupForm>
                )
              : null
          }
        />
      ) : null}
      {editable ? (
        <NewControlForm
          model={model}
          onboarding={onboarding}
          domains={[row.domain]}
          processId={row.processId}
          systems={[]}
          title={`New ${row.label.toLowerCase().replace(/ controls?$/, "")} control`}
          example={{
            controlRef: row.inScope[0]?.controlRef ?? "BP-01",
            title: "Credit notes are approved before posting",
          }}
        />
      ) : null}
      {editable &&
      row.processId !== null &&
      row.inScope.length + row.outOfScope.length === 0 ? (
        <SetupForm className="sys-rec-actions">
          <Fields
            model={model}
            onboarding={onboarding}
            intent="process-remove"
            values={{ process_id: row.processId }}
          />
          <button type="submit" className="btn-ghost btn-sm">
            Remove process
          </button>
          <span className="form-hint">
            A process with controls stays; take its controls out of scope
            instead.
          </span>
        </SetupForm>
      ) : null}
      {row.offers.length > 0 ? (
        <details className="sys-more">
          <summary>
            <span>Starter controls from the library</span>
            <span className="num">{row.offers.length}</span>
          </summary>
          <p className="form-hint">
            Reviewed controls for {row.label.toLowerCase()}. Add the ones that
            apply to this client.
          </p>
          <section className="sys-more-group" aria-label={row.label}>
            <ul>
              {row.offers.map((offer) => (
                <li key={offer.libraryKey}>
                  <span>
                    <strong>{offer.controlRef}</strong> {offer.title}
                  </span>
                  {editable ? (
                    <SetupForm className="sys-rec-actions">
                      <Fields
                        model={model}
                        onboarding={onboarding}
                        intent="process-add-control"
                        values={{ library_key: offer.libraryKey }}
                      />
                      <button type="submit" className="btn-ghost btn-sm">
                        <UiIcon name="plus" size={13} /> Add to scope
                      </button>
                    </SetupForm>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </details>
      ) : null}
    </article>
  );
}

/** A list of controls, each opening in the editor, with one action beside it. */
function ControlList({
  model,
  onboarding,
  title,
  controls,
  empty,
  action,
}: {
  model: Ready;
  onboarding: Onboarding;
  title: string;
  controls: SetupControl[];
  empty: string;
  action: ((control: SetupControl) => React.ReactNode) | null;
}) {
  const id = useId();
  return (
    <ScopedControlTable
      title={title}
      titleId={`${id}-controls`}
      controls={controls}
      empty={empty}
      hrefFor={(control) => controlHref(model, onboarding, control)}
      action={action}
      showType={false}
    />
  );
}

/**
 * The key reports, each a row that opens in place with the systems it comes from. A
 * report is tested once per system, so it can be added for any in-scope system.
 */
export function ReportsCard({
  model,
  onboarding,
  editable,
  selected,
}: {
  model: Ready;
  onboarding: Onboarding;
  editable: boolean;
  /** The report to open: the selected control's reference. */
  selected: string | null;
}) {
  const rows = reportRows(onboarding);
  const offers = reportOffers(onboarding);
  const systems = onboarding.applications;
  return (
    <section className="card sys" aria-labelledby="reports-title">
      <CardHeader
        title="Key reports"
        titleId="reports-title"
        description="Reports and IPE that controls rely on. Each is tested once per system it comes from."
        aside={
          <span className="sys-counts">
            <span className="num">{plural(rows.length, "report")}</span>
          </span>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          icon="table"
          title="No key reports yet"
          detail={
            systems.length === 0
              ? "Add the in-scope systems on the IT controls tab first. Key reports are tested per system."
              : "Add a report from the library below for the system it comes from, or upload the client's RCM."
          }
        />
      ) : (
        <SystemRows
          initial={
            rows.some((row) => row.controlRef === selected) ? selected : null
          }
          groups={[
            {
              key: "reports",
              label: "Key reports",
              rows: rows.map((row) => ({
                id: row.controlRef,
                head: <ReportHead row={row} systems={systems.length} />,
                detail: (
                  <ReportDetail
                    model={model}
                    onboarding={onboarding}
                    row={row}
                    editable={editable}
                  />
                ),
              })),
            },
          ]}
        />
      )}
      {editable && systems.length > 0 ? (
        <div className="sys-groups">
          <NewControlForm
            model={model}
            onboarding={onboarding}
            domains={["IPE"]}
            systems={systems}
            title="New key report"
            example={{
              controlRef: rows[0]?.controlRef ?? "KR-01",
              title: "Aged receivables report is complete and accurate",
            }}
          />
        </div>
      ) : null}
      {editable && offers.length > 0 && systems.length > 0 ? (
        <div className="sys-groups">
          <details className="sys-more">
            <summary>
              <span>Key reports from the library</span>
              <span className="num">{offers.length}</span>
            </summary>
            <p className="form-hint">
              Not loaded for any system yet. Add one for the system it comes
              from.
            </p>
            <section className="sys-more-group" aria-label="Key reports">
              <ul>
                {offers.map((offer) => (
                  <li key={offer.libraryKey}>
                    <span>
                      <strong>{offer.controlRef}</strong> {offer.title}
                    </span>
                    <SetupForm className="sys-rec-actions">
                      <Fields
                        model={model}
                        onboarding={onboarding}
                        intent="system-add-control"
                        values={{ library_key: offer.libraryKey }}
                      />
                      <select
                        name="system_id"
                        aria-label={`System ${offer.controlRef} comes from`}
                        defaultValue={systems[0]?.id ?? ""}
                      >
                        {systems.map((system) => (
                          <option key={system.id} value={system.id}>
                            {system.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn-ghost btn-sm">
                        <UiIcon name="plus" size={13} /> Add
                      </button>
                    </SetupForm>
                  </li>
                ))}
              </ul>
            </section>
          </details>
        </div>
      ) : null}
    </section>
  );
}

function ReportHead({ row, systems }: { row: ReportRow; systems: number }) {
  return (
    <>
      <span className="sys-icon" aria-hidden="true">
        <UiIcon name="table" size={15} />
      </span>
      <span className="sys-row-name">
        <strong>{row.title}</strong>
        <small>{row.controlRef}</small>
      </span>
      <span className="sys-row-coverage">
        {row.inScope.length === 0
          ? "No system yet"
          : `From ${row.inScope.length} of ${plural(systems, "system")}`}
      </span>
      {row.inScope.length > 0 ? (
        <span className="sys-status is-done" title="Scoped">
          <UiIcon name="check" size={12} />
        </span>
      ) : (
        <span className="sys-status is-confirm">No system</span>
      )}
      <span className="sys-chevron" aria-hidden="true">
        <UiIcon name="chevron" size={14} />
      </span>
    </>
  );
}

function ReportDetail({
  model,
  onboarding,
  row,
  editable,
}: {
  model: Ready;
  onboarding: Onboarding;
  row: ReportRow;
  editable: boolean;
}) {
  return (
    <article className="sys-detail" aria-label={`Scoping of ${row.title}`}>
      <header className="sys-head">
        <p>
          <a
            className="row-link"
            href={controlHref(model, onboarding, row.control)}
          >
            Open {row.controlRef} in the control editor
          </a>
        </p>
      </header>
      <section className="sys-block">
        <div className="sys-block-head">
          <h4>Systems it is tested for</h4>
          <span className="num">{row.inScope.length}</span>
        </div>
        {row.inScope.length === 0 ? (
          <p className="form-hint">
            None yet. Add it for the system it comes from.
          </p>
        ) : (
          <ul className="sys-scoped">
            {row.inScope.map((item) => (
              <li key={item.control.id}>
                <span>
                  <strong>{item.systemName}</strong>
                </span>
                {editable && item.control.applicationId !== null ? (
                  <SetupForm className="sys-rec-actions">
                    <Fields
                      model={model}
                      onboarding={onboarding}
                      intent="system-remove-control"
                      values={{
                        system_id: item.control.applicationId,
                        control_id: item.control.id,
                      }}
                    />
                    <ConfirmAction
                      label="Remove from scope"
                      intent="system-remove-control"
                      className="btn-ghost btn-sm ctl-remove"
                      title={`Remove ${item.control.controlRef} for ${item.systemName}?`}
                      consequence={removalNote(
                        item.control,
                        item.systemName,
                        onboarding.started,
                      )}
                      confirmLabel="Remove from scope"
                      impact={
                        onboarding.started
                          ? impactHref(
                              model.organization.id,
                              onboarding.projectId,
                              { kind: "control", id: item.control.id },
                            )
                          : undefined
                      }
                    />
                  </SetupForm>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      {row.outOfScope.length > 0 ? (
        <section className="sys-block">
          <div className="sys-block-head">
            <h4>Out of scope</h4>
            <span className="num">{row.outOfScope.length}</span>
          </div>
          <ul className="sys-scoped">
            {row.outOfScope.map((item) => (
              <li key={item.control.id}>
                <span>
                  <strong>{item.systemName}</strong>
                </span>
                {editable && item.control.applicationId !== null ? (
                  <SetupForm className="sys-rec-actions">
                    <Fields
                      model={model}
                      onboarding={onboarding}
                      intent="system-add-control"
                      values={{
                        system_id: item.control.applicationId,
                        control_id: item.control.id,
                      }}
                    />
                    <button type="submit" className="btn-ghost btn-sm">
                      <UiIcon name="plus" size={13} /> Add back
                    </button>
                  </SetupForm>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {editable && row.uncovered.length > 0 ? (
        <section className="sys-block">
          <div className="sys-block-head">
            <h4>Add it for another system</h4>
          </div>
          <SetupForm className="sys-rec-actions">
            <Fields
              model={model}
              onboarding={onboarding}
              intent="system-add-control"
              values={{ control_id: row.control.id }}
            />
            <select
              name="system_id"
              aria-label="System"
              defaultValue={row.uncovered[0]?.id ?? ""}
            >
              {row.uncovered.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-secondary btn-sm">
              <UiIcon name="plus" size={13} /> Add for this system
            </button>
          </SetupForm>
        </section>
      ) : null}
    </article>
  );
}
